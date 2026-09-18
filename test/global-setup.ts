import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestProject } from 'vitest/node';
import { acquireDbLock } from './support/db-lock';

/**
 * Rebuilds the test database before the suite runs, and snapshots it.
 *
 * The integration tests mutate shared server state - they both add rows and delete
 * them - so without this the pass/fail list moves between runs and there is no
 * regression contract to hold a rewrite to.
 *
 * Re-applying the schema+data script is the reliable rebuild. The old
 * CleanBreezeTestDb.sql cannot do it: it misses EmployeeID = 10, leaves Customer at
 * 95 against an original 93, and one of its deletes fails on a foreign key.
 *
 * The rebuild takes seconds, too slow to repeat for every spec file. So once it is done,
 * the test server takes a SQL Server database snapshot of the pristine database
 * (POST /breeze/TestDb/Snapshot), and test/integration-setup.ts reverts to that snapshot
 * before each integration spec file.
 *
 * Runs in Node even when the tests themselves run in a browser, so this works for
 * browser mode too.
 *
 * Opt out with BREEZE_SKIP_DB_RESET=1. The per-file reset still runs, against the snapshot
 * the last full run took.
 */

const SERVER = process.env.BREEZE_TEST_SERVER ?? 'http://localhost:34377';
const DB = process.env.BREEZE_TEST_DB ?? 'BreezeTestDb';
const SQL_INSTANCE = process.env.BREEZE_SQL_INSTANCE ?? '.';

// The script lives in the server repo, which is normally a sibling checkout.
const DEFAULT_SCRIPT = resolve(
  process.cwd(),
  '../breeze-server-v3/tests/Databases/BreezeTestDb.sql',
);
const SCRIPT = process.env.BREEZE_TEST_DB_SCRIPT ?? DEFAULT_SCRIPT;

declare module 'vitest' {
  interface ProvidedContext {
    /** The test server's base URL, for test/integration-setup.ts. */
    breezeTestServer: string;
  }
}

function sqlcmd(args: string[]): void {
  // -f 65001 is not optional. The script is UTF-8; without it sqlcmd decodes the file
  // as the system ANSI codepage and every non-ASCII value is silently mangled
  // ('San Cristobal' with an accented o becomes 'San CristÃ³bal'). Re-scripting a
  // database loaded that way compounds the damage until values overflow their columns.
  execFileSync('sqlcmd', ['-S', SQL_INSTANCE, '-E', '-b', '-f', '65001', ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

async function post(action: string): Promise<Response> {
  try {
    return await fetch(`${SERVER}/breeze/${action}`, { method: 'POST' });
  } catch {
    throw new Error(
      `[db-reset] could not reach the test server at ${SERVER} (POST /breeze/${action}).\n` +
        `           Start it first, or run the tests through scripts/test-with-server.ps1.`,
    );
  }
}

/**
 * Vitest calls globalSetup once per project, and browser mode has more than one project in
 * the same Node process - so this ran twice. The two rebuilds raced: each dropped and
 * recreated the database while the other was loading it, and sqlcmd failed with
 * "Access is denied", at random. Memoized, so the rebuild happens once per run and every
 * project waits on that one.
 */
let rebuilding: Promise<void> | undefined;

export async function setup(project: TestProject): Promise<void> {
  project.provide('breezeTestServer', SERVER);
  // Before anything touches the database - including a run that skips the rebuild, which still
  // reverts it before every spec file. See test/support/db-lock.ts.
  acquireDbLock(join(tmpdir(), `breeze-test-${DB}.lock`), DB, runDescription());
  rebuilding ??= rebuild();
  return rebuilding;
}

/** What to call this run in another run's lock message: the vitest command line, shortened. */
function runDescription(): string {
  const args = process.argv.slice(2).filter(a => !a.includes('node_modules'));
  return ['vitest', ...args].join(' ');
}

async function rebuild(): Promise<void> {
  if (process.env.BREEZE_SKIP_DB_RESET === '1') {
    console.log('[db-reset] rebuild skipped (BREEZE_SKIP_DB_RESET=1)');
    return;
  }

  if (!existsSync(SCRIPT)) {
    throw new Error(
      `[db-reset] script not found at ${SCRIPT}\n` +
        `           Set BREEZE_TEST_DB_SCRIPT, or BREEZE_SKIP_DB_RESET=1 to reuse the last snapshot.`,
    );
  }

  const started = Date.now();
  try {
    // A database with snapshots cannot be dropped, so drop those first.
    // SINGLE_USER kicks the server's pooled connections; EF reconnects on next use.
    sqlcmd([
      '-Q',
      `DECLARE @drop nvarchar(max) = N''; ` +
        `SELECT @drop += N'DROP DATABASE ' + QUOTENAME(name) + N'; ' FROM sys.databases WHERE source_database_id = DB_ID('${DB}'); ` +
        `EXEC (@drop); ` +
        `IF DB_ID('${DB}') IS NOT NULL BEGIN ALTER DATABASE [${DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB}]; END CREATE DATABASE [${DB}];`,
    ]);
    sqlcmd(['-d', DB, '-i', SCRIPT]);
  } catch (e: any) {
    const detail = e?.stdout || e?.stderr || e?.message;
    throw new Error(`[db-reset] failed to rebuild ${DB}:\n${detail}`);
  }
  const rebuilt = Date.now();

  // The inheritance tables carry no data in the script; the server seeds them.
  // It normally does that at startup, so after a rebuild they must be re-seeded.
  const seed = await post('Inheritance/Seed');
  if (!seed.ok) {
    throw new Error(`[db-reset] inheritance seed returned ${seed.status}`);
  }

  const snapshot = await post('TestDb/Snapshot');
  if (!snapshot.ok) {
    throw new Error(
      `[db-reset] POST ${SERVER}/breeze/TestDb/Snapshot returned ${snapshot.status}` +
        (snapshot.status === 404
          ? '.\n           The test server must be started with --TestDb:AllowReset=true (scripts/test-with-server.ps1 does this),\n' +
            '           and be recent enough to have the endpoint.'
          : `: ${await snapshot.text()}`),
    );
  }

  const done = Date.now();
  console.log(
    `[db-reset] ${DB} rebuilt in ${rebuilt - started}ms, seeded and snapshotted in ${done - rebuilt}ms`,
  );
}
