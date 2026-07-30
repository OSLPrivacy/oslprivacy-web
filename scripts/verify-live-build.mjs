import { createHash } from 'node:crypto';
import { requireExactBuildMeta } from './html-build-meta.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;
const EXPECTED_INPUTS = [
  '.assetsignore',
  '_headers',
  '_redirects',
  'data/at-rest-census.json',
  'data/pricing.json',
  'data/public-surface-manifest.json',
  'wrangler.jsonc',
];
const FORBIDDEN_MANIFEST_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function argValue(name) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function fail(message) {
  throw new Error(message);
}

const baseUrl = argValue('--url');
const expectedCommit = (
  argValue('--sha') ||
  process.env.CF_PAGES_COMMIT_SHA ||
  ''
);
const expectedEnvironment = argValue('--environment') || process.env.OSL_DEPLOY_ENVIRONMENT || '';
const expectedBranch = argValue('--branch') || process.env.CF_PAGES_BRANCH || '';

if (!baseUrl) fail('missing --url=https://deployment.example');
if (!SHA_RE.test(expectedCommit)) fail('missing or invalid full 40-character --sha');
if (!['production', 'preview'].includes(expectedEnvironment)) {
  fail('missing or invalid --environment=production|preview');
}
if (!expectedBranch) fail('missing --branch');

const requestedOrigin = new URL(baseUrl).origin;
async function fetchBound(url, label) {
  const response = await fetch(url, { cache: 'no-store' });
  if (new URL(response.url).origin !== requestedOrigin) {
    fail(`${label} redirected outside the requested deployment origin`);
  }
  return response;
}

const buildUrl = new URL('/build.json', baseUrl);
buildUrl.searchParams.set('verify', expectedCommit);
const buildResponse = await fetchBound(buildUrl, '/build.json');
if (!buildResponse.ok) fail(`/build.json returned HTTP ${buildResponse.status}`);
if (!(buildResponse.headers.get('cache-control') || '').toLowerCase().includes('no-store')) {
  fail('/build.json is not served with Cache-Control: no-store');
}
const build = await buildResponse.json();

if (build.schema_version !== 2) fail('live build schema mismatch');
if (build.commit !== expectedCommit) fail(`live build SHA mismatch: expected ${expectedCommit}, got ${build.commit}`);
if (build.short_commit !== expectedCommit.slice(0, 8)) fail('live short SHA mismatch');
if (build.environment !== expectedEnvironment) fail(`live environment mismatch: expected ${expectedEnvironment}, got ${build.environment}`);
if (build.branch !== expectedBranch) fail(`live branch mismatch: expected ${expectedBranch}, got ${build.branch}`);
if (build.dirty !== false) fail('live build reports dirty source');
if (!build.files || typeof build.files !== 'object' || Array.isArray(build.files)) {
  fail('live build has no file-digest manifest');
}
if (!build.artifact_files || typeof build.artifact_files !== 'object' || Array.isArray(build.artifact_files)) {
  fail('live build has no complete artifact-leaf manifest');
}
if (!build.inputs || typeof build.inputs !== 'object' || Array.isArray(build.inputs)) {
  fail('live build has no deploy-input manifest');
}

function validateManifest(manifest, label) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    Object.getPrototypeOf(manifest) !== Object.prototype
  ) {
    fail(`live build ${label} manifest is not a plain object`);
  }
  const entries = Object.entries(manifest);
  if (entries.length < 1) fail(`live build ${label} manifest is empty`);
  for (const [name, digest] of entries) {
    const parts = typeof name === 'string' ? name.split('/') : [];
    if (
      typeof name !== 'string' ||
      typeof digest !== 'string' ||
      name.startsWith('/') ||
      name.includes('\\') ||
      parts.some((part) => part === '' || part === '.' || part === '..' || FORBIDDEN_MANIFEST_SEGMENTS.has(part)) ||
      !/^[0-9a-f]{64}$/.test(digest)
    ) {
      fail(`live build contains an invalid ${label} manifest entry: ${name}`);
    }
  }
  return entries;
}

const artifactFiles = validateManifest(build.artifact_files, 'artifact-leaf');
const inputEntries = validateManifest(build.inputs, 'deploy-input');
if (JSON.stringify(inputEntries.map(([name]) => name).sort()) !== JSON.stringify(EXPECTED_INPUTS)) {
  fail('live build deploy-input manifest has unexpected coverage');
}
for (const control of ['_headers', '_redirects']) {
  if (build.artifact_files[control] !== build.inputs[control]) {
    fail(`live build does not byte-bind ${control} as both artifact and deploy input`);
  }
}

const files = Object.entries(build.files);
validateManifest(build.files, 'served-file');
for (const [name, digest] of files) {
  if (build.artifact_files[name] !== digest) {
    fail(`live served file is not identically bound in the complete artifact manifest: ${name}`);
  }
  const fileUrl = new URL(`/${name.split('/').map(encodeURIComponent).join('/')}`, baseUrl);
  fileUrl.searchParams.set('verify', expectedCommit);
  const response = await fetchBound(fileUrl, `live artifact ${name}`);
  if (!response.ok) fail(`live artifact ${name} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== digest) fail(`live artifact digest mismatch: ${name}`);
}

const rootUrl = new URL('/', baseUrl);
rootUrl.searchParams.set('verify', expectedCommit);
const rootResponse = await fetchBound(rootUrl, '/');
if (!rootResponse.ok) fail(`/ returned HTTP ${rootResponse.status}`);
const rootHtml = await rootResponse.text();
requireExactBuildMeta(rootHtml, expectedCommit, 'live root HTML');

console.log(`verify-live-build: ${baseUrl} serves ${expectedCommit} (${expectedEnvironment}); ${files.length} served files and ${artifactFiles.length} artifact leaves are bound.`);
