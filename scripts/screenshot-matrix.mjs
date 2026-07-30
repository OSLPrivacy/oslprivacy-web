// Zero-dependency responsive screenshot matrix. Drives an already-installed
// Chrome/Chromium build directly over the DevTools Protocol via the Node 24
// global WebSocket - no puppeteer/playwright package, no npm install.
import { spawn } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPTS_DIR);
const SERVE_LOCAL_PATH = path.join(SCRIPTS_DIR, 'serve-local.mjs');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'website-matrix');

const DEFAULT_PAGES = [
  '/', '/download', '/features', '/audit', '/donate', '/success', '/cancel',
  '/docs/', '/docs/faq', '/docs/status', '/docs/how-it-works', '/docs/getting-started',
  '/docs/privacy', '/docs/terms', '/docs/threat-model',
];
const DEFAULT_WIDTHS = [320, 360, 390, 768, 1024, 1440];
const CONDITIONS = ['js-on', 'js-off', 'reduced'];
const VIEWPORT_HEIGHT = 900;
// Floor proves the matrix covered the intended pages, widths, and modes.
const MIN_SCREENSHOT_CAPTURES = 200;
const CHROME_ARGS = [
  '--headless=new',
  '--remote-debugging-port=0',
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  'about:blank',
];

function parseArgs(argv) {
  const args = {
    pages: DEFAULT_PAGES,
    widths: DEFAULT_WIDTHS,
    outDir: DEFAULT_OUT_DIR,
    onlySpecified: false,
    widthsSpecified: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--only=')) {
      args.pages = arg.slice('--only='.length).split(',').map((v) => v.trim()).filter(Boolean);
      args.onlySpecified = true;
    } else if (arg.startsWith('--widths=')) {
      args.widths = arg.slice('--widths='.length).split(',')
        .map((v) => Number.parseInt(v.trim(), 10))
        .filter((n) => Number.isFinite(n));
      args.widthsSpecified = true;
    } else if (arg.startsWith('--out=')) {
      args.outDir = path.resolve(arg.slice('--out='.length));
    }
  }
  return args;
}

// Priority order matches the spec's documented Playwright cache layout first
// (chromium_headless_shell-*/chrome-linux/headless_shell, then
// chromium-*/chrome-linux/chrome), then falls back to the layout actually
// shipped by recent Playwright revisions (chrome-*-linux64 dirs) so this
// still finds a binary on machines where the directory naming has moved on.
function locateChrome() {
  const tried = [];
  const envPath = process.env.OSL_CHROME;
  if (envPath) {
    tried.push(envPath);
    if (existsSync(envPath)) return envPath;
  }
  const home = os.homedir();
  const patterns = [
    `${home}/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell`,
    `${home}/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`,
    `${home}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`,
  ];
  for (const pattern of patterns) {
    tried.push(pattern);
    const matches = globSync(pattern).sort();
    if (matches.length > 0) return matches[matches.length - 1];
  }
  console.error('screenshot-matrix: no Chrome/Chromium binary found. Tried:');
  for (const item of tried) console.error(`  ${item}`);
  process.exit(2);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(`timed out waiting for ${url}: ${lastError?.message || 'no response'}`);
}

async function startLocalServer(port) {
  const child = spawn(process.execPath, [SERVE_LOCAL_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  return child;
}

async function launchChrome(binary) {
  const child = spawn(binary, CHROME_ARGS, { stdio: ['ignore', 'ignore', 'pipe'] });
  let buffer = '';
  let resolveWs;
  let rejectWs;
  const wsPromise = new Promise((resolve, reject) => {
    resolveWs = resolve;
    rejectWs = reject;
  });
  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) resolveWs(match[1]);
  };
  child.stderr.on('data', onData);
  child.once('exit', (code) => rejectWs(new Error(`chrome exited early (code ${code}): ${buffer}`)));
  const timedOut = Symbol('timeout');
  const wsUrl = await Promise.race([wsPromise, delay(15000).then(() => timedOut)]);
  child.stderr.off('data', onData);
  if (wsUrl === timedOut) {
    child.kill('SIGKILL');
    throw new Error('timed out waiting for Chrome DevTools endpoint');
  }
  return { child, wsUrl };
}

async function killProcess(child, { timeoutMs = 3000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
  if (!exited) child.kill('SIGKILL');
}

// Minimal flattened CDP client: one WebSocket, a global message-id counter,
// and event listeners keyed by method name (filtered by sessionId by callers).
class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => this.onMessage(event));
  }

  onMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      const set = this.listeners.get(message.method);
      if (set) for (const fn of [...set]) fn(message.params, message.sessionId);
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  once(method, predicate = () => true) {
    return new Promise((resolve) => {
      const off = this.on(method, (params, sessionId) => {
        if (predicate(params, sessionId)) {
          off();
          resolve(params);
        }
      });
    });
  }
}

