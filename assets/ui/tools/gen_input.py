#!/usr/bin/env python3
"""Generate the input atlases: device glyphs + touch kit.

Outputs (assets/ui/input/atlas/):
  input_glyphs.png/@2x + .json, input_touch.png/@2x + .json   TexturePacker JSON hash, 2px padding, max 2048, nineSlice per frame
  frames/<name>.png                                           1x frames for the DOM overlay (CSS border-image / <img>)
  engine/<key>.png + <key>@2x.png, engine/manifest.input.json @engine/assets manifest v1 grid pages with `pages: [{scale: 2}]`,
                                                              sprites (category glyph | ui) and the `glyphs` id -> {sprite, frame} map
Glyph ids follow @engine/input glyphFor() (commit 4f133b4); coverage is checked against input/glyph_ids.referenced.json.
"""
import json, math, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from gen_kit import pack, PAD, MAX  # noqa: E402
from inputkit.reg import REG  # noqa: E402
from inputkit import glyphs as G, touchkit  # noqa: E402,F401
import input_ids  # noqa: E402

UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(UI, 'input', 'atlas')


_REG = None


def _one(job):
    n, sc = job; s = _REG[n]; im = s['fn'](sc)
    assert im.size == (s['w'] * sc, s['h'] * sc), (n, im.size, sc)
    return n, sc, im.tobytes(), im.size


def render_all(reg):
    """Parallel (fork) render; each sprite drawn at 1x and 2x."""
    global _REG
    import multiprocessing as mp
    _REG = reg; imgs = {1: {}, 2: {}}
    jobs = [(n, sc) for n in reg for sc in (1, 2)]
    with mp.get_context('fork').Pool() as pool:
        for i, (n, sc, b, size) in enumerate(pool.imap_unordered(_one, jobs, chunksize=4)):
            imgs[sc][n] = Image.frombytes('RGBA', size, b)
            if i % 100 == 0: print(f'  {i}/{len(jobs)}', flush=True)
    return imgs


def write_tp(name, reg, imgs):
    sizes = {n: imgs[1][n].size for n in reg}
    pos, W, H = pack(sizes)
    for sc in (1, 2):
        sheet = Image.new('RGBA', (W * sc, H * sc), (0, 0, 0, 0)); frames = {}
        for n, s in reg.items():
            x, y = pos[n]; sheet.alpha_composite(imgs[sc][n], (x * sc, y * sc))
            w, h = s['w'] * sc, s['h'] * sc
            f = {"frame": {"x": x * sc, "y": y * sc, "w": w, "h": h}, "rotated": False, "trimmed": False,
                 "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h},
                 "pivot": {"x": s['pivot'][0], "y": s['pivot'][1]}, "tags": s['tags']}
            if s['nine']:
                l, t, r, b = [v * sc for v in s['nine']]
                f["nineSlice"] = {"l": l, "t": t, "r": r, "b": b}; f["scale9Borders"] = {"x": l, "y": t, "w": w - l - r, "h": h - t - b}
            if s['meta']: f["meta"] = s['meta']
            frames[n] = f
        sfx = '' if sc == 1 else '@2x'
        sheet.save(os.path.join(OUT, f'{name}{sfx}.png'), optimize=True)
        json.dump({"frames": frames, "meta": {"app": "cozy-camp ui/tools/gen_input.py (TexturePacker JSON hash)", "image": f'{name}{sfx}.png',
                   "format": "RGBA8888", "size": {"w": W * sc, "h": H * sc}, "scale": str(sc), "padding": PAD * sc}},
                  open(os.path.join(OUT, f'{name}{sfx}.json'), 'w'), indent=1)
    for n in reg: imgs[1][n].save(os.path.join(OUT, 'frames', f'{n}.png'))
    return W, H


