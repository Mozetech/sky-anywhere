// Sound: GBA-flavoured synth effects, the real Gen 3 cries, and original chiptune music.
//
// Everything is scheduled through voice functions of the form (ctx, out, t0, ...) so the same
// calls can play live or be replayed into an OfflineAudioContext. When recording (the video
// renderer), each call is logged against game time instead and rendered afterwards.
import { A } from './assets.js';

let ctx = null, master = null, musicBus = null, sfxBus = null;
let recording = null; // { events: [], now: () => seconds }
const cryBuffers = new Map(); // species -> AudioBuffer (live context)
const cryBytes = new Map();   // species -> ArrayBuffer (for offline decode)

function ac() {
  if (recording) return null;
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.9; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ---------------------------------------------------------------- instruments
const waves = new WeakMap();
function pulseWave(c, duty) {
  let m = waves.get(c);
  if (!m) { m = {}; waves.set(c, m); }
  if (m[duty]) return m[duty];
  const n = 48, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty) * Math.exp(-k / 18); // soften upper harmonics
  m[duty] = c.createPeriodicWave(re, im);
  return m[duty];
}
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function env(c, g, t0, a, peak, d, sus, rel, end) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.linearRampToValueAtTime(peak * sus, t0 + a + d);
  g.gain.setValueAtTime(peak * sus, Math.max(t0 + a + d, end));
  g.gain.linearRampToValueAtTime(0.0001, end + rel);
}
function tone(c, out, t0, { freq, dur, type = 'square', duty = 0.25, vol = 0.1, a = 0.004, d = 0.08, sus = 0.6, rel = 0.05, slide = 0, cutoff = 3000 }) {
  const o = c.createOscillator();
  if (type === 'pulse') o.setPeriodicWave(pulseWave(c, duty)); else o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  const g = c.createGain();
  env(c, g, t0, a, vol, d, sus, rel, t0 + dur);
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.3;
  o.connect(f).connect(g).connect(out);
  o.start(t0); o.stop(t0 + dur + rel + 0.02);
}
const noiseCache = new WeakMap();
function noiseBuf(c) {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    let x = 12345;
    for (let i = 0; i < d.length; i++) { x = (x * 1103515245 + 12345) >>> 0; d[i] = ((x >>> 8) / 8388608) - 1; }
    noiseCache.set(c, b);
  }
  return b;
}
function noise(c, out, t0, { dur, vol = 0.1, lp = 2000, hp = 60, a = 0.003, rel = 0.05, sweep = 0 }) {
  const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
  const f1 = c.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.setValueAtTime(lp, t0);
  if (sweep) f1.frequency.linearRampToValueAtTime(Math.max(80, lp + sweep), t0 + dur);
  const f2 = c.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + a);
  g.gain.setValueAtTime(vol, t0 + Math.max(a, dur * 0.3)); g.gain.linearRampToValueAtTime(0.0001, t0 + dur + rel);
  s.connect(f1).connect(f2).connect(g).connect(out);
  s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + rel + 0.02);
}

