# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Public marketing/download site for OSL Privacy (https://oslprivacy.com). Static HTML, CSS, and
vanilla JavaScript — **no framework, no bundler, no build step, no package.json**. Pages are served
as-is. There are no remote fonts, analytics, or trackers; the only external calls are to the OSL
keyserver API and (for card checkout) a redirect to Stripe.

The desktop client, crypto core, keyserver, Stripe webhook, and activation delivery live in a
separate repo: `OSLPrivacy/discord-privacy-client`. This repo only contains the client-side site.

## Commands

- **Local dev server:** `node scripts/serve-local.mjs` → http://127.0.0.1:4173/ (override with `PORT`).
  Resolves clean URLs (`/download` → `download.html`, `/docs` → `docs/index.html`).
- **Tests:** `node --test scripts/test-crypto-checkout.mjs scripts/test-crypto-donation.mjs`
  - Pass the files explicitly. `node --test scripts/` fails because it tries to run `serve-local.mjs`.
- **Deploy:** push to `main`; Cloudflare Pages auto-deploys the repo root (`wrangler.jsonc` sets
  `assets.directory` to `.`). No manual deploy step.

## Architecture

### Two JavaScript entry points
- **`assets/js/main.js`** — a single IIFE loaded on *every* page via `<script src="/assets/js/main.js?v=HASH" defer>`.
  Handles reveal-on-scroll animations (IntersectionObserver, honors `prefers-reduced-motion`), the
  agency/location UI, the **Stripe card checkout** flow, and the **crypto Pro-plan checkout** flow on
  `download.html`.
- **`assets/js/crypto-donation.js`** — an ES module loaded *only* on `donate.html`. A separate,
  simpler flow for **anonymous donations** — no entitlement, no activation delivery.

### Payment flows (the substance of this repo)
All flows talk to `https://keyserver.oslprivacy.com` and nothing else.

- **Card / Pro plan:** POST `/v1/checkout-session` → redirect to Stripe. The returned URL is validated
  to be `https://checkout.stripe.com` before navigation. Activation is delivered encrypted and decrypted
  in-browser (RSA-OAEP) after payment.
- **Crypto / Pro plan** (`download.html`): quote → poll status → decrypt activation envelope. Invoice
  IDs are `cpay_…`. Supports recovery export/import so a buyer can resume a paid-but-undelivered invoice.
- **Crypto / donation** (`donate.html`, `crypto-donation.js`): quote (`/v1/donations/crypto/quote`) →
  poll (`/v1/donations/crypto/status`). Invoice IDs are `cdon_…`. **No activation/entitlement** — never
  add recovery-of-access logic to the donation flow.

Keep the `cpay_` (paid entitlement) and `cdon_` (anonymous donation) namespaces distinct.

### Client-side security invariants (do not weaken)
The crypto/checkout code is written to *fail closed* and trust the server minimally. The test files are
mostly assertions that these invariants still hold — treat a test failure as "you removed a safety
check," not "the test is stale." Key rules:
- `hasExactKeys()` — server responses must match the expected key set *exactly* (extra/missing keys reject).
- Native crypto amounts are recomputed to atomic units and compared; mismatches reject.
- Price-lock and expiry timestamps are bounds-checked against the client clock.
- Activation envelopes are cryptographically bound to the exact quoted invoice (`invoice_id`,
  `payment_method`, `amount_usd_cents`, `plan`) before the code is shown or acknowledged.
- Recovery files are versioned and same-origin-checked (`recovery.origin !== window.location.origin`).
- Checkout redirect host is pinned to `checkout.stripe.com`.

### Live crypto methods
Bitcoin and Monero are live on both `download.html` and `donate.html`. Their controls must carry the
appropriate `data-crypto-method` / `data-crypto-donation-method` attributes and must remain enabled.
Tests enforce the live methods and their payment-flow bindings.

## Conventions

- **Cache-busting:** `main.js` (and CSS on donate) is referenced with a `?v=HASH` query in every HTML
  file. When you change `main.js`, bump that query string across *all* HTML files that reference it
  (they must stay in sync) — this is what "version the payment bundle" commits do.
- **CSP:** `_headers` defines a strict Content-Security-Policy. Any new external origin (script, style,
  connect, image) must be added there or it will be blocked in production. Inline scripts are disallowed
  (`script-src 'self'`); inline styles are allowed.
- **`.assetsignore`** controls what Cloudflare Pages does *not* publish (e.g. `scripts/`, working files,
  the local-only motion lab). Adding a file to the repo does not mean it ships.
- **`_redirects`** holds Cloudflare Pages redirects (e.g. `/pricing` → `/download`).
- Docs pages live in `docs/`; top-level pages are marketing/checkout: `index`, `features`, `pricing`,
  `download`, `donate`, `audit`, plus the Stripe return pages `success.html` (post-payment activation
  decryption surfaces here) and `cancel.html`.

## Gotchas

- **`update/` is a stray nested checkout — do not edit or commit it.** `update/oslprivacy-web/` is a
  full, older copy of this same repo (its own `.git`, older/smaller HTML). It is untracked and *not* in
  `.gitignore`, so `git add .` would swallow it. Ignore it for all work; if anything, it should be
  removed or gitignored, never edited.
