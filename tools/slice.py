#!/usr/bin/env python3
"""
Cut the composite illustration sheets into game-ready sprites.

Source sheets are hand-authored illustrations, not uniform grids, so frame
rects are declared here rather than inferred. Re-run after any art re-export:

    python3 tools/slice.py

Outputs:
    assets/sprites/*.png    individual alpha-trimmed sprites
    assets/atlas.png        packed texture
    assets/atlas.json       frame rects + anchors
    build/contact_sheet.png labelled verification render
"""
import json
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "images")
OUT = os.path.join(ROOT, "assets", "sprites")
BUILD = os.path.join(ROOT, "build")

EXPANDED = "expanded_sprite_sheet.png"
LEGACY = "sprite_sheet.png"

# name, source sheet, (x, y, w, h), (anchor_x, anchor_y) normalised to the
# TRIMMED frame. Anchors are the contract with the renderer: the dog's anchor
# is between its paws, a cloud's anchor is the vent mouth it erupts from.
FRAMES = [
    # --- dog -------------------------------------------------------------
    ("dog_jump_a",      EXPANDED, (95, 86, 204, 158),   (0.50, 0.94)),
    ("dog_jump_b",      EXPANDED, (326, 95, 201, 149),  (0.50, 0.94)),
    ("dog_idle",        EXPANDED, (183, 298, 222, 162), (0.50, 0.94)),
    # taller frame: steam column sits below the dog, so the anchor rides high
    ("dog_hit",         EXPANDED, (543, 90, 195, 224),  (0.50, 0.66)),
    ("cape",            EXPANDED, (430, 326, 270, 123), (0.18, 0.35)),

    # --- vent clouds -----------------------------------------------------
    # bottom-anchored: the cloud body holds the slot, steam grows upward
    ("cloud_idle",      EXPANDED, (810, 108, 200, 90),   (0.50, 0.88)),
    ("cloud_buildup",   EXPANDED, (1025, 98, 219, 101),  (0.50, 0.88)),
    ("cloud_burst",     EXPANDED, (1035, 225, 194, 142), (0.50, 0.95)),
    ("cloud_plain_a",   EXPANDED, (1255, 110, 186, 87),  (0.50, 0.88)),
    ("cloud_plain_b",   EXPANDED, (800, 247, 220, 103),  (0.50, 0.88)),
    ("cloud_plain_c",   EXPANDED, (1242, 254, 207, 97),  (0.50, 0.88)),

    # --- UI --------------------------------------------------------------
    ("ui_start",        EXPANDED, (127, 525, 157, 63),  (0.50, 0.50)),
    ("ui_pause",        EXPANDED, (320, 524, 92, 64),   (0.50, 0.50)),
    ("ui_pips",         EXPANDED, (452, 534, 231, 50),  (0.50, 0.50)),
    ("ui_slider",       EXPANDED, (108, 623, 449, 52),  (0.50, 0.50)),
    ("ui_hotdog_small", EXPANDED, (568, 624, 142, 46),  (0.50, 0.50)),
    ("ui_counter",      EXPANDED, (333, 765, 130, 66),  (0.50, 0.50)),

    # --- pickups / reward ------------------------------------------------
    # trophy + hotdog taken from the legacy sheet: ~25-30% higher native
    # resolution, and both are drawn large and never share a frame with an
    # animating sprite, so the style mismatch never shows.
    ("hotdog",          LEGACY,   (31, 781, 227, 125),  (0.50, 0.50)),
    ("trophy",          LEGACY,   (755, 714, 248, 236), (0.50, 0.92)),
]

# Rects to source rock/foliage texture for the procedural mountain wall.
MOUNTAIN_REF = (LEGACY, (0, 62, 483, 320))

EXCLUDE_NOTE = """Watermark badges (expanded 1287,14 234x62; legacy 858,9 156x42)
and the legacy sheet's full-width 2px divider rules are deliberately not listed."""


def load(name):
    return Image.open(os.path.join(IMAGES, name)).convert("RGBA")


def trim(img):
    """Crop to the alpha bounding box; returns (image, dx, dy)."""
    bbox = img.getbbox()
    if bbox is None:
        return img, 0, 0
    return img.crop(bbox), bbox[0], bbox[1]


