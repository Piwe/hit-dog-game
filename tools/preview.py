#!/usr/bin/env python3
"""
Render the assets as an actual 960x640 game view.

A static composite for checking assets without a browser: anchors, slot
geometry, the parallax stack and the vent ramp at real resolution and scale.

NOT the verification of record for gameplay - the game itself is, driven in
headless Chrome. This script keeps its own copy of the layout constants, so
treat any disagreement with src/config.js as this file being stale.

    python3 tools/preview.py
"""
import json
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ROOT, "assets", "sprites")
PLX = os.path.join(ROOT, "assets", "parallax")
BUILD = os.path.join(ROOT, "build")

W, H = 960, 640
RUNG_H = 110
# The two mountains hug the screen edges; the valley between them is where the
# dog is read against open sky. Ledges jut out of the inner faces INTO the
# valley, and the dog stands on the jutting part - standing on the wall itself
# would put a brown dog on brown rock.
WALL_INNER_L, WALL_INNER_R = 280, 680      # inner faces of the two mountains
LEDGE_W = 170
LEFT_X = WALL_INNER_L + 46                 # 326 - dog sits clear of the rock
RIGHT_X = WALL_INNER_R - 46                # 634
TOTAL_RUNGS = 30
GROUND_Y = 240                             # world y of rung 0 (y grows upward)

PARALLAX = {"0_sky": 0.10, "1_far": 0.28, "2_mid": 0.50, "3_fore": 0.72}
VENT_Y = 97          # mirrors CFG.ventYOffset (88) + the sprite's 0.95 anchor
DOG_H = 96
CLOUD_W = 168


def load(p):
    return Image.open(p).convert("RGBA")


def scaled(img, target_h=None, target_w=None):
    w, h = img.size
    if target_h:
        s = target_h / h
    else:
        s = target_w / w
    return img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)


def draw_anchored(dst, img, atlas_anchor, x, y):
    ax, ay = atlas_anchor
    dst.alpha_composite(img, (int(x - img.width * ax), int(y - img.height * ay)))


