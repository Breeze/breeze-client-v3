import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Rebuilds the test database before the suite runs.
 *
 * The integration tests mutate shared server state - they both add rows and delete
 * them - so without this the pass/fail list moves between runs and there is no
 * regression contract to hold a rewrite to.
 *
 * Re-applying the schema+data script is the reliable reset. The old
 * CleanBreezeTestDb.sql cannot do it: it misses EmployeeID = 10, leaves Customer at
 * 95 against an original 93, and one of its deletes fails on a foreign key.
 *
 * Runs in Node even when the tests themselves run in a browser, so this works for
 * browser mode too.
 *
 * Opt out with BREEZE_SKIP_DB_RESET=1 (useful for the no-server unit tests).
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

function sqlcmd(args: string[]): void {
  execFileSync('sqlcmd', ['-S', SQL_INSTANCE, '-E', '-b', ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

export async function setup(): Promise<void> {
  if (process.env.BREEZE_SKIP_DB_RESET === '1') {
    console.log('[db-reset] skipped (BREEZE_SKIP_DB_RESET=1)');
    return;
  }

  if (!existsSync(SCRIPT)) {
    console.warn(
      `[db-reset] SKIPPED - script not found at ${SCRIPT}\n` +
        `           Set BREEZE_TEST_DB_SCRIPT, or BREEZE_SKIP_DB_RESET=1 to silence this.\n` +
        `           Integration tests will run against whatever state the database is in.`,
    );
    return;
  }

  const started = Date.now();
  try {
    // SINGLE_USER kicks the server's pooled connections; EF reconnects on next use.
    sqlcmd([
      '-Q',
      `IF DB_ID('${DB}') IS NOT NULL BEGIN ALTER DATABASE [${DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB}]; END CREATE DATABASE [${DB}];`,
    ]);
    sqlcmd(['-d', DB, '-i', SCRIPT]);
  } catch (e: any) {
    const detail = e?.stdout || e?.stderr || e?.message;
    throw new Error(`[db-reset] failed to rebuild ${DB}:\n${detail}`);
  }

  // The inheritance tables carry no data in the script; the server seeds them.
  // It normally does that at startup, so after a rebuild they must be re-seeded.
  try {
    const res = await fetch(`${SERVER}/breeze/Inheritance/Seed`, { method: 'POST' });
    if (!res.ok) {
      console.warn(`[db-reset] inheritance seed returned ${res.status}`);
    }
  } catch {
    console.warn(
      `[db-reset] could not reach ${SERVER} to seed the inheritance tables.\n` +
        `           Server-backed tests will fail until it is running.`,
    );
  }

  console.log(`[db-reset] ${DB} rebuilt in ${Date.now() - started}ms`);
}
