// Windows, menus, message box, banner and region map using FireRed's own window frame and font.
import { A } from './assets.js';
import { drawText, textWidth } from './font.js';

export const VW = 240, VH = 160;
export const FG = '#383838', SH = '#d8d8d8';

// std.png is a 3x3 grid of 8px tiles: corners, edges, centre.
export function drawWindow(ctx, x, y, w, h) {
  const img = A.img.window;
  const t = (sx, sy, dx, dy, dw = 8, dh = 8) => ctx.drawImage(img, sx, sy, 8, 8, dx, dy, dw, dh);
  t(8, 8, x + 8, y + 8, w - 16, h - 16);
  t(8, 0, x + 8, y, w - 16, 8); t(8, 16, x + 8, y + h - 8, w - 16, 8);
  t(0, 8, x, y + 8, 8, h - 16); t(16, 8, x + w - 8, y + 8, 8, h - 16);
  t(0, 0, x, y); t(16, 0, x + w - 8, y); t(0, 16, x, y + h - 8); t(16, 16, x + w - 8, y + h - 8);
}
export function cursorArrow(ctx, x, y, col = FG) {
  ctx.fillStyle = col;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i, y + i, 1, 8 - i * 2);
}
// The little red "more text" arrow in the corner of a message box.
export function moreArrow(ctx, x, y, t) {
  const bob = Math.floor(t * 4) % 2;
  ctx.fillStyle = '#e04848';
  ctx.fillRect(x, y + bob, 7, 2); ctx.fillRect(x + 1, y + 2 + bob, 5, 1); ctx.fillRect(x + 2, y + 3 + bob, 3, 1); ctx.fillRect(x + 3, y + 4 + bob, 1, 1);
}

// A vertical list menu in a window. items: strings; returns nothing.
export function drawList(ctx, x, y, w, items, cursor, opts = {}) {
  const rowH = 16, h = items.length * rowH + 12;
  drawWindow(ctx, x, y, w, h);
  items.forEach((it, i) => {
    const label = typeof it === 'string' ? it : it.label;
    const right = typeof it === 'string' ? null : it.right;
    const dim = typeof it === 'string' ? false : it.dim;
    drawText(ctx, label, x + 18, y + 6 + i * rowH, dim ? '#a0a0a0' : FG, dim ? '#e0e0e0' : SH);
    if (right) drawText(ctx, right, x + w - 10 - textWidth(right), y + 6 + i * rowH, FG, SH);
    if (i === cursor && !opts.noCursor) cursorArrow(ctx, x + 9, y + 9 + i * rowH);
  });
  return h;
}
export function listHeight(n) { return n * 16 + 12; }

// Word-wrap into lines that fit maxW, honouring explicit newlines.
export function wrap(text, maxW, font = 'normal') {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const wd of para.split(' ')) {
      const cand = line ? line + ' ' + wd : wd;
      if (line && textWidth(cand, font) > maxW) { out.push(line); line = wd; } else line = cand;
    }
    out.push(line);
  }
  return out;
}

// Overworld message box with typewriter reveal. `shown` = characters revealed so far.
export function drawMessage(ctx, lines, shown, done, t) {
  drawWindow(ctx, 0, VH - 48, VW, 48);
  let left = shown;
  lines.slice(0, 2).forEach((l, i) => {
    const vis = l.slice(0, Math.max(0, left));
    left -= l.length;
    drawText(ctx, vis, 12, VH - 40 + i * 16, FG, SH);
  });
  if (done) moreArrow(ctx, VW - 20, VH - 16, t);
}

export function drawBanner(ctx, text, alpha, slide) {
  if (alpha <= 0 || !text) return;
  const w = textWidth(text) + 18, x = Math.round((VW - w) / 2), y = 6 + Math.round(slide);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = '#403848'; ctx.fillRect(x + 1, y, w - 2, 18); ctx.fillRect(x, y + 1, w, 16);
  ctx.fillStyle = '#585068'; ctx.fillRect(x + 1, y + 1, w - 2, 1);
  drawText(ctx, text, x + 9, y + 1, '#f8f8f8', '#302838');
  ctx.globalAlpha = 1;
}

// YES/NO box in the bottom-right, above the message box.
export function drawYesNo(ctx, cursor, y = VH - 48 - 44) {
  drawList(ctx, VW - 56, y, 56, ['YES', 'NO'], cursor);
}

// ---------------------------------------------------------------- region map
// Cells are 8px; cell (0,0) is at screen (32,32). Sprites are 16px, centred 4px past the cell origin.
export const CELL_X = 32, CELL_Y = 32, GRID_W = 22, GRID_H = 15;
export function regionMapsec(cx, cy) {
  const row = A.region.grid[cy];
  return row ? row[cx] : 'MAPSEC_NONE';
}
export function regionName(cx, cy) {
  const sec = regionMapsec(cx, cy);
  return A.region.names[sec] || '';
}
export function drawRegionMap(ctx, cursor, playerCell, time, flying) {
  ctx.drawImage(A.img.regionmap, 0, 0);
  ctx.fillStyle = '#203058'; ctx.fillRect(0, 0, VW, 16);
  ctx.fillStyle = '#4060a0'; ctx.fillRect(0, 15, VW, 1);
  const name = regionName(cursor.x, cursor.y);
  drawText(ctx, name, 6, 0, '#f8f8f8', '#3050a0');
  if (flying) drawText(ctx, 'FLYING', VW - 6 - textWidth('FLYING'), 0, '#f8f8a0', '#3050a0');
  if (playerCell) ctx.drawImage(A.img.playerIcon, CELL_X + playerCell.x * 8 - 4, CELL_Y + playerCell.y * 8 - 4);
  const f = Math.floor(time * 4) % 2;
  ctx.drawImage(A.img.cursor, 0, f * 16, 16, 16, CELL_X + cursor.x * 8 - 4, CELL_Y + cursor.y * 8 - 4, 16, 16);
}

