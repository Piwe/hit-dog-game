#!/usr/bin/env python3
"""
Generate the game's audio with ElevenLabs.

The game ships with procedurally synthesised WebAudio effects so it is never
silent. This replaces them with real sound, generated once at BUILD time and
committed - the browser never sees an API key, and the game stays a static,
keyless, offline page. Never call these APIs from the client.

    export ELEVENLABS_API_KEY=...        # or put it in .env
    python3 tools/audio_gen.py           # generate anything missing
    python3 tools/audio_gen.py --force   # regenerate everything
    python3 tools/audio_gen.py --only burst
    python3 tools/audio_gen.py --dry-run # show the plan, call nothing

Without a key it runs as a dry run, so the pipeline is verifiable before you
have credentials.

Outputs assets/audio/*.mp3 plus assets/audio/manifest.json. The manifest lists
only files that actually exist, and core/audio.js falls back to synthesis for
any cue that is missing - so a partial generation is always safe to ship.

APIs (verified against ElevenLabs docs, Aug 2026):
  sound effects  POST https://api.elevenlabs.io/v1/sound-generation
                 model eleven_text_to_sound_v2, duration 0.5-30s, loop flag
  music          POST https://api.elevenlabs.io/v1/music
                 music_length_ms 3000-600000, force_instrumental, seed
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "audio")

SFX_URL = "https://api.elevenlabs.io/v1/sound-generation"
MUSIC_URL = "https://api.elevenlabs.io/v1/music"
OUTPUT_FORMAT = "mp3_44100_128"

# One entry per cue in core/audio.js. Keys MUST match the SFX map there.
#
# Prompt notes: these are effects heard dozens of times a minute, so they are
# written to be short, dry and close-mic'd. Reverb and musical tails smear
# together at this repetition rate and turn into mush.
SFX = {
    "jump": dict(
        seconds=0.6,
        text="Small cartoon dog springing off a stone ledge. Short soft paw "
             "push with a light whoosh. Dry, close, playful. No music.",
    ),
    "land": dict(
        seconds=0.5,
        text="Small animal landing on a stone ledge. Quick soft paw thud with "
             "a few tiny gravel bits scattering. Dry and close. No music.",
    ),
    "hotdog": dict(
        seconds=0.6,
        text="Bright cheerful arcade pickup chime. Two quick ascending notes, "
             "clean and short, collectible reward. No reverb tail.",
    ),
    "escape": dict(
        seconds=0.9,
        text="Triumphant quick rising swoosh with a sparkle at the top. The "
             "sound of a narrow escape. Short, bright, playful.",
    ),
    # The single most important cue: this is the AUDIO half of the vent
    # telegraph, the warning for players who miss the visual buildup. It must
    # rise clearly so its direction is unmistakable.
    "hiss": dict(
        seconds=1.4,
        text="Pressure building inside a geyser before it erupts. Low rumble "
             "swelling into a sharp rising steam hiss. Tense, building, "
             "clearly increasing in pitch and intensity. No music.",
    ),
    "burst": dict(
        seconds=1.2,
        text="Sudden geyser eruption. Explosive blast of steam with a whoosh "
             "of fire, powerful and percussive, quick tail. No music.",
    ),
    "hit": dict(
        seconds=1.0,
        text="Comedic cartoon character blasted by a jet of hot steam. Singed "
             "impact with a short descending yelp. Funny, not gory. Short.",
    ),
    "summit": dict(
        seconds=2.5,
        text="Short triumphant victory fanfare. Warm brass and bright bells, "
             "cheerful and celebratory, resolving cleanly.",
    ),
}

# Ambient bed. Uses the sound-effects endpoint with loop=true, which is built
# for seamless looping; the music endpoint composes a finished piece and does
# not guarantee a clean loop point.
AMBIENCE = dict(
    seconds=12.0,
    loop=True,
    text="Gentle high-altitude mountain wind with distant airy space. Soft, "
         "continuous, seamless, no melody, no percussion. Background bed.",
)

MUSIC = dict(
    length_ms=45000,
    seed=20260815,          # reproducible-ish across regenerations
    prompt="Upbeat playful adventure music for a cartoon mountain-climbing "
           "game. Light orchestral strings with marimba and soft percussion, "
           "bouncy and optimistic, steady tempo, instrumental, loops well.",
)


def load_dotenv():
    """Minimal .env reader so the key never has to live in the shell profile."""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def post(url, key, payload, query=""):
    req = urllib.request.Request(
        url + query,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "xi-api-key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def generate(name, payload, url, key, dry, query=""):
    dest = os.path.join(OUT, name + ".mp3")
    if dry:
        print(f"  [dry] {name:8s} -> {os.path.relpath(dest, ROOT)}")
        print(f"        POST {url}{query}")
        print(f"        {json.dumps(payload)[:150]}...")
        return False
    try:
        audio = post(url, key, payload, query)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        print(f"  FAIL {name}: HTTP {e.code} {body}", file=sys.stderr)
        return False
    except urllib.error.URLError as e:
        print(f"  FAIL {name}: {e.reason}", file=sys.stderr)
        return False
    with open(dest, "wb") as fh:
        fh.write(audio)
    print(f"  ok   {name:8s} {len(audio) / 1024:7.1f} KB")
    return True


def write_manifest():
    """List only what exists. Missing cues fall back to synthesis in game."""
    entries = {}
    for name in list(SFX) + ["ambience"]:
        if os.path.exists(os.path.join(OUT, name + ".mp3")):
            entries[name] = f"{name}.mp3"
    music = {}
    if os.path.exists(os.path.join(OUT, "music.mp3")):
        music["climb"] = "music.mp3"

    path = os.path.join(OUT, "manifest.json")
    if not entries and not music:
        if os.path.exists(path):
            os.remove(path)
        print("no audio present - game will use synthesised fallback")
        return
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "sfx": entries, "music": music}, fh, indent=2)
    print(f"manifest -> {len(entries)} sfx, {len(music)} music track(s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="regenerate existing files")
    ap.add_argument("--only", help="generate a single cue by name")
    ap.add_argument("--dry-run", action="store_true", help="print the plan only")
    ap.add_argument("--no-music", action="store_true", help="skip the music track")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    load_dotenv()
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    dry = args.dry_run or not key

    if dry and not args.dry_run:
        print("ELEVENLABS_API_KEY not set - dry run.\n"
              "Set it in .env (see .env.example) to generate for real.\n")

    query = f"?output_format={OUTPUT_FORMAT}"
    made = 0

    jobs = dict(SFX)
    jobs["ambience"] = AMBIENCE
    for name, spec in jobs.items():
        if args.only and args.only != name:
            continue
        if not args.force and os.path.exists(os.path.join(OUT, name + ".mp3")):
            print(f"  skip {name:8s} (exists; --force to redo)")
            continue
        payload = {
            "text": spec["text"],
            "model_id": "eleven_text_to_sound_v2",
            "duration_seconds": spec["seconds"],
            "prompt_influence": 0.45,
        }
        if spec.get("loop"):
            payload["loop"] = True
        made += generate(name, payload, SFX_URL, key, dry, query)

    want_music = not args.no_music and (not args.only or args.only == "music")
    if want_music:
        exists = os.path.exists(os.path.join(OUT, "music.mp3"))
        if exists and not args.force:
            print("  skip music    (exists; --force to redo)")
        else:
            payload = {
                "prompt": MUSIC["prompt"],
                "music_length_ms": MUSIC["length_ms"],
                "model_id": "music_v2",
                "force_instrumental": True,
                "seed": MUSIC["seed"],
            }
            made += generate("music", payload, MUSIC_URL, key, dry, query)

    write_manifest()
    if dry:
        print("\nnothing written (dry run)")
    else:
        print(f"\n{made} file(s) generated -> assets/audio/")


if __name__ == "__main__":
    main()
