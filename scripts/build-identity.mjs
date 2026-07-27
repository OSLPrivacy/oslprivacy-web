import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  hasSemanticBuildMeta,
  insertExactBuildMeta,
  requireExactBuildMeta,
} from './html-build-meta.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;
const COMMIT_QUERY_RE = /\?v=[0-9a-f]{8,40}(?:-dirty)?/gi;
const STATIC_ROOT_FILES = new Set(['_headers', '_redirects', 'robots.txt']);
const CONTROL_OUTPUT_FILES = new Set(['_headers', '_redirects']);
const DEPLOY_CONTROL_INPUTS = [
  '.assetsignore',
  '_headers',
  '_redirects',
  'data/pricing.json',
  'wrangler.jsonc',
];

function argValue(name) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const ROOT = path.resolve(argValue('--root') ?? process.cwd());
const OUT = path.resolve(argValue('--out') ?? path.join(ROOT, 'dist'));
const CHECK_SOURCE = process.argv.includes('--check-source');
const VERIFY_ARTIFACT = process.argv.includes('--verify-artifact');

function fail(message) {
  throw new Error(message);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function gitRaw(args) {
  return execFileSync('git', args, { cwd: ROOT });
}

function rel(file, base = ROOT) {
  return path.relative(base, file).replaceAll(path.sep, '/');
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function walkedFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkedFiles(root, full));
    else files.push(full);
  }
  return files.sort();
}

async function artifactLeafFiles() {
  const excluded = new Set(['build.json']);
  const leaves = (await walkedFiles(OUT)).filter((file) => {
    const relative = rel(file, OUT);
    return !excluded.has(relative);
  });
  for (const file of leaves) {
    if (!(await lstat(file)).isFile()) {
      fail(`deploy artifact contains a non-regular output leaf: ${rel(file, OUT)}`);
    }
  }
  return leaves;
}

function isServedArtifact(file) {
  const name = rel(file, OUT);
  return !CONTROL_OUTPUT_FILES.has(name)
    && !name.split('/').some((part) => part.startsWith('.'));
}

async function servedArtifactFiles() {
  return (await artifactLeafFiles()).filter(isServedArtifact);
}

async function artifactHtmlFiles() {
  return (await servedArtifactFiles()).filter((file) => file.toLowerCase().endsWith('.html'));
}

async function fileDigests(files) {
  const entries = [];
  for (const file of files) {
    entries.push([rel(file, OUT), sha256(await readFile(file))]);
  }
  return Object.fromEntries(entries);
}

function trackedStaticFiles() {
  return gitRaw(['ls-files', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((name) => (
      (/^[^/]+\.html$/.test(name)) ||
      (/^docs\/.+\.html$/.test(name)) ||
      (/^assets\/.+/.test(name)) ||
      STATIC_ROOT_FILES.has(name)
    ))
    .sort();
}

async function publishableFilesystemFiles() {
  const files = [];
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.html') || STATIC_ROOT_FILES.has(entry.name))) {
      files.push(path.join(ROOT, entry.name));
    }
  }
  for (const directory of ['assets', 'docs']) {
    const root = path.join(ROOT, directory);
    if (!(await exists(root))) continue;
    for (const file of await walkedFiles(root)) {
      if (directory === 'assets' || file.toLowerCase().endsWith('.html')) files.push(file);
    }
  }
  return files.sort();
}

async function publishableSourceErrors() {
  const tracked = new Set(trackedStaticFiles());
  const errors = [];
  for (const file of await publishableFilesystemFiles()) {
    const name = rel(file);
    if (!tracked.has(name)) {
      errors.push(`${name} is an untracked or ignored byte inside a publishable source root`);
    }
  }
  return errors;
}

function committedBytes(name) {
  return gitRaw(['show', `HEAD:${name}`]);
}

function sourceHtml(content) {
  return content.replace(COMMIT_QUERY_RE, '');
}

