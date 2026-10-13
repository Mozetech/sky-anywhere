// Sky Anywhere: FireRed's Kanto where FLY takes you up into the sky as a place of its own.
// Walk → FLY → take off → roam the sky (hidden encounters, like tall grass) → land anywhere.
import { A, loadAssets, chunksPending } from './assets.js';
import { buildWorld, TILE, JUMP_DIR } from './world.js';
import { SPR, initSprites, owFrames, riderFrames, silhouette } from './sprites.js';
import { initFont, drawText, textWidth } from './font.js';
import { drawSurfaceBelow, drawSurfaceAbove, drawFill, preload } from './render.js';
import { drawGround, drawHaze, drawClouds, drawCloudShadows, drawShadow, Streaks, SKY_ZOOM, STEP_TILES } from './sky.js';
import { VW, VH, FG, SH, drawWindow, cursorArrow, wrap, drawMessage, drawBanner, drawRegionMap, GRID_W, GRID_H, drawBag, bagEntries, ITEMS, drawDex, drawTrainerCard, listHeight } from './ui.js';
import { PartyScreen, fieldActions } from './partyui.js';
import { Battle } from './battle.js';
import { makeMon, species, healMon, reviveMon } from './data.js';
import { rollEncounter, zoneAt, EncounterClock } from './encounters.js';
import * as RNG from './rng.js';
import { Input } from './input.js';
import { sfx, music, wind, cry, preloadCries, startRecording, renderRecording } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function fit() {
  const hint = document.getElementById('hint');
  const availH = window.innerHeight - (hint && hint.offsetParent ? hint.offsetHeight + 40 : 20);
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VW, availH / VH)));
  canvas.style.width = VW * scale + 'px';
  canvas.style.height = VH * scale + 'px';
}
window.addEventListener('resize', fit);
fit();

ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
const params = new URLSearchParams(location.search);
try {
  await loadAssets();
} catch (err) {
  // assets/ is built locally by ./setup.sh and never shipped with the code
  const hint = document.getElementById('hint');
  if (hint) { hint.style.display = 'block'; hint.innerHTML = '<b>The game assets are not built yet.</b><br>Run <b>./setup.sh</b> in the project folder, then reload.'; }
  throw err;
}
initFont();
initSprites();
const world = buildWorld();
drawText(ctx, 'Loading…', 8, 8, '#f8f8f8', '#404040');

const input = new Input();
window.addEventListener('keydown', () => sfx.unlock(), { once: true });
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// ---------------------------------------------------------------- game data
const SAVE_KEY = 'poke-sky-save-v1';
const G = {
  party: [], pc: [], bag: {}, dex: { seen: new Set(), caught: new Set() },
  mountIdx: 1, flying: false, repel: 0, lastTown: 'MAP_PALLET_TOWN', playTime: 0, skySteps: 0, money: 3000,
  battle: null,
};
function newGame() {
  G.party = [
    makeMon('PIKACHU', 32, { ivs: [24, 26, 20, 28, 22, 30] }),
    makeMon('PIDGEOT', 36, { ivs: [26, 24, 22, 20, 24, 28], withFly: true }),
    makeMon('CHARIZARD', 38, { ivs: [22, 26, 24, 28, 20, 26], withFly: true }),
  ];
  G.bag = { POKE_BALL: 10, GREAT_BALL: 5, ULTRA_BALL: 3, POTION: 5, SUPER_POTION: 3, FULL_HEAL: 2, REVIVE: 2, REPEL: 3 };
  G.dex = { seen: new Set(G.party.map((m) => m.species)), caught: new Set(G.party.map((m) => m.species)) };
  G.pc = []; G.mountIdx = 1; G.repel = 0; G.lastTown = 'MAP_PALLET_TOWN'; G.playTime = 0; G.skySteps = 0;
}
G.itemEffect = (key, mon) => {
  const it = ITEMS[key];
  if (it.heal) {
    if (mon.hp <= 0 || mon.hp >= mon.maxHp) return null;
    const amt = Math.min(it.heal, mon.maxHp - mon.hp);
    return { kind: 'heal', amount: amt, text: `${mon.name}'s HP was restored\nby ${amt} point(s).` };
  }
  if (it.cure) {
    if (!mon.status || mon.hp <= 0) return null;
    const t = { PSN: 'was cured of its\npoisoning.', PAR: 'was cured of\nparalysis.', SLP: 'woke up.', BRN: 'had its burn\nhealed.', FRZ: 'was thawed out.' }[mon.status];
    return { kind: 'cure', text: `${mon.name} ${t}` };
  }
  if (it.revive) {
    if (mon.hp > 0) return null;
    const amt = Math.floor(mon.maxHp / 2);
    return { kind: 'revive', amount: amt, text: `${mon.name}'s HP was restored\nby ${amt} point(s).` };
  }
  return null;
};
G.applyItem = (key, mon, res) => {
  if (res.kind === 'heal') mon.hp = Math.min(mon.maxHp, mon.hp + res.amount);
  if (res.kind === 'cure') { mon.status = null; mon.sleep = 0; }
  if (res.kind === 'revive') { mon.hp = res.amount; mon.status = null; mon.sleep = 0; }
};
G.addCaught = (mon) => {
  G.dex.caught.add(mon.species); G.dex.seen.add(mon.species);
  mon.status = mon.status || null;
  if (G.party.length < 6) { G.party.push(mon); return 'party'; }
  G.pc.push(mon); return 'pc';
};
function saveGame() {
  const ser = (m) => ({ species: m.species, level: m.level, exp: m.exp, ivs: m.ivs, hp: m.hp, status: m.status, sleep: m.sleep, shiny: m.shiny, ball: m.ball, moves: m.moves.map((x) => ({ id: x.id, pp: x.pp })) });
  const data = { v: 1, party: G.party.map(ser), pc: G.pc.map(ser), bag: G.bag, seen: [...G.dex.seen], caught: [...G.dex.caught],
    mountIdx: G.mountIdx, repel: G.repel, lastTown: G.lastTown, playTime: G.playTime, skySteps: G.skySteps,
    pos: { x: player.tx, y: player.ty, dir: player.dir } };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.v !== 1) return false;
    const party = d.party.map(reviveMon).filter(Boolean);
    if (!party.length || !world.walkable(d.pos.x, d.pos.y)) return false;
    G.party = party; G.pc = (d.pc || []).map(reviveMon).filter(Boolean);
    G.bag = Object.fromEntries(Object.keys(ITEMS).map((k) => [k, Math.max(0, Number(d.bag[k]) || 0)]));
    G.dex = { seen: new Set(d.seen), caught: new Set(d.caught) };
    G.mountIdx = Math.min(G.party.length - 1, Math.max(0, d.mountIdx | 0)); G.repel = d.repel | 0; G.lastTown = d.lastTown || 'MAP_PALLET_TOWN';
    G.playTime = d.playTime || 0; G.skySteps = d.skySteps || 0;
    placeActor(player, d.pos.x, d.pos.y, d.pos.dir || 'down');
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- actors
const WALK_T = 0.21, RUN_T = 0.12;
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
function makeActor(tx, ty, dir = 'down') { return { tx, ty, fx: tx, fy: ty, dir, moving: false, prog: 0, fromX: tx, fromY: ty, dist: 1, visible: true, speed: WALK_T }; }
function placeActor(a, x, y, dir) { a.tx = a.fromX = x; a.ty = a.fromY = y; a.fx = x; a.fy = y; a.moving = false; a.prog = 0; a.dist = 1; if (dir) a.dir = dir; }
function updateActor(a, dt) {
  if (!a.moving) { a.fx = a.tx; a.fy = a.ty; return; }
  a.prog += dt / (a.speed * (a.dist === 2 ? 1.6 : 1));
  if (a.prog >= 1) { a.prog = 0; a.moving = false; a.fx = a.tx; a.fy = a.ty; a.dist = 1; return; }
  a.fx = a.fromX + (a.tx - a.fromX) * a.prog; a.fy = a.fromY + (a.ty - a.fromY) * a.prog;
}
function actorFrame(a) { return a.moving ? Math.floor(a.prog * 4) % 4 : 0; }
function hopLift(a) { return a.moving && a.dist === 2 ? Math.sin(a.prog * Math.PI) * 8 : 0; }

