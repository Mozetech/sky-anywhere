// The stitched FireRed Kanto: collision, metatile behaviours, map areas, and where you can land.
import { A } from './assets.js';

export const TILE = 16;
export const MB = {
  TALL_GRASS: 0x02,
  JUMP_EAST: 0x38, JUMP_WEST: 0x39, JUMP_NORTH: 0x3A, JUMP_SOUTH: 0x3B,
  WATER: new Set([0x10, 0x11, 0x12, 0x13, 0x15, 0x16, 0x17, 0x19, 0x1A, 0x1B]),
};
export const JUMP_DIR = { [MB.JUMP_EAST]: 'right', [MB.JUMP_WEST]: 'left', [MB.JUMP_NORTH]: 'up', [MB.JUMP_SOUTH]: 'down' };
const SEA_MAPS = new Set(['MAP_ROUTE19', 'MAP_ROUTE20', 'MAP_ROUTE21_NORTH', 'MAP_ROUTE21_SOUTH']);
const N4 = [[0, 1], [-1, 0], [1, 0], [0, -1]];

export function buildWorld() {
  const { w: W, h: H, maps, towns } = A.world;
  const collision = A.collision, behavior = A.behavior;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const world = {
    W, H, maps, towns,
    inside,
    behaviorAt: (x, y) => (inside(x, y) ? behavior[y * W + x] : 0),
    isBlocked: (x, y) => (!inside(x, y) ? true : collision[y * W + x] === 1),
    isWater: (x, y) => MB.WATER.has(world.behaviorAt(x, y)),
    mapAt(x, y) {
      for (const m of maps) if (x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) return m;
      return null;
    },
    // The map a point belongs to, or the closest one when it is in the gaps between maps.
    nearestMap(x, y) {
      const hit = world.mapAt(x, y);
      if (hit) return hit;
      let best = null, bd = Infinity;
      for (const m of maps) {
        const dx = Math.max(0, m.x - x, x - (m.x + m.w - 1)), dy = Math.max(0, m.y - y, y - (m.y + m.h - 1));
        const d = dx + dy;
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    },
    seaBorderAt(x, y) { const m = world.nearestMap(x, y); return !!m && SEA_MAPS.has(m.id); },
    areaAt(x, y) { const m = world.mapAt(Math.floor(x), Math.floor(y)); return m ? m.name : null; },
    townAt(x, y) { const m = world.mapAt(x, y); return m ? towns.find((t) => t.id === m.id) || null : null; },
    regionCell(x, y) {
      const m = world.nearestMap(x, y);
      if (!m) return null;
      const s = A.region.sections[m.mapsec];
      if (!s) return null;
      const fx = Math.max(0, Math.min(0.999, (x - m.x) / m.w)), fy = Math.max(0, Math.min(0.999, (y - m.y) / m.h));
      return { x: s.x + Math.floor(fx * s.w), y: s.y + Math.floor(fy * s.h) };
    },
    walkable: (x, y) => !world.isBlocked(x, y) && !world.isWater(x, y) && !JUMP_DIR[world.behaviorAt(x, y)],
    // A spot the flyer can set down on: walkable, with a walkable neighbour for Red to step onto.
    landing(x, y) {
      if (!world.walkable(x, y) || world.pcDoor(x, y)) return null;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (world.walkable(nx, ny) && !world.pcDoor(nx, ny)) return { x, y, off: { x: nx, y: ny } };
      }
      return null;
    },
    // Closest landing within `r` tiles of (x, y), preferring the exact tile.
    landingNear(x, y, r = 1) {
      let best = null, bd = Infinity;
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
        const l = world.landing(xx, yy);
        if (!l) continue;
        const d = Math.abs(xx - x) + Math.abs(yy - y);
        if (d < bd) { bd = d; best = l; }
      }
      return best;
    },
    // Breadth-first search outward for the nearest landing (used when a flyer can't go on).
    nearestLanding(x, y, maxR = 80) {
      for (let r = 0; r <= maxR; r++) {
        let best = null, bd = Infinity;
        for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
          if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
          const l = world.landing(xx, yy);
          if (!l) continue;
          const d = Math.hypot(xx - x, yy - y);
          if (d < bd) { bd = d; best = l; }
        }
        if (best) return best;
      }
      return null;
    },
    // Pokémon Center door: the warp tile directly above each town's landing spot.
    pcDoor(x, y) { return towns.some((t) => t.land.x === x && t.land.y - 1 === y); },
    townByDoor(x, y) { return towns.find((t) => t.land.x === x && t.land.y - 1 === y) || null; },
  };
  return world;
}

export function hash(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
