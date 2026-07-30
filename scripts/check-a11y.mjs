// Accessibility and 200%-zoom gate for master 8.6.
//
// The screenshot matrix proves content is *visible*. It says nothing about
// whether that content is reachable: an illustration with no accessible name, a
// control smaller than a fingertip, or a layout that scrolls sideways at 200%
// zoom all pass a screenshot and fail a person.
//
// Kept separate from screenshot-matrix.mjs on purpose. That script is a proven
// gate and this one asks different questions; the CDP boilerplate is duplicated
// rather than refactoring a passing check under a deadline.
//
// 200% browser zoom is emulated the way the browser actually behaves: CSS pixels
// double, so the layout viewport halves. A 1280px window at 200% lays out at
// 640px. Reducing the layout width is the honest emulation; deviceScaleFactor
// would only change DPI.
import { spawn } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPTS_DIR);
const SERVE_LOCAL_PATH = path.join(SCRIPTS_DIR, 'serve-local.mjs');
const PUBLIC_SURFACE_MANIFEST_PATH = path.join(REPO_ROOT, 'data', 'public-surface-manifest.json');
const OUT_PATH = process.env.OSL_A11Y_OUT
  ? path.resolve(process.env.OSL_A11Y_OUT)
  : path.join(REPO_ROOT, 'docs', 'evidence', 'website-matrix', 'a11y.json');

function routeFromHtmlPath(htmlPath) {
  if (htmlPath === 'index.html') return '/';
  if (htmlPath.endsWith('/index.html')) return `/${htmlPath.slice(0, -'index.html'.length)}`;
  return `/${htmlPath.slice(0, -'.html'.length)}`;
}

function publicPagesFromManifest() {
  const manifest = JSON.parse(readFileSync(PUBLIC_SURFACE_MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(manifest.html) || manifest.html.length === 0) {
    throw new Error('public surface manifest must declare public HTML pages');
  }
  const pages = manifest.html.map((htmlPath) => {
    if (typeof htmlPath !== 'string' || !htmlPath.endsWith('.html')) {
      throw new Error(`public surface manifest has invalid HTML entry: ${String(htmlPath)}`);
    }
    return routeFromHtmlPath(htmlPath);
  });
  if (new Set(pages).size !== pages.length) {
    throw new Error('public surface manifest maps multiple HTML entries to the same route');
  }
  return pages;
}

const PAGES = publicPagesFromManifest();
// Nominal window widths. Each is checked at 100% and at 200% zoom.
const WIDTHS = [320, 390, 768, 1280];
const MIN_TAP = 44;
// Floor proves the browser audit covered the intended matrix.
const MIN_A11Y_COMBINATIONS = 100;
// Floor proves selectors matched real interactive controls.
const MIN_INTERACTIVE_CONTROLS = 20;
// /features is measured at four widths and two zoom levels.
const MIN_H4_A11Y_PROBES = 8;
// /docs/faq is measured at four widths and two zoom levels.
const MIN_FAQ_BURN_A11Y_PROBES = 8;

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

function locateChrome() {
  const envPath = process.env.OSL_CHROME;
  if (envPath && existsSync(envPath)) return envPath;
  const home = os.homedir();
  const patterns = [
    `${home}/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell`,
    `${home}/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`,
    `${home}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`,
  ];
  for (const pattern of patterns) {
    const matches = globSync(pattern).sort();
    if (matches.length > 0) return matches[matches.length - 1];
  }
  console.error('check-a11y: no Chrome/Chromium binary found.');
  process.exit(2);
}

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
        if (predicate(params, sessionId)) { off(); resolve(params); }
      });
    });
  }
}

