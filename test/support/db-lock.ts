import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * One test run at a time against the shared test database.
 *
 * Every run of the integration or browser tier drops and rebuilds BreezeTestDb before it starts,
 * and reverts it before every spec file. Two runs at once rebuild it underneath each other, and
 * what that produces looks like real bugs rather than a collision: spec files failing in their
 * setup with most of their tests skipped, `[db-reset] inheritance seed returned 500`, foreign-key
 * conflicts from rows the other run deleted. So a run takes this lock first, and a second run
 * stops at once and says who has it.
 *
 * The lock is a file holding the owner's pid, released when that process exits. A run killed
 * hard cannot release it, so a lock whose process is gone is taken over rather than obeyed.
 */

export interface LockHolder {
  pid: number;
  startedAt: string;
  command: string;
}

/**
 * Take the lock at `path` for this process, or throw naming the run that holds it.
 *
 * Taking it again from the same process does nothing: browser mode runs globalSetup once per
 * project, in one process.
 */
export function acquireDbLock(path: string, dbName: string, command: string): void {
  const mine: LockHolder = { pid: process.pid, startedAt: new Date().toISOString(), command };
  // Written in full to a file of our own, then hard-linked into place. The link either creates
  // the lock complete or fails because one exists - so no run can read a lock that is half written
  // and mistake it for an abandoned one.
  const draft = `${path}.${process.pid}.draft`;
  writeFileSync(draft, JSON.stringify(mine));
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(draft, path);
        process.once('exit', () => releaseDbLock(path));
        return;
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
      }

      const holder = readHolder(path);
      if (holder && holder.pid === process.pid) return;
      if (holder && isAlive(holder.pid)) throw new Error(busyMessage(path, dbName, holder));

      // Abandoned: its process is gone. Take it over - unless another run has already done so
      // since we read it, in which case the next pass round the loop sees that run instead.
      const again = readHolder(path);
      if (again && holder && (again.pid !== holder.pid || again.startedAt !== holder.startedAt)) continue;
      try { unlinkSync(path); } catch { /* already gone */ }
    }
    throw new Error(`[db-lock] could not take ${path}: it kept changing hands`);
  } finally {
    try { unlinkSync(draft); } catch { /* nothing to tidy */ }
  }
}

/** Release the lock, if this process holds it. Anyone else's is left alone. */
export function releaseDbLock(path: string): void {
  const holder = readHolder(path);
  if (holder && holder.pid === process.pid) {
    try { unlinkSync(path); } catch { /* already gone */ }
  }
}

export function readHolder(path: string): LockHolder | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);          // signal 0 tests for the process without touching it
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';     // it exists, we just may not signal it
  }
}

function busyMessage(path: string, dbName: string, holder: LockHolder): string {
  const since = new Date(holder.startedAt).toLocaleTimeString();
  return (
    `[db-lock] another test run is using ${dbName}: pid ${holder.pid}, since ${since}\n` +
    `          (${holder.command}).\n` +
    `          Two runs rebuild the one database underneath each other, and the failures look like\n` +
    `          real bugs. Wait for that run to finish. If there is no such run, delete\n` +
    `          ${path}`
  );
}
