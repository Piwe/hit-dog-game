// The dog: jump tween, agility, and the derived stats agility drives.
// Pure logic - positions are world coordinates, never screen pixels.

import { CFG, clamp, lerp, jumpMsFor, slotX, rungWorldY } from '../config.js';

export const DOG = {
  GROUND: 'GROUND',
  AIR: 'AIR',
  STUN: 'STUN',
};

export function createDog() {
  return {
    state: DOG.GROUND,
    rung: 0,
    side: 'L',
    facing: 'R',          // which way the sprite looks
    from: { rung: 0, side: 'L' },
    to: { rung: 0, side: 'L' },
    t: 0,                 // ms into the current jump
    dur: 0,
    agility: 0,
    iframe: 0,            // ms of invulnerability remaining
    graceT: 0,            // ms stood in a live burst, vs graceMsFor(agility)
    stunT: 0,
  };
}

/** Interpolated world position. */
export function dogPos(dog) {
  if (dog.state !== DOG.AIR) {
    return { x: slotX(dog.side), y: rungWorldY(dog.rung) };
  }
  const p = clamp(dog.t / dog.dur, 0, 1);
  const x = lerp(slotX(dog.from.side), slotX(dog.to.side), p);
  const base = lerp(rungWorldY(dog.from.rung), rungWorldY(dog.to.rung), p);
  // parabolic hop on top of the straight line
  return { x, y: base + Math.sin(Math.PI * p) * CFG.jump.arc };
}

/** Begin a jump to the given side of the next rung up. Returns true if started. */
export function startJump(dog, side) {
  if (dog.state !== DOG.GROUND) return false;
  dog.from = { rung: dog.rung, side: dog.side };
  dog.to = { rung: dog.rung + 1, side };
  dog.facing = side === dog.from.side
    ? dog.facing                 // straight-up hop keeps the current facing
    : (side === 'R' ? 'R' : 'L');
  dog.state = DOG.AIR;
  dog.t = 0;
  dog.dur = jumpMsFor(dog.agility);
  dog.graceT = 0;
  return true;
}

/** Advance timers. Landing is reported to the caller rather than handled here. */
export function stepDog(dog, dtMs) {
  if (dog.iframe > 0) dog.iframe = Math.max(0, dog.iframe - dtMs);

  if (dog.state === DOG.STUN) {
    dog.stunT -= dtMs;
    if (dog.stunT <= 0) dog.state = DOG.GROUND;
    return null;
  }

  if (dog.state === DOG.AIR) {
    dog.t += dtMs;
    if (dog.t >= dog.dur) {
      dog.rung = dog.to.rung;
      dog.side = dog.to.side;
      dog.state = DOG.GROUND;
      dog.t = dog.dur;
      return { landed: true, rung: dog.rung, side: dog.side };
    }
  }
  return null;
}

export function addAgility(dog, delta) {
  dog.agility = clamp(dog.agility + delta, 0, 1);
}

// Frame selection lives in render/dogAnim.js - it is presentation, and it
// needs animation clocks (landing squash) the simulation has no business
// carrying.
