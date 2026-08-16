#!/usr/bin/env python3
"""
Generate the artwork the shipped sheets never contained, with Gemini.

Two documented gaps:
  --jump        a real jump cycle. The game currently fakes five stages from
                three shipped poses with squash and stretch; drawn legs beat it.
  --foreground  a purpose-drawn foreground parallax layer, currently a
                darkened restyle of the mid layer.

Both run at BUILD time and the output is committed. The browser never sees a
key. Nothing here is required: if the generated frames are absent the game
falls back to what it does today, so this is a pure upgrade.

    export GOOGLE_API_KEY=...            # or put it in .env
    python3 tools/art_gen.py --jump
    python3 tools/art_gen.py --foreground
    python3 tools/art_gen.py --all --dry-run

Two things the model cannot do for us, handled here instead:

1. TRANSPARENCY. Image models return opaque images. So every asset is
   generated on a flat magenta field and chroma-keyed out, with a despill pass
   to kill the purple fringe that keying always leaves behind.

2. CONSISTENCY. A jump cycle has to be the SAME dog in every frame, matching
   art that already shipped. Each request therefore carries an existing sprite
   as a reference image, rather than relying on the prompt alone.

Anchors are computed from the pixels (feet centroid), not assumed - the whole
renderer positions sprites by anchor, so a guessed one would misplace the dog
on every ledge.
"""
import argparse
import base64
import io as _io
import json
import os
import sys
import urllib.error
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ROOT, "assets", "sprites")
GEN = os.path.join(ROOT, "images", "generated")
ANCHORS = os.path.join(SPR, "generated_anchors.json")

MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")
URL = "https://generativelanguage.googleapis.com/v1beta/interactions"

# Flat key colour. Magenta is chosen because nothing in this art style is
# magenta - the dog is brown and cream, the mountains grey and green - so the
# key cannot eat any of the subject.
KEY_RGB = (255, 0, 255)
KEY_NAME = "pure magenta (RGB 255, 0, 255)"

STYLE = (
    "Cartoon mobile-game sprite art. Thick dark outlines, flat cel shading, "
    "warm saturated colours, clean vector-like edges. Matches the reference "
    "image exactly in style, proportion, colour and line weight. "
    f"The background must be a completely flat, solid field of {KEY_NAME}, "
    "with no gradient, no shadow, no texture and no vignette. "
    "The subject must not contain any magenta or purple."
)

# One entry per frame of the leap. Progress values mirror the stages in
# src/render/dogAnim.js so the animation maps straight onto them.
JUMP_FRAMES = [
    ("dog_leap_0", "crouched low, coiled, front paws braced, about to spring upward"),
    ("dog_leap_1", "launching upward, body stretched long, front legs reaching forward, back legs extended straight behind"),
    ("dog_leap_2", "at the top of the arc, body level, all four legs tucked under the belly"),
    ("dog_leap_3", "falling, nose angled down, front paws reaching forward to land, back legs trailing"),
    ("dog_leap_4", "landing, front paws planted, body compressed, back legs catching up"),
]
JUMP_SUBJECT = (
    "A small fluffy cartoon corgi puppy with brown and cream fur, big friendly "
    "eyes and a happy open mouth, seen from the side, facing LEFT. "
    "Full body, centred, filling most of the frame."
)


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


def b64(path):
    with open(path, "rb") as fh:
        return base64.b64encode(fh.read()).decode("ascii")


def find_image(node):
    """Pull base64 image data out of the response, whatever shape it arrives in.

    The image APIs have moved between `generateContent` (inlineData parts) and
    `interactions` (output_image), so this walks the JSON for the first field
    that looks like image bytes instead of hard-coding one path and breaking on
    the next revision.
    """
    if isinstance(node, dict):
        for key in ("output_image", "outputImage", "inline_data", "inlineData"):
            v = node.get(key)
            if isinstance(v, dict) and isinstance(v.get("data"), str):
                return v["data"]
        if isinstance(node.get("data"), str) and len(node["data"]) > 2048:
            return node["data"]
        for v in node.values():
            got = find_image(v)
            if got:
                return got
    elif isinstance(node, list):
        for v in node:
            got = find_image(v)
            if got:
                return got
    return None


