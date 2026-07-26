import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PRICING_PATH = path.join(ROOT, 'data', 'pricing.json');
const SELF_TEST = process.argv.includes('--self-test');
const PRICE_RE = /\$\s?\d+(\.\d{2})?/g;
const MARKER_RE = /<!--\s*osl:[A-Za-z0-9_$.-]+\s*-->[\s\S]*?<!--\s*\/osl\s*-->/g;

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
// subscription" must fail. Only words listed in negation_aware get this
// treatment, and only when a negator precedes them closely.
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

// Every element that carries a feature id, with the status found beside it.
// Attribute order varies by hand-written markup, so both attributes are read
// out of the same tag rather than assumed adjacent.
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

// One place decides whether a file is clean, so the self-test exercises exactly
// the code the real run uses. A harness with a private copy of the rules proves
// nothing about the harness that ships.
function analyseFile(fileRel, content, config) {
  const {
    patterns,
    capabilityLabels,
    crawlerPolicy,
    forbiddenPhrases,
    requiredPhrases,
    requiredLabels,
    registryById,
  } = config;
  const errors = [];
  const spans = markerSpans(content);
  const allowed = new Set(capabilityLabels.map((label) => label.toLowerCase()));

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

  // Capability claims that source evidence disproved. Plain substrings, because
  // these are exact sentences someone wrote, not word families.
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

  // Donation amounts are user-chosen sums, not product prices.
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

  // A badge is validated only when it opts in with the manifest's attributes.
  // Inferring badges from CSS class names flagged the tier name "Pro" and the
  // feature name "Record opened"; an explicit marker cannot false-positive.
  const labelled = labelledElements(content, crawlerPolicy);
  for (const item of labelled) {
    const line = lineNumber(content, item.index);
    if (!item.status) {
      errors.push({ kind: 'capability badge', file: fileRel, line, text: `${item.feature} carries no status` });
      continue;
    }
    if (!allowed.has(item.status.toLowerCase())) {
      errors.push({ kind: 'capability badge', file: fileRel, line, text: `${item.status} is not a permitted label` });
      continue;
    }
    const registered = registryById.get(item.feature);
    if (!registered) {
      errors.push({ kind: 'capability badge', file: fileRel, line, text: `${item.feature} is not in capability_registry` });
      continue;
    }
    // The manifest is the source of truth: a page may not quietly promote a
    // feature by editing its badge.
    if (registered.status !== item.status) {
      errors.push({
        kind: 'label drift',
        file: fileRel,
        line,
        text: `${item.feature} is labelled ${item.status} but the manifest says ${registered.status}`,
      });
    }
  }

  const labelledIds = new Set(labelled.map((item) => item.feature));
  for (const requirement of requiredLabels) {
    if (requirement.file !== fileRel) continue;
    if (labelledIds.has(requirement.feature)) continue;
    const registered = registryById.get(requirement.feature);
    errors.push({
      kind: 'missing label',
      file: fileRel,
      line: 0,
      text: `${requirement.feature} must be labelled ${registered ? registered.status : '(unknown)'} on this page`,
    });
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
    requiredLabels: pricing.required_labels ?? [],
    registryById: new Map(registry.map((entry) => [entry.id, entry])),
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
    name: 'unlabelled capability',
    file: 'features.html',
    html: '<p>The before-send warning pauses your message.</p>',
    expect: 'missing label',
  },
  {
    name: 'the one true crypto sentence deleted',
    file: 'docs/how-it-works.html',
    html: '<p>Direct messages are sealed to the recipient.</p>',
    expect: 'missing required sentence',
  },
];

const NEGATION_CASES = [
  { name: 'honest no-subscription sentence', file: 'docs/terms.html', html: '<p>This is not a subscription: nothing renews automatically.</p>' },
  { name: 'honest no-recurring sentence', file: 'docs/terms.html', html: '<p>The current checkout does not create a recurring subscription.</p>' },
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
  console.log('check-claims self-test (honest copy must not be flagged):');
  for (const testCase of NEGATION_CASES) {
    const errors = analyseFile(testCase.file, testCase.html, config).filter(
      (error) => error.kind === 'forbidden billing' || error.kind === 'forbidden claim',
    );
    const clean = errors.length === 0;
    if (!clean) failures += 1;
    console.log(`  ${clean ? 'passed ' : 'FLAGGED'} ${testCase.name}`);
  }
  console.log(`\ncheck-claims self-test: ${SELF_TEST_CASES.length + NEGATION_CASES.length} fixtures, ${failures} failed.`);
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

  const count = (kind) => fileErrors.filter((error) => error.kind === kind).length;
  fileSummaries.push({
    file: fileRel,
    barePrices: count('bare price'),
    forbiddenHits: count('forbidden billing') + count('forbidden claim') + count('false capability claim'),
    badgeIssues: count('capability badge') + count('label drift') + count('missing label'),
    missingText: count('missing required sentence'),
    verdict: fileErrors.length === 0 ? 'pass' : 'fail',
  });
}

// A requirement aimed at a file the crawler never opens would silently pass.
for (const requirement of [...config.requiredLabels, ...config.requiredPhrases]) {
  if (crawledFiles.has(requirement.file)) continue;
  errors.push({
    kind: 'unreachable requirement',
    file: requirement.file,
    line: 0,
    text: 'the manifest requires something of a file the crawler never scans',
  });
}

if (errors.length > 0) {
  console.error('Claim check failures:');
  for (const error of errors) {
    console.error(`${error.file}:${error.line}: [${error.kind}] ${error.text}`);
  }
}

console.log('\nSummary:');
console.log('| file | bare prices | forbidden hits | bad badges | missing text | verdict |');
console.log('| --- | ---: | ---: | ---: | ---: | --- |');
for (const summary of fileSummaries) {
  console.log(
    `| ${summary.file} | ${summary.barePrices} | ${summary.forbiddenHits} | ${summary.badgeIssues} | ${summary.missingText} | ${summary.verdict} |`,
  );
}

const failedFiles = fileSummaries.filter((summary) => summary.verdict === 'fail').length;
console.log(`\ncheck-claims: scanned ${files.length} files, ${failedFiles} failed.`);

if (failedFiles > 0 || errors.length > 0) {
  process.exit(1);
}