const startTown = world.towns.find((t) => t.id === 'MAP_PALLET_TOWN');
const player = makeActor(startTown.land.x, startTown.land.y, 'down');
const follower = makeActor(startTown.land.x, startTown.land.y + 1, 'up');

function followerMon() {
  const lead = G.party.find((m, i) => m.hp > 0 && !(G.flying && i === G.mountIdx));
  return lead || null;
}
function placeFollowerNear(x, y, avoid = []) {
  for (const d of ['down', 'left', 'right', 'up']) {
    const nx = x + DIRS[d].x, ny = y + DIRS[d].y;
    if (world.walkable(nx, ny) && !avoid.some((a) => a.x === nx && a.y === ny) && !world.pcDoor(nx, ny)) { placeActor(follower, nx, ny, OPP[d]); return true; }
  }
  placeActor(follower, x, y); return false;
}

// ---------------------------------------------------------------- state
let state = 'walk';
let scene = 'ground';          // what is drawn behind menus: 'ground' | 'sky'
let time = 0;
const cam = { x: 0, y: 0 };
const particles = [];
const banner = { text: '', t: 99 };
let menuCursor = 0;
let msg = null;                // { pages, page, shown, then }
let yesno = null;              // { cursor, onYes, onNo }
let partyUI = null, bagCursor = 0, dexCursor = 0;
const mapCursor = { x: 0, y: 0 };
let seq = null;                // active sequence (takeoff, landing, glide, swap, transition, battleOut, whiteout)
let forcedEncounter = null;    // hook: next sky encounter
let encountersOn = true;

const S = { x: 0, y: 0, fx: 0, fy: 0, fromX: 0, fromY: 0, moving: false, prog: 0, dir: 'down', z: 1, k: 0, lift: 0,
  streaks: new Streaks(), clock: new EncounterClock(), lastArea: null, flapT: 0, boost: false };
const mount = { key: 'PIDGEOT', shiny: false };

function showBanner(text) { if (text && text !== banner.text) { banner.text = text; banner.t = 0; } else if (text) banner.t = Math.min(banner.t, 0.3); }

function say(text, then) {
  const lines = wrap(text, VW - 28);
  const pages = []; for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));
  msg = { pages, page: 0, shown: 0, then, from: state };
  state = 'msg';
}
function ask(text, onYes, onNo) {
  say(text, null);
  msg.ask = { onYes, onNo };
}

const DIRT = ['#c8a878', '#a08058', '#e0c8a0'];
function spawn(x, y, n, vx, vy, spread, cols = DIRT, gravity = 0) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: vx + (Math.random() - 0.5) * spread, vy: vy + (Math.random() - 0.5) * spread, g: gravity,
    life: 0.35 + Math.random() * 0.35, size: 1 + Math.floor(Math.random() * 2), col: cols[Math.floor(Math.random() * cols.length)] });
}
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// ---------------------------------------------------------------- menus
const MENU_GROUND = ['POKéDEX', 'POKéMON', 'BAG', 'FLY', 'MAP', 'RED', 'SAVE', 'EXIT'];
const MENU_SKY = ['POKéDEX', 'POKéMON', 'BAG', 'LAND', 'MAP', 'RED', 'SAVE', 'EXIT'];
const menuItems = () => (scene === 'sky' ? MENU_SKY : MENU_GROUND);
const home = () => (scene === 'sky' ? 'sky' : 'walk');

function flyerIndex() {
  // Anything that can learn HM02 FLY can carry you, including Pokémon caught up in the sky.
  const ok = (m) => m && m.hp > 0 && species(m.species).canFly;
  if (ok(G.party[G.mountIdx])) return G.mountIdx;
  return G.party.findIndex(ok);
}

function openParty() {
  state = 'party';
  partyUI = new PartyScreen({
    party: G.party, mode: 'field', prompt: 'Choose a POKéMON.', flyingIdx: G.flying ? G.mountIdx : -1,
    onDone: () => { partyUI = null; state = home(); },
    actionsFor: fieldActions(G),
  });
  partyUI.onSwitch = (a, b) => {
    // keep the mount pointing at the same Pokémon after reordering
    if (G.mountIdx === a) G.mountIdx = b; else if (G.mountIdx === b) G.mountIdx = a;
    partyUI.flyingIdx = G.flying ? G.mountIdx : -1;
    if (!G.flying) refreshFollower();
  };
}
G.partyFly = (i, screen) => {
  const mon = G.party[i];
  if (mon.hp <= 0) { screen.say(`${mon.name} is too tired\nto fly!`); return; }
  if (G.flying) {
    if (i === G.mountIdx) { screen.say(`You're already riding\n${mon.name}!`); return; }
    partyUI = null; state = 'sky'; beginSwap(i, null); return;
  }
  partyUI = null; state = 'walk';
  beginTakeoff(i);
};
function refreshFollower() {
  const f = followerMon();
  follower.visible = !!f;
}

// ---------------------------------------------------------------- take-off
function beginTakeoff(idx) {
  let spot = null;
  const okSpot = (x, y) => world.walkable(x, y) && !world.pcDoor(x, y);
  const free = (x, y) => okSpot(x, y) && !(follower.visible && follower.tx === x && follower.ty === y);
  // In front of Red if possible, otherwise any open side, keeping clear of the buddy when we can.
  const order = [player.dir, 'down', 'left', 'right', 'up'];
  for (const pass of [free, okSpot]) {
    for (const d of order) { const x = player.tx + DIRS[d].x, y = player.ty + DIRS[d].y; if (pass(x, y)) { spot = { x, y, dir: d }; break; } }
    if (spot) break;
  }
  if (!spot) { say("There isn't enough room\nto fly here."); return; }
  const mon = G.party[idx];
  G.mountIdx = idx; mount.key = mon.species; mount.shiny = mon.shiny;
  if (follower.tx === spot.x && follower.ty === spot.y) placeFollowerNear(player.tx, player.ty, [spot]);
  player.dir = spot.dir;
  seq = { kind: 'takeoff', phase: 'throw', t: 0, spot, ball: null, flash: 0, monVisible: false, fFlash: 0 };
  state = 'takeoff';
  sfx.select();
}
function setPhase(p) { seq.phase = p; seq.t = 0; }

