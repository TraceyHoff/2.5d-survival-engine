import sys, os, json, numpy as np
sys.path.insert(0, os.path.dirname(__file__)); sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools"))
from PIL import Image
from rig import pose, Ctx, frame_list, rows_for, FW, FH, COLS, PAD
import parts
DETAIL_SLOTS = ("hair", "hat", "top", "bottom", "shoes")   # wear detail pass (rig.MCanvas._wear_detail)

def draw(c, slot, spec, hat=False):
    if slot == "body": parts.body(c, spec)
    elif slot == "hair": parts.draw_hair(c, spec, hat)
    elif slot == "hat": parts.draw_hat(c, spec)
    elif slot == "top": parts.draw_top(c, spec)
    elif slot == "bottom": parts.draw_bottom(c, spec)
    elif slot == "shoes": parts.draw_shoes(c, spec)
    elif slot in ("accessory", "hands"): parts.draw_acc(c, spec)
    elif slot == "face": parts.draw_face(c, spec)
    elif slot == "eyes": parts.draw_eyes(c, spec)

CEL_SLOTS = {"body", "hair", "top", "bottom", "shoes", "hat", "face", "eyes", "accessory", "hands"}   # slots re-rendered with the rig cel mode (see rig.MCanvas.cel)
def render_frame(bt, slot, spec, d, anim, fi, n, hat=False, part=None):
    K = pose(bt, d, anim, fi, n); c = Ctx(K); c.extra = None
    if slot in CEL_SLOTS: c.cv.cel = True; c.cv.pal = []   # solid cel look (flat palette fills, hard shade/highlight, binary alpha, 0/1 tintmask)
    c.cv.detail = slot if slot in DETAIL_SLOTS else None
    parts.gear_parts.apply_remap(c, spec); draw(c, slot, spec, hat)
    if part == "sleeves": c.items = []; c.run(armcut=False, extra=c.extra)
    elif part == "main": c.run(armcut=True, extra=None)
    else: c.run(armcut=(slot != "body" and not spec.get("noarmcut")), extra=c.extra)
    return c.out(), K

def clean(im, x0, y0, w, h):
    a = np.asarray(im).copy(); a[:PAD, :] = 0; a[-PAD:, :] = 0; a[:, :PAD] = 0; a[:, -PAD:] = 0; return a

def render_sheet(job):
    key, bt, slot, spec, hat, outdir = job[:6]; part = job[6] if len(job) > 6 else None
    frames = frame_list(slot); ROWS = rows_for(slot)
    A1 = np.zeros((ROWS * FH, COLS * FW, 4), np.uint8); A2 = np.zeros((ROWS * FH * 2, COLS * FW * 2, 4), np.uint8)
    M1 = np.zeros((ROWS * FH, COLS * FW, 3), np.uint8); M2 = np.zeros((ROWS * FH * 2, COLS * FW * 2, 3), np.uint8)
    hands = {}
    for i, (d, anim, fi, n) in enumerate(frames):
        (i1, i2, m1, m2), K = render_frame(bt, slot, spec, d, anim, fi, n, hat, part)
        r, col = divmod(i, COLS)
        for A, M, im, m, s in ((A1, M1, i1, m1, 1), (A2, M2, i2, m2, 2)):
            a = np.asarray(im).copy(); p = PAD * s
            for arr in (a, m):
                arr[:p] = 0; arr[-p:] = 0; arr[:, :p] = 0; arr[:, -p:] = 0
            m = m.copy(); m[a[..., 3] == 0] = 0
            A[r * FH * s:(r + 1) * FH * s, col * FW * s:(col + 1) * FW * s] = a
            M[r * FH * s:(r + 1) * FH * s, col * FW * s:(col + 1) * FW * s] = m
        if slot == "body" and K["anchor"] is not None: hands[str(i)] = K["anchor"]
    Image.fromarray(A1, "RGBA").save(f"{outdir}/{key}.png", optimize=True)
    Image.fromarray(A2, "RGBA").save(f"{outdir}/{key}@2x.png", optimize=True)
    Image.fromarray(M1, "RGB").save(f"{outdir}/{key}.tintmask.png", optimize=True)
    Image.fromarray(M2, "RGB").save(f"{outdir}/{key}.tintmask@2x.png", optimize=True)
    if slot == "body":
        json.dump({"atlas": key, "frameW": FW, "frameH": FH, "doc": "Right-hand held-item anchor per frame index (1x px in frame; angle deg clockwise from up; len = px per unit item length; behind = draw item behind body). Missing index = hide item.",
                   "hands": hands}, open(f"{outdir}/{key}.hands.json", "w"), indent=0, sort_keys=True)
    return key
