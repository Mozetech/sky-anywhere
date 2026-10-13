// The sky as terrain: Kanto seen from altitude (half-resolution chunks with every gap filled),
// atmospheric haze, two parallax layers of pixel clouds in FireRed's weather-cloud palette, cloud
// shadows sliding over the ground, and wind streaks.
import { A, chunkImage, skyChunkImage } from './assets.js';
import { silhouette } from './sprites.js';
import { hash } from './world.js';
import { VW, VH } from './ui.js';

export const SKY_ZOOM = 0.5;
export const STEP_TILES = 2;

let off = null, offCtx = null;
function offscreen(w, h) {
  if (!off || off.width < w || off.height < h) {
    off = document.createElement('canvas');
    off.width = Math.max(w, off ? off.width : 0); off.height = Math.max(h, off ? off.height : 0);
    offCtx = off.getContext('2d'); offCtx.imageSmoothingEnabled = false;
  }
  return offCtx;
}

// Ground at zoom z, centred on world pixel (cx, cy). `full` blends in the full-resolution map
// (both layers) on top of the half-resolution sky chunks; at z = 1 and full = 1 this is exactly the
// overworld view, so take-off and landing never pop.
export function drawGround(ctx, cx, cy, z, full) {
  const C = A.world.chunk;
  ctx.fillStyle = '#6890c8'; ctx.fillRect(0, 0, VW, VH);
  if (full < 1) {
    const s = z / SKY_ZOOM;
    ctx.imageSmoothingEnabled = Math.abs(s - 1) > 1e-3;
    const ox = VW / 2 - cx * z, oy = VH / 2 - cy * z;
    const bx = Math.abs(s - 1) < 1e-3 ? Math.round(ox) : ox, by = Math.abs(s - 1) < 1e-3 ? Math.round(oy) : oy;
    const x0 = Math.floor((cx - VW / 2 / z) / C), x1 = Math.floor((cx + VW / 2 / z) / C);
    const y0 = Math.floor((cy - VH / 2 / z) / C), y1 = Math.floor((cy + VH / 2 / z) / C);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const img = skyChunkImage(i, j);
      if (!img) continue;
      const size = C * z;
      ctx.drawImage(img, bx + i * size, by + j * size, size + (ctx.imageSmoothingEnabled ? 0.5 : 0), size + (ctx.imageSmoothingEnabled ? 0.5 : 0));
    }
    ctx.imageSmoothingEnabled = false;
  }
  if (full > 0) {
    const w = Math.ceil(VW / z) + 32, h = Math.ceil(VH / z) + 32;
    const g = offscreen(w, h);
    const wx0 = Math.floor(cx - VW / 2 / z) - 16, wy0 = Math.floor(cy - VH / 2 / z) - 16;
    g.clearRect(0, 0, w, h);
    const x0 = Math.floor(wx0 / C), x1 = Math.floor((wx0 + w) / C), y0 = Math.floor(wy0 / C), y1 = Math.floor((wy0 + h) / C);
    for (let j = Math.max(0, y0); j <= Math.min(A.world.ch - 1, y1); j++) {
      for (let i = Math.max(0, x0); i <= Math.min(A.world.cw - 1, x1); i++) {
        const b = chunkImage(`${i}_${j}`), t = chunkImage(`${i}_${j}_top`);
        if (b) g.drawImage(b, i * C - wx0, j * C - wy0);
        if (t) g.drawImage(t, i * C - wx0, j * C - wy0);
      }
    }
    ctx.globalAlpha = full;
    ctx.imageSmoothingEnabled = z < 0.999;
    const dx = (wx0 - cx) * z + VW / 2, dy = (wy0 - cy) * z + VH / 2;
    if (z >= 0.999) ctx.drawImage(off, 0, 0, w, h, Math.round(dx), Math.round(dy), w, h);
    else ctx.drawImage(off, 0, 0, w, h, dx, dy, w * z, h * z);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
  }
}

// Haze between the ground and the camera, stronger with altitude.
export function drawHaze(ctx, k) {
  if (k <= 0) return;
  ctx.fillStyle = `rgba(178,214,250,${0.34 * k})`;
  ctx.fillRect(0, 0, VW, VH);
  // slightly brighter towards the top, as if the sky is above the view
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, `rgba(236,246,255,${0.22 * k})`);
  g.addColorStop(0.5, 'rgba(236,246,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
}

