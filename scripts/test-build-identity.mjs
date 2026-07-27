import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-identity.mjs');
const temp = await mkdtemp(path.join(os.tmpdir(), 'osl-build-identity-'));
const root = path.join(temp, 'site');
const out = path.join(root, 'dist');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function run(extraEnv = {}, args = []) {
  const env = { ...process.env };
  for (const key of [
    'CF_PAGES_COMMIT_SHA',
    'OSL_DEPLOY_ENVIRONMENT',
    'CF_PAGES_BRANCH',
  ]) delete env[key];
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [SCRIPT, `--root=${root}`, `--out=${out}`, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

function requireResult(name, result, expectedStatus, phrase) {
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== expectedStatus || (phrase && !output.includes(phrase))) {
    throw new Error(`${name} failed its test contract\nstatus=${result.status}\n${output}`);
  }
  console.log(`  passed ${name}`);
}

try {
  await mkdir(path.join(root, 'data'), { recursive: true });
  await mkdir(path.join(root, 'assets', 'js'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), [
    '<!doctype html>',
    '<html><head>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <script src="/assets/js/main.js" defer></script>',
    '</head><body>fixture</body></html>',
    '',
  ].join('\n'));
  await writeFile(path.join(root, 'assets', 'js', 'main.js'), 'void 0;\n');
  await writeFile(path.join(root, 'data', 'pricing.json'), '{"manifest_version":5}\n');
  await writeFile(path.join(root, '.gitignore'), 'dist/\n*.log\n');
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

  await writeFile(path.join(root, 'untracked.txt'), 'dirty\n');
  requireResult('dirty untracked checkout refusal', run(goodEnv), 1, 'deploy checkout is dirty');
  await rm(path.join(root, 'untracked.txt'));
  const originalHtml = await readFile(path.join(root, 'index.html'), 'utf8');
  await writeFile(path.join(root, 'index.html'), `${originalHtml}<!-- dirty -->\n`);
  requireResult('dirty tracked checkout refusal', run(goodEnv), 1, 'deploy checkout is dirty');
  await writeFile(path.join(root, 'index.html'), originalHtml);

  await writeFile(path.join(root, 'assets', 'ignored.log'), 'must not publish\n');
  requireResult('exact clean artifact build', run(goodEnv), 0, 'built and verified 1 HTML files');
  try {
    await readFile(path.join(out, 'assets', 'ignored.log'));
    throw new Error('ignored untracked asset entered the deploy artifact');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log('  passed ignored untracked asset exclusion');
  const build = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  if (build.commit !== sha || build.environment !== 'production' || build.dirty !== false) {
    throw new Error('positive artifact did not contain the exact clean deployment identity');
  }
  const html = await readFile(path.join(out, 'index.html'), 'utf8');
  if (!html.includes(`content="${sha}"`) || !html.includes(`?v=${sha.slice(0, 8)}`)) {
    throw new Error('positive artifact HTML is not SHA-bound');
  }
  requireResult('exact artifact verification', run(goodEnv, ['--verify-artifact']), 0, 'verified 1 HTML files');

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
    requireResult(`artifact rebuild after ${key} mismatch`, run(goodEnv), 0, 'built and verified 1 HTML files');
  }

  const missingEntry = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  delete missingEntry.files['assets/js/main.js'];
  await writeFile(path.join(out, 'build.json'), `${JSON.stringify(missingEntry)}\n`);
  requireResult('missing manifest entry refusal', run(goodEnv, ['--verify-artifact']), 1, 'does not exactly cover');
  requireResult('artifact rebuild after missing manifest entry', run(goodEnv), 0, 'built and verified 1 HTML files');

  const extraEntry = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  extraEntry.files['ghost.txt'] = '0'.repeat(64);
  await writeFile(path.join(out, 'build.json'), `${JSON.stringify(extraEntry)}\n`);
  requireResult('extra manifest entry refusal', run(goodEnv, ['--verify-artifact']), 1, 'does not exactly cover');
  requireResult('artifact rebuild after extra manifest entry', run(goodEnv), 0, 'built and verified 1 HTML files');

  await writeFile(path.join(out, 'assets', 'js', 'main.js'), 'void 1;\n');
  requireResult('changed non-HTML artifact refusal', run(goodEnv, ['--verify-artifact']), 1, 'digest mismatch');
  requireResult('artifact rebuild after non-HTML mutation', run(goodEnv), 0, 'built and verified 1 HTML files');

  const exactHtml = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(path.join(out, 'index.html'), exactHtml.replace(`?v=${sha.slice(0, 8)}`, '?v=deadbeef'));
  requireResult('stale asset token refusal', run(goodEnv, ['--verify-artifact']), 1, 'stale asset cache token');
  requireResult('artifact rebuild after stale token', run(goodEnv), 0, 'built and verified 1 HTML files');
  const versionedHtml = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(path.join(out, 'index.html'), versionedHtml.replace(`?v=${sha.slice(0, 8)}`, ''));
  requireResult('missing asset token refusal', run(goodEnv, ['--verify-artifact']), 1, 'stale asset cache token');
  requireResult('artifact rebuild after missing token', run(goodEnv), 0, 'built and verified 1 HTML files');

  const exactMetaHtml = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(
    path.join(out, 'index.html'),
    exactMetaHtml
      .replace(`content="${sha}"`, `content="${'f'.repeat(40)}"`)
      .replace('</body>', `<span content="${sha}"></span></body>`),
  );
  requireResult('wrong meta with planted SHA refusal', run(goodEnv, ['--verify-artifact']), 1, 'full-SHA osl-build stamp');
  requireResult('artifact rebuild after wrong meta', run(goodEnv), 0, 'built and verified 1 HTML files');

  await rm(path.join(out, 'build.json'));
  requireResult('missing artifact refusal', run(goodEnv, ['--verify-artifact']), 1, 'invalid or missing');
  requireResult('artifact rebuild after missing file', run(goodEnv), 0, 'built and verified 1 HTML files');

  await writeFile(path.join(out, 'build.json'), '{not json}\n');
  requireResult('invalid artifact JSON refusal', run(goodEnv, ['--verify-artifact']), 1, 'invalid or missing');
  requireResult('artifact rebuild after invalid JSON', run(goodEnv), 0, 'built and verified 1 HTML files');

  const tampered = JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
  tampered.dirty = true;
  await writeFile(path.join(out, 'build.json'), `${JSON.stringify(tampered)}\n`);
  requireResult('dirty artifact refusal', run(goodEnv, ['--verify-artifact']), 1, 'dirty mismatch');
  requireResult('artifact rebuild after dirty identity', run(goodEnv), 0, 'built and verified 1 HTML files');

  await writeFile(path.join(root, 'build.json'), '{}\n');
  git(['add', 'build.json']);
  git(['commit', '-qm', 'bad source identity']);
  const badSha = git(['rev-parse', 'HEAD']);
  requireResult('source build.json refusal', run({
    ...goodEnv,
    CF_PAGES_COMMIT_SHA: badSha,
  }, ['--check-source']), 1, 'must exist only in the deploy artifact');

  console.log('test-build-identity: 38 refusal/positive cases, 0 failed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
