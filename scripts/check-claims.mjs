import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Claim gate for oslprivacy.com.
//
// The site is PRE-LAUNCH MARKETING FOR v1, not a status dashboard (owner
// decision 2026-07-26, data/pricing.json launch_frame). So the rules differ by
// surface:
//
//   marketing  — may describe a v1 capability in forward-looking language, and
//                may omit a status badge. Must not make a bald present-tense
//                claim about something the shipping app cannot do, and must
//                link to the support matrix.
//   matrix     — docs/status.html. May only state current evidence, and must
//                account for EVERY capability in the registry with a badge that
//                matches the manifest.
//   checkout   — the point of sale. May only reference capabilities flagged
//                sellable, so nothing unfinished is ever sold present-tense.
//
// Forbidden phrases, forbidden billing claims and bare prices are global: they
// fail on every surface regardless of framing.
const ROOT = process.cwd();
const PRICING_PATH = path.join(ROOT, 'data', 'pricing.json');
const AT_REST_CENSUS_PATH = path.join(ROOT, 'data', 'at-rest-census.json');
const PUBLIC_SURFACE_MANIFEST_PATH = path.join(ROOT, 'data', 'public-surface-manifest.json');
const SELF_TEST = process.argv.includes('--self-test');
const AS_OF = parseAsOf(process.argv);
const PRICE_RE = /\$\s?\d+(\.\d{2})?/g;
const MARKER_RE = /<!--\s*osl:[A-Za-z0-9_$.-]+\s*-->[\s\S]*?<!--\s*\/osl\s*-->/g;
const PROVEN = new Set(['Available', 'Beta']);
// Floor proves the crawler glob found the expected site surface.
const MIN_CLAIM_HTML_FILES = 12;
const MIN_PUBLIC_HTML_FILES = 16;
const MIN_PUBLIC_ASSET_FILES = 16;
const REQUIRED_PUBLIC_CONTROLS = ['_headers', '_redirects', 'robots.txt'];
const REQUIRED_GENERATED_SURFACES = ['build.json'];
const REQUIRED_PUBLIC_CLAIM_CHANNELS = [
  'rendered-text',
  'document-title',
  'metadata-content',
  'accessible-name',
  'alt-title-placeholder-value',
  'public-data-attribute',
  'json-ld',
  'inline-script-copy',
  'textual-asset',
];
const REQUIRED_TEXTUAL_ASSET_EXTENSIONS = [
  '.css',
  '.js',
  '.json',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
];
// Floor prevents an empty registry from making badge checks vacuous.
const MIN_CAPABILITY_REGISTRY_ENTRIES = 1;
// Floor prevents required sentence checks from disappearing silently.
const MIN_REQUIRED_PHRASES = 1;
const H7_DIMENSION_IDS = [
  'scope',
  'price',
  'ongoing_monitoring',
  'removals',
  'data_handling',
  'completion_reporting',
  'limitations',
];
const H7_SOURCE_TYPES = new Set([
  'pricing',
  'plan_coverage',
  'monitoring_reporting',
  'removal_process',
  'privacy_policy',
  'terms',
  'limitations',
]);
const H7_REQUIRED_SOURCE_TYPES = [
  'pricing',
  'plan_coverage',
  'monitoring_reporting',
  'privacy_policy',
  'terms',
];
const H7_ALLOWED_HOSTS = new Set([
  'joindeleteme.com',
  'help.joindeleteme.com',
  'privacy.joindeleteme.com',
  'abine.com',
]);
const H7_CONFIDENCE = new Set(['high', 'medium', 'low']);
const H7_COMPARABILITY = new Set(['not_equivalent', 'narrowly_comparable']);
const H7_MAX_SOURCE_AGE_DAYS = 90;
const AT_REST_EVIDENCE_TIERS = new Set([
  'source-inspected-only',
  'test-proven-only',
]);
const AT_REST_PRODUCT_SOURCE = Object.freeze({
  commit: 'b1e8c10a13622aa2afea39361ed5c4309e168ca5',
  tree: '48c75ceb9b9fc241f0ee95fbc6f8dfe028e8e65b',
});
const AT_REST_CANONICAL_CONTRACT_SHA256 = '6ba87f746f4773f792a451ac354ea5d8452e89d26ee3b92bae2a73e33e30c940';
const AT_REST_RAW_CONTRACT_SHA256 = 'a7468b174b07301873eee1a1a9e5e01f5af30716df2dbb4bac13f65820c83246';
const AT_REST_BACKEND_CONTRACT = new Map(Object.entries({
  'identity-private-key-file': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'source-inspected-only',
    plaintext_possible_at_rest: false,
  },
  'message-store-rows': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'test-proven-only',
    plaintext_possible_at_rest: false,
  },
  'message-store-structure': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'store-attachment-cache': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'test-proven-only',
    plaintext_possible_at_rest: false,
  },
  'peer-map-json': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'membership-json': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'conditional-json-family': {
    retention: 'durable',
    reachability: 'mixed-source-paths',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'renderer-local-storage': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'hub-plaintext-config-family': {
    retention: 'durable',
    reachability: 'mixed-source-paths',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'active-identity-marker': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'provider-profile-storage': {
    retention: 'durable',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'startup-trace-log': {
    retention: 'durable-until-external-cleanup',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: true,
  },
  'hub-encrypted-record-family': {
    retention: 'durable',
    reachability: 'mixed-source-paths',
    public_claimability: 'source-inspected-only',
    plaintext_possible_at_rest: false,
  },
  'decrypted-ui-memory': {
    retention: 'ephemeral',
    reachability: 'production-source-path',
    public_claimability: 'limitation-only',
    plaintext_possible_at_rest: false,
  },
  'notes-json-backend': {
    retention: 'durable-if-wired',
    reachability: 'implemented-unwired',
    public_claimability: 'not-claimable',
    plaintext_possible_at_rest: false,
  },
  'scrub-encrypted-index': {
    retention: 'durable-if-reached',
    reachability: 'source-reachability-unknown',
    public_claimability: 'not-claimable',
    plaintext_possible_at_rest: false,
  },
  'protected-attachment-open': {
    retention: 'ephemeral-if-wired',
    reachability: 'production-source-path',
    public_claimability: 'planned-only',
    plaintext_possible_at_rest: false,
  },
  'qa-diagnostic-artifacts': {
    retention: 'durable-when-qa-enabled',
    reachability: 'qa-only-source-path',
    public_claimability: 'not-claimable',
    plaintext_possible_at_rest: true,
  },
}));
const AT_REST_SOURCE_CONTRACT = new Map(Object.entries({
  'identity-private-key-file': [
    'crates/keystore/src/storage.rs',
    'apps/osl-hub/src/password_lifecycle.rs',
  ],
  'message-store-rows': [
    'crates/store/src/lib.rs',
    'crates/store/src/cipher.rs',
  ],
  'message-store-structure': [
    'crates/store/src/schema.rs',
    'crates/store/src/cipher.rs',
  ],
  'store-attachment-cache': [
    'crates/store/src/lib.rs',
    'crates/ipc/src/commands.rs',
  ],
  'peer-map-json': [
    'crates/ipc/src/peer_map.rs',
    'crates/ipc/src/main_password.rs',
  ],
  'membership-json': [
    'crates/ipc/src/membership.rs',
    'crates/ipc/src/main_password.rs',
  ],
  'conditional-json-family': [
    'crates/ipc/src/main_password.rs',
    'crates/ipc/src/whitelist_state.rs',
    'crates/ipc/src/app_preferences.rs',
    'crates/ipc/src/control_inbox_dead_letter.rs',
    'crates/ipc/src/scope_blobs_file.rs',
    'crates/ipc/src/scope_ttl_file.rs',
    'crates/ipc/src/sender_key_state.rs',
  ],
  'renderer-local-storage': [
    'apps/osl-hub-ui/src/main.ts',
    'apps/osl-hub-ui/src/theme-preference.ts',
  ],
  'hub-plaintext-config-family': [
    'apps/osl-hub/src/preferences.rs',
    'crates/ipc/src/fresh_start.rs',
  ],
  'active-identity-marker': [
    'apps/osl-hub/src/identity_registry.rs',
    'apps/osl-hub/src/main.rs',
  ],
  'provider-profile-storage': [
    'apps/osl-hub/src/service_host.rs',
    'apps/osl-hub/src/native_window_host.rs',
    'apps/osl-hub/src/cleanup.rs',
  ],
  'startup-trace-log': [
    'apps/osl-hub/src/main.rs',
    'apps/osl-hub/src/native_window_host.rs',
  ],
  'hub-encrypted-record-family': [
    'apps/osl-hub/src/security.rs',
    'apps/osl-hub/src/services.rs',
    'apps/osl-hub/src/service_scope_index.rs',
    'apps/osl-hub/src/broker.rs',
    'apps/osl-hub/src/message_expiry.rs',
    'apps/osl-hub/src/peer_attachment_io.rs',
  ],
  'decrypted-ui-memory': [
    'apps/osl-hub/src/external_overlay.rs',
  ],
  'notes-json-backend': [
    'apps/osl-hub/src/osl_notes.rs',
  ],
  'scrub-encrypted-index': [
    'apps/osl-hub/src/scrub_index.rs',
  ],
  'protected-attachment-open': [
    'apps/osl-hub/src/peer_attachment_io.rs',
    'apps/osl-hub/src/native_attachment_transport.rs',
  ],
  'qa-diagnostic-artifacts': [
    'apps/osl-hub/src/discord_qa_inbound_receipt.rs',
    'apps/osl-hub/src/discord_qa_identity.rs',
    'apps/osl-hub/src/native_discord_adapter.rs',
  ],
}));
const AT_REST_CLAIM_CONTRACT = new Map(Object.entries({
  'audit-local-storage-boundary': ['audit.html', 'source-inspected-only'],
  'faq-password-recovery-boundary': ['docs/faq.html', 'source-inspected-only'],
  'faq-shutdown-retention-boundary': ['docs/faq.html', 'test-proven-only'],
  'faq-uninstall-storage-boundary': ['docs/faq.html', 'test-proven-only'],
  'status-at-rest-boundary': ['docs/status.html', 'test-proven-only'],
  'getting-started-password-boundary': ['docs/getting-started.html', 'test-proven-only'],
  'how-keys-live-boundary': ['docs/how-it-works.html', 'source-inspected-only'],
  'privacy-key-storage-boundary': ['docs/privacy.html', 'source-inspected-only'],
  'threat-model-at-rest-boundary': ['docs/threat-model.html', 'test-proven-only'],
}));

function parseAsOf(argv) {
  const matches = argv.filter((arg) => arg.startsWith('--as-of='));
  if (matches.length > 1) {
    console.error('check-claims: --as-of may be supplied only once.');
    process.exit(1);
  }
  const value = matches.length === 1
    ? matches[0].slice('--as-of='.length)
    : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.error('check-claims: --as-of must be an ISO date (YYYY-MM-DD).');
    process.exit(1);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    console.error('check-claims: --as-of must be a real calendar date.');
    process.exit(1);
  }
  return value;
}

const BLOCK_TEXT_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'dialog',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav',
  'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);

const NAMED_HTML_ENTITIES = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['hellip', '…'],
  ['lt', '<'],
  ['mdash', '—'],
  ['nbsp', ' '],
  ['ndash', '–'],
  ['quot', '"'],
]);

function decodeHtmlEntity(entity) {
  const body = entity.slice(1, -1);
  if (/^#\d+$/.test(body)) {
    const codePoint = Number.parseInt(body.slice(1), 10);
    if (Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
      return String.fromCodePoint(codePoint);
    }
  }
  if (/^#x[0-9a-f]+$/i.test(body)) {
    const codePoint = Number.parseInt(body.slice(2), 16);
    if (Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
      return String.fromCodePoint(codePoint);
    }
  }
  return NAMED_HTML_ENTITIES.get(body.toLowerCase()) ?? entity;
}

function renderedTextWithSourceMap(content) {
  // Ignore non-rendered containers and comments while keeping their byte
  // positions available for useful source-line diagnostics.
  const masked = content
    .replace(/<!--[\s\S]*?-->/g, (value) => ' '.repeat(value.length))
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (value) => ' '.repeat(value.length));
  const chars = [];
  const sourceIndexes = [];

  function append(value, sourceIndex) {
    for (const char of value) {
      chars.push(char);
      sourceIndexes.push(sourceIndex);
    }
  }

  for (let index = 0; index < masked.length;) {
    if (masked[index] === '<') {
      const end = masked.indexOf('>', index + 1);
      if (end !== -1) {
        const tag = masked.slice(index, end + 1).match(/^<\s*\/?\s*([a-z][a-z0-9:-]*)\b/i);
        if (tag && BLOCK_TEXT_TAGS.has(tag[1].toLowerCase())) append('\n', index);
        index = end + 1;
        continue;
      }
    }
    if (masked[index] === '&') {
      const entity = masked.slice(index).match(/^&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i);
      if (entity) {
        append(decodeHtmlEntity(entity[0]), index);
        index += entity[0].length;
        continue;
      }
    }
    append(masked[index], index);
    index += 1;
  }

  return { text: chars.join(''), sourceIndexes };
}

