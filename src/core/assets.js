// Atlas loading and anchored drawing.
//
// atlas.json is the contract written by tools/pack.py: every frame carries a
// normalised anchor (the dog's between its paws, a vent's at its base). Draw
// through these helpers so nothing ever positions a sprite by its top-left
// corner and drifts.

const BASE = 'assets/';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadAssets() {
  // no-cache forces revalidation: a stale manifest paired with a fresh atlas
  // image misplaces every sprite, and looks like a rendering bug rather than a
  // caching one.
  const meta = await fetch(BASE + 'atlas.json', { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error('atlas.json missing - run tools/pack.py');
    return r.json();
  });

  const v = meta.rev ? `?v=${meta.rev}` : '';
  const atlas = await loadImage(BASE + meta.image + v);

  const standalone = {};
  for (const [name, info] of Object.entries(meta.standalone || {})) {
    standalone[name] = await loadImage(BASE + info.file + v);
  }

  const parallax = [];
  for (const [name, info] of Object.entries(meta.parallax || {})) {
    parallax.push({ name, factor: info.factor,
                    img: await loadImage(BASE + info.file + v) });
  }
  parallax.sort((a, b) => a.factor - b.factor);   // far to near

  return { meta, atlas, frames: meta.frames, standalone, parallax };
}

export function frameSize(assets, name, { w, h } = {}) {
  const f = assets.frames[name];
  if (!f) throw new Error(`unknown frame: ${name}`);
  if (w) return { w, h: (f.h * w) / f.w };
  if (h) return { w: (f.w * h) / f.h, h };
  return { w: f.w, h: f.h };
}

/**
 * Draw a frame with its anchor pinned at (x, y).
 *
 * Everything happens around the anchor: `flip` mirrors in X, `rot` rotates,
 * and `sx`/`sy` squash and stretch. Pivoting at the anchor is what makes the
 * jump animation work - the dog's feet stay planted while its body stretches,
 * which is not true of a transform around the sprite's centre.
 *
 * opts: { w | h, flip, alpha, rot (radians), sx, sy }
 */
export function drawFrame(ctx, assets, name, x, y, opts = {}) {
  const f = assets.frames[name];
  if (!f) throw new Error(`unknown frame: ${name}`);
  const { w, h } = frameSize(assets, name, opts);
  const { flip = false, rot = 0, sx = 1, sy = 1, alpha = 1 } = opts;

  const plain = !flip && !rot && sx === 1 && sy === 1;
  if (plain && alpha === 1) {
    ctx.drawImage(assets.atlas, f.x, f.y, f.w, f.h,
                  x - w * f.anchor.x, y - h * f.anchor.y, w, h);
    return;
  }

  ctx.save();
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale((flip ? -1 : 1) * sx, sy);
  // Drawn in the (possibly mirrored) local space, so the UNmirrored anchor is
  // correct here - the mirror already moves the pin to the other side.
  ctx.drawImage(assets.atlas, f.x, f.y, f.w, f.h,
                -w * f.anchor.x, -h * f.anchor.y, w, h);
  ctx.restore();
}
