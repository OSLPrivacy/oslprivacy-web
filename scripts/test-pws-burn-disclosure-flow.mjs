import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [css, html] = await Promise.all([
  readFile('assets/css/style.css', 'utf8'),
  readFile('features.html', 'utf8'),
]);
const pwsCssStart = css.indexOf('.pws-burn-explainer');
assert.notEqual(pwsCssStart, -1, 'PWS/Burn CSS section must exist');

function blockAfter(marker, from = pwsCssStart) {
  const start = css.indexOf(marker, from);
  assert.notEqual(start, -1, `${marker} block must exist`);
  const open = css.indexOf('{', start);
  assert.notEqual(open, -1, `${marker} block must open`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`${marker} block must close`);
}

function declarationMap(block) {
  return Object.fromEntries(
    block
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colon = declaration.indexOf(':');
        assert.notEqual(colon, -1, `declaration must contain a colon: ${declaration}`);
        return [
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).trim(),
        ];
      }),
  );
}

function selectorBlock(selector, from = pwsCssStart) {
  const block = blockAfter(selector, from);
  assert.notEqual(block.trim(), '', `${selector} block must not be empty`);
  return block;
}

function check(name, fn) {
  try {
    fn();
    console.log(`  passed ${name}`);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

check('pws-burn-disclosure-flow', () => {
  const noPreference = blockAfter('@media (prefers-reduced-motion: no-preference)');
  assert.match(
    noPreference,
    /\.pws-burn-flow-signal\s*\{\s*animation:\s*pws-burn-disclosure-flow\b/s,
    'motion users must get the disclosure-flow animation',
  );
  assert.match(css, /@keyframes\s+pws-burn-disclosure-flow\s*\{/);
  assert.match(
    css,
    /translate\(-50%, -50%\) translateY\(-2\.5rem\)[\s\S]*translate\(-50%, -50%\)[\s\S]*translate\(-50%, -50%\) translateY\(2\.5rem\)/,
    'stacked layouts must animate disclosure downward rather than pulse in place',
  );
  const wideNoPreference = blockAfter('@media (min-width: 900px) and (prefers-reduced-motion: no-preference)');
  assert.match(
    wideNoPreference,
    /\.pws-burn-flow-signal\s*\{\s*animation-name:\s*pws-burn-disclosure-flow-wide;\s*\}/,
    'wide layouts must switch to a side-by-side disclosure animation',
  );
  assert.match(
    css,
    /@keyframes\s+pws-burn-disclosure-flow-wide\s*\{[\s\S]*translate\(-50%, -50%\) translateX\(-2\.5rem\)[\s\S]*translate\(-50%, -50%\)[\s\S]*translate\(-50%, -50%\) translateX\(2\.5rem\)/,
    'wide layouts must animate disclosure from PWS toward Burn',
  );
});

check('prefers-reduced-motion', () => {
  const reduced = blockAfter('@media (prefers-reduced-motion: reduce)');
  const reducedStart = css.indexOf('@media (prefers-reduced-motion: reduce)', pwsCssStart);
  const narrowReducedStart = css.indexOf('@media (max-width: 899px) and (prefers-reduced-motion: reduce)', pwsCssStart);
  assert.match(reduced, /\.pws-burn-explainer \*,/);
  assert.match(reduced, /animation:\s*none !important/);
  assert.match(reduced, /transition:\s*none !important/);
  assert.match(
    reduced,
    /\.pws-burn-flow-signal\s*\{[\s\S]*width:\s*min\(3\.25rem, 32vw\)[\s\S]*box-shadow:\s*none/s,
    'reduced motion must keep a static disclosure indicator visible',
  );
  const staticSignal = declarationMap(selectorBlock('.pws-burn-flow-signal', reducedStart));
  assert.equal(staticSignal.width, 'min(3.25rem, 32vw)');
  assert.equal(staticSignal.height, '2px');
  assert.equal(staticSignal.opacity, '.86');
  assert.match(staticSignal.background, /linear-gradient\(90deg/);
  assert.equal(staticSignal.transform, 'translate(-50%, -50%)');
  assert.match(
    reduced,
    /\.pws-burn-flow-signal::after\s*\{\s*opacity:\s*1;\s*\}/,
    'the static indicator must expose direction without relying on animation',
  );
  const narrowReduced = blockAfter('@media (max-width: 899px) and (prefers-reduced-motion: reduce)');
  assert.match(narrowReduced, /\.pws-burn-flow-signal\s*\{[\s\S]*height:\s*1\.9rem/s);
  const mobileStaticSignal = declarationMap(selectorBlock('.pws-burn-flow-signal', narrowReducedStart));
  assert.equal(mobileStaticSignal.width, '2px');
  assert.equal(mobileStaticSignal.height, '1.9rem');
  assert.match(mobileStaticSignal.background, /linear-gradient\(180deg/);
  assert.match(
    narrowReduced,
    /\.pws-burn-flow-signal::after\s*\{[\s\S]*rotate\(135deg\)/s,
    'stacked mobile cards need a down-facing static direction marker',
  );
});

check('pws-burn-limits', () => {
  const listMatch = html.match(/<ul class="pws-burn-limits"[\s\S]*?<\/ul>/);
  assert.ok(listMatch, 'features.html must render the Burn limits list');
  const items = [...listMatch[0].matchAll(/<li><strong>(.*?)<\/strong><span>(.*?)<\/span><\/li>/g)]
    .map((match) => `${match[1]} ${match[2]}`.replace(/\s+/g, ' ').trim());
  assert.equal(items.length, 4, 'Burn must state all four boundaries');
  for (const phrase of [
    'Local deletion',
    'Authenticated cooperative peer request',
    'Host deletion attempt',
    'Unavoidable copies and screenshots',
  ]) {
    assert.ok(items.some((item) => item.includes(phrase)), `${phrase} boundary must be visible`);
  }
  assert.match(css, /\.pws-burn-limits\s*\{[\s\S]*display:\s*grid/s);
  assert.match(
    blockAfter('@media (min-width: 900px)'),
    /\.pws-burn-limits\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);\s*\}/,
    'desktop limits must become a balanced two-column grid',
  );
});

check('pws-burn-responsive-layout', () => {
  const explainer = declarationMap(selectorBlock('.pws-burn-explainer'));
  assert.equal(explainer['box-sizing'], 'border-box');
  assert.equal(explainer.width, 'min(84rem, 100%)');
  assert.equal(explainer['overflow-x'], 'clip');
  assert.match(css, /\.pws-burn-stages\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(
    blockAfter('@media (min-width: 900px)'),
    /\.pws-burn-stages\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, \.92fr\) 5\.5rem minmax\(0, 1\.25fr\)/,
    'wide screens must render before/disclosure/after in one row',
  );
  const stageTitle = declarationMap(selectorBlock('.pws-burn-title-row h3'));
  assert.equal(stageTitle.flex, '1 1 16rem');
  assert.equal(stageTitle['min-width'], '0');
  assert.equal(stageTitle['overflow-wrap'], 'anywhere');
  const narrow = blockAfter('@media (max-width: 599px)');
  assert.match(narrow, /\.pws-burn-explainer\s*\{[\s\S]*padding-inline:\s*var\(--s-3\)/);
  assert.match(narrow, /\.pws-burn-mini-scene\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 2\.35rem minmax\(0, 1fr\)/);
  assert.match(css, /\.pws-burn-boundary strong\s*\{[\s\S]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.pws-burn-stage\s*\{[\s\S]*overflow-wrap:\s*anywhere/s);
  assert.doesNotMatch(css, /\.pws-burn-stage\s*\{[\s\S]*border-radius:\s*(?:9|1[0-9])px/s);
});

console.log('test-pws-burn-disclosure-flow: responsive PWS/Burn motion parity is frozen.');
