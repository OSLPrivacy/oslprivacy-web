import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [html, script] = await Promise.all([
  readFile(new URL('download.html', root), 'utf8'),
  readFile(new URL('assets/js/main.js', root), 'utf8'),
]);

function loadCryptoInvoiceValidator() {
  const constantsStart = script.indexOf('  const CRYPTO_INVOICE_ID = ');
  const constantsEnd = script.indexOf('\n  const PRIVATE_JWK_KEYS = ', constantsStart);
  const functionsStart = script.indexOf('  function atomicFromNative(', constantsEnd);
  const functionsEnd = script.indexOf('\n\n  async function parseCryptoRecoveryFile(', functionsStart);
  assert.ok(constantsStart >= 0 && constantsEnd > constantsStart);
  assert.ok(functionsStart >= 0 && functionsEnd > functionsStart);
  const source = `${script.slice(constantsStart, constantsEnd)}\n${script.slice(functionsStart, functionsEnd)}`
    .replace(/^  /gm, '');
  return Function(
    'hasExactKeys',
    `'use strict'; ${source}; return validateCryptoInvoice;`,
  )((value, expectedKeys) => (
    value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expectedKeys].sort().join('\0')
  ));
}

function validQuote(asset = 'btc') {
  const now = Math.floor(Date.now() / 1000);
  return {
    invoice_id: `cpay_${'a'.repeat(32)}`,
    claim_token: 'A'.repeat(43),
    payment_method: asset,
    address: asset === 'btc' ? `bc1q${'a'.repeat(38)}` : `4${'A'.repeat(94)}`,
    amount_native: asset === 'btc' ? '0.00005000' : '0.012345678901',
    amount_atomic: asset === 'btc' ? '5000' : '12345678901',
    amount_usd_cents: 500,
    price_locked_at: now - 10,
    expires_at: now + 30 * 60,
    confirmations_required: asset === 'btc' ? 2 : 10,
  };
}

