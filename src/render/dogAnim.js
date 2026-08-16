// The dog's jump animation.
//
// The art ships three usable body poses - an extended leap (dog_jump_a), a
// tucked one (dog_jump_b) and a resting one (dog_idle). Cycling two of them on
// a timer reads as a flicker, not a jump. What sells a jump is the arc: squash
// on the ground, stretch off the launch, tuck at the apex, stretch again into
// the fall, squash on landing. So this maps jump progress onto both a pose AND
// a squash/stretch/lean, driven around the sprite's foot anchor.
//
// Render-side only: this is presentation timing, so it keeps its own clock
// instead of putting animation state into the simulation.

import { CFG, lerp, slotX } from '../config.js';
import { DOG } from '../game/dog.js';

const LAND_MS = 170;        // landing squash
const TAKEOFF_MS = 90;      // ground compression just before leaving

const anim = {
  prevState: DOG.GROUND,
  landT: 1e6,
  airT: 0,
};

// A purpose-drawn jump cycle from tools/art_gen.py, if it was generated. Real
// frames carry the motion themselves, so the squash and stretch that stands in
// for them is dialled back rather than stacked on top.
let leap = [];

export function setDogFrames(assets) {
  leap = [];
  for (let i = 0; ; i++) {
    const name = `dog_leap_${i}`;
    if (!assets.frames[name]) break;
    leap.push(name);
  }
  return leap.length;
}

export const hasLeapCycle = () => leap.length > 0;

/** Frame for a point in the arc, 0..1. */
const leapAt = (p) =>
  leap[Math.min(leap.length - 1, Math.floor(p * leap.length))];

/** Advance the animation clock. Call once per fixed step. */
export function stepDogAnim(world, dtMs) {
  const s = world.dog.state;
  if (s !== anim.prevState) {
    if (s === DOG.GROUND && anim.prevState === DOG.AIR) anim.landT = 0;
    if (s === DOG.AIR) anim.airT = 0;
    anim.prevState = s;
  }
  anim.landT += dtMs;
  anim.airT += dtMs;
}

export function resetDogAnim() {
  anim.prevState = DOG.GROUND;
  anim.landT = 1e6;
  anim.airT = 0;
}

/**
 * Pose for the current frame.
 * @returns {{frame:string, sx:number, sy:number, rot:number}}
 */
export function dogPose(world) {
  const dog = world.dog;

  // Amplitude scales with agility: the same arc, played harder. This is the
  // animation half of "becomes more agile" - the timing half is jump duration.
  const amp = lerp(0.7, 1.35, dog.agility);
  const shape = (frame, sx, sy, rot) => ({
    frame,
    sx: 1 + (sx - 1) * amp,
    sy: 1 + (sy - 1) * amp,
    rot: rot * amp,
  });

  if (dog.state === DOG.STUN) {
    return { frame: 'dog_hit', sx: 1, sy: 1, rot: 0 };
  }

  if (dog.state === DOG.AIR) {
    const p = Math.min(1, dog.t / dog.dur);
    // Lean into the direction of travel. A straight-up hop has dir 0 and so
    // gets pure squash and stretch with no rotation, which is correct.
    const dir = Math.sign(slotX(dog.to.side) - slotX(dog.from.side));

    if (leap.length) {
      // drawn frames: keep only a light lean and a touch of stretch
      const rise = Math.cos(Math.PI * p);          // +1 launch, -1 landing
      return shape(leapAt(p), 1 - 0.05 * rise, 1 + 0.07 * rise,
                   -0.10 * rise * dir);
    }

    if (p < 0.16) {                       // launch: uncoil, tallest stretch
      const k = p / 0.16;
      return shape('dog_jump_a', lerp(0.84, 0.96, k), lerp(1.20, 1.07, k),
                   -0.20 * dir);
    }
    if (p < 0.48) {                       // rise: relax toward neutral
      const k = (p - 0.16) / 0.32;
      return shape('dog_jump_a', lerp(0.96, 1.0, k), lerp(1.07, 1.0, k),
                   lerp(-0.20, -0.05, k) * dir);
    }
    if (p < 0.62) {                       // apex: tuck, level out
      const k = (p - 0.48) / 0.14;
      return shape('dog_jump_b', lerp(1.0, 1.05, k), lerp(1.0, 0.96, k),
                   lerp(-0.05, 0.05, k) * dir);
    }
    const k = (p - 0.62) / 0.38;          // fall: stretch out, nose down
    return shape('dog_jump_b', lerp(1.05, 0.90, k), lerp(0.96, 1.16, k),
                 lerp(0.05, 0.22, k) * dir);
  }

  // grounded
  if (anim.landT < LAND_MS) {             // impact squash, easing out
    const e = 1 - anim.landT / LAND_MS;
    const s = e * e * 0.32;
    return shape('dog_idle', 1 + s, 1 - s, 0);
  }

  // A settled dog breathes, so the idle pose is not a frozen image.
  const breathe = Math.sin(world.elapsed / 420) * 0.012;
  return { frame: 'dog_idle', sx: 1 - breathe, sy: 1 + breathe, rot: 0 };
}