// ---------------------------------------------------------------- clouds
// Cloud stamps: six standalone pixel clouds in the weather cloud's palette, each also mirrored.
const LAYERS = {
  low: { f: 0.72, cell: 150, density: 0.5, alpha: 0.95, seed: 11, wind: 7, scale: 1 },
  high: { f: 1.45, cell: 300, density: 0.2, alpha: 0.45, seed: 29, wind: 12, scale: 2 },
};
let cloudVariants = null;
function variants() {
  if (cloudVariants) return cloudVariants;
  const mk = (src, flip) => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const x = c.getContext('2d'); if (flip) { x.translate(src.width, 0); x.scale(-1, 1); } x.drawImage(src, 0, 0); return c; };
  cloudVariants = [];
  for (let i = 0; i < 6; i++) { const src = A.img['cloud' + i]; cloudVariants.push(mk(src, false), mk(src, true)); }
  return cloudVariants;
}
function forClouds(L, cx, cy, time, fn) {
  const drift = time * L.wind;
  const halfW = VW / 2 / L.f + 160, halfH = VH / 2 / L.f + 120;
  const ux0 = cx - drift - halfW, ux1 = cx - drift + halfW, uy0 = cy - halfH, uy1 = cy + halfH;
  const n = variants().length;
  for (let j = Math.floor(uy0 / L.cell); j <= Math.floor(uy1 / L.cell); j++) {
    for (let i = Math.floor(ux0 / L.cell); i <= Math.floor(ux1 / L.cell); i++) {
      if (hash(i, j, L.seed) >= L.density) continue;
      const puffs = 1 + Math.floor(hash(i, j, L.seed + 1) * 2); // clouds in this bank
      for (let p = 0; p < puffs; p++) {
        const u = (i + hash(i, j, L.seed + 2 + p * 5)) * L.cell + drift;
        const v = (j + hash(i, j, L.seed + 3 + p * 5)) * L.cell;
        fn(u, v, Math.floor(hash(i, j, L.seed + 4 + p * 5) * n));
      }
    }
  }
}

export function drawCloudShadows(ctx, cx, cy, z, time, k) {
  if (k <= 0) return;
  const L = LAYERS.low, V = variants();
  ctx.globalAlpha = 0.16 * k;
  ctx.imageSmoothingEnabled = true;
  forClouds(L, cx, cy, time, (u, v, vi) => {
    const img = V[vi];
    const w = (img.width * L.scale) / L.f * z, h = (img.height * L.scale) / L.f * z;
    const sx = (u + 26 - cx) * z + VW / 2 - w / 2, sy = (v + 40 - cy) * z + VH / 2 - h / 2;
    if (sx > VW || sy > VH || sx + w < 0 || sy + h < 0) return;
    ctx.drawImage(silhouette(img, '#18305a'), sx, sy, w, h);
  });
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
}

export function drawClouds(ctx, layer, cx, cy, time, k) {
  if (k <= 0) return;
  const L = LAYERS[layer], V = variants();
  ctx.globalAlpha = L.alpha * k;
  forClouds(L, cx, cy, time, (u, v, vi) => {
    const img = V[vi];
    const w = img.width * L.scale, h = img.height * L.scale;
    const sx = Math.round((u - cx) * L.f + VW / 2 - w / 2), sy = Math.round((v - cy) * L.f + VH / 2 - h / 2);
    if (sx > VW || sy > VH || sx + w < 0 || sy + h < 0) return;
    ctx.drawImage(img, sx, sy, w, h);
  });
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- wind streaks
export class Streaks {
  constructor() { this.list = []; }
  update(dt, dir, moving, boost) {
    const rate = moving ? (boost ? 34 : 14) : 3;
    const n = dt * rate + Math.random();
    for (let i = 0; i < Math.floor(n); i++) {
      const d = dir ? { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[dir] : [0, 1];
      const sp = (moving ? (boost ? 360 : 220) : 60) * (0.7 + Math.random() * 0.6);
      const len = moving ? (boost ? 10 : 6) + Math.random() * 8 : 3 + Math.random() * 3;
      this.list.push({ x: Math.random() * VW, y: Math.random() * VH, vx: d[0] * sp, vy: d[1] * sp, len, life: 0.35 + Math.random() * 0.3, max: 0.6 });
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) this.list.splice(i, 1);
    }
  }
  draw(ctx, k) {
    if (k <= 0) return;
    ctx.fillStyle = '#ffffff';
    for (const s of this.list) {
      ctx.globalAlpha = Math.min(0.32, s.life * 0.9) * k;
      if (s.vx !== 0) ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.round(s.len), 1);
      else ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, Math.round(s.len));
    }
    ctx.globalAlpha = 1;
  }
}

// Shadow of the flyer on the ground below, shrinking and fading with altitude.
export function drawShadow(ctx, x, y, scale, alpha) {
  if (alpha <= 0) return;
  ctx.fillStyle = `rgba(16,24,40,${alpha})`;
  const w = Math.max(2, Math.round(14 * scale)), h = Math.max(1, Math.round(5 * scale));
  ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
}