test('Bitcoin and Monero checkout methods are live', () => {
  const paymentBlock = html.match(/<div class="coming-payment-options"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(paymentBlock, /data-crypto-method="btc"[\s\S]*Bitcoin[\s\S]*Pay once/);
  assert.match(paymentBlock, /data-crypto-method="xmr"[\s\S]*Monero[\s\S]*Pay once/);
  assert.equal((paymentBlock.match(/\bdisabled\b/g) ?? []).length, 0);
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

test('crypto quotes require the exact Worker schema and retain every binding', () => {
  const validate = loadCryptoInvoiceValidator();
  const quote = validQuote();
  const retained = validate(quote, 'btc');
  assert.deepEqual(retained, { ...quote, plan: 'pro' });
  assert.throws(
    () => validate({ ...quote, unexpected: true }, 'btc'),
    /invalid invoice/,
  );
  assert.throws(
    () => validate({ ...quote, amount_atomic: '5001' }, 'btc'),
    /invalid invoice/,
  );
  assert.throws(
    () => validate({ ...quote, amount_native: '0.0000500' }, 'btc'),
    /invalid invoice/,
  );

  const xmr = validQuote('xmr');
  assert.deepEqual(validate(xmr, 'xmr'), { ...xmr, plan: 'pro' });
});

test('crypto quotes enforce price clocks, expiry bounds, and asset confirmations', () => {
  const validate = loadCryptoInvoiceValidator();
  const quote = validQuote();
  const now = Math.floor(Date.now() / 1000);
  for (const mutation of [
    { price_locked_at: now - 15 * 60 - 1 },
    { price_locked_at: now + 61 },
    { expires_at: now + 35 * 60 + 1 },
    { expires_at: quote.price_locked_at },
    { expires_at: quote.price_locked_at + 45 * 60 + 1 },
    { confirmations_required: 1 },
    { confirmations_required: 10 },
  ]) {
    assert.throws(() => validate({ ...quote, ...mutation }, 'btc'), /invalid invoice/);
  }
});

test('retained session invoices are normalized and exact', () => {
  const validate = loadCryptoInvoiceValidator();
  const retained = { ...validQuote(), plan: 'pro' };
  assert.deepEqual(validate(retained, 'btc', true, true), retained);
  assert.throws(
    () => validate({ ...retained, plan: 'free' }, 'btc', true, true),
    /invalid invoice/,
  );
  assert.throws(
    () => validate({ ...retained, unexpected: true }, 'btc', true, true),
    /invalid invoice/,
  );
  const missingAtomic = { ...retained };
  delete missingAtomic.amount_atomic;
  assert.throws(() => validate(missingAtomic, 'btc', true, true), /invalid invoice/);
});

test('crypto activation is bound to the exact retained quote before display or acknowledgement', () => {
  assert.match(script, /async function decryptCryptoActivationEnvelope\(/);
  assert.match(script, /!hasExactKeys\(envelope, \[/);
  for (const comparison of [
    /envelope\.version !== 1/,
    /envelope\.invoice_id !== invoice\.invoice_id/,
    /envelope\.payment_method !== invoice\.payment_method/,
    /envelope\.amount_usd_cents !== invoice\.amount_usd_cents/,
    /envelope\.plan !== invoice\.plan/,
  ]) {
    assert.match(script, comparison);
  }
  assert.match(script, /value\.amount_usd_cents !== 500/);
  assert.match(script, /const code = await decryptCryptoActivationEnvelope\([\s\S]*?invoice,[\s\S]*?\);/);
  assert.match(script, /const recoverable = \{[\s\S]*?invoice,[\s\S]*?acknowledged: false/);
  assert.match(script, /delivery: saved\.delivery,\s+invoice: saved\.invoice,\s+acknowledged: true/);
  assert.doesNotMatch(
    script,
    /decryptCryptoActivationEnvelope\([\s\S]{0,200}?showActivationCode\([\s\S]{0,200}?decryptCryptoActivationEnvelope/,
  );
});

test('a valid activation envelope from another invoice is rejected', async () => {
  const start = script.indexOf('  async function decryptCryptoActivationEnvelope(');
  const end = script.indexOf('\n\n  async function validatePrivateRecoveryJwk(', start);
  assert.ok(start >= 0 && end > start);
  const functionSource = script.slice(start, end).replace(/^  /gm, '');
  const decrypt = Function(
    'crypto',
    'atob',
    'TextDecoder',
    'hasExactKeys',
    'validateCryptoInvoice',
    `'use strict'; ${functionSource}; return decryptCryptoActivationEnvelope;`,
  )(
    webcrypto,
    (value) => Buffer.from(value, 'base64').toString('binary'),
    TextDecoder,
    (value, expectedKeys) => (
      value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join('\0') === [...expectedKeys].sort().join('\0')
    ),
    (value) => value,
  );

  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const privateJwk = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);
  const paidInvoice = {
    invoice_id: `cpay_${'a'.repeat(32)}`,
    payment_method: 'btc',
    amount_usd_cents: 500,
    plan: 'pro',
  };
  const otherInvoice = { ...paidInvoice, invoice_id: `cpay_${'b'.repeat(32)}` };
  const activationCode = 'OSL-ABCD-EFGH-JKMM-NPQR';
  const envelope = {
    version: 1,
    invoice_id: paidInvoice.invoice_id,
    payment_method: paidInvoice.payment_method,
    amount_usd_cents: paidInvoice.amount_usd_cents,
    plan: paidInvoice.plan,
    activation_code: activationCode,
  };
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    keyPair.publicKey,
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
  const ciphertext = Buffer.from(encrypted).toString('base64');

  await assert.doesNotReject(async () => {
    assert.equal(await decrypt(ciphertext, privateJwk, paidInvoice), activationCode);
  });
  await assert.rejects(
    decrypt(ciphertext, privateJwk, otherInvoice),
    /Activation delivery could not be verified/,
  );
});

test('payment recovery is explicit, private, versioned, and same-origin', () => {
  assert.match(html, /id="crypto-recovery-export" type="button" disabled/);
  assert.match(html, /id="crypto-recovery-import" type="button"/);
  assert.match(html, /This file grants access to your activation\./);
  assert.match(html, /type="file" accept="application\/json,\.json" hidden/);
  assert.match(script, /CRYPTO_RECOVERY_FORMAT = 'osl-crypto-payment-recovery'/);
  assert.match(script, /CRYPTO_RECOVERY_VERSION = 2/);
  assert.match(script, /recovery\.origin !== window\.location\.origin/);
  assert.match(script, /function hasExactKeys\(/);
  assert.match(script, /CRYPTO_RECOVERY_INVOICE_KEYS/);
  assert.match(script, /amount_atomic: invoice\.amount_atomic/);
  assert.match(script, /price_locked_at: invoice\.price_locked_at/);
  assert.match(script, /async function validatePrivateRecoveryJwk\(/);
  assert.match(script, /now >= invoice\.expires_at \+ CRYPTO_CONFIRMATION_GRACE_SECONDS/);
  assert.match(script, /cryptoRecoveryExport\?\.addEventListener\('click'/);
  assert.match(script, /cryptoRecoveryFile\?\.addEventListener\('change'/);
  assert.doesNotMatch(script, /cryptoRecoveryExport\.click\(/);
});
