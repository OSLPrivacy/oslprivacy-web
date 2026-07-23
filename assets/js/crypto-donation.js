const API_ORIGIN = 'https://keyserver.oslprivacy.com';
const QUOTE_PATH = '/v1/donations/crypto/quote';
const STATUS_PATH = '/v1/donations/crypto/status';
const SESSION_KEY = 'osl_crypto_donation_v1';
const SESSION_VERSION = 1;
const FETCH_TIMEOUT_MS = 15_000;
const POLL_MS = 8_000;
const CONFIRMATION_POLL_MS = 30_000;
const CONFIRMATION_GRACE_SECONDS = 24 * 60 * 60;
const MAX_RETRY_AFTER_SECONDS = 10 * 60;
const MIN_USD_CENTS = 100;
const MAX_USD_CENTS = 1_000_000;

const INVOICE_KEYS = [
  'invoice_id',
  'claim_token',
  'payment_method',
  'address',
  'amount_native',
  'amount_atomic',
  'amount_usd_cents',
  'price_locked_at',
  'expires_at',
  'confirmations_required',
];
const STATUS_KEYS = [
  'invoice_id',
  'status',
  'payment_method',
  'amount_usd_cents',
  'expires_at',
];
const SESSION_KEYS = ['version', 'origin', 'invoice'];
const INVOICE_ID = /^cdon_[0-9a-f]{32}$/;
const CLAIM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ADDRESSES = {
  btc: /^bc1[023456789acdefghjklmnpqrstuvwxyz]{11,87}$/,
  xmr: /^[48][123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{94}$/,
};
const DECIMALS = { btc: 8, xmr: 12 };
const CONFIRMATIONS = { btc: 2, xmr: 10 };

export function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function parseUsdCents(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,5})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number.parseInt(match[1], 10);
  const fraction = Number.parseInt((match[2] || '').padEnd(2, '0') || '0', 10);
  const cents = (whole * 100) + fraction;
  return Number.isSafeInteger(cents) && cents >= MIN_USD_CENTS && cents <= MAX_USD_CENTS
    ? cents
    : null;
}

function atomicFromNative(amountNative, decimals) {
  const match = amountNative.match(new RegExp(`^(\\d+)\\.(\\d{${decimals}})$`));
  if (!match) return null;
  try {
    return BigInt(`${match[1]}${match[2]}`).toString();
  } catch {
    return null;
  }
}

export function validateDonationInvoice(
  value,
  expectedMethod,
  expectedUsdCents,
  now,
  allowExpired = false,
) {
  if (!hasExactKeys(value, INVOICE_KEYS)) {
    throw new Error('The donation service returned an invalid invoice. No payment was started.');
  }
  const currentTime = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000);
  const decimals = DECIMALS[expectedMethod];
  const atomic = typeof value.amount_native === 'string' && decimals
    ? atomicFromNative(value.amount_native, decimals)
    : null;
  if (
    !INVOICE_ID.test(value.invoice_id)
    || !CLAIM_TOKEN.test(value.claim_token)
    || value.payment_method !== expectedMethod
    || !ADDRESSES[expectedMethod]?.test(value.address)
    || typeof value.amount_atomic !== 'string'
    || !/^[1-9]\d*$/.test(value.amount_atomic)
    || atomic !== value.amount_atomic
    || value.amount_usd_cents !== expectedUsdCents
    || !Number.isSafeInteger(value.price_locked_at)
    || (!allowExpired && value.price_locked_at < currentTime - 15 * 60)
    || value.price_locked_at > currentTime + 60
    || !Number.isSafeInteger(value.expires_at)
    || (!allowExpired && value.expires_at <= currentTime)
    || (!allowExpired && value.expires_at > currentTime + 35 * 60)
    || value.expires_at <= value.price_locked_at
    || value.expires_at - value.price_locked_at > 45 * 60
    || value.confirmations_required !== CONFIRMATIONS[expectedMethod]
  ) {
    throw new Error('The donation service returned an invalid invoice. No payment was started.');
  }
  return Object.fromEntries(INVOICE_KEYS.map((key) => [key, value[key]]));
}

