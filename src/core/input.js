// Keyboard and pointer input. Translates raw events into game intents; it
// never touches world state directly.

export function createInput(canvas, handlers) {
  const held = new Set();

  function onKeyDown(e) {
    // ignore auto-repeat: one press is one jump, holding a key must not climb
    if (e.repeat) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      held.add('L');
      handlers.jump('L');
      e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      held.add('R');
      handlers.jump('R');
      e.preventDefault();
    } else if (k === 'Enter' || k === ' ') {
      handlers.confirm();
      e.preventDefault();
    } else if (k === 'Escape' || k === 'p' || k === 'P') {
      handlers.pause();
      e.preventDefault();
    } else if (k === 'r' || k === 'R') {
      handlers.restart();
    } else if (k === '`' || k === '~') {
      handlers.debug();
    } else if (k === '[') {
      handlers.nudgeSpeed(-0.1);
    } else if (k === ']') {
      handlers.nudgeSpeed(0.1);
    }
  }

  function onKeyUp(e) {
    if (e.key === 'ArrowLeft') held.delete('L');
    if (e.key === 'ArrowRight') held.delete('R');
  }

  // Pointer events arrive in CSS pixels; the canvas is letterboxed, so map
  // back into the fixed logical resolution before anything reads coordinates.
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  const onDown = (e) => handlers.pointerDown(toLogical(e));
  const onMove = (e) => handlers.pointerMove(toLogical(e));
  const onUp = (e) => handlers.pointerUp(toLogical(e));

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  return {
    held,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    },
  };
}
