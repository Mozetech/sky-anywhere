#!/usr/bin/env python3
"""Hash checks for setup.sh.

  python3 tools/verify.py paths <vendor-folder>   print the sparse-checkout paths for one upstream
  python3 tools/verify.py inputs [<vendor-folder>] check the upstream files the build reads (tools/upstream-inputs.tsv)
  python3 tools/verify.py assets [--quiet]        check every built file in assets/ (tools/assets.tsv)

Exit status 0 means everything matched.
"""
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INPUTS = ROOT / 'tools' / 'upstream-inputs.tsv'
ASSETS = ROOT / 'tools' / 'assets.tsv'


def rows(path):
    for line in path.read_text().splitlines():
        if line and not line.startswith('#'):
            yield line.split('\t')


def sha1(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()


def cmd_paths(folder):
    for repo, path, _, _ in rows(INPUTS):
        if repo == folder:
            print('/' + path)
    return 0


def cmd_inputs(only=None):
    bad = 0
    n = 0
    for repo, path, want, size in rows(INPUTS):
        if only and repo != only:
            continue
        n += 1
        f = ROOT / 'vendor' / repo / path
        if not f.is_file():
            print(f'missing   vendor/{repo}/{path}')
            bad += 1
        elif sha1(f) != want:
            print(f'mismatch  vendor/{repo}/{path}')
            bad += 1
    print(f'upstream inputs{" in vendor/" + only if only else ""}: {n - bad}/{n} match their SHA-1')
    return 1 if bad else 0


def pixel_key(f):
    try:
        from PIL import Image
    except ImportError:
        return None
    with Image.open(f) as im:
        return '%s:%dx%d:%s' % (im.mode, im.size[0], im.size[1], hashlib.sha1(im.convert('RGBA').tobytes()).hexdigest())


def cmd_assets(quiet=False):
    exact = pixel = 0
    bad = []
    listed = set()
    for path, want, size, px in rows(ASSETS):
        listed.add(path)
        f = ROOT / path
        if not f.is_file():
            bad.append(f'missing   {path}')
        elif sha1(f) == want:
            exact += 1
        elif px != '-' and pixel_key(f) == px:
            pixel += 1
            if not quiet:
                print(f'pixels    {path} (same image, different PNG compression)')
        else:
            bad.append(f'mismatch  {path}')
    extra = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'assets').rglob('*')
                   if p.is_file() and p.name != '.DS_Store' and str(p.relative_to(ROOT)) not in listed) \
        if (ROOT / 'assets').is_dir() else []
    if not quiet or bad:
        for line in bad:
            print(line)
    for p in extra:
        print(f'extra     {p}')
    total = len(listed)
    if not quiet or bad:
        print(f'assets: {exact}/{total} byte-identical, {pixel} pixel-identical, {len(bad)} missing or wrong, {len(extra)} unexpected')
    return 1 if bad else 0


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['paths'] and len(args) == 2:
        sys.exit(cmd_paths(args[1]))
    if args[:1] == ['inputs'] and len(args) <= 2:
        sys.exit(cmd_inputs(*args[1:]))
    if args[:1] == ['assets']:
        sys.exit(cmd_assets('--quiet' in args))
    print(__doc__.strip())
    sys.exit(2)