export function validateDonationStatus(value, invoice) {
  if (
    !hasExactKeys(value, STATUS_KEYS)
    || value.invoice_id !== invoice.invoice_id
    || !['pending', 'recorded'].includes(value.status)
    || value.payment_method !== invoice.payment_method
    || value.amount_usd_cents !== invoice.amount_usd_cents
    || value.expires_at !== invoice.expires_at
  ) {
    throw new Error('The donation service returned an invalid status. Checking stopped safely.');
  }
  return Object.fromEntries(STATUS_KEYS.map((key) => [key, value[key]]));
}

function formatUsd(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function setStatus(element, message, tone = '') {
  if (!element) return;
  element.textContent = message;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function endpoint(path) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN || url.pathname !== path || url.search || url.hash) {
    throw new Error('Donation endpoint validation failed.');
  }
  return url.href;
}

async function postJson(path, body) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const responseUrl = new URL(response.url);
    if (responseUrl.origin !== API_ORIGIN || responseUrl.pathname !== path) {
      throw new Error('The donation service returned an unexpected address.');
    }
    return response;
  } finally {
    window.clearTimeout(timeout);
  }
}

function readSession() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
    if (
      !hasExactKeys(saved, SESSION_KEYS)
      || saved.version !== SESSION_VERSION
      || saved.origin !== window.location.origin
    ) {
      if (saved !== null) window.sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return saved;
  } catch {
    window.sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(invoice) {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    version: SESSION_VERSION,
    origin: window.location.origin,
    invoice,
  }));
}

