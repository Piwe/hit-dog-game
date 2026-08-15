// Scene rendering: parallax, walls, ledges, vents, dog.
//
// Reads world state, never mutates it. The only state this module owns is
// cosmetic (floating score pops), which the simulation must not know about.

import { CFG } from '../config.js';
import { drawFrame, frameSize } from '../core/assets.js';
import { dogPos, DOG } from '../game/dog.js';
import { dogPose, stepDogAnim } from './dogAnim.js';
import { SLOT } from '../game/level.js';
import { ventFrame, PHASE } from '../game/vent.js';
import { STATE } from '../game/world.js';

const W = CFG.logicalW;
const H = CFG.logicalH;

const pops = [];        // { x, y, text, age, ttl, tint }

export function addPop(x, y, text, tint = '#ffd24a') {
  pops.push({ x, y, text, age: 0, ttl: 900, tint });
}

export function stepFx(dtMs, world) {
  stepDogAnim(world, dtMs);
  for (let i = pops.length - 1; i >= 0; i--) {
    pops[i].age += dtMs;
    if (pops[i].age >= pops[i].ttl) pops.splice(i, 1);
  }
}

/** World y -> screen y. World y grows upward; screen y grows downward. */
const toScreenY = (worldY, camY) => H - (worldY - camY);

function drawParallax(ctx, assets, camY) {
  for (const layer of assets.parallax) {
    // layers are anchored to the world floor and sink as the camera climbs
    const top = H - layer.img.height + camY * layer.factor;
    if (top > H) continue;             // fully below the viewport
    ctx.drawImage(layer.img, 0, Math.round(top));
  }
}

function drawWalls(ctx, assets, camY) {
  const wall = assets.standalone.wall_rock;
  if (!wall) return;
  const wh = wall.height;
  const ww = wall.width;
  const scroll = ((camY % wh) + wh) % wh;

  for (const [x0, x1] of [[0, CFG.wallInnerL], [CFG.wallInnerR, W]]) {
    ctx.save();
    // Clip: tiles overshoot the wall region otherwise and swallow the valley,
    // taking the whole parallax stack with it.
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, H);
    ctx.clip();
    for (let y = -wh + scroll; y < H + wh; y += wh) {
      for (let x = x0; x < x1 + ww; x += ww) {
        ctx.drawImage(wall, x, Math.round(y));
      }
    }
    ctx.restore();
  }

  // inner-face shadow: gives the valley depth and separates rock from sky
  const shade = 26;
  let g = ctx.createLinearGradient(CFG.wallInnerL - shade, 0, CFG.wallInnerL, 0);
  g.addColorStop(0, 'rgba(18,22,32,0)');
  g.addColorStop(1, 'rgba(18,22,32,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(CFG.wallInnerL - shade, 0, shade, H);

  g = ctx.createLinearGradient(CFG.wallInnerR + shade, 0, CFG.wallInnerR, 0);
  g.addColorStop(0, 'rgba(18,22,32,0)');
  g.addColorStop(1, 'rgba(18,22,32,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(CFG.wallInnerR, 0, shade, H);

  ctx.fillStyle = '#181c26';
  ctx.fillRect(CFG.wallInnerL - 2, 0, 3, H);
  ctx.fillRect(CFG.wallInnerR - 1, 0, 3, H);
}

function visibleRungs(world) {
  const first = Math.max(0, Math.floor((world.camY - CFG.groundY) / CFG.rungH) - 2);
  const last = Math.min(CFG.totalRungs, first + Math.ceil(H / CFG.rungH) + 4);
  return [first, last];
}

function drawSlots(ctx, assets, world, pass) {
  const [first, last] = visibleRungs(world);
  for (let r = first; r <= last; r++) {
    const rung = world.level.rungs[r];
    if (!rung) continue;
    const sy = toScreenY(CFG.groundY + r * CFG.rungH, world.camY);

    for (const side of ['L', 'R']) {
      const slot = rung.slots[side];
      const sx = side === 'L' ? CFG.leftX : CFG.rightX;

      if (pass === 'back') {
        // ledge first: the dog stands on the part that juts into the valley
        const lx = side === 'L' ? CFG.ledgeLX : CFG.ledgeRX;
        const { w, h } = frameSize(assets, 'ledge', { w: CFG.ledgeW });
        drawFrame(ctx, assets, 'ledge', lx + w / 2, sy, {
          w: CFG.ledgeW, flip: side === 'R',
        });

        if (slot.kind === SLOT.INERT) {
          drawFrame(ctx, assets, slot.frame, sx, sy + CFG.ventYOffset,
                    { w: CFG.cloudW, alpha: 0.95 });
        } else if (slot.kind === SLOT.VENT &&
                   slot.vent.phase !== PHASE.BURST) {
          drawFrame(ctx, assets, ventFrame(slot.vent), sx,
                    sy + CFG.ventYOffset, { w: CFG.cloudW });
        }
      } else if (slot.kind === SLOT.VENT && slot.vent.phase === PHASE.BURST) {
        // bursts draw in FRONT of the dog so an eruption visibly engulfs it
        drawFrame(ctx, assets, ventFrame(slot.vent), sx,
                  sy + CFG.ventYOffset, { w: CFG.cloudW });
      }
    }
  }
}

function drawDog(ctx, assets, world) {
  const { dog } = world;
  const p = dogPos(dog);
  const sy = toScreenY(p.y, world.camY);
  const flip = dog.facing === 'R';     // source art faces left

  // i-frames blink, so being hit is unmistakable
  const blink = dog.iframe > 0 && Math.floor(dog.iframe / 90) % 2 === 0;
  const alpha = blink ? 0.35 : 1;
  const pose = dogPose(world);

  if (world.state === STATE.SUMMIT) {
    // The cape pins at the shoulder and flows out behind the dog - the source
    // art faces left, so "behind" is +x unflipped and -x flipped. Anchoring it
    // over the body instead just hides it under the dog entirely.
    const sway = Math.sin(world.elapsed / 260) * 5;
    drawFrame(ctx, assets, 'cape', p.x + (flip ? -12 : 12), sy - 62 + sway,
              { w: CFG.capeW, flip });
  }
  drawFrame(ctx, assets, pose.frame, p.x, sy, {
    h: CFG.dogH, flip, alpha, rot: pose.rot, sx: pose.sx, sy: pose.sy,
  });
}

function drawPops(ctx) {
  ctx.save();
  ctx.textAlign = 'center';
  for (const p of pops) {
    const t = p.age / p.ttl;
    ctx.globalAlpha = 1 - t * t;
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(20,22,30,0.85)';
    ctx.fillStyle = p.tint;
    const y = p.y - t * 46;
    ctx.strokeText(p.text, p.x, y);
    ctx.fillText(p.text, p.x, y);
  }
  ctx.restore();
}

export function renderScene(ctx, assets, world) {
  ctx.save();
  if (world.shake > 0) {
    const s = world.shake * 9;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  drawParallax(ctx, assets, world.camY);
  drawWalls(ctx, assets, world.camY);
  drawSlots(ctx, assets, world, 'back');
  drawDog(ctx, assets, world);
  drawSlots(ctx, assets, world, 'front');
  drawPops(ctx);

  ctx.restore();
}

export { toScreenY };