// ---------------------------------------------------------------- sound effects
const SFX = {
  move: (c, o, t) => tone(c, o, t, { freq: 1046, dur: 0.035, type: 'pulse', duty: 0.5, vol: 0.045, cutoff: 1800 }),
  select: (c, o, t) => { tone(c, o, t, { freq: 784, dur: 0.04, type: 'pulse', duty: 0.5, vol: 0.06, cutoff: 1900 }); tone(c, o, t + 0.045, { freq: 1175, dur: 0.06, type: 'pulse', duty: 0.5, vol: 0.06, cutoff: 1900 }); },
  cancel: (c, o, t) => tone(c, o, t, { freq: 523, dur: 0.07, type: 'pulse', duty: 0.5, vol: 0.06, slide: -180, cutoff: 2200 }),
  bump: (c, o, t) => tone(c, o, t, { freq: 110, dur: 0.06, type: 'triangle', vol: 0.14 }),
  pop: (c, o, t) => tone(c, o, t, { freq: 330, dur: 0.1, type: 'pulse', duty: 0.25, vol: 0.08, slide: 420, cutoff: 2400 }),
  throw: (c, o, t) => noise(c, o, t, { dur: 0.25, vol: 0.06, lp: 900, sweep: 1600, hp: 300 }),
  ballOpen: (c, o, t) => { noise(c, o, t, { dur: 0.12, vol: 0.07, lp: 1800, hp: 500 }); [1047, 1319, 1568].forEach((f, i) => tone(c, o, t + 0.05 + i * 0.05, { freq: f, dur: 0.08, type: 'sine', vol: 0.05, sus: 0.3 })); },
  recall: (c, o, t) => tone(c, o, t, { freq: 880, dur: 0.22, type: 'sine', vol: 0.07, slide: -600 }),
  wobble: (c, o, t) => { tone(c, o, t, { freq: 220, dur: 0.05, type: 'pulse', duty: 0.5, vol: 0.08, cutoff: 1500 }); noise(c, o, t, { dur: 0.04, vol: 0.05, lp: 1800, hp: 400 }); },
  click: (c, o, t) => { tone(c, o, t, { freq: 1568, dur: 0.03, type: 'pulse', duty: 0.5, vol: 0.05, cutoff: 1900 }); tone(c, o, t + 0.04, { freq: 784, dur: 0.05, type: 'pulse', duty: 0.5, vol: 0.05, cutoff: 1900 }); },
  breakFree: (c, o, t) => { noise(c, o, t, { dur: 0.15, vol: 0.09, lp: 1600, hp: 250 }); tone(c, o, t, { freq: 392, dur: 0.12, type: 'pulse', vol: 0.07, slide: 300, cutoff: 1900 }); },
  hit: (c, o, t) => { noise(c, o, t, { dur: 0.09, vol: 0.18, lp: 1600, hp: 80, sweep: -900 }); tone(c, o, t, { freq: 140, dur: 0.08, type: 'triangle', vol: 0.18, slide: -60 }); },
  hitSuper: (c, o, t) => { noise(c, o, t, { dur: 0.14, vol: 0.2, lp: 2400, hp: 80, sweep: -1500 }); tone(c, o, t, { freq: 180, dur: 0.12, type: 'triangle', vol: 0.2, slide: -100 }); noise(c, o, t + 0.07, { dur: 0.08, vol: 0.12, lp: 1400, hp: 100 }); },
  hitWeak: (c, o, t) => noise(c, o, t, { dur: 0.07, vol: 0.12, lp: 900, hp: 80 }),
  gust: (c, o, t) => noise(c, o, t, { dur: 0.5, vol: 0.1, lp: 700, sweep: 1400, hp: 200, a: 0.12 }),
  zap: (c, o, t) => { for (let i = 0; i < 4; i++) noise(c, o, t + i * 0.06, { dur: 0.05, vol: 0.08, lp: 2200, hp: 900 }); },
  flame: (c, o, t) => noise(c, o, t, { dur: 0.5, vol: 0.12, lp: 1100, hp: 100, a: 0.08, sweep: 400 }),
  splash: (c, o, t) => noise(c, o, t, { dur: 0.3, vol: 0.1, lp: 2200, hp: 500, sweep: -1200 }),
  psychic: (c, o, t) => { tone(c, o, t, { freq: 440, dur: 0.4, type: 'sine', vol: 0.06, slide: 440 }); tone(c, o, t + 0.05, { freq: 660, dur: 0.35, type: 'sine', vol: 0.04, slide: -220 }); },
  statUp: (c, o, t) => [523, 659, 784, 1047].forEach((f, i) => tone(c, o, t + i * 0.06, { freq: f, dur: 0.07, type: 'sine', vol: 0.06, sus: 0.4 })),
  statDown: (c, o, t) => [1047, 784, 659, 523].forEach((f, i) => tone(c, o, t + i * 0.06, { freq: f, dur: 0.07, type: 'sine', vol: 0.06, sus: 0.4 })),
  faint: (c, o, t) => tone(c, o, t, { freq: 420, dur: 0.5, type: 'pulse', duty: 0.25, vol: 0.06, slide: -330, cutoff: 1400 }),
  expTick: (c, o, t) => tone(c, o, t, { freq: 1568, dur: 0.02, type: 'sine', vol: 0.025, sus: 0.3 }),
  flee: (c, o, t) => noise(c, o, t, { dur: 0.35, vol: 0.08, lp: 600, sweep: 1800, hp: 200, a: 0.05 }),
  flap: (c, o, t) => noise(c, o, t, { dur: 0.09, vol: 0.035, lp: 500, hp: 90, a: 0.03 }),
  whoosh: (c, o, t) => noise(c, o, t, { dur: 0.7, vol: 0.09, lp: 400, sweep: 1500, hp: 120, a: 0.25 }),
  land: (c, o, t) => { tone(c, o, t, { freq: 90, dur: 0.14, type: 'triangle', vol: 0.16, slide: -40 }); noise(c, o, t, { dur: 0.12, vol: 0.06, lp: 700, hp: 80 }); },
  shiny: (c, o, t) => [1568, 2093, 2349].forEach((f, i) => tone(c, o, t + i * 0.07, { freq: f, dur: 0.09, type: 'sine', vol: 0.035, sus: 0.3 })),
  heal: (c, o, t) => [[72, 0], [76, 0.14], [79, 0.28], [84, 0.42], [79, 0.62], [84, 0.76]].forEach(([m, dt]) => tone(c, o, t + dt, { freq: midiHz(m), dur: 0.16, type: 'pulse', duty: 0.5, vol: 0.06, cutoff: 2400, sus: 0.5 })),
  levelUp: (c, o, t) => [[72, 0], [76, 0.1], [79, 0.2], [84, 0.3], [83, 0.5], [84, 0.62]].forEach(([m, dt]) => tone(c, o, t + dt, { freq: midiHz(m), dur: 0.12, type: 'pulse', duty: 0.5, vol: 0.06, cutoff: 2400, sus: 0.5 })),
  caught: (c, o, t) => [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [76, 0.56], [79, 0.68], [84, 0.8]].forEach(([m, dt]) => tone(c, o, t + dt, { freq: midiHz(m), dur: dt === 0.8 ? 0.5 : 0.14, type: 'pulse', duty: 0.5, vol: 0.06, cutoff: 2400, sus: 0.5 })),
  save: (c, o, t) => [[79, 0], [84, 0.12], [88, 0.24]].forEach(([m, dt]) => tone(c, o, t + dt, { freq: midiHz(m), dur: 0.14, type: 'pulse', duty: 0.5, vol: 0.05, cutoff: 2400, sus: 0.5 })),
};

