// Every tunable in the game. Behaviour files import from here and never
// hard-code a number - tuning is most of the remaining work and it needs to
// happen in one place.

export const CFG = {
  // ---- presentation ------------------------------------------------------
  logicalW: 960,
  logicalH: 640,

  // ---- climb geometry ----------------------------------------------------
  // Validated against tools/preview.py: the two mountains hug the screen edges
  // and ledges jut into the valley, so the dog is always read against sky.
  rungH: 110,
  totalRungs: 30,
  groundY: 240,             // world y of rung 0 (world y grows upward)
  wallInnerL: 280,
  wallInnerR: 680,
  leftX: 326,
  rightX: 634,
  ledgeW: 170,
  ledgeLX: 220,             // screen x of the left ledge's left edge
  ledgeRX: 570,
  dogH: 96,
  cloudW: 168,
  // Clouds hang below the ledge they threaten. At a smaller offset the cloud
  // body swallows the ledge entirely and the dog reads as standing on the
  // cloud - which removes the whole visual premise of climbing a mountain.
  ventYOffset: 88,
  capeW: 130,

  // ---- camera ------------------------------------------------------------
  camDogScreenFrac: 0.65,   // keep the dog this far down the screen
  camLerp: 0.14,

  // ---- jump --------------------------------------------------------------
  // maxMs is the slowest the dog can ever be; the vent telegraph is tuned
  // against it (see tests/sim.test.mjs).
  jump: { minMs: 200, maxMs: 560, arc: 78 },
  inputBufferMs: 180,       // a press during flight still counts on landing

  // ---- vents -------------------------------------------------------------
  // buildupMs is the player's entire warning. It must stay longer than the
  // slowest possible jump at the fastest speed setting, or the player commits
  // before the warning appears. Asserted in the test suite.
  vent: {
    buildupMs: 1200,
    burstMs: 450,
    cooldownMs: 700,
    idleMinMs: 700,
    idleMaxMs: 1800,
  },

  // ---- level generation --------------------------------------------------
  slotWeights: { empty: 0.35, inert: 0.30, vent: 0.35 },

  // ---- progression -------------------------------------------------------
  agility: { perHotDog: 0.03, perEscape: 0.05, perHit: -0.18 },
  hotdog: { perRung: 1, perEscape: 3 },
  escapeWindowMs: 400,

  // Agility buys reaction time rather than a smaller hitbox: collision here is
  // slot-based, so a spatial radius would have nothing to shrink against. The
  // grace window is the same idea expressed in time, and it is far more
  // legible in a timing game.
  grace: { minMs: 60, maxMs: 260 },

  hit: { knockdownRungs: 2, iframeMs: 1200 },

  // ---- speed slider ------------------------------------------------------
  // Scales vent cadence only. It never touches jump speed or input handling,
  // so the controls feel identical at every setting.
  speed: { min: 0.6, max: 1.5, default: 1.0 },
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** World y of a rung's ledge surface. */
export const rungWorldY = (rung) => CFG.groundY + rung * CFG.rungH;

/** Screen x of a slot. */
export const slotX = (side) => (side === 'L' ? CFG.leftX : CFG.rightX);

/** Jump duration at a given agility, in ms. */
export const jumpMsFor = (agility) =>
  lerp(CFG.jump.maxMs, CFG.jump.minMs, clamp(agility, 0, 1));

/** Grace period before a burst actually connects, in ms. */
export const graceMsFor = (agility) =>
  lerp(CFG.grace.minMs, CFG.grace.maxMs, clamp(agility, 0, 1));
