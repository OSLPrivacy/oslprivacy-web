// Generates docs/status.html — the dated support matrix required by master 8.4.
//
// The page is generated, never hand-written, so the one surface that is allowed
// to state current status cannot drift from data/pricing.json. `--check` fails
// if the committed page is stale, which is what makes the drift guarantee real
// rather than aspirational.
//
// The HTML shell (head, nav, docs sidebar, footer) is lifted from an existing
// docs page at build time so this page cannot fall out of step with site
// navigation either.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PRICING_PATH = path.join(ROOT, 'data', 'pricing.json');
const TEMPLATE_PATH = path.join(ROOT, 'docs', 'threat-model.html');
const OUT_PATH = path.join(ROOT, 'docs', 'status.html');
const CHECK_MODE = process.argv.includes('--check');

const PROVEN = new Set(['Available', 'Beta']);

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function badge(feature, status) {
  return `<span class="osl-status" data-osl-feature="${esc(feature)}" data-osl-status="${esc(status)}">${esc(status)}</span>`;
}

// Only the status word is a badge; the connector table reuses plain text so a
// connector row can never be mistaken for a capability registry entry.
function statusText(status) {
  return `<strong>${esc(status)}</strong>`;
}

function buildBody(pricing) {
  const registry = pricing.capability_registry ?? [];
  const frame = pricing.launch_frame ?? {};
  const matrix = pricing.connector_matrix ?? {};
  const working = registry.filter((r) => PROVEN.has(r.status) && r.status !== 'Illustration');
  const pending = registry.filter((r) => !PROVEN.has(r.status) && r.status !== 'Illustration');
  const drawings = registry.filter((r) => r.status === 'Illustration');

  const out = [];
  out.push('        <h1>What works today</h1>');
  out.push(`        <p class="lede">OSL is in early access before its v1 launch. This page is the honest, dated record of what the shipping app actually does. Every feature page on this site links here. Matrix version ${esc(matrix.version ?? pricing.decided_on ?? '')}.</p>`);

  out.push('        <p>The rest of this site describes OSL v1 — the product we are building toward. This page is the exception: nothing here is forward-looking. If a capability is not listed as working below, do not rely on it, and do not buy Pro expecting it.</p>');

  out.push('        <h2 id="working">Working today <a class="anchor-link" href="#working" aria-label="Link to this section">#</a></h2>');
  out.push('        <p>Proven on test builds against a real conversation. Not yet proven on a numbered release build, which is why none of these is labelled <em>Available</em>.</p>');
  out.push('        <div class="status-table-scroll">');
  out.push('        <table class="status-table">');
  out.push('          <caption>Capabilities that work in the shipping app</caption>');
  out.push('          <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Last verified</th><th scope="col">What that means</th></tr></thead>');
  out.push('          <tbody>');
  for (const row of working) {
    out.push(`            <tr><th scope="row">${esc(row.name)}</th><td>${badge(row.id, row.status)}</td><td>${esc(row.verified_on ?? '')}</td><td>${esc(row.public_note ?? '')}</td></tr>`);
  }
  out.push('          </tbody>');
  out.push('        </table>');
  out.push('        </div>');

  out.push('        <h2 id="not-yet">Not in the shipping app yet <a class="anchor-link" href="#not-yet" aria-label="Link to this section">#</a></h2>');
  out.push('        <p>These are part of OSL v1 and are described elsewhere on this site as the product we are building. None of them is finished today.</p>');
  out.push('        <div class="status-table-scroll">');
  out.push('        <table class="status-table">');
  out.push('          <caption>Capabilities still being finished before v1</caption>');
  out.push('          <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Last verified</th><th scope="col">Where it actually stands</th></tr></thead>');
  out.push('          <tbody>');
  for (const row of pending) {
    out.push(`            <tr><th scope="row">${esc(row.name)}</th><td>${badge(row.id, row.status)}</td><td>${esc(row.verified_on ?? '')}</td><td>${esc(row.public_note ?? '')}</td></tr>`);
  }
  out.push('          </tbody>');
  out.push('        </table>');
  out.push('        </div>');

  out.push('        <h2 id="connectors">Connector support <a class="anchor-link" href="#connectors" aria-label="Link to this section">#</a></h2>');
  out.push('        <p>A logo appearing anywhere on this site never implies support. This table is the only place that says which services are supported.</p>');
  out.push('        <div class="status-table-scroll">');
  out.push('        <table class="status-table">');
  out.push('          <caption>Versioned connector support matrix</caption>');
  out.push('          <thead><tr><th scope="col">Connector</th><th scope="col">Protected send</th><th scope="col">Protected receive</th><th scope="col">Attachments</th><th scope="col">Scrub</th><th scope="col">Last verified</th><th scope="col">Status</th><th scope="col">Provider policy risk</th></tr></thead>');
  out.push('          <tbody>');
  for (const c of matrix.connectors ?? []) {
    out.push(`            <tr><th scope="row">${esc(c.name)}</th><td>${esc(c.protected_send)}</td><td>${esc(c.protected_receive)}</td><td>${esc(c.attachments)}</td><td>${esc(c.scrub)}</td><td>${esc(c.verified_on)}</td><td>${statusText(c.status)}</td><td>${esc(c.provider_policy_risk)}</td></tr>`);
  }
  out.push('          </tbody>');
  out.push('        </table>');
  out.push('        </div>');

  out.push('        <h2 id="drawings">Illustrations, not measurements <a class="anchor-link" href="#drawings" aria-label="Link to this section">#</a></h2>');
  out.push('        <ul>');
  for (const row of drawings) {
    out.push(`          <li><strong>${esc(row.name)}</strong> ${badge(row.id, row.status)} — ${esc(row.public_note ?? '')}</li>`);
  }
  out.push('        </ul>');

  out.push('        <h2 id="labels">How to read the labels <a class="anchor-link" href="#labels" aria-label="Link to this section">#</a></h2>');
  out.push('        <ul>');
  out.push('          <li><strong>Available</strong> — proven on a numbered release build. Nothing carries this label yet.</li>');
  out.push('          <li><strong>Beta</strong> — the code does it and it has been exercised on a test build. Expect rough edges.</li>');
  out.push('          <li><strong>Planned</strong> — part of v1, not finished. Some of it is written but not connected; some is design only.</li>');
  out.push('          <li><strong>Externally blocked</strong> — a third party does not expose what OSL would need. We will not fake support.</li>');
  out.push('          <li><strong>Illustration</strong> — a drawing of intended behaviour, not a recording or a measurement.</li>');
  out.push('        </ul>');

  out.push('        <h2 id="unaudited">Not independently audited <a class="anchor-link" href="#unaudited" aria-label="Link to this section">#</a></h2>');
  out.push('        <p>OSL uses a custom encryption construction that has not been independently audited, and no provider has tested, reviewed or approved it. If your threat model is high-stakes — legal investigation or targeted surveillance — use Signal, Briar or Cwtch instead. An internal source review is published on the <a href="/audit">audit page</a>.</p>');
  out.push('        <p>Protecting message content does not hide metadata. A connected service still sees who you talk to, when, and how often. OSL cannot change that.</p>');

  return out.join('\n');
}

