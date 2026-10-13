// Frame tables for the real sprite sheets.
//   red.png        9 frames of 16x32: 0 down, 1 up, 2 left, 3/4 down walk, 5/6 up walk, 7/8 left walk
//   ow_<mon>.png   6 frames of 32x32 (expansion follower layout): 0 down, 1 down step, 2 up, 3 up step, 4 left, 5 left step
import { A } from './assets.js';

function frame(img, i, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, i * w, 0, w, h, 0, 0, w, h);
  return c;
}
function flipX(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.translate(src.width, 0); x.scale(-1, 1);
  x.drawImage(src, 0, 0);
  return c;
}

export const SPR = {};

// Opaque bounding box of a sprite canvas, used to seat the rider on each mount.
const bboxCache = new Map();
export function bboxOf(canvas) {
  if (bboxCache.has(canvas)) return bboxCache.get(canvas);
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (d[(y * canvas.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const b = { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  bboxCache.set(canvas, b);
  return b;
}

// White (or any colour) silhouette of a sprite, cached per image.
const silCache = new Map();
export function silhouette(img, color = '#fff') {
  const key = img;
  let m = silCache.get(key);
  if (!m) { m = new Map(); silCache.set(key, m); }
  let s = m.get(color);
  if (!s) {
    s = document.createElement('canvas'); s.width = img.width; s.height = img.height;
    const x = s.getContext('2d'); x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, s.width, s.height);
    m.set(color, s);
  }
  return s;
}

export function initSprites() {
  const red = (i) => frame(A.img.red, i, 16, 32);
  const r = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(red);
  // walk cycle: step, stand, other step, stand
  SPR.player = {
    down: [r[0], r[3], r[0], r[4]],
    up: [r[1], r[5], r[1], r[6]],
    left: [r[2], r[7], r[2], r[8]],
    right: [flipX(r[2]), flipX(r[7]), flipX(r[2]), flipX(r[8])],
  };
  // Throw poses (red_item sheet): ball in hand, then arm raised.
  SPR.throwPose = [frame(A.img.redItem, 6, 16, 32), frame(A.img.redItem, 0, 16, 32)];
  // Seated poses. red_surf.png's 16x32 sprites sit centred in 32px cells (x = 32*i + 8).
  // Sprites 6/7/8 are Red's upper body (down/up/left), drawn over a mount.
  const sitFrame = (i) => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 32;
    c.getContext('2d').drawImage(A.img.redSurf, 32 * i + 8, 0, 16, 32, 0, 0, 16, 32);
    return c;
  };
  SPR.sit = { down: sitFrame(6), up: sitFrame(7), left: sitFrame(8) };
  SPR.sit.right = flipX(SPR.sit.left);
  // Pokéball (3 stacked 16x16 frames: closed, opening, open), the open-ball burst, and sparkles.
  const vframe = (img, i, size = 16) => { const c = document.createElement('canvas'); c.width = size; c.height = size; c.getContext('2d').drawImage(img, 0, i * size, size, size, 0, 0, size, size); return c; };
  SPR.ball = [0, 1, 2].map((i) => vframe(A.img.ball, i));
  SPR.balls = { poke: [0, 1, 2].map((i) => vframe(A.img.ballPoke, i)), great: [0, 1, 2].map((i) => vframe(A.img.ballGreat, i)), ultra: [0, 1, 2].map((i) => vframe(A.img.ballUltra, i)) };
  SPR.ballOpen = A.img.ballOpen;
  SPR.sparkle = [0, 1].map((i) => vframe(A.img.sparkle, i));
  SPR.ow = {};
  SPR.rider = {};
}

// Overworld frames for a species (follower walk cycle), built on first use.
export function owFrames(key, shiny = false) {
  const id = key + (shiny ? '*' : '');
  if (SPR.ow[id]) return SPR.ow[id];
  const img = A.mon[key] && (shiny ? A.mon[key].owShiny : A.mon[key].ow);
  if (!img) return null;
  const f = [0, 1, 2, 3, 4, 5].map((i) => frame(img, i, 32, 32));
  SPR.ow[id] = {
    down: [f[0], f[1], f[0], f[1]],
    up: [f[2], f[3], f[2], f[3]],
    left: [f[4], f[5], f[4], f[5]],
    right: [flipX(f[4]), flipX(f[5]), flipX(f[4]), flipX(f[5])],
  };
  return SPR.ow[id];
}

// Red riding a flying Pokémon: 32x48 composites per direction, two wing frames each.
// Red's upper body is seated partway down the mount's back; facing the camera, the mount's
// head and chest pass in front of him, otherwise he sits on top.
export function riderFrames(key, shiny = false) {
  const id = key + (shiny ? '*' : '');
  if (SPR.rider[id]) return SPR.rider[id];
  const ow = owFrames(key, shiny);
  const out = {};
  for (const dir of ['down', 'up', 'left', 'right']) {
    out[dir] = [0, 1].map((i) => {
      const monImg = ow[dir][i];
      const mb = bboxOf(ow[dir][0]), rider = SPR.sit[dir], rb = bboxOf(rider);
      const c = document.createElement('canvas');
      c.width = 32; c.height = 48;
      const x = c.getContext('2d');
      // Facing the camera Red sits behind the head, so only his head and shoulders show above it.
      const seat = dir === 'down' ? 0.3 : dir === 'up' ? 0.62 : 0.55;
      const ry = 16 + mb.y0 + Math.round(mb.h * seat) - (rb.y1 + 1) + (dir === 'down' ? 0 : 4);
      const rx = Math.round((mb.x0 + mb.x1) / 2) - 8 + (dir === 'left' ? 2 : dir === 'right' ? -2 : 0);
      const drawMount = () => x.drawImage(monImg, 0, 16);
      const drawRider = () => x.drawImage(rider, rx, ry);
      if (dir === 'down') { drawRider(); drawMount(); } else { drawMount(); drawRider(); }
      return c;
    });
  }
  SPR.rider[id] = out;
  return out;
}
