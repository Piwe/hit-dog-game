// The simulation. Owns level, dog, camera, score and the game state machine.
//
// This module must remain steppable with no renderer attached - that is what
// makes the logic testable and what makes the speed slider trustworthy. It
// imports nothing from render/ and touches no canvas.

import { CFG, clamp, graceMsFor, rungWorldY } from '../config.js';
import { generateLevel, slotAt, otherSide, SLOT } from './level.js';
import { createDog, dogPos, startJump, stepDog, addAgility, DOG } from './dog.js';
import { stepVent, isLethal, PHASE } from './vent.js';

export const STATE = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  SUMMIT: 'SUMMIT',
};

export function createWorld(seed = (Math.random() * 1e9) | 0) {
  const world = {
    state: STATE.MENU,
    seed,
    level: generateLevel(seed),
    dog: createDog(),
    speed: CFG.speed.default,
    hotdogs: 0,
    camY: 0,
    elapsed: 0,
    buffered: null,          // { side, ageMs }
    events: [],              // drained by audio/fx each frame
    best: null,
    shake: 0,
  };
  world.camY = targetCamY(world);
  return world;
}

export function resetWorld(world, seed = (Math.random() * 1e9) | 0) {
  const speed = world.speed;
  const best = world.best;
  Object.assign(world, createWorld(seed));
  world.speed = speed;       // slider persists across runs
  world.best = best;
  return world;
}

function targetCamY(world) {
  const { y } = dogPos(world.dog);
  // keep the dog at camDogScreenFrac down the screen
  return y - CFG.logicalH * (1 - CFG.camDogScreenFrac);
}

function emit(world, type, data) {
  world.events.push({ type, ...data });
}

/** Queue a jump. Presses during flight are buffered so landings feel responsive. */
export function requestJump(world, side) {
  if (world.state !== STATE.PLAYING) return;
  const { dog } = world;
  if (dog.state === DOG.GROUND) {
    if (startJump(dog, side)) {
      world.buffered = null;
      emit(world, 'jump', { side });
    }
  } else if (dog.state === DOG.AIR) {
    world.buffered = { side, ageMs: 0 };
  }
}

export function setSpeed(world, v) {
  world.speed = clamp(v, CFG.speed.min, CFG.speed.max);
}

function applyHit(world, slot) {
  const { dog } = world;
  addAgility(dog, CFG.agility.perHit);
  dog.rung = Math.max(0, dog.rung - CFG.hit.knockdownRungs);
  dog.state = DOG.STUN;
  dog.stunT = 420;
  dog.iframe = CFG.hit.iframeMs;
  dog.graceT = 0;
  world.shake = 1;
  emit(world, 'hit', { rung: slot.rung, side: slot.side });
}

function awardLanding(world) {
  const { dog, level } = world;
  world.hotdogs += CFG.hotdog.perRung;
  addAgility(dog, CFG.agility.perHotDog);
  emit(world, 'hotdog', { amount: CFG.hotdog.perRung });

  // Escape bonus: the slot you did NOT pick is erupting right now, so the
  // choice demonstrably mattered.
  const twin = slotAt(level, dog.rung, otherSide(dog.side));
  if (twin && twin.kind === SLOT.VENT && isLethal(twin.vent)) {
    world.hotdogs += CFG.hotdog.perEscape;
    addAgility(dog, CFG.agility.perEscape);
    emit(world, 'escape', { rung: dog.rung });
  }
}

export function step(world, dtMs) {
  if (world.state === STATE.PLAYING) world.elapsed += dtMs;

  // Vents keep breathing behind the menu and the pause screen so the world
  // never looks frozen, but nothing can hurt the dog outside PLAYING.
  const live = world.state === STATE.PLAYING || world.state === STATE.MENU;
  if (live || world.state === STATE.SUMMIT) {
    for (const rung of world.level.rungs) {
      for (const side of ['L', 'R']) {
        const slot = rung.slots[side];
        if (slot.vent) stepVent(slot.vent, dtMs, world.speed, world.level.rng);
      }
    }
  }

  if (world.state === STATE.PLAYING) {
    const { dog } = world;

    const landing = stepDog(dog, dtMs);
    if (landing) {
      emit(world, 'land', { rung: dog.rung, side: dog.side });
      awardLanding(world);
      if (dog.rung >= CFG.totalRungs) {
        world.state = STATE.SUMMIT;
        world.best = world.best === null
          ? world.hotdogs
          : Math.max(world.best, world.hotdogs);
        emit(world, 'summit', { hotdogs: world.hotdogs });
      }
    }

    // buffered input fires the moment the dog is grounded again
    if (world.buffered) {
      world.buffered.ageMs += dtMs;
      if (world.buffered.ageMs > CFG.inputBufferMs) {
        world.buffered = null;
      } else if (dog.state === DOG.GROUND) {
        const side = world.buffered.side;
        world.buffered = null;
        if (startJump(dog, side)) emit(world, 'jump', { side });
      }
    }

    // ---- danger ---------------------------------------------------------
    // Collision is slot-based: standing on a bursting slot is what hurts.
    // Agility buys a grace window rather than a smaller hitbox, so a nimble
    // dog can hop clear of a burst that a sluggish one cannot.
    if (dog.state === DOG.GROUND && dog.iframe <= 0) {
      const here = slotAt(world.level, dog.rung, dog.side);
      if (here && here.kind === SLOT.VENT && isLethal(here.vent)) {
        dog.graceT += dtMs;
        if (dog.graceT >= graceMsFor(dog.agility)) applyHit(world, here);
      } else {
        dog.graceT = 0;
      }
    } else if (dog.state !== DOG.GROUND) {
      dog.graceT = 0;
    }
  }

  // ---- camera -----------------------------------------------------------
  const want = Math.max(0, targetCamY(world));
  world.camY += (want - world.camY) * Math.min(1, CFG.camLerp * (dtMs / 16.67));
  if (world.shake > 0) world.shake = Math.max(0, world.shake - dtMs / 260);

  return world;
}

export function drainEvents(world) {
  const e = world.events;
  world.events = [];
  return e;
}

/** Progress up the mountain, 0..1 - used by the HUD. */
export const progress = (world) =>
  clamp(world.dog.rung / CFG.totalRungs, 0, 1);

export { dogPos, rungWorldY, PHASE };