// Runs in the page. Deliberately conservative: it only reports things that are
// unambiguously wrong, so a red result means real work rather than triage.
function auditPage(minTap) {
  function visible(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number.parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function accessibleName(el) {
    const label = (el.getAttribute('aria-label') || '').trim();
    if (label) return label;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
    const svgTitle = el.querySelector('svg > title');
    if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
    return '';
  }

  function describe(el) {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 90);
  }

  const imagesMissingAlt = [];
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue;
    if (img.getAttribute('alt') === null) imagesMissingAlt.push(describe(img));
  }

  const controlsMissingName = [];
  const interactiveControls = document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]');
  let interactiveControlCount = 0;
  for (const el of interactiveControls) {
    if (!visible(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.tabIndex < 0) continue;
    interactiveControlCount += 1;
    if (el.tagName === 'INPUT') {
      const id = el.getAttribute('id');
      const hasLabel = id ? !!document.querySelector(`label[for="${CSS.escape(id)}"]`) : false;
      if (hasLabel || el.closest('label')) continue;
      if (el.type === 'hidden') continue;
    }
    if (!accessibleName(el)) controlsMissingName.push(describe(el));
  }

  const smallTapTargets = [];
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]')) {
    if (!visible(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.tabIndex < 0) continue;
    // offsetWidth/offsetHeight, NOT getBoundingClientRect: the reveal animation
    // applies a transform, and the transformed rect made compliant 44px buttons
    // measure 41px. The layout box is what the CSS actually guarantees and what
    // the target will be once the animation settles.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Inline links inside a sentence are exempt: their hit area is the text
    // line, and WCAG 2.5.8 excludes targets in a block of text.
    const inSentence = el.tagName === 'A' && el.closest('p, li, td, th');
    if (inSentence) continue;
    if (w < minTap || h < minTap) {
      smallTapTargets.push(`${describe(el)} ${Math.round(w)}x${Math.round(h)}`);
    }
  }

  const doc = document.documentElement;
  const horizontalOverflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
  const overflowingElements = [];
  if (horizontalOverflow > 1) {
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right > doc.clientWidth + 1 && rect.width > 0) {
        const style = getComputedStyle(el);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
        overflowingElements.push(`${describe(el)} right=${Math.round(rect.right)}`);
      }
    }
  }

  const h4Semantics = [];
  let h4ExplainerFound = false;
  if (location.pathname === '/features') {
    const explainer = document.querySelector('[data-pws-burn-explainer]');
    h4ExplainerFound = Boolean(explainer);
    if (!explainer) {
      h4Semantics.push('missing [data-pws-burn-explainer] section');
    } else {
      if (!visible(explainer)) h4Semantics.push('PWS/Burn explainer is not visibly rendered');
      const labelId = explainer.getAttribute('aria-labelledby');
      const descriptionId = explainer.getAttribute('aria-describedby');
      if (!labelId || !document.getElementById(labelId)) h4Semantics.push('explainer has no valid aria-labelledby target');
      if (!descriptionId || !document.getElementById(descriptionId)) h4Semantics.push('explainer has no valid aria-describedby target');

      const stages = [...explainer.querySelectorAll('article[data-pws-stage]')];
      if (stages.length !== 2) h4Semantics.push(`expected 2 semantic stages, found ${stages.length}`);
      for (const stage of stages) {
        const stageLabel = stage.getAttribute('aria-labelledby');
        if (!stageLabel || !document.getElementById(stageLabel)) {
          h4Semantics.push(`${stage.getAttribute('data-pws-stage') || 'unknown'} stage has no accessible heading`);
        }
      }

      const plannedBadges = [...explainer.querySelectorAll('[data-osl-status="Planned"]')]
        .filter((badge) => visible(badge) && badge.textContent.trim() === 'Planned');
      if (plannedBadges.length !== 2) h4Semantics.push(`expected 2 visible Planned badges, found ${plannedBadges.length}`);

      const limits = [...explainer.querySelectorAll('.pws-burn-limits > li')];
      if (limits.length !== 4 || limits.some((item) => !visible(item))) {
        h4Semantics.push(`expected 4 visible Burn boundaries, found ${limits.filter(visible).length}`);
      }

      const statusLink = explainer.querySelector('a[href="/docs/status"]');
      if (!statusLink || !visible(statusLink) || statusLink.tabIndex < 0 || !accessibleName(statusLink)) {
        h4Semantics.push('support-matrix link is not visibly keyboard-focusable and named');
      } else {
        statusLink.focus({ preventScroll: true });
        if (document.activeElement !== statusLink) h4Semantics.push('support-matrix link does not accept focus');
        statusLink.blur();
      }
    }
  }

  const faqBurnSemantics = [];
  let faqBurnBoundaryFound = false;
  if (location.pathname === '/docs/faq') {
    const burnCopy = document.querySelector('[data-burn-boundary-copy]');
    faqBurnBoundaryFound = Boolean(burnCopy);
    if (!burnCopy) {
      faqBurnSemantics.push('missing [data-burn-boundary-copy] FAQ paragraph');
    } else {
      if (!visible(burnCopy)) faqBurnSemantics.push('FAQ burn boundary copy is not visibly rendered');
      const plannedBadge = burnCopy.querySelector('[data-osl-feature="burn"][data-osl-status="Planned"]');
      if (!plannedBadge || !visible(plannedBadge) || plannedBadge.textContent.trim() !== 'Planned') {
        faqBurnSemantics.push('FAQ burn boundary copy has no visible Planned Burn badge');
      }
      const text = burnCopy.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      const requiredPhrases = [
        'pws acts before disclosure',
        'burn acts after disclosure',
        'burn does not revoke recipient keys or control copies outside osl',
        'local deletion',
        'authenticated cooperative peer request',
        'host deletion attempt',
        'unavoidable copies and screenshots',
      ];
      for (const phrase of requiredPhrases) {
        if (!text.includes(phrase)) faqBurnSemantics.push(`FAQ burn boundary copy is missing ${phrase}`);
      }
      for (const phrase of ['not cryptographic erasure', 'cannot make']) {
        if (text.includes(phrase)) faqBurnSemantics.push(`FAQ burn boundary copy includes banned phrase ${phrase}`);
      }
    }
  }

  return {
    imagesMissingAlt,
    controlsMissingName,
    smallTapTargets,
    horizontalOverflow,
    overflowingElements: overflowingElements.slice(0, 8),
    interactiveControlCount,
    h4Semantics,
    h4ExplainerFound,
    faqBurnSemantics,
    faqBurnBoundaryFound,
    landmarks: {
      main: document.querySelectorAll('main').length,
      h1: document.querySelectorAll('h1').length,
    },
  };
}