def write_grid(prefix, reg, imgs, category, keyfn):
    """One grid page per frame size; scale-2 page declared via `pages` (engine batch 11)."""
    groups = {}
    for n, s in reg.items(): groups.setdefault((s['w'], s['h']), []).append(n)
    atlases, sprites, index = [], [], {}
    for (w, h), members in sorted(groups.items(), key=lambda kv: (-kv[0][0] * kv[0][1], kv[0])):
        n = len(members); cols = max(1, min(n, MAX // (w * 2), math.ceil(math.sqrt(n * h / w)))); rows = math.ceil(n / cols)
        key = f'{prefix}_{w}x{h}'
        for sc in (1, 2):
            page = Image.new('RGBA', (cols * w * sc, rows * h * sc), (0, 0, 0, 0))
            for i, m in enumerate(members): page.alpha_composite(imgs[sc][m], ((i % cols) * w * sc, (i // cols) * h * sc))
            page.save(os.path.join(OUT, 'engine', f'{key}{"" if sc == 1 else "@2x"}.png'), optimize=True)
        at = {"key": key, "image": f'{key}.png', "frameW": w, "frameH": h, "columns": cols, "rows": rows, "pages": [{"scale": 2, "image": f'{key}@2x.png'}]}
        ns = {str(i): dict(zip("ltrb", reg[m]['nine'])) for i, m in enumerate(members) if reg[m]['nine']}
        if ns: at["nineSlice"] = ns
        atlases.append(at)
        for i, m in enumerate(members):
            index[m] = {"atlas": key, "frame": i}
            sk = keyfn(m)
            if sk: sprites.append({"key": sk, "category": category(m), "atlas": key, "anchor": {"x": reg[m]['pivot'][0], "y": reg[m]['pivot'][1]},
                                   "animations": {"idle": {"frames": [i], "fps": 1}}})
    return atlases, sprites, index


def main():
    os.makedirs(os.path.join(OUT, 'frames'), exist_ok=True); os.makedirs(os.path.join(OUT, 'engine'), exist_ok=True)
    gimgs = render_all(REG['glyphs']); timgs = render_all(REG['touch'])
    gw = write_tp('input_glyphs', REG['glyphs'], gimgs); tw = write_tp('input_touch', REG['touch'], timgs)
    print('glyph atlas', gw, len(REG['glyphs']), '| touch atlas', tw, len(REG['touch']))
    # glyph pages: ONE sprite per page whose idle animation lists every frame; glyph ids point at (sprite, frame)
    ga, _, gidx = write_grid('input_glyphs', REG['glyphs'], gimgs, lambda m: 'glyph', lambda m: None)
    gsprites = []
    for a in ga:
        n = a['columns'] * a['rows']; members = [m for m, v in gidx.items() if v['atlas'] == a['key']]
        gsprites.append({"key": f"glyphs_{a['key'].split('_')[-1]}", "category": "glyph", "atlas": a['key'], "anchor": {"x": 0.5, "y": 0.5},
                         "animations": {"idle": {"frames": list(range(len(members))), "fps": 1}}})
    page_sprite = {a['key']: s['key'] for a, s in zip(ga, gsprites)}
    glyph_map = {}
    for gid, (_grp, name) in sorted(G.GLYPHS.items()):
        ix = gidx[name]; glyph_map[gid] = {"sprite": page_sprite[ix['atlas']], "frame": ix['frame']}
    for alias, gid in sorted(G.ALIASES.items()): glyph_map[alias] = dict(glyph_map[gid])
    ta, tsprites, tidx = write_grid('input_touch', REG['touch'], timgs, lambda m: 'ui', lambda m: f'input_{m}')
    manifest = {"version": 1, "name": "ui-cozy-camp-input", "atlases": ga + ta, "sprites": gsprites + tsprites, "glyphs": glyph_map}
    json.dump(manifest, open(os.path.join(OUT, 'engine', 'manifest.input.json'), 'w'), indent=1)
    # pack-ready fragment (images under pack/atlases/)
    pk = json.loads(json.dumps(manifest))
    for a in pk['atlases']:
        a['image'] = 'atlases/' + a['image']
        for p in a.get('pages', []): p['image'] = 'atlases/' + p['image']
    json.dump({k: pk[k] for k in ('atlases', 'sprites', 'glyphs')}, open(os.path.join(OUT, 'engine', 'manifest.input.pack.json'), 'w'), indent=1)
    # coverage vs engine profiles
    ref = input_ids.walk(); missing = sorted(k for k in ref if k not in glyph_map)
    json.dump({"glyphs": len(glyph_map), "referencedByEngine": len(ref), "missing": missing,
               "extra": sorted(k for k in glyph_map if k not in ref), "index": {**gidx, **tidx}},
              open(os.path.join(OUT, 'engine', 'coverage.json'), 'w'), indent=1)
    print('glyph ids', len(glyph_map), 'engine-referenced', len(ref), 'missing', missing)


if __name__ == '__main__':
    main()
