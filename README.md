# oslprivacy-web

Public website for [OSL Privacy](https://oslprivacy.com).

## Tech stack

Static HTML, CSS, and vanilla JavaScript. No frameworks, remote fonts, analytics, or advertising trackers. Payment and download actions call the public OSL keyserver API. Card checkout redirects to Stripe.

## Deploy

The committed tree is source, not a deploy artifact. In particular, it must not
contain `build.json` or a claimed build SHA: a commit cannot contain its own
final SHA.

The deployment build must receive the exact checkout identity from the deploy
environment and materialize `dist/build.json`, SHA-256 manifests for every
output leaf and every fetchable served file, the exact deploy-control inputs,
and matching full-SHA `osl-build` HTML metadata.
Configure Cloudflare Pages with build command `node scripts/build-identity.mjs`,
output directory `dist`, and
`OSL_DEPLOY_ENVIRONMENT=production` for Production /
`OSL_DEPLOY_ENVIRONMENT=preview` for Preview. Pages supplies the commit and
branch variables used below:

```sh
node scripts/build-identity.mjs
```

The build accepts the SHA and branch only from Cloudflare Pages' injected
`CF_PAGES_COMMIT_SHA` and `CF_PAGES_BRANCH`. It refuses a missing or non-full
SHA, a dirty checkout, a SHA that differs from `git rev-parse HEAD`, an absent
environment/branch, a production branch other than `main`, or `main` labelled
as a preview. It also refuses ignored or untracked bytes anywhere under a
publishable source root instead of silently omitting them. The checked-in Pages
configuration fixes the output directory at `dist`; any other output path is
refused before deletion. A direct upload of an old `dist` is not an accepted
promotion path.

Before promotion, verify the exact deployment rather than merely checking that
the site responds:

```sh
node scripts/pricing-sync.mjs --check
node scripts/check-claims.mjs
node scripts/test-live-build.mjs
```

That is the promotion path for the clean H1 pricing candidate. Do not rebuild
pricing copy by hand during deployment; fix `data/pricing.json` or the claim
gate only when one of those commands refuses the candidate.

```sh
test -n "$OSL_KEYSERVER_REDEMPTION_EVIDENCE" && node scripts/verify-live-build.mjs \
  --url="$OSL_LIVE_URL" \
  --sha="$OSL_LIVE_SHA" \
  --branch=main \
  --environment=production
```

Acceptance command: `test -n "$OSL_KEYSERVER_REDEMPTION_EVIDENCE" && node scripts/verify-live-build.mjs --url="$OSL_LIVE_URL" --sha="$OSL_LIVE_SHA" --branch=main --environment=production`

The builder reads deployable bytes from the named commit's Git objects. Nested
HTML is discovered and stamped recursively. Every HTML document must contain
exactly one semantic `<meta name="osl-build" content="<full SHA>">` inside its
`head`; comments, `data-name`, duplicate tags, body tags, and raw-text lookalikes
do not count. `artifact_files` covers every output leaf except `build.json`,
including tracked dotfiles and the Pages control files. `files` separately
covers every fetchable served file. `inputs` byte-binds `_headers`,
`_redirects`, `.assetsignore`, `wrangler.jsonc`, and the pricing manifest to
their committed bytes. Local verification refuses an extra output entry or any
digest/control mismatch.

The live verifier checks the full SHA in `/build.json`, the root HTML and the
production `success.html` expiry limitation, validates the complete
artifact/input manifests, then downloads and hashes every fetchable served
artifact named by `files`. Production verification refuses to run without an
`OSL_KEYSERVER_REDEMPTION_EVIDENCE` value; do not put the evidence value in
logs or public artifacts.
Rollback means rebuilding and publishing a named previous clean commit under
the same contract, then running the live verifier against that previous full
SHA. Do not copy an old `dist` directory or infer a rollback from page content.

Pro purchase controls intentionally remain disabled until the keyserver has an
explicit redemption record and enforces the advertised one-month expiry. The
invoice and delivery plumbing existing in source is not sufficient authority to
accept payment for that entitlement.

## Develop locally

From this directory, run:

```sh
node scripts/serve-local.mjs
```

Then open `http://127.0.0.1:4173/`.

## Related source

The desktop client, cryptographic core, keyserver, Stripe webhook, crypto watcher integration, and activation delivery are in [OSLPrivacy/discord-privacy-client](https://github.com/OSLPrivacy/discord-privacy-client).

## License

[AGPL-3.0](./LICENSE)