function updateTakeoff(dt) {
  const q = seq; q.t += dt;
  const sp = q.spot;
  switch (q.phase) {
    case 'throw': if (q.t > 0.5) { setPhase('ball'); sfx.throw(); } break;
    case 'ball': {
      const k = Math.min(1, q.t / 0.45);
      const sx = player.tx * TILE + 8, sy = player.ty * TILE - 6, ex = sp.x * TILE + 8, ey = sp.y * TILE + 4;
      q.ball = { x: sx + (ex - sx) * k, y: sy + (ey - sy) * k - Math.sin(k * Math.PI) * 18 };
      if (k >= 1) { q.ball = null; setPhase('open'); sfx.ballOpen(); }
      break;
    }
    case 'open': q.flash = 1 - Math.min(1, q.t / 0.45); q.monVisible = true; if (q.t === dt) cry(mount.key); if (q.t > 0.45) setPhase('appear'); break;
    case 'appear': q.flash = 0; if (q.t > 0.45) { setPhase('recallF'); if (follower.visible) sfx.recall(); } break;
    case 'recallF': q.fFlash = Math.min(1, q.t / 0.3); if (q.t > 0.35) { follower.visible = false; q.fFlash = 0; setPhase('mount'); sfx.pop(); } break;
    case 'mount': {
      const k = Math.min(1, q.t / 0.45);
      q.hop = { x: player.tx + (sp.x - player.tx) * k, y: player.ty + (sp.y - player.ty) * k, lift: Math.sin(k * Math.PI) * 14 + k * 6 };
      if (k >= 1) {
        q.hop = null; player.visible = false; q.riding = true; S.dir = sp.dir;
        S.x = S.fx = S.fromX = sp.x; S.y = S.fy = S.fromY = sp.y; S.moving = false; S.prog = 0; S.z = 1; S.k = 0; S.lift = 0;
        setPhase('liftoff'); sfx.whoosh(); wind(true);
      }
      break;
    }
    case 'liftoff': {
      const k = Math.min(1, q.t / 0.8);
      S.lift = ease(k) * 22;
      if (Math.random() < 0.6 && k < 0.7) spawn(sp.x * TILE + 8 + (Math.random() - 0.5) * 18, sp.y * TILE + 14, 1, 0, -20, 40);
      if (k >= 1) { setPhase('ascend'); music.play('sky'); }
      break;
    }
    case 'ascend': {
      const k = Math.min(1, q.t / 1.5);
      const e = ease(k);
      S.z = 1 + (SKY_ZOOM - 1) * e; S.k = e;
      if (k >= 1) {
        G.flying = true; scene = 'sky'; state = 'sky'; seq = null;
        S.x = S.fx = S.fromX = sp.x; S.y = S.fy = S.fromY = sp.y; S.moving = false; S.prog = 0;
        S.clock.reset(); S.lastArea = null;
        showBanner(world.areaAt(sp.x, sp.y) || 'KANTO');
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- landing
function tryLand() {
  const l = world.landingNear(S.x, S.y, 1);
  if (!l) { say("There's no place to land\nhere."); return; }
  ask('Would you like to land here?', () => beginLanding(l, false), () => {});
}
function beginLanding(l, glided) {
  seq = { kind: 'landing', phase: 'descend', t: 0, l, from: { x: S.fx, y: S.fy }, glided };
  state = 'landing';
  wind(false);
  sfx.whoosh();
}
function updateLanding(dt) {
  const q = seq; q.t += dt;
  const l = q.l;
  switch (q.phase) {
    case 'descend': {
      const k = Math.min(1, q.t / 1.3), e = ease(k);
      S.fx = q.from.x + (l.x - q.from.x) * e; S.fy = q.from.y + (l.y - q.from.y) * e;
      S.z = SKY_ZOOM + (1 - SKY_ZOOM) * e; S.k = 1 - e;
      if (k >= 1) { S.x = l.x; S.y = l.y; S.fx = l.x; S.fy = l.y; S.z = 1; S.k = 0; scene = 'ground'; music.play('route'); setPhase('touchdown'); }
      break;
    }
    case 'touchdown': {
      const k = Math.min(1, q.t / 0.45);
      S.lift = 22 * (1 - ease(k));
      if (k >= 1) { sfx.land(); spawn(l.x * TILE + 8, l.y * TILE + 14, 10, 0, -30, 60); setPhase('dismount'); sfx.pop(); }
      break;
    }
    case 'dismount': {
      const k = Math.min(1, q.t / 0.45);
      q.hop = { x: l.x + (l.off.x - l.x) * k, y: l.y + (l.off.y - l.y) * k, lift: 6 * (1 - k) + Math.sin(k * Math.PI) * 10 };
      if (k >= 1) {
        q.hop = null; player.visible = true;
        placeActor(player, l.off.x, l.off.y, dirTo(l.off, l));
        setPhase('recall'); sfx.recall();
      }
      break;
    }
    case 'recall': {
      const k = Math.min(1, q.t / 0.8);
      q.flash = k < 0.4 ? k / 0.4 : 0;
      q.monGone = k >= 0.4;
      if (k >= 0.4) {
        const kk = (k - 0.4) / 0.6;
        const sx = l.x * TILE + 8, sy = l.y * TILE + 2, ex = player.tx * TILE + 8, ey = player.ty * TILE - 4;
        q.ball = { x: sx + (ex - sx) * kk, y: sy + (ey - sy) * kk - Math.sin(kk * Math.PI) * 12 };
      }
      if (k >= 1) {
        q.ball = null;
        G.flying = false;
        const f = followerMon();
        if (f) { placeActor(follower, l.x, l.y, dirTo(l, l.off)); follower.visible = true; sfx.pop(); cry(f.species); }
        setPhase('followerPop');
      }
      break;
    }
    case 'followerPop': {
      const k = Math.min(1, q.t / 0.35);
      q.fLift = Math.sin(k * Math.PI) * 10;
      if (q.t > 0.5) {
        seq = null; state = 'walk'; S.lift = 0; q.fLift = 0;
        const t = world.townAt(player.tx, player.ty);
        showBanner(world.areaAt(player.tx, player.ty));
        if (t) G.lastTown = G.lastTown; // towns only become the respawn point once you heal there
      }
      break;
    }
  }
}
function dirTo(a, b) { const dx = b.x - a.x, dy = b.y - a.y; return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up'); }

// A flyer that can't go on: glide down to the nearest landing spot.
function beginGlide() {
  const l = world.nearestLanding(S.x, S.y);
  if (!l) { beginWhiteout(); return; }
  seq = { kind: 'glide', t: 0, l, from: { x: S.fx, y: S.fy }, dist: Math.hypot(l.x - S.fx, l.y - S.fy) };
  state = 'glide';
}
function updateGlide(dt) {
  const q = seq; q.t += dt;
  const dur = Math.max(0.4, Math.min(2.5, q.dist / 14));
  const k = Math.min(1, q.t / dur);
  S.fx = q.from.x + (q.l.x - q.from.x) * ease(k); S.fy = q.from.y + (q.l.y - q.from.y) * ease(k);
  if (Math.abs(q.l.x - q.from.x) + Math.abs(q.l.y - q.from.y) > 0) S.dir = dirTo(q.from, q.l);
  S.streaks.update(dt, S.dir, true, false);
  if (k >= 1) beginLanding(q.l, true);
}

// Swap which Pokémon you are riding, in mid-air.
function beginSwap(idx, then) {
  seq = { kind: 'swap', t: 0, idx, then, swapped: false };
  state = 'swap';
  sfx.recall();
}
function updateSwap(dt) {
  const q = seq; q.t += dt;
  q.flash = q.t < 0.35 ? q.t / 0.35 : Math.max(0, 1 - (q.t - 0.35) / 0.35);
  if (q.t >= 0.35 && !q.swapped) {
    q.swapped = true; G.mountIdx = q.idx; const m = G.party[q.idx]; mount.key = m.species; mount.shiny = m.shiny;
    sfx.ballOpen(); cry(m.species);
  }
  if (q.t >= 0.8) { seq = null; state = 'sky'; if (q.then) q.then(); }
}

// ---------------------------------------------------------------- the sky
function stepTime() { return S.boost ? 0.1 : 0.19; }
function updateSky(dt) {
  S.boost = input.held('b');
  S.streaks.update(dt, S.dir, S.moving, S.boost);
  S.flapT += dt * (S.moving ? (S.boost ? 11 : 8) : 5);
  if (Math.floor(S.flapT) !== Math.floor(S.flapT - dt * (S.moving ? 8 : 5)) && Math.floor(S.flapT) % 4 === 0) sfx.flap();
  noteQueued();
  if (!S.moving) {
    if (queued.start >= 0 && takeQueued('start')) { queued.a = -1; state = 'menu'; menuCursor = 0; sfx.select(); return; }
    if (queued.a >= 0 && takeQueued('a')) { tryLand(); return; }
    const dir = input.dir();
    if (dir) {
      S.dir = dir;
      const nx = S.x + DIRS[dir].x * STEP_TILES, ny = S.y + DIRS[dir].y * STEP_TILES;
      if (nx < 2 || ny < 2 || nx > world.W - 3 || ny > world.H - 3) { if (input.just(dir)) sfx.bump(); }
      else { S.fromX = S.x; S.fromY = S.y; S.x = nx; S.y = ny; S.moving = true; S.prog = 0; }
    }
  }
  if (S.moving) {
    S.prog += dt / stepTime();
    if (S.prog >= 1) {
      S.moving = false; S.prog = 0; S.fx = S.x; S.fy = S.y;
      onSkyStep();
      // keep gliding without a stutter when a direction is held
      if (state === 'sky' && input.dir() && !input.just('a')) updateSky(0);
    } else { S.fx = S.fromX + (S.x - S.fromX) * S.prog; S.fy = S.fromY + (S.y - S.fromY) * S.prog; }
  }
}
function onSkyStep() {
  G.skySteps++;
  const area = world.areaAt(S.x, S.y);
  if (area && area !== S.lastArea) { S.lastArea = area; showBanner(area); }
  if (G.repel > 0) {
    G.repel--;
    if (G.repel === 0) { say("REPEL's effect wore off…"); return; }
  }
  const z = zoneAt(world, S.x, S.y);
  let enc = null;
  if (forcedEncounter) { enc = forcedEncounter; forcedEncounter = null; }
  else if (!encountersOn) return;
  else if (S.clock.step(z.zone)) enc = rollEncounter(world, S.x, S.y);
  if (!enc) return;
  if (G.repel > 0 && !enc.forced) {
    const lead = G.party.find((m) => m.hp > 0);
    if (lead && enc.level < lead.level) return;
  }
  startEncounter(enc);
}
function startEncounter(enc) {
  const wild = makeMon(enc.species, enc.level, { shiny: enc.shiny != null ? enc.shiny : RNG.rand() < 1 / 8192 });
  const snap = document.createElement('canvas'); snap.width = VW; snap.height = VH;
  snap.getContext('2d').drawImage(canvas, 0, 0);
  seq = { kind: 'transition', t: 0, wild, snap };
  state = 'transition';
  wind(false);
  music.play('battle');
}
function updateTransition(dt) {
  seq.t += dt;
  if (seq.t >= 1.35) {
    G.battle = new Battle(G, seq.wild);
    seq = null; state = 'battle';
  }
}
function updateBattleState(dt) {
  const b = G.battle;
  b.update(dt, input);
  if (!b.finished) return;
  if (b.finished === 'whiteout') { G.battle = null; beginWhiteout(); return; }
  seq = { kind: 'battleOut', t: 0, outcome: b.finished };
  state = 'battleOut';
  if (b.finished !== 'caught') music.stop(0.5);
}
function updateBattleOut(dt) {
  const q = seq; q.t += dt;
  if (q.t >= 0.4 && G.battle) { G.battle = null; music.play('sky'); wind(true); S.clock.reset(); }
  if (q.t >= 0.8) {
    seq = null; state = 'sky';
    const m = G.party[G.mountIdx];
    if (!m || m.hp <= 0) {
      const next = flyerIndex();
      const name = m ? m.name : 'Your POKéMON';
      if (next >= 0 && next !== G.mountIdx) say(`${name} is too tired\nto keep flying!`, () => beginSwap(next, () => say(`${G.party[next].name} took over!`)));
      else say(`${name} is too tired\nto keep flying!`, () => say(`${name} glided down\nto the ground…`, beginGlide));
    }
  }
}

// ---------------------------------------------------------------- whiteout
function beginWhiteout() {
  seq = { kind: 'whiteout', t: 0 };
  state = 'whiteout';
  wind(false); music.stop(0.6);
}
function updateWhiteout(dt) {
  const q = seq; q.t += dt;
  if (q.t >= 0.9 && !q.moved) {
    q.moved = true;
    G.battle = null; G.flying = false; scene = 'ground'; S.z = 1; S.k = 0; S.lift = 0;
    for (const m of G.party) healMon(m);
    const town = world.towns.find((t) => t.id === G.lastTown) || startTown;
    placeActor(player, town.land.x, town.land.y, 'down'); player.visible = true;
    placeFollowerNear(town.land.x, town.land.y); refreshFollower();
  }
  if (q.t >= 1.6) {
    seq = null; state = 'walk'; music.play('route');
    const town = world.towns.find((t) => t.id === G.lastTown) || startTown;
    const where = town.id === 'MAP_PALLET_TOWN' ? 'home' : 'a POKéMON CENTER';
    say(`RED scurried to ${where}, protecting the exhausted and fainted POKéMON from further harm…`, () => say('Your POKéMON were restored to full health.'));
  }
}

// ---------------------------------------------------------------- walking
function tryWalk(dir) {
  const a = player, d = DIRS[dir];
  a.dir = dir;
  let nx = a.tx + d.x, ny = a.ty + d.y, dist = 1;
  if (world.pcDoor(nx, ny)) { healAt(world.townByDoor(nx, ny)); return false; }
  const b = world.behaviorAt(nx, ny);
  if (JUMP_DIR[b]) { if (JUMP_DIR[b] !== dir) return false; nx += d.x; ny += d.y; dist = 2; }
  if (world.isBlocked(nx, ny) || world.isWater(nx, ny)) return false;
  const prevX = a.tx, prevY = a.ty;
  a.fromX = a.tx; a.fromY = a.ty; a.tx = nx; a.ty = ny; a.moving = true; a.prog = 0; a.dist = dist;
  a.speed = input.held('b') ? RUN_T : WALK_T;
  if (follower.visible) {
    if (follower.tx === nx && follower.ty === ny) placeActor(follower, prevX, prevY, dir);
    else if (!(follower.tx === prevX && follower.ty === prevY)) {
      const fdx = prevX - follower.tx, fdy = prevY - follower.ty;
      const straight = (fdx === 0 || fdy === 0) && Math.abs(fdx) + Math.abs(fdy) <= 2;
      if (straight) {
        follower.dir = fdx > 0 ? 'right' : fdx < 0 ? 'left' : fdy > 0 ? 'down' : 'up';
        follower.fromX = follower.tx; follower.fromY = follower.ty; follower.tx = prevX; follower.ty = prevY;
        follower.moving = true; follower.prog = 0; follower.dist = Math.abs(fdx) + Math.abs(fdy); follower.speed = a.speed;
      } else placeActor(follower, prevX, prevY, dir);
    }
  }
  return true;
}
function healAt(town) {
  if (!town) return;
  const pallet = town.id === 'MAP_PALLET_TOWN';
  say(pallet ? 'MOM: RED! You should take a quick rest.' : 'Welcome to our POKéMON CENTER! Let me heal your POKéMON.', () => {
    for (const m of G.party) healMon(m);
    G.lastTown = town.id;
    sfx.heal();
    say(pallet ? 'MOM: Oh, good! You and your POKéMON are looking great! Take care now!' : "We've restored your POKéMON to full health. We hope to see you again!");
  });
}
// START and A pressed mid-step are held over until the step finishes (briefly), as in the game.
const queued = { start: -1, a: -1 };
const QUEUE_T = 0.35;
function takeQueued(k) { if (queued[k] >= 0 && time - queued[k] <= QUEUE_T) { queued[k] = -1; return true; } queued[k] = -1; return false; }
function noteQueued() { if (input.just('start')) queued.start = time; if (input.just('a')) queued.a = time; }
let turnHold = 0;
function updateWalk(dt) {
  noteQueued();
  updateActor(player, dt); updateActor(follower, dt);
  if (!player.moving && queued.start >= 0 && takeQueued('start')) { queued.a = -1; state = 'menu'; menuCursor = 0; sfx.select(); return; }
  if (!player.moving) {
    const dir = input.dir();
    if (!dir) turnHold = 0;
    else if (dir !== player.dir && input.just(dir)) { player.dir = dir; turnHold = 0.1; } // a tap turns in place
    else if (turnHold > 0) turnHold -= dt;
    else {
      if (!tryWalk(dir) && input.just(dir) && state === 'walk') sfx.bump();
      else if (state === 'walk' && player.moving) {
        queued.a = -1;
        const area = world.areaAt(player.tx, player.ty);
        if (area !== S.walkArea) { S.walkArea = area; if (area) showBanner(area); }
      }
    }
  }
  if (queued.a >= 0 && !player.moving && state === 'walk' && takeQueued('a')) {
    const d = DIRS[player.dir];
    const fx = player.tx + d.x, fy = player.ty + d.y;
    if (world.pcDoor(fx, fy)) healAt(world.townByDoor(fx, fy));
    else if (world.isWater(fx, fy)) say('The water is dyed a deep blue…');
  }
}

// ---------------------------------------------------------------- menus / overlays
function updateMenu() {
  const items = menuItems();
  if (input.just('up')) { menuCursor = (menuCursor + items.length - 1) % items.length; sfx.move(); }
  if (input.just('down')) { menuCursor = (menuCursor + 1) % items.length; sfx.move(); }
  if (input.just('b') || input.just('start')) { state = home(); sfx.cancel(); return; }
  if (!input.just('a')) return;
  sfx.select();
  const it = items[menuCursor];
  if (it === 'EXIT') state = home();
  else if (it === 'POKéMON') openParty();
  else if (it === 'BAG') { state = 'bag'; bagCursor = 0; }
  else if (it === 'POKéDEX') { state = 'dex'; dexCursor = 0; }
  else if (it === 'RED') state = 'card';
  else if (it === 'MAP') {
    state = 'map';
    const cell = world.regionCell(scene === 'sky' ? S.x : player.tx, scene === 'sky' ? S.y : player.ty) || { x: 4, y: 11 };
    mapCursor.x = cell.x; mapCursor.y = cell.y;
  } else if (it === 'SAVE') {
    if (scene === 'sky') { state = home(); say("You can't save while you're up in the sky. Land first!"); return; }
    state = home();
    ask('Would you like to save the game?', () => { const ok = saveGame(); if (ok) sfx.save(); say(ok ? 'RED saved the game.' : 'The save failed.'); }, () => {});
  } else if (it === 'FLY') {
    const i = flyerIndex();
    state = 'walk';
    const tired = G.party.find((m) => species(m.species).canFly);
    if (i < 0) say(tired ? `${tired.name} is too tired to fly. Rest at a POKéMON CENTER first.` : 'No POKéMON in your party can use FLY.');
    else beginTakeoff(i);
  } else if (it === 'LAND') { state = 'sky'; tryLand(); }
}
function updateMsg(dt) {
  const m = msg;
  const page = m.pages[m.page];
  const total = page.reduce((n, l) => n + l.length, 0);
  if (m.shown < total) {
    m.shown = Math.min(total, m.shown + dt * 60);
    if (input.just('a') || input.just('b')) m.shown = total;
    return;
  }
  if (m.ask && m.page === m.pages.length - 1) {
    if (!yesno) yesno = { cursor: 0 };
    if (input.just('up') || input.just('down')) { yesno.cursor ^= 1; sfx.move(); }
    if (input.just('a') || input.just('b')) {
      const yes = input.just('a') && yesno.cursor === 0;
      sfx[yes ? 'select' : 'cancel']();
      const cb = yes ? m.ask.onYes : m.ask.onNo;
      yesno = null; msg = null; state = m.from === 'msg' ? home() : m.from;
      if (cb) cb();
    }
    return;
  }
  if (input.just('a') || input.just('b')) {
    sfx.select();
    if (m.page < m.pages.length - 1) { m.page++; m.shown = 0; return; }
    msg = null; state = m.from === 'msg' ? home() : m.from;
    if (m.then) m.then();
  }
}
function updateBag() {
  const entries = bagEntries(G.bag);
  const n = entries.length + 1;
  if (input.just('up')) { bagCursor = (bagCursor + n - 1) % n; sfx.move(); }
  if (input.just('down')) { bagCursor = (bagCursor + 1) % n; sfx.move(); }
  if (input.just('b') || (input.just('a') && bagCursor === n - 1)) { state = home(); sfx.cancel(); return; }
  if (!input.just('a')) return;
  sfx.select();
  const it = entries[bagCursor];
  if (it.ball) { state = home(); say("OAK: RED! This isn't the time to use that!"); return; }
  if (it.repel) {
    state = home();
    if (G.repel > 0) { say('The REPEL is still working.'); return; }
    G.bag[it.key]--; G.repel = it.repel; say('RED used the REPEL.');
    return;
  }
  state = 'party';
  partyUI = new PartyScreen({
    party: G.party, mode: 'item', prompt: 'Use on which POKéMON?', flyingIdx: G.flying ? G.mountIdx : -1,
    onDone: (i) => {
      if (i == null) { partyUI = null; state = 'bag'; return; }
      const mon = G.party[i];
      const res = G.itemEffect(it.key, mon);
      if (!res) { partyUI.say("It won't have any effect."); return; }
      G.bag[it.key]--; G.applyItem(it.key, mon, res); sfx.heal();
      partyUI.say(res.text, () => { partyUI = null; state = 'bag'; bagCursor = Math.min(bagCursor, bagEntries(G.bag).length); });
    },
    actionsFor: () => [],
  });
}

// ---------------------------------------------------------------- update
function update(dt) {
  time += dt;
  G.playTime += dt;
  banner.t += dt;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  switch (state) {
    case 'walk': updateWalk(dt); break;
    case 'sky': updateSky(dt); break;
    case 'menu': updateMenu(); break;
    case 'msg': updateMsg(dt); break;
    case 'party': partyUI.update(dt, input); break;
    case 'bag': updateBag(); break;
    case 'dex': {
      const n = [...G.dex.seen].length;
      if (input.just('up') && dexCursor > 0) { dexCursor--; sfx.move(); }
      if (input.just('down') && dexCursor < n - 1) { dexCursor++; sfx.move(); }
      if (input.just('b') || input.just('a')) { state = home(); sfx.cancel(); }
      break;
    }
    case 'card': if (input.just('a') || input.just('b')) { state = home(); sfx.cancel(); } break;
    case 'map': {
      let moved = false;
      if (input.just('up') && mapCursor.y > 0) { mapCursor.y--; moved = true; }
      if (input.just('down') && mapCursor.y < GRID_H - 1) { mapCursor.y++; moved = true; }
      if (input.just('left') && mapCursor.x > 0) { mapCursor.x--; moved = true; }
      if (input.just('right') && mapCursor.x < GRID_W - 1) { mapCursor.x++; moved = true; }
      if (moved) sfx.move();
      if (input.just('b') || input.just('a')) { state = home(); sfx.cancel(); }
      break;
    }
    case 'takeoff': updateTakeoff(dt); break;
    case 'landing': updateLanding(dt); break;
    case 'glide': updateGlide(dt); break;
    case 'swap': updateSwap(dt); S.streaks.update(dt, S.dir, false, false); break;
    case 'transition': updateTransition(dt); break;
    case 'battle': updateBattleState(dt); break;
    case 'battleOut': updateBattleOut(dt); break;
    case 'whiteout': updateWhiteout(dt); break;
  }
  if (scene === 'sky' && state !== 'sky' && state !== 'glide' && state !== 'swap') S.streaks.update(dt, S.dir, false, false);

  // camera: world pixel at the centre of the view
  // On foot the view stops at the edge of the world like the game's; in the air it never clamps,
  // so the rider stays centred and the world simply ends in open sky.
  const target = cameraTarget();
  const z = airborneView() ? S.z : 1;
  const hw = VW / 2 / z, hh = VH / 2 / z;
  const clampX = Math.max(hw, Math.min(world.W * TILE - hw, target.x));
  const clampY = Math.max(hh, Math.min(world.H * TILE - hh, target.y));
  const free = airborneView() ? clamp01((1 - S.z) / (1 - SKY_ZOOM)) : 0;
  cam.x = clampX + (target.x - clampX) * free;
  cam.y = clampY + (target.y - clampY) * free;
  preload(cam.x, cam.y, airborneView());
}
// In the air the view is lifted so the rider, not the patch of ground under it, sits mid-screen.
const SKY_CAM_OFF = 36;
function airborneView() { return scene === 'sky' || state === 'takeoff' || state === 'landing'; }
function cameraTarget() {
  const at = (x, y) => ({ x: x * TILE + 8, y: y * TILE + 8 });
  const q = seq;
  if (q && q.kind === 'takeoff') {
    if (q.phase === 'liftoff' || q.phase === 'ascend') {
      const p = at(player.tx, player.ty), s = at(q.spot.x, q.spot.y);
      const k = q.phase === 'liftoff' ? ease(Math.min(1, q.t / 0.8)) : 1;
      return { x: p.x + (s.x - p.x) * k, y: p.y + (s.y - p.y) * k - (SKY_CAM_OFF * S.k) / S.z };
    }
    return at(player.fx, player.fy);
  }
  if (q && q.kind === 'landing') {
    if (q.hop) return at(q.hop.x, q.hop.y);
    if (q.phase === 'recall' || q.phase === 'followerPop') return at(player.fx, player.fy);
  }
  if (airborneView()) { const g = at(S.fx, S.fy); return { x: g.x, y: g.y - (SKY_CAM_OFF * S.k) / S.z }; }
  return at(player.fx, player.fy);
}

// ---------------------------------------------------------------- draw
function groundCam() { return { x: Math.round(cam.x - VW / 2), y: Math.round(cam.y - VH / 2) }; }
function drawActor(c, a, frames, lift = 0) {
  if (!a.visible || !frames) return;
  const f = frames[a.dir][actorFrame(a)];
  ctx.drawImage(f, Math.round(a.fx * TILE - c.x - (f.width - 16) / 2), Math.round(a.fy * TILE - c.y - 16 - lift - hopLift(a)));
}
function followerFrames() { const m = followerMon(); return m ? owFrames(m.species, m.shiny) : null; }
function drawParticles(c) { for (const p of particles) { ctx.fillStyle = p.col; ctx.fillRect(Math.round(p.x - c.x), Math.round(p.y - c.y), p.size, p.size); } }
function whiteOver(img, sx, sy, alpha, color = '#fff') {
  if (alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(silhouette(img, color), sx, sy); ctx.globalAlpha = 1;
}
function drawBurst(x, y, k) {
  ctx.globalAlpha = 1 - k; ctx.fillStyle = '#f8f8f8';
  ctx.beginPath(); ctx.arc(x, y, 4 + k * 14, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  const f = SPR.sparkle[Math.floor(time * 12) % 2];
  for (const [ox, oy] of [[-12, -10], [10, -12], [-10, 6], [12, 4]]) ctx.drawImage(f, Math.round(x + ox * (0.4 + k) - 8), Math.round(y + oy * (0.4 + k) - 8));
}

function drawWalkScene() {
  const c = groundCam();
  drawSurfaceBelow(ctx, c);
  const list = [];
  const ff = followerFrames();
  const q = seq;
  if (follower.visible && ff) {
    list.push({ y: follower.fy, fn: () => {
      const lift = q && q.kind === 'landing' && q.fLift ? q.fLift : 0;
      drawActor(c, follower, ff, lift);
      if (q && q.kind === 'takeoff' && q.fFlash > 0) {
        const f = ff[follower.dir][0];
        whiteOver(f, Math.round(follower.fx * TILE - c.x - 8), Math.round(follower.fy * TILE - c.y - 16), q.fFlash);
      }
    } });
  }
  if (player.visible && !(q && q.hop)) {
    if (q && q.kind === 'takeoff' && (q.phase === 'throw' || q.phase === 'ball')) {
      list.push({ y: player.fy, fn: () => ctx.drawImage(SPR.throwPose[q.phase === 'throw' && q.t < 0.18 ? 0 : 1], Math.round(player.fx * TILE - c.x), Math.round(player.fy * TILE - c.y - 16)) });
    } else list.push({ y: player.fy, fn: () => drawActor(c, player, SPR.player) });
  }
  // the flyer on the ground (take-off before mounting, landing after dismounting)
  if (q && q.kind === 'takeoff' && q.monVisible && !q.riding) {
    const sp = q.spot;
    list.push({ y: sp.y, fn: () => {
      const f = owFrames(mount.key, mount.shiny)[sp.dir][Math.floor(time * 4) % 2 ? 1 : 0];
      const sx = Math.round(sp.x * TILE - c.x - 8), sy = Math.round(sp.y * TILE - c.y - 16);
      ctx.drawImage(f, sx, sy);
      whiteOver(f, sx, sy, q.flash);
    } });
  }
  if (q && q.kind === 'landing' && (q.phase === 'dismount' || q.phase === 'recall') && !q.monGone) {
    const l = q.l;
    list.push({ y: l.y, fn: () => {
      const f = owFrames(mount.key, mount.shiny)[S.dir][Math.floor(time * 4) % 2 ? 1 : 0];
      const sx = Math.round(l.x * TILE - c.x - 8), sy = Math.round(l.y * TILE - c.y - 16);
      ctx.drawImage(f, sx, sy);
      whiteOver(f, sx, sy, q.flash || 0);
    } });
  }
  if (q && q.hop) list.push({ y: q.hop.y + 0.5, fn: () => { const f = SPR.player[player.dir][0]; ctx.drawImage(f, Math.round(q.hop.x * TILE - c.x), Math.round(q.hop.y * TILE - c.y - 16 - q.hop.lift)); } });
  list.sort((a, b) => a.y - b.y).forEach((s) => s.fn());
  if (q && q.ball) ctx.drawImage(SPR.ball[0], Math.round(q.ball.x - 8 - c.x), Math.round(q.ball.y - 8 - c.y));
  if (q && q.kind === 'takeoff' && q.phase === 'open') drawBurst(Math.round(q.spot.x * TILE + 8 - c.x), Math.round(q.spot.y * TILE + 6 - c.y), Math.min(1, q.t / 0.45));
  drawParticles(c);
  drawSurfaceAbove(ctx, c);
}

// World pixel → screen at the current zoom.
function toScreen(wx, wy, z) { return { x: (wx - cam.x) * z + VW / 2, y: (wy - cam.y) * z + VH / 2 }; }

function drawRider(sx, sy, lift, flash = 0) {
  const frames = riderFrames(mount.key, mount.shiny);
  const f = frames[S.dir][Math.floor(S.flapT) % 2];
  const bob = S.k > 0.5 ? Math.round(Math.sin(time * 3) * 1.5) : 0;
  const x = Math.round(sx - 16), y = Math.round(sy - 40 - lift + bob);
  ctx.drawImage(f, x, y);
  if (flash > 0) whiteOver(f, x, y, flash);
}

function drawSkyScene() {
  const z = S.z, k = S.k;
  const full = clamp01((z - SKY_ZOOM) / (1 - SKY_ZOOM) * 1.25 - 0.1);
  drawGround(ctx, cam.x, cam.y, z, full);
  drawCloudShadows(ctx, cam.x, cam.y, z, time, clamp01(k * 1.4 - 0.3));
  drawHaze(ctx, k);
  const gp = toScreen(S.fx * TILE + 8, S.fy * TILE + 8, z);
  drawClouds(ctx, 'low', cam.x, cam.y, time, clamp01(k * 1.6 - 0.5));
  drawShadow(ctx, gp.x, gp.y + 6 * z, 0.5 + z * 0.5, 0.32 * (0.45 + 0.55 * z));
  const lift = S.lift + k * 10;
  const flash = seq && seq.kind === 'swap' ? seq.flash : 0;
  drawRider(gp.x, gp.y, lift, flash);
  drawClouds(ctx, 'high', cam.x, cam.y, time, clamp01(k * 1.6 - 0.6));
  S.streaks.draw(ctx, k);
}

function drawTakeoffOrLanding() {
  const q = seq;
  const onGround = q.kind === 'takeoff' ? !['liftoff', 'ascend'].includes(q.phase) : ['dismount', 'recall', 'followerPop'].includes(q.phase);
  if (onGround) { drawWalkScene(); return; }
  if ((q.kind === 'takeoff' && q.phase === 'liftoff') || (q.kind === 'landing' && q.phase === 'touchdown')) {
    // still at full zoom: the map, then the flyer above everything with its shadow on the ground
    drawGroundScene();
    const sp = q.kind === 'takeoff' ? q.spot : q.l;
    const c = groundCam();
    const gx = sp.x * TILE + 8 - c.x, gy = sp.y * TILE + 8 - c.y;
    drawShadow(ctx, gx, gy + 6, 1, 0.3 * (S.lift / 22));
    drawRider(gx, gy, S.lift);
    return;
  }
  drawSkyScene();
}
function drawGroundScene() {
  // the overworld without sprites (used under a flyer that is just above the ground)
  const c = groundCam();
  drawSurfaceBelow(ctx, c);
  if (follower.visible && followerFrames()) drawActor(c, follower, followerFrames());
  drawParticles(c);
  drawSurfaceAbove(ctx, c);
}

function drawMenu() {
  const items = menuItems();
  const x = VW - 80, y = 0, w = 80, h = listHeight(items.length);
  drawWindow(ctx, x, y, w, h);
  items.forEach((it, i) => {
    const blue = it === 'FLY' || it === 'LAND';
    drawText(ctx, it, x + 18, y + 6 + i * 16, blue ? '#3058c8' : FG, blue ? '#a8c0f0' : SH);
    if (i === menuCursor) cursorArrow(ctx, x + 9, y + 9 + i * 16);
  });
  // FireRed shows a one-line hint under the menu
  const hints = { 'POKéDEX': 'A device that records POKéMON secrets.', 'POKéMON': 'Check and organize POKéMON in your party.', 'BAG': 'Equipped with pockets for storing items.',
    'FLY': 'Take to the sky with a flying POKéMON.', 'LAND': 'Set down on the ground below.', 'MAP': 'See where you are in KANTO.', 'RED': 'Check your money and game data.',
    'SAVE': 'Save your game.', 'EXIT': 'Close this menu window.' };
  drawWindow(ctx, 0, VH - 32, VW, 32);
  drawText(ctx, hints[items[menuCursor]] || '', 10, VH - 24, FG, SH);
}

function drawScene() {
  if (state === 'takeoff' || state === 'landing') { drawTakeoffOrLanding(); return; }
  if (scene === 'sky') drawSkyScene(); else drawWalkScene();
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  if (state === 'battle' || (state === 'battleOut' && G.battle)) {
    G.battle.draw(ctx);
    if (state === 'battleOut') drawFill(ctx, '#000', seq.t / 0.4);
    return;
  }
  if (state === 'transition') { drawTransition(); return; }
  if (state === 'party' && partyUI) { partyUI.draw(ctx); return; }
  if (state === 'bag') { drawBag(ctx, bagEntries(G.bag), bagCursor, 'ITEMS'); return; }
  if (state === 'dex') { drawDex(ctx, G.dex, Object.keys(A.dex.species), dexCursor); return; }
  if (state === 'card') {
    const s = Math.floor(G.playTime);
    drawTrainerCard(ctx, { id: '24842', money: G.money, owned: G.dex.caught.size, time: `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`, skySteps: G.skySteps });
    return;
  }
  if (state === 'map') { drawRegionMap(ctx, mapCursor, world.regionCell(scene === 'sky' ? S.x : player.tx, scene === 'sky' ? S.y : player.ty), time, scene === 'sky'); return; }
  drawScene();
  // map-name popup, FireRed style
  if (banner.text && (state === 'sky' || state === 'walk' || state === 'glide')) {
    const t = banner.t, slide = t < 0.25 ? -24 * (1 - t / 0.25) : t > 2.4 ? -24 * Math.min(1, (t - 2.4) / 0.25) : 0;
    if (t < 2.65) drawBanner(ctx, banner.text, 1, slide);
  }
  if (G.repel > 0 && scene === 'sky') { /* no HUD: FireRed shows nothing either */ }
  if (state === 'menu') drawMenu();
  if (state === 'msg' && msg) {
    const page = msg.pages[msg.page];
    const total = page.reduce((n, l) => n + l.length, 0);
    const done = msg.shown >= total;
    drawMessage(ctx, page, Math.floor(msg.shown), done && !(msg.ask && msg.page === msg.pages.length - 1), time);
    if (msg.ask && done && msg.page === msg.pages.length - 1) {
      drawWindow(ctx, VW - 64, VH - 48 - 44, 64, 44);
      drawText(ctx, 'YES', VW - 64 + 18, VH - 48 - 44 + 6, FG, SH);
      drawText(ctx, 'NO', VW - 64 + 18, VH - 48 - 44 + 22, FG, SH);
      cursorArrow(ctx, VW - 64 + 9, VH - 48 - 44 + 9 + (yesno ? yesno.cursor : 0) * 16);
    }
  }
  if (state === 'whiteout') drawFill(ctx, '#000', seq.t < 0.9 ? seq.t / 0.8 : Math.max(0, 1 - (seq.t - 0.9) / 0.6));
  if (state === 'battleOut' && !G.battle) drawFill(ctx, '#000', Math.max(0, 1 - (seq.t - 0.4) / 0.4));
}

// FireRed's wild-battle transition: the screen flashes, then slices apart into black.
function drawTransition() {
  const t = seq.t;
  const snap = seq.snap;
  if (t < 0.62) {
    ctx.drawImage(snap, 0, 0);
    const ph = Math.floor(t / 0.1);
    if (ph % 2 === 0 && ph < 6) drawFill(ctx, '#ffffff', 0.85);
    return;
  }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
  const k = clamp01((t - 0.62) / 0.55);
  const e = k * k;
  for (let y = 0; y < VH; y += 4) {
    const dir = (y / 4) % 2 === 0 ? -1 : 1;
    const off = Math.round(dir * e * VW * (1 + ((y / 4) % 3) * 0.15));
    ctx.drawImage(snap, 0, y, VW, 4, off, y, VW, 4);
  }
}

// ---------------------------------------------------------------- boot + loop
if (params.has('new') || !loadGame()) newGame();
placeFollowerNear(player.tx, player.ty);
refreshFollower();
preloadCries(G.party.map((m) => m.species));
const firstMusic = () => { music.play('route'); };
window.addEventListener('keydown', firstMusic, { once: true });
window.addEventListener('pointerdown', firstMusic, { once: true });
showBanner(world.areaAt(player.tx, player.ty));

let last = performance.now();
let paused = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) { update(dt); draw(); input.endFrame(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- headless hooks
const isDir = (k) => ['up', 'down', 'left', 'right'].includes(k);
window.__sky = {
  G, S, world, player, follower, A,
  state: () => state, scene: () => scene, seq: () => seq, battle: () => G.battle, msg: () => msg,
  pause: (v = true) => { paused = v; },
  seed: (n) => RNG.seed(n),
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { update(dt); draw(); input.endFrame(); } },
  press: (k, frames = 1) => { input.pressed.add(k); input.down.add(k); if (isDir(k)) input.lastDir = k; for (let i = 0; i < frames; i++) { update(1 / 60); draw(); input.endFrame(); } input.down.delete(k); },
  hold: (k, n = 1) => { input.down.add(k); input.pressed.add(k); if (isDir(k)) input.lastDir = k; for (let i = 0; i < n; i++) { update(1 / 60); draw(); input.endFrame(); } input.down.delete(k); },
  tick: ({ hold, press, dt = 1 / 30, capture = true } = {}) => {
    if (press) { input.pressed.add(press); input.down.add(press); if (isDir(press)) input.lastDir = press; }
    if (hold) { for (const h of [].concat(hold)) { input.down.add(h); if (isDir(h)) input.lastDir = h; } }
    update(dt); draw(); input.endFrame();
    if (press) input.down.delete(press);
    if (hold) for (const h of [].concat(hold)) input.down.delete(h);
    return capture ? canvas.toDataURL('image/png') : null;
  },
  frame: () => canvas.toDataURL('image/png'),
  pending: () => chunksPending(),
  teleport: (x, y, dir = 'down') => { placeActor(player, x, y, dir); placeFollowerNear(x, y); refreshFollower(); },
  fly: (i) => beginTakeoff(i == null ? flyerIndex() : i),
  flyNow: (x, y, i) => { // jump straight into the sky (for tests)
    const idx = i == null ? flyerIndex() : i; G.mountIdx = idx; mount.key = G.party[idx].species; mount.shiny = G.party[idx].shiny;
    G.flying = true; scene = 'sky'; state = 'sky'; seq = null; S.x = S.fx = S.fromX = x; S.y = S.fy = S.fromY = y; S.z = SKY_ZOOM; S.k = 1; S.lift = 22; S.moving = false;
    player.visible = false; follower.visible = false; wind(true); music.play('sky');
    S.lastArea = world.areaAt(x, y); showBanner(S.lastArea);
  },
  nextEncounter: (sp, level, shiny = false) => { forcedEncounter = { species: sp, level, shiny, forced: true }; },
  encounter: (sp, level, shiny = false) => startEncounter({ species: sp, level, shiny }),
  encounters: (on) => { encountersOn = on; },
  newGame: () => { newGame(); refreshFollower(); },
  zone: () => zoneAt(world, S.x, S.y),
  save: saveGame,
  playMusic: (n) => music.play(n),
  clearSave: () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },
};
// Audio recording for the video renderer: game time advances with each tick.
let audioClock = 0;
const baseTick = window.__sky.tick;
window.__sky.startAudio = () => { audioClock = 0; startRecording(() => audioClock); window.__sky.tick = (o = {}) => { const r = baseTick(o); audioClock += o.dt || 1 / 30; return r; }; };
window.__sky.renderAudio = (duration) => renderRecording(duration);
window.__sky.ready = true;
