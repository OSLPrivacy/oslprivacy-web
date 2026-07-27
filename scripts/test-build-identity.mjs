import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-identity.mjs');
const temp = await mkdtemp(path.join(os.tmpdir(), 'osl-build-identity-'));
const root = path.join(temp, 'site');
const out = path.join(root, 'dist');
let passed = 0;

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function run(extraEnv = {}, args = []) {
  return runAtOutput(out, extraEnv, args);
}

function runAtOutput(output, extraEnv = {}, args = []) {
  const env = { ...process.env };
  for (const key of [
    'CF_PAGES_COMMIT_SHA',
    'OSL_DEPLOY_ENVIRONMENT',
    'CF_PAGES_BRANCH',
  ]) delete env[key];
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [SCRIPT, `--root=${root}`, `--out=${output}`, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

function pass(name) {
  passed += 1;
  console.log(`  passed ${name}`);
}

function requireResult(name, result, expectedStatus, phrase) {
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== expectedStatus || (phrase && !output.includes(phrase))) {
    throw new Error(`${name} failed its test contract\nstatus=${result.status}\n${output}`);
  }
  pass(name);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function rebindArtifactFile(name) {
  const buildPath = path.join(out, 'build.json');
  const build = JSON.parse(await readFile(buildPath, 'utf8'));
  const bytes = await readFile(path.join(out, name));
  build.artifact_files[name] = digest(bytes);
  if (Object.hasOwn(build.files, name)) build.files[name] = digest(bytes);
  await writeFile(buildPath, `${JSON.stringify(build, null, 2)}\n`);
}

try {
  await mkdir(path.join(root, 'data'), { recursive: true });
  await mkdir(path.join(root, 'assets', 'js'), { recursive: true });
  await mkdir(path.join(root, 'assets', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'assets', 'img'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), [
    '<!doctype html>',
    '<html><head>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <script src="/assets/js/main.js" defer></script>',
    '</head><body>fixture</body></html>',
    '',
  ].join('\n'));
  await writeFile(path.join(root, 'assets', 'nested', 'help.html'), [
    '<!doctype html>',
    '<html><head>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '</head><body>nested fixture</body></html>',
    '',
  ].join('\n'));
  await writeFile(path.join(root, 'assets', 'img', '.gitkeep'), '');
  await writeFile(path.join(root, 'assets', 'js', 'main.js'), 'void 0;\n');
  await writeFile(path.join(root, 'data', 'pricing.json'), '{"manifest_version":5}\n');
  await writeFile(path.join(root, '.assetsignore'), 'scripts/\ndata/\n');
  await writeFile(path.join(root, '.gitignore'), 'dist/\n*.log\n');
  await writeFile(path.join(root, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n');
  await writeFile(path.join(root, '_redirects'), '/old / 301\n');
  await writeFile(path.join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  await writeFile(path.join(root, 'wrangler.jsonc'), '{"pages_build_output_dir":"./dist"}\n');
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'OSL build identity test']);
  git(['config', 'user.email', 'build-identity-test@invalid.example']);
  git(['add', '.']);
  git(['commit', '-qm', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']);
  const goodEnv = {
    CF_PAGES_COMMIT_SHA: sha,
    OSL_DEPLOY_ENVIRONMENT: 'production',
    CF_PAGES_BRANCH: 'main',
  };

  requireResult('missing SHA refusal', run({
    OSL_DEPLOY_ENVIRONMENT: 'production',
    CF_PAGES_BRANCH: 'main',
  }), 1, 'missing Cloudflare deploy SHA');
  requireResult('short SHA refusal', run({
    ...goodEnv,
    CF_PAGES_COMMIT_SHA: sha.slice(0, 8),
  }), 1, 'full 40-character');
  requireResult('mismatched SHA refusal', run({
    ...goodEnv,
    CF_PAGES_COMMIT_SHA: '0'.repeat(40),
  }), 1, 'deploy SHA mismatch');
  requireResult('missing environment refusal', run({
    CF_PAGES_COMMIT_SHA: sha,
    CF_PAGES_BRANCH: 'main',
  }), 1, 'missing deploy environment');
  requireResult('branch mismatch refusal', run({
    ...goodEnv,
    OSL_DEPLOY_ENVIRONMENT: 'preview',
    CF_PAGES_BRANCH: 'not-main',
  }), 1, 'deploy branch mismatch');
  requireResult('main-as-preview refusal', run({
    ...goodEnv,
    OSL_DEPLOY_ENVIRONMENT: 'preview',
  }), 1, 'main branch must identify the production environment');

  const unsafeOut = path.join(temp, 'unsafe-output');
  await mkdir(unsafeOut, { recursive: true });
  await writeFile(path.join(unsafeOut, 'sentinel.txt'), 'must survive\n');
  requireResult(
    'unsafe output path refusal',
    runAtOutput(unsafeOut, goodEnv),
    1,
    'deploy output must be exactly',
  );
  if (await readFile(path.join(unsafeOut, 'sentinel.txt'), 'utf8') !== 'must survive\n') {
    throw new Error('unsafe output refusal damaged its sentinel');
  }
  pass('unsafe output sentinel survived');

  await writeFile(path.join(root, 'untracked.txt'), 'dirty\n');
  requireResult('dirty untracked checkout refusal', run(goodEnv), 1, 'deploy checkout is dirty');
  await rm(path.join(root, 'untracked.txt'));
  const originalHtml = await readFile(path.join(root, 'index.html'), 'utf8');
  await writeFile(path.join(root, 'index.html'), `${originalHtml}<!-- dirty -->\n`);
  requireResult('dirty tracked checkout refusal', run(goodEnv), 1, 'deploy checkout is dirty');
  await writeFile(path.join(root, 'index.html'), originalHtml);

  await writeFile(path.join(root, 'assets', 'ignored.log'), 'must not publish\n');
  requireResult(
    'ignored publishable-root byte refusal',
    run(goodEnv),
    1,
    'untracked or ignored byte inside a publishable source root',
  );
  await rm(path.join(root, 'assets', 'ignored.log'));
  requireResult('exact clean artifact build', run(goodEnv), 0, 'built and verified 2 HTML files');
  try {
    await readFile(path.join(out, 'assets', 'ignored.log'));
    throw new Error('ignored untracked asset entered the deploy artifact');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  pass('ignored untracked asset exclusion');
  const build = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  if (
    build.schema_version !== 2
    || build.commit !== sha
    || build.environment !== 'production'
    || build.dirty !== false
  ) {
    throw new Error('positive artifact did not contain the exact clean deployment identity');
  }
  for (const name of ['_headers', '_redirects', 'assets/img/.gitkeep', 'assets/nested/help.html']) {
    if (!build.artifact_files[name]) throw new Error(`complete artifact manifest omitted ${name}`);
  }
  for (const name of ['_headers', '_redirects', 'assets/img/.gitkeep']) {
    if (build.files[name]) throw new Error(`served-file manifest incorrectly included ${name}`);
  }
  if (!build.files['assets/nested/help.html']) {
    throw new Error('served-file manifest omitted nested HTML');
  }
  pass('complete leaf and served-file manifests');
  const html = await readFile(path.join(out, 'index.html'), 'utf8');
  if (!html.includes(`content="${sha}"`) || !html.includes(`?v=${sha.slice(0, 8)}`)) {
    throw new Error('positive artifact HTML is not SHA-bound');
  }
  const nestedHtml = await readFile(path.join(out, 'assets', 'nested', 'help.html'), 'utf8');
  if (!nestedHtml.includes(`content="${sha}"`)) {
    throw new Error('nested artifact HTML is not SHA-bound');
  }
  pass('nested HTML discovery and stamping');
  requireResult('exact artifact verification', run(goodEnv, ['--verify-artifact']), 0, 'verified 2 HTML files');

  for (const [name, key, value, phrase] of [
    ['artifact full SHA mismatch refusal', 'commit', '0'.repeat(40), 'commit mismatch'],
    ['artifact short SHA mismatch refusal', 'short_commit', 'deadbeef', 'short_commit mismatch'],
    ['artifact branch mismatch refusal', 'branch', 'preview-branch', 'branch mismatch'],
    ['artifact environment mismatch refusal', 'environment', 'preview', 'environment mismatch'],
  ]) {
    const changed = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
    changed[key] = value;
    await writeFile(path.join(out, 'build.json'), `${JSON.stringify(changed)}\n`);
    requireResult(name, run(goodEnv, ['--verify-artifact']), 1, phrase);
    requireResult(`artifact rebuild after ${key} mismatch`, run(goodEnv), 0, 'built and verified 2 HTML files');
  }

  const missingEntry = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  delete missingEntry.files['assets/js/main.js'];
  await writeFile(path.join(out, 'build.json'), `${JSON.stringify(missingEntry)}\n`);
  requireResult('missing manifest entry refusal', run(goodEnv, ['--verify-artifact']), 1, 'every served leaf');
  requireResult('artifact rebuild after missing manifest entry', run(goodEnv), 0, 'built and verified 2 HTML files');

  const extraEntry = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  extraEntry.files['ghost.txt'] = '0'.repeat(64);
  await writeFile(path.join(out, 'build.json'), `${JSON.stringify(extraEntry)}\n`);
  requireResult('extra manifest entry refusal', run(goodEnv, ['--verify-artifact']), 1, 'every served leaf');
  requireResult('artifact rebuild after extra manifest entry', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(out, 'assets', 'js', 'main.js'), 'void 1;\n');
  requireResult('changed non-HTML artifact refusal', run(goodEnv, ['--verify-artifact']), 1, 'digest mismatch');
  requireResult('artifact rebuild after non-HTML mutation', run(goodEnv), 0, 'built and verified 2 HTML files');

  const exactHtml = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(path.join(out, 'index.html'), exactHtml.replace(`?v=${sha.slice(0, 8)}`, '?v=deadbeef'));
  requireResult('stale asset token refusal', run(goodEnv, ['--verify-artifact']), 1, 'stale asset cache token');
  requireResult('artifact rebuild after stale token', run(goodEnv), 0, 'built and verified 2 HTML files');
  const versionedHtml = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(path.join(out, 'index.html'), versionedHtml.replace(`?v=${sha.slice(0, 8)}`, ''));
  requireResult('missing asset token refusal', run(goodEnv, ['--verify-artifact']), 1, 'stale asset cache token');
  requireResult('artifact rebuild after missing token', run(goodEnv), 0, 'built and verified 2 HTML files');

  const stamp = `<meta name="osl-build" content="${sha}">`;
  for (const [name, replacement] of [
    ['commented build meta refusal', `<!-- ${stamp} -->`],
    ['data-name build meta refusal', `<meta data-name="osl-build" content="${sha}">`],
    ['duplicate build meta refusal', `${stamp}\n  ${stamp}`],
    ['raw-text build meta refusal', `<script type="text/plain">${stamp}</script>`],
    ['template build meta refusal', `<template>${stamp}</template>`],
    ['body-only build meta refusal', `</head><body>${stamp}`],
    ['fake post-body head refusal', `</head><body><head>${stamp}</head>`],
    ['plaintext build meta refusal', `<plaintext>${stamp}`],
  ]) {
    const exact = await readFile(path.join(out, 'index.html'), 'utf8');
    await writeFile(path.join(out, 'index.html'), exact.replace(stamp, replacement));
    await rebindArtifactFile('index.html');
    requireResult(name, run(goodEnv, ['--verify-artifact']), 1, 'index.html');
    requireResult(`artifact rebuild after ${name}`, run(goodEnv), 0, 'built and verified 2 HTML files');
  }

  const encodedDuplicateHtml = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(
    path.join(out, 'index.html'),
    encodedDuplicateHtml.replace(
      stamp,
      `${stamp}\n  <meta name="osl&#45;build" content="${sha}">`,
    ),
  );
  await rebindArtifactFile('index.html');
  requireResult(
    'character-reference duplicate build meta refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'semantic full-SHA osl-build meta inside head',
  );
  requireResult(
    'artifact rebuild after character-reference duplicate refusal',
    run(goodEnv),
    0,
    'built and verified 2 HTML files',
  );

  const exactNestedHtml = await readFile(path.join(out, 'assets', 'nested', 'help.html'), 'utf8');
  await writeFile(
    path.join(out, 'assets', 'nested', 'help.html'),
    exactNestedHtml.replace(stamp, `<!-- ${stamp} -->`),
  );
  await rebindArtifactFile('assets/nested/help.html');
  requireResult(
    'nested HTML semantic meta refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'semantic full-SHA osl-build meta inside head',
  );
  requireResult('artifact rebuild after nested HTML mutation', run(goodEnv), 0, 'built and verified 2 HTML files');

  const exactMetaHtml = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(
    path.join(out, 'index.html'),
    exactMetaHtml
      .replace(`content="${sha}"`, `content="${'f'.repeat(40)}"`)
      .replace('</body>', `<span content="${sha}"></span></body>`),
  );
  await rebindArtifactFile('index.html');
  requireResult(
    'wrong meta with planted SHA refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'semantic full-SHA osl-build meta inside head',
  );
  requireResult('artifact rebuild after wrong meta', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(out, '_headers'), '/*\n  X-Frame-Options: SAMEORIGIN\n');
  await rebindArtifactFile('_headers');
  requireResult(
    'deploy control-file mutation refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'does not byte-bind _headers',
  );
  requireResult('artifact rebuild after control-file mutation', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(out, '_redirects'), '/old /elsewhere 302\n');
  await rebindArtifactFile('_redirects');
  requireResult(
    'redirect-control mutation refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'does not byte-bind _redirects',
  );
  requireResult('artifact rebuild after redirect-control mutation', run(goodEnv), 0, 'built and verified 2 HTML files');

  const changedInputs = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  changedInputs.inputs['wrangler.jsonc'] = '0'.repeat(64);
  await writeFile(path.join(out, 'build.json'), `${JSON.stringify(changedInputs)}\n`);
  requireResult(
    'deploy-input manifest mutation refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'control inputs mismatch',
  );
  requireResult('artifact rebuild after deploy-input mutation', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(out, 'unexpected.txt'), 'extra served byte\n');
  requireResult(
    'extra served entry refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'every output leaf',
  );
  requireResult('artifact rebuild after extra served entry', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(out, '.promotion-probe'), 'unexpected dotfile\n');
  requireResult(
    'unexpected artifact dotfile refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'every output leaf',
  );
  requireResult('artifact rebuild after unexpected dotfile', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(out, 'assets', 'img', '.gitkeep'), 'tampered\n');
  requireResult(
    'manifested dotfile mutation refusal',
    run(goodEnv, ['--verify-artifact']),
    1,
    'leaf digest mismatch',
  );
  requireResult('artifact rebuild after manifested dotfile mutation', run(goodEnv), 0, 'built and verified 2 HTML files');

  await rm(path.join(out, 'build.json'));
  requireResult('missing artifact refusal', run(goodEnv, ['--verify-artifact']), 1, 'invalid or missing');
  requireResult('artifact rebuild after missing file', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(out, 'build.json'), '{not json}\n');
  requireResult('invalid artifact JSON refusal', run(goodEnv, ['--verify-artifact']), 1, 'invalid or missing');
  requireResult('artifact rebuild after invalid JSON', run(goodEnv), 0, 'built and verified 2 HTML files');

  const tampered = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  tampered.dirty = true;
  await writeFile(path.join(out, 'build.json'), `${JSON.stringify(tampered)}\n`);
  requireResult('dirty artifact refusal', run(goodEnv, ['--verify-artifact']), 1, 'dirty mismatch');
  requireResult('artifact rebuild after dirty identity', run(goodEnv), 0, 'built and verified 2 HTML files');

  await writeFile(path.join(root, 'build.json'), '{}\n');
  git(['add', 'build.json']);
  git(['commit', '-qm', 'bad source identity']);
  const badSha = git(['rev-parse', 'HEAD']);
  requireResult('source build.json refusal', run({
    ...goodEnv,
    CF_PAGES_COMMIT_SHA: badSha,
  }, ['--check-source']), 1, 'must exist only in the deploy artifact');

  console.log(`test-build-identity: ${passed} refusal/positive cases, 0 failed.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
