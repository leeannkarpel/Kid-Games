#!/usr/bin/env python3
"""Generate the recorded voice clips for every game from its voice/manifest.json.

Usage:
  python3 tools/generate_voice.py --count            # show characters still to generate (no API calls)
  python3 tools/generate_voice.py [--batch 10] [--limit N] [--game math-race]

Clips that already exist are skipped, so it is safe to re-run. One take per line.
The API key comes from ELEVENLABS_API_KEY (sent as xi-api-key), or is attached by the network proxy.
"""
import argparse, glob, json, os, sys, time, urllib.request, urllib.error, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.elevenlabs.io"
MODEL = "eleven_v4"
FORMAT = "mp3_44100_128"


def headers(extra=None):
    h = {"Accept": "application/json"}
    key = os.environ.get("ELEVENLABS_API_KEY")
    if key:
        h["xi-api-key"] = key
    h.update(extra or {})
    return h


def request(method, path, body=None, accept=None):
    data = json.dumps(body).encode() if body is not None else None
    h = headers({"Content-Type": "application/json"} if data else None)
    if accept:
        h["Accept"] = accept
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def add_shared_voice(voice_id):
    """Add a voice from the shared voice library to the account by its ID."""
    st, raw = request("GET", "/v1/shared-voices?" + urllib.parse.urlencode({"voice_id": voice_id, "page_size": 100}))
    owner = None
    if st == 200:
        for v in json.loads(raw).get("voices", []):
            if v.get("voice_id") == voice_id:
                owner = v.get("public_owner_id"); name = v.get("name")
                break
    if not owner:
        print(f"  ! could not find {voice_id} in the shared library ({st})")
        return False
    st, raw = request("POST", f"/v1/voices/add/{owner}/{voice_id}", {"new_name": name})
    print(f"  + added shared voice {name} ({voice_id}): {st}")
    return st == 200


def manifests(game=None):
    for p in sorted(glob.glob(os.path.join(ROOT, "*", "games", "*", "voice", "manifest.json"))):
        if game and os.path.basename(os.path.dirname(os.path.dirname(p))) != game:
            continue
        yield p


def todo(game=None):
    out = []
    for p in manifests(game):
        m = json.load(open(p, encoding="utf-8"))
        d = os.path.dirname(p)
        for line in m["lines"]:
            f = os.path.join(d, line["file"])
            if not os.path.exists(f):
                out.append((p, line, f))
    return out


def tts(line):
    text = line.get("say") or line["text"]
    body = {"text": text, "model_id": MODEL}
    if line.get("lang"):
        body["language_code"] = line["lang"]
    path = f"/v1/text-to-speech/{line['voice_id']}?output_format={FORMAT}"
    st, raw = request("POST", path, body, accept="audio/mpeg")
    if st in (400, 422) and b"language" in raw.lower():
        body.pop("language_code", None)
        st, raw = request("POST", path, body, accept="audio/mpeg")
    return st, raw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", action="store_true")
    ap.add_argument("--batch", type=int, default=10)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--game")
    a = ap.parse_args()

    items = todo(a.game)
    if a.count:
        per = {}
        for p, line, _ in items:
            g = os.path.relpath(os.path.dirname(os.path.dirname(p)), ROOT)
            c = per.setdefault(g, [0, 0]); c[0] += 1; c[1] += len(line.get("say") or line["text"])
        for g, (n, ch) in per.items():
            print(f"{g:45s} {n:4d} clips {ch:6d} chars")
        print(f"{'TOTAL':45s} {sum(v[0] for v in per.values()):4d} clips {sum(v[1] for v in per.values()):6d} chars")
        return
    if a.limit:
        items = items[: a.limit]
    added = set(); failed = 0
    for i in range(0, len(items), a.batch):
        batch = items[i : i + a.batch]
        print(f"batch {i // a.batch + 1}: {len(batch)} clips")
        for p, line, f in batch:
            if os.path.exists(f):
                continue
            st, raw = tts(line)
            if st == 404 and line["voice_id"] not in added:
                added.add(line["voice_id"])
                if add_shared_voice(line["voice_id"]):
                    st, raw = tts(line)
            if st == 200 and raw[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2") or (st == 200 and len(raw) > 1000):
                os.makedirs(os.path.dirname(f), exist_ok=True)
                tmp = f + ".part"
                open(tmp, "wb").write(raw); os.replace(tmp, f)
                print(f"  ok  {os.path.relpath(f, ROOT)}")
            else:
                failed += 1
                print(f"  ERR {st} {os.path.relpath(f, ROOT)}: {raw[:300]!r}")
                if st in (401, 402, 429) or b"quota" in raw:
                    print("stopping: account/quota problem"); sys.exit(1)
        time.sleep(0.5)
    print("done, failures:", failed)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
