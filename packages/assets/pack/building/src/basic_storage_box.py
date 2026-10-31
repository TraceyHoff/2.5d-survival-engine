"""ADR-250 basic_storage_box: the starter container (sticks + plant fiber + a couple of pine logs), a rougher, smaller,
scavenged crate than storage_box: mismatched planks (one sticks out), stick corner posts poking above the lid, a fiber rope
lashing over the lid with a knot, a riveted tin patch and a red rag tie. Cute and worn, not grimdark.

Manifest conventions copied from the main pack's `storage_box` (assets/tools/pieces2.py): anchor (0.5, 0.75), 1x1,
layer 2, rotationArt `unique4` with 4 drawn rotations, 4 baked damage stages per rotation (iso.damage),
building.frames = [[rot0 d0..d3], [rot1 ...], [rot2 ...], [rot3 ...]], idle = rot0 intact. storage_box has no open frames.
Solid cel: every figure pixel snaps to the material ramps' flat / one hard shade / hard highlight + the ink outline, binary
alpha; the contact shadow is one flat translucent tone (as cel.py keeps shadows). Cells 96x96 (pivot 48,72), 2px padding
checked. Own page `basic_storage_box` (1x + @2x), `residency: "stream"` (resident VRAM unchanged).
Standalone (no other atlas is touched): cd src && python3 basic_storage_box.py .. [preview_dir]
then python3 ../../../../../assets/tools/ktx2.py manifest.building.json (in pack/building) and lock:ids:pack.
"""
import os, sys, json, zlib
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../../assets/tools'))
from palette import RAMPS
from buildings import B, render_boxes, planksH, planksV, flat
from iso import damage, add_outline, IsoCanvas
from toon import downscale, SS, INK

KEY = 'basic_storage_box'; AK = 'basic_storage_box'
W, H, OX, OY = 96, 96, 48, 72          # anchor (0.5, 0.75) like storage_box's 128x128 / (64, 96)
PAD = 2
MATS = ['wood', 'wood_dark', 'bark', 'sand', 'thatch', 'iron', 'cloth_red', 'gold']

def geom():
    """rot0 local geometry (tile units, z in px). +y face = lit left face, +x face = shaded right face."""
    bx = [B(-.26, .26, -.20, .20, 0, 14, 'wood_dark', flat(.05), flat(.05), flat(.05))]          # core
    # +y face: three horizontal mismatched planks (the middle one is pale and sticks out to the right)
    bx += [B(-.27, .26, .20, .225, 0.5, 5, 'wood', planksH(9), planksH(9), planksH(9)),
           B(-.24, .32, .20, .232, 5, 9.5, 'sand', flat(.05), planksH(9), flat(.05)),
           B(-.27, .27, .20, .222, 9.5, 14, 'wood', planksH(9), planksH(9), planksH(9))]
    # +x face: vertical boards of different woods and heights
    bx += [B(.26, .282, -.20, -.07, 0.5, 14, 'wood', planksV(9), planksV(9), planksV(9)),
           B(.26, .29, -.07, .06, 0.5, 15.5, 'wood_dark', planksV(9), planksV(9), planksV(9)),
           B(.26, .279, .06, .20, 0.5, 13.5, 'wood', planksV(9), planksV(9), planksV(9))]
    # back faces (seen at rot 2/3): -y horizontal planks (top one short, a gap shows the dark core), -x boards
    bx += [B(-.26, .27, -.225, -.20, 0.5, 6, 'wood', planksH(9), planksH(9), planksH(9)),
           B(-.30, .25, -.228, -.20, 6, 10, 'wood_dark', planksH(9), planksH(9), planksH(9)),
           B(-.12, .27, -.222, -.20, 10.5, 14, 'sand', planksH(9), planksH(9), planksH(9)),
           B(-.282, -.26, -.20, -.04, 0.5, 14.5, 'sand', planksV(9), planksV(9), planksV(9)),
           B(-.278, -.26, -.04, .20, 0.5, 13.5, 'wood', planksV(9), planksV(9), planksV(9))]
    # lid: two mismatched boards, the back one a little higher
    bx += [B(-.30, .30, -.24, -.01, 14, 17, 'wood', planksH(6), planksH(6), planksH(6)),
           B(-.28, .27, -.01, .245, 14, 16.5, 'wood_dark', planksH(6), planksH(6), planksH(6))]
    # stick corner posts poking above the lid (front-left one a bit shorter)
    for (x, y, top) in ((-.30, -.24, 20), (.30, -.24, 21), (-.30, .24, 19), (.30, .24, 18)):
        bx.append(B(x - .03, x + .03, y - .03, y + .03, 0, top, 'bark', flat(.05), flat(.05), flat(.05)))
    # fiber rope lashing: a band round the body + one strap over the lid with a knot on the front face
    bx += [B(-.295, .305, -.25, .255, 10, 12.4, 'thatch', flat(.05), flat(.05), flat(.05)),
           B(.03, .10, -.25, .26, 16.5, 18.3, 'thatch', flat(.05), flat(.05), flat(.05)),
           B(.03, .10, .245, .265, 10, 18.3, 'thatch', flat(.05), flat(.05), flat(.05)),
           B(.015, .115, .25, .29, 12, 15.5, 'thatch', flat(.05), flat(.05), flat(.05))]
    # riveted tin patch on the +x face, a red rag tied on the back-right post
    bx += [B(.29, .305, .02, .16, 3, 9, 'iron', flat(.05), flat(.05), flat(.05)),
           B(.305, .312, .035, .05, 7.5, 8.3, 'gold', edge=False), B(.305, .312, .13, .145, 7.5, 8.3, 'gold', edge=False),
           B(.305, .312, .035, .05, 3.7, 4.5, 'gold', edge=False), B(.305, .312, .13, .145, 3.7, 4.5, 'gold', edge=False),
           B(.255, .345, -.285, -.195, 15.5, 18.5, 'cloth_red', flat(.05), flat(.05), flat(.05)),
           B(.32, .35, -.22, -.19, 12, 16, 'cloth_red', flat(.05), flat(.05), flat(.05))]
    for b in bx: b.edge = False   # the toolkit inks every quad last (hidden ones too); silhouette + cel tones carry the form
    return bx

