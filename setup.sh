#!/usr/bin/env bash
# Sky Anywhere setup: fetch the third-party sources at pinned commits, check every file's SHA-1,
# build assets/ with tools/build_assets.py and tools/build_sky.py, and check every built file
# against tools/assets.tsv.
# Safe to run again: finished steps are detected and skipped.
#
#   ./setup.sh             fetch, build, verify
#   ./setup.sh --rebuild   rebuild assets/ even if it already verifies
#   ./setup.sh --prune     afterwards delete vendor/ and .venv/ (assets/ is all the game needs)
#
# Environment overrides:
#   POKEFIRERED_SRC   a local clone or mirror of pret/pokefirered to fetch from instead of GitHub
#   EXPANSION_SRC     the same for rh-hideout/pokeemerald-expansion
#   PYTHON            the Python to build the venv with (3.10 to 3.13 for the pinned numpy/Pillow)
set -euo pipefail

FR_URL=https://github.com/pret/pokefirered
FR_SHA=c75f352304d529f6ba92d4f74b9cf8b5c3810788
EX_URL=https://github.com/rh-hideout/pokeemerald-expansion
EX_SHA=160396eb93dbc51105b5c6df9b24d302d2455df5
NUMPY_PIN=2.2.2
PILLOW_PIN=11.1.0
MARK=sky-anywhere-setup   # file inside a vendor repo's .git that marks it as created by this script

cd "$(dirname "$0")"
ROOT=$PWD
START=$(date +%s)
REBUILD=0
PRUNE=0
for arg in "$@"; do
  case $arg in
    --rebuild) REBUILD=1 ;;
    --prune) PRUNE=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "setup: unknown option $arg (try --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
die() { printf 'setup: %s\n' "$*" >&2; exit 1; }
command -v git >/dev/null || die "git is required"

# ---------------------------------------------------------------- Python
pick_python() {
  if [ -n "${PYTHON:-}" ]; then echo "$PYTHON"; return; fi
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(not (3, 10) <= sys.version_info[:2] <= (3, 13))' 2>/dev/null; then
      echo "$c"; return
    fi
  done
  command -v python3 >/dev/null && { echo python3; return; }
  die "python3 is required"
}
PY=$(pick_python)
if "$PY" -c 'import sys; sys.exit(not (3, 10) <= sys.version_info[:2] <= (3, 13))'; then
  PINNED=1
else
  PINNED=0
fi

# ---------------------------------------------------------------- upstream sources
is_local() { case $1 in *://*|*@*:*) return 1 ;; *) [ -d "$1" ] ;; esac; }

# fetch_repo <vendor folder> <canonical url> <commit> <source>
fetch_repo() {
  local name=$1 url=$2 sha=$3 src=$4 dir=vendor/$1 head
  head=$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true)
  if [ -e "$dir" ] && [ ! -f "$dir/.git/$MARK" ]; then
    # a checkout the player made themselves: fine if it is at the pinned commit
    [ "$head" = "$sha" ] || die "$dir exists, is not at ${sha:0:7} and was not made by setup.sh; move it away and run again"
    echo "$dir: using the existing checkout at ${sha:0:7}"; return
  fi
  if [ "$head" = "$sha" ] && "$PY" -I tools/verify.py inputs "$name" >/dev/null; then
    echo "$dir: already at ${sha:0:7}, inputs verified"; return
  fi
  rm -rf "$dir"
  mkdir -p vendor
  git init -q "$dir"
  touch "$dir/.git/$MARK"
  git -C "$dir" config core.autocrlf false
  git -C "$dir" config core.sparseCheckout true
  git -C "$dir" config core.sparseCheckoutCone false
  # Check out exactly the files the build reads; the blobless fetch then downloads only those.
  "$PY" -I tools/verify.py paths "$name" > "$dir/.git/info/sparse-checkout"
  git -C "$dir" remote add origin "$src"
  if is_local "$src"; then
    # a local upload-pack needs permission to serve a filtered fetch of one commit
    git -C "$dir" config remote.origin.uploadpack \
      'git -c uploadpack.allowFilter=true -c uploadpack.allowAnySHA1InWant=true upload-pack'
  fi
  echo "$dir: fetching ${sha:0:7} from $src"
  git -C "$dir" fetch -q --depth 1 --filter=blob:none --no-tags origin "$sha"
  [ "$(git -C "$dir" rev-parse FETCH_HEAD)" = "$sha" ] || die "$dir: fetched commit is not $sha"
  git -C "$dir" -c advice.detachedHead=false checkout -q --detach "$sha"
  git -C "$dir" config --unset remote.origin.uploadpack || true
  git -C "$dir" remote set-url origin "$url"
}