function semanticGrantDurationErrors(fileRel, content, intendedGrantDays) {
  if (!Number.isInteger(intendedGrantDays) || intendedGrantDays <= 0) return [];

  const rendered = renderedTextWithSourceMap(content);
  const dayCount = escapeRegExp(String(intendedGrantDays));
  const duration = new RegExp(
    `(?:\\b(?:${dayCount}|thirty)\\s*(?:-|\\s)\\s*(?:calendar\\s+)?days?\\b|\\b(?:one|1|a)\\s*(?:-|\\s)\\s*(?:full\\s+)?month\\b|\\bmonth[-\\s]long\\b)`,
    'i',
  );
  const credential = /\b(?:codes?|licen[cs]es?|(?:(?:activation|product|redemption|paid|prepaid|pro|licen[cs]e)[-\s]+){1,3}(?:keys?|tokens?|vouchers?))\b/i;
  const entitlementContext = /\b(?:pro|access|entitlement|grant(?:s|ed|ing)?|giv(?:e|es|en|ing)|provid(?:e|es|ed|ing)|unlock(?:s|ed|ing)?|activat(?:e|es|ed|ing)|redeem(?:s|ed|ing)?|duration|valid\s+for|last(?:s|ed|ing)?)\b/i;
  const explicitNonimplementation = /\b(?:unimplemented|not\s+(?:yet\s+)?implemented|does\s+not|doesn't|do\s+not|don't|cannot|can't|paused\s+until|no\s+(?:redemption|expiry|duration)\s+(?:record|clock|timestamp|enforcement)|without\s+(?:an?\s+)?(?:redemption|expiry|duration)\s+(?:record|clock|timestamp)?|currently\s+(?:grants?|unlocks?)\s+(?:pro\s+)?(?:for\s+)?lifetime)\b/i;
  const plannedContract = /(?:\b(?:grant(?:ing)?|duration|entitlement|access|feature|codes?|keys?|tokens?|vouchers?|licen[cs]es?)\b.{0,100}\b(?:is|are|remain|remains)\s+(?:an?\s+)?planned(?:\s+(?:feature|capability|contract)|\s+to\s+(?:provide|grant|give|unlock|include|offer))?\b|\bplanned\b.{0,100}\b(?:grant|duration|entitlement|access|feature)\b)/i;
  const presentGrantAssertion = /\b(?:grants?|gives?|provides?|unlocks?|includes?|comes?\s+with|lasts?|(?:is|are)\s+valid\s+for)\b/i;
  const genericPlannedContract = /\b(?:is|are|remain|remains)\s+(?:an?\s+)?planned(?:\s+(?:feature|capability|contract)|\s+to\s+(?:provide|grant|give|unlock|include|offer))?\b/i;
  const conditionalOnImplementation = /\b(?:(?:if|once|after|when|provided(?:\s+that)?)\s+(?:automatic\s+)?(?:expiry|redemption|duration)\b.{0,100}\b(?:is\s+)?implemented|(?:automatic\s+)?(?:expiry|redemption|duration)\b.{0,100}\b(?:is\s+)?implemented\s+(?:first|beforehand))\b/i;
  const ADJACENT_SOURCE_GAP_MAX = 360;
  const ADJACENT_TEXT_MAX = 420;
  const errors = [];

  function honestLimitation(text) {
    if (explicitNonimplementation.test(text)) return true;
    if (plannedContract.test(text)) return true;
    if (genericPlannedContract.test(text) && !presentGrantAssertion.test(text)) return true;
    if (conditionalOnImplementation.test(text)) return true;
    return false;
  }

  function record(start, text) {
    const sourceIndex = rendered.sourceIndexes[start] ?? 0;
    errors.push({
      kind: 'unimplemented grant-duration claim',
      file: fileRel,
      line: lineNumber(content, sourceIndex),
      text: `${shortText(text)} -- paid-code duration and expiry are not implemented`,
    });
  }

  const sentences = [...rendered.text.matchAll(/[^.!?;\n]+[.!?;]?/g)].map((sentence) => ({
    start: sentence.index,
    end: sentence.index + sentence[0].length,
    sourceStart: rendered.sourceIndexes[sentence.index] ?? 0,
    sourceEnd: rendered.sourceIndexes[sentence.index + sentence[0].length - 1] ?? 0,
    text: sentence[0].replace(/\s+/g, ' ').trim(),
  })).filter((sentence) => sentence.text);

  for (const sentence of sentences) {
    if (!duration.test(sentence.text) || !credential.test(sentence.text)) continue;
    if (honestLimitation(sentence.text)) continue;
    record(sentence.start, sentence.text);
  }

  // Join exactly one neighboring rendered-text segment in either direction.
  // The context requirement prevents an unrelated refund window from being
  // treated as a Pro grant, while still catching “code grants Pro. It lasts…”
  // and “Pro lasts… Use the product key.”
  for (let i = 0; i + 1 < sentences.length; i += 1) {
    const first = sentences[i];
    const second = sentences[i + 1];
    if (first.text.endsWith(';')) continue;
    const sourceGap = second.sourceStart - first.sourceEnd;
    if (sourceGap < 0 || sourceGap > ADJACENT_SOURCE_GAP_MAX) continue;
    const combined = `${first.text} ${second.text}`;
    if (combined.length > ADJACENT_TEXT_MAX) continue;
    if (!credential.test(combined) || !duration.test(combined) || !entitlementContext.test(combined)) continue;
    if (honestLimitation(combined)) continue;
    record(first.start, combined);
  }

  return errors;
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

async function walkedFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkedFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort();
}

async function discoverPublicSurface() {
  const rootEntries = await readdir(ROOT, { withFileTypes: true });
  const html = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name);
  html.push(...(await walkedFiles(path.join(ROOT, 'docs')))
    .filter((file) => file.toLowerCase().endsWith('.html'))
    .map((file) => rel(file)));
  const assets = (await walkedFiles(path.join(ROOT, 'assets'))).map((file) => rel(file));
  const rootFiles = new Set(rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const controls = REQUIRED_PUBLIC_CONTROLS.filter((name) => rootFiles.has(name));
  const generatedSourceFiles = REQUIRED_GENERATED_SURFACES.filter((name) => rootFiles.has(name));
  return {
    html: html.sort(),
    assets: assets.sort(),
    controls: controls.sort(),
    generated: [...REQUIRED_GENERATED_SURFACES],
    generatedSourceFiles,
  };
}

function validatePublicSurfaceManifest(manifest, discovered) {
  const errors = [];
  const add = (code, text) => errors.push(`PUBLIC_SURFACE_${code}: ${text}`);
  if (manifest?.schema_version !== 1 || manifest?.manifest_id !== 'osl-public-surface') {
    add('SCHEMA', 'schema_version 1 and manifest_id osl-public-surface are required');
  }
  const exactList = (field, actual, minimum) => {
    const declared = manifest?.[field];
    if (!Array.isArray(declared)
        || declared.length < minimum
        || new Set(declared).size !== declared.length
        || JSON.stringify([...declared].sort()) !== JSON.stringify(actual)) {
      add('CENSUS', `${field} must exactly equal recursive discovery and retain a floor of ${minimum}`);
    }
  };
  exactList('html', discovered.html, MIN_PUBLIC_HTML_FILES);
  exactList('assets', discovered.assets, MIN_PUBLIC_ASSET_FILES);
  exactList('controls', discovered.controls, REQUIRED_PUBLIC_CONTROLS.length);
  exactList('generated', discovered.generated, REQUIRED_GENERATED_SURFACES.length);
  if (JSON.stringify(discovered.controls) !== JSON.stringify([...REQUIRED_PUBLIC_CONTROLS].sort())) {
    add('CONTROL', 'all three root controls must exist');
  }
  if (discovered.generatedSourceFiles.length > 0) {
    add('GENERATED', 'build.json must be generated into the artifact, never present in source');
  }
  if (JSON.stringify(manifest?.claim_channels) !== JSON.stringify(REQUIRED_PUBLIC_CLAIM_CHANNELS)) {
    add('CHANNELS', 'claim_channels must retain the exact public text and metadata channel contract');
  }
  if (JSON.stringify(manifest?.textual_asset_extensions) !== JSON.stringify(REQUIRED_TEXTUAL_ASSET_EXTENSIONS)) {
    add('CHANNELS', 'textual_asset_extensions must retain the exact scan contract');
  }
  return errors;
}

function htmlFiles(manifest) {
  return manifest.html.map((name) => path.join(ROOT, name));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSingleWord(value) {
  return !/\s/.test(value);
}

function lineNumber(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function markerSpans(content) {
  const spans = [];
  for (const match of content.matchAll(MARKER_RE)) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

function insideAnySpan(index, spans) {
  return spans.some(([start, end]) => index >= start && index < end);
}

function allowedLiabilityCap(fileRel, content, matchIndex, value) {
  if (fileRel !== 'docs/terms.html' || value !== '$50') return false;
  const windowStart = Math.max(0, matchIndex - 200);
  const windowEnd = Math.min(content.length, matchIndex + value.length + 200);
  return /\bliability\b/i.test(content.slice(windowStart, windowEnd));
}

function forbiddenPatterns(forbiddenClaims) {
  return forbiddenClaims.map((claim) => {
    const escaped = escapeRegExp(claim);
    const source = isSingleWord(claim)
      ? `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`
      : escaped;
    return {
      claim,
      billing: /(?:\$5|once|one[- ]time|renew|cancel|subscription)/i.test(claim),
      regex: new RegExp(source, 'gi'),
    };
  });
}

// Denying a property is honest copy, not a violation: "No subscription." and
// "does not create a recurring subscription" must pass, while "Manage your
// subscription" must fail.
function negatedClaim(content, index, matched, policy = {}) {
  const aware = (policy.negation_aware || []).map((word) => word.toLowerCase());
  if (aware.length === 0) return false;
  const hit = matched.toLowerCase().trim();
  if (!aware.some((word) => hit === word || hit.includes(word))) return false;

  const negators = policy.negators || ['no ', 'not ', 'never', "n't", 'without', 'nothing'];
  const windowSize = Number.isInteger(policy.negation_window) ? policy.negation_window : 48;
  const start = Math.max(0, index - windowSize);
  const before = content.slice(start, index).replace(/<[^>]*>/g, ' ').toLowerCase();
  return negators.some((negator) => before.includes(negator.toLowerCase()));
}

function labelledElements(content, policy = {}) {
  const featureAttr = policy.feature_id_attribute || 'data-osl-feature';
  const statusAttr = policy.status_badge_attribute || 'data-osl-status';
  const tagRe = new RegExp(`<[a-z][^>]*\\b${escapeRegExp(featureAttr)}\\s*=\\s*["'][^"']*["'][^>]*>`, 'gi');
  const featureRe = new RegExp(`\\b${escapeRegExp(featureAttr)}\\s*=\\s*["']([^"']*)["']`, 'i');
  const statusRe = new RegExp(`\\b${escapeRegExp(statusAttr)}\\s*=\\s*["']([^"']*)["']`, 'i');

  const found = [];
  for (const match of content.matchAll(tagRe)) {
    const tag = match[0];
    const feature = tag.match(featureRe)?.[1]?.trim() ?? '';
    const status = tag.match(statusRe)?.[1]?.trim() ?? '';
    found.push({ feature, status, index: match.index });
  }
  return found;
}

function shortText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function rawSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function visibleHtml(content) {
  return content
    .replace(/<!--[\s\S]*?-->/g, (value) => ' '.repeat(value.length))
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (value) => ' '.repeat(value.length));
}

function atRestClaimElements(content) {
  const visible = visibleHtml(content);
  const elementRe = /<([a-z][a-z0-9:-]*)\b([^>]*\bdata-osl-at-rest-claim\s*=\s*["'][^"']+["'][^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  const idRe = /\bdata-osl-at-rest-claim\s*=\s*["']([^"']+)["']/i;
  const refsRe = /\bdata-osl-at-rest-backends\s*=\s*["']([^"']*)["']/i;
  const elements = [];
  for (const match of visible.matchAll(elementRe)) {
    const attrs = match[2];
    elements.push({
      id: attrs.match(idRe)?.[1]?.trim() ?? '',
      backendRefs: shortText(attrs.match(refsRe)?.[1] ?? '').split(' ').filter(Boolean),
      text: shortText(renderedTextWithSourceMap(match[3]).text),
      index: match.index ?? 0,
      html: match[0],
      hidden: /\bhidden(?:\s|=|>|$)|\baria-hidden\s*=\s*["']true["']/i.test(attrs),
    });
  }
  return elements;
}

function falseIdentityPasswordMechanism(text) {
  const normalized = shortText(text);
  const clauses = normalized
    .split(/\b(?:but|while|although|whereas|yet|however)\b/i)
    .map(shortText)
    .filter(Boolean);
  return clauses.some((clause) => {
    const identity = String.raw`\b(?:private\s+)?identity\s+(?:private\s+)?keys?\b`;
    const password = String.raw`\b(?:(?:your|the|main|OSL)\s+)*(?:password|passphrase)\b`;
    const protectedForm = String.raw`(?:encrypt(?:ed)?|seal(?:ed)?|protect(?:ed)?|secur(?:ed)?)`;
    const passiveRelationship = new RegExp(
      `${identity}\\s+(?:(?:is|are|was|were|be|been|remain(?:s|ed)?|stay(?:s|ed)?|get(?:s)?|got|become(?:s)?)\\s+)?`
        + `${protectedForm}(?:\\s+at[-\\s]+rest)?\\s+(?:(?:with|by|under|via)\\s+`
        + `(?:(?:a|the)\\s+key\\s+derived\\s+from\\s+)?${password}`
        + `|using\\s+(?:(?:a|the)\\s+)?(?:key\\s+derived\\s+from\\s+)?${password})`,
      'i',
    );
    const activeRelationship = new RegExp(
      `${password}\\s+(?:(?:directly|itself)\\s+)?(?:encrypt(?:s|ed|ing)?|seal(?:s|ed|ing)?|protect(?:s|ed|ing)?|secur(?:e|es|ed|ing))`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:the\\s+)?${identity}`,
      'i',
    );
    const usedToRelationship = new RegExp(
      `${password}\\s+(?:is|was|gets?|got)\\s+used\\s+to\\s+`
        + `(?:encrypt|seal|protect|secure)(?:\\s+at[-\\s]+rest)?\\s+(?:the\\s+)?${identity}`,
      'i',
    );
    const nounRelationship = new RegExp(
      `\\b(?:encryption|sealing|protection|security)\\s+(?:of|for)\\s+(?:the\\s+)?${identity}`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:is\\s+)?`
        + `(?:uses?|relies\\s+on|depends\\s+on|based\\s+on)\\s+${password}`,
      'i',
    );
    const premodifierNounRelationship = new RegExp(
      `${identity}\\s+(?:encryption|sealing|protection|security)`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:uses?|relies\\s+on|depends\\s+on)\\s+${password}`,
      'i',
    );
    const derivedKeyRelationship = new RegExp(
      `\\b(?:a|the)?\\s*key\\s+derived\\s+from\\s+${password}\\s+`
        + `(?:encrypt(?:s|ed|ing)?|seal(?:s|ed|ing)?|protect(?:s|ed|ing)?|secur(?:e|es|ed|ing))`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:the\\s+)?${identity}`,
      'i',
    );
    const passwordDerivedAdjectiveRelationship = new RegExp(
      `${identity}\\s+(?:(?:is|are|was|were|be|been)\\s+)?${protectedForm}`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:with|by|under)\\s+(?:a\\s+|the\\s+)?`
        + `(?:main[-\\s]+password|password|passphrase)[-\\s]+derived\\s+key`,
      'i',
    );
    const activePasswordDerivedAdjectiveRelationship = new RegExp(
      `\\b(?:a|the)?\\s*(?:main[-\\s]+password|password|passphrase)[-\\s]+derived\\s+key\\s+`
        + `(?:encrypt(?:s|ed|ing)?|seal(?:s|ed|ing)?|protect(?:s|ed|ing)?|secur(?:e|es|ed|ing))`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:the\\s+)?${identity}`,
      'i',
    );
    const passwordBasedKeyRelationship = new RegExp(
      `${identity}\\s+(?:(?:is|are|was|were|be|been)\\s+)?${protectedForm}`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:with|by|under|via)\\s+(?:a\\s+|the\\s+)?`
        + `(?:main[-\\s]+password|password|passphrase)[-\\s]+based\\s+key`,
      'i',
    );
    const passwordDerivedEncryptionRelationship = new RegExp(
      `\\b(?:main[-\\s]+password|password|passphrase)[-\\s]+(?:derived|based)\\s+`
        + `(?:encryption|sealing|protection|security)\\s+`
        + `(?:encrypt(?:s|ed|ing)?|seal(?:s|ed|ing)?|protect(?:s|ed|ing)?|secur(?:e|es|ed|ing))`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:the\\s+)?${identity}`,
      'i',
    );
    const identityUsesPasswordBasedEncryption = new RegExp(
      `${identity}\\s+(?:uses?|relies\\s+on|depends\\s+on)\\s+(?:a\\s+|the\\s+)?`
        + `(?:main[-\\s]+password|password|passphrase)[-\\s]+(?:derived|based)\\s+`
        + `(?:encryption|sealing|protection|security)`,
      'i',
    );
    const keyedEncryptionRelationship = new RegExp(
      `${identity}\\s+(?:encryption|sealing|protection|security)`
        + `(?:\\s+at[-\\s]+rest)?\\s+(?:is\\s+|was\\s+)?(?:keyed|derived)\\s+`
        + `(?:by|from)\\s+(?:material\\s+derived\\s+from\\s+)?${password}`,
      'i',
    );
    return passiveRelationship.test(clause)
      || activeRelationship.test(clause)
      || usedToRelationship.test(clause)
      || nounRelationship.test(clause)
      || premodifierNounRelationship.test(clause)
      || derivedKeyRelationship.test(clause)
      || passwordDerivedAdjectiveRelationship.test(clause)
      || activePasswordDerivedAdjectiveRelationship.test(clause)
      || passwordBasedKeyRelationship.test(clause)
      || passwordDerivedEncryptionRelationship.test(clause)
      || identityUsesPasswordBasedEncryption.test(clause)
      || keyedEncryptionRelationship.test(clause);
  });
}

const AT_REST_BACKEND_MENTIONS = [
  ['identity-private-key-file', /\b(?:private\s+)?identity\s+(?:private\s+)?keys?\b/i],
  ['message-store-rows', /\bmessage[-\s]+store\s+values?\b/i],
  ['message-store-structure', /\bSQLite\s+(?:structure|row counts?|order|burn timing|sizes?)\b/i],
  ['store-attachment-cache', /\battachment[-\s]+cache\b/i],
  ['peer-map-json', /\bpeer[-\s]+map\b/i],
  ['membership-json', /\bmembership\b/i],
  ['conditional-json-family', /\bconditional\s+JSON\b/i],
  ['renderer-local-storage', /\brenderer\s+localStorage\b/i],
  ['hub-plaintext-config-family', /\bHub\s+configuration\b/i],
  ['active-identity-marker', /\bactive[-\s]+slot\s+marker\b/i],
  ['provider-profile-storage', /\bprovider[-\s]+managed\s+profiles?\b/i],
  ['startup-trace-log', /\b(?:startup[-\s]+(?:trace|log|breadcrumb)|trace[-\s]+log)\b/i],
  ['hub-encrypted-record-family', /\bHub\s+record\s+writers?\b/i],
  ['decrypted-ui-memory', /\bopened\s+plaintext\b/i],
  ['qa-diagnostic-artifacts', /\b(?:QA[-\s]+receipts?|diagnostic[-\s]+logs?|receipt[-\s]+ledgers?|diagnostic[-\s]+artifacts?)\b/i],
];

function unsupportedAtRestBackendAffirmation(text) {
  const normalized = shortText(text);
  const namedUnsupported = /\b(?:Notes?|Scrub(?:[-\s]+index)?|LAN|QA[-\s]+receipts?|diagnostic[-\s]+logs?|receipt[-\s]+ledgers?|diagnostic[-\s]+artifacts?)\b/i.test(normalized);
  const storageAssertion = /\b(?:backend|index|store|storage|file|record|receipt|ledger|log|artifact)\b/i.test(normalized)
    && /\b(?:encrypt(?:s|ed|ing)?|seal(?:s|ed|ing)?|protect(?:s|ed|ing)?|ciphertext|plain[-\s]*text|writes?|persists?|retains?)\b/i.test(normalized);
  const limitation = /\b(?:excluded|unproved|unwired|unknown|Planned|QA[-\s]+only|not[-\s]+claimable|does\s+not|doesn't|cannot|can't|no\s+present[-\s]+tense)\b/i.test(normalized);
  return namedUnsupported && storageAssertion && !limitation;
}

function atRestBackendReferenceErrors(text, backendRefs) {
  const errors = [];
  const refs = new Set(backendRefs);
  const sentences = shortText(text).split(/[.!?;]+/).map(shortText).filter(Boolean);
  for (const sentence of sentences) {
    if (unsupportedAtRestBackendAffirmation(sentence)) {
      errors.push('implemented-unwired, unknown, or Planned backend asserted as present-tense public storage truth');
    }
    const assertion = /\b(?:encrypt(?:s|ed|ing)?|seal(?:s|ed|ing)?|protect(?:s|ed|ing)?|ciphertext|plain[-\s]*text|visible|require(?:s|d)?\s+the\s+file[-\s]+storage\s+key|opened)\b/i.test(sentence);
    if (!assertion) continue;
    for (const [backendId, pattern] of AT_REST_BACKEND_MENTIONS) {
      if (pattern.test(sentence) && !refs.has(backendId)) {
        errors.push(`${backendId} is asserted but absent from backend_refs`);
      }
    }
  }
  return errors;
}

function atRestSemanticTripwire(text) {
  const normalized = shortText(text);
  if (!normalized) return false;
  const explicitAtRest = /\bat[-\s]+rest\b|\bon[-\s]+disk\b|\bfilesystem\b|\bmessage[-\s]+store\b/i;
  const localContext = /\b(?:local(?:ly)?\s+(?:state|data|information|records?|storage|metadata|preferences?|settings?|profile|history|files?|content|cache|database)|on[-\s]+device|on\s+(?:this|your|the)\s+(?:device|computer|machine)|on\s+your\s+own\s+computer|whole[-\s]+profile|localstorage)\b/i;
  const protectionAssertion = /\b(?:(?:is|are|was|were|be|been|remain(?:s)?|stay(?:s)?|become(?:s)?|can\s+be|may\s+be)\s+(?:always\s+|never\s+|fully\s+|entirely\s+)?(?:encrypt(?:ed)?|decrypt(?:ed)?|seal(?:ed)?|ciphertext|cleartext|plain[-\s]*text|password[-\s]*(?:protected|sealed|gated)|protected\s+with\s+(?:a\s+)?password|unreadable|opaque|in\s+the\s+clear)|encrypt(?:s|ed|ing)?|decrypt(?:s|ed|ing)?|seal(?:s|ed|ing)?|never\s+(?:writes?|stores?|retains?)\s+.{0,60}\b(?:plaintext|cleartext|in\s+the\s+clear))\b/i;
  const sentences = normalized.split(/[.!?;]+/).map(shortText).filter(Boolean);
  return sentences.some((sentence) => (
    falseIdentityPasswordMechanism(sentence)
      || unsupportedAtRestBackendAffirmation(sentence)
      || (explicitAtRest.test(sentence) && protectionAssertion.test(sentence))
      || (localContext.test(sentence) && protectionAssertion.test(sentence))
  ));
}

function htmlAttributeValue(attrs, name) {
  const match = attrs.match(new RegExp(
    `\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    'i',
  ));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function decodeJavaScriptString(raw) {
  const quote = raw[0];
  const body = raw.slice(1, -1);
  if (quote === '`' && body.includes('${')) return null;
  return body.replace(
    /\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([0btnvfr\\'"`]))/gi,
    (_match, codePoint, unicode, hex, simple) => {
      if (codePoint) return String.fromCodePoint(Number.parseInt(codePoint, 16));
      if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
      if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
      return {
        0: '\0',
        b: '\b',
        t: '\t',
        n: '\n',
        v: '\v',
        f: '\f',
        r: '\r',
        '\\': '\\',
        "'": "'",
        '"': '"',
        '`': '`',
      }[simple] ?? simple;
    },
  );
}

function stripJavaScriptComments(content) {
  let result = '';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (quote) {
      result += char;
      if (!escaped && char === quote) quote = '';
      if (!escaped && char === '\\') escaped = true;
      else escaped = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      result += char;
      continue;
    }
    if (char === '/' && next === '/') {
      result += '  ';
      index += 2;
      while (index < content.length && content[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      if (index < content.length) result += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < content.length
          && !(content[index] === '*' && content[index + 1] === '/')) {
        result += content[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < content.length) {
        result += '  ';
        index += 1;
      }
      continue;
    }
    result += char;
  }
  return result;
}

function stripTemplateInterpolationComments(body) {
  let result = '';
  let depth = 0;
  let expressionQuote = '';
  let expressionEscaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (depth > 0 && expressionQuote) {
      result += char;
      if (!expressionEscaped && char === expressionQuote) expressionQuote = '';
      if (!expressionEscaped && char === '\\') expressionEscaped = true;
      else expressionEscaped = false;
      continue;
    }
    if (char === '$' && next === '{') {
      depth += 1;
      result += '${';
      index += 1;
      continue;
    }
    if (depth > 0 && (char === '"' || char === "'")) {
      expressionQuote = char;
      expressionEscaped = false;
      result += char;
      continue;
    }
    if (depth > 0 && char === '}') depth -= 1;
    if (depth > 0 && char === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < body.length
          && !(body[index] === '*' && body[index + 1] === '/')) {
        result += body[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < body.length) {
        result += '  ';
        index += 1;
      }
      continue;
    }
    if (depth > 0 && char === '/' && next === '/') {
      result += '  ';
      index += 2;
      while (index < body.length && body[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      if (index < body.length) result += '\n';
      continue;
    }
    result += char;
  }
  return result;
}

function evaluateStaticTemplateLiteral(raw, bindings) {
  let body = stripTemplateInterpolationComments(raw.slice(1, -1));
  for (let pass = 0; pass < 32 && body.includes('${'); pass += 1) {
    let failed = false;
    let replaced = false;
    body = body.replace(/\$\{([^{}]*)\}/g, (_match, expression) => {
      const value = evaluateStaticJavaScriptExpression(
        stripJavaScriptComments(expression),
        bindings,
      );
      if (typeof value !== 'string') {
        failed = true;
        return '';
      }
      replaced = true;
      return value;
    });
    if (failed || !replaced) return null;
  }
  if (body.includes('${')) return null;
  return decodeJavaScriptString(`\`${body}\``);
}

function tokenizeStaticJavaScriptExpression(expression, bindings) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      let end = index + 1;
      let escaped = false;
      if (quote === '`') {
        end = expression.length - 1;
        while (end > index && expression[end] !== '`') end -= 1;
      }
      while (end < expression.length) {
        const current = expression[end];
        if (!escaped && current === quote) break;
        if (!escaped && current === '\\') escaped = true;
        else escaped = false;
        end += 1;
      }
      if (end >= expression.length) return null;
      const raw = expression.slice(index, end + 1);
      const value = quote === '`'
        ? evaluateStaticTemplateLiteral(raw, bindings)
        : decodeJavaScriptString(raw);
      if (value === null) return null;
      tokens.push({ type: 'string', value });
      index = end + 1;
      continue;
    }
    const identifier = expression.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    if (expression.startsWith('...', index)) {
      tokens.push({ type: '...', value: '...' });
      index += 3;
      continue;
    }
    if ('+.,()[]'.includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

function evaluateStaticJavaScriptExpression(expression, bindings) {
  const tokens = tokenizeStaticJavaScriptExpression(expression, bindings);
  if (!tokens) return null;
  let index = 0;
  const accept = (type) => {
    if (tokens[index]?.type !== type) return false;
    index += 1;
    return true;
  };
  const parseExpression = () => {
    let value = parsePostfix();
    if (value === null) return null;
    while (accept('+')) {
      const right = parsePostfix();
      if (typeof value !== 'string' || typeof right !== 'string') return null;
      value += right;
    }
    return value;
  };
  const parsePrimary = () => {
    const token = tokens[index];
    if (token?.type === 'string') {
      index += 1;
      return token.value;
    }
    if (token?.type === 'identifier' && bindings.has(token.value)) {
      index += 1;
      return bindings.get(token.value);
    }
    if (accept('[')) {
      const value = [];
      if (!accept(']')) {
        do {
          const item = parseExpression();
          if (item === null) return null;
          value.push(item);
        } while (accept(','));
        if (!accept(']')) return null;
      }
      return value;
    }
    if (accept('(')) {
      const value = parseExpression();
      if (value === null || !accept(')')) return null;
      return value;
    }
    return null;
  };
  function parsePostfix() {
    let value = parsePrimary();
    if (value === null) return null;
    while (accept('.')) {
      const method = tokens[index];
      if (method?.type !== 'identifier'
          || !['concat', 'join'].includes(method.value)) return null;
      index += 1;
      if (!accept('(')) return null;
      const args = [];
      if (!accept(')')) {
        do {
          const argument = parseExpression();
          if (argument === null) return null;
          args.push(argument);
        } while (accept(','));
        if (!accept(')')) return null;
      }
      if (method.value === 'join') {
        if (!Array.isArray(value)
            || args.length > 1
            || args.some((argument) => typeof argument !== 'string')
            || value.some((item) => typeof item !== 'string')) return null;
        value = value.join(args[0] ?? ',');
      } else if (Array.isArray(value)) {
        value = value.concat(...args);
      } else {
        if (typeof value !== 'string'
            || args.some((argument) => typeof argument !== 'string')) return null;
        value += args.join('');
      }
    }
    return value;
  }
  const value = parseExpression();
  return value !== null && index === tokens.length ? value : null;
}

function balancedCallArguments(content, callStart) {
  const open = content.indexOf('(', callStart);
  if (open < 0) return null;
  let quote = '';
  let escaped = false;
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (!escaped && char === quote) quote = '';
      if (!escaped && char === '\\') escaped = true;
      else escaped = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return content.slice(open + 1, index);
    }
  }
  return null;
}

function splitTopLevelJavaScriptArguments(argumentsSource) {
  const values = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < argumentsSource.length; index += 1) {
    const char = argumentsSource[index];
    if (quote) {
      if (!escaped && char === quote) quote = '';
      if (!escaped && char === '\\') escaped = true;
      else escaped = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      values.push(argumentsSource.slice(start, index));
      start = index + 1;
    }
  }
  values.push(argumentsSource.slice(start));
  return values;
}

function canonicalStaticJavaScriptReceiver(receiver, aliases, bindings) {
  let canonical = receiver
    .replace(/\?\./g, '.')
    .replace(/\.\[/g, '[')
    .replace(/\[\s*["'`]([A-Za-z_$][A-Za-z0-9_$]*)["'`]\s*\]/g, '.$1')
    .replace(/\s+/g, '');
  canonical = canonical.replace(
    /\[([A-Za-z_$][A-Za-z0-9_$]*)\]/g,
    (match, name) => {
      const value = bindings.get(name);
      return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
        ? `.${value}`
        : match;
    },
  );
  canonical = canonical.replace(/^(?:window|globalThis)\.document(?=[.(]|$)/, 'document');
  canonical = canonical.replace(
    /(querySelector|getElementById)\((["'`])([^"'`]*)\2\)/g,
    (_match, method, _quote, value) => `${method}(${JSON.stringify(value)})`,
  );
  canonical = canonical.replace(
    /(querySelector|getElementById)\(([A-Za-z_$][A-Za-z0-9_$]*)\)/g,
    (match, method, name) => {
      const value = bindings.get(name);
      return typeof value === 'string'
        ? `${method}(${JSON.stringify(value)})`
        : match;
    },
  );
  canonical = canonical.replace(/^document\.querySelector\("body"\)$/, 'document.body');
  for (let pass = 0; pass <= aliases.size; pass += 1) {
    const root = canonical.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
    if (!root || !aliases.has(root)) break;
    canonical = aliases.get(root) + canonical.slice(root.length);
  }
  return canonical;
}

function staticJavaScriptScopeStart(source, end) {
  const stack = [-1];
  let quote = '';
  let escaped = false;
  for (let index = 0; index < end; index += 1) {
    const char = source[index];
    if (quote) {
      if (!escaped && char === quote) quote = '';
      if (!escaped && char === '\\') escaped = true;
      else escaped = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      stack.push(index);
    } else if (char === '}' && stack.length > 1) {
      stack.pop();
    }
  }
  return stack.at(-1);
}

function staticJavaScriptSinkReceiver(
  source,
  memberIndex,
  computedMember,
  bindings,
  aliases,
  shadowedNames,
) {
  let prefix = source.slice(0, memberIndex).replace(/\s+$/, '');
  if (!computedMember) prefix = prefix.replace(/(?:\?\.|\.)\s*$/, '');
  const parenthesized = prefix.match(
    /(?<![A-Za-z0-9_$])\(\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\s*(?:\??\.\s*[A-Za-z_$][A-Za-z0-9_$]*|(?:\?\.)?\[\s*["'`][A-Za-z_$][A-Za-z0-9_$]*["'`]\s*\]))*)\s*\)\s*$/,
  );
  if (parenthesized) prefix = parenthesized[1];
  const callReceiver = prefix.match(
    /((?:(?:window|globalThis)\s*(?:\?\.|\.)\s*)?document(?:\s*(?:\?\.|\.)\s*(?:querySelector|getElementById)\s*\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[A-Za-z_$][A-Za-z0-9_$]*)\s*\))+)\s*$/,
  );
  const match = callReceiver ?? prefix.match(
    /([A-Za-z_$][A-Za-z0-9_$]*(?:\s*(?:\??\.\s*[A-Za-z_$][A-Za-z0-9_$]*|(?:\?\.)?\[\s*(?:["'`][^"'`]*["'`]|[A-Za-z_$][A-Za-z0-9_$]*)\s*\]))*)\s*$/,
  );
  if (!match) return `@unknown:${memberIndex}`;
  const receiver = match[1];
  const root = receiver.match(/[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
  const canonical = canonicalStaticJavaScriptReceiver(receiver, aliases, bindings);
  return root && shadowedNames.has(root)
    ? `${canonical}#scope:${staticJavaScriptScopeStart(source, memberIndex)}`
    : canonical;
}

function staticJavaScriptTextSinkValues(content) {
  const source = stripJavaScriptComments(content);
  const bindings = new Map();
  const emptyNodeBindings = new Set();
  const createdTextNodeValues = new Map();
  const declarations = [];
  for (const statement of source.matchAll(/\b(?:const|let|var)\s+([^;]+)/g)) {
    for (const declarator of splitTopLevelJavaScriptArguments(statement[1])) {
      const match = declarator.match(
        /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]+?)\s*$/,
      );
      if (match) declarations.push({ name: match[1], expression: match[2] });
    }
  }
  for (const statement of source.matchAll(/\b(?:const|let|var)\s+([^\n;]+)/g)) {
    for (const declarator of splitTopLevelJavaScriptArguments(statement[1])) {
      const match = declarator.match(
        /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]+?)\s*$/,
      );
      if (match) declarations.push({ name: match[1], expression: match[2] });
    }
  }
  for (const declaration of declarations) {
    const textNode = declaration.expression.match(
      /^(?:document\.)?createTextNode\s*\(([\s\S]*)\)$/,
    );
    if (/^(?:document\.)?createElement\s*\(\s*["'][a-z][a-z0-9:-]*["']\s*\)$/i
      .test(declaration.expression)
        || /^(?:document\.)?createDocumentFragment\s*\(\s*\)$/i
          .test(declaration.expression)
        || textNode) {
      emptyNodeBindings.add(declaration.name);
      if (textNode) createdTextNodeValues.set(declaration.name, textNode[1]);
    }
  }
  const createdNodeBindings = new Set(emptyNodeBindings);
  const createdNodeAliases = new Map(
    [...createdNodeBindings].map((binding) => [binding, binding]),
  );
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (createdNodeAliases.has(declaration.name)) continue;
      const canonical = createdNodeAliases.get(declaration.expression.trim());
      if (!canonical) continue;
      createdNodeAliases.set(declaration.name, canonical);
      createdNodeBindings.add(declaration.name);
      changed = true;
    }
    if (!changed) break;
  }
  const canonicalCreatedNode = (expression) => (
    createdNodeAliases.get(expression.trim()) ?? expression.trim()
  );
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (bindings.has(declaration.name)) continue;
      const value = evaluateStaticJavaScriptExpression(declaration.expression, bindings);
      if (value === null) continue;
      bindings.set(declaration.name, value);
      changed = true;
    }
    if (!changed) break;
  }
  const populatedNodeBindings = new Set();
  for (const [binding, expression] of createdTextNodeValues) {
    const value = evaluateStaticJavaScriptExpression(expression, bindings);
    createdTextNodeValues.set(binding, value);
    if (typeof value === 'string' && value.length > 0) {
      emptyNodeBindings.delete(binding);
      populatedNodeBindings.add(binding);
    }
  }
  for (const binding of [...createdNodeAliases.keys()]) {
    const canonical = canonicalCreatedNode(binding);
    if (binding !== canonical) continue;
    const escaped = escapeRegExp(binding);
    const aliases = [...createdNodeAliases]
      .filter(([, target]) => target === canonical)
      .map(([alias]) => escapeRegExp(alias));
    const receiver = `(?:${aliases.join('|')})`;
    const mutations = [];
    for (const assignment of source.matchAll(new RegExp(
      `\\b${receiver}\\s*(?:\\.\\s*(textContent|innerText|innerHTML)|\\[\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\x60(?:\\\\.|[^\\x60\\\\])*\\x60|[A-Za-z_$][A-Za-z0-9_$]*)\\s*\\])\\s*=\\s*([^;]+)`,
      'g',
    ))) {
      const property = assignment[1]
        ?? evaluateStaticJavaScriptExpression(assignment[2] ?? '', bindings);
      if (!['textContent', 'innerText', 'innerHTML'].includes(property)) continue;
      const value = evaluateStaticJavaScriptExpression(assignment[3], bindings);
      mutations.push({
        index: assignment.index ?? 0,
        populated: value !== '',
      });
    }
    const callRe = new RegExp(
      `\\b${receiver}\\s*(?:\\?\\.)?\\.\\s*(append|prepend|replaceChildren|insertAdjacentText|insertAdjacentHTML)\\s*\\(`,
      'g',
    );
    for (const call of source.matchAll(callRe)) {
      const args = balancedCallArguments(source, call.index ?? 0);
      if (args === null) continue;
      const candidates = splitTopLevelJavaScriptArguments(args).filter((arg) => arg.trim());
      if (call[1] === 'replaceChildren') {
        mutations.push({
          index: call.index ?? 0,
          populated: candidates.some((candidate) => (
            evaluateStaticJavaScriptExpression(candidate, bindings) !== ''
          )),
        });
      } else if (candidates.length > 0) {
        mutations.push({ index: call.index ?? 0, populated: true });
      }
    }
    const initialPopulated = populatedNodeBindings.has(canonical);
    const finalPopulated = mutations.length > 0
      ? mutations.sort((left, right) => left.index - right.index).at(-1).populated
      : initialPopulated;
    for (const [alias, target] of createdNodeAliases) {
      if (target !== canonical) continue;
      emptyNodeBindings.delete(alias);
      populatedNodeBindings.delete(alias);
      if (finalPopulated) populatedNodeBindings.add(alias);
      else emptyNodeBindings.add(alias);
    }
  }
  const receiverAliases = new Map();
  for (const destructuring of source.matchAll(
    /\b(?:const|let|var)\s*\{\s*body(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s*\}\s*=\s*(?:window\.|globalThis\.)?document\b/g,
  )) {
    receiverAliases.set(destructuring[1] ?? 'body', 'document.body');
  }
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (receiverAliases.has(declaration.name)) continue;
      const expression = declaration.expression.trim();
      const receiverPath = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\s*(?:\??\.\s*[A-Za-z_$][A-Za-z0-9_$]*|(?:\?\.)?\[\s*["'`][A-Za-z_$][A-Za-z0-9_$]*["'`]\s*\]))*$/;
      const selectorCall = /^document\s*(?:\?\.|\.)\s*(?:querySelector|getElementById)\s*\(/;
      if (!receiverPath.test(expression) && !selectorCall.test(expression)) continue;
      receiverAliases.set(
        declaration.name,
        canonicalStaticJavaScriptReceiver(expression, receiverAliases, bindings),
      );
      changed = true;
    }
    if (!changed) break;
  }
  const receiverDeclarationCounts = new Map();
  for (const declaration of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g,
  )) {
    receiverDeclarationCounts.set(
      declaration[1],
      (receiverDeclarationCounts.get(declaration[1]) ?? 0) + 1,
    );
  }
  const shadowedReceiverNames = new Set(
    [...receiverDeclarationCounts]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
  for (const name of [...shadowedReceiverNames]) {
    const escaped = escapeRegExp(name);
    const targets = new Set();
    for (const declaration of source.matchAll(new RegExp(
      `\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*([^;,}\\n]+)`,
      'g',
    ))) {
      const expression = declaration[1].trim();
      if (/^(?:document\.)?create(?:Element|DocumentFragment|TextNode)\s*\(/.test(expression)) {
        targets.add(`@created:${declaration.index}`);
      } else {
        targets.add(canonicalStaticJavaScriptReceiver(
          expression,
          receiverAliases,
          bindings,
        ));
      }
    }
    if (targets.size === 1 && [...targets][0].startsWith('document')) {
      shadowedReceiverNames.delete(name);
    }
  }

  const values = [];
  const sinkOperations = [];
  const attachmentEdges = [];
  const removalIndexes = new Map();
  const childClearIndexes = new Map();
  const textPropertyNames = new Set(['textContent', 'innerText', 'innerHTML']);
  for (const assignment of source.matchAll(
    /(?:\b(textContent|innerText|innerHTML)\b|\[\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][A-Za-z0-9_$]*)\s*\])\s*(\+?=)\s*([^;]+)/g,
  )) {
    const property = assignment[1]
      ?? evaluateStaticJavaScriptExpression(assignment[2] ?? '', bindings);
    if (typeof property !== 'string' || !textPropertyNames.has(property)) continue;
    const value = evaluateStaticJavaScriptExpression(assignment[4], bindings);
    const computedMember = Boolean(assignment[2]);
    const target = staticJavaScriptSinkReceiver(
      source,
      assignment.index ?? 0,
      computedMember,
      bindings,
      receiverAliases,
      shadowedReceiverNames,
    );
    if (typeof value === 'string') {
      sinkOperations.push({
        index: assignment.index ?? 0,
        target,
        operation: assignment[3] === '+=' ? 'append' : 'replace',
        rendered: value,
      });
      if (assignment[3] === '=') childClearIndexes.set(target, assignment.index ?? 0);
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      const rendered = value.join(',');
      sinkOperations.push({
        index: assignment.index ?? 0,
        target,
        operation: assignment[3] === '+=' ? 'append' : 'replace',
        rendered,
      });
      if (assignment[3] === '=') childClearIndexes.set(target, assignment.index ?? 0);
    }
  }
  const textSinkMethods = new Set([
    'insertAdjacentText',
    'insertAdjacentHTML',
    'append',
    'prepend',
    'replaceChildren',
    'replaceWith',
    'write',
    'writeln',
    'createTextNode',
    'appendChild',
    'insertBefore',
    'replaceChild',
    'insertAdjacentElement',
    'removeChild',
    'remove',
  ]);
  const textCallRe = /(?:\b(insertAdjacentText|insertAdjacentHTML|append|prepend|replaceChildren|replaceWith|write|writeln|createTextNode|appendChild|insertBefore|replaceChild|insertAdjacentElement|removeChild|remove)|\[\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][A-Za-z0-9_$]*)\s*\])\s*(?:\?\.)?\s*\(/g;
  for (const call of source.matchAll(textCallRe)) {
    const argumentsSource = balancedCallArguments(source, call.index ?? 0);
    if (argumentsSource === null) continue;
    const method = call[1]
      ?? evaluateStaticJavaScriptExpression(call[2] ?? '', bindings);
    if (typeof method !== 'string' || !textSinkMethods.has(method)) continue;
    const args = splitTopLevelJavaScriptArguments(argumentsSource);
    const insertionPosition = method.startsWith('insertAdjacent')
      ? evaluateStaticJavaScriptExpression(args[0] ?? '', bindings)
      : null;
    const target = staticJavaScriptSinkReceiver(
      source,
      call.index ?? 0,
      Boolean(call[2]),
      bindings,
      receiverAliases,
      shadowedReceiverNames,
    );
    if (method === 'remove') {
      removalIndexes.set(target, call.index ?? 0);
      continue;
    }
    if (method === 'removeChild') {
      const removed = canonicalCreatedNode(args[0] ?? '');
      if (removed && createdNodeBindings.has(removed)) {
        removalIndexes.set(removed, call.index ?? 0);
      }
      continue;
    }
    if (method === 'replaceWith') removalIndexes.set(target, call.index ?? 0);
    if (method === 'replaceChildren') {
      childClearIndexes.set(target, call.index ?? 0);
    }
    const candidates = method.startsWith('insertAdjacent')
      ? (method === 'insertAdjacentElement' ? args.slice(1, 2) : args.slice(1))
      : (method === 'insertBefore' || method === 'replaceChild'
        ? args.slice(0, 1)
        : args);
    let contiguous = [];
    const flushContiguous = () => {
      if (contiguous.length > 0) {
        const rendered = contiguous.join('');
        let operation = 'append';
        if (method === 'prepend') operation = 'prepend';
        else if (method === 'replaceChildren' || method === 'replaceWith') {
          operation = 'replace';
        } else if (method.startsWith('insertAdjacent')
            && typeof insertionPosition === 'string') {
          operation = insertionPosition.toLowerCase();
        }
        if (method !== 'createTextNode') {
          sinkOperations.push({
            index: call.index ?? 0,
            target,
            operation,
            rendered: method === 'writeln' ? `${rendered}\n` : rendered,
          });
        }
        if (method === 'createTextNode' && contiguous.length > 1) values.push(rendered);
      }
      contiguous = [];
    };
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      const spread = trimmed.startsWith('...');
      const expression = spread ? trimmed.slice(3) : trimmed;
      const textNode = expression.match(
        /^(?:document\.)?createTextNode\s*\(([\s\S]*)\)$/,
      );
      const emptyNode = emptyNodeBindings.has(expression)
        || /^(?:document\.)?createElement\s*\(\s*["'][a-z][a-z0-9:-]*["']\s*\)$/i
          .test(expression)
        || /^(?:document\.)?createDocumentFragment\s*\(\s*\)$/i.test(expression);
      const storedTextNodeValue = createdTextNodeValues.get(expression);
      const value = typeof storedTextNodeValue === 'string'
        ? storedTextNodeValue
        : (emptyNode
          ? ''
          : evaluateStaticJavaScriptExpression(textNode?.[1] ?? expression, bindings));
      const resolved = spread && Array.isArray(value)
        ? value
        : (typeof value === 'string' ? [value] : []);
      const attachedNode = canonicalCreatedNode(expression);
      if (createdNodeBindings.has(expression) || createdNodeBindings.has(attachedNode)) {
        attachmentEdges.push({
          index: call.index ?? 0,
          parent: target,
          child: attachedNode,
        });
      }
      if (resolved.length > 0
          && resolved.every((item) => typeof item === 'string')) {
        if (method === 'createTextNode') values.push(...resolved);
        contiguous.push(...resolved);
      } else {
        flushContiguous();
        if (populatedNodeBindings.has(expression)) {
          sinkOperations.push({
            index: call.index ?? 0,
            target,
            operation: 'append',
            rendered: '. Unrelated dynamic content. ',
          });
        }
      }
    }
    flushContiguous();
  }
  const states = new Map();
  sinkOperations.sort((left, right) => left.index - right.index);
  for (const sink of sinkOperations) {
    const state = states.get(sink.target) ?? { before: '', content: '', after: '' };
    switch (sink.operation) {
      case 'replace':
        state.content = sink.rendered;
        break;
      case 'prepend':
      case 'afterbegin':
        state.content = sink.rendered + state.content;
        break;
      case 'beforebegin':
        state.before += sink.rendered;
        break;
      case 'afterend':
        state.after = sink.rendered + state.after;
        break;
      default:
        state.content += sink.rendered;
    }
    states.set(sink.target, state);
  }
  const publicTargets = new Set(
    [...states.keys()].filter((target) => /^document(?:[.(]|$)/.test(target)),
  );
  for (let pass = 0; pass <= attachmentEdges.length; pass += 1) {
    let changed = false;
    for (const edge of attachmentEdges) {
      if (publicTargets.has(edge.parent)
          && edge.index > (removalIndexes.get(edge.child) ?? -1)
          && edge.index > (childClearIndexes.get(edge.parent) ?? -1)
          && !publicTargets.has(edge.child)) {
        publicTargets.add(edge.child);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const [target, state] of states) {
    if (publicTargets.has(target)) {
      values.push(state.before + state.content + state.after);
    }
  }
  return values;
}

function textualAssetClaimChannels(fileRel, content) {
  const extension = path.extname(fileRel).toLowerCase();
  if (extension === '.json' || extension === '.webmanifest') {
    try {
      const values = [];
      const visit = (value) => {
        if (typeof value === 'string') values.push(value);
        else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      visit(JSON.parse(content));
      return values;
    } catch {
      return [content];
    }
  }
  if (extension === '.css') {
    const values = [];
    const customProperties = new Map();
    for (const declaration of content.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;}]+)/gi)) {
      const strings = [...declaration[2].matchAll(/(["'])([\s\S]*?)\1/g)]
        .map((match) => match[2]);
      if (strings.length > 0) customProperties.set(declaration[1], strings.join(''));
    }
    for (const declaration of content.matchAll(/\bcontent\s*:\s*([^;}]+)/gi)) {
      const strings = [...declaration[1].matchAll(/(["'])([\s\S]*?)\1/g)]
        .map((match) => match[2]);
      values.push(...strings);
      if (strings.length > 1) values.push(strings.join(''));
      const resolved = [...declaration[1].matchAll(/\bvar\(\s*(--[a-z0-9_-]+)\s*(?:,[^)]+)?\)/gi)]
        .map((match) => customProperties.get(match[1]) ?? '');
      if (resolved.length > 0 && resolved.every(Boolean)) values.push(resolved.join(''));
    }
    return values;
  }
  if (extension === '.js') {
    const values = [...content.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
      .map((match) => match[2]);
    const concatenationRe = /(?:(?:["'`])(?:\\.|[^"'`])*?(?:["'`])\s*\+\s*)+(?:["'`])(?:\\.|[^"'`])*?(?:["'`])/g;
    for (const chain of content.matchAll(concatenationRe)) {
      const strings = [...chain[0].matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
        .map((match) => match[2]);
      if (strings.length > 1) values.push(strings.join(''));
    }
    values.push(...staticJavaScriptTextSinkValues(content));
    return values;
  }
  if (extension === '.svg' || extension === '.xml') {
    const values = [];
    for (const match of content.matchAll(/>([^<]+)</g)) values.push(match[1]);
    values.push(shortText(content.replace(/<[^>]*>/g, ' ')));
    for (const match of content.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text\s*>/gi)) {
      values.push(shortText(match[1].replace(/<[^>]*>/g, ' ')));
    }
    for (const match of content.matchAll(/\b(?:aria-label|aria-description|alt|title|data-[a-z0-9_.:-]+)\s*=\s*(["'])([\s\S]*?)\1/gi)) {
      values.push(match[2]);
    }
    return values;
  }
  return [content];
}

function publicAtRestChannelErrors(fileRel, content, kind = 'html') {
  const errors = [];
  const record = (text, channel) => {
    const normalized = shortText(renderedTextWithSourceMap(text).text);
    if (!normalized || !atRestSemanticTripwire(normalized)) return;
    errors.push({
      kind: 'unbound at-rest claim',
      file: fileRel,
      line: 0,
      text: `${normalized} -- undeclared public ${channel} at-rest assertion`,
    });
  };

  if (kind !== 'html') {
    for (const value of textualAssetClaimChannels(fileRel, content)) {
      record(value, 'textual-asset');
    }
    return errors;
  }

  let unbound = content;
  for (const element of atRestClaimElements(content)) {
    unbound = unbound.replace(element.html, ' '.repeat(element.html.length));
  }
  const visible = visibleHtml(unbound);
  const textElementRe = /<(title|p|li|td|th|caption|summary|label|button|a|h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (const match of visible.matchAll(textElementRe)) record(match[2], 'rendered-text');

  const tagRe = /<[a-z][^>]*>/gi;
  const attributeRe = /\b(content|aria-label|aria-description|alt|title|placeholder|value|data-[a-z0-9_.:-]+)\s*=\s*(["'])([\s\S]*?)\2/gi;
  for (const tag of unbound.matchAll(tagRe)) {
    for (const attribute of tag[0].matchAll(attributeRe)) {
      if (/^data-osl-at-rest-(?:claim|backends)$/i.test(attribute[1])) continue;
      record(attribute[3], `attribute:${attribute[1]}`);
    }
  }

  const embeddedRe = /<(script|template|noscript)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  for (const match of unbound.matchAll(embeddedRe)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const body = match[3];
    if (tag === 'template') {
      if (/^(?:open|closed)$/i.test(htmlAttributeValue(attrs, 'shadowrootmode'))) {
        record(body, 'declarative-shadow-template');
      }
      continue;
    }
    if (tag === 'noscript') {
      record(body, 'noscript');
      continue;
    }
    const type = htmlAttributeValue(attrs, 'type').toLowerCase();
    if (type === 'application/ld+json') {
      for (const value of textualAssetClaimChannels('inline.json', body)) record(value, 'json-ld');
      continue;
    }
    if (type && !/(?:java|ecma)script|module/i.test(type)) continue;
    for (const value of textualAssetClaimChannels('inline.js', body)) {
      record(value, 'inline-script-copy');
    }
  }
  return errors;
}

function atRestUnboundClaimErrors(fileRel, content) {
  const visible = visibleHtml(content);
  const boundElements = atRestClaimElements(content);
  let unbound = visible;
  for (const element of boundElements) {
    unbound = unbound.replace(element.html, ' '.repeat(element.html.length));
  }

  const errors = [];
  const blockRe = /<(p|li|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (const block of unbound.matchAll(blockRe)) {
    const text = shortText(renderedTextWithSourceMap(block[2]).text);
    if (!atRestSemanticTripwire(text)) continue;
    errors.push({
      kind: 'unbound at-rest claim',
      file: fileRel,
      line: lineNumber(content, block.index ?? 0),
      text: `${text} -- bind this visible claim to data/at-rest-census.json`,
    });
  }
  return errors;
}

function validateAtRestCensus(census, rawSource) {
  const errors = [];
  const record = (code, text) => errors.push(`${code}: ${text}`);
  if (census?.schema_version !== 1 || census?.census_id !== 'osl-at-rest-source-census') {
    record('AT_REST_SCHEMA', 'unsupported or missing at-rest census identity/version');
  }
  const contractDigest = canonicalSha256(census);
  if (contractDigest !== AT_REST_CANONICAL_CONTRACT_SHA256) {
    record(
      'AT_REST_CANONICAL_CONTRACT',
      `the complete reviewed census contract must hash to ${AT_REST_CANONICAL_CONTRACT_SHA256}, got ${contractDigest}`,
    );
  }
  if (typeof rawSource === 'string') {
    const rawDigest = rawSha256(rawSource);
    if (rawDigest !== AT_REST_RAW_CONTRACT_SHA256) {
      record(
        'AT_REST_RAW_CONTRACT',
        `the exact reviewed JSON bytes must hash to ${AT_REST_RAW_CONTRACT_SHA256}, got ${rawDigest}`,
      );
    }
  }
  if (census?.product_source?.commit !== AT_REST_PRODUCT_SOURCE.commit
      || census?.product_source?.tree !== AT_REST_PRODUCT_SOURCE.tree
      || census?.product_source?.runtime_release_verified !== false
      || census?.product_source?.evidence_tier !== 'source-inspected-and-test-proven-only'
      || !census?.product_source?.limitation?.trim()) {
    record('AT_REST_PROVENANCE', 'the exact reviewed product commit/tree, bounded evidence tier, runtime=false, and limitation are required');
  }

  const backends = Array.isArray(census?.backends) ? census.backends : [];
  const backendById = new Map();
  for (const backend of backends) {
    if (!backend?.id || backendById.has(backend.id)) {
      record('AT_REST_BACKEND_ID', `missing or duplicate backend id ${backend?.id ?? '<empty>'}`);
      continue;
    }
    backendById.set(backend.id, backend);
    if (!backend.data_class?.trim()
        || !backend.at_rest_form?.trim()
        || typeof backend.plaintext_possible_at_rest !== 'boolean'
        || !backend.plaintext_runtime_form?.trim()
        || !backend.key_absent_behavior?.trim()
        || !Array.isArray(backend.sources)
        || backend.sources.length === 0
        || backend.sources.some((source) => !source.path?.trim() || !source.symbol?.trim() || !source.proof?.trim())
        || !Array.isArray(backend.limitations)
        || backend.limitations.length === 0
        || backend.limitations.some((limitation) => !limitation?.trim())) {
      record('AT_REST_BACKEND_SHAPE', `${backend.id} lacks an exact data/form/key/source/limitation contract`);
    }
  }

  const requiredIds = census?.required_backend_ids;
  if (!Array.isArray(requiredIds)
      || requiredIds.length !== AT_REST_BACKEND_CONTRACT.size
      || new Set(requiredIds).size !== requiredIds.length
      || requiredIds.some((id) => !AT_REST_BACKEND_CONTRACT.has(id))) {
    record('AT_REST_BACKEND_CENSUS', 'required_backend_ids must contain the exact authoritative backend set');
  }
  for (const [id, expected] of AT_REST_BACKEND_CONTRACT) {
    const backend = backendById.get(id);
    if (!backend) {
      record('AT_REST_BACKEND_CENSUS', `required backend ${id} is missing`);
      continue;
    }
    for (const [field, value] of Object.entries(expected)) {
      if (backend[field] !== value) {
        record('AT_REST_BACKEND_TRUTH', `${id}.${field} must remain ${JSON.stringify(value)}, got ${JSON.stringify(backend[field])}`);
      }
    }
    const expectedSourcePaths = AT_REST_SOURCE_CONTRACT.get(id);
    const actualSourcePaths = backend.sources?.map((source) => source.path);
    if (!expectedSourcePaths
        || JSON.stringify(actualSourcePaths) !== JSON.stringify(expectedSourcePaths)) {
      record('AT_REST_BACKEND_SOURCE', `${id} must retain its exact ordered source anchors`);
    }
  }
  if (backends.length !== AT_REST_BACKEND_CONTRACT.size) {
    record('AT_REST_BACKEND_CENSUS', `expected exactly ${AT_REST_BACKEND_CONTRACT.size} backends, got ${backends.length}`);
  }

  const claims = Array.isArray(census?.public_claims) ? census.public_claims : [];
  const claimById = new Map();
  for (const claim of claims) {
    if (!claim?.id || claimById.has(claim.id)) {
      record('AT_REST_CLAIM_ID', `missing or duplicate claim id ${claim?.id ?? '<empty>'}`);
      continue;
    }
    claimById.set(claim.id, claim);
    const expected = AT_REST_CLAIM_CONTRACT.get(claim.id);
    if (!expected) {
      record('AT_REST_CLAIM_CENSUS', `undeclared public claim ${claim.id}`);
      continue;
    }
    if (claim.file !== expected[0] || claim.status_tier !== expected[1]
        || !AT_REST_EVIDENCE_TIERS.has(claim.status_tier)
        || !claim.text?.trim()
        || !Array.isArray(claim.backend_refs)
        || claim.backend_refs.length === 0
        || new Set(claim.backend_refs).size !== claim.backend_refs.length) {
      record('AT_REST_CLAIM_SHAPE', `${claim.id} has wrong file/tier/text/backend references`);
      continue;
    }
    for (const ref of claim.backend_refs) {
      const backend = backendById.get(ref);
      if (!backend) {
        record('AT_REST_CLAIM_BACKEND', `${claim.id} references missing backend ${ref}`);
      } else if (['implemented-unwired', 'source-reachability-unknown', 'qa-only-source-path']
        .includes(backend.reachability)
          || backend.public_claimability === 'not-claimable'
          || backend.public_claimability === 'planned-only') {
        record('AT_REST_UNWIRED_CLAIM', `${claim.id} cites ${ref}, whose ${backend.reachability}/${backend.public_claimability} status cannot support public present-tense copy`);
      }
    }
    for (const detail of atRestBackendReferenceErrors(claim.text, claim.backend_refs)) {
      record('AT_REST_CLAIM_SEMANTICS', `${claim.id}: ${detail}`);
    }
    const overclaims = atRestOverclaimErrors(claim.file, `<p>${claim.text}</p>`);
    if (overclaims.length > 0) {
      record('AT_REST_CLAIM_SEMANTICS', `${claim.id}: contradictory universal at-rest assertion`);
    }
  }
  for (const [id, expected] of AT_REST_CLAIM_CONTRACT) {
    const claim = claimById.get(id);
    if (!claim) {
      record('AT_REST_CLAIM_CENSUS', `required public claim ${id} is missing`);
    } else if (claim.file !== expected[0] || claim.status_tier !== expected[1]) {
      record('AT_REST_CLAIM_TRUTH', `${id} must remain ${expected[0]}/${expected[1]}`);
    }
  }
  if (claims.length !== AT_REST_CLAIM_CONTRACT.size) {
    record('AT_REST_CLAIM_CENSUS', `expected exactly ${AT_REST_CLAIM_CONTRACT.size} public claims, got ${claims.length}`);
  }
  return errors;
}

function atRestClaimBindingErrors(fileRel, content, census) {
  const errors = [];
  const claims = (census.public_claims || []).filter((claim) => claim.file === fileRel);
  const claimById = new Map((census.public_claims || []).map((claim) => [claim.id, claim]));
  const visibleElements = atRestClaimElements(content);
  const rawMarkerCount = [...content.matchAll(/\bdata-osl-at-rest-claim\s*=/gi)].length;
  if (rawMarkerCount !== visibleElements.length) {
    errors.push({
      kind: 'unreachable at-rest claim',
      file: fileRel,
      line: 0,
      text: `${rawMarkerCount - visibleElements.length} claim marker(s) exist only in comments, scripts, styles, templates, noscript, or malformed markup`,
    });
  }

  for (const element of visibleElements) {
    const claim = claimById.get(element.id);
    if (!claim) {
      errors.push({
        kind: 'unknown at-rest claim',
        file: fileRel,
        line: lineNumber(content, element.index),
        text: `${element.id} is not declared by data/at-rest-census.json`,
      });
      continue;
    }
    if (claim.file !== fileRel) {
      errors.push({
        kind: 'misplaced at-rest claim',
        file: fileRel,
        line: lineNumber(content, element.index),
        text: `${element.id} belongs in ${claim.file}`,
      });
    }
    if (element.hidden) {
      errors.push({
        kind: 'unreachable at-rest claim',
        file: fileRel,
        line: lineNumber(content, element.index),
        text: `${element.id} is hidden from readers`,
      });
    }
    if (element.text !== shortText(claim.text)) {
      errors.push({
        kind: 'at-rest claim drift',
        file: fileRel,
        line: lineNumber(content, element.index),
        text: `${element.id} visible copy differs from its exact census text`,
      });
    }
    if (element.backendRefs.join(' ') !== claim.backend_refs.join(' ')) {
      errors.push({
        kind: 'at-rest backend drift',
        file: fileRel,
        line: lineNumber(content, element.index),
        text: `${element.id} backend binding differs from its exact census references`,
      });
    }
  }

  for (const claim of claims) {
    const occurrences = visibleElements.filter((element) => element.id === claim.id).length;
    if (occurrences !== 1) {
      errors.push({
        kind: 'missing or duplicate at-rest claim',
        file: fileRel,
        line: 0,
        text: `${claim.id} must occur exactly once as visible bound copy; found ${occurrences}`,
      });
    }
  }
  errors.push(...atRestUnboundClaimErrors(fileRel, content));
  return errors;
}

// Sections are the unit a reader actually perceives, so the forward-looking
// requirement is scoped to the section that names the capability rather than to
// the whole page. A page-wide check would let one "coming soon" at the bottom
// license present-tense claims at the top.
function sectionBlocks(content) {
  const blocks = [];
  const openRe = /<section\b[^>]*>/gi;
  for (const match of content.matchAll(openRe)) {
    const start = match.index;
    // Nested <section> is rare here but must not silently truncate the block.
    let depth = 0;
    let cursor = start;
    const scanRe = /<section\b[^>]*>|<\/section>/gi;
    scanRe.lastIndex = start;
    let end = content.length;
    let scan;
    while ((scan = scanRe.exec(content)) !== null) {
      if (scan[0].toLowerCase().startsWith('</')) {
        depth -= 1;
        if (depth === 0) { end = scan.index + scan[0].length; break; }
      } else {
        depth += 1;
      }
      cursor = scan.index;
    }
    void cursor;
    blocks.push({ start, end, html: content.slice(start, end) });
  }
  return blocks;
}

function h4ExplainerErrors(fileRel, content) {
  if (fileRel !== 'features.html') return [];

  const errors = [];
  const blocks = sectionBlocks(content).filter((block) => (
    /<section\b[^>]*\bdata-pws-burn-explainer(?:\s|=|>)/i.test(block.html)
  ));
  if (blocks.length !== 1) {
    return [{
      kind: 'h4 explainer contract',
      file: fileRel,
      line: 0,
      text: `expected exactly one rendered PWS/Burn explainer section, found ${blocks.length}`,
    }];
  }

  const block = blocks[0];
  const openingTag = block.html.match(/^<section\b[^>]*>/i)?.[0] ?? '';
  const labelledBy = openingTag.match(/\baria-labelledby=["']([^"']+)["']/i)?.[1] ?? '';
  const describedBy = openingTag.match(/\baria-describedby=["']([^"']+)["']/i)?.[1] ?? '';
  const rendered = shortText(renderedTextWithSourceMap(block.html).text).toLowerCase();
  const badges = labelledElements(block.html);
  const articles = [...block.html.matchAll(/<article\b[^>]*\bdata-pws-stage=["'](?:before|after)["'][^>]*>/gi)];
  const boundaryItems = [...block.html.matchAll(/<li\b[^>]*>/gi)];

  const requirements = [
    {
      label: 'PWS before-disclosure definition',
      passed: /\bpws\b.{0,90}\bacts before disclosure\b/i.test(rendered),
    },
    {
      label: 'Burn after-disclosure definition',
      passed: /\bburn\b.{0,90}\bacts after disclosure\b/i.test(rendered),
    },
    {
      label: 'not-cryptographic-erasure limitation',
      passed: /\bit is not cryptographic erasure\b/i.test(rendered),
    },
    {
      label: 'local deletion boundary',
      passed: /\blocal deletion\b/i.test(rendered),
    },
    {
      label: 'authenticated cooperative peer request boundary',
      passed: /\bauthenticated cooperative peer request\b/i.test(rendered),
    },
    {
      label: 'host deletion attempt boundary',
      passed: /\bhost deletion attempt\b/i.test(rendered),
    },
    {
      label: 'unavoidable copies/screenshots boundary',
      passed: /\bunavoidable copies and screenshots\b/i.test(rendered),
    },
    {
      label: 'Planned PWS badge',
      passed: badges.some((badge) => badge.feature === 'exposure-warning' && badge.status === 'Planned'),
    },
    {
      label: 'Planned Burn badge',
      passed: badges.some((badge) => badge.feature === 'burn' && badge.status === 'Planned'),
    },
    {
      label: 'section accessible name and description',
      passed: Boolean(labelledBy && describedBy)
        && new RegExp(`<h2\\b[^>]*\\bid=["']${escapeRegExp(labelledBy)}["']`, 'i').test(block.html)
        && new RegExp(`<p\\b[^>]*\\bid=["']${escapeRegExp(describedBy)}["']`, 'i').test(block.html),
    },
    {
      label: 'two semantic stages',
      passed: articles.length === 2,
    },
    {
      label: 'four visible boundary list items',
      passed: boundaryItems.length === 4,
    },
  ];

  for (const requirement of requirements) {
    if (requirement.passed) continue;
    errors.push({
      kind: 'h4 explainer contract',
      file: fileRel,
      line: lineNumber(content, block.start),
      text: `${requirement.label} is missing from the coherent rendered section`,
    });
  }

  return errors;
}

function atRestOverclaimErrors(fileRel, content) {
  const rendered = renderedTextWithSourceMap(content);
  const universalScope = /(?<!\bat\s)\ball\b|\b(?:each|every|everything|entire|entirety|whole|complete|totality|no|none|nothing|never|zero)\b|100\s*%/i;
  const absoluteUniversal = /\b(?:everything|nothing|entirety|totality)\b|100\s*%/i;
  const stateObject = /\b(?:state|data|information|records?|storage|metadata|preferences?|settings?|profile|history|files?|content|cache|database|items?|things?|secrets?)\b/i;
  const unqualifiedBroadCategory = /\b(?:private|local)\s+(?:conversation\s+)?(?:state|data|information|records?|storage|metadata|preferences?|settings?|profile|history|files?|content|cache|database)\b/i;
  const protectionAssertion = /\b(?:encrypt(?:s|ed|ing)?|decrypt(?:s|ed|ing)?|encipher(?:s|ed|ing)?|unencrypted|ciphertext|cleartext|plain[-\s]*text|sealed?|protect(?:s|ed|ing)?|secur(?:e|es|ed|ing)|gated|guards?|locked|unlocks?|inaccessible|unreadable|opaque|passphrase|password|in\s+the\s+clear)\b/i;
  const narrowProtectedObject = /\b(?:private\s+)?identity\s+keys?\b|\b(?:decrypted\s+|supported\s+)?message\s+bodies?\b|\bencrypted\s+(?:message\s+store|history)\b/i;
  const destructiveScope = /\b(?:delete|deletes|deleted|deleting|remove|removes|removed|removing|uninstall)\b/i;
  const localAtRestContext = /\bat[-\s]+rest\b|\bon[-\s]+disk\b|\bfilesystem\b|\blocal(?:ly)?\b|\bon[-\s]+device\b|\bon\s+(?:this|your|the)\s+(?:device|computer|machine)\b|\bwhole[-\s]+profile\b|\bfile[-\s]+storage\b|\bprivate\s+files?\b|\bOSL\s+never\s+(?:writes?|stores?)\b|\b(?:persist(?:s|ed|ing)?|retain(?:s|ed|ing)?)\b/i;
  const limitations = /\b(?:(?:does\s+not|doesn't)\s+(?:cover|protect|encrypt|secure|mean|imply|prove|describe)(?:\s+that)?\s+(?:all|each|every)|not\s+(?:all|each|every|everything|the\s+(?:entire|whole|complete))|not\s+(?:a\s+)?whole[-\s]+profile\s+(?:guarantee|encryption|protection)|not\s+(?:fully\s+)?(?:encrypted|protected|sealed|secured)|not\s+(?:a\s+)?(?:claim|promise|evidence)\s+that\s+(?:all|each|every)|(?:says?|proves?)\s+nothing\s+about\s+local|(?:may|can)\s+remain\s+plaintext|plaintext\s+(?:fallback|writes?)|without\s+(?:an?\s+)?(?:installed\s+)?(?:main[-\s]+password\s+)?storage\s+key|remov(?:e|es|ed|ing)\b.{0,80}\b(?:restores?|causes?)\s+plaintext\s+writes?|only\s+(?:the\s+)?(?:private\s+)?identity\s+keys?|not\s+(?:yet|complete\s+yet)|nothing\b.{0,100}\bcalls?\s+it|no\b.{0,80}\b(?:release|profile)\b.{0,40}\bverified)\b/i;
  const broadNegation = /\b(?:(?:does\s+not|doesn't)\b.{0,100}\b(?:prove|mean|imply|describe|cover|protect|encrypt|secure)\b.{0,100}\b(?:all|each|every)|not\s+(?:a\s+)?(?:claim|promise|evidence)\s+that\s+(?:all|each|every)|not\s+(?:all|each|every|everything|the\s+(?:entire|whole|complete))|not\s+(?:a\s+)?whole[-\s]+profile\s+(?:guarantee|encryption|protection))\b/i;
  const affirmativeBroadUnit = (text) => !broadNegation.test(text)
    && protectionAssertion.test(text)
    && localAtRestContext.test(text)
    && (unqualifiedBroadCategory.test(text)
      || (universalScope.test(text) && stateObject.test(text))
      || absoluteUniversal.test(text));
  const errors = [];

  // Block boundaries keep an honest limitation attached to the claim it
  // qualifies without letting an unrelated limitation elsewhere on the page
  // excuse a broad promise. Inline markup and entities are already flattened
  // by renderedTextWithSourceMap, so they cannot split the semantic match.
  for (const segment of rendered.text.matchAll(/[^\n]+/g)) {
    const blockText = shortText(segment[0]);
    if (!blockText) continue;
    const sentences = [...segment[0].matchAll(/[^.!?;\n]+[.!?;]?/g)]
      .map((sentence) => ({
        start: (segment.index ?? 0) + (sentence.index ?? 0),
        text: shortText(sentence[0]),
      }))
      .filter((sentence) => sentence.text);
    const semanticUnits = sentences.flatMap((sentence) => {
      const units = [];
      let cursor = 0;
      for (const raw of sentence.text.split(/\b(?:but|while|although|whereas|yet|however|even\s+though|despite(?:\s+the\s+fact\s+that)?)\b/i)) {
        const text = shortText(raw.replace(/^[,\s]+|[,\s]+$/g, ''));
        const relative = sentence.text.indexOf(raw, cursor);
        cursor = Math.max(cursor, relative + raw.length);
        if (text) units.push({ start: sentence.start + Math.max(0, relative), text });
      }
      return units;
    });
    const assertionUnits = semanticUnits.filter(({ text }) => (
      !limitations.test(text) || affirmativeBroadUnit(text)
    ));
    const falseMechanism = semanticUnits.find(({ text }) => falseIdentityPasswordMechanism(text));
    if (falseMechanism) {
      const sourceIndex = rendered.sourceIndexes[falseMechanism.start] ?? 0;
      errors.push({
        kind: 'at-rest overclaim',
        file: fileRel,
        line: lineNumber(content, sourceIndex),
        text: `${falseMechanism.text} -- the reviewed Hub identity path uses a persistent TPM or operating-system credential-store sealer; the main password is separate`,
      });
      continue;
    }
    // Scope is established inside one sentence. Its protection assertion may
    // appear elsewhere in the same rendered block, so arbitrary sentence
    // splitting cannot evade the check. Narrow identity-key and message-body
    // claims remain permissible unless the block also asserts a broad category.
    const assertionText = assertionUnits.map(({ text }) => text).join(' ');
    const scope = assertionUnits.find(({ text }) => !destructiveScope.test(text)
      && (unqualifiedBroadCategory.test(text)
        || (universalScope.test(text) && stateObject.test(text))
        || (absoluteUniversal.test(text) && protectionAssertion.test(text))));
    if (!scope
        || !protectionAssertion.test(assertionText)
        || !localAtRestContext.test(assertionText)) continue;
    const isNarrow = narrowProtectedObject.test(scope.text)
      && !unqualifiedBroadCategory.test(scope.text);
    if (isNarrow) continue;
    const { start } = scope;
    const text = blockText;
    const sourceIndex = rendered.sourceIndexes[start] ?? 0;
    errors.push({
      kind: 'at-rest overclaim',
      file: fileRel,
      line: lineNumber(content, sourceIndex),
      text: `${text} -- password protection does not cover every local record, and plaintext writes return when the storage key is removed`,
    });
  }

  return errors;
}

function checkoutRegions(content, policy) {
  const startTag = policy.checkout_region_start || 'osl:checkout-summary';
  const endTag = policy.checkout_region_end || '/osl:checkout-summary';
  const re = new RegExp(`<!--\\s*${escapeRegExp(startTag)}\\s*-->([\\s\\S]*?)<!--\\s*${escapeRegExp(endTag)}\\s*-->`, 'g');
  const regions = [];
  for (const match of content.matchAll(re)) {
    regions.push({ start: match.index, end: match.index + match[0].length, html: match[0] });
  }
  return regions;
}

function analyseFile(fileRel, content, config) {
  const {
    patterns,
    capabilityLabels,
    crawlerPolicy,
    forbiddenPhrases,
    requiredPhrases,
    registryById,
    surfacePolicy,
    launchFrame,
    intendedGrantDays,
  } = config;
  const errors = [];
  const spans = markerSpans(content);
  const allowed = new Set(capabilityLabels.map((label) => label.toLowerCase()));

  const isMatrix = (surfacePolicy.matrix_files || []).includes(fileRel);
  const isCheckoutFile = (surfacePolicy.checkout_files || []).includes(fileRel);
  const isMarketingCapabilityPage = (surfacePolicy.marketing_capability_files || []).includes(fileRel);

  // ---- Global rules: these hold on every surface, whatever the framing.
  errors.push(...h4ExplainerErrors(fileRel, content));
  // Census-bound visible copy is validated byte-for-byte by
  // atRestClaimBindingErrors. The legacy broad-claim detector only inspects
  // unbound copy; otherwise words such as "not every local record" can turn a
  // narrow, explicitly limited census statement into a false positive.
  let unboundAtRestContent = content;
  for (const element of atRestClaimElements(content)) {
    unboundAtRestContent = unboundAtRestContent.replace(
      element.html,
      ' '.repeat(element.html.length),
    );
  }
  errors.push(...atRestOverclaimErrors(fileRel, unboundAtRestContent));

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of content.matchAll(pattern.regex)) {
      if (negatedClaim(content, match.index, match[0], crawlerPolicy)) continue;
      errors.push({
        kind: pattern.billing ? 'forbidden billing' : 'forbidden claim',
        file: fileRel,
        line: lineNumber(content, match.index),
        text: shortText(match[0]),
      });
    }
  }

  for (const entry of forbiddenPhrases) {
    const phrase = typeof entry === 'string' ? entry : entry.phrase;
    if (!phrase) continue;
    const regex = new RegExp(escapeRegExp(phrase), 'gi');
    for (const match of content.matchAll(regex)) {
      if (negatedClaim(content, match.index, match[0], crawlerPolicy)) continue;
      errors.push({
        kind: 'false capability claim',
        file: fileRel,
        line: lineNumber(content, match.index),
        text: `${shortText(match[0])} -- ${entry.reason || 'disproved against source'}`,
      });
    }
  }

  errors.push(...semanticGrantDurationErrors(fileRel, content, intendedGrantDays));

  const donationFiles = new Set(crawlerPolicy.donation_amount_files || []);
  const donationFile = donationFiles.has(fileRel);
  for (const match of content.matchAll(PRICE_RE)) {
    if (insideAnySpan(match.index, spans)) continue;
    if (donationFile) continue;
    if (allowedLiabilityCap(fileRel, content, match.index, match[0])) continue;
    errors.push({
      kind: 'bare price',
      file: fileRel,
      line: lineNumber(content, match.index),
      text: shortText(match[0]),
    });
  }

  // ---- Badge rules.
  const labelled = labelledElements(content, crawlerPolicy);
  for (const item of labelled) {
    const line = lineNumber(content, item.index);
    const registered = registryById.get(item.feature);
    if (!registered) {
      errors.push({ kind: 'capability badge', file: fileRel, line, text: `${item.feature} is not in capability_registry` });
      continue;
    }
    if (!item.status) {
      // A marketing page is allowed to name a v1 capability without stamping a
      // status on it; that is the whole point of the reframe. The matrix is not.
      if (isMatrix) {
        errors.push({ kind: 'capability badge', file: fileRel, line, text: `${item.feature} carries no status on the support matrix` });
      }
      continue;
    }
    if (!allowed.has(item.status.toLowerCase())) {
      errors.push({ kind: 'capability badge', file: fileRel, line, text: `${item.status} is not a permitted label` });
      continue;
    }
    if (registered.status !== item.status) {
      errors.push({
        kind: 'label drift',
        file: fileRel,
        line,
        text: `${item.feature} is labelled ${item.status} but the manifest says ${registered.status}`,
      });
    }
  }

  // ---- Matrix surface: must account for every capability.
  if (isMatrix) {
    const present = new Set(labelled.map((item) => item.feature));
    for (const [id, entry] of registryById) {
      if (!present.has(id)) {
        errors.push({
          kind: 'matrix gap',
          file: fileRel,
          line: 0,
          text: `${id} (${entry.status}) is missing from the support matrix`,
        });
      }
    }
  }

  // ---- Checkout surface: only sellable capabilities may be referenced.
  const checkoutScopes = isCheckoutFile
    ? [{ start: 0, end: content.length, html: content }]
    : checkoutRegions(content, surfacePolicy);
  for (const scope of checkoutScopes) {
    for (const item of labelledElements(scope.html, crawlerPolicy)) {
      const registered = registryById.get(item.feature);
      if (!registered) continue;
      if (!registered.sellable) {
        errors.push({
          kind: 'unsellable at checkout',
          file: fileRel,
          line: lineNumber(content, scope.start),
          text: `${item.feature} is ${registered.status} and must not appear in a checkout summary`,
        });
      }
    }
  }

  // ---- Marketing surface: forward-looking framing, and a link to the matrix.
  if (isMarketingCapabilityPage) {
    const markers = (surfacePolicy.forward_looking_markers || []).map((m) => m.toLowerCase());
    for (const block of sectionBlocks(content)) {
      const features = labelledElements(block.html, crawlerPolicy)
        .map((item) => registryById.get(item.feature))
        .filter(Boolean);
      const unproven = features.filter((entry) => !PROVEN.has(entry.status) && entry.status !== 'Illustration');
      if (unproven.length === 0) continue;
      const text = plainText(block.html).toLowerCase();
      if (markers.some((marker) => text.includes(marker))) continue;
      errors.push({
        kind: 'present-tense capability claim',
        file: fileRel,
        line: lineNumber(content, block.start),
        text: `section names ${unproven.map((e) => e.id).join(', ')} (not proven) with no forward-looking framing`,
      });
    }

    const matrixUrl = launchFrame.matrix_url;
    if (matrixUrl && !content.includes(`href="${matrixUrl}"`)) {
      errors.push({
        kind: 'missing matrix link',
        file: fileRel,
        line: 0,
        text: `every marketing capability page must link to ${matrixUrl}`,
      });
    }
  }

  for (const requirement of requiredPhrases) {
    if (requirement.file !== fileRel) continue;
    if (content.includes(requirement.phrase)) continue;
    errors.push({
      kind: 'missing required sentence',
      file: fileRel,
      line: 0,
      text: `"${requirement.phrase}" -- ${requirement.reason || 'required by the manifest'}`,
    });
  }

  return errors;
}

function validateH7Comparison(pricing, asOf) {
  const errors = [];
  const add = (code, detail) => errors.push(`H7_${code}: ${detail}`);
  const isNonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  const list = (value) => (Array.isArray(value) ? value : []);
  const unique = (values) => new Set(values).size === values.length;
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const claimTexts = (dimension) => [
    ...list(dimension?.deleteme_facts)
      .flatMap((fact) => [fact?.paraphrase ?? '', fact?.qualifiers ?? '']),
    ...list(dimension?.unknowns).map((unknown) => unknown?.reason ?? ''),
    dimension?.conflict_explanation ?? '',
    dimension?.osl_limitation ?? '',
    dimension?.bounded_conclusion ?? '',
  ].filter(isNonempty);
  const hasAffirmative = (text, termPattern) => {
    const flags = termPattern.flags.includes('g') ? termPattern.flags : `${termPattern.flags}g`;
    const matcher = new RegExp(termPattern.source, flags);
    for (const match of text.matchAll(matcher)) {
      const before = text.slice(Math.max(0, match.index - 120), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 55);
      const negatedBefore = /\b(?:cannot|can't|decline(?:s|d)?|no|not|does not|doesn't|is not|isn't|never|without|unknown)\b[^.!?;]{0,105}$/i.test(before);
      const unknownAfter = /^[^.!?;]{0,35}\b(?:unknown|not stated|not specified|not established)\b/i.test(after);
      if (!negatedBefore && !unknownAfter) return true;
    }
    return false;
  };

  if (pricing.manifest_version !== 7) {
    add('VERSION', 'manifest_version must be exactly 7');
  }

  const research = pricing.research_comparisons;
  if (!research || typeof research !== 'object' || Array.isArray(research)) {
    add('SCHEMA', 'research_comparisons must be an object');
  }
  if (research?.schema_version !== 1) {
    add('VERSION', 'research_comparisons.schema_version must be exactly 1');
  }

  const comparison = research?.h7_deleteme;
  if (!comparison || typeof comparison !== 'object' || Array.isArray(comparison)) {
    add('SCHEMA', 'research_comparisons.h7_deleteme must be an object');
  }
  if (comparison?.comparison_version !== 1) {
    add('VERSION', 'h7_deleteme.comparison_version must be exactly 1');
  }
  if (comparison?.id !== 'h7-deleteme-us-consumer') {
    add('IDENTITY', 'comparison id must be h7-deleteme-us-consumer');
  }
  if (!isNonempty(comparison?.reviewed_on)) {
    add('METADATA', 'reviewed_on is required');
  }

  const market = comparison?.market_scope;
  if (market?.country !== 'US'
    || market?.audience !== 'consumer'
    || JSON.stringify(market?.plans) !== JSON.stringify(['Standard', 'Premium'])
    || JSON.stringify(market?.excluded) !== JSON.stringify(['business', 'international'])) {
    add('MARKET_SCOPE', 'market scope must remain US consumer Standard/Premium, excluding business and international');
  }

  const sources = list(comparison?.sources);
  if (sources.length < 8) {
    add('SOURCE_FLOOR', `at least 8 official sources are required; found ${sources.length}`);
  }
  const sourceIds = sources.map((source) => source?.id).filter(isNonempty);
  if (sourceIds.length !== sources.length || !unique(sourceIds)) {
    add('SOURCE_ID', 'every source needs a unique nonempty id');
  }
  const sourceById = new Map(sources.map((source) => [source?.id, source]));
  const seenSourceTypes = new Set();
  let datedSources = 0;
  let newestAccessTime = Number.NEGATIVE_INFINITY;

  for (const [index, source] of sources.entries()) {
    const label = isNonempty(source?.id) ? source.id : `source[${index}]`;
    for (const field of [
      'publisher',
      'source_type',
      'url',
      'title',
      'section',
      'published_or_effective_on',
      'accessed_on',
    ]) {
      if (!isNonempty(source?.[field])) {
        add('SOURCE_METADATA', `${label}.${field} must be nonempty`);
      }
    }
    if (source?.publisher !== 'DeleteMe / Abine') {
      add('SOURCE_PUBLISHER', `${label} must name DeleteMe / Abine as publisher`);
    }
    if (!H7_SOURCE_TYPES.has(source?.source_type)) {
      add('SOURCE_TYPE', `${label} has unsupported source_type ${JSON.stringify(source?.source_type)}`);
    } else {
      seenSourceTypes.add(source.source_type);
    }

    try {
      const url = new URL(source?.url);
      if (url.protocol !== 'https:' || !H7_ALLOWED_HOSTS.has(url.hostname)) {
        add('SOURCE_DOMAIN', `${label} must use HTTPS on an official DeleteMe/Abine host`);
      }
    } catch {
      add('SOURCE_DOMAIN', `${label} has an invalid URL`);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(source?.accessed_on ?? '')) {
      add('SOURCE_DATE', `${label}.accessed_on must be an ISO date`);
      continue;
    }
    const accessed = new Date(`${source.accessed_on}T00:00:00Z`);
    if (Number.isNaN(accessed.getTime())
      || accessed.toISOString().slice(0, 10) !== source.accessed_on) {
      add('SOURCE_DATE', `${label}.accessed_on must be a real calendar date`);
      continue;
    }
    datedSources += 1;
    newestAccessTime = Math.max(newestAccessTime, accessed.getTime());
    const ageDays = Math.floor((asOfDate - accessed) / 86_400_000);
    if (ageDays < 0) {
      add('SOURCE_FUTURE', `${label} was accessed after --as-of=${asOf}`);
    } else if (ageDays > H7_MAX_SOURCE_AGE_DAYS) {
      add('SOURCE_STALE', `${label} is ${ageDays} days old at --as-of=${asOf}; maximum is ${H7_MAX_SOURCE_AGE_DAYS}`);
    }
  }
  if (datedSources === 0 && sources.length > 0) {
    add('SOURCE_DATE', 'no source has a valid access date');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(comparison?.reviewed_on ?? '')) {
    add('REVIEW_DATE', 'reviewed_on must be an ISO date');
  } else {
    const reviewed = new Date(`${comparison.reviewed_on}T00:00:00Z`);
    if (Number.isNaN(reviewed.getTime())
      || reviewed.toISOString().slice(0, 10) !== comparison.reviewed_on) {
      add('REVIEW_DATE', 'reviewed_on must be a real calendar date');
    } else {
      if (reviewed > asOfDate) {
        add('REVIEW_DATE', `reviewed_on cannot be after --as-of=${asOf}`);
      }
      if (Number.isFinite(newestAccessTime) && reviewed.getTime() < newestAccessTime) {
        add('REVIEW_DATE', 'reviewed_on cannot precede the newest source access date');
      }
    }
  }
  for (const sourceType of H7_REQUIRED_SOURCE_TYPES) {
    if (!seenSourceTypes.has(sourceType)) {
      add('SOURCE_CLASS', `required source class ${sourceType} is absent`);
    }
  }

  const dimensions = list(comparison?.dimensions);
  const dimensionIds = dimensions.map((dimension) => dimension?.id).filter(isNonempty);
  if (dimensions.length !== H7_DIMENSION_IDS.length
    || !H7_DIMENSION_IDS.every((id) => dimensionIds.includes(id))) {
    add('DIMENSION_SET', `dimensions must be exactly: ${H7_DIMENSION_IDS.join(', ')}`);
  }
  if (dimensionIds.length !== dimensions.length || !unique(dimensionIds)) {
    add('DIMENSION_ID', 'every dimension needs a unique nonempty id');
  }
  const dimensionById = new Map(dimensions.map((dimension) => [dimension?.id, dimension]));
  const factIds = [];
  let unknownCount = 0;
  let conflictCount = 0;
  let limitationCount = 0;

  const capabilityById = new Map(
    list(pricing.capability_registry).map((entry) => [entry?.id, entry]),
  );
  for (const capabilityId of ['scrub-discovery', 'scrub-guided-deletion', 'autoscrub']) {
    const capability = capabilityById.get(capabilityId);
    if (!capability || capability.status !== 'Planned') {
      add('OSL_STATUS', `${capabilityId} must resolve to exact status Planned`);
    }
    if (!capability || capability.sellable !== false) {
      add('OSL_SELLABILITY', `${capabilityId} must remain explicitly sellable:false`);
    }
  }
  const exactCapabilityEvidence = new Map([
    ['scrub-discovery', {
      evidence: [/\bno evidence names an exact build\b/i, /\bdetected 0 accounts\b/i, /\bbrowser import\b/i],
      public_note: [/\bin progress\b/i, /\bfound no accounts\b/i, /\bbrowser import\b/i],
    }],
    ['scrub-guided-deletion', {
      evidence: [/\bcannot be exercised end to end\b/i, /\bnever shown as verified deletion\b/i],
      public_note: [/\bnot yet\b/i, /\bholds every candidate\b/i, /\bconfirm each removal\b/i],
    }],
    ['autoscrub', {
      evidence: [/\bactive implementation\b/i, /\bpackaging unresolved\b/i, /\bnot installed by default\b/i],
      public_note: [/\bnot yet\b/i, /\bswitched-off interface scaffolding\b/i, /\bnot installed by default\b/i],
    }],
  ]);
  for (const [capabilityId, fieldContracts] of exactCapabilityEvidence) {
    const capability = capabilityById.get(capabilityId);
    for (const [field, patterns] of Object.entries(fieldContracts)) {
      const text = capability?.[field] ?? '';
      const operationalContradiction = hasAffirmative(
        text,
        /\b(?:available now|complete coverage|fully working|operational|shipping|working today)\b/i,
      );
      if (!patterns.every((pattern) => pattern.test(text)) || operationalContradiction) {
        add('OSL_EVIDENCE', `${capabilityId}.${field} must independently preserve its exact non-operational limitation`);
      }
    }
  }

  for (const [index, dimension] of dimensions.entries()) {
    const label = isNonempty(dimension?.id) ? dimension.id : `dimension[${index}]`;
    if (!['established', 'conflicted'].includes(dimension?.status)) {
      add('DIMENSION_STATUS', `${label}.status must be established or conflicted`);
    }

    const facts = list(dimension?.deleteme_facts);
    if (facts.length === 0) {
      add('FACT_FLOOR', `${label} needs at least one established, source-bound fact`);
    }
    for (const [factIndex, fact] of facts.entries()) {
      const factLabel = isNonempty(fact?.id) ? fact.id : `${label}.fact[${factIndex}]`;
      if (!isNonempty(fact?.id)) {
        add('FACT_ID', `${factLabel} needs a nonempty id`);
      } else {
        factIds.push(fact.id);
      }
      for (const field of ['paraphrase', 'qualifiers']) {
        if (!isNonempty(fact?.[field])) {
          add('FACT_METADATA', `${factLabel}.${field} must be nonempty`);
        }
      }
      if (!H7_CONFIDENCE.has(fact?.confidence)) {
        add('FACT_CONFIDENCE', `${factLabel}.confidence must be high, medium, or low`);
      }
      const factSources = list(fact?.source_ids);
      if (factSources.length === 0) {
        add('FACT_SOURCE', `${factLabel} must cite at least one source`);
      }
      for (const sourceId of factSources) {
        if (!sourceById.has(sourceId)) {
          add('DANGLING_SOURCE', `${factLabel} cites missing source ${JSON.stringify(sourceId)}`);
        }
      }
    }

    const unknowns = list(dimension?.unknowns);
    unknownCount += unknowns.length;
    for (const [unknownIndex, unknown] of unknowns.entries()) {
      const unknownLabel = `${label}.unknown[${unknownIndex}]`;
      if (!isNonempty(unknown?.field) || !isNonempty(unknown?.reason)) {
        add('UNKNOWN_METADATA', `${unknownLabel} needs field and reason`);
      }
      const attempted = list(unknown?.attempted_source_ids);
      if (attempted.length === 0) {
        add('UNKNOWN_SOURCES', `${unknownLabel} needs attempted_source_ids`);
      }
      for (const sourceId of attempted) {
        if (!sourceById.has(sourceId)) {
          add('DANGLING_SOURCE', `${unknownLabel} cites missing attempted source ${JSON.stringify(sourceId)}`);
        }
      }
    }

    if (dimension?.status === 'conflicted') {
      conflictCount += 1;
      const cited = new Set(facts.flatMap((fact) => list(fact?.source_ids)));
      if (!isNonempty(dimension?.conflict_explanation) || cited.size < 2) {
        add('CONFLICT', `${label} needs a nonempty conflict explanation and at least two sources`);
      }
    }

    const refs = list(dimension?.osl_manifest_refs);
    if (refs.length === 0) {
      add('OSL_REF', `${label} needs at least one OSL manifest reference`);
    }
    for (const [refIndex, ref] of refs.entries()) {
      const refLabel = `${label}.osl_manifest_refs[${refIndex}]`;
      const match = /^\/capability_registry\/([a-z0-9-]+)$/.exec(ref?.json_pointer ?? '');
      if (!match) {
        add('OSL_REF', `${refLabel} must use /capability_registry/<stable-id>, never a numeric array index`);
        continue;
      }
      const capability = capabilityById.get(match[1]);
      if (!capability) {
        add('OSL_REF', `${refLabel} points to missing capability ${match[1]}`);
      } else if (ref?.expected_status !== capability.status) {
        add('OSL_STATUS', `${refLabel} expected ${JSON.stringify(ref?.expected_status)} but manifest says ${capability.status}`);
      }
    }

    if (!isNonempty(dimension?.osl_limitation)) {
      add('OSL_LIMITATION', `${label}.osl_limitation must be nonempty`);
    } else {
      limitationCount += 1;
    }
    if (!isNonempty(dimension?.bounded_conclusion)) {
      add('CONCLUSION', `${label}.bounded_conclusion must be nonempty`);
    }
    if (!H7_COMPARABILITY.has(dimension?.comparability)) {
      add('COMPARABILITY', `${label}.comparability must be not_equivalent or narrowly_comparable`);
    }
  }

  if (!unique(factIds)) {
    add('FACT_ID', 'fact ids must be unique across the comparison');
  }
  if (unknownCount < 1) {
    add('UNKNOWN_FLOOR', 'at least one explicit unknown is required');
  }
  if (conflictCount < 1) {
    add('CONFLICT_FLOOR', 'at least one conflicted dimension is required');
  }
  if (limitationCount !== H7_DIMENSION_IDS.length) {
    add('OSL_LIMITATION', `all ${H7_DIMENSION_IDS.length} dimensions need an OSL limitation`);
  }

  const scope = dimensionById.get('scope');
  const scopeFacts = new Map(list(scope?.deleteme_facts).map((fact) => [fact?.id, fact]));
  const standardScope = scopeFacts.get('standard-us-87')?.paraphrase ?? '';
  const broaderScope = scopeFacts.get('broader-catalog-976')?.paraphrase ?? '';
  if (scope?.status !== 'conflicted'
    || !/\b87\b/.test(standardScope)
    || !/\bStandard[- ]US\b/i.test(standardScope)
    || !/\b976\b/.test(broaderScope)
    || !/\bnot\b[^.]{0,80}\bStandard[- ]US\b/i.test(broaderScope)) {
    add('SCOPE_SEMANTICS', 'scope must preserve 87 as the Standard-US named list, 976 as a separate non-Standard-US catalog, and the conflict');
  }
  if (!list(scope?.unknowns).some((unknown) => unknown?.field === 'single_current_global_coverage_count')) {
    add('SCOPE_CONFLICT', 'scope must preserve the unresolved global coverage count');
  }
  const addedStandard976Claim = list(scope?.deleteme_facts).some((fact) => {
    const text = `${fact?.paraphrase ?? ''} ${fact?.qualifiers ?? ''}`;
    if (!/\b976\b/.test(text) || !/\bStandard[- ]US\b/i.test(text)) return false;
    const explicitlySeparated = /\bnot\b[^.!?;]{0,100}\bStandard[- ]US\b/i.test(text)
      || /\bStandard[- ]US\b[^.!?;]{0,100}\bnot\b[^.!?;]{0,80}\b976\b/i.test(text);
    return !explicitlySeparated;
  });
  if (addedStandard976Claim) {
    add('SCOPE_SEMANTICS', 'no fact may present 976 as Standard-US included scope');
  }
  const scopeClaimTexts = claimTexts(scope);
  if (scopeClaimTexts.some((text) => /\b(?:50|85|850)\s*\+?\b/.test(text))) {
    add('SCOPE_SEMANTICS', '50+, 85+, and 850+ are not admissible scope figures anywhere in the comparison');
  }
  const scope976Occurrences = scopeClaimTexts
    .reduce((count, text) => count + [...text.matchAll(/\b976\b/g)].length, 0);
  if (scope976Occurrences !== 2) {
    add('SCOPE_SEMANTICS', '976 may occur only in the pinned broader-catalog fact and the scope conflict explanation');
  }

  const price = dimensionById.get('price');
  const priceFacts = new Map(list(price?.deleteme_facts).map((fact) => [fact?.id, fact]));
  const standardPrice = priceFacts.get('standard-one-person-year')?.paraphrase ?? '';
  const premiumPrice = priceFacts.get('premium-one-person-year')?.paraphrase ?? '';
  if (!/\$129\b/.test(standardPrice)
    || !/\bper year\b/i.test(standardPrice)
    || !/\brenews automatically\b/i.test(standardPrice)
    || !/\$180\b/.test(premiumPrice)
    || !/\bper year\b/i.test(premiumPrice)
    || !/\brenews automatically\b/i.test(premiumPrice)) {
    add('PRICE_SEMANTICS', 'price must preserve Standard $129/year and Premium $180/year as US auto-renewing one-person plans');
  }

  const monitoring = dimensionById.get('ongoing_monitoring');
  const monitoringFacts = new Map(
    list(monitoring?.deleteme_facts).map((fact) => [fact?.id, fact]),
  );
  const monitoringClaimTexts = claimTexts(monitoring);
  const continuousUnknown = list(monitoring?.unknowns)
    .find((unknown) => unknown?.field === 'continuous_monitoring');
  const hasAffirmativeContinuousClaim = monitoringClaimTexts.some((text) => (
    hasAffirmative(text, /\b(?:continuous(?:ly)?|constantly|always|24\s*\/\s*7|around[- ]the[- ]clock)\b/i)
  ));
  if (hasAffirmativeContinuousClaim) {
    add('MONITORING_CLAIM', 'literal continuous, constant, always-on, or 24-hour monitoring must not be claimed');
  }
  if (!continuousUnknown
    || !/\b(?:does not establish|unknown|not stated|does not specify)\b/i.test(continuousUnknown.reason ?? '')) {
    add('MONITORING_UNKNOWN', 'continuous monitoring must remain explicitly unknown');
  }
  if (!/\bfour\b/i.test(monitoringFacts.get('standard-four-reports')?.paraphrase ?? '')
    || !/\bsix\b/i.test(monitoringFacts.get('premium-six-reports')?.paraphrase ?? '')) {
    add('MONITORING_CADENCE', 'monitoring must preserve Standard four and Premium six scans/reports per year');
  }

  const removals = dimensionById.get('removals');
  const removalFacts = new Map(list(removals?.deleteme_facts).map((fact) => [fact?.id, fact]));
  const memberFact = removalFacts.get('member-confirmation-required');
  if (!memberFact
    || !/\bmember\b/i.test(memberFact.paraphrase ?? '')
    || !/\b(?:confirm|confirmation|authentication|action)\b/i.test(memberFact.paraphrase ?? '')) {
    add('MEMBER_CONFIRMATION', 'the member-confirmation limitation must be preserved');
  }
  const guaranteeFact = removalFacts.get('no-guaranteed-completion');
  if (!guaranteeFact
    || !/\bnot\b[^.]{0,80}\b(?:guarantee|every third party|honor)\b/i.test(guaranteeFact.paraphrase ?? '')) {
    add('REMOVAL_GUARANTEE', 'third-party removal must remain expressly unguaranteed');
  }
  if (claimTexts(removals).some((text) => hasAffirmative(text, /\bguarantee(?:s|d)?\b/i))) {
    add('REMOVAL_GUARANTEE', 'no removal fact, qualifier, limitation, or conclusion may guarantee third-party action');
  }
  const processFact = removalFacts.get('submits-and-checks-opt-outs')?.paraphrase ?? '';
  if (!/\bsubmits?\b/i.test(processFact)
    || !/\b(?:checks?|reappear)\b/i.test(processFact)
    || !/\b(?:immediate|weeks)\b/i.test(processFact)) {
    add('REMOVAL_PROCESS', 'removals must preserve opt-out submission, follow-up/reappearance checks, and immediate-to-weeks timing');
  }

  const completion = dimensionById.get('completion_reporting');
  const firstReport = list(completion?.deleteme_facts)
    .find((fact) => fact?.id === 'first-report-status-only');
  if (!firstReport
    || !/\bnot\b[^.]{0,80}\bproof\b/i.test(firstReport.paraphrase ?? '')) {
    add('COMPLETION_PROOF', 'the first report must remain a status update, not completion proof');
  }
  if (claimTexts(completion).some((text) => (
    hasAffirmative(text, /\b(?:proof|prov(?:e|es|ed|ing))\b/i)
  ))) {
    add('COMPLETION_PROOF', 'no completion fact, qualifier, unknown, limitation, or conclusion may promote a report to proof');
  }

  const dataHandling = dimensionById.get('data_handling');
  const dataFacts = new Map(list(dataHandling?.deleteme_facts).map((fact) => [fact?.id, fact]));
  const disclosures = dataFacts.get('broker-and-provider-disclosures')?.paraphrase ?? '';
  const retention = dataFacts.get('retention-windows')?.paraphrase ?? '';
  if (!/\bbroker sites?\b/i.test(disclosures)
    || !/\bdoes not sell\b/i.test(disclosures)
    || !/\bplus six months\b/i.test(retention)
    || !/\bat least seven years\b/i.test(retention)) {
    add('DATA_HANDLING_SEMANTICS', 'data handling must preserve broker/provider disclosure, no-sale, membership-plus-six-month, and seven-year-payment facts');
  }

  const limitations = dimensionById.get('limitations');
  const limitationFacts = new Map(list(limitations?.deleteme_facts).map((fact) => [fact?.id, fact]));
  const thirdPartyLimit = limitationFacts.get('third-party-no-guarantee')?.paraphrase ?? '';
  if (!/\bdoes not guarantee\b/i.test(thirdPartyLimit)
    || !/\bdoes not claim to remove all\b/i.test(thirdPartyLimit)
    || !limitationFacts.has('no-opt-out-public-records')
    || !limitationFacts.has('google-source-first')
    || !limitationFacts.has('social-user-action')) {
    add('LIMITATION_SEMANTICS', 'limitations must preserve no-guarantee, incomplete-internet, public-record/no-opt-out, Google, and social-platform boundaries');
  }

  const exactOslLimitations = new Map([
    ['scope', [/\bPlanned\b/, /\bno named build\b/i, /\b(?:accounts|browser import)\b/i]],
    ['price', [/\$5\b/, /\bcheckout is paused\b/i, /\b(?:redemption|automatic expiry)\b/i, /\bAutoScrub\b/]],
    ['ongoing_monitoring', [/\bPlanned\b/, /\bscaffolding\b/i, /\bno proved recurring\b/i]],
    ['removals', [/\bPlanned\b/, /\bholds every candidate\b/i, /\bowner must confirm\b/i]],
    ['data_handling', [/\bdesign intention\b/i, /\bclosed source\b/i, /\bunavailable\b/i]],
    ['completion_reporting', [/\bPlanned\b/, /\bno completed-removal status\b/i, /\bdeletion receipt\b/i]],
    ['limitations', [/\ball Planned\b/i, /\bzero accounts\b/i, /\bno efficacy claim\b/i]],
  ]);
  for (const [dimensionId, patterns] of exactOslLimitations) {
    const limitation = dimensionById.get(dimensionId)?.osl_limitation ?? '';
    if (!patterns.every((pattern) => pattern.test(limitation))) {
      add('OSL_LIMITATION_SEMANTICS', `${dimensionId} must preserve its exact current OSL limitation`);
    }
  }

  const allClaimTexts = dimensions.flatMap((dimension) => claimTexts(dimension));
  if (allClaimTexts.some((text) => (
    hasAffirmative(text, /\b(?:better|best|winner|wins|superior|replacement)\b/i)
  ))) {
    add('WINNER_LANGUAGE', 'winner, superiority, or replacement marketing is forbidden');
  }

  return errors;
}

function buildConfig(pricing) {
  const registry = pricing.capability_registry ?? [];
  return {
    patterns: forbiddenPatterns(pricing.forbidden_claims ?? []),
    capabilityLabels: pricing.capability_labels ?? [],
    crawlerPolicy: pricing.crawler_policy ?? {},
    forbiddenPhrases: pricing.forbidden_phrases ?? [],
    requiredPhrases: pricing.required_phrases ?? [],
    registryById: new Map(registry.map((entry) => [entry.id, entry])),
    surfacePolicy: pricing.surface_policy ?? {},
    launchFrame: pricing.launch_frame ?? {},
    intendedGrantDays: pricing.tiers?.pro?.intended_grant_days,
  };
}

// Known-bad fixtures. If the crawler stops catching any of these it has become
// an all-green source-shape test, which is worse than no check at all.
const SELF_TEST_CASES = [
  {
    name: 'false capability claim',
    file: 'docs/faq.html',
    html: '<p>group chats and server channels use Sender Keys today.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'forward secrecy claim',
    file: 'docs/index.html',
    html: '<p>Post-quantum hybrid, forward secrecy, where your keys live.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'erase wording',
    file: 'features.html',
    html: '<span class="scrub-drop-action"><i>Scan</i><b>Erase 3</b></span>',
    expect: 'false capability claim',
  },
  {
    name: 'key destruction wording',
    file: 'features.html',
    html: '<p>At zero, the key and readable message disappear.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'affirmative cryptographic erasure claim',
    file: 'features.html',
    html: '<p>Burn provides cryptographic erasure after send.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'all private conversation state sealed at rest',
    file: 'audit.html',
    html: '<p>All private conversation state is sealed at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all private state encrypted at rest',
    file: 'audit.html',
    html: '<p>All private state is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'false password mechanism for private identity keys',
    file: 'audit.html',
    html: '<p>Private identity keys are encrypted at rest with your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'reversed false password mechanism for identity keys',
    file: 'docs/faq.html',
    html: '<p>Your main password seals the identity private key.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'premodifier false password mechanism for identity keys',
    file: 'docs/faq.html',
    html: '<p>Private identity key encryption uses your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'reordered derived-key password mechanism for identity keys',
    file: 'docs/faq.html',
    html: '<p>A key derived from your main password encrypts private identity keys.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'passive derived-key password mechanism for identity keys',
    file: 'docs/faq.html',
    html: '<p>Private identity keys are encrypted with a key derived from your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'for-noun password mechanism for identity keys',
    file: 'docs/faq.html',
    html: '<p>Encryption for private identity keys relies on your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password-derived adjective mechanism for identity keys',
    file: 'docs/faq.html',
    html: '<p>Private identity keys are encrypted with a main-password-derived key.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password-based encryption protects identity keys',
    file: 'docs/faq.html',
    html: '<p>Password-based encryption protects private identity keys.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'identity keys use main-password-derived encryption',
    file: 'docs/faq.html',
    html: '<p>Private identity keys use main-password-derived encryption.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password-derived material keys identity encryption',
    file: 'docs/faq.html',
    html: '<p>Private identity key encryption is keyed by material derived from your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password directly keys identity encryption',
    file: 'docs/faq.html',
    html: '<p>Private identity key encryption is keyed by your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'identity encryption derived from password',
    file: 'docs/faq.html',
    html: '<p>Identity key encryption is derived from your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'identity encryption via password',
    file: 'docs/faq.html',
    html: '<p>Private identity keys are encrypted via your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password-derived key actively encrypts identity keys',
    file: 'docs/faq.html',
    html: '<p>A main-password-derived key encrypts private identity keys.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password-based key encrypts identity keys',
    file: 'docs/faq.html',
    html: '<p>Private identity keys are encrypted with a password-based key.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'identity encryption based on password',
    file: 'docs/faq.html',
    html: '<p>Encryption for private identity keys is based on your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password-derived encryption protects identity keys',
    file: 'docs/faq.html',
    html: '<p>Password-derived encryption protects private identity keys.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'identity keys use password-based encryption',
    file: 'docs/faq.html',
    html: '<p>Private identity keys use password-based encryption.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local state password-protected',
    file: 'docs/faq.html',
    html: '<p>All local state is password-protected.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password encrypts all local data',
    file: 'docs/faq.html',
    html: '<p>Your password encrypts all local data.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'every private device record password-protected',
    file: 'docs/faq.html',
    html: '<p>Every private record on this device is protected with your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'recovery material for password-protected local state',
    file: 'docs/faq.html',
    html: '<p>OSL provides recovery material for password-protected local state.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'inline markup cannot split an at-rest overclaim',
    file: 'docs/faq.html',
    html: '<p>All <em>local</em> state is password-protected.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'HTML entities cannot split an at-rest overclaim',
    file: 'docs/faq.html',
    html: '<p>All local state is password&#45;protected.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'reversed at-rest overclaim',
    file: 'audit.html',
    html: '<p>Encrypted at rest with your password: all private state on this device.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local storage encrypted with main password',
    file: 'docs/faq.html',
    html: '<p>All local storage is encrypted with your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local metadata password-protected',
    file: 'docs/faq.html',
    html: '<p>All local metadata is password-protected.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'everything private encrypted at rest',
    file: 'docs/faq.html',
    html: '<p>Everything private on this device is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local records encrypted with password',
    file: 'docs/faq.html',
    html: '<p>All local records are encrypted with your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'everything OSL stores locally encrypted at rest',
    file: 'docs/faq.html',
    html: '<p>Everything OSL stores locally is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'main password secures all local data',
    file: 'docs/faq.html',
    html: '<p>Your main password secures all local data.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local data encrypted using main password',
    file: 'docs/faq.html',
    html: '<p>All local data is encrypted using your main password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'every local preference password-protected',
    file: 'docs/faq.html',
    html: '<p>Every local preference is password-protected.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all on-device records protected with password',
    file: 'docs/faq.html',
    html: '<p>All on-device records are protected with your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all locally stored information password-protected',
    file: 'docs/faq.html',
    html: '<p>All locally stored information is password-protected.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'whole OSL profile encrypted at rest',
    file: 'docs/faq.html',
    html: '<p>Your whole OSL profile is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'no private local information ever plaintext',
    file: 'docs/faq.html',
    html: '<p>No private information stored locally is ever plaintext.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'reversed at-rest word order',
    file: 'docs/faq.html',
    html: '<p>At rest, every local record is encrypted.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'reversed password word order',
    file: 'docs/faq.html',
    html: '<p>With your main password, all local data is encrypted.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local records require password to decrypt',
    file: 'docs/faq.html',
    html: '<p>All local records require your password to decrypt.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'never writes private data plaintext',
    file: 'docs/faq.html',
    html: '<p>OSL never writes private data in plaintext.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'nothing stored locally plaintext',
    file: 'docs/faq.html',
    html: '<p>Nothing stored locally is plaintext.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all data saved by OSL encrypted at rest',
    file: 'docs/faq.html',
    html: '<p>All data saved by OSL is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all computer information password-protected',
    file: 'docs/faq.html',
    html: '<p>All information on your computer is protected with your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'three-sentence at-rest composition',
    file: 'docs/faq.html',
    html: '<p>Every record is private. It is stored locally. It is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'no local record readable without password',
    file: 'docs/faq.html',
    html: '<p>No local record can be read without your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'never stores unencrypted private data',
    file: 'docs/faq.html',
    html: '<p>OSL never stores unencrypted private data.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local data kept as ciphertext',
    file: 'docs/faq.html',
    html: '<p>All local data is kept as ciphertext.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'every local record password-gated',
    file: 'docs/faq.html',
    html: '<p>Every local record is password-gated.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all private files locked by password',
    file: 'docs/faq.html',
    html: '<p>All private files are locked by your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'everything app keeps on machine encrypted',
    file: 'docs/faq.html',
    html: '<p>Everything the app keeps on your machine is encrypted.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all persisted data password-protected',
    file: 'docs/faq.html',
    html: '<p>All persisted data is protected with your password.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'every saved preference encrypted at rest',
    file: 'docs/faq.html',
    html: '<p>Every saved preference is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password guards all local content',
    file: 'docs/faq.html',
    html: '<p>Your password guards all local content.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'password unlocks all local storage',
    file: 'docs/faq.html',
    html: '<p>Only your password can unlock all local storage.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'reverse never-plaintext order',
    file: 'docs/faq.html',
    html: '<p>Plaintext is never written for private local data.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'zero plaintext local records',
    file: 'docs/faq.html',
    html: '<p>There are zero plaintext local records.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'four-sentence at-rest composition',
    file: 'docs/faq.html',
    html: '<p>Every record is private. OSL creates it. It stores it locally. The data is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'encrypts everything retained on device',
    file: 'docs/faq.html',
    html: '<p>On your device, OSL encrypts everything it retains.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'retains no private data in clear',
    file: 'docs/faq.html',
    html: '<p>OSL retains no private data in the clear.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local records inaccessible without passphrase',
    file: 'docs/faq.html',
    html: '<p>Every local record is inaccessible unless the passphrase is entered.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'split generic item and local-record scope',
    file: 'docs/faq.html',
    html: '<p>Every item is protected. They are OSL’s on-device records.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'entire on-disk database encrypted',
    file: 'docs/faq.html',
    html: '<p>The entire on-disk database is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'each retained machine record encrypted',
    file: 'docs/faq.html',
    html: '<p>Each record retained on this machine is encrypted at rest.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'one hundred percent retained data encrypted',
    file: 'docs/faq.html',
    html: '<p>OSL encrypts 100% of the data it retains.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'totality retained data encrypted',
    file: 'docs/faq.html',
    html: '<p>OSL encrypts the totality of its retained data.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'everything retained enciphered',
    file: 'docs/faq.html',
    html: '<p>Everything OSL retains on this device is enciphered.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'no retained secret cleartext',
    file: 'docs/faq.html',
    html: '<p>No secret OSL keeps on this machine is ever cleartext.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local records unreadable until password',
    file: 'docs/faq.html',
    html: '<p>All local records are unreadable until the main password is entered.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'all local records opaque until passphrase',
    file: 'docs/faq.html',
    html: '<p>Every local record remains opaque until the passphrase is supplied.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'split all-records and locality',
    file: 'docs/faq.html',
    html: '<p>All records are protected. OSL retains them on this device.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'split everything and local records',
    file: 'docs/faq.html',
    html: '<p>Everything is encrypted. OSL retains those records on your device.</p>',
    expect: 'at-rest overclaim',
  },
  {
    name: 'unlimited messages positioning',
    file: 'download.html',
    html: '<li>Unlimited private messages</li>',
    expect: 'false capability claim',
  },
  {
    name: 'superseded billing wording',
    file: 'download.html',
    html: '<p><strong>$5</strong> one time</p>',
    expect: 'forbidden billing',
  },
  {
    name: 'subscription wording',
    file: 'docs/terms.html',
    html: '<p>Manage your subscription in the billing portal.</p>',
    expect: 'forbidden billing',
  },
  {
    name: 'bare price outside the manifest',
    file: 'index.html',
    html: '<button>Get Pro &middot; $5</button>',
    expect: 'bare price',
  },
  {
    name: 'label promoted above the manifest',
    file: 'features.html',
    html: '<span data-osl-feature="expiry" data-osl-status="Available">Available</span>',
    expect: 'label drift',
  },
  {
    name: 'status outside the permitted vocabulary',
    file: 'features.html',
    html: '<span data-osl-feature="expiry" data-osl-status="Shipping">Shipping</span>',
    expect: 'capability badge',
  },
  {
    name: 'unknown feature id',
    file: 'features.html',
    html: '<span data-osl-feature="telepathy" data-osl-status="Beta">Beta</span>',
    expect: 'capability badge',
  },
  {
    name: 'the one true crypto sentence deleted',
    file: 'docs/how-it-works.html',
    html: '<p>Direct messages are sealed to the recipient.</p>',
    expect: 'missing required sentence',
  },
  // --- Surface rules (owner decision 2026-07-26).
  {
    name: 'present-tense marketing claim about an unfinished capability',
    file: 'features.html',
    html: '<section><p class="eyebrow">Burn <span data-osl-feature="burn"></span></p><p>Burn removes the message from every device it reached.</p></section>',
    expect: 'present-tense capability claim',
  },
  {
    name: 'marketing page with no link to the support matrix',
    file: 'features.html',
    html: '<section><p>Everything about OSL v1.</p></section>',
    expect: 'missing matrix link',
  },
  {
    name: 'unfinished capability sold in the checkout summary',
    file: 'download.html',
    html: '<!--osl:checkout-summary--><ul><li>Send encrypted images <span data-osl-feature="image-send"></span></li></ul><!--/osl:checkout-summary-->',
    expect: 'unsellable at checkout',
  },
  {
    name: 'planned image sending sold as a Pro unlock without a capability badge',
    file: 'docs/terms.html',
    html: '<p>Pro unlocks encrypted image sending.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'future redemption record described as current',
    file: 'audit.html',
    html: '<p>A redemption record is a licence hash and a timestamp.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'unimplemented redemption-start promise',
    file: 'docs/faq.html',
    html: '<p>Your month starts when you enter the code.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'unimplemented automatic return to Free',
    file: 'docs/terms.html',
    html: '<p>When Pro ends, OSL returns to Free.</p>',
    expect: 'false capability claim',
  },
  {
    name: 'equivalent unimplemented 30-day activation-code grant',
    file: 'pricing.html',
    html: '<p>An activation code grants 30 days of Pro.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'duration-before-code comes-with paraphrase',
    file: 'pricing.html',
    html: '<p>One month of Pro comes with each activation code.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'code-before-duration includes paraphrase',
    file: 'download.html',
    html: '<p>Each prepaid code includes a full month of Pro.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'unrelated planned expiry does not excuse current grant',
    file: 'docs/faq.html',
    html: '<p>Each activation code grants 30 days of Pro; an expiry notice is planned.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'activation-key month grant synonym',
    file: 'pricing.html',
    html: '<p>Each activation key grants Pro for one month.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'paid-Pro-voucher 30-day synonym',
    file: 'download.html',
    html: '<p>A paid Pro voucher lasts 30 days.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'adjacent activation-code duration continuation',
    file: 'docs/faq.html',
    html: '<p>An activation code grants Pro.</p><p>It lasts 30 days.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'product-key synonym',
    file: 'pricing.html',
    html: '<p>Each product-key grants Pro for one month.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'redemption-token synonym',
    file: 'download.html',
    html: '<p>A redemption-token grants Pro for 30 days.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'decoded nonbreaking-space duration',
    file: 'pricing.html',
    html: '<p>An activation code grants Pro for one&nbsp;month.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'inline-tag split duration digits',
    file: 'pricing.html',
    html: '<p>An activation code grants Pro for <span>3</span><span>0</span> days.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'forward cross-sentence grant',
    file: 'docs/faq.html',
    html: '<p>An activation code grants Pro.</p><p>Access lasts one month.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'reverse cross-sentence grant',
    file: 'docs/faq.html',
    html: '<p>Pro access lasts 30 days.</p><p>Use the product key to unlock it.</p>',
    expect: 'unimplemented grant-duration claim',
  },
  {
    name: 'support matrix silently dropping a capability',
    file: 'docs/status.html',
    html: '<table><tr><td><span data-osl-feature="burn" data-osl-status="Planned">Planned</span></td></tr></table>',
    expect: 'matrix gap',
  },
  {
    name: 'support matrix row with no status',
    file: 'docs/status.html',
    html: '<table><tr><td><span data-osl-feature="burn">burn</span></td></tr></table>',
    expect: 'capability badge',
  },
];

// Copy that must NOT be flagged. A gate that fires on honest writing gets
// switched off, so these matter as much as the known-bad cases.
const NEGATION_CASES = [
  {
    name: 'honest no-subscription sentence',
    file: 'docs/terms.html',
    html: '<p>This is not a subscription: nothing renews automatically.</p>',
    kinds: ['forbidden billing', 'forbidden claim'],
  },
  {
    name: 'honest no-recurring sentence',
    file: 'docs/terms.html',
    html: '<p>The current checkout does not create a recurring subscription.</p>',
    kinds: ['forbidden billing', 'forbidden claim'],
  },
  {
    name: 'honest no-cryptographic-erasure limitation',
    file: 'features.html',
    html: '<p>Burn is not cryptographic erasure.</p>',
    kinds: ['false capability claim'],
  },
  {
    name: 'honest identity-key and plaintext-metadata boundary',
    file: 'audit.html',
    html: '<p>Private identity keys are sealed at rest. Some conversation metadata may remain plaintext without an installed storage key.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest identity-key at-rest claim',
    file: 'audit.html',
    html: '<p>Private identity keys are sealed at rest by a persistent TPM or operating-system credential-store sealer.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest encrypted message-body claim',
    file: 'audit.html',
    html: '<p>Decrypted message bodies in the message store are encrypted at rest.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest universal encrypted message-body claim',
    file: 'audit.html',
    html: '<p>All decrypted message bodies in the message store are encrypted at rest.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest password coverage limitation',
    file: 'docs/faq.html',
    html: '<p>Password protection does not cover every local record.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest plaintext metadata limitation',
    file: 'docs/faq.html',
    html: '<p>Some conversation metadata and preferences may remain plaintext when no storage key is installed.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest plaintext-write restoration',
    file: 'docs/faq.html',
    html: '<p>Removing the storage key restores plaintext writes.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest combined key claim and plaintext limitation',
    file: 'audit.html',
    html: '<p>Private identity keys use the operating-system credential sealer, but main-password protection does not cover every local record.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest identity sealer rather than password relationship',
    file: 'audit.html',
    html: '<p>Private identity keys are sealed by the operating-system credential store rather than your main password.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest status metadata does-not-mean limitation',
    file: 'docs/faq.html',
    html: '<p>Status metadata reports whether an identity-key storage key is installed; it does not mean all local records are encrypted.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest status metadata does-not-imply limitation',
    file: 'docs/faq.html',
    html: '<p>Status metadata reports whether an identity-key storage key is installed; it does not imply that all local records are encrypted.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest status metadata not-evidence limitation',
    file: 'docs/faq.html',
    html: '<p>Status metadata is not evidence that every local record is encrypted.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest connected-service ciphertext limitation',
    file: 'docs/faq.html',
    html: '<p>Every supported message body retained by the connected service is ciphertext; this says nothing about local metadata.</p>',
    kinds: ['at-rest overclaim'],
  },
  {
    name: 'honest unimplemented grant-duration limitation',
    file: 'docs/terms.html',
    html: '<p>An activation code does not grant 30 days of Pro because paid-code expiry is not implemented.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest planned grant-duration limitation',
    file: 'docs/terms.html',
    html: '<p>A 30-day activation-code grant is planned.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest once-implemented grant-duration limitation',
    file: 'docs/terms.html',
    html: '<p>An activation code will grant one month of Pro once expiry is implemented.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest planned code-duration contract without grant verb',
    file: 'docs/terms.html',
    html: '<p>One month per activation code is planned.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest planned-feature limitation',
    file: 'docs/terms.html',
    html: '<p>A 30-day activation-code grant is a planned feature.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest unimplemented adjective limitation',
    file: 'docs/terms.html',
    html: '<p>A 30-day activation-code grant is unimplemented.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest if-implemented limitation',
    file: 'docs/terms.html',
    html: '<p>An activation key will grant Pro for one month if automatic expiry is implemented.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest planned-to-provide limitation',
    file: 'docs/terms.html',
    html: '<p>Activation keys are planned to provide one month of Pro.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest provided-implemented limitation',
    file: 'docs/terms.html',
    html: '<p>An activation code will provide one month of Pro, provided expiry is implemented.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'honest adjacent no-redemption-record limitation',
    file: 'audit.html',
    html: '<p>The intended purchase is for one month of Pro.</p><p>No redemption record exists yet for a licence.</p>',
    kinds: ['unimplemented grant-duration claim'],
  },
  {
    name: 'marketing may describe a v1 capability in forward-looking language',
    file: 'features.html',
    html: '<section><p class="eyebrow">Burn <span data-osl-feature="burn"></span></p><p>At v1, burn will delete OSL copies and ask the other side to delete too.</p><p><a href="/docs/status">See what works today</a></p></section>',
    kinds: ['present-tense capability claim', 'capability badge', 'missing matrix link'],
  },
  {
    name: 'marketing card may omit the status badge entirely',
    file: 'index.html',
    html: '<section><p>Scrub <span data-osl-feature="scrub-discovery"></span> is coming at v1.</p><a href="/docs/status">See what works today</a></section>',
    kinds: ['capability badge'],
  },
  {
    name: 'a proven capability needs no forward-looking hedge',
    file: 'features.html',
    html: '<section><p>Protected text <span data-osl-feature="protected-text" data-osl-status="Beta">Beta</span> works on Discord.</p><a href="/docs/status">See what works today</a></section>',
    kinds: ['present-tense capability claim'],
  },
  {
    name: 'checkout may list a capability that actually ships',
    file: 'download.html',
    html: '<!--osl:checkout-summary--><li>Protected text <span data-osl-feature="protected-text" data-osl-status="Beta">Beta</span></li><!--/osl:checkout-summary-->',
    kinds: ['unsellable at checkout'],
  },
];

const H7_SELF_TEST_MUTATIONS = [
  {
    name: 'missing required dimension',
    expect: 'H7_DIMENSION_SET',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.dimensions.pop();
    },
  },
  {
    name: 'duplicate dimension id',
    expect: 'H7_DIMENSION_ID',
    mutate(pricing) {
      const dimensions = pricing.research_comparisons.h7_deleteme.dimensions;
      dimensions.push(structuredClone(dimensions[0]));
    },
  },
  {
    name: 'empty source list',
    expect: 'H7_SOURCE_FLOOR',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.sources = [];
    },
  },
  {
    name: 'third-party source domain',
    expect: 'H7_SOURCE_DOMAIN',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.sources[0].url = 'https://example.com/deleteme-review';
    },
  },
  {
    name: 'missing source title and section',
    expect: 'H7_SOURCE_METADATA',
    mutate(pricing) {
      const source = pricing.research_comparisons.h7_deleteme.sources[0];
      delete source.title;
      delete source.section;
    },
  },
  {
    name: 'future access date',
    expect: 'H7_SOURCE_FUTURE',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.sources[0].accessed_on = '2026-07-28';
    },
  },
  {
    name: 'all access dates stale',
    expect: 'H7_SOURCE_STALE',
    mutate(pricing) {
      for (const source of pricing.research_comparisons.h7_deleteme.sources) {
        source.accessed_on = '2026-01-01';
      }
    },
  },
  {
    name: 'dangling fact source id',
    expect: 'H7_DANGLING_SOURCE',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.dimensions[0]
        .deleteme_facts[0].source_ids = ['missing-official-source'];
    },
  },
  {
    name: 'every established fact changed to unknown',
    expect: 'H7_FACT_FLOOR',
    mutate(pricing) {
      for (const dimension of pricing.research_comparisons.h7_deleteme.dimensions) {
        dimension.deleteme_facts = [];
        dimension.unknowns.push({
          field: `${dimension.id}_all_unknown`,
          reason: 'Mutation removes every established fact.',
          attempted_source_ids: ['terms-service'],
        });
      }
    },
  },
  {
    name: '976 presented as Standard-US included scope',
    expect: 'H7_SCOPE_SEMANTICS',
    mutate(pricing) {
      const scope = pricing.research_comparisons.h7_deleteme.dimensions
        .find((dimension) => dimension.id === 'scope');
      scope.deleteme_facts.push({
        id: 'contradictory-standard-us-976',
        paraphrase: 'DeleteMe includes 976 sites in the Standard-US plan.',
        source_ids: ['broader-broker-catalog'],
        confidence: 'high',
        qualifiers: 'Mutation adds a contradictory fact without changing the pinned facts.',
      });
    },
  },
  {
    name: 'scope conflict removed',
    expect: 'H7_SCOPE_SEMANTICS',
    mutate(pricing) {
      const scope = pricing.research_comparisons.h7_deleteme.dimensions
        .find((dimension) => dimension.id === 'scope');
      scope.status = 'established';
      delete scope.conflict_explanation;
    },
  },
  {
    name: 'literal continuous monitoring claimed',
    expect: 'H7_MONITORING_CLAIM',
    mutate(pricing) {
      const monitoring = pricing.research_comparisons.h7_deleteme.dimensions
        .find((dimension) => dimension.id === 'ongoing_monitoring');
      monitoring.bounded_conclusion += ' DeleteMe monitors every broker 24/7.';
    },
  },
  {
    name: 'first report promoted to completion proof',
    expect: 'H7_COMPLETION_PROOF',
    mutate(pricing) {
      const completion = pricing.research_comparisons.h7_deleteme.dimensions
        .find((dimension) => dimension.id === 'completion_reporting');
      completion.deleteme_facts.push({
        id: 'contradictory-first-report-proof',
        paraphrase: 'The first privacy report proves that every item has been removed.',
        source_ids: ['privacy-report'],
        confidence: 'high',
        qualifiers: 'Mutation adds a contradictory fact without changing the pinned fact.',
      });
    },
  },
  {
    name: 'third-party removal guaranteed',
    expect: 'H7_REMOVAL_GUARANTEE',
    mutate(pricing) {
      const removals = pricing.research_comparisons.h7_deleteme.dimensions
        .find((dimension) => dimension.id === 'removals');
      removals.deleteme_facts.push({
        id: 'contradictory-removal-guarantee',
        paraphrase: 'DeleteMe guarantees that every third party will remove the data.',
        source_ids: ['terms-service'],
        confidence: 'high',
        qualifiers: 'Mutation adds a contradictory fact without changing the pinned fact.',
      });
    },
  },
  {
    name: 'member-confirmation limitation removed',
    expect: 'H7_MEMBER_CONFIRMATION',
    mutate(pricing) {
      const removals = pricing.research_comparisons.h7_deleteme.dimensions
        .find((dimension) => dimension.id === 'removals');
      removals.deleteme_facts = removals.deleteme_facts
        .filter((fact) => fact.id !== 'member-confirmation-required');
    },
  },
  {
    name: 'missing capability reference',
    expect: 'H7_OSL_REF',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.dimensions[0]
        .osl_manifest_refs[0].json_pointer = '/capability_registry/missing-capability';
    },
  },
  {
    name: 'autoscrub promoted above Planned',
    expect: 'H7_OSL_STATUS',
    mutate(pricing) {
      pricing.capability_registry
        .find((capability) => capability.id === 'autoscrub')
        .status = 'Beta';
    },
  },
  {
    name: 'comparability changed to equivalent',
    expect: 'H7_COMPARABILITY',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.dimensions[0].comparability = 'equivalent';
    },
  },
  {
    name: 'winner or cheaper-replacement wording added',
    expect: 'H7_WINNER_LANGUAGE',
    mutate(pricing) {
      pricing.research_comparisons.h7_deleteme.dimensions[0]
        .bounded_conclusion += ' OSL is better. OSL is a replacement for DeleteMe.';
    },
  },
  {
    name: 'manifest and comparison versions unsupported',
    expect: 'H7_VERSION',
    mutate(pricing) {
      pricing.manifest_version = 0;
      pricing.research_comparisons.h7_deleteme.comparison_version = 2;
    },
  },
];

function appendH7ClaimField(pricingFixture, dimensionId, field, sentence) {
  const dimension = pricingFixture.research_comparisons.h7_deleteme.dimensions
    .find((entry) => entry.id === dimensionId);
  if (field === 'fact') dimension.deleteme_facts[0].paraphrase += ` ${sentence}`;
  else if (field === 'qualifier') dimension.deleteme_facts[0].qualifiers += ` ${sentence}`;
  else if (field === 'unknown') dimension.unknowns[0].reason += ` ${sentence}`;
  else if (field === 'limitation') dimension.osl_limitation += ` ${sentence}`;
  else if (field === 'conclusion') dimension.bounded_conclusion += ` ${sentence}`;
}

const H7_ADVERSARIAL_MUTATIONS = [];
for (const count of ['50+', '85+', '850+']) {
  for (const field of ['fact', 'qualifier', 'unknown', 'limitation', 'conclusion']) {
    H7_ADVERSARIAL_MUTATIONS.push({
      name: `H7_SCOPE_${count.replace('+', '_PLUS')}_${field.toUpperCase()}`,
      expect: 'H7_SCOPE_SEMANTICS',
      mutate(pricingFixture) {
        appendH7ClaimField(pricingFixture, 'scope', field, `DeleteMe covers ${count} sites.`);
      },
    });
  }
}
for (const field of ['unknown', 'limitation', 'conclusion']) {
  H7_ADVERSARIAL_MUTATIONS.push({
    name: `H7_SCOPE_976_${field.toUpperCase()}`,
    expect: 'H7_SCOPE_SEMANTICS',
    mutate(pricingFixture) {
      appendH7ClaimField(pricingFixture, 'scope', field, 'DeleteMe covers 976 sites.');
    },
  });
}
for (const term of ['constantly', 'always']) {
  for (const field of ['fact', 'qualifier', 'unknown', 'limitation', 'conclusion']) {
    H7_ADVERSARIAL_MUTATIONS.push({
      name: `H7_MONITOR_${term.toUpperCase()}_${field.toUpperCase()}`,
      expect: 'H7_MONITORING_CLAIM',
      mutate(pricingFixture) {
        appendH7ClaimField(pricingFixture, 'ongoing_monitoring', field, `DeleteMe ${term} monitors every broker.`);
      },
    });
  }
}

const pricing = JSON.parse(await readFile(PRICING_PATH, 'utf8'));
const atRestCensusRaw = await readFile(AT_REST_CENSUS_PATH, 'utf8');
const atRestCensus = JSON.parse(atRestCensusRaw);
const publicSurfaceManifest = JSON.parse(await readFile(PUBLIC_SURFACE_MANIFEST_PATH, 'utf8'));
const discoveredPublicSurface = await discoverPublicSurface();
const config = buildConfig(pricing);
if (!Number.isInteger(config.intendedGrantDays) || config.intendedGrantDays <= 0) {
  console.error('check-claims floor: tiers.pro.intended_grant_days must be a positive integer so the semantic grant-duration prohibition cannot become vacuous.');
  process.exit(1);
}
const h7ValidationErrors = validateH7Comparison(pricing, AS_OF);
const atRestValidationErrors = validateAtRestCensus(atRestCensus, atRestCensusRaw);
const publicSurfaceValidationErrors = validatePublicSurfaceManifest(
  publicSurfaceManifest,
  discoveredPublicSurface,
);

if (SELF_TEST) {
  let failures = 0;
  console.log('check-claims self-test (authoritative at-rest census):');
  const atRestAssertions = [
    {
      name: 'valid at-rest census passes the full validator',
      pass: atRestValidationErrors.length === 0,
      detail: atRestValidationErrors.join('; '),
    },
    {
      name: 'exactly eighteen required storage backends',
      pass: atRestCensus.backends?.length === 18
        && atRestCensus.required_backend_ids?.length === 18,
    },
    {
      name: 'exactly nine bound public claims',
      pass: atRestCensus.public_claims?.length === 9,
    },
    {
      name: 'runtime and release verification explicitly refused',
      pass: atRestCensus.product_source?.runtime_release_verified === false,
    },
    {
      name: 'plaintext, encrypted, and ephemeral classes are all represented',
      pass: atRestCensus.backends?.some((backend) => backend.plaintext_possible_at_rest === true)
        && atRestCensus.backends?.some((backend) => backend.at_rest_form.includes('ciphertext')
          || backend.at_rest_form.includes('sealed'))
        && atRestCensus.backends?.some((backend) => backend.retention === 'ephemeral'),
    },
    {
      name: 'implemented-unwired backends are present but not claimable',
      pass: atRestCensus.backends
        ?.filter((backend) => backend.reachability === 'implemented-unwired')
        .every((backend) => backend.public_claimability === 'not-claimable'),
    },
  ];
  for (const assertion of atRestAssertions) {
    if (!assertion.pass) failures += 1;
    console.log(`  ${assertion.pass ? 'passed ' : 'FAILED '} ${assertion.name}${assertion.detail ? ` -> ${assertion.detail}` : ''}`);
  }

  const atRestCensusMutations = [
    {
      name: 'required plaintext backend removed',
      expect: 'AT_REST_BACKEND_CENSUS',
      mutate(census) {
        census.backends = census.backends.filter((backend) => backend.id !== 'renderer-local-storage');
      },
    },
    {
      name: 'required backend id silently removed',
      expect: 'AT_REST_BACKEND_CENSUS',
      mutate(census) {
        census.required_backend_ids = census.required_backend_ids.filter((id) => id !== 'membership-json');
      },
    },
    {
      name: 'plaintext backend relabelled encrypted',
      expect: 'AT_REST_BACKEND_TRUTH',
      mutate(census) {
        census.backends.find((backend) => backend.id === 'peer-map-json').plaintext_possible_at_rest = false;
      },
    },
    {
      name: 'active identity marker silently omitted',
      expect: 'AT_REST_BACKEND_CENSUS',
      mutate(census) {
        census.backends = census.backends
          .filter((backend) => backend.id !== 'active-identity-marker');
      },
    },
    {
      name: 'provider profile storage relabelled encrypted',
      expect: 'AT_REST_BACKEND_TRUTH',
      mutate(census) {
        census.backends.find((backend) => backend.id === 'provider-profile-storage')
          .plaintext_possible_at_rest = false;
      },
    },
    {
      name: 'startup trace reachability downgraded to QA-only',
      expect: 'AT_REST_BACKEND_TRUTH',
      mutate(census) {
        census.backends.find((backend) => backend.id === 'startup-trace-log')
          .reachability = 'qa-only-source-path';
      },
    },
    {
      name: 'provider profile source anchor removed',
      expect: 'AT_REST_BACKEND_SOURCE',
      mutate(census) {
        census.backends.find((backend) => backend.id === 'provider-profile-storage')
          .sources.pop();
      },
    },
    {
      name: 'implemented-unwired Notes backend promoted',
      expect: 'AT_REST_BACKEND_TRUTH',
      mutate(census) {
        census.backends.find((backend) => backend.id === 'notes-json-backend').reachability = 'production-source-path';
      },
    },
    {
      name: 'public claim cites implemented-unwired Notes backend',
      expect: 'AT_REST_UNWIRED_CLAIM',
      mutate(census) {
        census.public_claims.find((claim) => claim.id === 'status-at-rest-boundary')
          .backend_refs.push('notes-json-backend');
      },
    },
    {
      name: 'public claim cites Planned-only attachment backend',
      expect: 'AT_REST_UNWIRED_CLAIM',
      mutate(census) {
        census.public_claims.find((claim) => claim.id === 'faq-uninstall-storage-boundary')
          .backend_refs.push('protected-attachment-open');
      },
    },
    {
      name: 'unsupported runtime verification asserted',
      expect: 'AT_REST_PROVENANCE',
      mutate(census) {
        census.product_source.runtime_release_verified = true;
      },
    },
    {
      name: 'reviewed product commit silently changed',
      expect: 'AT_REST_PROVENANCE',
      mutate(census) {
        census.product_source.commit = '0000000000000000000000000000000000000000';
      },
    },
    {
      name: 'required FAQ claim removed',
      expect: 'AT_REST_CLAIM_CENSUS',
      mutate(census) {
        census.public_claims = census.public_claims
          .filter((claim) => claim.id !== 'faq-password-recovery-boundary');
      },
    },
    {
      name: 'FAQ evidence tier promoted to runtime',
      expect: 'AT_REST_CLAIM_SHAPE',
      mutate(census) {
        census.public_claims.find((claim) => claim.id === 'faq-password-recovery-boundary')
          .status_tier = 'runtime-verified';
      },
    },
    {
      name: 'BACKEND_SOURCE_SYMBOL_DRIFT',
      expect: 'AT_REST_CANONICAL_CONTRACT',
      mutate(census) {
        census.backends.find((backend) => backend.id === 'startup-trace-log')
          .sources[0].symbol = 'symbol_that_does_not_exist';
      },
    },
    {
      name: 'BACKEND_SOURCE_PROOF_DRIFT',
      expect: 'AT_REST_CANONICAL_CONTRACT',
      mutate(census) {
        census.backends.find((backend) => backend.id === 'startup-trace-log')
          .sources[0].proof = 'synchronized mutable proof';
      },
    },
    {
      name: 'DUPLICATE_JSON_KEY_SHADOW',
      expect: 'AT_REST_RAW_CONTRACT',
      mutate() {},
      rawMutate(raw) {
        return raw.replace(
          '"schema_version": 1,',
          '"schema_version": 1, "schema_version": 1,',
        );
      },
    },
    {
      name: 'BACKEND_MECHANISM_DRIFT',
      expect: 'AT_REST_CANONICAL_CONTRACT',
      mutate(census) {
        const identity = census.backends
          .find((backend) => backend.id === 'identity-private-key-file');
        identity.at_rest_form = 'encrypted with the main password';
        identity.key_absent_behavior = 'plaintext fallback';
      },
    },
    {
      name: 'SYNCED_BACKEND_REF_OMISSION',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        const claim = census.public_claims
          .find((entry) => entry.id === 'status-at-rest-boundary');
        claim.text = claim.text.replace('startup trace', 'startup log');
        claim.backend_refs = claim.backend_refs
          .filter((backend) => backend !== 'startup-trace-log');
      },
    },
    {
      name: 'AT_REST_CONTRADICTION_UNIVERSAL_THEN_PLAINTEXT',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' All local data is encrypted at rest. Some local settings can be plaintext.';
      },
    },
    {
      name: 'AT_REST_CONTRADICTION_PLAINTEXT_THEN_UNIVERSAL',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' Some local settings can be plaintext. All local data is encrypted at rest.';
      },
    },
    {
      name: 'AT_REST_SAME_SENTENCE_UNIVERSAL_PLAINTEXT',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' All local data is encrypted at rest, but some local settings can remain plaintext.';
      },
    },
    {
      name: 'AT_REST_FALSE_IDENTITY_PASSWORD_WITH_SEPARATE_CLAUSE',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' Private identity keys are encrypted with your main password, while the file-storage key is separate.';
      },
    },
    {
      name: 'AT_REST_EVEN_THOUGH_UNIVERSAL_PLAINTEXT',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' All local data is encrypted at rest, even though some local settings can remain plaintext.';
      },
    },
    {
      name: 'AT_REST_AND_UNIVERSAL_PLAINTEXT',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' All local data is encrypted at rest, and some local settings can remain plaintext.';
      },
    },
    {
      name: 'AT_REST_FALSE_IDENTITY_PASSWORD_WITH_UNRELATED_NEGATION',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' Private identity keys are encrypted with your main password, and this does not protect every backup.';
      },
    },
    {
      name: 'AT_REST_FALSE_IDENTITY_PASSWORD_WITH_UNRELATED_SUBJECT_NEGATION',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += " Private identity keys are encrypted with your main password, and backups aren't protected.";
      },
    },
    {
      name: 'AT_REST_FALSE_IDENTITY_PASSWORD_WITH_UNRELATED_RATHER_THAN',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' Private identity keys are encrypted with your main password rather than the backup password.';
      },
    },
    {
      name: 'AT_REST_FALSE_IDENTITY_PASSWORD_DERIVED_KEY_PHRASING',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' Private identity keys are encrypted using a key derived from your main password.';
      },
    },
    {
      name: 'AT_REST_FALSE_IDENTITY_PASSWORD_NOUN_PHRASING',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' Encryption of private identity keys uses your main password.';
      },
    },
    {
      name: 'AT_REST_UNREACHABLE_NOTES_CLAIM',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' The Notes backend encrypts its file before writing.';
      },
    },
    {
      name: 'AT_REST_UNREACHABLE_LAN_CLAIM',
      expect: 'AT_REST_CLAIM_SEMANTICS',
      mutate(census) {
        census.public_claims[0].text += ' The LAN backend encrypts its records before writing.';
      },
    },
  ];
  const atRestCensusMutationRuns = new Map();
  for (const mutation of atRestCensusMutations) {
    const mutated = structuredClone(atRestCensus);
    mutation.mutate(mutated);
    atRestCensusMutationRuns.set(
      mutation.name,
      (atRestCensusMutationRuns.get(mutation.name) ?? 0) + 1,
    );
    const mutatedRaw = mutation.rawMutate?.(atRestCensusRaw);
    const mutationErrors = validateAtRestCensus(mutated, mutatedRaw);
    const caught = mutationErrors.some((error) => error.startsWith(`${mutation.expect}:`));
    if (!caught) failures += 1;
    console.log(`  ${caught ? 'caught ' : 'MISSED '} ${mutation.name} (expected ${mutation.expect})`);
  }
  const everyAtRestCensusMutationRanOnce = atRestCensusMutationRuns.size === atRestCensusMutations.length
    && [...atRestCensusMutationRuns.values()].every((runs) => runs === 1);
  if (!everyAtRestCensusMutationRanOnce) failures += 1;
  console.log(`  ${everyAtRestCensusMutationRanOnce ? 'passed ' : 'FAILED '} each at-rest census mutation executed exactly once`);

  console.log('\ncheck-claims self-test (recursive public surface):');
  const publicSurfaceBaselineClean = publicSurfaceValidationErrors.length === 0;
  if (!publicSurfaceBaselineClean) failures += 1;
  console.log(`  ${publicSurfaceBaselineClean ? 'passed ' : 'FAILED '} exact recursive public-surface manifest`);
  const publicSurfaceMutations = [
    {
      name: 'PUBLIC_ROOT_NESTED_BROAD_CLAIM',
      caught() {
        const discovered = structuredClone(discoveredPublicSurface);
        discovered.html.push('docs/nested/claim.html');
        discovered.html.sort();
        return validatePublicSurfaceManifest(publicSurfaceManifest, discovered)
          .some((error) => error.startsWith('PUBLIC_SURFACE_CENSUS:'));
      },
    },
    {
      name: 'PUBLIC_ROOT_NESTED_CLEAN_UNDECLARED',
      caught() {
        const discovered = structuredClone(discoveredPublicSurface);
        discovered.html.push('docs/nested/clean.html');
        discovered.html.sort();
        return validatePublicSurfaceManifest(publicSurfaceManifest, discovered)
          .some((error) => error.startsWith('PUBLIC_SURFACE_CENSUS:'));
      },
    },
    {
      name: 'PUBLIC_CHANNEL_META_TAG_ATTRIBUTE',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<meta name="description" data-audit="All local data is encrypted at rest.">',
        ).length > 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_ACCESSIBLE_NAME',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<main aria-label="All local data is encrypted at rest."></main>',
        ).length > 0;
      },
    },
    {
      name: 'PUBLIC_ASSET_JSON_CLAIM',
      caught() {
        return publicAtRestChannelErrors(
          'assets/claims.json',
          '{"claim":"All local data is encrypted at rest."}',
          'textual-asset',
        ).length > 0;
      },
    },
    {
      name: 'PUBLIC_MANIFEST_HTML_STAGE_REMOVAL',
      caught() {
        const manifest = structuredClone(publicSurfaceManifest);
        manifest.html.pop();
        return validatePublicSurfaceManifest(manifest, discoveredPublicSurface)
          .some((error) => error.startsWith('PUBLIC_SURFACE_CENSUS:'));
      },
    },
    {
      name: 'PUBLIC_MANIFEST_ASSET_STAGE_REMOVAL',
      caught() {
        const manifest = structuredClone(publicSurfaceManifest);
        manifest.assets.pop();
        return validatePublicSurfaceManifest(manifest, discoveredPublicSurface)
          .some((error) => error.startsWith('PUBLIC_SURFACE_CENSUS:'));
      },
    },
    {
      name: 'PUBLIC_ROOT_BROAD_CLAIM_POSITIVE',
      caught() {
        return publicAtRestChannelErrors(
          'claim-control.html',
          '<main><p>All local data is encrypted at rest.</p></main>',
        ).length > 0;
      },
    },
  ];
  const publicClaim = 'All local data is encrypted at rest.';
  const channelControls = [
    ['PUBLIC_CHANNEL_DOCUMENT_TITLE', 'index.html', `<title>${publicClaim}</title>`, '<title></title>', 'html'],
    ['PUBLIC_CHANNEL_RENDERED_TEXT', 'index.html', `<main><p>${publicClaim}</p></main>`, '<main><p></p></main>', 'html'],
    ['PUBLIC_CHANNEL_METADATA_CONTENT', 'index.html', `<meta name="description" content="${publicClaim}">`, '<meta name="description" content="">', 'html'],
    ['PUBLIC_CHANNEL_ARIA_DESCRIPTION', 'index.html', `<main aria-description="${publicClaim}"></main>`, '<main aria-description=""></main>', 'html'],
    ['PUBLIC_CHANNEL_ALT', 'index.html', `<img alt="${publicClaim}">`, '<img alt="">', 'html'],
    ['PUBLIC_CHANNEL_TITLE_ATTRIBUTE', 'index.html', `<div title="${publicClaim}"></div>`, '<div title=""></div>', 'html'],
    ['PUBLIC_CHANNEL_PLACEHOLDER', 'index.html', `<input placeholder="${publicClaim}">`, '<input placeholder="">', 'html'],
    ['PUBLIC_CHANNEL_VALUE', 'index.html', `<input value="${publicClaim}">`, '<input value="">', 'html'],
    ['PUBLIC_CHANNEL_DATA_ATTRIBUTE', 'index.html', `<div data-copy="${publicClaim}"></div>`, '<div data-copy=""></div>', 'html'],
    ['PUBLIC_CHANNEL_JSON_LD', 'index.html', `<script type="application/ld+json">{"description":"${publicClaim}"}</script>`, '<script type="application/ld+json">{}</script>', 'html'],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_COPY',
      'index.html',
      '<script>document.body.insertAdjacentText("beforeend", "All local data is " + "password-protected.");</script>',
      '<script>document.body.insertAdjacentText("beforeend", "Account settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_CONCAT_COPY',
      'index.html',
      '<script>document.body.insertAdjacentText("beforeend", "All local data is ".concat("password-protected."));</script>',
      '<script>document.body.insertAdjacentText("beforeend", "Account ".concat("settings."));</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_IDENTIFIER_COPY',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.insertAdjacentText("beforeend", a + b);</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.insertAdjacentText("beforeend", a + b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_MULTI_ARGUMENT_COPY',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.append(a, b);</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.append(a, b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_MULTI_DECLARATOR_COPY',
      'index.html',
      '<script>const a = "All local data is ", b = "password-protected."; document.body.textContent = a + b;</script>',
      '<script>const a = "Account ", b = "settings."; document.body.textContent = a + b;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_STATIC_RUN_BEFORE_DYNAMIC_NODE',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; const marker = document.createElement("span"); document.body.append(a, b, marker);</script>',
      '<script>const a = "Account "; const b = "settings."; const marker = document.createElement("span"); document.body.append(a, b, marker);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_MULTILINE_DECLARATORS',
      'index.html',
      '<script>const a = "All local data is ",\n b = "password-protected."; document.body.textContent = a + b;</script>',
      '<script>const a = "Account ",\n b = "settings."; document.body.textContent = a + b;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_COMMENTED_DECLARATORS',
      'index.html',
      '<script>const a = "All local data is ", /* second */ b = "password-protected."; document.body.textContent = a + b;</script>',
      '<script>const a = "Account ", /* second */ b = "settings."; document.body.textContent = a + b;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_TEMPLATE_INTERPOLATION',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.textContent = `${a}${b}`;</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.textContent = `${a}${b}`;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_ARRAY_JOIN',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.textContent = [a, b].join("");</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.textContent = [a, b].join("");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_BRACKETED_TEXT_PROPERTY',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body["textContent"] = a + b;</script>',
      '<script>const a = "Account "; const b = "settings."; document.body["textContent"] = a + b;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_SPREAD_ARGUMENTS',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.append(...[a, b]);</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.append(...[a, b]);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_INSERT_ADJACENT_HTML',
      'index.html',
      '<script>const a = "<p>All local data is "; const b = "password-protected.</p>"; document.body.insertAdjacentHTML("beforeend", a + b);</script>',
      '<script>const a = "<p>Account "; const b = "settings.</p>"; document.body.insertAdjacentHTML("beforeend", a + b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_TEXT_NODE',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.appendChild(document.createTextNode(a + b));</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.appendChild(document.createTextNode(a + b));</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_INNER_HTML',
      'index.html',
      '<script>const a = "<p>All local data is "; const b = "password-protected.</p>"; document.body.innerHTML = a + b;</script>',
      '<script>const a = "<p>Account "; const b = "settings.</p>"; document.body.innerHTML = a + b;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_COMPUTED_SINK',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body["append"](a, b);</script>',
      '<script>const a = "Account "; const b = "settings."; document.body["append"](a, b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_OPTIONAL_SINK',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.append?.(a, b);</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.append?.(a, b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_EMPTY_TEXT_NODE',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.append(a, document.createTextNode(""), b);</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.append(a, document.createTextNode(""), b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_EMPTY_ELEMENT',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; const empty = document.createElement("span"); document.body.append(a, empty, b);</script>',
      '<script>const a = "Account "; const b = "settings."; const empty = document.createElement("span"); document.body.append(a, empty, b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_SEQUENTIAL_SINKS',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.append(a); document.body.append(b);</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.append(a); document.body.append(b);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_THREE_SEQUENTIAL_SINKS',
      'index.html',
      '<script>const a = "All local "; const b = "data is "; const c = "password-protected."; document.body.append(a); document.body.append(b); document.body.append(c);</script>',
      '<script>const a = "Account "; const b = "sett"; const c = "ings."; document.body.append(a); document.body.append(b); document.body.append(c);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_NINE_SEQUENTIAL_SINKS',
      'index.html',
      '<script>document.body.append("All "); document.body.append("lo"); document.body.append("cal "); document.body.append("da"); document.body.append("ta "); document.body.append("is "); document.body.append("pass"); document.body.append("word-"); document.body.append("protected.");</script>',
      '<script>document.body.append("A"); document.body.append("cc"); document.body.append("ou"); document.body.append("nt "); document.body.append("se"); document.body.append("tt"); document.body.append("in"); document.body.append("g"); document.body.append("s.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_PREPEND_RUNTIME_ORDER',
      'index.html',
      '<script>document.body.prepend("password-protected."); document.body.prepend("data is "); document.body.prepend("All local ");</script>',
      '<script>document.body.prepend("settings."); document.body.prepend("Account ");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_AFTERBEGIN_RUNTIME_ORDER',
      'index.html',
      '<script>document.body.insertAdjacentText("afterbegin", "password-protected."); document.body.insertAdjacentText("afterbegin", "data is "); document.body.insertAdjacentText("afterbegin", "All local ");</script>',
      '<script>document.body.insertAdjacentText("afterbegin", "settings."); document.body.insertAdjacentText("afterbegin", "Account ");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_MIXED_APPEND_PREPEND_ORDER',
      'index.html',
      '<script>document.body.append("password-protected."); document.body.prepend("All local data is ");</script>',
      '<script>document.body.append("settings."); document.body.prepend("Account ");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_MIXED_ADJACENT_ORDER',
      'index.html',
      '<script>document.body.insertAdjacentText("beforeend", "password-protected."); document.body.insertAdjacentText("afterbegin", "All local data is ");</script>',
      '<script>document.body.insertAdjacentText("beforeend", "settings."); document.body.insertAdjacentText("afterbegin", "Account ");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_ASI_DECLARATIONS',
      'index.html',
      '<script>const a = "All local "\nconst b = "data is "\nconst c = "password-protected."\ndocument.body.append(a)\ndocument.body.append(b)\ndocument.body.append(c)</script>',
      '<script>const a = "Account "\nconst b = "settings."\ndocument.body.append(a)\ndocument.body.append(b)</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_BOUND_COMPUTED_SINK',
      'index.html',
      '<script>const sink = "append"; document.body[sink]("All local data is ", "password-protected.");</script>',
      '<script>const sink = "append"; document.body[sink]("Account ", "settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_TEMPLATE_COMPUTED_SINK',
      'index.html',
      '<script>const sink = `append`; document.body[sink]("All local data is ", "password-protected.");</script>',
      '<script>const sink = `append`; document.body[sink]("Account ", "settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_COMMENTED_TEMPLATE_INTERPOLATION',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.textContent = `${a /* scope */}${b /* mechanism */}`;</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.textContent = `${a /* noun */}${b /* noun */}`;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_ALIAS_RECEIVER',
      'index.html',
      '<script>const body = document.body; body.append("password-protected."); document.body.prepend("All local data is ");</script>',
      '<script>const body = document.body; body.append("settings."); document.body.prepend("Account ");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_BRACKET_RECEIVER',
      'index.html',
      '<script>document.body.append("password-protected."); document["body"].prepend("All local data is ");</script>',
      '<script>document.body.append("settings."); document["body"].prepend("Account ");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_OPTIONAL_RECEIVER',
      'index.html',
      '<script>document?.body.append("password-protected."); document.body.prepend("All local data is ");</script>',
      '<script>document?.body.append("settings."); document.body.prepend("Account ");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_SELECTOR_RECEIVER',
      'index.html',
      '<script>document.querySelector("body").append("All local data is "); document.querySelector("body").append("password-protected.");</script>',
      '<script>document.querySelector("body").append("Account "); document.querySelector("body").append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_TWO_ALIASES',
      'index.html',
      '<script>const first = document.body; const second = first; second.append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>const first = document.body; const second = first; second.append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_PARENTHESIZED_RECEIVER',
      'index.html',
      '<script>(document.body).append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>(document.body).append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_PARENTHESIZED_ALIAS',
      'index.html',
      '<script>const body = document.body; (body).append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>const body = document.body; (body).append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_OPTIONAL_COMPUTED_RECEIVER',
      'index.html',
      '<script>document?.["body"].append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>document?.["body"].append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_WINDOW_RECEIVER',
      'index.html',
      '<script>window.document.body.append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>window.document.body.append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_GLOBAL_THIS_RECEIVER',
      'index.html',
      '<script>globalThis.document.body.append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>globalThis.document.body.append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_NESTED_SELECTOR_RECEIVER',
      'index.html',
      '<script>document.querySelector("main").querySelector(".copy").append("All local data is "); document.querySelector("main").querySelector(".copy").append("password-protected.");</script>',
      '<script>document.querySelector("main").querySelector(".copy").append("Account "); document.querySelector("main").querySelector(".copy").append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_DESTRUCTURED_BODY_ALIAS',
      'index.html',
      '<script>const { body } = document; body.append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>const { body } = document; body.append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_STATIC_COMPUTED_RECEIVER',
      'index.html',
      '<script>const property = "body"; document[property].append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>const property = "body"; document[property].append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_BOUND_SELECTOR_RECEIVER',
      'index.html',
      '<script>const selector = "body"; document.querySelector(selector).append("All local data is "); document.body.append("password-protected.");</script>',
      '<script>const selector = "body"; document.querySelector(selector).append("Account "); document.body.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_ASI_COMMA_DECLARATIONS',
      'index.html',
      '<script>const a = "All local ", b = "data is "\nconst c = "password-protected."\ndocument.body.append(a)\ndocument.body.append(b)\ndocument.body.append(c)</script>',
      '<script>const a = "Account ", b = "settings."\ndocument.body.append(a)\ndocument.body.append(b)</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_SEQUENTIAL_APPEND_CHILD_TEXT',
      'index.html',
      '<script>const a = "All local data is ", b = "password-protected."; document.body.appendChild(document.createTextNode(a)); document.body.appendChild(document.createTextNode(b));</script>',
      '<script>const a = "Account ", b = "settings."; document.body.appendChild(document.createTextNode(a)); document.body.appendChild(document.createTextNode(b));</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_ATTACHED_NODE_AFTER_WRITES',
      'index.html',
      '<script>const output = document.createElement("div"); output.append("All local data is "); output.append("password-protected."); document.body.append(output);</script>',
      '<script>const output = document.createElement("div"); output.append("Account "); output.append("settings."); document.body.append(output);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_CREATED_NODE_ALIAS_ATTACHMENT',
      'index.html',
      '<script>const output = document.createElement("div"); const alias = output; output.append("All local data is "); output.append("password-protected."); document.body.append(alias);</script>',
      '<script>const output = document.createElement("div"); const alias = output; output.append("Account "); output.append("settings."); document.body.append(alias);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_ATTACHED_NODE_BEFORE_WRITES',
      'index.html',
      '<script>const output = document.createElement("div"); document.body.append(output); output.append("All local data is "); output.append("password-protected.");</script>',
      '<script>const output = document.createElement("div"); document.body.append(output); output.append("Account "); output.append("settings.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_ATTACHED_FRAGMENT',
      'index.html',
      '<script>const output = document.createDocumentFragment(); output.append("All local data is "); output.append("password-protected."); document.body.append(output);</script>',
      '<script>const output = document.createDocumentFragment(); output.append("Account "); output.append("settings."); document.body.append(output);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_OUTER_ALIAS_AFTER_SHADOW',
      'index.html',
      '<script>{ const output = document.body; output.append("All local data is "); { const output = document.createElement("div"); output.append("Account settings."); } output.append("password-protected."); }</script>',
      '<script>{ const output = document.body; output.append("Account "); { const output = document.createElement("div"); output.append("Unrelated."); } output.append("settings."); }</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_SIBLING_PUBLIC_ALIASES',
      'index.html',
      '<script>{ const output = document.body; output.append("All local data is "); } { const output = document.body; output.append("password-protected."); }</script>',
      '<script>{ const output = document.body; output.append("Account "); } { const output = document.body; output.append("settings."); }</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_NESTED_PUBLIC_ALIASES',
      'index.html',
      '<script>{ const output = document.body; output.append("All local data is "); { const output = document.body; output.append("password-protected."); } }</script>',
      '<script>{ const output = document.body; output.append("Account "); { const output = document.body; output.append("settings."); } }</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_CLEARED_SEPARATOR',
      'index.html',
      '<script>const separator = document.createElement("span"); separator.textContent = "not "; separator.textContent = ""; document.body.append("All local data is ", separator, "password-protected.");</script>',
      '<script>const separator = document.createElement("span"); separator.textContent = "not "; document.body.append("All local data is ", separator, "password-protected.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_REPLACE_CHILDREN_CLEARED_SEPARATOR',
      'index.html',
      '<script>const separator = document.createElement("span"); separator.textContent = "not "; separator.replaceChildren(); document.body.append("All local data is ", separator, "password-protected.");</script>',
      '<script>const separator = document.createElement("span"); separator.textContent = "not "; document.body.append("All local data is ", separator, "password-protected.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_COMPUTED_CLEARED_SEPARATOR',
      'index.html',
      '<script>const property = "textContent", separator = document.createElement("span"); separator.textContent = "not "; separator[property] = ""; document.body.append("All local data is ", separator, "password-protected.");</script>',
      '<script>const property = "textContent", separator = document.createElement("span"); separator[property] = "not "; document.body.append("All local data is ", separator, "password-protected.");</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_INSERT_BEFORE_REACHABILITY',
      'index.html',
      '<script>const output = document.createElement("div"); output.append("All local data is "); output.append("password-protected."); document.body.insertBefore(output, document.body.firstChild);</script>',
      '<script>const output = document.createElement("div"); output.append("Account "); output.append("settings."); document.body.insertBefore(output, document.body.firstChild);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_REPLACE_CHILD_REACHABILITY',
      'index.html',
      '<script>const output = document.createElement("div"); output.append("All local data is "); output.append("password-protected."); document.body.replaceChild(output, document.body.firstChild);</script>',
      '<script>const output = document.createElement("div"); output.append("Account "); output.append("settings."); document.body.replaceChild(output, document.body.firstChild);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_INSERT_ADJACENT_ELEMENT_REACHABILITY',
      'index.html',
      '<script>const output = document.createElement("div"); output.append("All local data is "); output.append("password-protected."); document.body.insertAdjacentElement("beforeend", output);</script>',
      '<script>const output = document.createElement("div"); output.append("Account "); output.append("settings."); document.body.insertAdjacentElement("beforeend", output);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_STORED_TEXT_NODES',
      'index.html',
      '<script>const a = "All local data is ", b = "password-protected."; const first = document.createTextNode(a), second = document.createTextNode(b); document.body.appendChild(first); document.body.appendChild(second);</script>',
      '<script>const a = "Account ", b = "settings."; const first = document.createTextNode(a), second = document.createTextNode(b); document.body.appendChild(first); document.body.appendChild(second);</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_VARIABLE_TEXT_PROPERTY',
      'index.html',
      '<script>const property = "textContent", a = "All local data is ", b = "password-protected."; document.body[property] = a + b;</script>',
      '<script>const property = "textContent", a = "Account ", b = "settings."; document.body[property] = a + b;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_TEMPLATE_TEXT_PROPERTY',
      'index.html',
      '<script>const a = "All local data is ", b = "password-protected."; document.body[`textContent`] = a + b;</script>',
      '<script>const a = "Account ", b = "settings."; document.body[`textContent`] = a + b;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_NESTED_TEMPLATE_INTERPOLATION',
      'index.html',
      '<script>const a = "All local data is ", b = "password-protected."; document.body.textContent = `${`${a}${b}`}`;</script>',
      '<script>const a = "Account ", b = "settings."; document.body.textContent = `${`${a}${b}`}`;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_COMMENT_BRACE_INTERPOLATION',
      'index.html',
      '<script>const a = "All local data is ", b = "password-protected."; document.body.textContent = `${a /* } scope */}${b}`;</script>',
      '<script>const a = "Account ", b = "settings."; document.body.textContent = `${a /* } noun */}${b}`;</script>',
      'html',
    ],
    [
      'PUBLIC_CHANNEL_GENERATED_SCRIPT_TEXT_PROPERTY_APPEND',
      'index.html',
      '<script>const a = "All local data is "; const b = "password-protected."; document.body.textContent = a; document.body.textContent += b;</script>',
      '<script>const a = "Account "; const b = "settings."; document.body.textContent = a; document.body.textContent += b;</script>',
      'html',
    ],
    ['PUBLIC_CHANNEL_NOSCRIPT', 'index.html', `<noscript><p>${publicClaim}</p></noscript>`, '<noscript><p></p></noscript>', 'html'],
    [
      'PUBLIC_ASSET_CSS_COMPOSITION',
      'assets/claim.css',
      '.claim::after { content: "All local data is " "password-protected."; }',
      '.claim::after { content: "Account settings."; }',
      'textual-asset',
    ],
    [
      'PUBLIC_ASSET_CSS_VARIABLE_COMPOSITION',
      'assets/claim.css',
      ':root { --scope: "All local data is "; --protection: "password-protected."; } .claim::after { content: var(--scope) var(--protection); }',
      ':root { --scope: "Account "; --protection: "settings."; } .claim::after { content: var(--scope) var(--protection); }',
      'textual-asset',
    ],
    [
      'PUBLIC_ASSET_JS_COMPOSITION',
      'assets/claim.js',
      'document.body.insertAdjacentText("beforeend", "All local data is " + "password-protected.");',
      'document.body.insertAdjacentText("beforeend", "Account settings.");',
      'textual-asset',
    ],
    ['PUBLIC_ASSET_JSON_STAGE', 'assets/claim.json', `{"claim":"${publicClaim}"}`, '{"claim":""}', 'textual-asset'],
    [
      'PUBLIC_ASSET_SVG_COMPOSITION',
      'assets/claim.svg',
      '<svg><text><tspan>All local data is </tspan><tspan>password-protected.</tspan></text></svg>',
      '<svg><text><tspan>Account settings.</tspan></text></svg>',
      'textual-asset',
    ],
    [
      'PUBLIC_ASSET_SVG_SIBLING_COMPOSITION',
      'assets/claim.svg',
      '<svg><text>All local data is </text><text>password-protected.</text></svg>',
      '<svg><text>Account </text><text>settings.</text></svg>',
      'textual-asset',
    ],
    ['PUBLIC_ASSET_TXT_STAGE', 'assets/claim.txt', publicClaim, 'Account settings.', 'textual-asset'],
    ['PUBLIC_ASSET_WEBMANIFEST_STAGE', 'assets/claim.webmanifest', `{"description":"${publicClaim}"}`, '{"description":""}', 'textual-asset'],
    ['PUBLIC_ASSET_XML_STAGE', 'assets/claim.xml', `<copy>${publicClaim}</copy>`, '<copy>Account settings.</copy>', 'textual-asset'],
    ['AT_REST_STARTUP_LOG_ALIAS', 'index.html', '<p>Every startup log is encrypted at rest.</p>', '<p>Startup diagnostics are source-inspected only.</p>', 'html'],
    ['AT_REST_RECEIPT_LEDGER_ALIAS', 'index.html', '<p>The QA receipt ledger is encrypted at rest.</p>', '<p>The QA receipt ledger is QA-only and not claimable.</p>', 'html'],
    ['AT_REST_DIAGNOSTIC_LOG_ALIAS', 'index.html', '<p>The diagnostic log is encrypted before writing.</p>', '<p>The diagnostic log is QA-only and excluded.</p>', 'html'],
  ];
  for (const [name, file, fixture, removed, kind] of channelControls) {
    publicSurfaceMutations.push({
      name,
      caught() {
        const positive = publicAtRestChannelErrors(file, fixture, kind);
        const removal = publicAtRestChannelErrors(file, removed, kind);
        return positive.length > 0 && removal.length === 0;
      },
    });
  }
  publicSurfaceMutations.push(
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_TEXT_REPLACEMENT_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>document.body.textContent = "All local "; document.body.textContent = "data is "; document.body.textContent = "password-protected.";</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_HTML_REPLACEMENT_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>document.body.innerHTML = "All local "; document.body.innerHTML = "data is "; document.body.innerHTML = "password-protected.";</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_REPLACE_CHILDREN_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>document.body.replaceChildren("All local "); document.body.replaceChildren("data is "); document.body.replaceChildren("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_CLEARING_RESET_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>document.body.append("All local data is "); document.body.textContent = ""; document.body.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_DISTINCT_TARGETS_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const x = document.createElement("div"), y = document.createElement("div"), z = document.createElement("div"); x.append("All local "); y.append("data is "); z.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_DISTINCT_REVERSE_TARGETS_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const x = document.createElement("div"), y = document.createElement("div"), z = document.createElement("div"); x.prepend("password-protected."); y.prepend("data is "); z.prepend("All local ");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_ALIAS_RESET_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const body = document.body; document.body.append("All local data is "); body.textContent = ""; document.body.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_BRACKET_RESET_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>document.body.append("All local data is "); document["body"].textContent = ""; document.body.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_DETACHED_TARGET_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const detached = document.createElement("div"); detached.append("All local data is "); detached.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_SHADOWED_ALIAS_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>{ const output = document.body; output.append("All local data is "); } { const output = document.createElement("div"); output.append("password-protected."); }</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_POPULATED_SEPARATOR_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const separator = document.createElement("span"); separator.textContent = "Account settings."; document.body.append("All local data is ", separator, "password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_NEGATING_CHILD_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const qualifier = document.createElement("span"); qualifier.textContent = "not "; document.body.append("All local data is ", qualifier, "password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_SELECTOR_QUOTE_RESET_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>document.querySelector(".copy").append("All local data is "); document.querySelector(\'.copy\').textContent = ""; document.querySelector(`.copy`).append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_BODY_SELECTOR_RESET_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>document.body.append("All local data is "); document.querySelector("body").textContent = ""; document.body.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_REMOVED_NODE_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const output = document.createElement("div"); document.body.append(output); output.remove(); output.append("All local data is "); output.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_REMOVE_CHILD_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const output = document.createElement("div"); document.body.append(output); document.body.removeChild(output); output.append("All local data is "); output.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_ALIAS_REMOVE_CHILD_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const output = document.createElement("div"); const alias = output; document.body.append(output); document.body.removeChild(alias); output.append("All local data is "); output.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_PARENT_REPLACE_CHILDREN_DETACH_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const output = document.createElement("div"); document.body.append(output); document.body.replaceChildren(); output.append("All local data is "); output.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_CLEAR_THEN_REPOPULATE_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const separator = document.createElement("span"); separator.textContent = "not "; separator.textContent = ""; separator.textContent = "still not "; document.body.append("All local data is ", separator, "password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_DIRECT_CLEAR_COMPUTED_REPOPULATE_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const property = "textContent", separator = document.createElement("span"); separator.textContent = "not "; separator.textContent = ""; separator[property] = "still not "; document.body.append("All local data is ", separator, "password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_COMPUTED_CLEAR_DIRECT_REPOPULATE_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const property = "textContent", separator = document.createElement("span"); separator.textContent = "not "; separator[property] = ""; separator.textContent = "still not "; document.body.append("All local data is ", separator, "password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_REPLACE_WITH_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const output = document.createElement("div"); document.body.append(output); output.replaceWith(document.createElement("span")); output.append("All local data is "); output.append("password-protected.");</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_LITERAL_BLOCK_COMMENT_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const a = "All local data is ", b = "password-protected."; document.body.textContent = `${a}/* Account settings */${b}`;</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_LITERAL_LINE_COMMENT_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const a = "All local data is ", b = "password-protected."; document.body.textContent = `${a}// Account settings\\n${b}`;</script>',
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_GENERATED_SCRIPT_INTERPOLATED_BLOCK_COMMENT_STRING_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          '<script>const a = "All local data is ", b = "password-protected."; document.body.textContent = `${a}${"/* Account settings */"}${b}`;</script>',
        ).length === 0;
      },
    },
  );
  publicSurfaceMutations.push(
    {
      name: 'PUBLIC_CHANNEL_INERT_SCRIPT_DISTINCTION',
      caught() {
        const inert = publicAtRestChannelErrors(
          'index.html',
          `<script type="application/json">{"claim":"${publicClaim}"}</script>`,
        );
        const executable = publicAtRestChannelErrors(
          'index.html',
          `<script type="module">document.body.append("${publicClaim}")</script>`,
        );
        return inert.length === 0 && executable.length > 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_UNQUOTED_INERT_SCRIPT_DISTINCTION',
      caught() {
        const inert = publicAtRestChannelErrors(
          'index.html',
          `<script type=application/json>{"claim":"${publicClaim}"}</script>`,
        );
        const executable = publicAtRestChannelErrors(
          'index.html',
          `<script type=module>document.body.append("${publicClaim}")</script>`,
        );
        return inert.length === 0 && executable.length > 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_TEMPLATE_DISTINCTION',
      caught() {
        return publicAtRestChannelErrors(
          'index.html',
          `<template><p>${publicClaim}</p></template>`,
        ).length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_DECLARATIVE_SHADOW_TEMPLATE',
      caught() {
        const positive = publicAtRestChannelErrors(
          'index.html',
          `<template shadowrootmode="open"><p>${publicClaim}</p></template>`,
        );
        const removal = publicAtRestChannelErrors(
          'index.html',
          '<template shadowrootmode="open"><p>Account settings.</p></template>',
        );
        return positive.length > 0 && removal.length === 0;
      },
    },
    {
      name: 'PUBLIC_CHANNEL_UNQUOTED_DECLARATIVE_SHADOW_TEMPLATE',
      caught() {
        const positive = publicAtRestChannelErrors(
          'index.html',
          `<template shadowrootmode=open><p>${publicClaim}</p></template>`,
        );
        const removal = publicAtRestChannelErrors(
          'index.html',
          '<template shadowrootmode=open><p>Account settings.</p></template>',
        );
        return positive.length > 0 && removal.length === 0;
      },
    },
  );
  const publicSurfaceRuns = new Map();
  for (const mutation of publicSurfaceMutations) {
    publicSurfaceRuns.set(mutation.name, (publicSurfaceRuns.get(mutation.name) ?? 0) + 1);
    const caught = mutation.caught();
    if (!caught) failures += 1;
    console.log(`  ${caught ? 'caught ' : 'MISSED '} ${mutation.name}`);
  }
  const everyPublicSurfaceMutationRanOnce = publicSurfaceRuns.size === publicSurfaceMutations.length
    && [...publicSurfaceRuns.values()].every((runs) => runs === 1);
  if (!everyPublicSurfaceMutationRanOnce) failures += 1;
  console.log(`  ${everyPublicSurfaceMutationRanOnce ? 'passed ' : 'FAILED '} every recursive public-surface mutation executed exactly once`);

  console.log(`check-claims self-test (H7 DeleteMe manifest, as of ${AS_OF}):`);
  const comparison = pricing.research_comparisons?.h7_deleteme;
  const h7Assertions = [
    {
      name: 'valid fixture passes the full H7 validator',
      pass: h7ValidationErrors.length === 0,
      detail: h7ValidationErrors.join('; '),
    },
    {
      name: 'exactly seven comparison dimensions',
      pass: comparison?.dimensions?.length === 7,
    },
    {
      name: 'at least eight official sources',
      pass: comparison?.sources?.length >= 8,
    },
    {
      name: 'seven nonempty OSL limitations',
      pass: comparison?.dimensions?.filter((dimension) => dimension.osl_limitation?.trim()).length === 7,
    },
    {
      name: 'at least one explicit unknown',
      pass: comparison?.dimensions?.some((dimension) => dimension.unknowns?.length > 0),
    },
    {
      name: 'at least one source conflict',
      pass: comparison?.dimensions?.some((dimension) => dimension.status === 'conflicted'
        && dimension.conflict_explanation?.trim()),
    },
    {
      name: 'exactly 20 named H7 mutations',
      pass: H7_SELF_TEST_MUTATIONS.length === 20,
    },
  ];
  for (const assertion of h7Assertions) {
    if (!assertion.pass) failures += 1;
    console.log(`  ${assertion.pass ? 'passed ' : 'FAILED '} ${assertion.name}${assertion.detail ? ` -> ${assertion.detail}` : ''}`);
  }

  const mutationRuns = new Map();
  for (const mutation of H7_SELF_TEST_MUTATIONS) {
    const mutated = structuredClone(pricing);
    mutation.mutate(mutated);
    mutationRuns.set(mutation.name, (mutationRuns.get(mutation.name) ?? 0) + 1);
    const mutationErrors = validateH7Comparison(mutated, AS_OF);
    const caught = mutationErrors.some((error) => error.startsWith(`${mutation.expect}:`));
    if (!caught) failures += 1;
    console.log(`  ${caught ? 'caught ' : 'MISSED '} ${mutation.name} (expected ${mutation.expect})`);
  }
  const allMutationsRanExactlyOnce = mutationRuns.size === H7_SELF_TEST_MUTATIONS.length
    && [...mutationRuns.values()].every((runs) => runs === 1);
  if (!allMutationsRanExactlyOnce) failures += 1;
  console.log(`  ${allMutationsRanExactlyOnce ? 'passed ' : 'FAILED '} each named H7 mutation executed exactly once`);

  console.log('\ncheck-claims self-test (H7 adversarial field mutations):');
  const h7AdversarialRuns = new Map();
  for (const mutation of H7_ADVERSARIAL_MUTATIONS) {
    const mutated = structuredClone(pricing);
    mutation.mutate(mutated);
    h7AdversarialRuns.set(mutation.name, (h7AdversarialRuns.get(mutation.name) ?? 0) + 1);
    const mutationErrors = validateH7Comparison(mutated, AS_OF);
    const caught = mutationErrors.some((error) => error.startsWith(`${mutation.expect}:`));
    if (!caught) failures += 1;
    console.log(`  ${caught ? 'caught ' : 'MISSED '} ${mutation.name} (expected ${mutation.expect})`);
  }
  const everyH7AdversarialMutationRanOnce = H7_ADVERSARIAL_MUTATIONS.length === 28
    && h7AdversarialRuns.size === H7_ADVERSARIAL_MUTATIONS.length
    && [...h7AdversarialRuns.values()].every((runs) => runs === 1);
  if (!everyH7AdversarialMutationRanOnce) failures += 1;
  console.log(`  ${everyH7AdversarialMutationRanOnce ? 'passed ' : 'FAILED '} all 28 H7 adversarial field mutations executed exactly once`);

  console.log('\ncheck-claims self-test (each HTML fixture must be caught):');
  for (const testCase of SELF_TEST_CASES) {
    const errors = analyseFile(testCase.file, testCase.html, config);
    const caught = errors.some((error) => error.kind === testCase.expect);
    if (!caught) failures += 1;
    console.log(`  ${caught ? 'caught ' : 'MISSED '} ${testCase.name} (expected ${testCase.expect})`);
  }
  console.log('\ncheck-claims self-test (honest copy must not be flagged):');
  for (const testCase of NEGATION_CASES) {
    const kinds = new Set(testCase.kinds);
    const errors = analyseFile(testCase.file, testCase.html, config).filter((error) => kinds.has(error.kind));
    const clean = errors.length === 0;
    if (!clean) failures += 1;
    console.log(`  ${clean ? 'passed ' : 'FLAGGED'} ${testCase.name}${clean ? '' : ` -> ${errors.map((e) => e.kind).join(', ')}`}`);
  }

  console.log('\ncheck-claims self-test (production H4 contract and exact mutation):');
  const h4Content = await readFile(path.join(ROOT, 'features.html'), 'utf8');
  const baselineH4Errors = analyseFile('features.html', h4Content, config)
    .filter((error) => error.kind === 'h4 explainer contract');
  const baselineClean = baselineH4Errors.length === 0;
  if (!baselineClean) failures += 1;
  console.log(`  ${baselineClean ? 'passed ' : 'FAILED '} production PWS/Burn explainer baseline`);

  const requiredLimitation = 'It is not cryptographic erasure.';
  const limitationOccurrences = h4Content.split(requiredLimitation).length - 1;
  const mutatedH4 = h4Content.replace(requiredLimitation, '');
  const limitationMutationCaught = limitationOccurrences === 1
    && analyseFile('features.html', mutatedH4, config)
      .some((error) => error.kind === 'h4 explainer contract'
        && error.text.includes('not-cryptographic-erasure limitation'));
  if (!limitationMutationCaught) failures += 1;
  console.log(`  ${limitationMutationCaught ? 'caught ' : 'MISSED '} exact removal of "${requiredLimitation}"`);

  console.log('\ncheck-claims self-test (production at-rest boundaries and exact mutations):');
  const productionAtRestCases = [
    {
      claimId: 'audit-local-storage-boundary',
      replacement: 'All private state is encrypted at rest.',
    },
    {
      claimId: 'faq-password-recovery-boundary',
      replacement: 'The entire on-disk database is encrypted at rest.',
    },
  ];
  for (const testCase of productionAtRestCases) {
    const claim = atRestCensus.public_claims.find(({ id }) => id === testCase.claimId);
    const productionContent = await readFile(path.join(ROOT, claim.file), 'utf8');
    const occurrences = productionContent.split(claim.text).length - 1;
    const baselineErrors = [
      ...analyseFile(claim.file, productionContent, config),
      ...atRestClaimBindingErrors(claim.file, productionContent, atRestCensus),
    ].filter((error) => error.kind.includes('at-rest'));
    const baselineClean = baselineErrors.length === 0;
    const mutatedContent = productionContent.replace(claim.text, testCase.replacement);
    const mutationCaught = occurrences === 1
      && [
        ...analyseFile(claim.file, mutatedContent, config),
        ...atRestClaimBindingErrors(claim.file, mutatedContent, atRestCensus),
      ].some((error) => error.kind === 'at-rest claim drift');
    if (!baselineClean || !mutationCaught) failures += 1;
    console.log(`  ${baselineClean ? 'passed ' : 'FAILED '} ${claim.file} production baseline`);
    console.log(`  ${mutationCaught ? 'caught ' : 'MISSED '} ${claim.file} exact broad-claim mutation`);
  }

  console.log('\ncheck-claims self-test (production census bindings and semantic mutations):');
  const atRestProductionFiles = [...new Set(atRestCensus.public_claims.map((claim) => claim.file))];
  const atRestProductionContent = new Map();
  let atRestProductionBaselineClean = true;
  for (const file of atRestProductionFiles) {
    const content = await readFile(path.join(ROOT, file), 'utf8');
    atRestProductionContent.set(file, content);
    const bindingErrors = atRestClaimBindingErrors(file, content, atRestCensus);
    if (bindingErrors.length > 0) atRestProductionBaselineClean = false;
  }
  if (!atRestProductionBaselineClean) failures += 1;
  console.log(`  ${atRestProductionBaselineClean ? 'passed ' : 'FAILED '} all nine production claim bindings`);

  const statusClaim = atRestCensus.public_claims
    .find((claim) => claim.id === 'status-at-rest-boundary');
  const statusElement = `<p data-osl-at-rest-claim="${statusClaim.id}" data-osl-at-rest-backends="${statusClaim.backend_refs.join(' ')}">${statusClaim.text}</p>`;
  const faqClaim = atRestCensus.public_claims
    .find((claim) => claim.id === 'faq-password-recovery-boundary');
  const atRestPageMutations = [
    {
      name: 'contradictory addition inside bound FAQ copy',
      file: faqClaim.file,
      expect: 'at-rest claim drift',
      mutate(content) {
        return content.replace(
          faqClaim.text,
          `${faqClaim.text} All local data is encrypted at rest.`,
        );
      },
    },
    {
      name: 'contradictory broad paragraph added beside bound FAQ copy',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace('</main>', '<p>All private state is encrypted at rest.</p></main>');
      },
    },
    {
      name: 'unrelated not-yet sentence cannot excuse broad claim',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p>All local data is encrypted at rest. Multi-device synchronization is not yet complete.</p></main>',
        );
      },
    },
    {
      name: 'destructive wording cannot excuse broad claim',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p>You can delete all local data, which is encrypted at rest.</p></main>',
        );
      },
    },
    {
      name: 'anything alias cannot escape census binding',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p>Anything OSL keeps on this machine is password-protected.</p></main>',
        );
      },
    },
    {
      name: 'full-set alias cannot escape census binding',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p>The full set of local records is encrypted with your password.</p></main>',
        );
      },
    },
    {
      name: 'byte and datum aliases cannot escape census binding',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p>Every byte and datum OSL retains on-device is encrypted.</p></main>',
        );
      },
    },
    {
      name: 'split inline markup cannot escape census binding',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p>Each <em>one</em> of the local records is password&#45;protected.</p></main>',
        );
      },
    },
    {
      name: 'false identity-password mechanism cannot escape census binding',
      file: faqClaim.file,
      expect: 'unbound at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p>Private identity keys are encrypted at rest with your password.</p></main>',
        );
      },
    },
    {
      name: 'bound backend reference removed',
      file: statusClaim.file,
      expect: 'at-rest backend drift',
      mutate(content) {
        return content.replace(
          statusClaim.backend_refs.join(' '),
          statusClaim.backend_refs.filter((id) => id !== 'renderer-local-storage').join(' '),
        );
      },
    },
    {
      name: 'bound claim duplicated',
      file: statusClaim.file,
      expect: 'missing or duplicate at-rest claim',
      mutate(content) {
        return content.replace(statusElement, `${statusElement}${statusElement}`);
      },
    },
    {
      name: 'truthful claim moved into unreachable template',
      file: statusClaim.file,
      expect: 'unreachable at-rest claim',
      mutate(content) {
        return content.replace(statusElement, `<template>${statusElement}</template>`);
      },
    },
    {
      name: 'truthful claim moved into unreachable script string',
      file: statusClaim.file,
      expect: 'unreachable at-rest claim',
      mutate(content) {
        return content.replace(
          statusElement,
          `<script type="application/json">${statusElement}</script>`,
        );
      },
    },
    {
      name: 'truthful implemented-unwired Notes sentence added publicly',
      file: statusClaim.file,
      expect: 'unknown at-rest claim',
      mutate(content) {
        return content.replace(
          '</main>',
          '<p data-osl-at-rest-claim="notes-source-truth" data-osl-at-rest-backends="notes-json-backend">The Notes backend encrypts its file before writing.</p></main>',
        );
      },
    },
    {
      name: 'bound visible text removed while marker survives',
      file: statusClaim.file,
      expect: 'at-rest claim drift',
      mutate(content) {
        return content.replace(statusClaim.text, '');
      },
    },
    {
      name: 'HTML-encoded contradiction inside bound copy',
      file: faqClaim.file,
      expect: 'at-rest claim drift',
      mutate(content) {
        return content.replace(
          faqClaim.text,
          `${faqClaim.text} Every local record is password&#45;protected.`,
        );
      },
    },
  ];
  const atRestPageMutationRuns = new Map();
  for (const mutation of atRestPageMutations) {
    const baseline = atRestProductionContent.get(mutation.file);
    const mutated = mutation.mutate(baseline);
    atRestPageMutationRuns.set(
      mutation.name,
      (atRestPageMutationRuns.get(mutation.name) ?? 0) + 1,
    );
    const mutationErrors = atRestClaimBindingErrors(
      mutation.file,
      mutated,
      atRestCensus,
    );
    const caught = mutated !== baseline
      && mutationErrors.some((error) => error.kind === mutation.expect);
    if (!caught) failures += 1;
    console.log(`  ${caught ? 'caught ' : 'MISSED '} ${mutation.name} (expected ${mutation.expect})`);
  }
  const everyAtRestPageMutationRanOnce = atRestPageMutationRuns.size === atRestPageMutations.length
    && [...atRestPageMutationRuns.values()].every((runs) => runs === 1);
  if (!everyAtRestPageMutationRanOnce) failures += 1;
  console.log(`  ${everyAtRestPageMutationRanOnce ? 'passed ' : 'FAILED '} each at-rest page mutation executed exactly once`);

  const total = atRestAssertions.length
    + atRestCensusMutations.length
    + 1
    + 1
    + publicSurfaceMutations.length
    + 1
    + h7Assertions.length
    + H7_SELF_TEST_MUTATIONS.length
    + 1
    + H7_ADVERSARIAL_MUTATIONS.length
    + 1
    + SELF_TEST_CASES.length
    + NEGATION_CASES.length
    + 2
    + (productionAtRestCases.length * 2)
    + 1
    + atRestPageMutations.length
    + 1;
  console.log(`\ncheck-claims self-test: ${total} fixtures, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

const files = htmlFiles(publicSurfaceManifest);
const fileSummaries = [];
const errors = h7ValidationErrors.map((text) => ({
  kind: 'H7 research comparison',
  file: 'data/pricing.json',
  line: 0,
  text,
}));
errors.push(...atRestValidationErrors.map((text) => ({
  kind: 'at-rest census',
  file: 'data/at-rest-census.json',
  line: 0,
  text,
})));
errors.push(...publicSurfaceValidationErrors.map((text) => ({
  kind: 'public surface census',
  file: 'data/public-surface-manifest.json',
  line: 0,
  text,
})));
const crawledFiles = new Set(files.map((file) => rel(file)));

for (const file of files) {
  const fileRel = rel(file);
  const content = await readFile(file, 'utf8');
  const fileErrors = analyseFile(fileRel, content, config);
  fileErrors.push(...atRestClaimBindingErrors(fileRel, content, atRestCensus));
  fileErrors.push(...publicAtRestChannelErrors(fileRel, content));
  errors.push(...fileErrors);

  const count = (...kinds) => fileErrors.filter((error) => kinds.includes(error.kind)).length;
  fileSummaries.push({
    file: fileRel,
    barePrices: count('bare price'),
    forbiddenHits: count(
      'forbidden billing',
      'forbidden claim',
      'false capability claim',
      'unimplemented grant-duration claim',
      'at-rest overclaim',
      'unbound at-rest claim',
      'at-rest claim drift',
      'at-rest backend drift',
      'unreachable at-rest claim',
    ),
    badgeIssues: count('capability badge', 'label drift', 'matrix gap'),
    surfaceIssues: count('present-tense capability claim', 'missing matrix link', 'unsellable at checkout'),
    missingText: count('missing required sentence', 'h4 explainer contract'),
    verdict: fileErrors.length === 0 ? 'pass' : 'fail',
  });
}

for (const assetRel of publicSurfaceManifest.assets) {
  const extension = path.extname(assetRel).toLowerCase();
  if (!publicSurfaceManifest.textual_asset_extensions.includes(extension)) continue;
  const content = await readFile(path.join(ROOT, assetRel), 'utf8');
  errors.push(...publicAtRestChannelErrors(assetRel, content, 'textual-asset'));
}

// A requirement aimed at a file the crawler never opens would silently pass.
for (const requirement of config.requiredPhrases) {
  if (crawledFiles.has(requirement.file)) continue;
  errors.push({
    kind: 'unreachable requirement',
    file: requirement.file,
    line: 0,
    text: 'the manifest requires something of a file the crawler never scans',
  });
}
for (const matrixFile of config.surfacePolicy.matrix_files || []) {
  if (crawledFiles.has(matrixFile)) continue;
  errors.push({
    kind: 'unreachable requirement',
    file: matrixFile,
    line: 0,
    text: 'the support matrix file does not exist; run `node scripts/build-status.mjs`',
  });
}

if (errors.length > 0) {
  console.error('Claim check failures:');
  for (const error of errors) {
    console.error(`${error.file}:${error.line}: [${error.kind}] ${error.text}`);
  }
}

console.log('\nSummary:');
console.log('| file | bare prices | forbidden hits | bad badges | surface | missing text | verdict |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
for (const summary of fileSummaries) {
  console.log(
    `| ${summary.file} | ${summary.barePrices} | ${summary.forbiddenHits} | ${summary.badgeIssues} | ${summary.surfaceIssues} | ${summary.missingText} | ${summary.verdict} |`,
  );
}

const failedFiles = fileSummaries.filter((summary) => summary.verdict === 'fail').length;
console.log(`\ncheck-claims: scanned ${files.length} files, ${failedFiles} failed.`);

let floorFailed = false;
if (files.length < MIN_CLAIM_HTML_FILES) {
  console.error(`check-claims floor: expected at least ${MIN_CLAIM_HTML_FILES} html files scanned, actually scanned ${files.length}.`);
  floorFailed = true;
}
if (config.registryById.size < MIN_CAPABILITY_REGISTRY_ENTRIES) {
  console.error(`check-claims floor: expected at least ${MIN_CAPABILITY_REGISTRY_ENTRIES} capability registry entries, actually found ${config.registryById.size}.`);
  floorFailed = true;
}
if (config.requiredPhrases.length < MIN_REQUIRED_PHRASES) {
  console.error(`check-claims floor: expected at least ${MIN_REQUIRED_PHRASES} required_phrases entries, actually found ${config.requiredPhrases.length}.`);
  floorFailed = true;
}

if (failedFiles > 0 || errors.length > 0 || floorFailed) {
  process.exit(1);
}
