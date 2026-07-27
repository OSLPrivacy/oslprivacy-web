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
// Floor proves the crawler glob found the expected site surface.
const MIN_CLAIM_HTML_FILES = 12;
// Floor prevents an empty registry from making badge checks vacuous.
const MIN_CAPABILITY_REGISTRY_ENTRIES = 1;
// Floor prevents required sentence checks from disappearing silently.
const MIN_REQUIRED_PHRASES = 1;

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
  const limitations = /\b(?:(?:does\s+not|doesn't)\s+(?:cover|protect|encrypt|secure|mean|imply)(?:\s+that)?\s+(?:all|each|every)|not\s+(?:all|each|every|everything|the\s+(?:entire|whole|complete))|not\s+(?:fully\s+)?(?:encrypted|protected|sealed|secured)|not\s+(?:a\s+)?(?:claim|promise|evidence)\s+that\s+(?:all|each|every)|(?:says?|proves?)\s+nothing\s+about\s+local|(?:may|can)\s+remain\s+plaintext|plaintext\s+(?:fallback|writes?)|without\s+(?:an?\s+)?(?:installed\s+)?(?:main[-\s]+password\s+)?storage\s+key|remov(?:e|es|ed|ing)\b.{0,80}\b(?:restores?|causes?)\s+plaintext\s+writes?|only\s+(?:the\s+)?(?:private\s+)?identity\s+keys?|not\s+(?:yet|complete\s+yet)|nothing\b.{0,100}\bcalls?\s+it)\b/i;
  const errors = [];

  // Block boundaries keep an honest limitation attached to the claim it
  // qualifies without letting an unrelated limitation elsewhere on the page
  // excuse a broad promise. Inline markup and entities are already flattened
  // by renderedTextWithSourceMap, so they cannot split the semantic match.
  for (const segment of rendered.text.matchAll(/[^\n]+/g)) {
    const blockText = shortText(segment[0]);
    if (!blockText || limitations.test(blockText)) continue;
    const sentences = [...segment[0].matchAll(/[^.!?;\n]+[.!?;]?/g)]
      .map((sentence) => ({
        start: (segment.index ?? 0) + (sentence.index ?? 0),
        text: shortText(sentence[0]),
      }))
      .filter((sentence) => sentence.text);
    // Scope is established inside one sentence. Its protection assertion may
    // appear elsewhere in the same rendered block, so arbitrary sentence
    // splitting cannot evade the check. Narrow identity-key and message-body
    // claims remain permissible unless the block also asserts a broad category.
    const scope = sentences.find(({ text }) => !destructiveScope.test(text) && (unqualifiedBroadCategory.test(text)
      || (universalScope.test(text) && stateObject.test(text))
      || (absoluteUniversal.test(text) && protectionAssertion.test(text))));
    if (!scope || !protectionAssertion.test(blockText)) continue;
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
  errors.push(...atRestOverclaimErrors(fileRel, content));

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
    html: '<p>Private identity keys are encrypted at rest with your password.</p>',
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
    html: '<p>Private identity keys are encrypted at rest with your password, but password protection does not cover every local record.</p>',
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

const pricing = JSON.parse(await readFile(PRICING_PATH, 'utf8'));
const config = buildConfig(pricing);
if (!Number.isInteger(config.intendedGrantDays) || config.intendedGrantDays <= 0) {
  console.error('check-claims floor: tiers.pro.intended_grant_days must be a positive integer so the semantic grant-duration prohibition cannot become vacuous.');
  process.exit(1);
}

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
      file: 'audit.html',
      needle: 'That protection does not cover every local record: some private conversation metadata, including peer map and membership records, may remain plaintext when no main password storage key is installed; removing that storage key restores plaintext writes.',
      replacement: 'All private state is encrypted at rest.',
    },
    {
      file: 'docs/faq.html',
      needle: 'The password recovery phrase can authorize setting a new main password; it does not mean that every local record is password-protected. Some conversation metadata and preferences may remain plaintext when no storage key is installed, and removing that storage key restores plaintext writes.',
      replacement: 'The entire on-disk database is encrypted at rest.',
    },
  ];
  for (const testCase of productionAtRestCases) {
    const productionContent = await readFile(path.join(ROOT, testCase.file), 'utf8');
    const occurrences = productionContent.split(testCase.needle).length - 1;
    const baselineClean = !analyseFile(testCase.file, productionContent, config)
      .some((error) => error.kind === 'at-rest overclaim');
    const mutationCaught = occurrences === 1
      && analyseFile(
        testCase.file,
        productionContent.replace(testCase.needle, testCase.replacement),
        config,
      ).some((error) => error.kind === 'at-rest overclaim');
    if (!baselineClean || !mutationCaught) failures += 1;
    console.log(`  ${baselineClean ? 'passed ' : 'FAILED '} ${testCase.file} production baseline`);
    console.log(`  ${mutationCaught ? 'caught ' : 'MISSED '} ${testCase.file} exact broad-claim mutation`);
  }

  const total = SELF_TEST_CASES.length + NEGATION_CASES.length + 2 + (productionAtRestCases.length * 2);
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
    forbiddenHits: count('forbidden billing', 'forbidden claim', 'false capability claim', 'unimplemented grant-duration claim', 'at-rest overclaim'),
    badgeIssues: count('capability badge', 'label drift', 'matrix gap'),
    surfaceIssues: count('present-tense capability claim', 'missing matrix link', 'unsellable at checkout'),
    missingText: count('missing required sentence', 'h4 explainer contract'),
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