function clearSession() {
  window.sessionStorage.removeItem(SESSION_KEY);
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const prior = button.textContent;
  button.textContent = 'Copied';
  window.setTimeout(() => { button.textContent = prior; }, 1400);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function initializeCryptoDonations() {
  const dialog = document.getElementById('crypto-donation-dialog');
  const cardMethodButton = document.querySelector('[data-donation-method="card"]');
  const cryptoMethodButtons = [...document.querySelectorAll('[data-crypto-donation-method]')];
  const allMethodButtons = [cardMethodButton, ...cryptoMethodButtons].filter(Boolean);
  const liveCryptoMethods = cryptoMethodButtons.filter((button) => !button.disabled);
  const amountButtons = [...document.querySelectorAll('[data-crypto-donation-amount-cents]')];
  const customToggle = document.querySelector('[data-crypto-donation-custom-toggle]');
  const customForm = document.getElementById('crypto-donation-custom-form');
  const customInput = document.getElementById('crypto-donation-custom-amount');
  const amountStatus = document.getElementById('crypto-donation-amount-status');
  const selectedAmount = document.getElementById('crypto-donation-selected-amount');
  const selectedMethodLabel = document.getElementById('donation-selected-method');
  const proceedButton = document.querySelector('[data-donation-proceed]');
  const checkoutStatus = document.getElementById('checkout-status');
  const status = document.getElementById('crypto-donation-status');
  const expired = document.getElementById('crypto-donation-expired');
  const confirmed = document.getElementById('crypto-donation-confirmed');
  const usd = document.getElementById('crypto-donation-usd');
  const address = document.getElementById('crypto-donation-address');
  const nativeAmount = document.getElementById('crypto-donation-native-amount');
  const asset = document.getElementById('crypto-donation-asset');
  const confirmations = document.getElementById('crypto-donation-confirmations');
  const expires = document.getElementById('crypto-donation-expires');
  if (!dialog || !status || !proceedButton || allMethodButtons.length === 0) return;

  const METHOD_LABELS = { card: 'Card', btc: 'Bitcoin', xmr: 'Monero' };
  let selectedMethod = 'card';
  let selectedUsdCents = 2000;
  let quoteBusy = false;
  let activePoll = null;

  const selectMethod = (method, matchingButton = null) => {
    if (!METHOD_LABELS[method]) return;
    selectedMethod = method;
    allMethodButtons.forEach((button) => {
      const active = button === matchingButton;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('donation-method-active', active);
    });
    if (selectedMethodLabel) selectedMethodLabel.textContent = METHOD_LABELS[method];
    setStatus(checkoutStatus, '');
  };

  const selectAmount = (cents, matchingButton = null) => {
    selectedUsdCents = cents;
    if (selectedAmount) selectedAmount.textContent = formatUsd(cents);
    amountButtons.forEach((button) => {
      const selected = button === matchingButton;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('button-primary', selected);
      button.classList.toggle('button-secondary', !selected);
    });
    setStatus(amountStatus, `${formatUsd(cents)} selected.`, 'success');
  };

  const showInvoice = (invoice) => {
    if (usd) usd.textContent = formatUsd(invoice.amount_usd_cents);
    if (address) address.textContent = invoice.address;
    if (nativeAmount) nativeAmount.textContent = invoice.amount_native;
    if (asset) asset.textContent = invoice.payment_method.toUpperCase();
    if (confirmations) confirmations.textContent = String(invoice.confirmations_required);
    if (expires) {
      const date = new Date(invoice.expires_at * 1000);
      expires.dateTime = date.toISOString();
      expires.textContent = date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
    expired.hidden = true;
    confirmed.hidden = true;
    delete dialog.dataset.expired;
    dialog.querySelectorAll('[data-crypto-donation-copy]').forEach((button) => {
      button.disabled = false;
    });
    if (!dialog.open) dialog.showModal();
  };

  const markExpired = () => {
    expired.hidden = false;
    dialog.dataset.expired = 'true';
    dialog.querySelectorAll('[data-crypto-donation-copy]').forEach((button) => {
      button.disabled = true;
    });
  };

  const poll = async (invoice) => {
    if (activePoll) return;
    activePoll = invoice.invoice_id;
    const stopAt = invoice.expires_at + CONFIRMATION_GRACE_SECONDS;
    try {
      while (activePoll === invoice.invoice_id && Math.floor(Date.now() / 1000) < stopAt) {
        let response;
        let result = {};
        try {
          response = await postJson(STATUS_PATH, {
            invoice_id: invoice.invoice_id,
            claim_token: invoice.claim_token,
          });
          result = await response.json().catch(() => ({}));
        } catch {
          setStatus(status, 'Connection interrupted. OSL will keep checking.');
          await delay(POLL_MS);
          continue;
        }
        if (response.status === 429) {
          const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
          const wait = Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Number.isSafeInteger(retryAfter) ? retryAfter : 8));
          await delay(wait * 1000);
          continue;
        }
        if (response.status === 410) {
          markExpired();
          clearSession();
          setStatus(status, 'This invoice closed. Do not send to this address.', 'error');
          return;
        }
        if (!response.ok) {
          if (response.status < 500) clearSession();
          setStatus(status, response.status >= 500 ? 'Donation confirmation is temporarily unavailable.' : 'This invoice can no longer be checked.', 'error');
          return;
        }
        const checked = validateDonationStatus(result, invoice);
        if (checked.status === 'recorded') {
          clearSession();
          confirmed.hidden = false;
          confirmed.focus();
          setStatus(status, 'Payment confirmed by the network.', 'success');
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        if (now >= invoice.expires_at) {
          markExpired();
          setStatus(status, 'Do not send now. Waiting only for an on-time payment to finish confirming.');
          await delay(CONFIRMATION_POLL_MS);
        } else {
          setStatus(status, 'Waiting for network confirmation...');
          await delay(POLL_MS);
        }
      }
      markExpired();
      clearSession();
      setStatus(status, 'This invoice can no longer be checked.', 'error');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : 'Donation confirmation stopped safely.', 'error');
    } finally {
      if (activePoll === invoice.invoice_id) activePoll = null;
    }
  };

  amountButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const cents = Number.parseInt(button.dataset.cryptoDonationAmountCents || '', 10);
      if (Number.isSafeInteger(cents) && cents >= MIN_USD_CENTS && cents <= MAX_USD_CENTS) {
        selectAmount(cents, button);
      }
    });
  });

  customToggle?.addEventListener('click', () => {
    const open = customToggle.getAttribute('aria-expanded') === 'true';
    customToggle.setAttribute('aria-expanded', String(!open));
    if (customForm) customForm.hidden = open;
    if (!open) customInput?.focus();
  });

  customForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const cents = parseUsdCents(customInput?.value || '');
    if (cents === null) {
      setStatus(amountStatus, 'Enter an amount from $1.00 to $10,000.00.', 'error');
      return;
    }
    selectAmount(cents);
    customForm.hidden = true;
    customToggle?.setAttribute('aria-expanded', 'false');
  });

  cardMethodButton?.addEventListener('click', () => selectMethod('card', cardMethodButton));
  cryptoMethodButtons.forEach((button) => {
    button.addEventListener('click', () => selectMethod(button.dataset.cryptoDonationMethod, button));
  });

  const startCardDonation = async () => {
    const cents = selectedUsdCents;
    if (!Number.isSafeInteger(cents) || cents < MIN_USD_CENTS || cents > MAX_USD_CENTS) {
      setStatus(checkoutStatus, 'Choose an amount from $1.00 to $10,000.00.', 'error');
      return;
    }
    proceedButton.disabled = true;
    setStatus(checkoutStatus, 'Opening secure card checkout...');
    try {
      const requestTokenBytes = new Uint8Array(32);
      window.crypto.getRandomValues(requestTokenBytes);
      const response = await postJson('/v1/donations/stripe/session', {
        amount_usd_cents: cents,
        request_token: bytesToBase64Url(requestTokenBytes),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.url !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : 'Donations are temporarily unavailable.');
      }
      const checkoutUrl = new URL(result.url);
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
        throw new Error('The card processor returned an unexpected address. No payment was opened.');
      }
      window.location.assign(checkoutUrl.href);
    } catch (error) {
      setStatus(checkoutStatus, error instanceof Error ? error.message : 'Donations are temporarily unavailable.', 'error');
      proceedButton.disabled = false;
    }
  };

  const resumeSavedCrypto = () => {
    const saved = readSession();
    if (!saved?.invoice) return false;
    try {
      const invoice = validateDonationInvoice(
        saved.invoice,
        saved.invoice.payment_method,
        saved.invoice.amount_usd_cents,
        Math.floor(Date.now() / 1000),
        true,
      );
      showInvoice(invoice);
      setStatus(status, 'This is your active invoice. OSL will not create another one yet.');
      void poll(invoice);
      return true;
    } catch {
      clearSession();
      return false;
    }
  };

  const startCryptoDonation = async () => {
    if (resumeSavedCrypto()) return;
    if (quoteBusy) return;
    const paymentMethod = selectedMethod;
    quoteBusy = true;
    proceedButton.disabled = true;
    setStatus(checkoutStatus, 'Creating a unique payment address...');
    try {
      const response = await postJson(QUOTE_PATH, {
        payment_method: paymentMethod,
        amount_usd_cents: selectedUsdCents,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 429 ? 'Too many invoice attempts. Try again shortly.' : 'Crypto donations are temporarily unavailable.');
      const invoice = validateDonationInvoice(result, paymentMethod, selectedUsdCents);
      saveSession(invoice);
      showInvoice(invoice);
      setStatus(checkoutStatus, '');
      setStatus(status, 'Send the exact amount once. OSL will confirm it here.');
      void poll(invoice);
    } catch (error) {
      setStatus(checkoutStatus, error instanceof Error ? error.message : 'Crypto donations are temporarily unavailable.', 'error');
    } finally {
      quoteBusy = false;
      proceedButton.disabled = false;
    }
  };

  proceedButton.addEventListener('click', () => {
    if (selectedMethod === 'card') {
      void startCardDonation();
    } else if (liveCryptoMethods.some((button) => button.dataset.cryptoDonationMethod === selectedMethod)) {
      void startCryptoDonation();
    } else {
      setStatus(checkoutStatus, 'Choose a payment method to continue.', 'error');
    }
  });

  dialog.querySelectorAll('[data-crypto-donation-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.cryptoDonationCopy === 'address' ? address : nativeAmount;
      if (target?.textContent) void copyText(target.textContent.trim(), button);
    });
  });
  dialog.querySelectorAll('[data-crypto-donation-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  if (selectedAmount) selectedAmount.textContent = formatUsd(selectedUsdCents);
  if (selectedMethodLabel) selectedMethodLabel.textContent = METHOD_LABELS[selectedMethod];

  const donationResult = new URLSearchParams(window.location.search).get('donation');
  if (donationResult === 'complete') {
    setStatus(checkoutStatus, 'Thank you. Card checkout finished. OSL counts the donation only after the processor confirms payment.', 'success');
  } else if (donationResult === 'cancelled') {
    setStatus(checkoutStatus, 'Donation cancelled. No payment was completed.');
  }

  const saved = readSession();
  if (saved?.invoice) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const invoice = validateDonationInvoice(
        saved.invoice,
        saved.invoice.payment_method,
        saved.invoice.amount_usd_cents,
        now,
        true,
      );
      showInvoice(invoice);
      if (now >= invoice.expires_at) markExpired();
      setStatus(status, 'Resuming donation confirmation...');
      void poll(invoice);
    } catch {
      clearSession();
    }
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initializeCryptoDonations();
}