def generate(prompt, key, ref_path=None, aspect="1:1", size="2K"):
    payload = {
        "model": MODEL,
        "input": [{"type": "text", "text": prompt}],
        "response_format": {"type": "image", "mime_type": "image/png",
                            "aspect_ratio": aspect, "image_size": size},
    }
    if ref_path:
        payload["input"].append({"type": "image", "mime_type": "image/png",
                                 "data": b64(ref_path)})
    req = urllib.request.Request(
        f"{URL}?key={key}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        body = json.loads(urllib.request.urlopen(req, timeout=240).read())
    except urllib.error.HTTPError as e:
        print(f"  FAIL: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:300]}",
              file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"  FAIL: {e.reason}", file=sys.stderr)
        return None

    data = find_image(body)
    if not data:
        print(f"  FAIL: no image in response. Shape: "
              f"{json.dumps(body)[:400]}", file=sys.stderr)
        return None
    return Image.open(_io.BytesIO(base64.b64decode(data))).convert("RGBA")


# ---------------------------------------------------------------------------
# chroma key
# ---------------------------------------------------------------------------
def key_magenta(img, lo=40, hi=110, despill=True):
    """Cut the flat magenta field to alpha and remove its colour fringe.

    "Magenta-ness" is min(R,B) - G: high where both red and blue dominate green,
    which is true of the key and of nothing in this art. A soft ramp keeps the
    subject's anti-aliased edge intact instead of producing a jagged cut-out.
    """
    a = np.array(img.convert("RGBA")).astype(float)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(R, B) - G
    alpha = np.clip((hi - m) / (hi - lo), 0.0, 1.0)
    a[..., 3] *= alpha

    if despill:
        # Edge pixels blend toward the key, leaving a purple rim. Pull R and B
        # down to G wherever magenta still shows through.
        spill = np.clip(m / hi, 0.0, 1.0) * (alpha > 0)
        a[..., 0] = a[..., 0] * (1 - spill) + G * spill
        a[..., 2] = a[..., 2] * (1 - spill) + G * spill
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def clean(img, min_alpha=8):
    """Trim to the alpha bbox and drop near-transparent dust from keying."""
    a = np.array(img).astype(float)
    a[..., 3][a[..., 3] < min_alpha] = 0
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    box = img.getbbox()
    return img.crop(box) if box else img


def foot_anchor(img):
    """Anchor at the feet: bottom of the silhouette, centred on what touches it.

    Assuming a fixed anchor would misplace the dog on every ledge, because the
    generated pose decides where its own feet are.
    """
    a = np.array(img.getchannel("A"))
    ys, xs = np.where(a > 40)
    if not len(ys):
        return [0.5, 0.95]
    bottom = ys.max()
    band = ys >= bottom - max(2, int(img.height * 0.10))
    cx = xs[band].mean() / img.width
    return [round(float(cx), 4), round(float((bottom + 1) / img.height), 4)]


def save_sprite(img, name, target_h=None):
    img = clean(key_magenta(img))
    if target_h:
        s = target_h / img.height
        img = img.resize((max(1, int(img.width * s)), target_h), Image.LANCZOS)
    # a 1px feather hides any residual key stairstep
    a = np.array(img).astype(float)
    edge = Image.fromarray(a[..., 3].astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(0.6))
    a[..., 3] = np.minimum(a[..., 3], np.array(edge).astype(float) * 1.08)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")

    dest = os.path.join(SPR, name + ".png")
    img.save(dest)
    anchor = foot_anchor(img)
    print(f"  ok   {name:12s} {img.width}x{img.height}  anchor {anchor}")
    return anchor


def merge_anchors(new):
    cur = {}
    if os.path.exists(ANCHORS):
        with open(ANCHORS, encoding="utf-8") as fh:
            cur = json.load(fh)
    cur.update(new)
    with open(ANCHORS, "w", encoding="utf-8") as fh:
        json.dump(cur, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"anchors -> {os.path.relpath(ANCHORS, ROOT)} ({len(cur)} frames)")


# ---------------------------------------------------------------------------
def do_jump(key, dry, force):
    ref = os.path.join(SPR, "dog_idle.png")
    if not os.path.exists(ref):
        print("  dog_idle.png missing - run tools/slice.py first", file=sys.stderr)
        return {}
    # match the shipped frames' native height so nothing changes scale on screen
    target_h = Image.open(ref).height
    anchors = {}
    for name, pose in JUMP_FRAMES:
        dest = os.path.join(SPR, name + ".png")
        if os.path.exists(dest) and not force:
            print(f"  skip {name:12s} (exists; --force to redo)")
            continue
        prompt = (f"{JUMP_SUBJECT} The puppy is {pose}. {STYLE} "
                  "Single character, no ground, no scenery, no text.")
        if dry:
            print(f"  [dry] {name:12s} {pose[:58]}...")
            continue
        img = generate(prompt, key, ref_path=ref, aspect="1:1")
        if img:
            anchors[name] = save_sprite(img, name, target_h)
    return anchors


def do_foreground(key, dry, force):
    os.makedirs(GEN, exist_ok=True)
    dest = os.path.join(GEN, "foreground.png")
    if os.path.exists(dest) and not force:
        print("  skip foreground (exists; --force to redo)")
        return
    prompt = (
        "A dark forest silhouette band for the FOREGROUND layer of a "
        "side-scrolling cartoon game: the tops of pine trees and rocky "
        "outcrops along the bottom, seen close to the camera. Very dark and "
        "cool-toned, almost a silhouette, low detail, slightly out of focus. "
        "The whole upper area must be flat solid " + KEY_NAME + " with the "
        "treeline reaching about one third up the image. " + STYLE +
        " No sky, no clouds, no characters, no text."
    )
    if dry:
        print("  [dry] foreground  wide dark treeline band, 21:9")
        return
    img = generate(prompt, key, aspect="21:9")
    if img:
        out = clean(key_magenta(img))
        out.save(dest)
        print(f"  ok   foreground  {out.width}x{out.height} -> "
              f"{os.path.relpath(dest, ROOT)}")
        print("       run tools/derive.py to fold it into the parallax stack")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jump", action="store_true")
    ap.add_argument("--foreground", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not (args.jump or args.foreground or args.all):
        ap.error("pick --jump, --foreground or --all")

    load_dotenv()
    key = os.environ.get("GOOGLE_API_KEY", "").strip()
    dry = args.dry_run or not key
    if dry and not args.dry_run:
        print("GOOGLE_API_KEY not set - dry run.\n"
              "Set it in .env (see .env.example) to generate for real.\n")
    print(f"model: {MODEL}\n")

    anchors = {}
    if args.jump or args.all:
        print("== jump cycle ==")
        anchors.update(do_jump(key, dry, args.force) or {})
    if args.foreground or args.all:
        print("== foreground layer ==")
        do_foreground(key, dry, args.force)

    if anchors:
        merge_anchors(anchors)
        print("\nnow run: python3 tools/pack.py   (and tools/derive.py if the "
              "foreground changed)")
    elif dry:
        print("\nnothing written (dry run)")


if __name__ == "__main__":
    main()
