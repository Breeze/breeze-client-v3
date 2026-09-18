// @ts-check
/**
 * Builds the docs site and publishes it to the gh-pages branch, which GitHub Pages serves at
 * https://breeze.github.io/breeze-client-v3/ (Settings -> Pages -> Deploy from a branch ->
 * gh-pages, / (root)).
 *
 *   npm run docs:publish                build, commit to gh-pages, push
 *   npm run docs:publish -- --no-push   build and commit, but leave the push to you
 *   npm run docs:publish -- --force     publish even if gh-pages was built from this commit
 *
 * gh-pages holds nothing but the built site. It is checked out in a temporary worktree, so the
 * branch you are on and your working copy are never touched. Each publish is one commit on
 * gh-pages that names the commit it was built from - which is why a working copy with
 * uncommitted changes is refused: the site would not match any commit.
 *
 * "Already published" is decided by that commit, not by comparing files: VitePress writes its
 * search index in the order pages finish rendering, so two builds of the same source differ.
 */
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRANCH = 'gh-pages';
const REMOTE_BRANCH = `origin/${BRANCH}`;
const BASE = '/breeze-client-v3/';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'docs', '.vitepress', 'dist');
const push = !process.argv.includes('--no-push');
const force = process.argv.includes('--force');

/** @param {string[]} args @param {string} [cwd] */
function git(args, cwd = repoRoot) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** @param {string[]} args */
function gitSucceeds(args) {
  try { execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' }); return true; } catch { return false; }
}

/** @param {string} message */
function fail(message) {
  console.error(`publish-docs: ${message}`);
  process.exit(1);
}

/** @param {string} message */
const say = message => console.log(`publish-docs: ${message}`);

if (git(['status', '--porcelain'])) {
  fail('the working copy has uncommitted changes. Commit or stash them, so the published site matches a commit.');
}
const source = git(['rev-parse', 'HEAD']);
const short = source.slice(0, 7);

// Bring local gh-pages level with the remote one, so this publish goes on top of whatever was
// published last, from here or anywhere else.
const onRemote = git(['ls-remote', '--heads', 'origin', BRANCH]) !== '';
if (onRemote) git(['fetch', '--quiet', 'origin', BRANCH]);
const local = git(['branch', '--list', BRANCH]) !== '';
if (onRemote && !local) {
  git(['branch', '--quiet', BRANCH, REMOTE_BRANCH]);
} else if (onRemote && local) {
  if (gitSucceeds(['merge-base', '--is-ancestor', BRANCH, REMOTE_BRANCH])) {
    git(['branch', '--quiet', '--force', BRANCH, REMOTE_BRANCH]);   // behind: fast-forward
  } else if (!gitSucceeds(['merge-base', '--is-ancestor', REMOTE_BRANCH, BRANCH])) {
    fail(`local ${BRANCH} and ${REMOTE_BRANCH} have diverged. Delete the local one (git branch -D ${BRANCH}) and run this again.`);
  }                                                                  // ahead: unpushed publishes, keep them
}
const exists = onRemote || local;

/** Whether local gh-pages has commits the remote does not. */
const unpushed = () => exists && (!onRemote || git(['rev-list', '--count', `${REMOTE_BRANCH}..${BRANCH}`]) !== '0');

function pushIfAsked() {
  if (push) {
    git(['push', '--quiet', 'origin', BRANCH]);
    say(`pushed ${BRANCH}. GitHub Pages updates in a minute or so.`);
  } else {
    say(`${BRANCH} is committed but not pushed. Push it with: git push origin ${BRANCH}`);
  }
}

if (exists && !force && git(['log', '-1', '--format=%B', BRANCH]).includes(source)) {
  say(`${BRANCH} was already built from ${short}.`);
  if (unpushed()) pushIfAsked();
  else say('Nothing to publish. Use --force to rebuild and publish it again.');
  process.exit(0);
}

// Build with the Pages base. The anchor check runs as part of docs:build, so a broken link stops
// the publish here.
say(`building ${short} for ${BASE}`);
execSync('npm run docs:build', { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, DOCS_BASE: BASE } });

const worktree = mkdtempSync(join(tmpdir(), 'breeze-gh-pages-'));
/** Git in the gh-pages worktree: the site is committed exactly as built, whatever core.autocrlf says. */
const pagesGit = (/** @type {string[]} */ args) =>
  git(['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], worktree);
try {
  git(exists ? ['worktree', 'add', '--quiet', worktree, BRANCH] : ['worktree', 'add', '--quiet', '--orphan', '-b', BRANCH, worktree]);

  // Replace everything but .git with the new build.
  for (const entry of readdirSync(worktree)) {
    if (entry !== '.git') rmSync(join(worktree, entry), { recursive: true, force: true });
  }
  cpSync(distDir, worktree, { recursive: true });
  // Without this, Pages runs the site through Jekyll, which drops files whose names start with an
  // underscore - and some of VitePress's scripts do.
  writeFileSync(join(worktree, '.nojekyll'), '');

  pagesGit(['add', '--all']);
  pagesGit(['commit', '--quiet', '--allow-empty', '-m', `Publish docs from ${short}`, '-m', `Built from ${source}`]);
  say(`committed the site built from ${short} to ${BRANCH}.`);
} finally {
  git(['worktree', 'remove', '--force', worktree]);
  if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
}
pushIfAsked();
