import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireDbLock, readHolder, releaseDbLock } from '../support/db-lock';

// The lock that keeps two test runs off the shared database at once - see
// test/support/db-lock.ts for why a collision is worth refusing outright. Real processes, not
// mocks: "is its owner still running" is the whole question.

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'db-lock-'));
  lock = join(dir, 'breeze-test-TestDb.lock');
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A pid that was a real process a moment ago and is not one now. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid!;
}

function heldBy(pid: number) {
  writeFileSync(lock, JSON.stringify({ pid, startedAt: new Date().toISOString(), command: 'vitest run --config vitest.integration.config.ts' }));
}

describe('the test database lock', () => {

  test('is taken when free, and names this process', () => {
    acquireDbLock(lock, 'TestDb', 'vitest run');

    expect(readHolder(lock)!.pid).toBe(process.pid);
    expect(readHolder(lock)!.command).toBe('vitest run');
  });

  test('taking it again from the same process does nothing - browser mode has several projects', () => {
    acquireDbLock(lock, 'TestDb', 'first project');
    expect(() => acquireDbLock(lock, 'TestDb', 'second project')).not.toThrow();

    expect(readHolder(lock)!.command).toBe('first project');
  });

  test('held by a run still going, it refuses - saying who, and what to do', () => {
    heldBy(process.ppid);                  // the process that started this one: certainly alive

    let message = '';
    try { acquireDbLock(lock, 'TestDb', 'vitest run'); } catch (e: any) { message = e.message; }

    expect(message).toContain(`another test run is using TestDb: pid ${process.ppid}`);
    expect(message).toContain('vitest run --config vitest.integration.config.ts');
    expect(message).toContain(lock);       // the way out, if that run is not really there
    expect(readHolder(lock)!.pid).toBe(process.ppid);   // and the other run keeps it
  });

  test('left behind by a run that was killed, it is taken over', () => {
    const pid = deadPid();
    heldBy(pid);

    acquireDbLock(lock, 'TestDb', 'vitest run');

    expect(readHolder(lock)!.pid).toBe(process.pid);
  });

  test('releasing removes it only if this process holds it', () => {
    heldBy(process.ppid);
    releaseDbLock(lock);
    expect(existsSync(lock)).toBe(true);   // someone else's: untouched

    rmSync(lock);
    acquireDbLock(lock, 'TestDb', 'vitest run');
    releaseDbLock(lock);
    expect(existsSync(lock)).toBe(false);
  });

  test('leaves no draft file behind, taken or refused', () => {
    acquireDbLock(lock, 'TestDb', 'vitest run');
    rmSync(lock);
    heldBy(process.ppid);
    expect(() => acquireDbLock(lock, 'TestDb', 'vitest run')).toThrow();

    const leftovers = readdirSync(dir).filter(f => f.endsWith('.draft'));
    expect(leftovers).toEqual([]);
  });
});
