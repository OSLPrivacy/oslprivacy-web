import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PRICING_PATH = path.join(ROOT, 'data', 'pricing.json');
const CHECK_MODE = process.argv.includes('--check');
const MARKER_RE = /<!--\s*osl:([A-Za-z0-9_$.-]+)\s*-->([\s\S]*?)<!--\s*\/osl\s*-->/g;
// Floor proves pricing markers were present before the sync/check verdict.
const MIN_OSL_MARKERS_FOUND = 12;

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

function resolveDottedPath(source, dottedPath) {
  if (!resolveDottedPath.contractChecked) {
    resolveDottedPath.contractChecked = true;
    const fixture = {
      tiers: {
        pro: {
          display: '$5',
          amount_cents: 500,
          enabled: false,
          nested: { note: 'not a marker value' },
          empty: '',
          nothing: null,
          $internal_note: 'private manifest metadata',
        },
      },
    };
    const assertions = [
      ['tiers.pro.display', true, '$5'],
      ['tiers.pro.amount_cents', true, '500'],
      ['tiers.pro.enabled', true, 'false'],
      ['tiers.pro.empty', true, ''],
      ['tiers.pro.missing', false, undefined],
      ['tiers.pro.nested', false, undefined],
      ['tiers.pro.nothing', false, undefined],
      ['tiers.pro.$internal_note', false, undefined],
      ['tiers..pro.display', false, undefined],
      ['tiers.pro.__proto__.polluted', false, undefined],
      ['constructor.prototype.polluted', false, undefined],
    ];

    const failures = [];
    for (const [pathUnderTest, expectedOk, expectedValue] of assertions) {
      const actual = resolveDottedPath(fixture, pathUnderTest);
      if (actual.ok !== expectedOk || actual.value !== expectedValue) {
        failures.push(pathUnderTest);
      }
    }
    if (failures.length > 0) {
      throw new Error(`pricing-sync resolver contract failed: ${failures.join(', ')}`);
    }
  }

  let cursor = source;
  for (const part of dottedPath.split('.')) {
    if (
      part.length === 0 ||
      part.startsWith('$') ||
      part === '__proto__' ||
      part === 'prototype' ||
      part === 'constructor' ||
      cursor === null ||
      typeof cursor !== 'object' ||
      !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return { ok: false, value: undefined };
    }
    cursor = cursor[part];
  }
  if (cursor === null || typeof cursor === 'object') {
    return { ok: false, value: undefined };
  }
  return { ok: true, value: String(cursor) };
}

const pricing = JSON.parse(await readFile(PRICING_PATH, 'utf8'));
const files = await htmlFiles();
let markersFound = 0;
let markersRewritten = 0;
const unknownPaths = [];
const drift = [];

for (const file of files) {
  const original = await readFile(file, 'utf8');
  let changed = false;
  const next = original.replace(MARKER_RE, (match, dottedPath, currentText) => {
    markersFound += 1;
    const resolved = resolveDottedPath(pricing, dottedPath);
    if (!resolved.ok) {
      unknownPaths.push(`${rel(file)}: ${dottedPath}`);
      return match;
    }
    if (currentText !== resolved.value) {
      markersRewritten += 1;
      changed = true;
      drift.push(`${rel(file)}: ${dottedPath} (${JSON.stringify(currentText)} -> ${JSON.stringify(resolved.value)})`);
    }
    return `<!--osl:${dottedPath}-->${resolved.value}<!--/osl-->`;
  });

  if (changed && !CHECK_MODE) {
    await writeFile(file, next);
  }
}

console.log(`pricing-sync: scanned ${files.length} files, found ${markersFound} markers, ${CHECK_MODE ? 'would rewrite' : 'rewrote'} ${markersRewritten}, unknown paths ${unknownPaths.length}.`);

if (unknownPaths.length > 0) {
  console.error('Unknown pricing paths:');
  for (const item of unknownPaths) console.error(`  ${item}`);
}

if (CHECK_MODE && drift.length > 0) {
  console.error('Pricing marker drift:');
  for (const item of drift) console.error(`  ${item}`);
}

let floorFailed = false;
if (markersFound < MIN_OSL_MARKERS_FOUND) {
  console.error(`pricing-sync floor: expected at least ${MIN_OSL_MARKERS_FOUND} osl: markers, actually found ${markersFound}.`);
  floorFailed = true;
}

if (unknownPaths.length > 0 || (CHECK_MODE && drift.length > 0) || floorFailed) {
  process.exit(1);
}
