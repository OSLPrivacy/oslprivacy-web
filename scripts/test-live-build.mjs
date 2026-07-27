import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERIFIER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-live-build.mjs');
const commit = 'a'.repeat(40);
const shortCommit = commit.slice(0, 8);
const branch = 'main';
const environment = 'production';
const index = Buffer.from([
  '<!doctype html><html><head>',
  `<meta name="osl-build" content="${commit}">`,
  '</head><body>fixture</body></html>',
].join(''));
const asset = Buffer.from('void 0;\n');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baseBuild = {
  schema_version: 1,
  commit,
  short_commit: shortCommit,
  branch,
  environment,
  dirty: false,
  built_at: '2026-07-27T00:00:00.000Z',
  manifest_version: 5,
  files: {
    'assets/main.js': digest(asset),
    'index.html': digest(index),
  },
};

let mode = 'positive';
let port;
const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/build.json') {
    if (mode === 'build-404') {
      response.writeHead(404).end('missing');
      return;
    }
    if (mode === 'cross-origin' && request.headers.host?.startsWith('127.0.0.1:')) {
      response.writeHead(302, { Location: `http://localhost:${port}/build.json` }).end();
      return;
    }
    const headers = mode === 'cacheable' ? {} : { 'Cache-Control': 'no-store, max-age=0' };
    response.writeHead(200, headers);
    if (mode === 'invalid-json') {
      response.end('{not json}');
      return;
    }
    const build = structuredClone(baseBuild);
    if (mode === 'dirty') build.dirty = true;
    if (mode === 'wrong-sha') build.commit = 'b'.repeat(40);
    if (mode === 'wrong-environment') build.environment = 'preview';
    if (mode === 'wrong-branch') build.branch = 'preview-branch';
    if (mode === 'wrong-schema') build.schema_version = 2;
    response.end(JSON.stringify(build));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (mode === 'wrong-root-meta' && url.pathname === '/') {
      response.end(index.toString().replace(commit, 'b'.repeat(40)));
    } else {
      response.end(index);
    }
    return;
  }
  if (url.pathname === '/assets/main.js') {
    response.end(mode === 'changed-artifact' ? 'void 1;\n' : asset);
    return;
  }
  response.writeHead(404).end('missing');
});

function runVerifier() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      VERIFIER,
      `--url=http://127.0.0.1:${port}`,
      `--sha=${commit}`,
      `--branch=${branch}`,
      `--environment=${environment}`,
    ], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output: `${stdout}${stderr}` }));
  });
}

async function check(name, selectedMode, expectedCode, phrase) {
  mode = selectedMode;
  const result = await runVerifier();
  if (result.code !== expectedCode || (phrase && !result.output.includes(phrase))) {
    throw new Error(`${name} failed\nexit=${result.code}\n${result.output}`);
  }
  console.log(`  passed ${name}`);
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });

  await check('exact live artifact', 'positive', 0, '2 files match');
  await check('missing build.json refusal', 'build-404', 1, 'HTTP 404');
  await check('invalid build.json refusal', 'invalid-json', 1, 'SyntaxError');
  await check('cacheable build.json refusal', 'cacheable', 1, 'Cache-Control: no-store');
  await check('dirty live identity refusal', 'dirty', 1, 'reports dirty');
  await check('live SHA mismatch refusal', 'wrong-sha', 1, 'live build SHA mismatch');
  await check('live environment mismatch refusal', 'wrong-environment', 1, 'live environment mismatch');
  await check('live branch mismatch refusal', 'wrong-branch', 1, 'live branch mismatch');
  await check('live schema mismatch refusal', 'wrong-schema', 1, 'live build schema mismatch');
  await check('root meta mismatch refusal', 'wrong-root-meta', 1, 'root HTML is not bound');
  await check('changed artifact refusal', 'changed-artifact', 1, 'digest mismatch');
  await check('cross-origin redirect refusal', 'cross-origin', 1, 'redirected outside');
  console.log('test-live-build: 12 cases, 0 failed.');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
