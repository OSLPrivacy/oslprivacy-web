# oslprivacy-web

Public website for [OSL Privacy](https://oslprivacy.com).

## Tech stack

Static HTML, CSS, and vanilla JavaScript. No frameworks, remote fonts, analytics, or advertising trackers. Payment and download actions call the public OSL keyserver API. Card checkout redirects to Stripe.

## Deploy

Push to `main`. Cloudflare Pages auto-deploys.

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
