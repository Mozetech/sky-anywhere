// Overworld renderer: pre-rendered FireRed map chunks below and above the sprites.
import { A, chunkImage, skyChunkImage } from './assets.js';
import { VW, VH } from './ui.js';

function forChunks(cam, margin, fn) {
  const C = A.world.chunk;
  const x0 = Math.floor((cam.x - margin) / C), x1 = Math.floor((cam.x + VW + margin) / C);
  const y0 = Math.floor((cam.y - margin) / C), y1 = Math.floor((cam.y + VH + margin) / C);
  for (let cy = Math.max(0, y0); cy <= Math.min(A.world.ch - 1, y1); cy++)
    for (let cx = Math.max(0, x0); cx <= Math.min(A.world.cw - 1, x1); cx++) fn(cx, cy, cx * C - cam.x, cy * C - cam.y);
}
// Warm the caches around a world-pixel centre: ground chunks near, sky chunks over a wider area.
export function preload(cx, cy, sky) {
  const C = A.world.chunk;
  const r = sky ? 2 : 1;
  const ix = Math.floor(cx / C), iy = Math.floor(cy / C);
  for (let j = iy - r; j <= iy + r; j++) for (let i = ix - r; i <= ix + r; i++) {
    if (i < 0 || j < 0 || i >= A.world.cw || j >= A.world.ch) continue;
    if (sky) skyChunkImage(i, j);
    if (!sky || (Math.abs(i - ix) <= 1 && Math.abs(j - iy) <= 1)) { chunkImage(`${i}_${j}`); chunkImage(`${i}_${j}_top`); }
  }
}
export function drawSurfaceBelow(ctx, cam) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VW, VH);
  forChunks(cam, 0, (cx, cy, sx, sy) => { const img = chunkImage(`${cx}_${cy}`); if (img) ctx.drawImage(img, sx, sy); });
}
export function drawSurfaceAbove(ctx, cam) {
  forChunks(cam, 0, (cx, cy, sx, sy) => { const img = chunkImage(`${cx}_${cy}_top`); if (img) ctx.drawImage(img, sx, sy); });
}
export function drawFill(ctx, color, alpha) {
  if (alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, VW, VH);
  ctx.globalAlpha = 1;
}
