// The cloud vent state machine.
//
// IDLE -> BUILDUP -> BURST -> COOLDOWN -> IDLE
//        (telegraph) (lethal)  (safe)
//
// Only BURST is dangerous. BUILDUP is the player's entire warning, which is
// why CFG.vent.buildupMs is constrained against the slowest possible jump.
//
// Pure logic - no canvas, no asset access. See CFG comments in config.js.

import { CFG } from '../config.js';

export const PHASE = {
  IDLE: 'IDLE',
  BUILDUP: 'BUILDUP',
  BURST: 'BURST',
  COOLDOWN: 'COOLDOWN',
};

/** Sprite frame for each phase; BUILDUP ramps across two frames. */
export function ventFrame(vent) {
  switch (vent.phase) {
    case PHASE.IDLE:
      return 'vent_idle';
    case PHASE.BUILDUP:
      return vent.t / vent.duration < 0.5 ? 'vent_build_1' : 'vent_build_2';
    case PHASE.BURST:
      return 'vent_burst';
    case PHASE.COOLDOWN:
      return vent.t / vent.duration < 0.5 ? 'vent_cool_1' : 'vent_cool_2';
    default:
      return 'vent_idle';
  }
}

export function createVent(rng) {
  const v = {
    phase: PHASE.IDLE,
    t: 0,
    duration: 0,
    idleMs: rng.range(CFG.vent.idleMinMs, CFG.vent.idleMaxMs),
    burstCount: 0,
    justBurst: false,        // true on the tick BURST begins
  };
  v.duration = v.idleMs;
  // Stagger the start so a screenful of vents doesn't pulse in unison.
  v.t = rng.range(0, v.idleMs);
  return v;
}

function phaseDuration(vent, phase, rng) {
  switch (phase) {
    case PHASE.IDLE:
      return rng.range(CFG.vent.idleMinMs, CFG.vent.idleMaxMs);
    case PHASE.BUILDUP:
      return CFG.vent.buildupMs;
    case PHASE.BURST:
      return CFG.vent.burstMs;
    case PHASE.COOLDOWN:
      return CFG.vent.cooldownMs;
    default:
      return 1000;
  }
}

const NEXT = {
  [PHASE.IDLE]: PHASE.BUILDUP,
  [PHASE.BUILDUP]: PHASE.BURST,
  [PHASE.BURST]: PHASE.COOLDOWN,
  [PHASE.COOLDOWN]: PHASE.IDLE,
};

/**
 * Advance one vent.
 * @param dtMs   real elapsed ms
 * @param speed  CFG.speed scale - the slider only ever affects vent cadence
 */
export function stepVent(vent, dtMs, speed, rng) {
  vent.justBurst = false;
  vent.t += dtMs * speed;
  // `while`, not `if`: a very high speed scale can cross a whole short phase
  // inside one tick, and skipping BURST would silently drop a hazard.
  while (vent.t >= vent.duration) {
    vent.t -= vent.duration;
    vent.phase = NEXT[vent.phase];
    vent.duration = phaseDuration(vent, vent.phase, rng);
    if (vent.phase === PHASE.BURST) {
      vent.justBurst = true;
      vent.burstCount++;
    }
  }
  return vent;
}

export const isLethal = (vent) => vent && vent.phase === PHASE.BURST;

/** How long this vent has been bursting, in scaled ms. */
export const burstAge = (vent) => (isLethal(vent) ? vent.t : 0);
