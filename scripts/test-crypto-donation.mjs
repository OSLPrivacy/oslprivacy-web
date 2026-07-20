import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseUsdCents,
  validateDonationInvoice,
  validateDonationStatus,
} from '../assets/js/crypto-donation.js';

const root = new URL('../', import.meta.url);
const [html, script] = await Promise.all([
  readFile(new URL('donate.html', root), 'utf8'),
  readFile(new URL('assets/js/crypto-donation.js', root), 'utf8'),
]);

const now = 1_800_000_000;
const validBtcInvoice = {
  invoice_id: `cdon_${'a'.repeat(32)}`,
  claim_token: 'A'.repeat(43),
  payment_method: 'btc',
  address: `bc1q${'a'.repeat(38)}`,
  amount_native: '0.00012345',
  amount_atomic: '12345',
  amount_usd_cents: 2000,
  price_locked_at: now - 30,
  expires_at: now + 1800,
  confirmations_required: 2,
};

test('custom donation amounts convert to exact integer cents', () => {
  assert.equal(parseUsdCents('1'), 100);
  assert.equal(parseUsdCents('20.5'), 2050);
  assert.equal(parseUsdCents('9999.99'), 999999);
  assert.equal(parseUsdCents('10000.00'), 1000000);
  assert.equal(parseUsdCents('0.99'), null);
  assert.equal(parseUsdCents('10000.01'), null);
  assert.equal(parseUsdCents('5.999'), null);
  assert.equal(parseUsdCents('Infinity'), null);
});

test('quote validation is exact, asset-bound, atomic, and time-bounded', () => {
  assert.deepEqual(
    validateDonationInvoice(validBtcInvoice, 'btc', 2000, now),
    validBtcInvoice,
  );
  assert.throws(
    () => validateDonationInvoice({ ...validBtcInvoice, plan: 'pro' }, 'btc', 2000, now),
    /invalid invoice/,
  );
  assert.throws(
    () => validateDonationInvoice({ ...validBtcInvoice, amount_atomic: '12346' }, 'btc', 2000, now),
    /invalid invoice/,
  );
  assert.throws(
    () => validateDonationInvoice({ ...validBtcInvoice, confirmations_required: 1 }, 'btc', 2000, now),
    /invalid invoice/,
  );
  assert.throws(
    () => validateDonationInvoice({ ...validBtcInvoice, expires_at: now - 1 }, 'btc', 2000, now),
    /invalid invoice/,
  );
});

test('status validation accepts only the matching donation receipt', () => {
  const status = {
    invoice_id: validBtcInvoice.invoice_id,
    status: 'recorded',
    payment_method: 'btc',
    amount_usd_cents: 2000,
    expires_at: validBtcInvoice.expires_at,
  };
  assert.deepEqual(validateDonationStatus(status, validBtcInvoice), status);
  assert.throws(
    () => validateDonationStatus({ ...status, encrypted_license: 'no' }, validBtcInvoice),
    /invalid status/,
  );
  assert.throws(
    () => validateDonationStatus({ ...status, amount_usd_cents: 5000 }, validBtcInvoice),
    /invalid status/,
  );
});

test('Bitcoin donations are live while Monero remains release-gated', () => {
  const methods = [...html.matchAll(/<button[^>]+data-crypto-donation-method="(btc|xmr)"[^>]*>/g)];
  assert.equal(methods.length, 2);
  const methodByAsset = new Map(methods.map(([button, asset]) => [asset, button]));
  assert.doesNotMatch(methodByAsset.get('btc'), /\bdisabled\b/);
  assert.match(methodByAsset.get('xmr'), /\bdisabled\b/);
  assert.match(html, /Bitcoin[\s\S]*Donate once/);
  assert.match(html, /Monero[\s\S]*Coming soon/);
});

test('donation invoice UI is copyable and contains no entitlement recovery', () => {
  const dialog = html.match(/<dialog[^>]+id="crypto-donation-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? '';
  assert.match(dialog, /id="crypto-donation-address"/);
  assert.match(dialog, /id="crypto-donation-native-amount"/);
  assert.match(dialog, /data-crypto-donation-copy="address"/);
  assert.match(dialog, /data-crypto-donation-copy="amount"/);
  assert.match(dialog, /<time id="crypto-donation-expires"><\/time>/);
  assert.match(dialog, /id="crypto-donation-confirmed"[^>]+hidden/);
  assert.doesNotMatch(dialog, /activation|license|recovery|RSA/i);
  assert.doesNotMatch(script, /RSA|delivery_public_key|encrypted_license|activation|acknowledge/i);
});

test('donation transport is fixed-origin, timeout-bound, and sends exact bodies', () => {
  assert.match(script, /const QUOTE_PATH = '\/v1\/donations\/crypto\/quote'/);
  assert.match(script, /const STATUS_PATH = '\/v1\/donations\/crypto\/status'/);
  assert.match(script, /credentials: 'omit'/);
  assert.match(script, /redirect: 'error'/);
  assert.match(script, /referrerPolicy: 'no-referrer'/);
  assert.match(script, /new AbortController\(\)/);
  assert.match(script, /payment_method: paymentMethod,\s+amount_usd_cents: selectedUsdCents/);
  assert.match(script, /invoice_id: invoice\.invoice_id,\s+claim_token: invoice\.claim_token/);
  assert.match(script, /This is your active invoice\. OSL will not create another one yet\./);
  assert.match(script, /window\.sessionStorage/);
});
