// Keyboard + touch pad input with "just pressed" edge detection.
const MAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  z: 'a', Z: 'a', ' ': 'a', x: 'b', X: 'b', Escape: 'b', Backspace: 'b', Enter: 'start',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.lastDir = null;
    window.addEventListener('keydown', (e) => {
      const k = MAP[e.key];
      if (!k) return;
      e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      if (['up', 'down', 'left', 'right'].includes(k)) this.lastDir = k;
    });
    window.addEventListener('keyup', (e) => {
      const k = MAP[e.key];
      if (k) this.down.delete(k);
    });
    window.addEventListener('blur', () => this.down.clear());
    for (const b of document.querySelectorAll('#pad button')) {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); if (!this.down.has(k)) this.pressed.add(k); this.down.add(k); if (['up','down','left','right'].includes(k)) this.lastDir = k; };
      const off = (e) => { e.preventDefault(); this.down.delete(k); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }
  }
  held(k) { return this.down.has(k); }
  just(k) { return this.pressed.has(k); }
  dir() {
    // Prefer the most recently pressed direction that is still held.
    if (this.lastDir && this.down.has(this.lastDir)) return this.lastDir;
    for (const d of ['up', 'down', 'left', 'right']) if (this.down.has(d)) return d;
    return null;
  }
  endFrame() { this.pressed.clear(); }
}
