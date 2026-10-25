#!/usr/bin/env python3
# ADR-134 art (docs/DECISIONS.md "Art follow-ups"):
#  1. goofy-cute hurt/hit frames (3 frames x 8 directions: squash flinch + white flash + impact puff -> stretch rebound + dizzy
#     stars -> settle) for every zombie kind and animal kind in the main pack and the nature pack. Derived from each sprite's own
#     idle frame per facing (1x and @2x sources), trimmed + deduped into tight rect atlases (dirFrames rects) so VRAM stays small:
#     main pack -> atlases/adr134_hurt*.png, nature pack -> nature/atlases/nature_adr134_hurt*.png. The sprites' existing `hurt` /
#     `hit` anims are repointed at them in place (anim order unchanged).
#  2. a stump per tree species (`<species>_stump`, e.g. pine_tree_stump) -> nature_adr134_stumps.
#  3. a small creature hp-bar 9-slice frame (ui_creature_hpbar_frame) -> nature_adr134_hpbar.
# All resident: stream pool slots are sized to the largest stream page, so pages this small cost more VRAM streamed, and a
# 320 ms one-shot hurt anim cannot wait for a page-in (it would pop the placeholder).
# AI humans are NOT covered: they render as the paper-doll player body + wear (customization), owned by the player-hurt job.
# Re-runnable (idempotent). Run from repo root: python3 packages/assets/pack/nature/src/adr134.py [preview dir]
#   then python3 assets/tools/ktx2.py on both manifests, lock:ids:pack. nature/src/build.py wipes nature/atlases: rerun
#   adr128.py + this + ktx2 + gen_icon_css.py + lock after a nature rebuild.
import json, math, os, sys, hashlib
from PIL import Image, ImageDraw, ImageChops, ImageFont
R = 'packages/assets/pack/'; NAT = R + 'nature/'; PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/preview'
PAD = 2; SS = 4

def load(path): return json.load(open(path))
def save(m, path, ind): json.dump(m, open(path, 'w'), indent=ind, ensure_ascii=False); open(path, 'a').write('\n')

_imc = {}
def img(base, rel):
    p = base + rel
    if p not in _imc: _imc[p] = Image.open(p).convert('RGBA')
    return _imc[p]

