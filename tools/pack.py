#!/usr/bin/env python3
"""
Pack every sprite into the single atlas the game loads.

Runs last in the pipeline (slice -> derive -> pack) so it sees both the cut
sprites and the derived ones. Splitting packing out of slice.py is what keeps
atlas.json authoritative - otherwise the vent ramp, ledge and wall exist on
disk but are invisible to the renderer.

    python3 tools/pack.py

Tiling textures are deliberately excluded: an atlas samples neighbouring
frames at the edges, which shows up as bleeding seams on a repeated texture.
Those ship as standalone images.
"""
import json
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice import FRAMES, shelf_pack  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ROOT, "assets", "sprites")

# must tile, so they cannot live in an atlas
STANDALONE = {"wall_rock"}

# anchors for sprites derive.py creates; the cut sprites bring their own
DERIVED_ANCHORS = {
    "vent_idle":    (0.50, 0.95),
    "vent_build_1": (0.50, 0.95),
    "vent_build_2": (0.50, 0.95),
    "vent_burst":   (0.50, 0.95),
    "vent_cool_1":  (0.50, 0.95),
    "vent_cool_2":  (0.50, 0.95),
    "ledge":        (0.50, 0.30),
}


def main():
    anchors = {name: tuple(a) for name, _s, _r, a in FRAMES}
    anchors.update(DERIVED_ANCHORS)

    names = sorted(n[:-4] for n in os.listdir(SPR) if n.endswith(".png"))
    names = [n for n in names if n not in STANDALONE]

    missing = [n for n in names if n not in anchors]
    if missing:
        print("WARNING: no anchor declared, defaulting to centre:", ", ".join(missing))

    imgs = [Image.open(os.path.join(SPR, n + ".png")).convert("RGBA") for n in names]
    places, pw, ph = shelf_pack([im.size for im in imgs])

    atlas = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    frames = {}
    for n, im, (px, py) in zip(names, imgs, places):
        atlas.paste(im, (px, py))
        ax, ay = anchors.get(n, (0.5, 0.5))
        frames[n] = {"x": px, "y": py, "w": im.width, "h": im.height,
                     "anchor": {"x": ax, "y": ay}}
    atlas.save(os.path.join(ROOT, "assets", "atlas.png"))

    standalone = {}
    for n in sorted(STANDALONE):
        p = os.path.join(SPR, n + ".png")
        if os.path.exists(p):
            im = Image.open(p)
            standalone[n] = {"file": f"sprites/{n}.png",
                             "w": im.width, "h": im.height, "tiles": True}

    parallax = {}
    pdir = os.path.join(ROOT, "assets", "parallax")
    factors = {"0_sky": 0.10, "1_far": 0.28, "2_mid": 0.50, "3_fore": 0.72}
    for n in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
        if not n.endswith(".png"):
            continue
        key = n[:-4]
        im = Image.open(os.path.join(pdir, n))
        parallax[key] = {"file": f"parallax/{n}", "w": im.width, "h": im.height,
                         "factor": factors.get(key, 0.5)}

    with open(os.path.join(ROOT, "assets", "atlas.json"), "w") as f:
        json.dump({
            "image": "atlas.png",
            "size": {"w": pw, "h": ph},
            "note": "draw a frame at (x - w*anchor.x, y - h*anchor.y). Right-facing "
                    "dog frames are the left frames flipped in X, with anchor.x "
                    "mirrored to (1 - anchor.x).",
            "frames": frames,
            "standalone": standalone,
            "parallax": parallax,
        }, f, indent=2)

    print(f"{len(frames)} frames -> atlas {pw}x{ph}")
    print(f"{len(standalone)} standalone tiling texture(s), "
          f"{len(parallax)} parallax layers referenced")


if __name__ == "__main__":
    main()
