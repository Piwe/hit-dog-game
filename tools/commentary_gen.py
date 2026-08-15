#!/usr/bin/env python3
"""
Build the AI commentator: Gemini writes the lines, ElevenLabs speaks them.

Three independent stages, so each is useful on its own and none is required:

    python3 tools/commentary_gen.py            # sync text -> game. NO KEY NEEDED.
    python3 tools/commentary_gen.py --lines    # Gemini rewrites the line bank
    python3 tools/commentary_gen.py --voice    # ElevenLabs voices every line
    python3 tools/commentary_gen.py --all      # lines, then voice, then sync

The default (sync) copies tools/commentary_lines.json into the game's manifest
with no audio attached, so the commentator works offline out of the box - it
shows captions instead of speaking. Voicing then fills the audio in, and the
game upgrades with no code change.

Everything runs at BUILD time and is committed. The browser never sees a key.

APIs (verified against docs, Aug 2026):
  Gemini      POST generativelanguage.googleapis.com/v1beta/models/M:generateContent
              ?key=...  with responseMimeType/responseSchema for structured JSON
  ElevenLabs  POST api.elevenlabs.io/v1/text-to-speech/{voice_id}
              GET  api.elevenlabs.io/v1/voices   (to pick a default voice)
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINES_PATH = os.path.join(ROOT, "tools", "commentary_lines.json")
AUDIO = os.path.join(ROOT, "assets", "audio")
VO = os.path.join(AUDIO, "vo")
MANIFEST = os.path.join(AUDIO, "commentary.json")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.7-flash")
GEMINI_URL = ("https://generativelanguage.googleapis.com/v1beta/models/"
              "{model}:generateContent?key={key}")
TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128"
VOICES_URL = "https://api.elevenlabs.io/v1/voices"

# When each category fires, so the prompt can write to the moment rather than
# producing generic filler. Mirrors src/core/commentator.js.
CATEGORIES = {
    "start":    ("the run begins at the bottom of the mountain", 5),
    "escape":   ("the dog lands next to a vent that erupts a moment later - a near miss", 6),
    "hit":      ("the dog is caught by a steam burst, loses agility and drops two ledges", 6),
    "streak":   ("six ledges climbed without being hit", 5),
    "half":     ("halfway up the mountain", 3),
    "near":     ("five ledges from the summit", 3),
    "summit":   ("the dog reaches the top and earns a trophy and a red cape", 4),
    "struggle": ("the dog has been hit repeatedly and is slow and struggling", 4),
}


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def http(url, *, headers=None, payload=None, method="GET", timeout=120):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def read_lines():
    with open(LINES_PATH, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# stage 1: Gemini writes the bank
# ---------------------------------------------------------------------------
def generate_lines(key, dry):
    schema = {
        "type": "object",
        "properties": {c: {"type": "array", "items": {"type": "string"}}
                       for c in CATEGORIES},
        "required": list(CATEGORIES),
    }
    moments = "\n".join(f"- {c}: {desc} (write {n} lines)"
                        for c, (desc, n) in CATEGORIES.items())
    prompt = (
        "You are writing voice-over lines for the commentator of a cartoon "
        "browser game. A small dog climbs between two mountains, jumping left "
        "or right between ledges, dodging steam vents that erupt from clouds.\n\n"
        "Write short spoken lines for each moment below.\n\n" + moments + "\n\n"
        "Rules:\n"
        "- Maximum 8 words per line. They are spoken over gameplay.\n"
        "- Warm, excitable sports-commentator energy. Affectionate toward the dog.\n"
        "- Never insulting or mean, even on a failure. Blame the mountain.\n"
        "- No emoji, no stage directions, no speaker names, no quotation marks.\n"
        "- Plain sentences a text-to-speech voice can read naturally.\n"
        "- Vary the rhythm; do not start every line the same way.\n"
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 1.0,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    url = GEMINI_URL.format(model=GEMINI_MODEL, key=key or "MISSING")

    if dry:
        print(f"  [dry] POST {url.replace(key, '***') if key else url}")
        print(f"        model {GEMINI_MODEL}, structured JSON, "
              f"{sum(n for _, n in CATEGORIES.values())} lines across "
              f"{len(CATEGORIES)} categories")
        return None

    try:
        raw = http(url, headers={"Content-Type": "application/json"},
                   payload=payload, method="POST")
    except urllib.error.HTTPError as e:
        print(f"  FAIL gemini: HTTP {e.code} "
              f"{e.read().decode('utf-8', 'replace')[:300]}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"  FAIL gemini: {e.reason}", file=sys.stderr)
        return None

    body = json.loads(raw)
    try:
        text = body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        print(f"  FAIL gemini: unexpected response {json.dumps(body)[:300]}",
              file=sys.stderr)
        return None

    cats = json.loads(text)
    cleaned = {}
    for c in CATEGORIES:
        lines = [re.sub(r'\s+', ' ', s).strip().strip('"')
                 for s in cats.get(c, []) if s and s.strip()]
        # dedupe, keep order
        seen, out = set(), []
        for s in lines:
            if s.lower() not in seen:
                seen.add(s.lower())
                out.append(s)
        cleaned[c] = out
        print(f"  ok   {c:9s} {len(out)} lines")
    return cleaned


def write_lines_file(cats):
    doc = read_lines()
    doc["categories"] = cats
    with open(LINES_PATH, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=True)
        fh.write("\n")
    print(f"lines -> {os.path.relpath(LINES_PATH, ROOT)}")


# ---------------------------------------------------------------------------
# stage 2: ElevenLabs speaks them
# ---------------------------------------------------------------------------
def pick_voice(key, dry):
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
    if voice:
        return voice
    if dry:
        print("  [dry] GET /v1/voices -> would use the first available voice")
        return "AUTO"
    try:
        body = json.loads(http(VOICES_URL, headers={"xi-api-key": key}))
        v = body["voices"][0]
        print(f"  voice: {v.get('name')} ({v['voice_id']}) "
              f"- set ELEVENLABS_VOICE_ID to pin a different one")
        return v["voice_id"]
    except Exception as e:                      # noqa: BLE001 - report and stop
        print(f"  FAIL listing voices: {e}", file=sys.stderr)
        return None


def slug(cat, i):
    return f"{cat}_{i:02d}"


def voice_lines(cats, key, dry, force):
    os.makedirs(VO, exist_ok=True)
    voice = pick_voice(key, dry)
    if not voice:
        return 0
    made = 0
    for cat, lines in cats.items():
        for i, text in enumerate(lines):
            name = slug(cat, i)
            dest = os.path.join(VO, name + ".mp3")
            if os.path.exists(dest) and not force:
                continue
            url = TTS_URL.format(voice=voice)
            payload = {
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {
                    "stability": 0.45,        # a little variation suits a commentator
                    "similarity_boost": 0.75,
                    "style": 0.35,
                    "use_speaker_boost": True,
                },
            }
            if dry:
                print(f'  [dry] {name:12s} "{text}"')
                continue
            try:
                audio = http(url, headers={"Content-Type": "application/json",
                                           "xi-api-key": key},
                             payload=payload, method="POST", timeout=180)
            except urllib.error.HTTPError as e:
                print(f"  FAIL {name}: HTTP {e.code} "
                      f"{e.read().decode('utf-8', 'replace')[:200]}", file=sys.stderr)
                continue
            with open(dest, "wb") as fh:
                fh.write(audio)
            print(f"  ok   {name:12s} {len(audio) / 1024:6.1f} KB  \"{text}\"")
            made += 1
    return made


# ---------------------------------------------------------------------------
# stage 3: sync into the game manifest (no API, always safe)
# ---------------------------------------------------------------------------
def sync(cats):
    os.makedirs(AUDIO, exist_ok=True)
    out, voiced = {}, 0
    for cat, lines in cats.items():
        entries = []
        for i, text in enumerate(lines):
            rel = f"vo/{slug(cat, i)}.mp3"
            has = os.path.exists(os.path.join(AUDIO, rel))
            voiced += has
            # file stays null until voiced; the game shows the caption either
            # way, so an unvoiced bank is fully playable
            entries.append({"text": text, "file": rel if has else None})
        out[cat] = entries

    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "categories": out}, fh, indent=2)
        fh.write("\n")
    total = sum(len(v) for v in out.values())
    print(f"manifest -> {os.path.relpath(MANIFEST, ROOT)} "
          f"({total} lines, {voiced} voiced)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", action="store_true", help="regenerate text with Gemini")
    ap.add_argument("--voice", action="store_true", help="voice the lines with ElevenLabs")
    ap.add_argument("--all", action="store_true", help="lines, then voice, then sync")
    ap.add_argument("--force", action="store_true", help="re-voice existing clips")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, call nothing")
    args = ap.parse_args()

    load_dotenv()
    do_lines = args.lines or args.all
    do_voice = args.voice or args.all

    if do_lines:
        gkey = os.environ.get("GOOGLE_API_KEY", "").strip()
        dry = args.dry_run or not gkey
        if dry and not args.dry_run:
            print("GOOGLE_API_KEY not set - dry run for the Gemini stage.\n")
        print("== Gemini: writing lines ==")
        cats = generate_lines(gkey, dry)
        if cats:
            write_lines_file(cats)

    doc = read_lines()
    cats = doc["categories"]

    if do_voice:
        ekey = os.environ.get("ELEVENLABS_API_KEY", "").strip()
        dry = args.dry_run or not ekey
        if dry and not args.dry_run:
            print("\nELEVENLABS_API_KEY not set - dry run for the voice stage.\n")
        print("== ElevenLabs: voicing lines ==")
        voice_lines(cats, ekey, dry, args.force)

    print("== sync ==")
    sync(cats)


if __name__ == "__main__":
    main()
