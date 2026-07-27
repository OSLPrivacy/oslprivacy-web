# oslprivacy-web

Public website for [OSL Privacy](https://oslprivacy.com).

## Tech stack

Static HTML, CSS, and vanilla JavaScript. No frameworks, remote fonts, analytics, or advertising trackers. Payment and download actions call the public OSL keyserver API. Card checkout redirects to Stripe.

## Deploy

The committed tree is source, not a deploy artifact. In particular, it must not
contain `build.json` or a claimed build SHA: a commit cannot contain its own
final SHA.

The deployment build must receive the exact checkout identity from the deploy
environment and materialize `dist/build.json`, a SHA-256 manifest of every
other public artifact, and the matching full-SHA `osl-build` HTML metadata.
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
as a preview. The checked-in Pages configuration fixes the output directory at
`dist`. A direct upload of an old `dist` is not an accepted promotion path.

Before promotion, verify the exact deployment rather than merely checking that
the site responds:

```sh
node scripts/verify-live-build.mjs \
  --url=https://deployment.example \
  --sha="$CF_PAGES_COMMIT_SHA" \
  --branch="$CF_PAGES_BRANCH" \
  --environment=production
```

The builder reads deployable bytes from the named commit's Git objects, so
ignored or untracked filesystem bytes cannot enter `dist`. The digest manifest
covers every served file except `build.json` itself; `_headers` and `_redirects`
are Cloudflare control inputs rather than served files, and dotfiles are not
copied. The live verifier checks the full SHA in both `/build.json` and the root
HTML, then downloads and hashes every served artifact named by the manifest.
Rollback means rebuilding and publishing a named previous clean commit under
the same contract, then running the live verifier against that previous full
SHA. Do not copy an old `dist` directory or infer a rollback from page content.

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