// ---------------------------------------------------------------- bag
export const ITEMS = {
  POKE_BALL: { name: 'POKé BALL', ball: 'poke', mult: 10, desc: 'A tool for catching wild POKéMON.' },
  GREAT_BALL: { name: 'GREAT BALL', ball: 'great', mult: 15, desc: 'A good BALL with a higher catch rate.' },
  ULTRA_BALL: { name: 'ULTRA BALL', ball: 'ultra', mult: 20, desc: 'A better BALL with a higher catch rate.' },
  POTION: { name: 'POTION', heal: 20, desc: 'Restores the HP of a POKéMON by 20 points.' },
  SUPER_POTION: { name: 'SUPER POTION', heal: 50, desc: 'Restores the HP of a POKéMON by 50 points.' },
  FULL_HEAL: { name: 'FULL HEAL', cure: true, desc: 'Heals all the status problems of a POKéMON.' },
  REVIVE: { name: 'REVIVE', revive: true, desc: 'Revives a fainted POKéMON with half its HP.' },
  REPEL: { name: 'REPEL', repel: 100, desc: 'Keeps weak wild POKéMON away for 100 steps.' },
};
export function bagEntries(bag, filter) {
  return Object.keys(ITEMS).filter((k) => (bag[k] || 0) > 0 && (!filter || filter(ITEMS[k]))).map((k) => ({ key: k, ...ITEMS[k], count: bag[k] }));
}
// A FireRed-ish bag list: window on the right, description box at the bottom.
export function drawBag(ctx, entries, cursor, title = 'ITEMS') {
  ctx.fillStyle = '#f8e0a0'; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = '#e8c070'; for (let y = 0; y < VH; y += 4) ctx.fillRect(0, y, VW, 1);
  // pocket label
  drawWindow(ctx, 4, 4, 80, 28);
  drawText(ctx, title, 14, 10, FG, SH);
  const rows = [...entries.map((e) => ({ label: e.name, right: '×' + String(e.count).padStart(2, ' ') })), { label: 'CLOSE BAG' }];
  const visible = 6;
  const top = Math.max(0, Math.min(cursor - visible + 1, rows.length - visible));
  const shown = rows.slice(top, top + visible);
  drawList(ctx, 88, 4, 148, shown, cursor - top);
  const cur = entries[cursor];
  drawWindow(ctx, 0, VH - 48, VW, 48);
  const desc = cur ? cur.desc : 'Close the BAG.';
  wrap(desc, VW - 24).slice(0, 2).forEach((l, i) => drawText(ctx, l, 12, VH - 40 + i * 16, FG, SH));
  if (top > 0) { ctx.fillStyle = FG; ctx.fillRect(160, 2, 5, 1); ctx.fillRect(161, 1, 3, 1); }
  if (top + visible < rows.length) { ctx.fillStyle = FG; ctx.fillRect(160, 4 + listHeight(visible) + 1, 5, 1); ctx.fillRect(161, 4 + listHeight(visible) + 2, 3, 1); }
}

// ---------------------------------------------------------------- dex + trainer card
export function drawDex(ctx, dex, speciesOrder, cursor) {
  ctx.fillStyle = '#d84040'; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = '#b02828'; ctx.fillRect(0, 0, VW, 18);
  drawText(ctx, 'POKéDEX', 8, 1, '#f8f8f8', '#702020');
  const summary = `SEEN ${dex.seen.size}   OWNED ${dex.caught.size}`;
  drawText(ctx, summary, VW - 8 - textWidth(summary), 1, '#f8f8f8', '#702020');
  const list = speciesOrder.filter((k) => dex.seen.has(k));
  drawWindow(ctx, 4, 22, VW - 8, VH - 26);
  if (!list.length) { drawText(ctx, 'No POKéMON seen yet. Fly high!', 16, 32, FG, SH); return; }
  const visible = 7, top = Math.max(0, Math.min(cursor - visible + 1, list.length - visible));
  list.slice(top, top + visible).forEach((k, i) => {
    const sp = A.dex.species[k];
    const y = 30 + i * 16;
    if (dex.caught.has(k)) ctx.drawImage(A.img.partyBall, 0, 0, 32, 32, 12, y - 1, 16, 16);
    ctx.drawImage(A.mon[k].icon, 0, 0, 32, 32, 28, y - 10, 32, 32);
    drawText(ctx, sp.name, 64, y, FG, SH);
    const types = sp.types[0] === sp.types[1] ? sp.types[0] : sp.types.join('/');
    drawText(ctx, types, VW - 16 - textWidth(types), y, '#707070', SH);
    if (top + i === cursor) cursorArrow(ctx, 8, y + 3);
  });
}

export function drawTrainerCard(ctx, info) {
  ctx.fillStyle = '#5870c8'; ctx.fillRect(0, 0, VW, VH);
  drawWindow(ctx, 12, 12, VW - 24, VH - 24);
  drawText(ctx, 'TRAINER CARD', 24, 20, FG, SH);
  drawText(ctx, `IDNo. ${info.id}`, VW - 30 - textWidth(`IDNo. ${info.id}`), 20, FG, SH);
  const rows = [['NAME', 'RED'], ['MONEY', `¥${info.money}`], ['POKéDEX', String(info.owned)], ['TIME', info.time], ['SKY STEPS', String(info.skySteps)]];
  rows.forEach(([k, v], i) => { drawText(ctx, k, 28, 44 + i * 16, FG, SH); drawText(ctx, v, VW - 32 - textWidth(v), 44 + i * 16, FG, SH); });
}