def _hex(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
PAL = np.array(sorted({_hex(RAMPS[m][i]) for m in MATS for i in (0, 1, 2)} | {_hex(c) for c in RAMPS['ink']} | {tuple(INK)}), np.float32)
SHADOW = (0x2a, 0x1b, 0x2e); SH_A = 80

def cel(img, shadow_mask):
    """figure -> nearest palette colour, alpha binary; shadow -> one flat translucent tone where nothing else is."""
    a = np.asarray(img, np.float32); rgb, al = a[..., :3], a[..., 3]
    fig = al >= 128
    q = PAL[((rgb[..., None, :] - PAL[None, None]) ** 2).sum(-1).argmin(-1)]
    out = np.zeros(a.shape, np.uint8); out[fig, :3] = q[fig].astype(np.uint8); out[fig, 3] = 255
    sh = shadow_mask & ~fig; out[sh, :3] = SHADOW; out[sh, 3] = SH_A
    return Image.fromarray(out, 'RGBA')

def frame(rot, stage):
    seed = zlib.crc32(KEY.encode()) % 1000
    cv = render_boxes(geom(), rot, seed=seed, cell=(W, H), origin=(OX, OY))
    img = add_outline(damage(cv.img, stage, seed + rot), 1.35, seed + rot)
    sh = IsoCanvas(W, H, OX, OY); sh.ground_shadow(-.36, .36, -.30, .30, grow=.06, alpha=1.0)
    out = []
    for s in (1, 2):
        m = np.asarray(sh.img.getchannel('A').resize((W * s, H * s), Image.BOX)) >= 128
        f = cel(downscale(img, (W * s, H * s)), m)
        bb = f.getbbox(); assert bb[0] >= PAD * s and bb[1] >= PAD * s and bb[2] <= W * s - PAD * s and bb[3] <= H * s - PAD * s, (rot, stage, s, bb)
        out.append(f)
    return out

def apply(man, out, prev=None):
    F = [[frame(r, st) for st in range(4)] for r in range(4)]
    man['atlases'] = [a for a in man['atlases'] if a['key'] != AK]
    man['sprites'] = [s for s in man['sprites'] if s['key'] != KEY]
    cols, rows = 8, 2
    for s, suf in ((1, ''), (2, '@2x')):
        page = Image.new('RGBA', (cols * W * s, rows * H * s), (0, 0, 0, 0))
        for r in range(4):
            for st in range(4):
                i = r * 4 + st; page.paste(F[r][st][s - 1], (i % cols * W * s, i // cols * H * s))
        assert max(page.size) <= 2048
        page.save(f'{out}/atlases/{AK}{suf}.png', optimize=True)
    man['atlases'].append({"key": AK, "image": f"atlases/{AK}.png", "frameW": W, "frameH": H, "columns": cols, "rows": rows,
                           "pages": [{"scale": 2, "image": f"atlases/{AK}@2x.png"}], "residency": "stream"})
    man['sprites'].append({"key": KEY, "category": "building", "atlas": AK, "anchor": {"x": OX / W, "y": OY / H},
                           "animations": {"idle": {"frames": [0], "fps": 1}},
                           "building": {"piece": KEY, "footprint": {"w": 1, "h": 1}, "layer": 2,
                                        "frames": [[r * 4 + st for st in range(4)] for r in range(4)]},
                           "rotationArt": "unique4"})
    return F

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '..'
    p = f'{out}/manifest.building.json'; man = json.load(open(p))
    apply(man, out)
    json.dump(man, open(p, 'w'), indent=1); open(p, 'a').write('\n')
    print(AK, 'written')
