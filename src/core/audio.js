// Procedural sound effects via WebAudio.
//
// The art packs shipped no audio, and silence hurts a timing game - the steam
// hiss is a second telegraph channel for players who miss the visual one.
// Synthesising the set keeps the project at zero asset dependencies; swap in
// real samples later behind the same play() interface.

let ctx = null;
let master = null;
let enabled = true;

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { enabled = false; return null; }
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  decodePending();      // samples fetched before the first gesture
  return ctx;
}

/** Browsers require a gesture before audio starts. */
export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  enabled = !m;
  if (master) master.gain.value = m ? 0 : 0.35;
}

export const isMuted = () => !enabled;

function env(node, t0, attack, decay, peak = 1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  node.connect(g);
  g.connect(master);
  return g;
}

function tone(freqFrom, freqTo, dur, type = 'sine', peak = 0.5, delay = 0) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freqFrom, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + dur);
  env(o, t0, 0.01, dur, peak);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur, filterFrom, filterTo, peak = 0.4, delay = 0) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + delay;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(filterFrom, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
  f.Q.value = 1.2;
  src.connect(f);
  env(f, t0, 0.01, dur, peak);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export const SFX = {
  jump:   () => tone(300, 620, 0.14, 'triangle', 0.35),
  land:   () => { tone(180, 90, 0.10, 'sine', 0.35); noise(0.07, 900, 300, 0.15); },
  hotdog: () => { tone(720, 980, 0.07, 'square', 0.16); tone(980, 1250, 0.07, 'square', 0.14, 0.06); },
  escape: () => { tone(680, 1020, 0.09, 'triangle', 0.3); tone(1020, 1500, 0.1, 'triangle', 0.26, 0.08); },
  burst:  () => { noise(0.34, 2600, 220, 0.5); tone(220, 60, 0.3, 'sawtooth', 0.28); },
  hiss:   () => noise(0.5, 5200, 2400, 0.13),
  hit:    () => { tone(420, 70, 0.4, 'sawtooth', 0.45); noise(0.3, 1500, 200, 0.3); },
  summit: () => [0, 0.12, 0.24, 0.42].forEach((d, i) =>
            tone([523, 659, 784, 1047][i], [523, 659, 784, 1047][i], 0.3, 'triangle', 0.34, d)),
};

// ---------------------------------------------------------------------------
// Generated samples (tools/audio_gen.py -> ElevenLabs)
//
// Samples are fetched WITHOUT an AudioContext, because a context cannot exist
// until the first user gesture. The bytes are decoded later, once initAudio()
// has run. Any cue with no sample keeps using the synth above, so a partial or
// absent generation is always safe to ship.
// ---------------------------------------------------------------------------

const AUDIO_BASE = 'assets/audio/';
const raw = new Map();        // name -> ArrayBuffer, pending decode
const buffers = new Map();    // name -> AudioBuffer, ready to play
let musicSource = null;
let musicGain = null;
let musicWanted = false;

/** Fetch the generated audio, if any was built. Safe to call before any gesture. */
export async function preloadAudio() {
  let manifest;
  try {
    const r = await fetch(AUDIO_BASE + 'manifest.json');
    if (!r.ok) return { sfx: 0, music: 0 };   // never generated: synth only
    manifest = await r.json();
  } catch (_) {
    return { sfx: 0, music: 0 };
  }

  const entries = Object.entries(manifest.sfx || {})
    .concat(Object.entries(manifest.music || {}).map(([k, v]) => [`music:${k}`, v]));

  await Promise.all(entries.map(async ([name, file]) => {
    try {
      const r = await fetch(AUDIO_BASE + file);
      if (r.ok) raw.set(name, await r.arrayBuffer());
    } catch (_) { /* fall back to synth for this cue */ }
  }));

  if (ctx) decodePending();
  return {
    sfx: Object.keys(manifest.sfx || {}).length,
    music: Object.keys(manifest.music || {}).length,
  };
}

function decodePending() {
  for (const [name, bytes] of raw) {
    raw.delete(name);
    // decodeAudioData detaches the buffer, so slice a copy to stay retryable
    ctx.decodeAudioData(bytes.slice(0))
      .then((buf) => {
        buffers.set(name, buf);
        // startMusic() usually runs on the same gesture that creates the
        // context, before decoding finishes, so it finds no buffer and gives
        // up. Retry here for EITHER loop source - keying this to music:climb
        // alone left an ambience-only build permanently silent.
        if (musicWanted && !musicSource &&
            (name === 'music:climb' || name === 'ambience')) startMusic();
      })
      .catch(() => { /* corrupt or unsupported: synth handles this cue */ });
  }
}

function playBuffer(name, gain = 1) {
  const buf = buffers.get(name);
  if (!buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(master);
  src.start();
  return true;
}

export function play(name) {
  if (!ctx || !enabled) return;
  if (playBuffer(name)) return;     // generated sample wins when present
  const fn = SFX[name];
  if (fn) fn();                     // otherwise the synthesised fallback
}

/** Loop the ambience bed and music track, if they were generated. */
export function startMusic() {
  musicWanted = true;
  if (!ctx || musicSource) return;
  const buf = buffers.get('music:climb') || buffers.get('ambience');
  if (!buf) return;
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.24;      // well under the SFX bus: cues must cut through
  musicSource = ctx.createBufferSource();
  musicSource.buffer = buf;
  musicSource.loop = true;
  musicSource.connect(musicGain);
  musicGain.connect(master);
  musicSource.start();
}

export function stopMusic() {
  musicWanted = false;
  if (musicSource) {
    try { musicSource.stop(); } catch (_) { /* already stopped */ }
    musicSource = null;
  }
}

/** Fetched vs decoded sample counts - surfaced in the debug overlay. */
export const audioStatus = () => ({
  pending: raw.size,
  decoded: buffers.size,
  music: !!musicSource,
});