finish() {
  if [ "$PRUNE" = 1 ]; then
    say "Pruning"
    rm -rf vendor .venv .build.log
    echo "deleted vendor/ and .venv/; assets/ is all the game needs"
  fi
  say "Done in $(( $(date +%s) - START ))s"
  for d in vendor .venv assets; do if [ -d "$d" ]; then du -sh "$d"; fi; done
  echo
  echo "Play:  python3 serve.py    then open http://localhost:5200"
}

# Nothing to do when assets/ already verifies (for example after --prune).
if [ "$REBUILD" = 0 ] && [ -d assets ] && "$PY" -I tools/verify.py assets --quiet >/dev/null 2>&1; then
  say "Assets"
  echo "assets/: already built and verified (use --rebuild to build again)"
  finish
  exit 0
fi

say "Upstream sources (pinned)"
fetch_repo pokefirered "$FR_URL" "$FR_SHA" "${POKEFIRERED_SRC:-$FR_URL}"
fetch_repo pokeemerald-expansion "$EX_URL" "$EX_SHA" "${EXPANSION_SRC:-$EX_URL}"
"$PY" -I tools/verify.py inputs || die "an upstream file does not match tools/upstream-inputs.tsv"

# ---------------------------------------------------------------- build environment
say "Python environment"
VPY=.venv/bin/python
want_versions() {
  [ -x "$VPY" ] || return 1
  local have
  have=$("$VPY" -I -c 'import numpy, PIL; print(numpy.__version__, PIL.__version__)' 2>/dev/null) || return 1
  [ "$PINNED" = 0 ] || [ "$have" = "$NUMPY_PIN $PILLOW_PIN" ]
}
if want_versions; then
  echo ".venv: ready ($("$VPY" -I -c 'import numpy, PIL; print("numpy", numpy.__version__, "Pillow", PIL.__version__)'))"
else
  rm -rf .venv
  "$PY" -m venv .venv || die "could not create a venv with $PY (on Debian/Ubuntu: apt install python3-venv)"
  if [ "$PINNED" = 1 ]; then
    echo ".venv: installing numpy==$NUMPY_PIN Pillow==$PILLOW_PIN with $("$PY" -V)"
    "$VPY" -m pip install -q --disable-pip-version-check --only-binary=:all: "numpy==$NUMPY_PIN" "Pillow==$PILLOW_PIN"
  else
    echo ".venv: $("$PY" -V) is outside 3.10 to 3.13, so the pinned wheels do not exist for it."
    echo "       Installing the current numpy and Pillow; PNGs are then checked by their pixels."
    "$VPY" -m pip install -q --disable-pip-version-check numpy Pillow
  fi
fi

# ---------------------------------------------------------------- assets
say "Assets"
rm -rf assets
# build_assets.py: Red, region map, window, font, the stitched world and the sky chunks.
# build_sky.py: battle screen, Pokémon sprites, icons and cries, mounts, party menu, clouds, pokemon.json.
: > .build.log
for tool in build_assets build_sky; do
  echo "tools/$tool.py"
  "$VPY" -I "tools/$tool.py" >> .build.log 2>&1 || { tail -20 .build.log; die "tools/$tool.py failed (full log in .build.log)"; }
done
grep -E 'maps, world|cleared|filled|wrote|species, ' .build.log | sed 's/^ */  /'
"$VPY" -I tools/verify.py assets || die "built assets do not match tools/assets.tsv"
finish
