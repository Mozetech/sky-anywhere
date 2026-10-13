#!/usr/bin/env node
// Renders the Sky Anywhere showcase deterministically: drives the game one frame at a time through
// window.__sky.tick(), records every sound the game makes against game time, renders that audio
// offline in the page, and assembles an MP4 with ffmpeg.
//
//   node tools/render_video.mjs [out.mp4]
//
// Needs the built assets/ (./setup.sh), playwright (`npm install`, or PLAYWRIGHT_DIR pointing at an
// existing install), Google Chrome and ffmpeg. PORT picks the local server port (default 5212).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'out', 'sky-anywhere.mp4'));
const WORK = path.join(ROOT, 'out', 'work');
const FRAMES = path.join(WORK, 'frames');
const PORT = Number(process.env.PORT) || 5212;
const FPS = 30;

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || 'playwright');

rmSync(WORK, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(path.dirname(OUT), { recursive: true });

const server = spawn('python3', [path.join(ROOT, 'serve.py'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${PORT}/?new`);
await page.waitForFunction(() => window.__sky && window.__sky.ready, null, { timeout: 30000 });
await page.evaluate(() => { const s = window.__sky; s.pause(); s.clearSave(); s.newGame(); s.seed(2026); s.encounters(false); s.startAudio(); s.playMusic('route'); });

let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle() { for (let i = 0; i < 100; i++) { const p = await page.evaluate(() => window.__sky.pending()); if (!p) return; await sleep(30); } }
async function tick(opts = {}) {
  await settle();
  const url = await page.evaluate((o) => window.__sky.tick(o), { dt: 1 / FPS, ...opts });
  writeFileSync(path.join(FRAMES, String(n++).padStart(5, '0') + '.png'), Buffer.from(url.split(',')[1], 'base64'));
}
const idle = async (frames) => { for (let i = 0; i < frames; i++) await tick(); };
const hold = async (key, frames) => { for (let i = 0; i < frames; i++) await tick({ hold: key }); };
const press = async (key, after = 6) => { await tick({ press: key }); await idle(after - 1); };
const state = () => page.evaluate(() => window.__sky.state());

// Wait on the game, reading messages at a comfortable pace: a message that waits for a button is
// pressed through after `read` frames on screen.
async function until(pred, { max = 3000, read = 26 } = {}) {
  let shownFor = 0;
  for (let i = 0; i < max; i++) {
    const st = await page.evaluate((p) => {
      const s = window.__sky, b = s.battle();
      let msgDone = false, needPress = false;
      if (s.state() === 'battle' && b && b.cur && b.cur.type === 'msg') {
        const tot = b.cur.pages[b.cur.page].join('').length;
        msgDone = b.cur.shown >= tot; needPress = b.cur.press || b.cur.page < b.cur.pages.length - 1;
      } else if (s.state() === 'msg') {
        const m = s.msg(); const tot = m.pages[m.page].join('').length;
        msgDone = m.shown >= tot; needPress = !m.ask || m.page < m.pages.length - 1;
      }
      return { done: new Function('s', 'b', 'return ' + p)(s, b), msgDone, needPress };
    }, pred);
    if (st.done) return;
    if (st.msgDone && st.needPress) { shownFor++; if (shownFor >= read) { shownFor = 0; await tick({ press: 'a' }); continue; } }
    else shownFor = 0;
    await tick();
  }
  throw new Error('timed out waiting for: ' + pred);
}
const battleWants = (ui) => `s.state() === 'battle' && b && !b.cur && !b.q.length && b.ui === '${ui}'`;
// Fly exactly `steps` sky steps: hold the direction until the last step has started, then let go.
async function skySteps(dir, steps, boost = false) {
  const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const [x0, y0] = await page.evaluate(() => [window.__sky.S.x, window.__sky.S.y]);
  const tx = x0 + D[0] * 2 * steps, ty = y0 + D[1] * 2 * steps;
  for (let f = 0; f < steps * 40; f++) {
    const [x, y, moving, st] = await page.evaluate(() => [window.__sky.S.x, window.__sky.S.y, window.__sky.S.moving, window.__sky.state()]);
    if (st !== 'sky') return;
    if (x === tx && y === ty) { if (!moving) return; await tick(); continue; }
    await tick({ hold: boost ? [dir, 'b'] : dir });
  }
}

// ---- 1. Pallet Town: a couple of steps with Pikachu, then FLY from the start menu
await idle(40);
await hold('right', 14); await idle(4); await hold('right', 13); await idle(10);
await press('down', 12); // face south
await press('start', 16);
for (let i = 0; i < 3; i++) await press('down', 9); // POKéDEX → POKéMON → BAG → FLY
await idle(14);
await press('a', 2);
await until(`s.state() === 'sky'`);
await idle(36);

// ---- 2. Out over the sea south of Pallet: the sky has its own hidden encounters
await skySteps('down', 5);
await page.evaluate(() => window.__sky.nextEncounter('WINGULL', 27));
await skySteps('down', 2);
await until(battleWants('action'));
await idle(10);
// FIGHT → QUICK ATTACK
await press('a', 10); await idle(8); await press('a', 4);
await until(battleWants('action'));
await idle(8);
// BAG → GREAT BALL, again if it breaks free
for (let attempt = 0; attempt < 6; attempt++) {
  await press('right', 8); await press('a', 14); await press('down', 12); await idle(8); await press('a', 4);
  await until(`s.state() === 'sky' || (${battleWants('action')})`, { max: 4000 });
  if ((await state()) === 'sky') break;
  await press('left', 6); // back to FIGHT's column before trying again
  await idle(6);
}
await idle(20);

// ---- 3. Back north past Pallet to Route 1, fast with B held
await skySteps('up', 6);
await skySteps('up', 6, true);
await page.evaluate(() => window.__sky.nextEncounter('PIDGEY', 5));
await skySteps('up', 1);
await until(battleWants('action'));
await idle(10);
// FIGHT → WING ATTACK
await press('a', 10); await press('right', 10); await press('a', 4);
await until(`s.state() === 'sky'`, { max: 4000 });
await idle(16);

// ---- 4. Switch mounts in mid-air: POKéMON → CHARIZARD → RIDE
await skySteps('up', 3);
await idle(8);
await press('start', 14);
await press('down', 10);            // POKéMON
await press('a', 16);
await press('down', 10); await press('down', 12); // CHARIZARD
await press('a', 14);               // RIDE is the first option
await idle(10);
await press('a', 2);
await until(`s.state() === 'sky'`);
await idle(20);

// ---- 5. On to Viridian City and down next to the POKéMON CENTER
await skySteps('up', 7, true);
await skySteps('right', 3);
await skySteps('up', 10, true);
await skySteps('up', 4);
await idle(20);
const pos = await page.evaluate(() => [window.__sky.S.x, window.__sky.S.y]);
console.log('landing near', pos);
await press('a', 2);
await until(`s.state() === 'msg' && s.msg().ask && s.msg().shown >= s.msg().pages[s.msg().page].join('').length`);
await idle(18);
await press('a', 2);
await until(`s.state() === 'walk'`);
await idle(24);
// walk to the door and heal
const walkTo = await page.evaluate(() => { const t = window.__sky.world.towns.find((x) => x.id === 'MAP_VIRIDIAN_CITY'); return [t.land.x, t.land.y, window.__sky.player.tx, window.__sky.player.ty]; });
console.log('walk from', walkTo.slice(2), 'to', walkTo.slice(0, 2));
for (let guard = 0; guard < 30; guard++) {
  const [tx, ty, px, py] = await page.evaluate(() => { const t = window.__sky.world.towns.find((x) => x.id === 'MAP_VIRIDIAN_CITY'); return [t.land.x, t.land.y, window.__sky.player.tx, window.__sky.player.ty]; });
  if (px === tx && py === ty) break;
  const dir = px < tx ? 'right' : px > tx ? 'left' : py > ty ? 'up' : 'down';
  await hold(dir, 7); await idle(1);
}
await idle(8);
await press('up', 2);
await until(`s.state() === 'walk'`, { read: 34 });
await idle(50);

const duration = n / FPS;
console.log(`captured ${n} frames (${duration.toFixed(1)}s), rendering audio…`);
const wav = await page.evaluate((d) => window.__sky.renderAudio(d), duration + 0.5);
writeFileSync(path.join(WORK, 'audio.wav'), Buffer.from(wav, 'base64'));
await browser.close();
server.kill();

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, '%05d.png'), '-i', path.join(WORK, 'audio.wav'),
  '-vf', 'scale=1440:960:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow',
  '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log(`wrote ${OUT}`);