// ---------------------------------------------------------------- music
// Tracker strings: "note/len" tokens, len in 16th notes; "r" rests; notes like c4, f#5, bb3.
function parseVoice(str) {
  const out = []; let pos = 0;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  for (const tok of str.trim().split(/\s+/)) {
    const [n, l] = tok.split('/'); const len = Number(l || 1);
    if (n !== 'r') {
      const m = n.match(/^([a-g])(#|b)?(\d)$/);
      const midi = 12 * (Number(m[3]) + 1) + base[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
      out.push({ pos, len, midi });
    }
    pos += len;
  }
  return { notes: out, length: pos };
}
function rep(s, n) { return Array(n).fill(s).join(' '); }

const TRACKS = {
  // Up in the sky: airy D major, a floating lead over rolling arpeggios. 16 bars, one chord per bar:
  // D Bm G A | D Bm G A | G F#m Em A | G A D D
  sky: {
    bpm: 108, loop: true,
    voices: [
      { inst: 'lead', vol: 0.05, str: [
        'a4/4 d5/4 e5/4 f#5/4', 'f#5/6 e5/2 d5/4 b4/4', 'd5/4 e5/4 g5/4 f#5/4', 'e5/12 r/4',
        'a4/4 d5/4 e5/4 f#5/4', 'a5/6 f#5/2 d5/4 f#5/4', 'g5/4 f#5/4 e5/4 d5/4', 'e5/12 r/4',
        'b5/6 a5/2 g5/4 d5/4', 'a5/6 f#5/2 c#5/4 f#5/4', 'g5/4 f#5/4 e5/4 b4/4', 'c#5/8 e5/4 a5/4',
        'b5/6 a5/2 g5/4 b5/4', 'a5/6 g5/2 e5/4 c#5/4', 'd5/12 a4/4', 'd5/12 r/4'].join(' ') },
      { inst: 'arp', vol: 0.028, str: ['d4 f#4 a4 d5', 'b3 d4 f#4 b4', 'g3 b3 d4 g4', 'a3 c#4 e4 a4', 'd4 f#4 a4 d5', 'b3 d4 f#4 b4', 'g3 b3 d4 g4', 'a3 c#4 e4 a4',
        'g3 b3 d4 g4', 'f#3 a3 c#4 f#4', 'e3 g3 b3 e4', 'a3 c#4 e4 a4', 'g3 b3 d4 g4', 'a3 c#4 e4 a4', 'd4 f#4 a4 d5', 'd4 f#4 a4 d5']
        .map((c) => rep(c.split(' ').map((n) => n + '/2').join(' '), 2)).join(' ') },
      { inst: 'bass', vol: 0.11, str: ['d3', 'b2', 'g2', 'a2', 'd3', 'b2', 'g2', 'a2', 'g2', 'f#2', 'e2', 'a2', 'g2', 'a2', 'd3', 'd3'].map((n) => `${n}/8 ${n}/8`).join(' ') },
      { inst: 'hat', vol: 0.018, str: rep('c6/4 c6/2 c6/2', 32) },
    ],
  },
  // Wild battle in the air: driving E minor, 8 bars.
  battle: {
    bpm: 152, loop: true,
    voices: [
      { inst: 'lead', vol: 0.05, str: 'e5/2 r/2 e5/2 g5/2 b5/4 a5/2 g5/2 f#5/2 e5/2 d5/2 f#5/2 e5/8 ' +
        'e5/2 r/2 e5/2 g5/2 b5/4 c6/2 b5/2 a5/2 g5/2 a5/2 b5/2 f#5/8 ' +
        'g5/4 f#5/4 e5/4 d5/4 c5/4 d5/4 e5/8 a5/4 g5/4 f#5/4 e5/4 d#5/4 f#5/4 b5/8' },
      { inst: 'arp', vol: 0.025, str: rep('e4/1 g4/1 b4/1 e5/1', 8) + ' ' + rep('e4/1 g4/1 b4/1 e5/1', 4) + ' ' + rep('d4/1 f#4/1 a4/1 d5/1', 2) + ' ' + rep('b3/1 d#4/1 f#4/1 b4/1', 2) + ' ' +
        rep('c4/1 e4/1 g4/1 c5/1', 4) + ' ' + rep('a3/1 c4/1 e4/1 a4/1', 4) + ' ' + rep('c4/1 e4/1 g4/1 c5/1', 2) + ' ' + rep('b3/1 d#4/1 f#4/1 b4/1', 6) },
      { inst: 'bass', vol: 0.12, str: rep('e2/2 e3/2', 8) + ' ' + rep('e2/2 e3/2', 4) + ' ' + rep('d2/2 d3/2', 2) + ' ' + rep('b1/2 b2/2', 2) + ' ' + rep('c2/2 c3/2', 4) + ' ' + rep('a1/2 a2/2', 4) + ' ' + rep('c2/2 c3/2', 2) + ' ' + rep('b1/2 b2/2', 6) },
      { inst: 'kick', vol: 0.12, str: rep('c2/4', 32) },
      { inst: 'hat', vol: 0.02, str: rep('r/2 c6/2', 32) },
    ],
  },
  victory: {
    bpm: 132, loop: true,
    voices: [
      { inst: 'lead', vol: 0.05, str: 'g5/2 g5/2 g5/2 a5/2 b5/6 g5/2 c6/4 b5/4 a5/4 g5/4 f#5/2 g5/2 a5/2 b5/2 a5/8 g5/8 r/8' },
      { inst: 'arp', vol: 0.024, str: rep('g4/2 b4/2 d5/2 b4/2', 2) + ' ' + rep('c4/2 e4/2 g4/2 e4/2', 2) + ' ' + rep('d4/2 f#4/2 a4/2 f#4/2', 2) + ' ' + rep('g4/2 b4/2 d5/2 b4/2', 2) },
      { inst: 'bass', vol: 0.11, str: 'g2/8 g2/8 c3/8 c3/8 d3/8 d3/8 g2/8 g2/8' },
    ],
  },
  // On foot: a gentle route theme in G. 16 bars: G C G D | C G Am D | G C G D | C G D G
  route: {
    bpm: 116, loop: true,
    voices: [
      { inst: 'lead', vol: 0.045, str: [
        'd5/4 g5/4 b5/4 a5/4', 'g5/4 e5/4 c5/4 e5/4', 'd5/4 g5/2 a5/2 b5/8', 'a5/12 r/4',
        'c6/4 b5/4 a5/4 g5/4', 'b5/6 a5/2 g5/4 d5/4', 'e5/4 g5/4 a5/4 c6/4', 'b5/8 a5/8',
        'd5/4 g5/4 b5/4 a5/4', 'g5/4 e5/4 c5/4 e5/4', 'd5/4 g5/2 b5/2 d6/8', 'c6/6 b5/2 a5/8',
        'e5/4 g5/4 c6/4 b5/4', 'a5/4 g5/4 d5/4 b5/4', 'a5/6 g5/2 f#5/4 a5/4', 'g5/12 r/4'].join(' ') },
      { inst: 'arp', vol: 0.024, str: ['g3 d4 g4 d4', 'c4 e4 g4 e4', 'g3 d4 g4 d4', 'd4 f#4 a4 f#4', 'c4 e4 g4 e4', 'g3 d4 g4 d4', 'a3 c4 e4 c4', 'd4 f#4 a4 f#4',
        'g3 d4 g4 d4', 'c4 e4 g4 e4', 'g3 d4 g4 d4', 'd4 f#4 a4 f#4', 'c4 e4 g4 e4', 'g3 d4 g4 d4', 'd4 f#4 a4 f#4', 'g3 d4 g4 d4']
        .map((c) => rep(c.split(' ').map((n) => n + '/2').join(' '), 2)).join(' ') },
      { inst: 'bass', vol: 0.1, str: [['g2', 'd3'], ['c3', 'g2'], ['g2', 'd3'], ['d3', 'a2'], ['c3', 'g2'], ['g2', 'd3'], ['a2', 'e3'], ['d3', 'a2'],
        ['g2', 'd3'], ['c3', 'g2'], ['g2', 'd3'], ['d3', 'a2'], ['c3', 'g2'], ['g2', 'd3'], ['d3', 'a2'], ['g2', 'd3']].map(([a, b]) => `${a}/8 ${b}/8`).join(' ') },
      { inst: 'hat', vol: 0.014, str: rep('r/4 c6/4', 32) },
    ],
  },
};
const INST = {
  lead: (c, o, t, f, d, v) => tone(c, o, t, { freq: f, dur: d * 0.92, type: 'pulse', duty: 0.25, vol: v, a: 0.01, d: 0.12, sus: 0.55, rel: 0.08, cutoff: 2400 }),
  arp: (c, o, t, f, d, v) => tone(c, o, t, { freq: f, dur: d * 0.7, type: 'sine', vol: v, a: 0.004, d: 0.06, sus: 0.35, rel: 0.12 }),
  bass: (c, o, t, f, d, v) => tone(c, o, t, { freq: f, dur: d * 0.85, type: 'triangle', vol: v, a: 0.006, d: 0.1, sus: 0.7, rel: 0.05, cutoff: 900 }),
  hat: (c, o, t, f, d, v) => noise(c, o, t, { dur: 0.025, vol: v, lp: 7000, hp: 5000, rel: 0.02 }),
  kick: (c, o, t, f, d, v) => tone(c, o, t, { freq: 120, dur: 0.08, type: 'sine', vol: v, slide: -70, a: 0.002, sus: 0.3 }),
};
const parsed = {};
function track(name) {
  if (!parsed[name]) {
    const T = TRACKS[name];
    const voices = T.voices.map((v) => ({ ...v, ...parseVoice(v.str) }));
    parsed[name] = { ...T, voices, length: Math.max(...voices.map((v) => v.length)) };
  }
  return parsed[name];
}
// Schedule every note of `name` that starts in [from, to) seconds of track time, placed at t0 + trackTime.
function scheduleTrack(c, out, name, t0, from, to) {
  const T = track(name);
  const sixteenth = 60 / T.bpm / 4;
  const loopLen = T.length * sixteenth;
  const firstLoop = Math.floor(from / loopLen), lastLoop = T.loop ? Math.floor((to - 1e-6) / loopLen) : 0;
  for (let L = firstLoop; L <= lastLoop; L++) {
    for (const v of T.voices) {
      for (const n of v.notes) {
        const tt = L * loopLen + n.pos * sixteenth;
        if (tt < from || tt >= to) continue;
        INST[v.inst](c, out, t0 + tt, midiHz(n.midi), n.len * sixteenth, v.vol);
      }
    }
  }
}

let live = null; // { name, start (ctx time), scheduledTo (track time), gain, timer }
function startLive(name) {
  const c = ac(); if (!c) return;
  stopLive(0.25);
  const g = c.createGain(); g.gain.value = 1; g.connect(musicBus);
  const start = c.currentTime + 0.06;
  live = { name, start, scheduledTo: 0, gain: g };
  const pump = () => {
    if (!live || live.gain !== g) return;
    const now = c.currentTime - live.start;
    const until = now + 0.6;
    if (until > live.scheduledTo) { scheduleTrack(c, g, name, live.start, live.scheduledTo, until); live.scheduledTo = until; }
  };
  pump();
  live.timer = setInterval(pump, 120);
}
function stopLive(fade = 0.4) {
  if (!live) return;
  const c = ctx, L = live;
  clearInterval(L.timer);
  try { L.gain.gain.setValueAtTime(L.gain.gain.value, c.currentTime); L.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + fade); } catch (e) {}
  setTimeout(() => { try { L.gain.disconnect(); } catch (e) {} }, (fade + 0.2) * 1000);
  live = null;
}

// Wind: filtered noise bed while flying.
let windNode = null;
function windOn(c, out, t0) {
  const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.5;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.05, t0 + 1.2);
  const lfo = c.createOscillator(); lfo.frequency.value = 0.23; const lg = c.createGain(); lg.gain.value = 160;
  lfo.connect(lg).connect(f.frequency);
  s.connect(f).connect(g).connect(out); s.start(t0); lfo.start(t0);
  return { s, lfo, g };
}
function windOff(c, node, t0) {
  node.g.gain.setValueAtTime(node.g.gain.value || 0.05, t0);
  node.g.gain.linearRampToValueAtTime(0.0001, t0 + 0.8);
  node.s.stop(t0 + 0.9); node.lfo.stop(t0 + 0.9);
}

// ---------------------------------------------------------------- cries
async function loadCry(key) {
  if (cryBuffers.has(key) || !A.dex.species[key]) return;
  cryBuffers.set(key, null);
  try {
    const r = await fetch(`assets/cries/${A.dex.species[key].file}.wav`);
    const bytes = await r.arrayBuffer();
    cryBytes.set(key, bytes.slice(0));
    const c = ac();
    if (c) cryBuffers.set(key, await c.decodeAudioData(bytes));
  } catch (e) { /* cries are optional */ }
}
function playCry(c, out, t0, buf, pitch = 1, vol = 0.2) {
  if (!buf) return;
  const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = pitch;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2900; f.Q.value = 0.5;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(out); s.start(t0);
}

// ---------------------------------------------------------------- public API
function rec(type, data) { if (recording) { recording.events.push({ t: recording.now(), type, ...data }); return true; } return false; }

export const sfx = new Proxy({}, {
  get(_, name) {
    if (name === 'unlock') return () => { try { ac(); } catch (e) {} };
    return () => {
      if (rec('sfx', { name })) return;
      try { const c = ac(); if (c && SFX[name]) SFX[name](c, sfxBus, c.currentTime + 0.005); } catch (e) {}
    };
  },
});

let currentMusic = null;
export const music = {
  play(name) {
    if (currentMusic === name) return;
    currentMusic = name;
    if (rec('music', { name })) return;
    try { startLive(name); } catch (e) {}
  },
  stop(fade = 0.4) {
    if (!currentMusic) return;
    currentMusic = null;
    if (rec('musicStop', { fade })) return;
    try { stopLive(fade); } catch (e) {}
  },
  get current() { return currentMusic; },
};

let windActive = false;
export function wind(on) {
  if (on === windActive) return;
  windActive = on;
  if (rec(on ? 'windOn' : 'windOff', {})) return;
  try {
    const c = ac(); if (!c) return;
    if (on) windNode = windOn(c, sfxBus, c.currentTime);
    else if (windNode) { windOff(c, windNode, c.currentTime); windNode = null; }
  } catch (e) {}
}

export function preloadCries(keys) { return Promise.all(keys.map(loadCry)); }
export function cry(key, pitch = 1) {
  loadCry(key);
  if (rec('cry', { key, pitch })) return;
  try { const c = ac(); if (c) playCry(c, sfxBus, c.currentTime + 0.01, cryBuffers.get(key), pitch); } catch (e) {}
}

// ---------------------------------------------------------------- recording (video renderer)
export function startRecording(now) { recording = { events: [], now }; currentMusic = null; windActive = false; }
export function recordedEvents() { return recording ? recording.events : []; }
// Render the recorded events into a WAV (returned as base64) with an OfflineAudioContext.
export async function renderRecording(duration, sampleRate = 44100) {
  const events = recording ? recording.events : [];
  const c = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const m = c.createGain(); m.gain.value = 0.9; m.connect(c.destination);
  const mb = c.createGain(); mb.gain.value = 0.9; mb.connect(m);
  const sb = c.createGain(); sb.gain.value = 0.8; sb.connect(m);
  const cries = new Map();
  for (const e of events) {
    if (e.type === 'cry' && !cries.has(e.key)) {
      await loadCry(e.key);
      const bytes = cryBytes.get(e.key);
      cries.set(e.key, bytes ? await c.decodeAudioData(bytes.slice(0)) : null);
    }
  }
  let mus = null, wnd = null;
  const endMusic = (t, fade) => {
    if (!mus) return;
    const g = c.createGain(); // separate gain per segment so fades do not affect later tracks
    scheduleTrack(c, g, mus.name, mus.t, 0, Math.max(0, t - mus.t + fade));
    g.gain.setValueAtTime(1, t); g.gain.linearRampToValueAtTime(0.0001, t + fade);
    g.connect(mb);
    mus = null;
  };
  for (const e of events) {
    const t = e.t + 0.02;
    if (e.type === 'sfx' && SFX[e.name]) SFX[e.name](c, sb, t);
    else if (e.type === 'cry') playCry(c, sb, t, cries.get(e.key), e.pitch);
    else if (e.type === 'music') { endMusic(t, 0.25); mus = { name: e.name, t: t + 0.06 }; }
    else if (e.type === 'musicStop') endMusic(t, e.fade);
    else if (e.type === 'windOn') { if (!wnd) wnd = windOn(c, sb, t); }
    else if (e.type === 'windOff') { if (wnd) { windOff(c, wnd, t); wnd = null; } }
  }
  endMusic(duration, 0.5);
  const buf = await c.startRendering();
  return wavBase64(buf);
}
function wavBase64(buf) {
  const n = buf.length, ch = buf.numberOfChannels, rate = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [0, 1].slice(0, ch).map((i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < ch; k++) { const v = Math.max(-1, Math.min(1, data[k][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  const bytes = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Debug: each track's voice lengths in 16th notes (all voices of a track should match to loop cleanly).
export function trackLengths() { return Object.fromEntries(Object.keys(TRACKS).map((k) => [k, track(k).voices.map((v) => v.length)])); }
