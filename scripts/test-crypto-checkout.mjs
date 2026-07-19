import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [html, script] = await Promise.all([
  readFile(new URL('download.html', root), 'utf8'),
  readFile(new URL('assets/js/main.js', root), 'utf8'),
]);

test('crypto payment buttons remain release-gated', () => {
  const paymentBlock = html.match(/<div class="coming-payment-options"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(paymentBlock, /Bitcoin[\s\S]*Coming soon/);
  assert.match(paymentBlock, /Monero[\s\S]*Coming soon/);
  assert.equal((paymentBlock.match(/\bdisabled\b/g) ?? []).length, 2);
  assert.doesNotMatch(paymentBlock, /data-crypto-method/);
});

test('invoice details are semantic, copyable, and expire visibly', () => {
  assert.match(html, /<dl class="payment-detail">/);
  assert.match(html, /data-copy-target="crypto-address" data-crypto-copy/);
  assert.match(html, /data-copy-target="crypto-amount" data-crypto-copy/);
  assert.match(html, /<time id="crypto-expires"><\/time>/);
  assert.match(script, /cryptoExpires\.dateTime = expiry\.toISOString\(\)/);
  assert.match(html, /id="crypto-expired-warning" role="alert" hidden/);
});

test('checkout state fails closed around one invoice and delivery cleanup', () => {
  assert.match(script, /if \(activeCryptoPoll\) return;/);
  assert.match(script, /This is your active invoice\. OSL will not create another one yet\./);
  assert.match(script, /function validateCryptoInvoice\(/);
  assert.match(script, /function acknowledgeCryptoCheckout\(/);
  assert.match(script, /Server cleanup will retry when this tab reloads\./);
  assert.match(script, /fetchWithTimeout/);
  assert.doesNotMatch(script, /invoice\.payment_method\s*=\s*paymentMethod/);
});

test('payment recovery is explicit, private, versioned, and same-origin', () => {
  assert.match(html, /id="crypto-recovery-export" type="button" disabled/);
  assert.match(html, /id="crypto-recovery-import" type="button"/);
  assert.match(html, /This file grants access to your activation\./);
  assert.match(html, /type="file" accept="application\/json,\.json" hidden/);
  assert.match(script, /CRYPTO_RECOVERY_FORMAT = 'osl-crypto-payment-recovery'/);
  assert.match(script, /CRYPTO_RECOVERY_VERSION = 1/);
  assert.match(script, /recovery\.origin !== window\.location\.origin/);
  assert.match(script, /function hasExactKeys\(/);
  assert.match(script, /async function validatePrivateRecoveryJwk\(/);
  assert.match(script, /now >= invoice\.expires_at \+ CRYPTO_CONFIRMATION_GRACE_SECONDS/);
  assert.match(script, /cryptoRecoveryExport\?\.addEventListener\('click'/);
  assert.match(script, /cryptoRecoveryFile\?\.addEventListener\('change'/);
  assert.doesNotMatch(script, /cryptoRecoveryExport\.click\(/);
});