function pageSlug(page) {
  if (page === '/') return 'home';
  if (page === '/docs/') return 'docs-index';
  return page.replace(/^\/+/, '').replace(/\/+/g, '-');
}

async function applyCondition(cdp, sessionId, condition) {
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: condition === 'js-off' }, sessionId);
  const features = condition === 'reduced' ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [];
  await cdp.send('Emulation.setEmulatedMedia', { features }, sessionId);
}

// Written as a normal function and stringified below so the in-page
// expression stays readable instead of a hand-escaped string literal.
function measureFoldVisibility() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  function isStyledVisible(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const style = window.getComputedStyle(node);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const opacity = Number.parseFloat(style.opacity);
      if (Number.isFinite(opacity) && opacity <= 0.05) return false;
      node = node.parentElement;
    }
    return true;
  }

  function intersectsViewport(el) {
    const rects = el.getClientRects();
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const overlapWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
      const overlapHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
      if (overlapWidth > 0 && overlapHeight > 0) return true;
    }
    return false;
  }

  let visibleTextChars = 0;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const parent = node.parentElement;
      if (parent && isStyledVisible(parent) && intersectsViewport(parent)) {
        visibleTextChars += text.length;
      }
    }
  }

  const h4 = document.querySelector('[data-pws-burn-explainer]');
  const h4Explainer = h4 ? {
    present: true,
    visible: isStyledVisible(h4),
    textChars: (h4.textContent || '').replace(/\s+/g, ' ').trim().length,
    semanticStages: h4.querySelectorAll('article[data-pws-stage]').length,
    visibleBoundaries: [...h4.querySelectorAll('.pws-burn-limits > li')]
      .filter((item) => isStyledVisible(item)).length,
    plannedBadges: [...h4.querySelectorAll('[data-osl-status="Planned"]')]
      .filter((badge) => isStyledVisible(badge) && badge.textContent.trim() === 'Planned').length,
  } : {
    present: false,
    visible: false,
    textChars: 0,
    semanticStages: 0,
    visibleBoundaries: 0,
    plannedBadges: 0,
  };

  return {
    visibleTextChars,
    scrollHeight: document.documentElement.scrollHeight,
    unrevealedRevealCount: document.querySelectorAll('.reveal:not(.is-revealed)').length,
    buildMeta: document.querySelector('meta[name="osl-build"]')?.getAttribute('content') ?? null,
    h4Explainer,
  };
}

const MEASURE_EXPRESSION = `(${measureFoldVisibility.toString()})()`;

async function waitForSettle() {
  // Give the IntersectionObserver-driven reveal logic (assets/js/main.js) a
  // moment to run before measuring, without scrolling or manually triggering
  // the observer. A plain delay is used instead of an awaited
  // requestAnimationFrame Runtime.evaluate: headless Chrome's V8 inspector
  // can report "Promise was collected" for rAF-chained awaitPromise calls
  // (the promise has no other strong reference and gets GC'd), so keep this
  // off the CDP round-trip entirely.
  await delay(150);
}

async function captureCombo({ cdp, sessionId, page, url, width, condition, outDir }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: VIEWPORT_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);

  const loadPromise = cdp.once('Page.loadEventFired', (_params, sid) => sid === sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await loadPromise;
  await waitForSettle();

  const slug = pageSlug(page);
  const dir = path.join(outDir, slug);
  await mkdir(dir, { recursive: true });

  const foldPath = path.join(dir, `${width}-${condition}-fold.png`);
  const fullPath = path.join(dir, `${width}-${condition}-full.png`);

  const fold = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(foldPath, Buffer.from(fold.data, 'base64'));

  const metrics = await cdp.send('Page.getLayoutMetrics', {}, sessionId);
  const contentSize = metrics.cssContentSize || metrics.contentSize;
  const full = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 },
  }, sessionId);
  await writeFile(fullPath, Buffer.from(full.data, 'base64'));

  let measurement = {
    visibleTextChars: null,
    scrollHeight: null,
    unrevealedRevealCount: null,
    buildMeta: null,
    h4Explainer: null,
  };
  let verdict = 'unmeasurable';
  try {
    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: MEASURE_EXPRESSION,
      returnByValue: true,
    }, sessionId);
    if (evalResult.exceptionDetails) {
      throw new Error(evalResult.exceptionDetails.text || 'Runtime.evaluate threw');
    }
    measurement = evalResult.result.value;
    const h4 = measurement.h4Explainer;
    const h4Pass = page !== '/features' || (
      h4?.present
      && h4.visible
      && h4.textChars >= 500
      && h4.semanticStages === 2
      && h4.visibleBoundaries === 4
      && h4.plannedBadges === 2
    );
    verdict = measurement.visibleTextChars >= 40 && h4Pass ? 'pass' : 'fail';
  } catch (error) {
    console.error(`screenshot-matrix: measurement failed for ${page} ${width} ${condition}: ${error.message}`);
  }

  return {
    page,
    width,
    condition,
    fold_png: path.relative(outDir, foldPath).replaceAll(path.sep, '/'),
    full_png: path.relative(outDir, fullPath).replaceAll(path.sep, '/'),
    visible_text_chars: measurement.visibleTextChars,
    scroll_height: measurement.scrollHeight,
    unrevealed_reveal_count: measurement.unrevealedRevealCount,
    build_meta: measurement.buildMeta,
    h4_explainer: measurement.h4Explainer,
    verdict,
  };
}

