// @ts-check
/**
 * Fails the docs build on a link to an anchor that does not exist.
 *
 * VitePress checks that the *page* on the other side of a link exists, but not the `#anchor`
 * after it. So a heading can be renamed and every link into it goes quietly stale - which is
 * how three links to `#default-adapters` survived a rename to "Adapters and transport".
 *
 * This runs after `vitepress build` and checks the markdown against what the build actually
 * emitted: every `id=` in the generated HTML, rather than a guess at how VitePress slugifies
 * a heading. That also covers the API reference, whose anchors TypeDoc generates.
 *
 * Run by `npm run docs:build`, or on its own with `npm run docs:check-anchors` (after a build).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(repoRoot, 'docs');
const distDir = join(docsDir, '.vitepress', 'dist');

if (!existsSync(distDir)) {
  console.error('check-doc-anchors: no build to check. Run `npm run docs:build` first.');
  process.exit(1);
}

/** Every file under a directory, recursively. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Site path -> the ids the built page carries. `/guide/querying`, `/api/`, ... */
const idsByPage = new Map();
for (const file of walk(distDir)) {
  if (!file.endsWith('.html')) continue;
  const html = readFileSync(file, 'utf8');
  const page = '/' + relative(distDir, file).split(/[\\/]/).join('/')
    .replace(/\.html$/, '')
    .replace(/(^|\/)index$/, '$1');
  idsByPage.set(page, new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])));
}

/** Markdown outside fenced code blocks - a link in a sample is not a link. */
function withoutCodeFences(md) {
  return md.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '');
}

const problems = [];
let checked = 0;

for (const file of walk(docsDir)) {
  if (!file.endsWith('.md')) continue;
  if (relative(docsDir, file).split(/[\\/]/)[0] === '.vitepress') continue;

  const selfPage = '/' + relative(docsDir, file).split(/[\\/]/).join('/')
    .replace(/\.md$/, '')
    .replace(/(^|\/)index$/, '$1');
  const md = withoutCodeFences(readFileSync(file, 'utf8'));

  for (const m of md.matchAll(/\]\(([^)\s]*)#([^)\s]+)\)/g)) {
    const [link, target, anchor] = m;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;   // http:, mailto:, ... - not ours to check

    const page = !target ? selfPage
      : target.startsWith('/') ? target.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')
      : posix.normalize(posix.join(posix.dirname(selfPage), target))
          .replace(/\.md$/, '').replace(/(^|\/)index$/, '$1');

    checked++;
    const ids = idsByPage.get(page) ?? idsByPage.get(page.replace(/\/$/, ''));
    const where = relative(repoRoot, file).split(/[\\/]/).join('/');
    if (!ids) problems.push(`${where}: ${link} - no such page (${page})`);
    else if (!ids.has(decodeURIComponent(anchor))) {
      problems.push(`${where}: ${link} - ${page} has no anchor #${anchor}`);
    }
  }
}

if (problems.length) {
  console.error(`check-doc-anchors: ${problems.length} broken anchor link(s) of ${checked}:`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nThe heading was probably renamed. Anchors come from the built HTML, so check\n' +
                'the target page for the id it actually emits.');
  process.exit(1);
}

console.log(`check-doc-anchors: ${checked} anchor links, all resolve.`);