def shelf_pack(sizes, max_w=2048, pad=2):
    """Simple shelf packer, tallest-first. Returns placements and canvas size."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    place = [None] * len(sizes)
    x = y = shelf_h = 0
    width = 0
    for i in order:
        w, h = sizes[i]
        if x + w + pad > max_w:
            x = 0
            y += shelf_h + pad
            shelf_h = 0
        place[i] = (x, y)
        x += w + pad
        shelf_h = max(shelf_h, h)
        width = max(width, x)
    return place, width, y + shelf_h


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    sheets = {EXPANDED: load(EXPANDED), LEGACY: load(LEGACY)}

    cut = []
    for name, sheet, (x, y, w, h), (ax, ay) in FRAMES:
        raw = sheets[sheet].crop((x, y, x + w, y + h))
        img, _, _ = trim(raw)
        img.save(os.path.join(OUT, name + ".png"))
        cut.append({"name": name, "img": img, "anchor": [ax, ay],
                    "src": f"{sheet}@{x},{y},{w},{h}"})

    # save the mountain reference crop for the wall generator
    sheet, (x, y, w, h) = MOUNTAIN_REF
    ref, _, _ = trim(sheets[sheet].crop((x, y, x + w, y + h)))
    ref.save(os.path.join(BUILD, "mountain_ref.png"))

    # ---- pack -----------------------------------------------------------
    sizes = [c["img"].size for c in cut]
    places, pw, ph = shelf_pack(sizes)
    atlas = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    frames = {}
    for c, (px, py) in zip(cut, places):
        atlas.paste(c["img"], (px, py))
        w, h = c["img"].size
        frames[c["name"]] = {
            "x": px, "y": py, "w": w, "h": h,
            "anchor": {"x": c["anchor"][0], "y": c["anchor"][1]},
            "source": c["src"],
        }
    atlas.save(os.path.join(ROOT, "assets", "atlas.png"))

    with open(os.path.join(ROOT, "assets", "atlas.json"), "w") as f:
        json.dump({
            "image": "atlas.png",
            "size": {"w": pw, "h": ph},
            "note": "anchor is normalised to each frame; draw at "
                    "(x - w*anchor.x, y - h*anchor.y)",
            "frames": frames,
        }, f, indent=2)

    # ---- labelled contact sheet for visual verification -----------------
    cols, cell = 5, 260
    rows = (len(cut) + cols - 1) // cols
    sheet_img = Image.new("RGBA", (cols * cell, rows * cell), (26, 28, 34, 255))
    d = ImageDraw.Draw(sheet_img)
    for i, c in enumerate(cut):
        cx = (i % cols) * cell
        cy = (i // cols) * cell
        im = c["img"].copy()
        im.thumbnail((cell - 30, cell - 52))
        ox = cx + (cell - im.width) // 2
        oy = cy + 22 + (cell - 52 - im.height) // 2
        d.rectangle([cx + 2, cy + 2, cx + cell - 2, cy + cell - 2],
                    outline=(70, 74, 84, 255))
        sheet_img.alpha_composite(im, (ox, oy))
        # anchor crosshair
        axp = ox + int(im.width * c["anchor"][0])
        ayp = oy + int(im.height * c["anchor"][1])
        d.line([axp - 9, ayp, axp + 9, ayp], fill=(255, 60, 90, 255), width=2)
        d.line([axp, ayp - 9, axp, ayp + 9], fill=(255, 60, 90, 255), width=2)
        d.text((cx + 8, cy + 6), f"{i} {c['name']}", fill=(235, 238, 245, 255))
        d.text((cx + 8, cy + cell - 18),
               f"{c['img'].width}x{c['img'].height}", fill=(150, 156, 170, 255))
    sheet_img.convert("RGB").save(os.path.join(BUILD, "contact_sheet.png"))

    print(f"{len(cut)} sprites -> assets/sprites/")
    print(f"atlas {pw}x{ph} -> assets/atlas.png + atlas.json")
    print("verify -> build/contact_sheet.png")


if __name__ == "__main__":
    main()
