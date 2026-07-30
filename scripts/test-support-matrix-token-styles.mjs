import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPTS_DIR);
const CSS_PATH = path.join(REPO_ROOT, 'assets', 'css', 'style.css');

const css = readFileSync(CSS_PATH, 'utf8');
const start = css.indexOf('/* Support matrix (docs/status.html)');
const end = css.indexOf('/* Site-wide early-access frame.', start);

function fail(message) {
  console.error(`test-support-matrix-token-styles: ${message}`);
  process.exit(1);
}

if (start === -1 || end === -1 || end <= start) {
  fail('support matrix CSS block is missing or no longer bounded');
}

const tableBlock = css.slice(start, end);

if (!/Support matrix/.test(tableBlock) || !/\.status-table\b/.test(tableBlock) || !/\.matrix-link\b/.test(css)) {
  fail('accept selectors are not all present in the support matrix block');
}

if (/(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i.test(tableBlock)) {
  fail('support matrix block must not introduce raw colors outside product tokens');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declarationsFor(selector, source = css) {
  const normalizedSelector = selector.trim().replace(/\s+/g, '\\s+');
  const pattern = new RegExp(`${escapeRegExp(normalizedSelector).replaceAll('\\\\s\\+', '\\s+')}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(pattern);
  if (!match) fail(`missing selector ${selector}`);
  return Object.fromEntries(match[1]
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon === -1) fail(`invalid declaration in ${selector}: ${declaration}`);
      return [
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim().replace(/\s+/g, ' '),
      ];
    }));
}

function expectDeclaration(selector, property, expected, source = css) {
  const declarations = declarationsFor(selector, source);
  if (declarations[property] !== expected) {
    fail(`${selector} must set ${property}: ${expected}`);
  }
}

expectDeclaration('.status-table-scroll', 'margin', 'var(--s-4) 0', tableBlock);
expectDeclaration('.status-table-scroll', 'max-width', '100%', tableBlock);
expectDeclaration('.status-table-scroll', 'border', '1px solid var(--border)', tableBlock);
expectDeclaration('.status-table-scroll', 'border-radius', 'var(--radius)', tableBlock);
expectDeclaration('.status-table-scroll', 'background', 'var(--surface)', tableBlock);
expectDeclaration('.status-table-scroll:focus-visible', 'outline', '2px solid var(--accent)', tableBlock);
expectDeclaration('.status-table caption', 'padding', 'var(--s-3) var(--s-3) var(--s-2)', tableBlock);
expectDeclaration('.status-table caption', 'color', 'var(--text-muted)', tableBlock);
expectDeclaration('.status-table th,\n.status-table td', 'padding', 'var(--s-3)', tableBlock);
expectDeclaration('.status-table th,\n.status-table td', 'border-top', '1px solid var(--border)', tableBlock);
expectDeclaration('.status-table thead th', 'color', 'var(--text-muted)', tableBlock);
expectDeclaration('.status-table tbody th[scope="row"]', 'color', 'var(--text)', tableBlock);
expectDeclaration('.status-table td:last-child', 'color', 'var(--text-muted)', tableBlock);
expectDeclaration('.matrix-link', 'font-weight', '600');
expectDeclaration('.section-matrix-link', 'margin-top', 'var(--s-2)');

console.log('test-support-matrix-token-styles: support matrix stays on product tokens');
