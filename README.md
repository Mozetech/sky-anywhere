# Sky Anywhere

Pokémon FireRed's Kanto, where **FLY** takes you *up* and the sky becomes a place of its own. Open
the start menu and pick FLY. Red throws a Poké Ball, Pidgeot (or Charizard, or anything else that can
learn Fly) comes out, he climbs on, and the view pulls back as you rise until the Kanto map sits far
below with haze, drifting clouds and their shadows between you and the ground.

Up there you steer freely, a step at a time. Wild Pokémon live in the sky the way they live in tall
grass: you can't see them, and any step can bump into one. What you meet depends on what is under
you: Pidgey and Spearow over the fields, Butterfree and Beedrill over the forests, Wingull and
Pelipper over the sea, Gastly and Haunter over Lavender, Magnemite by the Power Plant, and very rarely
a legendary bird over its home (or Mew, anywhere). Levels follow the route below. Press A to land
wherever there is ground.

Every encounter is a battle on FireRed's battle screen with the sky battle background: FIGHT with
Gen 3 damage, accuracy, critical hits, stat stages, status and Fly as a two-turn move; BAG throws
Poké Balls with the Gen 3 catch formula or uses Potions, Revives and Full Heals; POKéMON switches; RUN
uses the Gen 3 escape odds. EXP, level-ups, fainting and whiting out all work. If the Pokémon you are
riding faints, another flyer takes over in mid-air, or it glides down to the nearest ground. Anything
you catch that can learn Fly can carry you too; ride it from the POKéMON menu.

Unofficial fan project. Not affiliated with or endorsed by Nintendo, Game Freak, Creatures, The Pokémon Company, Mojang or Microsoft.

## What this repository contains

Only original code and tools. No graphics, maps, fonts, music or sounds from the games are included.
The code does contain some short in-game text (FireRed battle and menu messages) and some game values written in by hand
(such as tile behaviour codes and wild level ranges).
`./setup.sh` fetches the public decompilation projects at pinned commits and builds the game's
assets on your machine. Third-party assets are fetched and built locally and never included here,
and `.gitignore` keeps them out of commits.

The sky's own look (the clouds, their shadows, the haze and the wind streaks) is drawn by code, the
sky encounter tables are original, and the music and sound effects are synthesized in the browser.

## Setup

You need `bash`, `git` 2.25 or newer, Python 3.10 to 3.13 with `venv`, about 1 GB of free memory
for the build and network access to github.com and pypi.org.

```bash
git clone https://github.com/Mozetech/sky-anywhere
cd sky-anywhere
./setup.sh
python3 serve.py
```

Then open http://localhost:5200 (`python3 serve.py 8000` picks another port; add `?new` to the URL to
ignore a saved game).

A first run takes under a minute (26 seconds in testing, plus the pip download of numpy and Pillow
on a machine that has never fetched them) and uses about 80 MB of disk: 14 MB of upstream sources
in `vendor/`, 55 MB for `.venv/` and 8 MB of built `assets/`. The build peaks at about 800 MB of
memory while it stitches the world.

It does this:

1. Fetches [pret/pokefirered](https://github.com/pret/pokefirered) at `c75f352` and
   [rh-hideout/pokeemerald-expansion](https://github.com/rh-hideout/pokeemerald-expansion) at
   `160396e` into `vendor/`. The fetch is shallow, sparse and blobless, so only the 1,018 files the
   build reads are downloaded (902 and 116).
2. Checks each of those files against its SHA-1 in `tools/upstream-inputs.tsv`.
3. Creates `.venv/` with numpy 2.2.2 and Pillow 11.1.0.
4. Runs `tools/build_assets.py`, which writes Red's sprites, the region map, window frame and font,
   the stitched world (collision and behaviour grids plus 246 map chunks of 512 px) and the 169
   half-resolution sky chunks.
5. Runs `tools/build_sky.py`, which writes the battle screen, every Pokémon's battle sprites, party
   icon and cry, the overworld sprites of the mounts and your buddy, the party menu, the small font,
   the clouds and `assets/data/pokemon.json` (species, moves, learnsets, type chart and EXP curves,
   parsed from the decompilation's C tables by `tools/extract_data.py`).
6. Checks all 774 built files against `tools/assets.tsv`. With the pinned Pillow they are
   byte-identical to the reference build. Another Pillow may compress PNGs differently, so PNGs that
   differ in bytes are accepted when their decoded pixels match.

Running it again skips whatever is already done and verified. Options:

| Option | What it does |
| --- | --- |
| `--rebuild` | build `assets/` again even if it verifies |
| `--prune` | delete `vendor/` and `.venv/` afterwards; `assets/` (8 MB) is all the game needs |
| `POKEFIRERED_SRC=<dir>` | fetch pret/pokefirered from a local clone that has the pinned commit, not GitHub |
| `EXPANSION_SRC=<dir>` | the same for pokeemerald-expansion |
| `PYTHON=<python>` | build the venv with this interpreter |

On Python 3.14 or newer the pinned wheels do not exist, so setup installs the current numpy and
Pillow and the pixel check applies.

## Controls

| Key | On foot | In the sky | Menus and battle |
| --- | --- | --- | --- |
| Arrows / WASD | walk (tap to turn) | fly | move the cursor |
| Z / Space | talk, or heal at a POKéMON CENTER door | land here | confirm |
| X / Esc | hold to run | hold to fly faster | back |
| Enter | start menu | start menu | |

On touch devices an on-screen pad appears.

## How it works

The build renders each map's metatiles (the bottom layer and the above-sprites top layer
separately), places the 37 outdoor maps by walking their connections from Pallet Town, fills the gaps
between maps with each map's border block, clears the surf rocks out of the sea, and writes 512 px
chunk images plus collision and behaviour grids. The sky chunks are the same map at half resolution
with both layers composited, and every tile the stitched maps leave empty is filled with the nearest
map's border block, so the ground under the clouds has no holes.

In the sky, `src/encounters.js` runs FireRed's step-based encounter clock over original tables keyed
to what lies below (fields, forest, sea, town, Power Plant, the legendary birds' homes), with levels
taken from the route underneath. `src/battle.js` is a Gen 3 battle engine drawn on FireRed's battle
screen.

## Showcase video (optional)

```bash
npm install
node tools/render_video.mjs
```

Drives the game one frame at a time through headless Google Chrome, records every sound against game
time, renders the audio offline in the page, and writes `out/sky-anywhere.mp4` with ffmpeg. The run:
take off from Pallet Town, catch a Wingull over the sea, beat a Pidgey over Route 1, switch to
Charizard in mid-air, land in Viridian City and heal. It needs the built `assets/`, Google Chrome and
ffmpeg. The video shows game graphics, so it stays out of the repository (`out/` is ignored).

## Layout

- `setup.sh` fetch, check, build and verify
- `tools/build_assets.py` maps, world chunks, sky chunks, Red, region map, window and font
- `tools/build_sky.py` battle screen, Pokémon sprites and cries, mounts, party menu, clouds, data
- `tools/extract_data.py` parses the decompilation's C data tables
- `tools/verify.py`, `tools/upstream-inputs.tsv`, `tools/assets.tsv` hash checks (hashes only)
- `tools/render_video.mjs` the showcase video
- `src/main.js` state machine: walking, menus, take-off, the sky, landing, encounters, whiteout, saving
- `src/sky.js` the sky layer: zoomed ground, haze, parallax clouds and their shadows, wind streaks
- `src/battle.js` Gen 3 battle engine and battle screen
- `src/encounters.js` sky encounter tables and the step-based encounter clock
- `src/data.js` species, moves, stats, experience; `src/rng.js` seeded RNG
- `src/partyui.js`, `src/ui.js` party screen, bag, POKéDEX, trainer card, region map, windows
- `src/audio.js` synthesized effects and music, cries, and offline audio rendering
- `serve.py` local static server

`window.__sky` exposes headless hooks: `pause`, `step`, `press`, `hold`, `tick`, `seed`,
`flyNow(x, y)`, `nextEncounter(species, level)`, `encounters(on)`, `battle()`, `state()`, `pending()`.

## Credits

- [pret/pokefirered](https://github.com/pret/pokefirered), the FireRed decompilation: every outdoor
  Kanto map with its layouts and connections, the tilesets, Red's overworld sprites, the region map,
  the window frame and fonts, the battle textboxes, healthboxes, HP and EXP bar tiles and status
  icons, the party menu, every Pokémon's battle sprites, party icons and cries, and the species,
  move, learnset and type data the engine runs on.
- [rh-hideout/pokeemerald-expansion](https://github.com/rh-hideout/pokeemerald-expansion) and the
  artists credited there: the follower-style overworld sprites (the mounts and your buddy) and the
  sky battle environment.

Pokémon and all related names are trademarks of Nintendo, Game Freak, Creatures and The Pokémon
Company.
