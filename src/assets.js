// Loads the FireRed-derived assets produced by tools/build_assets.py and tools/build_sky.py.
export const A = { img: {}, mon: {} };

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + url));
    img.src = url;
  });
}
async function loadJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); }
async function loadBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return new Uint8Array(await r.arrayBuffer()); }

export async function loadAssets() {
  const [world, collision, behavior, region, font, fontSmall, dex, battleColors, partyColors] = await Promise.all([
    loadJSON('assets/world/world.json'), loadBytes('assets/world/collision.bin'), loadBytes('assets/world/behavior.bin'),
    loadJSON('assets/ui/region.json'), loadJSON('assets/ui/font.json'), loadJSON('assets/ui/font_small.json'),
    loadJSON('assets/data/pokemon.json'), loadJSON('assets/battle/colors.json'), loadJSON('assets/ui/party_colors.json'),
  ]);
  Object.assign(A, { world, collision, behavior, region, font, fontSmall, dex, battleColors, partyColors });
  const images = {
    red: 'assets/sprites/red.png', redItem: 'assets/sprites/red_item.png', redSurf: 'assets/sprites/red_surf.png',
    ball: 'assets/sprites/ball.png', ballOpen: 'assets/sprites/ball_open.png', sparkle: 'assets/sprites/sparkle.png',
    regionmap: 'assets/ui/regionmap.png', cursor: 'assets/ui/cursor.png', playerIcon: 'assets/ui/player_icon.png',
    window: 'assets/ui/window.png', font: 'assets/ui/font.png', fontSmall: 'assets/ui/font_small.png', cloud0: 'assets/ui/sky_cloud_0.png', cloud1: 'assets/ui/sky_cloud_1.png', cloud2: 'assets/ui/sky_cloud_2.png',
    cloud3: 'assets/ui/sky_cloud_3.png', cloud4: 'assets/ui/sky_cloud_4.png', cloud5: 'assets/ui/sky_cloud_5.png',
    bgSky: 'assets/battle/bg_sky.png', bgSkyClouds: 'assets/battle/bg_sky_clouds.png',
    tbMsg: 'assets/battle/textbox_msg.png', tbAction: 'assets/battle/textbox_action.png', tbMoves: 'assets/battle/textbox_moves.png',
    hbPlayer: 'assets/battle/healthbox_singles_player.png', hbOpp: 'assets/battle/healthbox_singles_opponent.png',
    barTiles: 'assets/battle/bar_tiles.png', enemyShadow: 'assets/battle/enemy_shadow.png', statusIcons: 'assets/battle/status_icons.png', statusHb: 'assets/battle/status_healthbox.png',
    ballPoke: 'assets/battle/ball_poke.png', ballGreat: 'assets/battle/ball_great.png', ballUltra: 'assets/battle/ball_ultra.png',
    partyBg: 'assets/ui/party_bg.png', partyBall: 'assets/ui/party_ball.png', partyWideEmpty: 'assets/ui/party_wide_empty.png',
    partyCancelNormal: 'assets/ui/party_cancel_normal.png', partyCancelSelected: 'assets/ui/party_cancel_selected.png',
  };
  for (const st of ['normal', 'selected', 'fainted', 'fainted_selected', 'switching', 'switch_target']) {
    images['partyMain_' + st] = `assets/ui/party_main_${st}.png`;
    images['partyWide_' + st] = `assets/ui/party_wide_${st}.png`;
  }
  // Per-species battle sprites, icons and (for anything that can fly or follow) overworld sheets.
  const monImages = {};
  for (const [key, sp] of Object.entries(dex.species)) {
    const f = sp.file;
    monImages[key] = { front: `assets/mon/${f}_front.png`, back: `assets/mon/${f}_back.png`,
      frontShiny: `assets/mon/${f}_front_shiny.png`, backShiny: `assets/mon/${f}_back_shiny.png`, icon: `assets/mon/${f}_icon.png` };
    monImages[key].ow = `assets/sprites/ow_${f}.png`; monImages[key].owShiny = `assets/sprites/ow_${f}_shiny.png`;
  }
  const jobs = Object.entries(images).map(async ([k, url]) => { A.img[k] = await loadImage(url); });
  for (const [key, set] of Object.entries(monImages)) {
    A.mon[key] = {};
    for (const [k, url] of Object.entries(set)) jobs.push(loadImage(url).then((img) => { A.mon[key][k] = img; }));
  }
  await Promise.all(jobs);
  return A;
}

// Lazy map chunk caches. Ground chunks are 512px squares named "{cx}_{cy}" (below sprites) and
// "{cx}_{cy}_top" (above); sky chunks are the same squares at half resolution with every gap filled.
function lazyCache(dir) {
  const cache = new Map();
  return {
    get(name) {
      let e = cache.get(name);
      if (!e) {
        e = { img: new Image(), ready: false, failed: false };
        e.img.onload = () => { e.ready = true; };
        e.img.onerror = () => { e.failed = true; };
        e.img.src = `${dir}/${name}.png`;
        cache.set(name, e);
      }
      return e.ready ? e.img : null;
    },
    pending() { let n = 0; for (const e of cache.values()) if (!e.ready && !e.failed) n++; return n; },
  };
}
const ground = lazyCache('assets/world/chunks');
const sky = lazyCache('assets/sky/chunks');
let available = null;
export function chunkImage(name) {
  if (!available) available = new Set(A.world.chunks);
  if (!available.has(name)) return null;
  return ground.get(name);
}
export function skyChunkImage(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= A.world.cw || cy >= A.world.ch) return null;
  return sky.get(`${cx}_${cy}`);
}
export function chunksPending() { return ground.pending() + sky.pending(); }