async function run() {
  const chromeBinary = locateChrome();
  const port = await getFreePort();
  const serverChild = spawn(process.execPath, [SERVE_LOCAL_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);

  const chromeChild = spawn(chromeBinary, [
    '--headless=new', '--remote-debugging-port=0', '--no-sandbox',
    '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let buffer = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    };
    chromeChild.stderr.on('data', onData);
    chromeChild.once('exit', (code) => reject(new Error(`chrome exited early (${code})`)));
    delay(15000).then(() => reject(new Error('timed out waiting for Chrome')));
  });

  const cdpPort = new URL(wsUrl).port;
  const versionInfo = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json());
  const ws = new WebSocket(versionInfo.webSocketDebuggerUrl || wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')));
  });
  const cdp = new CDPClient(ws);

  const results = [];
  let interactiveControlsFound = 0;
  for (const page of PAGES) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    try {
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      for (const width of WIDTHS) {
        for (const zoom of [100, 200]) {
          const layoutWidth = zoom === 200 ? Math.round(width / 2) : width;
          await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: layoutWidth, height: 900, deviceScaleFactor: 1, mobile: false,
          }, sessionId);
          const loaded = cdp.once('Page.loadEventFired', (_p, sid) => sid === sessionId);
          await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}${page}` }, sessionId);
          await loaded;
          await delay(160);
          const evaluated = await cdp.send('Runtime.evaluate', {
            expression: `(${auditPage.toString()})(${MIN_TAP})`,
            returnByValue: true,
          }, sessionId);
          if (evaluated.exceptionDetails) {
            throw new Error(evaluated.exceptionDetails.text || 'audit threw');
          }
          const { interactiveControlCount, ...audit } = evaluated.result.value;
          interactiveControlsFound += interactiveControlCount;
          results.push({ page, width, zoom, layout_width: layoutWidth, ...audit });
        }
      }
    } finally {
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  try { ws.close(); } catch { /* already closed */ }
  chromeChild.kill('SIGTERM');
  serverChild.kill('SIGTERM');

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    browser_version: versionInfo.Browser,
    min_tap_px: MIN_TAP,
    results,
  }, null, 2)}\n`);

  const sum = (key) => results.reduce((total, r) => total + r[key].length, 0);
  const overflowRows = results.filter((r) => r.horizontalOverflow > 1);
  const uniq = (key) => [...new Set(results.flatMap((r) => r[key]))];

  console.log('\ncheck-a11y summary');
  console.log(`  pages x widths x zoom : ${results.length} combinations`);
  console.log(`  images missing alt    : ${sum('imagesMissingAlt')} (${uniq('imagesMissingAlt').length} distinct)`);
  console.log(`  controls without name : ${sum('controlsMissingName')} (${uniq('controlsMissingName').length} distinct)`);
  console.log(`  tap targets < ${MIN_TAP}px    : ${sum('smallTapTargets')} (${uniq('smallTapTargets').length} distinct)`);
  console.log(`  horizontal overflow   : ${overflowRows.length} combinations`);
  console.log(`  H4 semantic findings  : ${sum('h4Semantics')} (${uniq('h4Semantics').length} distinct)`);
  console.log(`  FAQ burn findings     : ${sum('faqBurnSemantics')} (${uniq('faqBurnSemantics').length} distinct)`);

  for (const name of uniq('controlsMissingName')) console.log(`    [name] ${name}`);
  for (const name of uniq('imagesMissingAlt')) console.log(`    [alt]  ${name}`);
  for (const t of uniq('smallTapTargets').slice(0, 20)) console.log(`    [tap]  ${t}`);
  for (const r of overflowRows.slice(0, 12)) {
    console.log(`    [overflow] ${r.page} ${r.width}px @${r.zoom}% by ${r.horizontalOverflow}px :: ${r.overflowingElements.join(' | ')}`);
  }
  for (const finding of uniq('h4Semantics')) console.log(`    [H4]   ${finding}`);
  for (const finding of uniq('faqBurnSemantics')) console.log(`    [FAQ]  ${finding}`);

  const failed = sum('imagesMissingAlt') + sum('controlsMissingName') + overflowRows.length + sum('h4Semantics') + sum('faqBurnSemantics');
  console.log(`\ncheck-a11y: ${results.length} combinations, ${failed} blocking findings, ${sum('smallTapTargets')} tap-target findings.`);

  let floorFailed = false;
  if (results.length < MIN_A11Y_COMBINATIONS) {
    console.error(`check-a11y floor: expected at least ${MIN_A11Y_COMBINATIONS} audited combinations, actually audited ${results.length}.`);
    floorFailed = true;
  }
  if (interactiveControlsFound < MIN_INTERACTIVE_CONTROLS) {
    console.error(`check-a11y floor: expected at least ${MIN_INTERACTIVE_CONTROLS} interactive controls, actually found ${interactiveControlsFound}.`);
    floorFailed = true;
  }
  const h4Probes = results.filter((result) => result.page === '/features' && result.h4ExplainerFound).length;
  if (h4Probes < MIN_H4_A11Y_PROBES) {
    console.error(`check-a11y floor: expected at least ${MIN_H4_A11Y_PROBES} H4 explainer probes, actually found ${h4Probes}.`);
    floorFailed = true;
  }
  const faqBurnProbes = results.filter((result) => result.page === '/docs/faq' && result.faqBurnBoundaryFound).length;
  if (faqBurnProbes < MIN_FAQ_BURN_A11Y_PROBES) {
    console.error(`check-a11y floor: expected at least ${MIN_FAQ_BURN_A11Y_PROBES} FAQ burn boundary probes, actually found ${faqBurnProbes}.`);
    floorFailed = true;
  }

  process.exit(failed > 0 || floorFailed ? 1 : 0);
}

run().catch((error) => {
  console.error(`check-a11y: fatal error: ${error.stack || error.message}`);
  process.exit(1);
});
