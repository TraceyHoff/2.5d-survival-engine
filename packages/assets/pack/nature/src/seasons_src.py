"""Summer source frames for the seasonal twins, re-rendered from the original generators at scale k (1 = the shipped
frame bit-for-bit, 2 = the @2x page: the toon/iso canvases supersample at 4x, so 2x is a straight resolve, no upscale).
frame_jobs(atlas) maps a shipped frame index to its generator call (same enumeration as assets/tools/build_all.py).
  python3 seasons_src.py <cache_dir> [k ...]   -> <cache_dir>/k<k>/<atlas>__<i>.png
"""
import os, sys, zlib
from multiprocessing import Pool
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../../../..'))
TOOLS = os.path.join(REPO, 'assets/tools')
sys.path.insert(0, TOOLS)

FOLIAGE_JOBS = {   # build_all.py `tall` / `small` / `big` lists (index = shipped frame)
    ('resources_tall', 0): ('nature', 'tree_oak', (), {}),
    ('resources_tall', 1): ('nature', 'tree_oak', (), {'seed': 4, 'fruit': 'berry'}),
    ('resources_tall', 3): ('nature', 'tree_pine', (), {}),
    ('resources', 4): ('nature', 'bush', (), {}),
    ('resources', 5): ('nature', 'berry_bush', (True,), {}),
    ('resources', 6): ('nature', 'berry_bush', (False,), {}),
    ('resources', 7): ('nature', 'fiber_grass', (), {}),
    ('resources', 11): ('nature', 'flowers', (), {}),
    ('resources_huge', 0): ('nature2', 'big_oak', (), {}),
}

def building_index(atlas):
    """frame index -> ('rot', key, rot, state, stage) | ('anim', key, i), mirroring build_all.building_atlases."""
    import pieces2
    keys = [k for k, d in pieces2.P.items() if d['atlas'] == atlas]; out = []
    for k in keys:
        d = pieces2.P[k]; rots = {'single': [0], 'mirror': [0, 1], 'unique4': [0, 1, 2, 3]}[d['art']]
        for st in [None] + list(d.get('states', {})):
            for r in rots:
                for stg in range(4): out.append(('rot', k, r, st, stg))
        for i in range(d.get('anim', 0)): out.append(('anim', k, i))
    return out

K = [1]
def _patch():
    import toon, importlib
    if getattr(toon, '_k_patched', False): return
    orig = toon.downscale
    def ds(img, size, sharpen=True): return orig(img, (size[0] * K[0], size[1] * K[0]), sharpen)
    for m in ('toon', 'buildings', 'buildings2', 'pieces2', 'iso', 'nature', 'nature2'):
        mod = importlib.import_module(m)
        if getattr(mod, 'downscale', None) is orig: mod.downscale = ds
    toon._k_patched = True

def _render(arg):
    """arg = (job, k, path_prefix, base): fol/anim -> <prefix><base>.png; rot -> 4 stages at <prefix><base+stage>.png."""
    job, k, pre, base = arg
    sys.path.insert(0, TOOLS); os.environ.pop('CEL', None)
    _patch(); K[0] = k
    import importlib
    if job[0] == 'fol':
        mod, fn, a, kw = job[1]; getattr(importlib.import_module(mod), fn)(*a, **kw).save(f'{pre}{base}.png'); return base
    import pieces2
    if job[0] == 'anim': pieces2.anim_frame(job[1], job[2]).save(f'{pre}{base}.png'); return base
    _, key, rot, st = job; d = pieces2.P[key]; spec = d['draw'] if st is None else d['states'][st]
    for s, im in enumerate(pieces2.frames_for(key, rot, spec)): im.save(f'{pre}{base + s}.png')
    return base

def render_all(needed, cache, ks=(1, 2), procs=8):
    """needed: {atlas: iterable(frame idx)} -> cache/k<k>/<atlas>__<i>.png (skips existing)."""
    work = []
    for k in ks:
        d = os.path.join(cache, f'k{k}'); os.makedirs(d, exist_ok=True)
        for atlas, idxs in needed.items():
            pre = f'{d}/{atlas}__'
            have = lambda i: os.path.exists(f'{pre}{i}.png')
            if atlas.startswith('resources'):
                work += [(('fol', FOLIAGE_JOBS[(atlas, i)]), k, pre, i) for i in idxs if not have(i)]; continue
            bi = building_index(atlas); seen = set()
            for i in idxs:
                j = bi[i]
                if j[0] == 'anim':
                    if not have(i): work.append((j, k, pre, i))
                    continue
                base = bi.index(('rot', j[1], j[2], j[3], 0))
                if base in seen or all(have(base + s) for s in range(4)): continue
                seen.add(base); work.append((('rot', j[1], j[2], j[3]), k, pre, base))
    print('render jobs', len(work), flush=True)
    with Pool(procs) as pool:
        for n, _ in enumerate(pool.imap_unordered(_render, work, chunksize=1)):
            if n % 20 == 0: print('  src', n, '/', len(work), flush=True)

if __name__ == '__main__':
    import json
    cache = sys.argv[1]; ks = tuple(int(x) for x in sys.argv[2:]) or (1, 2)
    os.chdir(REPO)
    need = json.load(open(os.path.join(cache, 'needed.json')))
    render_all({a: set(v) for a, v in need.items()}, cache, ks)
    print('done')
