#!/usr/bin/env python3
"""Build assets/data/apps.json from chat_apps_comparison.xlsx.

This is the "convert Excel to JSON" step for the /compare page. The site has no
build step and no dependencies, and Node has no built-in .xlsx reader, so this
converter uses only the Python standard library (zipfile + ElementTree) to read
the workbook directly — nothing to install.

Usage (from the repo root):

    python scripts/build-comparison.py

Edit `chat_apps_comparison.xlsx` (sheet "Feature Matrix (Website)"), then re-run
to regenerate `assets/data/apps.json`. The page fetches that JSON at runtime.

Score mapping (from the sheet's own columns):
    overall  = TOTAL SCORE (/100)                              -> 0..100
    privacy  = Privacy & Security (/50)                x2      -> 0..100
    features = Core Messaging + Calls & Media + Platform (/40) x2.5 -> 0..100

Feature cells: "Yes" -> true, "Partial" -> "partial", anything else -> false.

OSL is NOT in the spreadsheet, so its baseline row is defined below (OSL_BASELINE)
— review and adjust it by hand; it is the column every app is compared against.
Logos are left null (the page renders letter-avatars); drop real logo files into
assets/img/apps/ and point each app's "logo" at them later.
"""

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "chat_apps_comparison.xlsx"
OUT = ROOT / "assets" / "data" / "apps.json"
SHEET_NAME = "Feature Matrix (Website)"

# Curated comparison rows: json key -> (exact sheet column header, short label).
FEATURES = [
    ("e2ee",           "E2EE Default (All Chats)",              "End-to-end encrypted by default"),
    ("open_source",    "Open-Source Client",                    "Open-source client"),
    ("audit",          "Independent Security Audit Published",  "Independent security audit"),
    ("no_phone",       "No Phone Number Required",              "No phone number required"),
    ("min_metadata",   "Minimal Metadata Collection",           "Minimal metadata collection"),
    ("self_host",      "Self-Hosting Option",                   "Self-hosting option"),
    ("disappearing",   "Disappearing Messages",                 "Disappearing messages"),
    ("group_chat",     "Group Chat",                            "Group chat"),
    ("file_sharing",   "File/Media Sharing",                    "File & media sharing"),
    ("video_calls",    "1:1 Video Calls",                       "Video calls"),
    ("cross_platform", "Cross-Platform (No Vendor Lock-In)",    "Cross-platform (no lock-in)"),
    ("no_data_sale",   "No Third-Party Data Sale",              "No third-party data sale"),
]

SCORE_COLS = {
    "total":    "TOTAL SCORE (/100)",
    "privacy":  "Privacy & Security (/50)",
    "core":     "Core Messaging (/20)",
    "calls":    "Calls & Media (/10)",
    "platform": "Platform & Accessibility (/10)",
}

# OSL is not in the spreadsheet, so this baseline is derived from brief.md on the
# same rubric as the other apps, using the "privacy layer over the apps you keep"
# basis: an OSL user retains their existing app's features AND gains OSL's
# privacy, so Features stays high (you lose nothing). Privacy is held to an
# honest level rather than a perfect 100: no published third-party audit yet,
# protection is an opt-in switch (not default-all), and the carrier still flows
# through the host platform, which sees timing/metadata (brief.md is explicit).
# Two feature caveats are kept truthful: no published independent audit, and no
# self-hostable server (OSL is local-first). Revisit once OSL ships/audits.
OSL_BASELINE = {
    "name": "OSL Privacy",
    "logo": "/assets/img/osl-app-icon-v2.png",
    "scores": {"overall": 90, "privacy": 88, "features": 92},
    "values": {
        "e2ee": True, "open_source": True, "audit": "partial", "no_phone": True,
        "min_metadata": True, "self_host": "partial", "disappearing": True,
        "group_chat": True, "file_sharing": True, "video_calls": True,
        "cross_platform": True, "no_data_sale": True,
    },
}


def col_to_idx(ref):
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def load_sheet(zf, shared):
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {
        r.get("Id"): r.get("Target")
        for r in rels.iter("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship")
    }
    target = None
    for s in wb.iter(f"{NS}sheet"):
        if s.get("name") == SHEET_NAME:
            rid = s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            target = rid_to_target.get(rid)
            break
    if not target:
        raise SystemExit(f"Sheet {SHEET_NAME!r} not found in workbook.")
    path = "xl/" + target.lstrip("/")
    root = ET.fromstring(zf.read(path))
    rows = []
    for row in root.iter(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            idx = col_to_idx(c.get("r"))
            t = c.get("t")
            v = c.find(f"{NS}v")
            inline = c.find(f"{NS}is")
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif inline is not None:
                val = "".join(x.text or "" for x in inline.iter(f"{NS}t"))
            elif v is not None:
                val = v.text
            else:
                val = ""
            cells[idx] = (val or "").strip()
        rows.append(cells)
    return rows


def read_shared_strings(zf):
    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    return shared


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "app"


def to_state(raw):
    v = (raw or "").strip().lower()
    if v == "yes":
        return True
    if v == "partial":
        return "partial"
    return False


def num(raw):
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def main():
    if not XLSX.exists():
        print(f"[build-comparison] {XLSX.name} not found; leaving {OUT.name} unchanged.")
        return 0

    with zipfile.ZipFile(XLSX) as zf:
        shared = read_shared_strings(zf)
        rows = load_sheet(zf, shared)

    if not rows:
        raise SystemExit("Sheet is empty.")

    header = rows[0]
    col = {name: idx for idx, name in header.items()}

    def require(name):
        if name not in col:
            raise SystemExit(f"Column {name!r} missing from the sheet header.")
        return col[name]

    feature_idx = [(key, require(hdr), label) for key, hdr, label in FEATURES]
    score_idx = {k: require(v) for k, v in SCORE_COLS.items()}
    name_idx = require("App Name")
    rank_idx = require("Rank")

    apps = []
    for r in rows[1:]:
        name = r.get(name_idx, "").strip()
        if not name or not r.get(rank_idx, "").strip():
            continue
        privacy = num(r.get(score_idx["privacy"]))
        featurepts = (
            num(r.get(score_idx["core"]))
            + num(r.get(score_idx["calls"]))
            + num(r.get(score_idx["platform"]))
        )
        total = num(r.get(score_idx["total"]))
        app_id = slug(name)
        # Use a fetched icon if present (SVG from Simple Icons preferred, then a
        # PNG), else the page renders a letter-avatar fallback (logo: null).
        icon_dir = ROOT / "assets" / "img" / "apps"
        logo = None
        for ext in ("svg", "png"):
            if (icon_dir / f"{app_id}.{ext}").exists():
                logo = f"/assets/img/apps/{app_id}.{ext}"
                break
        apps.append({
            "id": app_id,
            "name": name,
            "logo": logo,
            "scores": {
                "overall": round(total),
                "privacy": round(min(100, privacy * 2)),
                "features": round(min(100, featurepts * 2.5)),
            },
            "values": {key: to_state(r.get(idx)) for key, idx, _ in feature_idx},
        })

    out = {
        "features": [{"key": key, "label": label} for key, _, label in FEATURES],
        "osl": OSL_BASELINE,
        "apps": apps,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"[build-comparison] wrote {len(apps)} apps -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
