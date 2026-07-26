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
const SELF_TEST = process.argv.includes('--self-test');
const PRICE_RE = /\$\s?\d+(\.\d{2})?/g;
const MARKER_RE = /<!--\s*osl:[A-Za-z0-9_$.-]+\s*-->[\s\S]*?<!--\s*\/osl\s*-->/g;
const PROVEN = new Set(['Available', 'Beta']);

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

function plainText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
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
  } = config;
  const errors = [];
  const spans = markerSpans(content);
  const allowed = new Set(capabilityLabels.map((label) => label.toLowerCase()));

  const isMatrix = (surfacePolicy.matrix_files || []).includes(fileRel);
  const isCheckoutFile = (surfacePolicy.checkout_files || []).includes(fileRel);
  const isMarketingCapabilityPage = (surfacePolicy.marketing_capability_files || []).includes(fileRel);

  // ---- Global rules: these hold on every surface, whatever the framing.
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
      errors.push({
        kind: 'false capability claim',
        file: fileRel,
        line: lineNumber(content, match.index),
        text: `${shortText(match[0])} -- ${entry.reason || 'disproved against source'}`,
      });
    }
  }

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

const pricing = JSON.parse(await readFile(PRICING_PATH, 'utf8'));
const config = buildConfig(pricing);

if (SELF_TEST) {
  let failures = 0;
  console.log('check-claims self-test (each fixture must be caught):');
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
  const total = SELF_TEST_CASES.length + NEGATION_CASES.length;
  console.log(`\ncheck-claims self-test: ${total} fixtures, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

const files = await htmlFiles();
const fileSummaries = [];
const errors = [];
const crawledFiles = new Set(files.map((file) => rel(file)));

for (const file of files) {
  const fileRel = rel(file);
  const content = await readFile(file, 'utf8');
  const fileErrors = analyseFile(fileRel, content, config);
  errors.push(...fileErrors);

  const count = (...kinds) => fileErrors.filter((error) => kinds.includes(error.kind)).length;
  fileSummaries.push({
    file: fileRel,
    barePrices: count('bare price'),
    forbiddenHits: count('forbidden billing', 'forbidden claim', 'false capability claim'),
    badgeIssues: count('capability badge', 'label drift', 'matrix gap'),
    surfaceIssues: count('present-tense capability claim', 'missing matrix link', 'unsellable at checkout'),
    missingText: count('missing required sentence'),
    verdict: fileErrors.length === 0 ? 'pass' : 'fail',
  });
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

if (failedFiles > 0 || errors.length > 0) {
  process.exit(1);
}
