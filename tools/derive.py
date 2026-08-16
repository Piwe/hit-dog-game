#!/usr/bin/env python3
"""
Generate the game assets the source sheets don't contain.

Everything here is derived from the shipped art so it stays on-style - no new
artwork is invented. Run after tools/slice.py:

    python3 tools/derive.py

Produces:
    assets/parallax/*.png     4 depth layers, sky keyed to alpha, vertically tall
    assets/sprites/vent_*.png a readable 6-frame vent telegraph ramp
    assets/sprites/wall_*.png vertically tileable rock + ledge for the climb
    build/preview_*.png       verification renders
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "images")
SPR = os.path.join(ROOT, "assets", "sprites")
PLX = os.path.join(ROOT, "assets", "parallax")
BUILD = os.path.join(ROOT, "build")

# Only two of the three painted strips are usable. The middle one (distant
# snowy peaks) is deliberately NOT cut: its peaks and clouds sit at the same
# pale value as its own baked sky, so no threshold separates them - every
# attempt left either a rectangular slab of sky with hard tile seams, or
# mountains with their tops eaten. The far depth is restyled from the mid strip
# instead; see restyle_mid().
STRIPS = {              # name: (rect in expanded sheet, parallax factor)
    "0_sky":    ((797, 411, 666, 164), 0.10),
    "2_mid":    ((797, 770, 666, 163), 0.50),
}
UNUSED_STRIP = ((797, 597, 666, 153), "distant peaks - unkeyable, see above")
MID_KEY = (70, 120)


def rect_of(name):
    return (STRIPS[name][0][0], STRIPS[name][0][1],
            STRIPS[name][0][0] + STRIPS[name][0][2],
            STRIPS[name][0][1] + STRIPS[name][0][3])


TALL_H = 1024                     # layers must cover a vertical climb, not a pan
SCREEN_W = 960                    # layers are pre-tiled to this; see fit_width


def np2im(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def key_sky(img, lo=45, hi=95):
    """Alpha-key the baked sky by blue dominance.

    Sky sits at B-R ~150-200 while rock, snow, trees and cloud cores all sit
    below 25, so a soft ramp on (B-R) lifts the sky out without touching the
    snow caps the way a luminance or flood-fill key would.
    """
    a = np.array(img.convert("RGBA")).astype(float)
    bd = a[..., 2] - a[..., 0]
    alpha = np.clip((hi - bd) / (hi - lo), 0.0, 1.0) * 255.0
    a[..., 3] = np.minimum(a[..., 3], alpha)
    return np2im(a)


def fit_width(img, w=SCREEN_W):
    """Pre-tile a horizontally seamless layer out to full screen width.

    The camera only scrolls vertically, so a layer narrower than the screen
    repeats at a fixed x - and that seam lands in the valley, the one strip of
    background the player actually looks at. Baking the repeat to screen width
    puts the only remaining seams at x=0 and x=w, both hidden behind a mountain.
    """
    out = Image.new("RGBA", (w, img.height), (0, 0, 0, 0))
    for x in range(0, w + img.width, img.width):
        out.alpha_composite(img, (x, 0))
    return out.crop((0, 0, w, img.height))


def keep_grounded(img, thresh=200, grow=3):
    """Drop anything not connected to the terrain mass at the band's base.

    Two artefacts need removing at once. The strip's white clouds survive any
    blue key (they are not blue) and float as blobs bounded by the crop
    rectangle. And the gentle key the hazy far peaks require leaves the sky at
    partial alpha, a translucent rectangle with a hard top edge.

    Both die to the same rule: real terrain is one mass reaching the band's
    bottom edge. Taking the connected component at a HIGH alpha threshold
    ignores residual sky (which never gets that opaque) while still catching
    hazy peaks, then the soft alpha is gated through that mask - so edges keep
    their anti-aliasing instead of turning into a hard cut-out.
    """
    from scipy import ndimage
    a = np.array(img.convert("RGBA")).astype(float)
    solid = a[..., 3] > thresh
    lbl, n = ndimage.label(solid, np.ones((3, 3)))
    if n == 0:
        return img
    keep = set(np.unique(lbl[-6:, :])) - {0}
    if not keep:
        return img
    mask = np.isin(lbl, list(keep))
    mask = ndimage.binary_dilation(mask, np.ones((grow, grow)))
    soft = ndimage.gaussian_filter(mask.astype(float), 1.2)
    a[..., 3] *= np.clip(soft, 0, 1)
    return np2im(a)


def clip_above_silhouette(img, harsh, feather=7):
    """Erase whatever sits above each column's terrain silhouette.

    The gentle key the hazy far peaks need also lets a sheet of partial-alpha
    sky survive, and because the source is a crop that sheet has square
    corners - a pale rectangle hanging in the valley. A harsh key marks where
    terrain is unambiguous; everything above that per column is sky by
    definition, whatever its alpha says.
    """
    a = np.array(img.convert("RGBA")).astype(float)
    hs = np.array(harsh.convert("RGBA").getchannel("A")) > 128
    h, w = hs.shape
    has_terrain = hs.any(axis=0)
    top = np.argmax(hs, axis=0).astype(float)
    top[~has_terrain] = h + feather          # column is pure sky: drop it all
    rows = np.arange(h)[:, None]
    ramp = np.clip((rows - (top[None, :] - feather)) / feather, 0.0, 1.0)
    a[..., 3] *= ramp
    return np2im(a)


def make_sky(strip, h=TALL_H):
    """Build the sky as a pure vertical gradient in the source's own colours.

    Reusing the painted band verbatim leaves a visible tonal step where the
    extrapolated region meets it. The band's clouds are redundant anyway - the
    climb is populated by real cloud sprites - so a clean gradient is both
    seamless and cheaper to scroll.
    """
    a = np.array(strip.convert("RGBA")).astype(float)
    lo = a[-8:].mean(axis=(0, 1))              # horizon tone
    hi = np.array([lo[0] * 0.44, lo[1] * 0.66, min(255, lo[2] * 1.04), 255])
    t = (np.linspace(1, 0, h) ** 0.80)[:, None, None]
    grad = hi[None, None, :] * t + lo[None, None, :] * (1 - t)
    return np2im(np.repeat(grad, strip.size[0], axis=1))


def band_on_tall(img, h=TALL_H, foot=0.0):
    """Place a keyed terrain band on a tall transparent canvas.

    `foot` is how far above the canvas bottom the band's base sits, as a
    fraction of canvas height - this is what staggers the layers into depth.
    """
    w, sh = img.size
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y = int(h - sh - foot * h)
    canvas.alpha_composite(img, (0, max(0, y)))
    return canvas


def seamless_x(img, feather=90):
    """Cross-blend the left and right edges so the layer tiles horizontally."""
    w, h = img.size
    a = np.array(img).astype(float)
    ramp = np.linspace(0, 1, feather)[None, :, None]
    left = a[:, :feather].copy()
    right = a[:, -feather:].copy()
    a[:, :feather] = left * ramp + right * (1 - ramp)
    return np2im(a[:, : w - feather])


def restyle_mid(mid, scale, tint, amount, blur=0.0, alpha=1.0, desat=0.0):
    """Build another depth layer out of the mid strip.

    Only the mid strip keys cleanly. Its neighbours are painted landscape bands
    whose skies cannot be separated from their content: the far strip's peaks
    and clouds sit at the same pale value as the sky behind them, so any
    threshold either keeps a rectangular slab of sky or eats the mountains.

    So rather than fight an unkeyable source, both other depths are restyled
    copies of the one good silhouette - pushed toward the sky colour for
    distance, or dark and blurred for foreground. Atmospheric perspective is
    exactly this operation anyway, which is why it reads correctly.

    Crucially the silhouette is kept whole: cropping a band out of it is what
    produced the hard horizontal cut across the valley in the old foreground.
    """
    w, h = mid.size
    im = mid.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    a = np.array(im).astype(float)
    if desat:
        # Distance drains colour before it drains contrast, so desaturating
        # before the tint is what stops the far ridge reading as green.
        lum = a[..., :3] @ np.array([0.299, 0.587, 0.114])
        a[..., :3] = a[..., :3] * (1 - desat) + lum[..., None] * desat
    t = np.array(tint, float)
    a[..., :3] = a[..., :3] * (1 - amount) + t[None, None, :] * amount
    if alpha != 1.0:
        a[..., 3] *= alpha
    out = np2im(a)
    if blur:
        out = out.filter(ImageFilter.GaussianBlur(blur))
    return out


# --------------------------------------------------------------------------
# vent telegraph
# --------------------------------------------------------------------------
def fire_layer(burst):
    """Isolate the warm eruption from the burst frame's cool cloud body."""
    a = np.array(burst.convert("RGBA")).astype(float)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    warm = np.clip((R - B - 25) / 70.0, 0, 1)          # orange/yellow only
    bright = np.clip((np.maximum(R, G) - 90) / 90.0, 0, 1)
    m = warm * bright
    a[..., 3] = a[..., 3] * m
    return np2im(a)


