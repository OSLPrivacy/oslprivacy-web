#!/usr/bin/env python3
"""Fetch app icons from Simple Icons into assets/img/apps/, then rewire apps.json.

Simple Icons (https://simpleicons.org) serves every brand glyph on a uniform
24x24 canvas in the brand's own colour, so the comparison cards render at one
consistent size — unlike full-logo services whose art has varying dimensions.
It needs no token and is served self-hosted after download (CSP unchanged).

Endpoint: https://cdn.simpleicons.org/<slug>  (brand-coloured SVG)

Usage (from the repo root):

    python scripts/fetch-icons.py            # fetch missing icons + rebuild
    python scripts/fetch-icons.py --force    # re-download everything

Simple Icons has dropped a few big brands for trademark reasons (Slack,
LinkedIn, Microsoft Teams, ...) and doesn't carry some niche apps. For those,
pass a logo.dev publishable token and the gaps are filled from logo.dev as PNGs
so every app has an icon; the CSS renders them all at one contained size.

    python scripts/fetch-icons.py --logodev-token pk_xxx
    # or set LOGODEV_TOKEN in the environment

Apps still without an icon keep their letter-avatar fallback. If an icon looks
wrong, fix its slug/domain below and re-run. Stdlib only — no dependencies.
"""

import argparse
import os
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "img" / "apps"

# app id (slug of the sheet's App Name) -> Simple Icons slug.
# Best-effort; a slug Simple Icons doesn't have just 404s and falls back to a
# letter-avatar. Fix any that look wrong and re-run.
SLUGS = {
    "whatsapp": "whatsapp",
    "facebook-messenger": "messenger",
    "telegram": "telegram",
    "apple-messages-imessage": "imessage",
    "google-messages-rcs": "googlemessages",
    "snapchat": "snapchat",
    "instagram-direct": "instagram",
    "discord": "discord",
    "microsoft-teams-personal": "microsoftteams",
    "slack": "slack",
    "viber": "viber",
    "threads-meta-dms": "threads",
    "x-twitter-dms-xchat": "x",
    "linkedin-messaging": "linkedin",
    "tiktok-messages": "tiktok",
    "reddit-chat": "reddit",
    "google-chat-workspace": "googlechat",
    "kik-messenger": "kik",
    "groupme": "groupme",
    "zoom-team-chat": "zoom",
    "signal": "signal",
    "threema": "threema",
    "wire": "wire",
    "session": "session",
    "element-matrix": "element",
    "wechat": "wechat",
    "line": "line",
    "kakaotalk": "kakaotalk",
    "zalo": "zalo",
    "imo": "imo",
    "rocket-chat": "rocketdotchat",
    "mattermost": "mattermost",
    "zulip": "zulip",
    "simplex-chat": "simplex",
    "olvid": "olvid",
    "briar": "briar",
    "jami": "jami",
    "tox-qtox": "tox",
    "status": "status",
    "silence": "silence",
    "ricochet-refresh": "ricochet",
    "conversations-xmpp": "xmpp",
    "nextcloud-talk": "nextcloud",
    "symphony": "symphony",
    "chanty": "chanty",
    "twist": "twist",
    "flock": "flock",
    "facebook-messenger-kids": "messenger",
    "google-voice": "googlevoice",
    "voxer": "voxer",
}

# Brands whose Simple Icons colour is near-black; on the dark icon tile they'd be
# invisible, so fetch them in a light tone instead (their real dark-mode look).
DARK_ICONS = {
    "conversations-xmpp", "session", "simplex-chat", "threads-meta-dms",
    "tiktok-messages", "wire", "x-twitter-dms-xchat",
}
LIGHT_TONE = "e6eaee"

# logo.dev domains, used only to fill icons Simple Icons doesn't carry.
DOMAINS = {
    "microsoft-teams-personal": "microsoft.com",
    "slack": "slack.com",
    "linkedin-messaging": "linkedin.com",
    "imo": "imo.im",
    "olvid": "olvid.io",
    "briar": "briarproject.org",
    "jami": "jami.net",
    "tox-qtox": "tox.chat",
    "status": "status.app",
    "silence": "silence.im",
    "ricochet-refresh": "ricochetrefresh.net",
    "chanty": "chanty.com",
    "twist": "twist.com",
    "flock": "flock.com",
    "google-voice": "google.com",
    "voxer": "voxer.com",
    "conversations-xmpp": "conversations.im",
    "symphony": "symphony.com",
    "session": "getsession.org",
    "zalo": "zalo.me",
    "kik-messenger": "kik.com",
    "groupme": "groupme.com",
    "simplex-chat": "simplex.chat",
    "zulip": "zulip.com",
}


def has_icon(app_id):
    return any((OUT_DIR / f"{app_id}.{ext}").exists() for ext in ("svg", "png"))


def fetch_logodev(app_id, domain, token, force):
    dest = OUT_DIR / f"{app_id}.png"
    if dest.exists() and not force:
        return "skip"
    url = f"https://img.logo.dev/{domain}?token={token}&size=128&format=png&retina=true"
    req = urllib.request.Request(url, headers={"User-Agent": "osl-fetch-icons"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
    except urllib.error.HTTPError as exc:
        return f"http {exc.code}"
    except Exception as exc:  # noqa: BLE001
        return f"error {exc}"
    if not data or len(data) < 200:
        return "empty"
    dest.write_bytes(data)
    return "ok"


def fetch(app_id, slug, force):
    dest = OUT_DIR / f"{app_id}.svg"
    if dest.exists() and not force:
        return "skip"
    # Near-black brands are fetched in a light tone so they read on dark tiles.
    url = f"https://cdn.simpleicons.org/{slug}/{LIGHT_TONE}" if app_id in DARK_ICONS \
        else f"https://cdn.simpleicons.org/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": "osl-fetch-icons"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
    except urllib.error.HTTPError as exc:
        return f"http {exc.code}"
    except Exception as exc:  # noqa: BLE001
        return f"error {exc}"
    if not data or b"<svg" not in data[:200]:
        return "not-svg"
    dest.write_bytes(data)
    return "ok"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="re-download existing icons")
    parser.add_argument("--no-build", action="store_true", help="skip the apps.json rebuild")
    parser.add_argument("--logodev-token", default=os.environ.get("LOGODEV_TOKEN"),
                        help="fill Simple Icons gaps from logo.dev with this pk_ token")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ok = skipped = missing = 0
    for app_id, slug in SLUGS.items():
        status = fetch(app_id, slug, args.force)
        if status == "ok":
            ok += 1
        elif status == "skip":
            skipped += 1
        else:
            missing += 1
    print(f"[fetch-icons] Simple Icons: saved {ok}, skipped {skipped}, unavailable {missing}")

    if args.logodev_token:
        filled = 0
        for app_id, domain in DOMAINS.items():
            if has_icon(app_id) and not args.force:
                continue
            status = fetch_logodev(app_id, domain, args.logodev_token, args.force)
            if status == "ok":
                filled += 1
            elif status != "skip":
                print(f"  - {app_id} ({domain}): {status}")
        print(f"[fetch-icons] logo.dev fallback: filled {filled} gaps")
    else:
        gaps = [a for a in SLUGS if not has_icon(a)]
        if gaps:
            print(f"[fetch-icons] {len(gaps)} apps still have no icon (letter-avatar). "
                  f"Pass --logodev-token pk_xxx to fill from logo.dev.")

    if not args.no_build:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build-comparison.py")], check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
