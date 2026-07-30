import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPTS_DIR);
const CSS_PATH = path.join(REPO_ROOT, 'assets', 'css', 'style.css');
const PACKET = process.env.OSL_OWNER_SCREENSHOT_PACKET;
const ACCEPT_COMMAND = 'test -n "$OSL_OWNER_SCREENSHOT_PACKET" && test -d "$OSL_OWNER_SCREENSHOT_PACKET"';

const REQUIRED_MAPPINGS = [
  {
    id: 'owner-320-status-badge-wrap',
    tokens: [
      'route=/features',
      'width=320',
      'condition=js-on',
      'request=status-badge-stays-on-demo-heading-row',
      'rule=.eyebrow .osl-status',
    ],
    selector: '.eyebrow .osl-status',
    declarations: [
      ['margin-left', /^var\(--s-2\)$/],
      ['letter-spacing', /^0\.08em$/],
    ],
  },
  {
    id: 'owner-390-price-rate-wrap',
    tokens: [
      'route=/download',
      'width=390',
      'condition=js-on',
      'request=price-rate-stays-on-one-line',
      'rule=.price-rate',
    ],
    selector: '.price-rate',
    declarations: [
      ['white-space', /^nowrap$/],
    ],
  },
  {
    id: 'owner-320-status-matrix-scroll',
    tokens: [
      'route=/docs/status',
      'width=320',
      'condition=js-off',
      'request=support-matrix-scrolls-without-page-clipping',
      'rule=.status-table-scroll',
    ],
    selector: '.status-table-scroll',
    declarations: [
      ['overflow-x', /^auto$/],
    ],
  },
  {
    id: 'owner-768-donate-scene-overflow',
    tokens: [
      'route=/donate',
      'width=768',
      'condition=reduced',
      'request=decorative-donate-scene-does-not-force-sideways-page-scroll',
      'rule=.mission-scene',
    ],
    selector: '.mission-scene',
    declarations: [
      ['width', /^100%$/],
      ['overflow-x', /^clip$/],
    ],
  },
];

function fail(message) {
  console.error(`test-owner-screenshot-responsive-rules: ${message}`);
  process.exit(1);
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declarationBlocksBefore(cssText, selector, beforeIndex) {
  const blockPattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'g');
  return [...cssText.matchAll(blockPattern)]
    .filter((match) => match.index < beforeIndex)
    .map((match) => match[1]);
}

function blockHasDeclaration(block, property, valuePattern) {
  return block
    .split(';')
    .map((declaration) => declaration.trim())
    .some((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon === -1) return false;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      return name === property && valuePattern.test(value);
    });
}

if (!PACKET) {
  fail('OSL_OWNER_SCREENSHOT_PACKET is required');
}

const packetPath = path.resolve(PACKET);
if (!existsSync(packetPath) || !statSync(packetPath).isDirectory()) {
  fail(`OSL_OWNER_SCREENSHOT_PACKET must name an existing directory: ${packetPath}`);
}

const packetScreenshots = walkFiles(packetPath)
  .filter((file) => /\.(?:png|jpe?g|webp)$/i.test(file));
if (packetScreenshots.length < REQUIRED_MAPPINGS.length) {
  fail(`owner packet must contain at least ${REQUIRED_MAPPINGS.length} screenshot image files`);
}

const css = readFileSync(CSS_PATH, 'utf8');
const blockMatch = css.match(/\/\* owner-screenshot-responsive-rules:start([\s\S]*?)owner-screenshot-responsive-rules:end \*\//);
if (!blockMatch) {
  fail('missing owner-screenshot-responsive-rules CSS block');
}
if (!blockMatch[1].includes('OSL_OWNER_SCREENSHOT_PACKET')) {
  fail(`owner mapping block must name the h13 accept packet: ${ACCEPT_COMMAND}`);
}

const mappingLines = blockMatch[1]
  .split(/\r?\n/)
  .map((line) => line.replace(/^\s*\*\s?/, '').trim())
  .filter((line) => line.startsWith('owner-map '));

if (mappingLines.length !== REQUIRED_MAPPINGS.length) {
  fail(`expected ${REQUIRED_MAPPINGS.length} owner-map lines, found ${mappingLines.length}`);
}

for (const mapping of REQUIRED_MAPPINGS) {
  const line = mappingLines.find((candidate) => candidate.includes(`id=${mapping.id}`));
  if (!line) {
    fail(`missing owner-map id=${mapping.id}`);
  }
  for (const token of mapping.tokens) {
    if (!line.includes(token)) {
      fail(`owner-map id=${mapping.id} is missing ${token}`);
    }
  }
  const blockStart = blockMatch.index;
  const selectorBlocks = declarationBlocksBefore(css, mapping.selector, blockStart);
  if (selectorBlocks.length === 0) {
    fail(`mapped selector ${mapping.selector} must exist before the owner mapping block`);
  }
  for (const [property, valuePattern] of mapping.declarations) {
    if (!selectorBlocks.some((block) => blockHasDeclaration(block, property, valuePattern))) {
      fail(`mapped selector ${mapping.selector} must set ${property} for ${mapping.id}`);
    }
  }
}

console.log(`test-owner-screenshot-responsive-rules: mapped ${mappingLines.length} corrections to ${packetScreenshots.length} packet screenshots`);