function printSummary(pages, widths, results) {
  for (const page of pages) {
    console.log(`\n### ${page}`);
    console.log(`| condition | ${widths.join(' | ')} |`);
    console.log(`| --- | ${widths.map(() => '---').join(' | ')} |`);
    for (const condition of CONDITIONS) {
      const cells = widths.map((width) => {
        const match = results.find((r) => r.page === page && r.condition === condition && r.width === width);
        return match ? match.verdict : 'n/a';
      });
      console.log(`| ${condition} | ${cells.join(' | ')} |`);
    }
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBinary = locateChrome();

  await mkdir(args.outDir, { recursive: true });
  const serverPort = await getFreePort();
  const serverChild = await startLocalServer(serverPort);

  let chromeChild;
  let ws;
  const results = [];
  let browserVersion = 'unknown';

  try {
    const launched = await launchChrome(chromeBinary);
    chromeChild = launched.child;
    const cdpPort = new URL(launched.wsUrl).port;
    const versionInfo = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json());
    browserVersion = versionInfo.Browser || 'unknown';
    const browserWsUrl = versionInfo.webSocketDebuggerUrl || launched.wsUrl;

    ws = new WebSocket(browserWsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('WebSocket connection to Chrome failed')));
    });
    const cdp = new CDPClient(ws);

    for (const page of args.pages) {
      const url = `http://127.0.0.1:${serverPort}${page}`;
      for (const condition of CONDITIONS) {
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        try {
          await cdp.send('Page.enable', {}, sessionId);
          await cdp.send('Runtime.enable', {}, sessionId);
          await applyCondition(cdp, sessionId, condition);
          for (const width of args.widths) {
            const result = await captureCombo({ cdp, sessionId, page, url, width, condition, outDir: args.outDir });
            results.push(result);
          }
        } finally {
          await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
        }
      }
    }
  } finally {
    if (ws) {
      try { ws.close(); } catch { /* already closed */ }
    }
    await killProcess(chromeChild);
    await killProcess(serverChild);
  }

  const matrixPath = path.join(args.outDir, 'matrix.json');
  const matrix = {
    generated_at: new Date().toISOString(),
    browser_binary: chromeBinary,
    browser_version: browserVersion,
    server_port: serverPort,
    captures: results,
  };
  await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);

  printSummary(args.pages, args.widths, results);

  const failed = results.filter((r) => r.verdict === 'fail').length;
  const unmeasurable = results.filter((r) => r.verdict === 'unmeasurable').length;
  console.log(`\nscreenshot-matrix: ${results.length} captures, ${failed} failed, ${unmeasurable} unmeasurable.`);

  let floorFailed = false;
  const expectedCaptures = args.pages.length * CONDITIONS.length * args.widths.length;
  if (results.length !== expectedCaptures) {
    console.error(`screenshot-matrix floor: expected ${expectedCaptures} captures for requested pages, modes, and widths, actually produced ${results.length}.`);
    floorFailed = true;
  }
  const defaultFullMatrix = !args.onlySpecified && !args.widthsSpecified;
  if (defaultFullMatrix && results.length < MIN_SCREENSHOT_CAPTURES) {
    console.error(`screenshot-matrix floor: expected at least ${MIN_SCREENSHOT_CAPTURES} captures, actually produced ${results.length}.`);
    floorFailed = true;
  }
  if (args.pages.includes('/features')) {
    const expectedH4Captures = args.widths.length * CONDITIONS.length;
    const h4Captures = results.filter((result) => result.page === '/features' && result.h4_explainer?.present).length;
    if (h4Captures !== expectedH4Captures) {
      console.error(`screenshot-matrix floor: expected ${expectedH4Captures} H4 explainer captures, actually produced ${h4Captures}.`);
      floorFailed = true;
    }
  }

  process.exit(failed > 0 || unmeasurable > 0 || floorFailed ? 1 : 0);
}

run().catch((error) => {
  console.error(`screenshot-matrix: fatal error: ${error.stack || error.message}`);
  process.exit(1);
});
