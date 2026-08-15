// The commentator: decides WHEN to speak, and picks the line.
//
// Lines come from assets/audio/commentary.json (Gemini-written, ElevenLabs-
// voiced, both at build time). If a line has no audio file it still shows as a
// caption, so the whole feature works with no API key.
//
// Restraint is the entire design problem here. A commentator that reacts to
// every jump is unbearable within thirty seconds, so this enforces a global
// cooldown, a priority ordering, and a shuffle-bag per category so lines do
// not repeat back to back.
//
// Presentation only: it reads world state and never mutates it.

import { CFG } from '../config.js';
import { playVoice, voiceDuration } from './audio.js';

// Higher wins when two moments land on the same tick. The cooldown is the
// minimum gap before a line of THAT priority may interrupt the quiet.
const CATEGORIES = {
  summit:   { priority: 100, cooldown: 0 },
  hit:      { priority: 80, cooldown: 2500 },
  escape:   { priority: 60, cooldown: 5000 },
  struggle: { priority: 50, cooldown: 12000 },
  near:     { priority: 45, cooldown: 6000 },
  half:     { priority: 40, cooldown: 6000 },
  streak:   { priority: 30, cooldown: 9000 },
  start:    { priority: 90, cooldown: 0 },
};

const CAPTION_MS = 2600;
const STREAK_RUNGS = 6;

let bank = null;              // { category: [{ text, file }] }
const bags = new Map();       // category -> shuffled index queue
let sinceLine = 1e6;
let caption = null;           // { text, ttl }
let fired = new Set();        // one-shot categories this run
let lastRung = 0;
let cleanRungs = 0;
let hits = 0;
const fires = {};        // category -> times spoken, for the debug overlay
let lastSkip = null;     // why the most recent candidate was suppressed

export function setCommentary(manifest) {
  bank = manifest && manifest.categories ? manifest.categories : null;
  return !!bank;
}

export const hasCommentary = () => !!bank;

export function resetCommentary() {
  bags.clear();
  fired = new Set();
  for (const k of Object.keys(fires)) delete fires[k];
  sinceLine = 1e6;
  caption = null;
  lastRung = 0;
  cleanRungs = 0;
  hits = 0;
}

/** Shuffle bag: every line plays once before any repeats. */
function pickLine(cat) {
  const lines = bank[cat];
  if (!lines || !lines.length) return null;
  let bag = bags.get(cat);
  if (!bag || !bag.length) {
    bag = lines.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    bags.set(cat, bag);
  }
  const index = bag.pop();
  return { cat, index, ...lines[index] };
}

/**
 * Work out which moments are live this tick.
 * Derived state (streaks, milestones) lives here rather than in the
 * simulation, because it is commentary, not game rules.
 */
function candidates(world, events) {
  const out = [];
  const { dog } = world;

  for (const ev of events) {
    if (ev.type === 'summit') out.push('summit');
    else if (ev.type === 'hit') out.push('hit');
    else if (ev.type === 'escape') out.push('escape');
  }

  if (dog.rung > lastRung) cleanRungs += dog.rung - lastRung;
  lastRung = dog.rung;

  if (events.some((e) => e.type === 'hit')) {
    cleanRungs = 0;
    hits++;
  }

  // Detection must have no side effects. Consuming the streak counter here
  // meant a streak suppressed by cooldown was silently eaten and could never
  // fire; the counter is now cleared only when the line actually plays.
  if (cleanRungs >= STREAK_RUNGS) out.push('streak');

  const half = Math.floor(CFG.totalRungs / 2);
  if (dog.rung >= half && !fired.has('half')) out.push('half');
  if (dog.rung >= CFG.totalRungs - 5 && !fired.has('near')) out.push('near');

  if (hits >= 2 && dog.agility < 0.25) out.push('struggle');
  if (!fired.has('start') && world.elapsed > 400) out.push('start');

  return out;
}

/** Call once per fixed step, after the world has stepped. */
export function stepCommentary(world, events, dtMs) {
  sinceLine += dtMs;
  if (caption) {
    caption.ttl -= dtMs;
    if (caption.ttl <= 0) caption = null;
  }
  if (!bank) return;

  const live = candidates(world, events);
  if (!live.length) return;

  live.sort((a, b) => (CATEGORIES[b]?.priority ?? 0) - (CATEGORIES[a]?.priority ?? 0));
  const cat = live[0];
  const rule = CATEGORIES[cat];
  if (!rule || sinceLine < rule.cooldown) {
    lastSkip = `${cat}: cooldown ${Math.round(sinceLine)}/${rule ? rule.cooldown : '?'}`;
    return;
  }

  const line = pickLine(cat);
  if (!line) { lastSkip = `${cat}: no lines`; return; }
  lastSkip = null;
  fires[cat] = (fires[cat] || 0) + 1;

  // one-shot moments never fire twice in a run
  if (cat === 'start' || cat === 'half' || cat === 'near') fired.add(cat);
  if (cat === 'streak') cleanRungs = 0;

  sinceLine = 0;
  const spoken = line.file ? playVoice(`vo:${cat}:${line.index}`) : 0;
  caption = {
    text: line.text,
    ttl: Math.max(CAPTION_MS, spoken ? voiceDuration(`vo:${cat}:${line.index}`) * 1000 + 400 : 0),
  };
}

export const currentCaption = () => caption;

/** Diagnostics for the debug overlay and tests. */
export const commentaryStatus = () => ({
  sinceLine: Math.round(sinceLine),
  fires: { ...fires },
  lastSkip,
  cleanRungs,
  hits,
});
