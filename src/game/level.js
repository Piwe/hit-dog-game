// Level generation. One ladder of rungs, each with a left and a right slot.

import { CFG } from '../config.js';
import { makeRng } from '../core/rng.js';
import { createVent } from './vent.js';

export const SLOT = {
  EMPTY: 'empty',     // bare ledge, always safe
  INERT: 'inert',     // decorative cloud, never vents
  VENT: 'vent',       // runs the vent cycle
};

/** Decorative cloud sprite variants, so inert slots aren't all identical. */
const INERT_FRAMES = ['cloud_plain_a', 'cloud_plain_b', 'cloud_plain_c'];

/**
 * Build the climb.
 *
 * The one rule that matters: a rung never gets a vent in BOTH slots. There is
 * always a survivable line up the mountain. Without this the generator will
 * eventually produce an unwinnable rung and the game reads as broken rather
 * than hard.
 */
export function generateLevel(seed) {
  const rng = makeRng(seed);
  const rungs = [];

  for (let r = 0; r <= CFG.totalRungs; r++) {
    const slots = {};
    for (const side of ['L', 'R']) {
      // rung 0 is the starting ledge and is always safe on both sides
      const kind = r === 0 ? SLOT.EMPTY : rng.weighted(CFG.slotWeights);
      slots[side] = {
        rung: r,
        side,
        kind,
        frame: kind === SLOT.INERT ? rng.pick(INERT_FRAMES) : null,
        vent: kind === SLOT.VENT ? createVent(rng) : null,
      };
    }

    // enforce the fairness rule
    if (slots.L.kind === SLOT.VENT && slots.R.kind === SLOT.VENT) {
      const spare = rng.next() < 0.5 ? 'L' : 'R';
      slots[spare].kind = rng.next() < 0.5 ? SLOT.EMPTY : SLOT.INERT;
      slots[spare].vent = null;
      slots[spare].frame =
        slots[spare].kind === SLOT.INERT ? rng.pick(INERT_FRAMES) : null;
    }

    rungs.push({ index: r, slots });
  }

  return { seed, rungs, rng };
}

export const slotAt = (level, rung, side) =>
  level.rungs[rung] ? level.rungs[rung].slots[side] : null;

export const otherSide = (side) => (side === 'L' ? 'R' : 'L');
