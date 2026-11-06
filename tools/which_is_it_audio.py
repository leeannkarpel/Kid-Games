#!/usr/bin/env python3
"""Generate and process the voice clips for "Which Is It? Haunted House".

Reads mr-mos-games/games/which-is-it/audio/manifest.json (built by tools/which_is_it_lines.js).
For each line whose mp3 is missing: one ElevenLabs take (eleven_v4), then
  - trim leading/trailing silence
  - normalize loudness (two-pass loudnorm, every clip to the same level)
  - save mono MP3 at 64 kbps
Safe to re-run: existing clips are skipped. Delete an mp3 to redo it.

Usage:
  python3 tools/which_is_it_audio.py --count
  python3 tools/which_is_it_audio.py [--jobs 4] [--limit N] [--lang en]
  python3 tools/which_is_it_audio.py --reprocess      # redo trim/loudness from kept raw takes

Raw takes are kept in tools/.cache/which-is-it-raw/ (outside the site folders, never deployed, git-ignored).
"""
import argparse, json, os, re, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_voice as gv  # tts() and add_shared_voice()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "mr-mos-games", "games", "which-is-it", "audio")
RAW = os.path.join(ROOT, "tools", ".cache", "which-is-it-raw")
TARGET_LUFS = -16.0
lock = threading.Lock()

TRIM = ("silenceremove=start_periods=1:start_duration=0.02:start_threshold=-48dB:detection=peak,"
        "areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-48dB:detection=peak,areverse,"
        "adelay=40:all=1,apad=pad_dur=0.08")


def process(raw, out):
    """trim -> measure loudness -> apply measured loudnorm (linear) -> mono 64k mp3"""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", raw, "-ac", "1", "-af",
                        f"{TRIM},loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)[-1])
    ln = (f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".part.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-ac", "1", "-af", f"{TRIM},{ln}", "-ar", "44100",
                    "-c:a", "libmp3lame", "-b:a", "64k", tmp], check=True)
    os.replace(tmp, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", action="store_true")
    ap.add_argument("--jobs", type=int, default=2)   # the plan allows 3 requests at once
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--lang")
    ap.add_argument("--reprocess", action="store_true")
    a = ap.parse_args()
    lines = json.load(open(os.path.join(AUDIO, "manifest.json"), encoding="utf-8"))["lines"]
    if a.lang:
        lines = [l for l in lines if l["lang"] == a.lang]

    if a.reprocess:
        for l in lines:
            raw = os.path.join(RAW, l["file"])
            if os.path.exists(raw):
                process(raw, os.path.join(AUDIO, l["file"]))
        print("reprocessed"); return

    todo = [l for l in lines if not os.path.exists(os.path.join(AUDIO, l["file"]))]
    chars = sum(len(l.get("say") or l["text"]) for l in todo)
    print(f"{len(todo)} clips to make, {chars} characters")
    if a.count:
        return
    if a.limit:
        todo = todo[: a.limit]
    added, fails, stop = set(), [], threading.Event()

    def one(l):
        if stop.is_set():
            return
        raw = os.path.join(RAW, l["file"])
        if not os.path.exists(raw):
            line = {"text": l.get("say") or l["text"], "lang": l["lang"], "voice_id": l["voice_id"]}
            st, data = gv.tts(line)
            for wait in (3, 6, 12, 24):          # busy (too many requests at once): wait and retry
                if st != 429 or b"quota" in data:
                    break
                time.sleep(wait); st, data = gv.tts(line)
            if st == 404:
                with lock:
                    if l["voice_id"] not in added:
                        added.add(l["voice_id"]); gv.add_shared_voice(l["voice_id"])
                st, data = gv.tts(line)
            if st != 200 or len(data) < 1000:
                with lock:
                    fails.append(l["file"]); print(f"  ERR {st} {l['file']}: {data[:200]!r}", flush=True)
                if st in (401, 402) or b"quota" in data:
                    stop.set()
                return
            os.makedirs(os.path.dirname(raw), exist_ok=True)
            open(raw, "wb").write(data)
        try:
            process(raw, os.path.join(AUDIO, l["file"]))
            with lock:
                print(f"  ok  {l['file']}", flush=True)
        except Exception as e:
            with lock:
                fails.append(l["file"]); print(f"  ERR process {l['file']}: {e}", flush=True)

    with ThreadPoolExecutor(a.jobs) as ex:
        list(ex.map(one, todo))
    print("done, failures:", len(fails), "(stopped early: account/quota problem)" if stop.is_set() else "")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
