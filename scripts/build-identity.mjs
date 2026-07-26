import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PRICING_PATH = path.join(ROOT, 'data', 'pricing.json');
const BUILD_PATH = path.join(ROOT, 'build.json');
const CHECK_MODE = process.argv.includes('--check');

async function htmlFiles() {
  const rootEntries = await readdir(ROOT, { withFileTypes: true });
  const files = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(ROOT, entry.name));

  const docsDir = path.join(ROOT, 'docs');
  try {
    const docsEntries = await readdir(docsDir, { withFileTypes: true });
    for (const entry of docsEntries) {
      if (entry.isFile() && entry.name.endsWith('.html')) {
        files.push(path.join(docsDir, entry.name));
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return files.sort();
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function utcTimestamp() {
  return execFileSync('date', ['-u', '+%Y-%m-%dT%H:%M:%SZ'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

function desiredHtml(content, buildToken) {
  const buildMeta = `  <meta name="osl-build" content="${buildToken}">`;
  let next = content;
  let seenBuildMeta = false;

  next = next.replace(/^[ \t]*<meta\b(?=[^>]*\bname=["']osl-build["'])[^>]*>[ \t]*(?:\r?\n)?/gim, () => {
    if (seenBuildMeta) return '';
    seenBuildMeta = true;
    return `${buildMeta}\n`;
  });

  if (!seenBuildMeta) {
    const viewportLineRe = /^([ \t]*<meta\s+name=["']viewport["'][^>]*>[ \t]*)$/im;
    if (!viewportLineRe.test(next)) {
      throw new Error('missing viewport meta');
    }
    next = next.replace(viewportLineRe, `$1\n${buildMeta}`);
  }

  return next.replace(/<(script|link)\b[^>]*>/gi, (tag) => tag.replace(/\?v=[A-Za-z0-9._-]+/g, `?v=${buildToken.replace(/-dirty$/, '')}`));
}

const pricing = JSON.parse(await readFile(PRICING_PATH, 'utf8'));
const commit = git(['rev-parse', 'HEAD']);
const shortCommit = commit.slice(0, 8);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const dirty = git(['status', '--porcelain']).length > 0;
const builtAt = utcTimestamp();
const buildToken = `${shortCommit}${dirty ? '-dirty' : ''}`;
const buildObject = {
  commit,
  short_commit: shortCommit,
  branch,
  dirty,
  built_at: builtAt,
  manifest_version: pricing.manifest_version,
};
const buildJson = `${JSON.stringify(buildObject, null, 2)}\n`;
const mismatches = [];
let htmlUpdated = 0;

let currentBuildJson = '';
try {
  currentBuildJson = await readFile(BUILD_PATH, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let buildJsonMatches = currentBuildJson === buildJson;
if (CHECK_MODE && !buildJsonMatches && currentBuildJson) {
  try {
    const currentBuildObject = JSON.parse(currentBuildJson);
    buildJsonMatches =
      currentBuildObject.commit === commit &&
      currentBuildObject.short_commit === shortCommit &&
      currentBuildObject.branch === branch &&
      currentBuildObject.dirty === dirty &&
      currentBuildObject.manifest_version === pricing.manifest_version &&
      typeof currentBuildObject.built_at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(currentBuildObject.built_at);
  } catch {
    buildJsonMatches = false;
  }
}

if (!buildJsonMatches) {
  mismatches.push('build.json');
  if (!CHECK_MODE) {
    await writeFile(BUILD_PATH, buildJson);
  }
}

const files = await htmlFiles();
for (const file of files) {
  const original = await readFile(file, 'utf8');
  let next;
  try {
    next = desiredHtml(original, buildToken);
  } catch (error) {
    console.error(`${rel(file)}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }

  if (next !== original) {
    htmlUpdated += 1;
    mismatches.push(rel(file));
    if (!CHECK_MODE) {
      await writeFile(file, next);
    }
  }
}

console.log(`build-identity: commit ${shortCommit} on ${branch}${dirty ? ' (dirty)' : ''}.`);
console.log(`build-identity: ${CHECK_MODE ? 'checked' : 'wrote'} build.json and ${CHECK_MODE ? 'found' : 'updated'} ${htmlUpdated} HTML files out of ${files.length}.`);

if (CHECK_MODE && mismatches.length > 0) {
  console.error('Build identity drift:');
  for (const item of mismatches) console.error(`  ${item}`);
  process.exit(1);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
