import v8 from 'node:v8';
import vm from 'node:vm';

/**
 * Helpers for the retention tier.
 *
 * Two tools, and they answer different questions:
 *
 * - `isReleased` asks the garbage collector whether an object survived a full collection. That is
 *   the assertion, because the collector sees every reference there is.
 * - `pathsTo` walks an object graph and reports how a target is reached. That is the diagnosis,
 *   for when `isReleased` says something is held and you need to know by what.
 *
 * Do not use `pathsTo` as the assertion. It only sees what its walk reaches, and the first version
 * of it written for this repo skipped `entityType` as "shared metadata, not the suspect" - which
 * is exactly where the leak it was looking for turned out to be. The collector has no skip list.
 */

/**
 * A full collection, however this process can get one.
 *
 * `--expose-gc` on the command line does not reach a Vitest worker - the pool forks its children
 * and they do not inherit it - so this asks V8 for the function directly. That works in any Node
 * process and leaves the flag off afterwards.
 */
const forceGc: () => void = (() => {
  if (typeof (globalThis as any).gc === 'function') return (globalThis as any).gc;
  v8.setFlagsFromString('--expose_gc');
  const fn = vm.runInNewContext('gc') as () => void;
  v8.setFlagsFromString('--no-expose_gc');   // put it back; only this reference keeps the power
  return fn;
})();

/** Let pending jobs finish, then collect. A WeakRef is not cleared while its own job is live. */
export async function collect(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    forceGc();
  }
}

/**
 * True if nothing reaches the object any more.
 *
 * `make` must return a WeakRef and keep no other reference to its subject - not in a closure it
 * returns, not on an object the caller holds. Anything a local variable in the calling frame still
 * points at can stay alive, which reads as a leak that is not there.
 */
export async function isReleased(make: () => WeakRef<object>): Promise<boolean> {
  const ref = make();
  await collect();
  return ref.deref() === undefined;
}

/** Every path from `root` that reaches `target`, for diagnosis. Walks everything; skips nothing. */
export function pathsTo(root: object, target: object,
    { maxDepth = 14, limit = 40 }: { maxDepth?: number, limit?: number } = {}): string[] {
  const seen = new Set<object>();
  const found: string[] = [];

  (function walk(node: any, path: string, depth: number) {
    if (found.length >= limit || depth > maxDepth || node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    const entries: [string, any][] =
      node instanceof Map ? [...node.entries()].map(([k, v]) => [`get(${String(k).slice(0, 40)})`, v])
        : node instanceof Set ? [...node].map((v, i) => [`set[${i}]`, v])
          : Array.isArray(node) ? node.map((v, i) => [`[${i}]`, v] as [string, any])
            : Object.keys(node).map(k => [k, node[k]] as [string, any]);

    for (const [key, value] of entries) {
      if (value === target) { found.push(`${path}.${key}`); continue; }
      walk(value, `${path}.${key}`, depth + 1);
    }
  })(root, 'root', 0);

  return found;
}
