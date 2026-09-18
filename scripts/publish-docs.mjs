// @ts-check
/**
 * Builds the docs site and publishes it to the gh-pages branch, which GitHub Pages serves at
 * https://breeze.github.io/breeze-client-v3/ (Settings -> Pages -> Deploy from a branch ->
 * gh-pages, / (root)).
 *
 *   npm run docs:publish               build, commit to gh-pages, push
 *   npm run docs:publish -- --no-push  build and commit, but leave the push to you
 *
 * gh-pages holds nothing but the built site. It is checked out in a temporary worktree, so the
 * branch you are on and your working copy are never touched. Each publish is one commit on
 * gh-pages, named after the master commit it was built from - which is why a working copy with
 * uncommitted changes is refused: the site would not match any commit.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRANCH = 'gh-pages';
const BASE = '/breeze-client-v3/';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'docs', '.vitepress', 'dist');
const push = !process.argv.includes('--no-push');

/** @param {string[]} args @param {string} [cwd] */
function git(args, cwd = repoRoot) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** @param {string} message */
function fail(message) {
  console.error(`publish-docs: ${message}`);
  process.exit(1);
}

if (git(['status', '--porcelain'])) {
  fail('the working copy has uncommitted changes. Commit or stash them, so the published site matches a commit.');
}
const commit = git(['rev-parse', '--short', 'HEAD']);

// Build with the Pages base. The anchor check runs as part of docs:build, so a broken link stops
// the publish here.
console.log(`publish-docs: building ${commit} for ${BASE}`);
execFileSync('npm', ['run', 'docs:build'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',   // npm is npm.cmd on Windows
  env: { ...process.env, DOCS_BASE: BASE },
});

// Pick up a gh-pages someone else published, so this publish goes on top of it.
const onRemote = git(['ls-remote', '--heads', 'origin', BRANCH]) !== '';
if (onRemote) git(['fetch', 'origin', `${BRANCH}:${BRANCH}`]);
const exists = onRemote || git(['branch', '--list', BRANCH]) !== '';

const worktree = mkdtempSync(join(tmpdir(), 'breeze-gh-pages-'));
try {
  git(exists ? ['worktree', 'add', worktree, BRANCH] : ['worktree', 'add', '--orphan', '-b', BRANCH, worktree]);

  // Replace everything but .git with the new build.
  for (const entry of readdirSync(worktree)) {
    if (entry !== '.git') rmSync(join(worktree, entry), { recursive: true, force: true });
  }
  cpSync(distDir, worktree, { recursive: true });
  // Without this, Pages runs the site through Jekyll, which drops files whose names start with an
  // underscore - and some of VitePress's scripts do.
  writeFileSync(join(worktree, '.nojekyll'), '');

  git(['add', '--all'], worktree);
  if (!git(['status', '--porcelain'], worktree)) {
    console.log(`publish-docs: ${BRANCH} already holds this build; nothing to publish.`);
  } else {
    git(['commit', '--quiet', '-m', `Publish docs from ${commit}`], worktree);
    if (push) {
      git(['push', 'origin', BRANCH], worktree);
      console.log(`publish-docs: pushed ${BRANCH}. GitHub Pages updates in a minute or so.`);
    } else {
      console.log(`publish-docs: committed to ${BRANCH}, not pushed. Push it with: git push origin ${BRANCH}`);
    }
  }
} finally {
  git(['worktree', 'remove', '--force', worktree]);
  if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
}