def build_vent_ramp():
    """A 6-frame telegraph: idle -> two buildup steps -> burst -> two cooldown.

    The shipped buildup frame differs from idle by a few bubbles, which is
    unreadable at gameplay size. Compositing a scaled, dimmed copy of the real
    eruption onto the cloud gives a warning that grows in both size and
    brightness, so it reads on shape alone and survives colour-blindness.
    """
    idle = Image.open(os.path.join(SPR, "cloud_idle.png")).convert("RGBA")
    burst = Image.open(os.path.join(SPR, "cloud_burst.png")).convert("RGBA")
    fire = fire_layer(burst)

    fw, fh = fire.size
    cw, ch = idle.size
    W, H = max(cw, fw), ch + int(fh * 0.92)
    frames = {}

    def compose(scale, alpha, glow):
        c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        cloud = idle
        if glow:                                  # warm the cloud from beneath
            arr = np.array(cloud).astype(float)
            g = np.linspace(0, 1, arr.shape[0])[:, None]
            arr[..., 0] = np.minimum(255, arr[..., 0] + 70 * g * glow)
            arr[..., 1] = np.minimum(255, arr[..., 1] + 34 * g * glow)
            arr[..., 2] = arr[..., 2] * (1 - 0.22 * g * glow)
            cloud = np2im(arr)
        if scale > 0:
            s = fire.resize((max(1, int(fw * scale)), max(1, int(fh * scale))),
                            Image.LANCZOS)
            sa = np.array(s).astype(float)
            sa[..., 3] *= alpha
            s = np2im(sa)
            c.alpha_composite(s, ((W - s.width) // 2, H - ch - s.height + int(ch * 0.42)))
        c.alpha_composite(cloud, ((W - cw) // 2, H - ch))
        return c

    frames["vent_idle"] = compose(0.0, 0.0, 0.0)
    frames["vent_build_1"] = compose(0.34, 0.45, 0.35)
    frames["vent_build_2"] = compose(0.62, 0.72, 0.70)
    full = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    full.alpha_composite(burst, ((W - burst.width) // 2, H - burst.height))
    frames["vent_burst"] = full
    frames["vent_cool_1"] = compose(0.48, 0.34, 0.45)
    frames["vent_cool_2"] = compose(0.22, 0.15, 0.18)
    return frames


# --------------------------------------------------------------------------
# mountain wall
# --------------------------------------------------------------------------
# Palette sampled from the shipped mountain painting, so the drawn wall sits in
# the same colour world as the sprites without copying its brushwork.
ROCK = [(50, 69, 93), (99, 98, 103), (144, 128, 110), (204, 192, 132)]
ROCK_HI = (238, 228, 210)
FOLIAGE = [(27, 75, 15), (70, 128, 21), (137, 180, 28), (171, 202, 35)]
OUTLINE = (28, 32, 44)

# Facet size is set against the dog's on-screen height (~96px): blocks need to
# read as rock detail behind the character, not as masonry the size of the dog.
WALL_W, WALL_H = 200, 240
BAND_H = 26
BLOCK_W = (26, 54)
SS = 3                                    # supersample factor for clean facets


class Rand:
    """Deterministic LCG - the wall must be byte-identical on every re-run."""

    def __init__(self, seed=20260815):
        self.s = seed

    def next(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s / 0xFFFFFFFF

    def range(self, a, b):
        return a + (b - a) * self.next()

    def pick(self, seq):
        return seq[min(len(seq) - 1, int(self.next() * len(seq)))]


def build_wall():
    """Draw a vertically tileable rock face rather than resampling the painting.

    The source mountain is a stylised painting, not a texture - cropping it
    yields smeared, oversized boulders and a visible seam. Drawing faceted
    blocks from its palette tiles perfectly and matches the art's blocky
    shading. Every shape is drawn twice, offset by +/-WALL_H, so the tile is
    seamless by construction instead of by blending.
    """
    from PIL import ImageDraw
    W, H = WALL_W * SS, WALL_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = Rand()

    # base fill with a subtle left-to-right light fall-off (light from the valley)
    base = np.zeros((H, W, 4), float)
    t = np.linspace(0, 1, W)[None, :, None]
    c0, c1 = np.array(ROCK[1], float), np.array(ROCK[2], float)
    base[..., :3] = c0 * (1 - t) + c1 * t
    base[..., 3] = 255
    img.alpha_composite(np2im(base))

    band_h = BAND_H * SS
    rows = H // band_h + 2
    for row in range(rows):
        y0 = row * band_h
        x = -int(r.range(0, 30) * SS)
        while x < W:
            w = int(r.range(*BLOCK_W) * SS)
            jitter = lambda m: int(r.range(-m, m) * SS)
            pts = [
                (x + jitter(4), y0 + jitter(5)),
                (x + w + jitter(4), y0 + jitter(5)),
                (x + w + jitter(4), y0 + band_h + jitter(5)),
                (x + jitter(4), y0 + band_h + jitter(5)),
            ]
            fill = r.pick(ROCK)
            for dy in (-H, 0, H):                 # wrap for vertical tiling
                p = [(px, py + dy) for px, py in pts]
                d.polygon(p, fill=fill, outline=OUTLINE)
                # top-left catch light along the block's upper edge
                d.line([p[0], p[1]], fill=ROCK_HI, width=max(1, SS))
            x += w - int(r.range(1, 6) * SS)

    # a few foliage clumps clinging to the face, also wrapped
    for _ in range(12):
        cx, cy = r.range(0, WALL_W) * SS, r.range(0, WALL_H) * SS
        rad = r.range(7, 15) * SS
        shade = r.pick(FOLIAGE)
        for dy in (-H, 0, H):
            for _b in range(5):
                bx = cx + r.range(-rad, rad)
                by = cy + dy + r.range(-rad * 0.5, rad * 0.5)
                br = rad * r.range(0.35, 0.62)
                d.ellipse([bx - br, by - br, bx + br, by + br], fill=shade)

    wall = img.resize((WALL_W, WALL_H), Image.LANCZOS)
    wall = ImageEnhance.Contrast(wall).enhance(1.04)

    # ---- ledge: a drawn slab the dog can believably stand on ----------
    LW, LH = 200, 76
    li = Image.new("RGBA", (LW * SS, LH * SS), (0, 0, 0, 0))
    ld = ImageDraw.Draw(li)
    s = SS
    slab = [(6 * s, 30 * s), (LW * s - 10 * s, 22 * s), (LW * s - 4 * s, 52 * s),
            (LW * s - 30 * s, 70 * s), (26 * s, 66 * s), (2 * s, 46 * s)]
    ld.polygon(slab, fill=ROCK[2], outline=OUTLINE)
    ld.polygon([(6 * s, 30 * s), (LW * s - 10 * s, 22 * s),
                (LW * s - 16 * s, 36 * s), (16 * s, 44 * s)], fill=ROCK[3])
    for i in range(14):                       # grass tufts along the top edge
        gx = r.range(10, LW - 18) * s
        gy = r.range(24, 34) * s
        gr = r.range(9, 17) * s
        ld.ellipse([gx - gr, gy - gr * 0.7, gx + gr, gy + gr * 0.7],
                   fill=r.pick(FOLIAGE[1:]))
    ledge = li.resize((LW, LH), Image.LANCZOS)
    return wall, ledge


def build_slider_track():
    """Erase the knob painted into the slider sprite.

    ui_slider.png ships with its knob drawn at a fixed position (native x
    220-263 of 449), so a live knob drawn at the real value produces TWO knobs.
    Covering it at draw time does not work: the knob is 36px tall in a 52px
    sprite and overflows any strip narrow enough to leave the frame art intact.

    Painting it out at the source is the fix. The groove is uniform along x -
    it runs 93..360 with identical tone either side of the knob - so repeating
    one clean groove column across the gap is seamless.
    """
    src = Image.open(os.path.join(SPR, "ui_slider.png")).convert("RGBA")
    a = np.array(src)
    x0, x1 = 218, 266                     # knob bbox 220..263, plus margin
    clean = a[:, 205:206]                 # a groove column clear of the knob
    a[:, x0:x1] = np.repeat(clean, x1 - x0, axis=1)
    return Image.fromarray(a, "RGBA")


def main():
    os.makedirs(PLX, exist_ok=True)
    sheet = Image.open(os.path.join(IMAGES, "expanded_sprite_sheet.png")).convert("RGBA")

    layers = {}

    # sky: a clean gradient, no painted band (see make_sky)
    sky_strip = seamless_x(sheet.crop(rect_of("0_sky")))
    sky = fit_width(make_sky(sky_strip))
    layers["0_sky"] = sky
    sky.save(os.path.join(PLX, "0_sky.png"))
    horizon = np.array(sky).astype(float)[-8:].mean(axis=(0, 1))[:3]

    # mid: the one strip whose sky keys away cleanly, and the source of truth
    # for the two depths either side of it
    mid_strip = seamless_x(sheet.crop(rect_of("2_mid")))
    mid_keyed = clip_above_silhouette(
        keep_grounded(key_sky(mid_strip, *MID_KEY)),
        key_sky(mid_strip, 45, 95),
    )

    # Both depths reuse the mid silhouette, so haze and darkness are what keep
    # them from reading as the same ridge drawn twice. Push them hard.
    far = restyle_mid(mid_keyed, scale=0.60, tint=horizon, amount=0.78,
                      blur=0.9, alpha=0.88, desat=0.7)
    # A purpose-drawn foreground (tools/art_gen.py) wins if it exists; the
    # restyled mid layer is the fallback that ships today.
    drawn = os.path.join(IMAGES, "generated", "foreground.png")
    if os.path.exists(drawn):
        fg = Image.open(drawn).convert("RGBA")
        fg = fg.resize((SCREEN_W, max(1, int(fg.height * SCREEN_W / fg.width))),
                       Image.LANCZOS)
        fore = seamless_x(fg)
        print("foreground: using generated art")
    else:
        fore = restyle_mid(mid_keyed, scale=1.60, tint=(16, 24, 34), amount=0.80,
                           blur=2.8, desat=0.5)

    for name, img, foot in (("1_far", far, 0.055),
                            ("2_mid", mid_keyed, 0.0),
                            ("3_fore", fore, 0.0)):
        out = fit_width(band_on_tall(img, foot=foot))
        layers[name] = out
        out.save(os.path.join(PLX, name + ".png"))

    for n, im in build_vent_ramp().items():
        im.save(os.path.join(SPR, n + ".png"))

    wall, ledge = build_wall()
    wall.save(os.path.join(SPR, "wall_rock.png"))
    ledge.save(os.path.join(SPR, "ledge.png"))

    build_slider_track().save(os.path.join(SPR, "ui_slider_track.png"))

    # ---- previews -------------------------------------------------------
    comp = Image.new("RGBA", (960, TALL_H), (0, 0, 0, 255))
    for n in ("0_sky", "1_far", "2_mid", "3_fore"):
        im = layers[n]
        for tx in range(0, 960, im.width):     # layers tile horizontally
            comp.alpha_composite(im, (tx, 0))
    comp.convert("RGB").save(os.path.join(BUILD, "preview_parallax.png"))

    ramp = build_vent_ramp()
    order = ["vent_idle", "vent_build_1", "vent_build_2", "vent_burst",
             "vent_cool_1", "vent_cool_2"]
    cw = max(ramp[o].width for o in order) + 12
    chh = max(ramp[o].height for o in order)
    strip_img = Image.new("RGBA", (cw * len(order), chh + 40), (40, 44, 54, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(strip_img)
    for i, o in enumerate(order):
        im = ramp[o]
        strip_img.alpha_composite(im, (i * cw + (cw - im.width) // 2, 34))
        d.text((i * cw + 8, 10), o, fill=(240, 240, 245, 255))
    strip_img.convert("RGB").save(os.path.join(BUILD, "preview_vent.png"))

    tile = Image.new("RGBA", (256 * 3, wall.height * 2), (0, 0, 0, 255))
    for r in range(2):
        for c in range(3):
            tile.alpha_composite(wall, (c * 256, r * wall.height))
    tile.alpha_composite(ledge, (40, wall.height - 30))
    tile.convert("RGB").save(os.path.join(BUILD, "preview_wall.png"))

    print("parallax -> assets/parallax/ (4 layers, %dpx tall)" % TALL_H)
    print("vent ramp -> assets/sprites/vent_*.png (6 frames)")
    print("wall -> assets/sprites/wall_rock.png, ledge.png")
    print("slider -> assets/sprites/ui_slider_track.png (knob erased)")
    print("verify -> build/preview_parallax.png, preview_vent.png, preview_wall.png")


if __name__ == "__main__":
    main()
