import { beforeAll, inject } from 'vitest';

/**
 * Puts BreezeTestDb back to its pristine state before every integration spec file, so each
 * file starts from the same data no matter which files ran before it, or whether any did.
 *
 * test/global-setup.ts rebuilds the database once per run and has the test server take a
 * SQL Server database snapshot of it. This asks the server to revert to that snapshot
 * (POST /breeze/TestDb/Reset). It goes over HTTP rather than sqlcmd because in browser mode
 * this runs in Chromium.
 *
 * Listed in setupFiles, so it runs once per spec file. Unit specs share some configs with
 * the integration specs (`npm test`, `npm run test:browser`); they touch no database and
 * skip the reset.
 */
// The first argument must be a destructuring pattern: Vitest parses it for fixtures.
beforeAll(async ({}, file) => {
  const path = ('filepath' in file ? file.filepath : file.file.filepath).replace(/\\/g, '/');
  if (path.includes('/test/unit/')) {
    return;
  }

  const server = inject('breezeTestServer');
  let res: Response;
  try {
    res = await fetch(`${server}/breeze/TestDb/Reset`, { method: 'POST' });
  } catch (e: any) {
    throw new Error(`[db-reset] could not reach the test server at ${server}: ${e?.message ?? e}`);
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `[db-reset] POST ${server}/breeze/TestDb/Reset returned ${res.status}` +
        (res.status === 404
          ? '. The test server must be started with --TestDb:AllowReset=true (scripts/test-with-server.ps1 does this).'
          : `: ${detail}`),
    );
  }
});