function artifactHtml(content, commit) {
  const shortCommit = commit.slice(0, 8);
  const withMeta = insertExactBuildMeta(sourceHtml(content), commit);
  return withMeta.replace(
    /<(script|link)\b[^>]*>/gi,
    (tag) => tag.replace(
      /((?:src|href)=["']\/assets\/[^"'?#]+)(?:\?[^"']*)?(["'])/gi,
      `$1?v=${shortCommit}$2`,
    ),
  );
}

async function sourceIdentityErrors() {
  const errors = [];
  if (await exists(path.join(ROOT, 'build.json'))) {
    errors.push('build.json is tracked/source-local; it must exist only in the deploy artifact');
  }
  for (const name of trackedStaticFiles().filter((file) => file.toLowerCase().endsWith('.html'))) {
    const content = committedBytes(name).toString('utf8');
    if (hasSemanticBuildMeta(content)) {
      errors.push(`${name} contains a semantic osl-build meta stamp`);
    }
    if (COMMIT_QUERY_RE.test(content)) {
      errors.push(`${name} contains a commit-shaped asset cache token`);
    }
    COMMIT_QUERY_RE.lastIndex = 0;
  }
  return errors;
}

function deployControlInputDigests() {
  return Object.fromEntries(DEPLOY_CONTROL_INPUTS.map((name) => [
    name,
    sha256(committedBytes(name)),
  ]));
}

function requireDeployControlSemantics() {
  let wrangler;
  try {
    wrangler = JSON.parse(committedBytes('wrangler.jsonc').toString('utf8'));
  } catch (error) {
    fail(`committed wrangler.jsonc is not strict JSON: ${error.message}`);
  }
  if (wrangler.pages_build_output_dir !== './dist') {
    fail('committed wrangler.jsonc must set pages_build_output_dir to ./dist');
  }
}

function deploymentContract() {
  const expectedCommit = envValue('CF_PAGES_COMMIT_SHA');
  const deploymentEnvironment = envValue('OSL_DEPLOY_ENVIRONMENT');
  const deploymentBranch = envValue('CF_PAGES_BRANCH');
  if (!expectedCommit) fail('missing Cloudflare deploy SHA: CF_PAGES_COMMIT_SHA is required');
  if (!SHA_RE.test(expectedCommit)) fail('deploy SHA must be the full 40-character lowercase Git commit');
  if (!deploymentEnvironment) fail('missing deploy environment: set OSL_DEPLOY_ENVIRONMENT');
  if (!['production', 'preview'].includes(deploymentEnvironment)) {
    fail('OSL_DEPLOY_ENVIRONMENT must be production or preview');
  }
  if (!deploymentBranch) fail('missing Cloudflare deploy branch: CF_PAGES_BRANCH is required');
  if (deploymentEnvironment === 'production' && deploymentBranch !== 'main') {
    fail(`production deploys must identify branch main, got ${deploymentBranch}`);
  }
  if (deploymentBranch === 'main' && deploymentEnvironment !== 'production') {
    fail('the main branch must identify the production environment');
  }

  const head = git(['rev-parse', 'HEAD']).toLowerCase();
  if (head !== expectedCommit) {
    fail(`deploy SHA mismatch: environment says ${expectedCommit}, checkout HEAD is ${head}`);
  }
  const checkoutBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (checkoutBranch !== 'HEAD' && checkoutBranch !== deploymentBranch) {
    fail(`deploy branch mismatch: environment says ${deploymentBranch}, checkout is ${checkoutBranch}`);
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=all']).length > 0;
  if (dirty) fail('deploy checkout is dirty');

  return { expectedCommit, deploymentEnvironment, deploymentBranch };
}

function assertSafeOutput() {
  const required = path.join(ROOT, 'dist');
  if (OUT !== required) {
    fail(`deploy output must be exactly ${required}`);
  }
}

async function copyStaticSource() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  for (const name of trackedStaticFiles()) {
    const destination = path.join(OUT, name);
    await mkdir(path.dirname(destination), { recursive: true });
    const bytes = committedBytes(name);
    await writeFile(destination, name.endsWith('.html') ? sourceHtml(bytes.toString('utf8')) : bytes);
  }
}

async function verifyArtifact(expected) {
  const buildPath = path.join(OUT, 'build.json');
  let build;
  try {
    build = JSON.parse(await readFile(buildPath, 'utf8'));
  } catch (error) {
    fail(`invalid or missing deploy artifact build.json: ${error.message}`);
  }
  const required = {
    schema_version: 2,
    commit: expected.expectedCommit,
    short_commit: expected.expectedCommit.slice(0, 8),
    branch: expected.deploymentBranch,
    environment: expected.deploymentEnvironment,
    dirty: false,
  };
  for (const [key, value] of Object.entries(required)) {
    if (build[key] !== value) fail(`deploy artifact build.json ${key} mismatch`);
  }
  if (!Number.isInteger(build.manifest_version) || build.manifest_version < 1) {
    fail('deploy artifact build.json manifest_version is missing or invalid');
  }
  if (typeof build.built_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(build.built_at)) {
    fail('deploy artifact build.json built_at is missing or invalid');
  }
  if (!build.files || typeof build.files !== 'object' || Array.isArray(build.files)) {
    fail('deploy artifact build.json files manifest is missing or invalid');
  }
  if (!build.artifact_files || typeof build.artifact_files !== 'object' || Array.isArray(build.artifact_files)) {
    fail('deploy artifact build.json artifact_files manifest is missing or invalid');
  }
  if (!build.inputs || typeof build.inputs !== 'object' || Array.isArray(build.inputs)) {
    fail('deploy artifact build.json input manifest is missing or invalid');
  }
  const expectedInputs = deployControlInputDigests();
  if (JSON.stringify(build.inputs) !== JSON.stringify(expectedInputs)) {
    fail('deploy artifact build.json control inputs mismatch');
  }
  for (const control of CONTROL_OUTPUT_FILES) {
    if (build.artifact_files[control] !== expectedInputs[control]) {
      fail(`deploy artifact does not byte-bind ${control} to its committed control input`);
    }
  }

  const files = await artifactHtmlFiles();
  if (files.length === 0) fail('deploy artifact contains no HTML');
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    requireExactBuildMeta(content, expected.expectedCommit, rel(file, OUT));
    if (content.includes('-dirty')) fail(`${rel(file, OUT)} contains a dirty build stamp`);
    for (const tag of content.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const localAsset = tag[0].match(/(?:src|href)=["'](\/assets\/[^"']+)["']/i)?.[1];
      if (localAsset && !localAsset.endsWith(`?v=${expected.expectedCommit.slice(0, 8)}`)) {
        fail(`${rel(file, OUT)} contains a stale asset cache token`);
      }
    }
  }

  const artifactFiles = await artifactLeafFiles();
  const artifactNames = artifactFiles.map((file) => rel(file, OUT));
  const artifactManifestNames = Object.keys(build.artifact_files).sort();
  if (JSON.stringify(artifactNames) !== JSON.stringify(artifactManifestNames)) {
    fail('deploy artifact artifact_files manifest does not exactly cover every output leaf');
  }
  for (const file of artifactFiles) {
    const name = rel(file, OUT);
    const digest = sha256(await readFile(file));
    if (build.artifact_files[name] !== digest) fail(`deploy artifact leaf digest mismatch: ${name}`);
  }

  const servedFiles = await servedArtifactFiles();
  const servedNames = servedFiles.map((file) => rel(file, OUT));
  const servedManifestNames = Object.keys(build.files).sort();
  if (JSON.stringify(servedNames) !== JSON.stringify(servedManifestNames)) {
    fail('deploy artifact files manifest does not exactly cover every served leaf');
  }
  for (const file of servedFiles) {
    const name = rel(file, OUT);
    const digest = sha256(await readFile(file));
    if (build.files[name] !== digest) fail(`deploy artifact served digest mismatch: ${name}`);
  }
  return { build, htmlCount: files.length };
}

async function run() {
  assertSafeOutput();

  const sourceErrors = [
    ...await sourceIdentityErrors(),
    ...await publishableSourceErrors(),
  ];
  if (sourceErrors.length > 0) {
    for (const error of sourceErrors) console.error(`build-identity source refusal: ${error}`);
    process.exit(1);
  }
  requireDeployControlSemantics();
  if (CHECK_SOURCE) {
    console.log('build-identity: source contains no self-referential build identity.');
    return;
  }

  const expected = deploymentContract();
  if (VERIFY_ARTIFACT) {
    const { htmlCount } = await verifyArtifact(expected);
    console.log(`build-identity: verified ${htmlCount} HTML files for ${expected.expectedCommit} (${expected.deploymentEnvironment}).`);
    return;
  }

  const pricing = JSON.parse(await readFile(path.join(ROOT, 'data', 'pricing.json'), 'utf8'));
  await copyStaticSource();
  for (const file of await artifactHtmlFiles()) {
    await writeFile(file, artifactHtml(await readFile(file, 'utf8'), expected.expectedCommit));
  }
  const buildObject = {
    schema_version: 2,
    commit: expected.expectedCommit,
    short_commit: expected.expectedCommit.slice(0, 8),
    branch: expected.deploymentBranch,
    environment: expected.deploymentEnvironment,
    dirty: false,
    built_at: new Date().toISOString(),
    manifest_version: pricing.manifest_version,
    inputs: deployControlInputDigests(),
    artifact_files: await fileDigests(await artifactLeafFiles()),
    files: await fileDigests(await servedArtifactFiles()),
  };
  await writeFile(path.join(OUT, 'build.json'), `${JSON.stringify(buildObject, null, 2)}\n`);
  const { htmlCount } = await verifyArtifact(expected);
  console.log(`build-identity: built and verified ${htmlCount} HTML files for ${expected.expectedCommit} (${expected.deploymentEnvironment}).`);
}

run().catch((error) => {
  console.error(`build-identity: ${error.message}`);
  process.exit(1);
});
