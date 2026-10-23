#!/usr/bin/env python3
"""Survival-hook art: UI/touch skins (ui/hooks/atlas) + world FX (survival_events/atlases) + one engine manifest fragment.
Usage: python3 gen_hooks.py   (deterministic; ~1 min)"""
import json, math, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import gen_input as GI  # noqa: E402
from hookskit import art as A  # noqa: E402

UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
UOUT = os.path.join(UI, 'hooks', 'atlas'); FOUT = os.path.abspath(os.path.join(UI, '..', 'survival_events'))
FPS = {'fx_respawn_poof': (14, False), 'fx_deathbag_drop': (12, False), 'fx_gate_breach': (14, False), 'death_bag_open': (4, True),
       'death_bag_locked': (4, True), 'fx_splinter': (8, True), 'fx_puff': (10, False)}

def fx_atlases(imgs):
    groups = {}
    for n in A.FX: groups.setdefault(n.rsplit('_', 1)[0], []).append(n)
    atl, spr = [], []
    # death bag: one sprite, two anims (open / locked) on one sheet
    groups['death_bag'] = groups.pop('death_bag_open') + groups.pop('death_bag_locked')
    for key, mem in sorted(groups.items()):
        mem = sorted(mem, key=lambda m: (m.rsplit('_', 2)[-2] if key == 'death_bag' else '', int(m.rsplit('_', 1)[1])))
        w, h = A.FX[mem[0]]['w'], A.FX[mem[0]]['h']; cols = min(len(mem), 2048 // (w * 2)); rows = math.ceil(len(mem) / cols)
        for sc in (1, 2):
            pg = Image.new('RGBA', (cols * w * sc, rows * h * sc))
            for i, m in enumerate(mem): pg.alpha_composite(imgs[sc][m], ((i % cols) * w * sc, (i // cols) * h * sc))
            pg.save(os.path.join(FOUT, 'atlases', f'{key}{"" if sc == 1 else "@2x"}.png'), optimize=True)
        atl.append({"key": f"se_{key}", "image": f"survival_events/atlases/{key}.png", "frameW": w, "frameH": h, "columns": cols, "rows": rows,
                    "pages": [{"scale": 2, "image": f"survival_events/atlases/{key}@2x.png"}]})
        pv = A.FX[mem[0]]['pivot']; s = {"key": key, "category": "vfx" if key.startswith('fx_') else "item", "atlas": f"se_{key}", "anchor": {"x": pv[0], "y": pv[1]}}
        if key == 'death_bag':
            s["animations"] = {"open": {"frames": [0, 1, 2, 3], "fps": 4, "loop": True}, "locked": {"frames": [4, 5, 6, 7], "fps": 4, "loop": True}}
            s["attach"] = {"label": {"x": 0, "y": -34}, "lock_badge": {"x": 10, "y": -24}}
        else:
            fps, lp = FPS[key]; s["animations"] = {"idle": {"frames": list(range(len(mem))), "fps": fps, "loop": lp}}
        spr.append(s)
    L = lambda k: len([m for m in A.FX if m.startswith(k + '_')]) / FPS[k][0]
    vfx = [
        {"key": "respawn_poof", "sprite": "fx_respawn_poof", "anim": "idle", "lifetime": round(L('fx_respawn_poof'), 3), "blend": "normal"},
        {"key": "respawn_puffs", "sprite": "fx_puff", "anim": "idle", "lifetime": 0.5, "blend": "normal",
         "particles": {"rate": 0, "count": 10, "speed": [1, 2.5], "spread": 6.283, "gravity": -0.3, "fade": True, "scaleCurve": [0.6, 1.2, 0.4]}},
        {"key": "deathbag_drop", "sprite": "fx_deathbag_drop", "anim": "idle", "lifetime": round(L('fx_deathbag_drop'), 3), "blend": "normal"},
        {"key": "gate_breach", "sprite": "fx_gate_breach", "anim": "idle", "lifetime": round(L('fx_gate_breach'), 3), "blend": "normal"},
        {"key": "gate_breach_splinters", "sprite": "fx_splinter", "anim": "idle", "lifetime": 0.9, "blend": "normal",
         "particles": {"rate": 0, "count": 14, "speed": [2, 5], "spread": 3.14, "gravity": 6, "fade": True, "scaleCurve": [1, 1, 0.5]}},
    ]
    return atl, spr, vfx

def main():
    for d in (UOUT, os.path.join(UOUT, 'frames'), os.path.join(UOUT, 'engine'), os.path.join(FOUT, 'atlases')): os.makedirs(d, exist_ok=True)
    GI.OUT = UOUT
    uimgs = GI.render_all(A.UI); GI.write_tp('ui_hooks', A.UI, uimgs)
    ua, us, uidx = GI.write_grid('ui_hooks', A.UI, uimgs, lambda m: 'ui', lambda m: f'ui_hooks_{m}')
    for a in ua:
        a['image'] = 'hooks/' + a['image']
        for p in a['pages']: p['image'] = 'hooks/' + p['image']
    fimgs = GI.render_all(A.FX); fa, fs, vfx = fx_atlases(fimgs)
    frag = {"version": 1, "name": "survival-events", "atlases": fa + ua, "sprites": fs + us, "vfx": vfx}
    json.dump(frag, open(os.path.join(FOUT, 'manifest.fragment.json'), 'w'), indent=1)
    json.dump({"ctx": {v: {"sprite": f"ui_hooks_vb_ctx_{v}_normal", "pressed": f"ui_hooks_vb_ctx_{v}_pressed", "disabled": f"ui_hooks_vb_ctx_{v}_disabled",
                            "icon": f"ui_hooks_ctxi_{v}", "label": l} for v, (_s, _c, l) in A.CTX.items()},
               "ringSteps": A.RING_STEPS, "index": uidx}, open(os.path.join(UOUT, 'hooks_index.json'), 'w'), indent=1)
    print('ui sprites', len(A.UI), 'fx frames', len(A.FX), 'atlases', len(fa + ua))

if __name__ == '__main__':
    main()
