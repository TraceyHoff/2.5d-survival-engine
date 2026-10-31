#!/usr/bin/env python3
"""Status + storm FX from the unserved survival_fx fragment (assets/survival_fx) -> nature pack.

The renderer already spawns `fx_drip` (wet), `fx_breath_puff` (cold), `fx_sweat_drop` (heat) (IsoRenderer.statusFx) and
`fx_lightning` (storm bolt, plays `idle`), but survival_fx is not in MANIFEST_INDEX, so tryId() found nothing and they
never drew. This serves that art unchanged:
  - nature_status_fx: frames 0..13 of surv_status (drip 0-3, sweat 4-7, breath 8-13) cropped out of the 55-column
    strip (its 2x page is 3520 px wide, over the 2048 page cap);
  - nature_lightning: surv_lightning as-is (+ emissive mask); `fx_lightning` = fx_lightning_bolt with `idle` = strike_a
    (strike_a/b/c kept).
Both `residency: "stream"`. Runs last in build.py GROUPS; standalone (idempotent): python3 statusfx.py
"""
import os, sys, json, copy
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); FRAG_DIR = os.path.join(HERE, '..')
SFX = os.path.join(HERE, '../../../../../assets/survival_fx')
STATUS = {'fx_drip': 'fx_drip', 'fx_sweat_drop': 'fx_sweat_drop', 'fx_breath_puff': 'fx_breath_puff'}
KEYS = ['fx_drip', 'fx_sweat_drop', 'fx_breath_puff', 'fx_lightning']

def build():
    m = json.load(open(os.path.join(SFX, 'manifest.fragment.json'))); S = {s['key']: s for s in m['sprites']}; A = {a['key']: a for a in m['atlases']}
    out_a, out_s = [], []
    # status strip
    used = sorted({f for k in STATUS for an in S[k]['animations'].values() for f in an['frames']}); remap = {f: i for i, f in enumerate(used)}
    a = A['surv_status']; w, h = a['frameW'], a['frameH']
    for src, dst, s in ((a['image'], 'nature_status_fx.png', 1), (a['pages'][0]['image'], 'nature_status_fx@2x.png', 2)):
        im = Image.open(os.path.join(SFX, '..', src)); o = Image.new('RGBA', (len(used) * w * s, h * s))
        for f, i in remap.items(): o.paste(im.crop((f * w * s, 0, (f + 1) * w * s, h * s)), (i * w * s, 0))
        o.save(os.path.join(FRAG_DIR, 'atlases', dst), optimize=True)
    out_a.append({"key": "nature_status_fx", "image": "atlases/nature_status_fx.png", "frameW": w, "frameH": h, "columns": len(used), "rows": 1,
                  "pages": [{"scale": 2, "image": "atlases/nature_status_fx@2x.png"}], "residency": "stream"})
    for k in STATUS:
        sp = copy.deepcopy(S[k]); sp['atlas'] = 'nature_status_fx'
        for an in sp['animations'].values(): an['frames'] = [remap[f] for f in an['frames']]
        out_s.append(sp)
    # lightning
    a = A['surv_lightning']
    for src, dst in ((a['image'], 'nature_lightning.png'), (a['pages'][0]['image'], 'nature_lightning@2x.png'),
                     (a['image'].replace('.png', '_emissive.png'), 'nature_lightning_emissive.png'),
                     (a['pages'][0]['image'].replace('.png', '_emissive.png'), 'nature_lightning_emissive@2x.png')):
        Image.open(os.path.join(SFX, '..', src)).save(os.path.join(FRAG_DIR, 'atlases', dst), optimize=True)
    out_a.append({"key": "nature_lightning", "image": "atlases/nature_lightning.png", "frameW": a['frameW'], "frameH": a['frameH'], "columns": a['columns'], "rows": 1,
                  "pages": [{"scale": 2, "image": "atlases/nature_lightning@2x.png"}], "masks": {"emissive": "atlases/nature_lightning_emissive.png"}, "residency": "stream"})
    sp = copy.deepcopy(S['fx_lightning_bolt']); sp['key'] = 'fx_lightning'; sp['atlas'] = 'nature_lightning'
    sp['animations'] = {"idle": copy.deepcopy(sp['animations']['strike_a']), **sp['animations']}
    out_s.append(sp)
    return out_a, out_s

def g(b):
    a, s = build(); b.atlases.extend(a); b.sprites.extend(s)
GROUPS = [g]

if __name__ == '__main__':
    p = os.path.join(FRAG_DIR, 'manifest.nature.json'); man = json.load(open(p))
    man['atlases'] = [x for x in man['atlases'] if x['key'] not in ('nature_status_fx', 'nature_lightning')]
    man['sprites'] = [x for x in man['sprites'] if x['key'] not in KEYS]
    a, s = build(); man['atlases'] += a; man['sprites'] += s
    json.dump(man, open(p, 'w'), indent=1); open(p, 'a').write('\n')
    print('status fx:', [x['key'] for x in a], [x['key'] for x in s])