def src_frame(base, A, s, d):
    """idle frame 0 at facing d -> (im1, im2, ax, ay) with anchor in 1x px of im1."""
    an = s['animations']['idle']; dirs = an.get('directions', 1); dd = d % dirs
    if an.get('dirFrames'):
        e = an['dirFrames'][dd]; a = A[e['atlas']]
        if 'rect' in e: x, y, w, h = (e['rect'][k] for k in 'xywh')
        else:
            f = e.get('frame', 0); w, h = a['frameW'], a['frameH']; x, y = (f % a['columns']) * w, (f // a['columns']) * h
        anc = e['anchor']
    else:
        a = A[s['atlas']]; st = an.get('dirStride', a['columns']); f = an['frames'][0] + dd * (st if dirs > 1 else 0)
        w, h = a['frameW'], a['frameH']; x, y = (f % a['columns']) * w, (f // a['columns']) * h; anc = s['anchor']
    im1 = img(base, a['image']).crop((x, y, x + w, y + h))
    p2 = [p for p in a.get('pages', []) if p['scale'] == 2]
    im2 = img(base, p2[0]['image']).crop((2 * x, 2 * y, 2 * x + 2 * w, 2 * y + 2 * h)) if p2 else im1.resize((2 * w, 2 * h), Image.NEAREST)
    return im1, im2, anc['x'] * w, anc['y'] * h

def star(d, cx, cy, r, rot, fill, line, lw):
    pts = [(cx + (r if i % 2 == 0 else r * .45) * math.cos(rot + i * math.pi / 5 - math.pi / 2), cy + (r if i % 2 == 0 else r * .45) * math.sin(rot + i * math.pi / 5 - math.pi / 2)) for i in range(10)]
    d.polygon(pts, fill=fill, outline=line, width=lw)
def puff(d, cx, cy, r, a, lw):
    for ox, oy, rr in ((-.7, .1, .75), (.0, -.35, .9), (.7, .1, .75), (0, .35, .7)):
        q = rr * r; d.ellipse([cx + ox * r - q, cy + oy * r - q, cx + ox * r + q, cy + oy * r + q], fill=(84, 62, 70, a), outline=None)
    for ox, oy, rr in ((-.7, .1, .75), (.0, -.35, .9), (.7, .1, .75), (0, .35, .7)):
        q = max(.5, rr * r - lw); d.ellipse([cx + ox * r - q, cy + oy * r - q, cx + ox * r + q, cy + oy * r + q], fill=(255, 250, 238, a))

POSE = [  # sx, sy, lean (shear), flash, puff size, stars (count, radius, spin)
    (1.13, .84, -.16, .62, 1.0, (0, 0, 0)),
    (.93, 1.08, .07, .18, .55, (3, 1.0, .0)),
    (1.03, .97, -.02, .0, .0, (2, .8, .9)),
]
def hurt_frame(im, ax, ay, k, i, d):
    """im at scale k (1|2), anchor (ax, ay) in that image's px -> (frame, anchor x, anchor y)."""
    sx, sy, lean, flash, pf, (ns, sr, spin) = POSE[i]
    side = 1 if d in (1, 2, 3) else -1 if d in (5, 6, 7) else (1 if i % 2 == 0 else -1)
    bb = im.getbbox() or (0, 0, im.width, im.height); top = bb[1]; hgt = max(1, ay - top); wid = bb[2] - bb[0]
    M = int(max(im.width, im.height) * .6) + 6 * k; W, H = im.width + 2 * M, im.height + 2 * M
    big = Image.new('RGBA', (W * SS, H * SS)); src = im.resize((im.width * SS, im.height * SS), Image.NEAREST if k == 1 else Image.BICUBIC)
    # squash/stretch about the foot anchor + shear away from the hit (feet stay planted)
    fx, fy = (M + ax) * SS, (M + ay) * SS; L = lean * side
    # inverse affine: dest (X,Y) -> src ((X-fx)/sx - L*(Y-fy)/sy + ax*SS, (Y-fy)/sy + ay*SS)
    a_, b_, c_ = 1 / sx, -L / sy, ax * SS - fx / sx + L * fy / sy
    d_, e_, f_ = 0, 1 / sy, ay * SS - fy / sy
    body = src.transform(big.size, Image.AFFINE, (a_, b_, c_, d_, e_, f_), Image.BICUBIC)
    if flash > 0:
        white = Image.new('RGBA', body.size, (255, 246, 230, 255)); white.putalpha(body.getchannel('A'))
        body = Image.blend(body, white, flash)
    fxl = Image.new('RGBA', big.size); dr = ImageDraw.Draw(fxl); u = SS * k; lw = max(1, int(.9 * u))
    cx = M + ax; topy = M + ay - hgt * sy
    if pf > 0:  # impact puff at the hit side, mid-body, plus two little sparks
        pr = max(2.2 * k, wid * .16) * pf; px, py = cx + side * (wid * .5 + pr * .3), M + ay - hgt * .55
        puff(dr, px * SS, py * SS, pr * SS, 235, lw)
        for j, (ox, oy) in enumerate(((1.4, -1.1), (1.7, .6))):
            star(dr, (px + side * ox * pr) * SS, (py + oy * pr) * SS, pr * .45 * SS, .4 * j, (255, 226, 92, 255), (92, 58, 40, 255), lw)
    if ns:  # dizzy stars orbiting above the head
        rr = max(2.0 * k, wid * .1) * sr; orb = max(4.0 * k, wid * .32)
        for j in range(ns):
            t = spin + j * 2 * math.pi / ns; ox, oy = math.cos(t) * orb, math.sin(t) * orb * .35
            col = ((255, 222, 84, 255), (255, 170, 200, 255), (150, 220, 255, 255))[j % 3]
            star(dr, (cx + ox) * SS, (topy - rr * 1.4 + oy) * SS, rr * SS * (1 + .25 * (oy > 0)), t, col, (92, 58, 40, 255), lw)
    big.alpha_composite(body); big.alpha_composite(fxl)
    out = big.resize((W, H), Image.LANCZOS); bx = out.getbbox() or (0, 0, 1, 1)
    out = out.crop(bx); return out, M + ax - bx[0], M + ay - bx[1]

def pack(items, align16, maxw=1020):
    """items: list of (im1, im2). Shelf pack (tallest first) with PAD; returns pages [(w,h,[(idx,x,y)])]"""
    order = sorted(range(len(items)), key=lambda i: -items[i][0].height); pages = []; cur = []; x = y = rowh = 0
    W = maxw
    for i in order:
        w, h = items[i][0].size
        if x + w > W: x = 0; y += rowh + PAD; rowh = 0
        if y + h > 1020: pages.append(cur); cur = []; x = y = rowh = 0
        cur.append((i, x, y)); x += w + PAD; rowh = max(rowh, h)
    pages.append(cur); res = []
    for pg in pages:
        pw = max(x + items[i][0].width for i, x, y in pg); ph = max(y + items[i][0].height for i, x, y in pg)
        if align16: pw, ph = -(-pw // 16) * 16, -(-ph // 16) * 16
        res.append((pw, ph, pg))
    return res

def build_hurt(man, base, keyp, sprites, align16, out_dir):
    A = {a['key']: a for a in man['atlases']}; items, index, by = [], {}, {}
    for s in sprites:
        ent = []
        for i in range(3):
            for d in range(8):
                im1, im2, ax, ay = src_frame(base, A, s, d)
                f1, a1x, a1y = hurt_frame(im1, ax, ay, 1, i, d)
                f2, _, _ = hurt_frame(im2, ax * 2, ay * 2, 2, i, d)
                f2 = f2.resize((f1.width * 2, f1.height * 2), Image.LANCZOS) if f2.size != (f1.width * 2, f1.height * 2) else f2
                h = hashlib.sha1(f1.tobytes() + f2.tobytes()).hexdigest()
                if h not in by: by[h] = len(items); items.append((f1, f2))
                ent.append((by[h], a1x / f1.width, a1y / f1.height))
        index[s['key']] = ent
    pages = pack(items, align16); where = {}; atl = []
    for p, (pw, ph, pg) in enumerate(pages):
        key = keyp if len(pages) == 1 else f'{keyp}_{p}'; i1 = Image.new('RGBA', (pw, ph)); i2 = Image.new('RGBA', (pw * 2, ph * 2))
        for i, x, y in pg: i1.paste(items[i][0], (x, y)); i2.paste(items[i][1], (2 * x, 2 * y)); where[i] = (key, x, y, *items[i][0].size)
        assert max(i2.size) <= 2048
        i1.save(f'{base}{out_dir}{key}.png', optimize=True); i2.save(f'{base}{out_dir}{key}@2x.png', optimize=True)
        atl.append({"key": key, "image": f"{out_dir}{key}.png", "frameW": pw, "frameH": ph, "columns": 1, "rows": 1, "residency": "resident",
                    "pages": [{"scale": 2, "image": f"{out_dir}{key}@2x.png", "ktx2": f"{out_dir}{key}@2x.ktx2"}], "ktx2": f"{out_dir}{key}.ktx2"})
    for s in sprites:
        df = []
        for it, axr, ayr in index[s['key']]:
            k, x, y, w, h = where[it]; df.append({"atlas": k, "rect": {"x": x, "y": y, "w": w, "h": h}, "anchor": {"x": round(axr, 5), "y": round(ayr, 5)}})
        an = {"frames": [0, 1, 2], "fps": 10, "directions": 8, "dirStride": 1, "loop": False, "dirFrames": df}
        names = [n for n in ('hurt', 'hit') if n in s['animations']] or ['hurt']
        for n in names: s['animations'][n] = json.loads(json.dumps(an))
    return atl, len(items), pages, items

def strip(man, pref):
    man['atlases'] = [a for a in man['atlases'] if not a['key'].startswith(pref)]
    man['sprites'] = [s for s in man['sprites'] if not s['atlas'].startswith(pref)]

# ---------- stumps (32x32 cells, feet at y=26)
def lt(c, t): return tuple(int(v + (255 - v) * t) for v in c[:3]) + (255,)
def dk(c, t): return tuple(int(v * (1 - t)) for v in c[:3]) + (255,)
def hx(s): s = s.lstrip('#'); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
STUMP = {  # species: bark, wood, deco
    'oak_tree': ('#6b4a2e', '#e0b47a', 'acorn'), 'pine_tree': ('#5e3f2a', '#e7c38a', 'cone'), 'birch_tree': ('#ece6da', '#f0d6a0', 'birch'),
    'maple_tree': ('#6a4630', '#e4b97e', 'maple'), 'willow_tree': ('#6f5a3a', '#e2c690', 'willow'), 'palm_tree': ('#a7825a', '#e9cf98', 'palm'),
    'apple_tree': ('#6b4a30', '#e5bb80', ('fruit', '#d8344a')), 'pear_tree': ('#6b4c30', '#e5bb80', ('fruit', '#b8c94a')),
    'cherry_tree': ('#5a3a34', '#e8bc8a', 'petal'), 'orange_tree': ('#6b4a30', '#e5bb80', ('fruit', '#f0922e')), 'peach_tree': ('#6b4a30', '#e5bb80', ('fruit', '#f4a77c')),
}
OL = (74, 46, 42, 255)
def stump(sp, k):
    bark, wood, deco = STUMP[sp]; bark, wood = hx(bark), hx(wood); u = 8 * k; S = 32 * u
    im = Image.new('RGBA', (S, S)); d = ImageDraw.Draw(im); lw = int(1.1 * u); cx = 16 * u
    def E(x0, y0, x1, y1, f, o=OL, w=lw): d.ellipse([x0 * u, y0 * u, x1 * u, y1 * u], fill=f, outline=o, width=w)
    d.ellipse([7 * u, 23 * u, 25 * u, 29 * u], fill=(30, 40, 30, 70))  # contact shadow
    tall = 9 if sp != 'palm_tree' else 10; wdt = 6.5 if sp != 'palm_tree' else 4.8; top = 26 - tall
    for sx in (-1, 1):  # roots
        d.polygon([(cx + sx * wdt * u, (top + tall - 4) * u), (cx + sx * (wdt + 3.2) * u, 26.6 * u), (cx + sx * (wdt - 2) * u, 26 * u)], fill=dk(bark, .05), outline=OL, width=lw)
    d.rounded_rectangle([cx - wdt * u, (top + 1) * u, cx + wdt * u, 26.3 * u], radius=int(2.4 * u), fill=bark, outline=OL, width=lw)
    d.rectangle([cx - wdt * u + lw, (top + 1.5) * u, cx - (wdt - 1.6) * u, 25.5 * u], fill=lt(bark, .18))  # rim light
    d.rectangle([cx + (wdt - 1.8) * u, (top + 1.5) * u, cx + wdt * u - lw, 25.5 * u], fill=dk(bark, .2))
    if deco == 'birch':
        for x, y, w in ((-3.5, top + 4, 2.4), (1.2, top + 6.5, 3), (-1, top + 8.8, 2)): d.rounded_rectangle([cx + x * u, y * u, cx + (x + w) * u, (y + .9) * u], radius=int(.4 * u), fill=(58, 48, 46, 255))
    elif sp == 'palm_tree':
        for y in range(top + 3, 25, 2): d.arc([cx - wdt * u, (y - 1.4) * u, cx + wdt * u, (y + 1.4) * u], 20, 160, fill=dk(bark, .3), width=int(.6 * u))
    else:
        for x in (-2.6, 1.8): d.line([(cx + x * u, (top + 4) * u), (cx + (x + .3) * u, 24.4 * u)], fill=dk(bark, .22), width=int(.6 * u))
    E(cx / u - wdt - .2, top - 1.6, cx / u + wdt + .2, top + 3.4, wood)  # cut top
    E(cx / u - wdt + 1.8, top - .4, cx / u + wdt - 1.8, top + 2.2, None, dk(wood, .25), int(.45 * u))  # ring
    E(cx / u - 1.4, top + .3, cx / u + 1.4, top + 1.5, dk(wood, .2), dk(wood, .3), int(.3 * u))
    d.arc([(cx / u - wdt + .6) * u, (top - 1) * u, (cx / u + wdt - .6) * u, (top + 2.8) * u], 200, 300, fill=lt(wood, .5), width=int(.5 * u))  # gloss
    if deco == 'acorn':
        E(20.5, 23.2, 23.3, 26.2, hx('#b07a3a')); d.chord([20.2 * u, 22.4 * u, 23.6 * u, 24.6 * u], 180, 360, fill=hx('#6b4a2e'), outline=OL, width=lw)
    elif deco == 'cone':
        E(20.6, 22.6, 23.6, 26.4, hx('#9a6236'))
        for y in (23.6, 24.8): d.line([(21 * u, y * u), (23.2 * u, y * u)], fill=OL, width=int(.4 * u))
    elif deco == 'maple':
        x0, y0 = 22, 24.2; pts = [(x0 + 2.4 * math.cos(a) * (1 if i % 2 == 0 else .5), y0 + 2.4 * math.sin(a) * (1 if i % 2 == 0 else .5)) for i, a in enumerate([j * math.pi / 5 - math.pi / 2 for j in range(10)])]
        d.polygon([(x * u, y * u) for x, y in pts], fill=hx('#e0502e'), outline=OL, width=lw)
    elif deco == 'willow':
        d.line([(cx + 1 * u, (top - .2) * u), (cx + 3.5 * u, (top - 3.2) * u), (cx + 5.2 * u, (top - 2) * u)], fill=hx('#5e4a2e'), width=int(.7 * u))
        for t in (.0, 1.0): E(cx / u + 3.2 + t * 1.6, top - 3.4 + t * 1.2, cx / u + 4.4 + t * 1.6, top - 1.2 + t * 1.2, hx('#9ccf5a'), OL, int(.5 * u))
    elif deco == 'palm':
        E(20.4, 22.6, 24.2, 26.4, hx('#8a5a32')); E(21.4, 23.2, 22.4, 24.2, hx('#5a3a22'), None, 0)
    elif deco == 'petal':
        for x, y in ((21, 24.8), (23.6, 23.6), (9.5, 25.4)): E(x, y, x + 1.8, y + 1.3, hx('#f6b2cc'), OL, int(.45 * u))
    elif isinstance(deco, tuple):
        E(20.4, 22.4, 24, 26, hx(deco[1])); d.line([(22.2 * u, 22.6 * u), (22.6 * u, 21.4 * u)], fill=hx('#5e4a2e'), width=int(.6 * u))
        E(22.6, 21.2, 24.2, 22.2, hx('#6fbf4e'), OL, int(.4 * u)); E(21, 23, 21.9, 23.8, lt(hx(deco[1]), .5), None, 0)
    return im.resize((32 * k, 32 * k), Image.LANCZOS)

def hpbar(k):  # 24x4 creature bar: rounded dark-plum rim with a soft cream highlight + tiny heart notch on the left
    w, h = 24 * k, 6 * k; S = 8 * k; im = Image.new('RGBA', (w * 8, h * 8)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, S, w * 8 - 1, h * 8 - 1 - S], radius=int(2 * S), fill=(66, 38, 48, 255))
    d.rounded_rectangle([S, 2 * S, w * 8 - 1 - S, h * 8 - 1 - 2 * S], radius=int(1 * S), fill=(0, 0, 0, 0))
    d.line([(2 * S, 1.5 * S), (w * 8 - 2 * S, 1.5 * S)], fill=(176, 132, 140, 255), width=max(1, S // 3))
    return im.resize((w, h), Image.LANCZOS)

if __name__ == '__main__':
    mm = load(R + 'manifest.json'); nm = load(NAT + 'manifest.nature.json')
    strip(mm, 'adr134_hurt'); strip(nm, 'nature_adr134')
    ms = [s for s in mm['sprites'] if s['category'] in ('zombie',) or (s['category'] == 'critter' and s['key'].startswith('animal_'))]
    ns = [s for s in nm['sprites'] if s['category'] == 'critter' and s['key'].startswith('animal_')]
    ma, mn, mp, mit = build_hurt(mm, R, 'adr134_hurt', ms, False, 'atlases/')
    na, nn, npg, nit = build_hurt(nm, NAT, 'nature_adr134_hurt', ns, True, 'atlases/')
    mm['atlases'] += ma; nm['atlases'] += na
    # stumps
    sk = list(STUMP); cols = 6; rows = -(-len(sk) // cols); s1 = Image.new('RGBA', (32 * cols, 32 * rows)); s2 = Image.new('RGBA', (64 * cols, 64 * rows))
    for i, sp in enumerate(sk): s1.paste(stump(sp, 1), ((i % cols) * 32, (i // cols) * 32)); s2.paste(stump(sp, 2), ((i % cols) * 64, (i // cols) * 64))
    s1.save(NAT + 'atlases/nature_adr134_stumps.png', optimize=True); s2.save(NAT + 'atlases/nature_adr134_stumps@2x.png', optimize=True)
    nm['atlases'].append({"key": "nature_adr134_stumps", "image": "atlases/nature_adr134_stumps.png", "frameW": 32, "frameH": 32, "columns": cols, "rows": rows, "residency": "resident",
                          "pages": [{"scale": 2, "image": "atlases/nature_adr134_stumps@2x.png", "ktx2": "atlases/nature_adr134_stumps@2x.ktx2"}], "ktx2": "atlases/nature_adr134_stumps.ktx2"})
    for i, sp in enumerate(sk): nm['sprites'].append({"key": f"{sp}_stump", "category": "resource", "atlas": "nature_adr134_stumps", "anchor": {"x": 0.5, "y": 0.8125}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    # creature hp bar 9-slice: 24x6 art centred in a 32x16 cell
    def padto(im, w, h): o = Image.new('RGBA', (w, h)); o.paste(im, ((w - im.width) // 2, (h - im.height) // 2)); return o
    padto(hpbar(1), 32, 16).save(NAT + 'atlases/nature_adr134_hpbar.png', optimize=True); padto(hpbar(2), 64, 32).save(NAT + 'atlases/nature_adr134_hpbar@2x.png', optimize=True)
    nm['atlases'].append({"key": "nature_adr134_hpbar", "image": "atlases/nature_adr134_hpbar.png", "frameW": 32, "frameH": 16, "columns": 1, "rows": 1, "residency": "resident",
                          "nineSlice": {"0": {"l": 7, "t": 6, "r": 7, "b": 6}},
                          "pages": [{"scale": 2, "image": "atlases/nature_adr134_hpbar@2x.png", "ktx2": "atlases/nature_adr134_hpbar@2x.ktx2"}], "ktx2": "atlases/nature_adr134_hpbar.ktx2"})
    nm['sprites'].append({"key": "ui_creature_hpbar_frame", "category": "ui", "atlas": "nature_adr134_hpbar", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1}}})
    save(mm, R + 'manifest.json', 2); save(nm, NAT + 'manifest.nature.json', 1)
    print('main hurt', [s['key'] for s in ms], mn, 'unique frames', [(p[0], p[1]) for p in mp])
    print('nature hurt', [s['key'] for s in ns], nn, 'unique frames', [(p[0], p[1]) for p in npg])
    # previews: per creature, facing 0/2/4/6: idle + 3 hurt frames (@2x)
    os.makedirs(PREV, exist_ok=True); font = ImageFont.load_default()
    def sheet(man, base, sprites, path):
        A = {a['key']: a for a in man['atlases']}; CW, CH = 112, 140; im = Image.new('RGB', (CW * 16, CH * len(sprites) + 4), (104, 150, 98)); dr = ImageDraw.Draw(im)
        for r, s in enumerate(sprites):
            dr.text((2, r * CH + 2), s['key'], fill=(255, 255, 240))
            for c, d in enumerate((0, 2, 4, 6)):
                _, i2, ax, ay = src_frame(base, A, s, d); X = (c * 4) * CW; Y = r * CH; im.paste(i2, (X + CW // 2 - int(ax * 2), Y + CH - 16 - int(ay * 2)), i2)
                hn = 'hurt' if 'hurt' in s['animations'] else 'hit'
                for f in range(3):
                    e = s['animations'][hn]['dirFrames'][f * 8 + d]; a = A[e['atlas']]; rc = e['rect']
                    p = img(base, a['pages'][0]['image']).crop((2 * rc['x'], 2 * rc['y'], 2 * (rc['x'] + rc['w']), 2 * (rc['y'] + rc['h'])))
                    X = (c * 4 + 1 + f) * CW; im.paste(p, (X + CW // 2 - int(e['anchor']['x'] * p.width), Y + CH - 16 - int(e['anchor']['y'] * p.height)), p)
        im.save(path); print('preview', path)
    _imc.clear(); sheet(mm, R, ms, f'{PREV}/adr134_hurt_main_2x.png'); sheet(nm, NAT, ns, f'{PREV}/adr134_hurt_nature_2x.png')
    pv = Image.new('RGB', (len(sk) * 80, 150), (104, 150, 98)); dr = ImageDraw.Draw(pv)
    for i, sp in enumerate(sk): pv.paste(stump(sp, 2), (i * 80 + 8, 4), stump(sp, 2)); dr.text((i * 80 + 4, 72), sp.replace('_tree', ''), fill=(255, 255, 240))
    hb = hpbar(2).resize((192, 48), Image.NEAREST); pv.paste(hb, (8, 92), hb)
    pv.save(f'{PREV}/adr134_stumps_hpbar_2x.png'); print('preview', f'{PREV}/adr134_stumps_hpbar_2x.png')