const pricing = JSON.parse(await readFile(PRICING_PATH, 'utf8'));
const template = await readFile(TEMPLATE_PATH, 'utf8');

const openTag = '<article class="docs-content">';
const openIndex = template.indexOf(openTag);
const closeIndex = template.lastIndexOf('</article>');
if (openIndex < 0 || closeIndex < 0) {
  console.error('build-status: could not locate the docs-content wrapper in the template');
  process.exit(2);
}

let head = template.slice(0, openIndex + openTag.length);
const tail = template.slice(closeIndex);

head = head
  // The site-wide early-access banner points here; repeating it on this page
  // would tell the reader to go where they already are.
  .replace(/\n\s*<div class="launch-banner"[\s\S]*?<\/div>\n/, '\n')
  .replace('<title>Threat model | OSL Privacy Docs</title>', '<title>What works today | OSL Privacy Docs</title>')
  .replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="The dated record of what OSL actually does in the shipping app today, and what is still being finished before v1.">',
  )
  // Move the sidebar current-page marker onto this page.
  .replace(' href="/docs/threat-model" aria-current="page"', ' href="/docs/threat-model"')
  .replace('<li><a href="/docs/faq">FAQ</a></li>', '<li><a href="/docs/status" aria-current="page">What works today</a></li>\n              <li><a href="/docs/faq">FAQ</a></li>');

const generated = `${head}\n${buildBody(pricing)}\n      ${tail}`;

if (CHECK_MODE) {
  let current = '';
  try {
    current = await readFile(OUT_PATH, 'utf8');
  } catch {
    console.error('build-status --check: docs/status.html does not exist. Run `node scripts/build-status.mjs`.');
    process.exit(1);
  }
  if (current !== generated) {
    console.error('build-status --check: docs/status.html is STALE. Run `node scripts/build-status.mjs`.');
    process.exit(1);
  }
  console.log('build-status --check: docs/status.html matches the manifest.');
} else {
  await writeFile(OUT_PATH, generated);
  const registry = pricing.capability_registry ?? [];
  const working = registry.filter((r) => PROVEN.has(r.status)).length;
  console.log(
    `build-status: wrote docs/status.html — ${registry.length} capabilities (${working} working), ` +
      `${(pricing.connector_matrix?.connectors ?? []).length} connectors, matrix version ${pricing.connector_matrix?.version}.`,
  );
}
