// Bootstrap: canvas setup, wiring, and the update/render split.

import { CFG, clamp } from './config.js';
import { loadAssets } from './core/assets.js';
import { startLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import {
  initAudio, resumeAudio, play, setMuted, isMuted, preloadAudio, startMusic,
  audioStatus,
} from './core/audio.js';
import {
  createWorld, resetWorld, step, drainEvents, requestJump, setSpeed, STATE,
} from './game/world.js';
import { renderScene, stepFx, addPop, toScreenY } from './render/scene.js';
import { resetDogAnim } from './render/dogAnim.js';
import { renderHud, RECT, hitRect, sliderValueFromX } from './render/hud.js';
import { dogPos } from './game/dog.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
canvas.width = CFG.logicalW;
canvas.height = CFG.logicalH;
ctx.imageSmoothingQuality = 'high';

function fit() {
  const pad = 16;
  const s = Math.min(
    (window.innerWidth - pad) / CFG.logicalW,
    (window.innerHeight - pad) / CFG.logicalH,
  );
  canvas.style.width = `${Math.floor(CFG.logicalW * s)}px`;
  canvas.style.height = `${Math.floor(CFG.logicalH * s)}px`;
}
window.addEventListener('resize', fit);
fit();

const seedParam = new URLSearchParams(location.search).get('seed');
const world = createWorld(seedParam ? Number(seedParam) >>> 0 : undefined);
let showDebug = false;
let draggingSlider = false;

function startRun() {
  initAudio();
  resumeAudio();
  startMusic();
  if (world.state === STATE.MENU) {
    world.state = STATE.PLAYING;
  } else if (world.state === STATE.SUMMIT) {
    resetWorld(world);
    resetDogAnim();
    world.state = STATE.PLAYING;
  }
}

function togglePause() {
  if (world.state === STATE.PLAYING) world.state = STATE.PAUSED;
  else if (world.state === STATE.PAUSED) world.state = STATE.PLAYING;
}

const assets = await loadAssets();
// Generated audio is optional: if tools/audio_gen.py has not been run, this
// resolves to zero samples and every cue falls back to synthesis.
const audioInfo = await preloadAudio();

const input = createInput(canvas, {
  jump(side) {
    if (world.state === STATE.MENU) { startRun(); return; }
    resumeAudio();
    requestJump(world, side);
  },
  confirm() {
    if (world.state === STATE.MENU || world.state === STATE.SUMMIT) startRun();
    else togglePause();
  },
  pause: togglePause,
  restart() {
    resetWorld(world);
    resetDogAnim();
    world.state = STATE.PLAYING;
  },
  debug() { showDebug = !showDebug; },
  nudgeSpeed(d) { setSpeed(world, world.speed + d); },
  pointerDown(p) {
    initAudio();
    resumeAudio();
    if (hitRect(RECT.slider, p)) {
      draggingSlider = true;
      setSpeed(world, sliderValueFromX(p.x));
      return;
    }
    if (hitRect(RECT.pause, p) && world.state !== STATE.MENU) { togglePause(); return; }
    if (world.state === STATE.MENU && hitRect(RECT.start, p)) { startRun(); return; }
    if (world.state === STATE.MENU || world.state === STATE.SUMMIT) { startRun(); return; }
    // tapping a side of the screen jumps that way - touch-friendly
    if (world.state === STATE.PLAYING) {
      requestJump(world, p.x < CFG.logicalW / 2 ? 'L' : 'R');
    }
  },
  pointerMove(p) {
    if (draggingSlider) setSpeed(world, sliderValueFromX(p.x));
  },
  pointerUp() { draggingSlider = false; },
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') setMuted(!isMuted());
});

// Pausing on blur avoids the classic "came back to the tab already dead".
window.addEventListener('blur', () => {
  if (world.state === STATE.PLAYING) world.state = STATE.PAUSED;
});

function handleEvents() {
  for (const ev of drainEvents(world)) {
    const p = dogPos(world.dog);
    const sx = p.x;
    const sy = toScreenY(p.y, world.camY) - 70;
    switch (ev.type) {
      case 'jump': play('jump'); break;
      case 'land': play('land'); break;
      case 'hotdog': play('hotdog'); addPop(sx, sy, `+${ev.amount}`); break;
      case 'escape':
        play('escape');
        addPop(sx, sy - 30, `ESCAPE +${CFG.hotdog.perEscape}`, '#7ed321');
        break;
      case 'hit': play('hit'); addPop(sx, sy, 'OUCH', '#ff6b6b'); break;
      case 'summit': play('summit'); break;
      default: break;
    }
  }
}

// Fire the steam hiss when a vent enters buildup near the dog, so the warning
// has an audio channel too.
let hissCooldown = 0;
function ambientAudio(dt) {
  hissCooldown -= dt;
  if (hissCooldown > 0 || world.state !== STATE.PLAYING) return;
  const r = world.dog.rung;
  for (let i = r; i <= Math.min(CFG.totalRungs, r + 2); i++) {
    for (const side of ['L', 'R']) {
      const slot = world.level.rungs[i]?.slots[side];
      if (slot?.vent?.justBurst) { play('burst'); hissCooldown = 90; return; }
      if (slot?.vent?.phase === 'BUILDUP' && slot.vent.t < 40) {
        play('hiss');
        hissCooldown = 260;
        return;
      }
    }
  }
}

startLoop({
  update(dt) {
    step(world, dt);
    stepFx(dt, world);
    ambientAudio(dt);
    handleEvents();
  },
  render(_alpha, stats) {
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, CFG.logicalW, CFG.logicalH);
    renderScene(ctx, assets, world);
    renderHud(ctx, assets, world, stats, showDebug);
  },
});

// handy for poking at a live run from the console
window.__hotdog = { world, assets, CFG, audioInfo, audioStatus };
