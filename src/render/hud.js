// HUD, menus and the debug overlay. Reads world state; never mutates it.

import { CFG, clamp, jumpMsFor, graceMsFor } from '../config.js';
import { drawFrame, frameSize } from '../core/assets.js';
import { STATE, progress } from '../game/world.js';
import { isMuted } from '../core/audio.js';

const W = CFG.logicalW;
const H = CFG.logicalH;

// Layout rects, exported so input can hit-test against exactly what is drawn.
export const RECT = {
  slider: { x: W - 372, y: 20, w: 348, h: 40 },
  pause: { x: W - 372 - 62, y: 18, w: 52, h: 44 },
  start: { x: W / 2 - 105, y: 380, w: 210, h: 84 },
};

// The slider's groove, measured off ui_slider.png (449x52): the dark channel
// runs x 93..360 and rows 16..31. Fractions, so it survives a resize of RECT.
// These were guessed before and were ~10px too wide each side, which let the
// knob ride over the SLOW / FAST labels at the extremes.
const GROOVE = { x0: 93 / 449, x1: 361 / 449, y0: 16 / 52, y1: 32 / 52 };
const SLIDER_ASPECT = 52 / 449;

/** Track geometry, shared by drawing and hit-testing so they cannot drift. */
export function sliderTrack() {
  const r = RECT.slider;
  const sh = r.w * SLIDER_ASPECT;
  const top = r.y + r.h / 2 - sh / 2;
  const x0 = r.x + r.w * GROOVE.x0;
  const x1 = r.x + r.w * GROOVE.x1;
  const yTop = top + sh * GROOVE.y0;
  const yBot = top + sh * GROOVE.y1;
  const kr = (yBot - yTop) * 1.15;
  // The knob CENTRE travels a shorter span than the groove, so the knob body
  // stays inside the groove at both ends instead of riding over the SLOW /
  // FAST labels.
  const inset = kr * 0.55;
  return { x0, x1, yTop, yBot, kr, kx0: x0 + inset, kx1: x1 - inset };
}

export function sliderValueFromX(x) {
  const t = sliderTrack();
  const p = clamp((x - t.kx0) / (t.kx1 - t.kx0), 0, 1);
  return CFG.speed.min + p * (CFG.speed.max - CFG.speed.min);
}

