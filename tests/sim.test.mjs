// Headless simulation tests. Plain node, no dependencies:
//
//     node tests/sim.test.mjs
//
// These only exercise game/ and core/, which is the point of keeping the
// simulation free of canvas access.

import assert from 'node:assert/strict';

import { CFG, jumpMsFor, graceMsFor } from '../src/config.js';
import { makeRng } from '../src/core/rng.js';
import { generateLevel, SLOT } from '../src/game/level.js';
import { createVent, stepVent, PHASE, isLethal } from '../src/game/vent.js';
import { createDog, startJump, stepDog, addAgility, DOG } from '../src/game/dog.js';
import { createWorld, step, requestJump, setSpeed, STATE, drainEvents } from '../src/game/world.js';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(['ok', name]);
  } catch (err) {
    failed++;
    results.push(['FAIL', `${name}\n      ${err.message.split('\n')[0]}`]);
  }
}

// ---------------------------------------------------------------------------
// THE invariant. If this fails the game is unfair and no art can rescue it:
// a dog committed to a jump before the warning appears cannot react to it.
// ---------------------------------------------------------------------------
test('telegraph always outlasts the slowest jump, at every speed and agility', () => {
  for (let speed = CFG.speed.min; speed <= CFG.speed.max + 1e-9; speed += 0.05) {
    for (let ag = 0; ag <= 1.0001; ag += 0.05) {
      const buildup = CFG.vent.buildupMs / speed;
      const jump = jumpMsFor(ag);
      assert.ok(
        buildup > jump,
        `speed ${speed.toFixed(2)} agility ${ag.toFixed(2)}: ` +
        `buildup ${buildup.toFixed(0)}ms <= jump ${jump.toFixed(0)}ms`,
      );
    }
  }
});

test('vent cycles IDLE -> BUILDUP -> BURST -> COOLDOWN in order', () => {
  const rng = makeRng(1);
  const v = createVent(rng);
  v.phase = PHASE.IDLE;
  v.t = 0;
  v.duration = 100;
  const seen = [];
  for (let i = 0; i < 4000 && seen.length < 5; i++) {
    const before = v.phase;
    stepVent(v, 16.67, 1, rng);
    if (v.phase !== before) seen.push(v.phase);
  }
  assert.deepEqual(seen.slice(0, 4),
    [PHASE.BUILDUP, PHASE.BURST, PHASE.COOLDOWN, PHASE.IDLE]);
});

test('a burst is never skipped, even at a huge speed scale', () => {
  const rng = makeRng(7);
  const v = createVent(rng);
  let bursts = 0;
  // one enormous tick per step; the while-loop in stepVent must still catch
  // every BURST it crosses rather than stepping over the hazard
  for (let i = 0; i < 500; i++) {
    stepVent(v, 200, CFG.speed.max, rng);
    if (v.justBurst) bursts++;
  }
  assert.ok(bursts > 5, `expected repeated bursts, saw ${bursts}`);
});

test('level generation never puts a vent in both slots of a rung', () => {
  for (let seed = 0; seed < 400; seed++) {
    const level = generateLevel(seed);
    for (const rung of level.rungs) {
      const both = rung.slots.L.kind === SLOT.VENT && rung.slots.R.kind === SLOT.VENT;
      assert.ok(!both, `seed ${seed} rung ${rung.index} has two vents`);
    }
  }
});

test('rung 0 is always safe on both sides', () => {
  for (let seed = 0; seed < 100; seed++) {
    const level = generateLevel(seed);
    assert.equal(level.rungs[0].slots.L.kind, SLOT.EMPTY);
    assert.equal(level.rungs[0].slots.R.kind, SLOT.EMPTY);
  }
});

test('the same seed produces an identical level', () => {
  const shape = (lv) => lv.rungs.map((r) => `${r.slots.L.kind}${r.slots.R.kind}`).join();
  assert.equal(shape(generateLevel(12345)), shape(generateLevel(12345)));
  assert.notEqual(shape(generateLevel(12345)), shape(generateLevel(999)));
});

test('agility clamps to [0,1] at both ends', () => {
  const dog = createDog();
  for (let i = 0; i < 200; i++) addAgility(dog, 0.1);
  assert.equal(dog.agility, 1);
  for (let i = 0; i < 200; i++) addAgility(dog, -0.1);
  assert.equal(dog.agility, 0);
});

test('agility makes the jump faster and the grace window longer', () => {
  assert.ok(jumpMsFor(1) < jumpMsFor(0), 'agile dog should jump faster');
  assert.ok(graceMsFor(1) > graceMsFor(0), 'agile dog should get more grace');
  assert.equal(jumpMsFor(0), CFG.jump.maxMs);
  assert.equal(jumpMsFor(1), CFG.jump.minMs);
});

test('a jump advances exactly one rung and lands on the chosen side', () => {
  const dog = createDog();
  assert.ok(startJump(dog, 'R'));
  assert.equal(dog.state, DOG.AIR);
  let landing = null;
  for (let i = 0; i < 200 && !landing; i++) landing = stepDog(dog, 16.67);
  assert.ok(landing, 'never landed');
  assert.equal(dog.rung, 1);
  assert.equal(dog.side, 'R');
  assert.equal(dog.state, DOG.GROUND);
});

