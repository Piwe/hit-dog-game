// Fixed-timestep loop with interpolated rendering.
//
// Vent timing and the speed slider must behave identically on a 60 Hz laptop
// and a 144 Hz monitor, so the simulation always advances in equal steps and
// only the draw call sees the leftover time.

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 250;   // after a tab-switch, drop the backlog rather than
                            // fast-forwarding the player into a burst

export function startLoop({ update, render }) {
  let last = performance.now();
  let acc = 0;
  let raf = 0;

  const stats = { fps: 0, stepsLastFrame: 0, frameMs: 0 };
  let fpsAcc = 0;
  let fpsFrames = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    let elapsed = now - last;
    last = now;
    stats.frameMs = elapsed;
    if (elapsed > MAX_FRAME_MS) elapsed = STEP_MS;

    acc += elapsed;
    let steps = 0;
    while (acc >= STEP_MS) {
      update(STEP_MS);
      acc -= STEP_MS;
      if (++steps > 8) { acc = 0; break; }   // spiral-of-death guard
    }
    stats.stepsLastFrame = steps;

    fpsAcc += elapsed;
    fpsFrames++;
    if (fpsAcc >= 500) {
      stats.fps = Math.round((fpsFrames * 1000) / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }

    render(acc / STEP_MS, stats);
  }

  raf = requestAnimationFrame(frame);
  return { stats, stop: () => cancelAnimationFrame(raf) };
}
