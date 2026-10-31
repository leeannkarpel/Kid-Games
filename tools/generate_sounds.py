#!/usr/bin/env python3
"""Generate sound effects for any game with a sounds/manifest.json (ElevenLabs sound generation).

Usage:
  python3 tools/generate_sounds.py [--game kitty-taps]

Each manifest entry needs "file", "prompt" and "duration" (seconds). Files that already exist are
skipped, so it is safe to re-run. To redo one, delete its mp3 and run again.
The API key comes from ELEVENLABS_API_KEY (sent as xi-api-key), or is attached by the network proxy.
"""
import argparse, glob, json, os, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"


def generate(entry):
    body = json.dumps({"text": entry["prompt"], "duration_seconds": entry["duration"],
                       "prompt_influence": entry.get("prompt_influence", 0.6)}).encode()
    h = {"Content-Type": "application/json", "Accept": "audio/mpeg"}
    if os.environ.get("ELEVENLABS_API_KEY"):
        h["xi-api-key"] = os.environ["ELEVENLABS_API_KEY"]
    req = urllib.request.Request(API, data=body, method="POST", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game")
    a = ap.parse_args()
    bad = 0
    for p in sorted(glob.glob(os.path.join(ROOT, "*", "games", "*", "sounds", "manifest.json"))):
        if a.game and os.path.basename(os.path.dirname(os.path.dirname(p))) != a.game:
            continue
        d = os.path.dirname(p)
        for e in json.load(open(p, encoding="utf-8"))["sounds"]:
            f = os.path.join(d, e["file"])
            if os.path.exists(f):
                continue
            st, raw = generate(e)
            if st == 200 and raw[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3"):
                open(f, "wb").write(raw)
                print(f"  ok {os.path.relpath(f, ROOT)} ({len(raw)} bytes)")
            else:
                bad += 1
                print(f"  ! {e['file']}: {st} {raw[:200]!r}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