test('a second jump is refused while airborne', () => {
  const dog = createDog();
  startJump(dog, 'L');
  assert.equal(startJump(dog, 'R'), false);
  assert.equal(dog.to.side, 'L');
});

test('climbing awards a hot dog per rung', () => {
  const world = createWorld(4242);
  world.state = STATE.PLAYING;
  for (let r = 0; r < 5; r++) {
    requestJump(world, r % 2 === 0 ? 'R' : 'L');
    for (let i = 0; i < 120 && world.dog.state !== DOG.GROUND; i++) step(world, 16.67);
    step(world, 16.67);
  }
  assert.ok(world.dog.rung >= 5, `climbed only to ${world.dog.rung}`);
  assert.ok(world.hotdogs >= 5, `earned only ${world.hotdogs}`);
});

test('reaching the top ends in SUMMIT', () => {
  const world = createWorld(31337);
  world.state = STATE.PLAYING;
  world.dog.agility = 1;
  for (let n = 0; n < CFG.totalRungs + 5 && world.state === STATE.PLAYING; n++) {
    // always jump to a side that is not a vent, so the climb is not derailed
    const next = world.level.rungs[Math.min(CFG.totalRungs, world.dog.rung + 1)];
    const safe = next.slots.L.kind === SLOT.VENT ? 'R' : 'L';
    world.dog.iframe = 9999;         // isolate the win condition from damage
    requestJump(world, safe);
    for (let i = 0; i < 200 && world.dog.state !== DOG.GROUND; i++) step(world, 16.67);
    step(world, 16.67);
  }
  assert.equal(world.state, STATE.SUMMIT);
  assert.equal(world.dog.rung, CFG.totalRungs);
});

test('a burst knocks the dog down and costs agility', () => {
  const world = createWorld(5);
  world.state = STATE.PLAYING;
  world.dog.rung = 10;
  world.dog.side = 'L';
  world.dog.agility = 0.5;
  const slot = world.level.rungs[10].slots.L;
  slot.kind = SLOT.VENT;
  slot.vent = createVent(world.level.rng);
  slot.vent.phase = PHASE.BURST;
  slot.vent.t = 0;
  slot.vent.duration = 10000;

  const before = world.dog.agility;
  for (let i = 0; i < 100 && world.dog.state !== DOG.STUN; i++) step(world, 16.67);
  assert.equal(world.dog.state, DOG.STUN, 'never took the hit');
  assert.equal(world.dog.rung, 10 - CFG.hit.knockdownRungs);
  assert.ok(world.dog.agility < before, 'agility should drop on a hit');
  assert.ok(world.dog.iframe > 0, 'should be invulnerable after a hit');
});

test('grace means a nimble dog survives a burst that floors a sluggish one', () => {
  const build = (agility) => {
    const w = createWorld(9);
    w.state = STATE.PLAYING;
    w.dog.rung = 8;
    w.dog.side = 'R';
    w.dog.agility = agility;
    const slot = w.level.rungs[8].slots.R;
    slot.kind = SLOT.VENT;
    slot.vent = createVent(w.level.rng);
    slot.vent.phase = PHASE.BURST;
    slot.vent.t = 0;
    slot.vent.duration = 10000;
    return w;
  };
  const hold = CFG.grace.minMs + 20;      // just past the sluggish dog's grace
  const slow = build(0);
  const fast = build(1);
  for (let t = 0; t < hold; t += 16.67) { step(slow, 16.67); step(fast, 16.67); }
  assert.equal(slow.dog.state, DOG.STUN, 'sluggish dog should have been hit');
  assert.notEqual(fast.dog.state, DOG.STUN, 'nimble dog should still be standing');
});

test('the speed slider clamps to its configured range', () => {
  const world = createWorld(1);
  setSpeed(world, 99);
  assert.equal(world.speed, CFG.speed.max);
  setSpeed(world, -5);
  assert.equal(world.speed, CFG.speed.min);
});

test('nothing can hurt the dog while paused', () => {
  const world = createWorld(11);
  world.state = STATE.PLAYING;
  world.dog.rung = 6;
  world.dog.side = 'L';
  const slot = world.level.rungs[6].slots.L;
  slot.kind = SLOT.VENT;
  slot.vent = createVent(world.level.rng);
  slot.vent.phase = PHASE.BURST;
  slot.vent.t = 0;
  slot.vent.duration = 10000;
  world.state = STATE.PAUSED;
  for (let i = 0; i < 200; i++) step(world, 16.67);
  assert.notEqual(world.dog.state, DOG.STUN);
});

test('the simulation runs with no canvas, DOM or timer present', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const world = createWorld(77);
  world.state = STATE.PLAYING;
  for (let i = 0; i < 600; i++) step(world, 16.67);
  drainEvents(world);
  assert.ok(world.elapsed > 0);
});

// ---------------------------------------------------------------------------
for (const [status, name] of results) {
  console.log(`  ${status === 'ok' ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}`);
}
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
