#!/usr/bin/env python3
"""Generate background music for any game with a music/manifest.json (ElevenLabs Music).

Usage:
  python3 tools/generate_music.py [--game math-race]

Each manifest entry needs "file", "prompt" and "seconds". Tracks are instrumental. Files that
already exist are skipped, so it is safe to re-run. To redo one, delete its mp3 and run again.
The API key comes from ELEVENLABS_API_KEY (sent as xi-api-key), or is attached by the network proxy.
"""
import argparse, glob, json, os, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128"


def generate(entry):
    body = json.dumps({"prompt": entry["prompt"], "music_length_ms": int(entry["seconds"] * 1000),
                       "model_id": "music_v1", "force_instrumental": True}).encode()
    h = {"Content-Type": "application/json", "Accept": "audio/mpeg"}
    if os.environ.get("ELEVENLABS_API_KEY"):
        h["xi-api-key"] = os.environ["ELEVENLABS_API_KEY"]
    req = urllib.request.Request(API, data=body, method="POST", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game")
    a = ap.parse_args()
    bad = 0
    for p in sorted(glob.glob(os.path.join(ROOT, "*", "games", "*", "music", "manifest.json"))):
        if a.game and os.path.basename(os.path.dirname(os.path.dirname(p))) != a.game:
            continue
        d = os.path.dirname(p)
        for e in json.load(open(p, encoding="utf-8"))["tracks"]:
            f = os.path.join(d, e["file"])
            if os.path.exists(f):
                continue
            st, raw = generate(e)
            if st == 200 and len(raw) > 10000:
                open(f, "wb").write(raw)
                print(f"  ok {os.path.relpath(f, ROOT)} ({len(raw)} bytes)")
            else:
                bad += 1
                print(f"  ! {e['file']}: {st} {raw[:300]!r}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