def render(cam_y, dog_rung, dog_side, dog_frame, vent_plan, label):
    """cam_y = world y at the bottom of the screen."""
    atlas = json.load(open(os.path.join(ROOT, "assets", "atlas.json")))["frames"]
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 255))

    # ---- parallax -------------------------------------------------------
    for name, factor in PARALLAX.items():
        layer = load(os.path.join(PLX, name + ".png"))
        # layers are anchored to world bottom and sink as the camera climbs
        oy = int(cam_y * factor)
        top = H - layer.height + oy
        frame.alpha_composite(layer, (0, top))   # pre-tiled to screen width

    # ---- mountain walls -------------------------------------------------
    wall = load(os.path.join(SPR, "wall_rock.png"))
    ww, wh = wall.size
    scroll = int(cam_y) % wh
    # Build each wall on its own surface, then paste clipped to its region -
    # tiling straight onto the frame overshoots the region width and swallows
    # the valley (and with it the entire parallax stack).
    for x0, x1 in ((0, WALL_INNER_L), (WALL_INNER_R, W)):
        band = Image.new("RGBA", (x1 - x0, H), (0, 0, 0, 0))
        for ty in range(-wh, H + wh, wh):
            for tx in range(0, band.width + ww, ww):
                band.alpha_composite(wall, (tx, ty + scroll))
        band = band.crop((0, 0, x1 - x0, H))
        frame.alpha_composite(band, (x0, 0))

    # inner-face shadow gives the valley depth and separates rock from sky
    for x, sgn in ((WALL_INNER_L, -1), (WALL_INNER_R, 1)):
        shade = Image.new("RGBA", (26, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shade)
        for i in range(26):
            a = int(150 * (i / 26) ** 1.5)
            px = i if sgn < 0 else 25 - i
            sd.line([(px, 0), (px, H)], fill=(18, 22, 32, a))
        frame.alpha_composite(shade, (x - 26 if sgn < 0 else x, 0))
    d = ImageDraw.Draw(frame)
    d.line([(WALL_INNER_L, 0), (WALL_INNER_L, H)], fill=(24, 28, 38, 255), width=3)
    d.line([(WALL_INNER_R, 0), (WALL_INNER_R, H)], fill=(24, 28, 38, 255), width=3)

    ledge = scaled(load(os.path.join(SPR, "ledge.png")), target_w=LEDGE_W)

    def screen_y(rung):
        return H - (GROUND_Y + rung * RUNG_H - cam_y)

    # ---- ledges + vent clouds ------------------------------------------
    for rung in range(TOTAL_RUNGS + 1):
        sy = screen_y(rung)
        if not (-200 < sy < H + 200):
            continue
        for side in ("L", "R"):
            lg = ledge if side == "L" else ledge.transpose(Image.FLIP_LEFT_RIGHT)
            # root the ledge in the rock face and let it jut into the valley
            lx = (WALL_INNER_L - 60) if side == "L" else (WALL_INNER_R + 60 - lg.width)
            frame.alpha_composite(lg, (int(lx), int(sy - lg.height * 0.30)))

            state = vent_plan.get((rung, side))
            if state:
                sx = LEFT_X if side == "L" else RIGHT_X
                spr = scaled(load(os.path.join(SPR, state + ".png")),
                             target_w=CLOUD_W)
                # the cloud hangs below its ledge and erupts upward across it,
                # so a venting slot visibly makes that ledge lethal
                frame.alpha_composite(spr, (int(sx - spr.width * 0.5),
                                            int(sy + VENT_Y - spr.height)))

    # ---- dog ------------------------------------------------------------
    dog = load(os.path.join(SPR, dog_frame + ".png"))
    a = atlas[dog_frame]["anchor"]
    dog = scaled(dog, target_h=int(DOG_H * (dog.height / dog.height)))
    dog = scaled(load(os.path.join(SPR, dog_frame + ".png")), target_h=DOG_H)
    if dog_side == "R":
        dog = dog.transpose(Image.FLIP_LEFT_RIGHT)
        anchor = (1.0 - a["x"], a["y"])
    else:
        anchor = (a["x"], a["y"])
    dx = LEFT_X if dog_side == "L" else RIGHT_X
    draw_anchored(frame, dog, anchor, dx, screen_y(dog_rung) - 6)

    # ---- HUD ------------------------------------------------------------
    counter = scaled(load(os.path.join(SPR, "ui_counter.png")), target_h=52)
    frame.alpha_composite(counter, (24, 20))
    slider = scaled(load(os.path.join(SPR, "ui_slider.png")), target_h=40)
    frame.alpha_composite(slider, (W - slider.width - 24, 26))
    pause = scaled(load(os.path.join(SPR, "ui_pause.png")), target_h=46)
    frame.alpha_composite(pause, (W - slider.width - pause.width - 44, 23))

    d = ImageDraw.Draw(frame)
    d.rectangle([0, H - 26, W, H], fill=(0, 0, 0, 190))
    d.text((10, H - 19), label, fill=(240, 240, 245, 255))
    return frame.convert("RGB")


def main():
    shots = [
        (0, 1, "L", "dog_idle",
         {(2, "R"): "vent_build_2", (3, "L"): "vent_idle", (4, "R"): "vent_burst",
          (2, "L"): "cloud_plain_a", (5, "L"): "vent_build_1"},
         "base of the climb - rung 1, camera at world bottom"),
        (900, 10, "R", "dog_jump_a",
         {(11, "L"): "vent_burst", (12, "R"): "vent_build_2",
          (13, "L"): "cloud_plain_b", (10, "L"): "vent_cool_1",
          (14, "R"): "vent_build_1"},
         "mid climb - rung 10, dodging a burst on the left slot"),
        (2100, 21, "L", "dog_hit",
         {(21, "L"): "vent_burst", (22, "R"): "vent_build_2",
          (23, "L"): "cloud_plain_c", (24, "R"): "vent_idle"},
         "hit reaction - rung 21, caught by a burst"),
    ]
    os.makedirs(BUILD, exist_ok=True)
    out = Image.new("RGB", (W * len(shots), H), (0, 0, 0))
    for i, s in enumerate(shots):
        out.paste(render(*s), (i * W, 0))
    out.save(os.path.join(BUILD, "preview_game.png"))
    print("game view -> build/preview_game.png (%dx%d)" % out.size)


if __name__ == "__main__":
    main()