export function hitRect(r, p) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function text(ctx, str, x, y, {
  size = 24, weight = 'bold', align = 'left', fill = '#fff', stroke = 'rgba(16,18,26,0.85)', lw = 6,
} = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(str, x, y); }
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSlider(ctx, assets, world) {
  const r = RECT.slider;
  // ui_slider_track is the shipped sprite with its painted-in knob erased by
  // tools/derive.py. The old approach — draw the original and cover the knob
  // with a rectangle — could not work: that knob is 36px tall in a 52px sprite,
  // so any strip narrow enough to spare the frame art left its top third
  // showing, which read on screen as a second knob.
  drawFrame(ctx, assets, 'ui_slider_track', r.x + r.w / 2, r.y + r.h / 2,
            { w: r.w });

  const t = sliderTrack();
  const gh = t.yBot - t.yTop;
  const cy = (t.yTop + t.yBot) / 2;
  const p = (world.speed - CFG.speed.min) / (CFG.speed.max - CFG.speed.min);
  const kx = t.kx0 + (t.kx1 - t.kx0) * p;
  const kr = t.kr;

  ctx.save();
  ctx.fillStyle = '#3fa9f5';
  roundRect(ctx, t.x0, t.yTop, Math.max(gh, kx - t.x0), gh, gh / 2);
  ctx.fill();

  const g = ctx.createRadialGradient(kx - kr * 0.3, cy - kr * 0.35, kr * 0.15,
                                     kx, cy, kr);
  g.addColorStop(0, '#ffe89a');
  g.addColorStop(1, '#e8a916');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(kx, cy, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,40,0,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawAgility(ctx, assets, world) {
  const { w, h } = frameSize(assets, 'ui_pips', { w: 150 });
  const x = 24;
  const y = 78;
  // dim the whole meter, then redraw the lit portion clipped to the fill
  drawFrame(ctx, assets, 'ui_pips', x + w / 2, y + h / 2, { w, alpha: 0.28 });
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w * world.dog.agility, h);
  ctx.clip();
  drawFrame(ctx, assets, 'ui_pips', x + w / 2, y + h / 2, { w });
  ctx.restore();
  text(ctx, 'AGILITY', x + w + 12, y + h / 2, { size: 15, fill: '#dfe6f2' });
}

function drawProgress(ctx, world) {
  const x = W - 26;
  const top = 96;
  const hgt = H - 190;
  ctx.save();
  ctx.fillStyle = 'rgba(12,18,30,0.45)';
  roundRect(ctx, x - 5, top, 10, hgt, 5);
  ctx.fill();
  const p = progress(world);
  ctx.fillStyle = '#7ed321';
  roundRect(ctx, x - 5, top + hgt * (1 - p), 10, hgt * p, 5);
  ctx.fill();
  ctx.restore();
  text(ctx, `${world.dog.rung}/${CFG.totalRungs}`, x, top - 14,
       { size: 15, align: 'center', fill: '#dfe6f2' });
}

function dim(ctx, a = 0.55) {
  ctx.fillStyle = `rgba(8,12,20,${a})`;
  ctx.fillRect(0, 0, W, H);
}

function drawMenu(ctx, assets, world) {
  dim(ctx, 0.5);
  text(ctx, 'HOT DOG', W / 2, 190, { size: 78, align: 'center', fill: '#ffd24a' });
  text(ctx, 'Climb the mountain. Dodge the steam.', W / 2, 254,
       { size: 24, align: 'center', fill: '#e9eef7' });
  text(ctx, 'Left and Right arrows jump to the next ledge up - pick the safe side',
       W / 2, 296, { size: 19, align: 'center', fill: '#aebbd0' });
  text(ctx, 'Watch for a cloud building steam. That is your only warning.',
       W / 2, 324, { size: 19, align: 'center', fill: '#aebbd0' });

  const r = RECT.start;
  drawFrame(ctx, assets, 'ui_start', r.x + r.w / 2, r.y + r.h / 2, { w: r.w });
  text(ctx, 'or press Enter', W / 2, r.y + r.h + 28,
       { size: 17, align: 'center', fill: '#93a2ba' });
  text(ctx, `seed ${world.seed}`, W / 2, H - 30,
       { size: 14, align: 'center', fill: '#69768c', stroke: null });
}

function drawPaused(ctx, world) {
  dim(ctx, 0.6);
  text(ctx, 'PAUSED', W / 2, H / 2 - 30, { size: 62, align: 'center', fill: '#ffd24a' });
  text(ctx, 'Esc or P to resume  -  R to restart', W / 2, H / 2 + 30,
       { size: 21, align: 'center', fill: '#cfd9e8' });
  text(ctx, 'the speed slider still works while paused', W / 2, H / 2 + 66,
       { size: 16, align: 'center', fill: '#93a2ba' });
}

function drawSummit(ctx, assets, world) {
  dim(ctx, 0.62);
  drawFrame(ctx, assets, 'trophy', W / 2, 306, { h: 166 });
  text(ctx, 'SUMMIT!', W / 2, 96, { size: 70, align: 'center', fill: '#ffd24a' });

  // The caped dog IS the reward, so it gets a lit hero pose on top of the dim
  // rather than staying wherever the climb happened to leave it.
  const hx = W / 2 - 214;
  const hy = 318;
  const sway = Math.sin(world.elapsed / 260) * 5;
  drawFrame(ctx, assets, 'cape', hx + 16, hy - 74 + sway, { w: 158 });
  drawFrame(ctx, assets, 'dog_idle', hx, hy, { h: 124 });
  text(ctx, `${world.hotdogs} hot dogs`, W / 2, 352,
       { size: 34, align: 'center', fill: '#fff' });
  text(ctx, `${(world.elapsed / 1000).toFixed(1)}s  -  speed ${world.speed.toFixed(2)}x`,
       W / 2, 392, { size: 20, align: 'center', fill: '#cfd9e8' });
  if (world.best !== null) {
    text(ctx, `best ${world.best}`, W / 2, 424,
         { size: 18, align: 'center', fill: '#93a2ba' });
  }
  text(ctx, 'R for a new climb', W / 2, 486,
       { size: 24, align: 'center', fill: '#e9eef7' });
}

function drawDebug(ctx, world, stats) {
  const lines = [
    `fps ${stats.fps}  steps ${stats.stepsLastFrame}  frame ${stats.frameMs.toFixed(1)}ms`,
    `state ${world.state}  seed ${world.seed}`,
    `rung ${world.dog.rung}${world.dog.side}  dog ${world.dog.state}`,
    `agility ${world.dog.agility.toFixed(3)}  jump ${jumpMsFor(world.dog.agility).toFixed(0)}ms`,
    `grace ${graceMsFor(world.dog.agility).toFixed(0)}ms  iframe ${world.dog.iframe.toFixed(0)}ms`,
    `speed ${world.speed.toFixed(2)}x  buildup ${(CFG.vent.buildupMs / world.speed).toFixed(0)}ms`,
    `camY ${world.camY.toFixed(0)}  hotdogs ${world.hotdogs}`,
  ];
  // the invariant that keeps the game fair: the telegraph must outlast the jump
  const margin = CFG.vent.buildupMs / world.speed - jumpMsFor(world.dog.agility);
  lines.push(`telegraph margin ${margin.toFixed(0)}ms ${margin > 0 ? 'OK' : 'UNFAIR'}`);

  ctx.save();
  ctx.fillStyle = 'rgba(6,10,18,0.78)';
  ctx.fillRect(8, H - 8 - lines.length * 18 - 10, 360, lines.length * 18 + 12);
  lines.forEach((l, i) => {
    const bad = l.includes('UNFAIR');
    text(ctx, l, 18, H - 14 - (lines.length - 1 - i) * 18,
         { size: 13, weight: 'normal', fill: bad ? '#ff6b6b' : '#9fe870', stroke: null });
  });
  ctx.restore();
}

export function renderHud(ctx, assets, world, stats, showDebug) {
  // counter
  const c = frameSize(assets, 'ui_counter', { h: 54 });
  drawFrame(ctx, assets, 'ui_counter', 24 + c.w / 2, 20 + c.h / 2, { h: 54 });
  text(ctx, String(world.hotdogs), 24 + c.w - 26, 20 + c.h / 2 + 1,
       { size: 26, align: 'center' });

  drawAgility(ctx, assets, world);
  drawSlider(ctx, assets, world);
  drawProgress(ctx, world);

  const p = RECT.pause;
  drawFrame(ctx, assets, 'ui_pause', p.x + p.w / 2, p.y + p.h / 2, { h: 44 });

  if (isMuted()) {
    text(ctx, 'muted (M)', W - 26, H - 18, { size: 14, align: 'right', fill: '#93a2ba' });
  }

  if (world.state === STATE.MENU) drawMenu(ctx, assets, world);
  else if (world.state === STATE.PAUSED) drawPaused(ctx, world);
  else if (world.state === STATE.SUMMIT) drawSummit(ctx, assets, world);

  if (showDebug) drawDebug(ctx, world, stats);
}
