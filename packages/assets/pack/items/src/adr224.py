# ADR-224 build window piece icons -> items_build (32px cells + @2x 64px, category ui, residency stream: CSS-only art,
# never paged by the renderer, so resident VRAM and the stream pool geometry are unchanged).
# One icon per pieces.json entry (exact ids), per tier for tiered pieces, plus the roads tab (roads.json surfaces, sign kinds):
#   tiered piece   -> build_<piece>_t<N>   N = tier index in tiers.json (0 twig .. 4 reinforced), minTier..4
#   untiered piece -> build_<piece>
#   road surface   -> build_road_<surface key>      (road-<i> button = surfaces[i-1])
#   sign kind      -> build_<sign key>              (roads.json signs[], e.g. build_sign_wooden_post)
# Source = the piece's in-game sprite, resolved like the renderer: [piece@tierN, piece] (tier 0: [piece_twig, piece]),
# then sprite_fallbacks.json; idle frame 0 from the highest-res page. Cel pass: crop to the figure (contact shadow
# dropped), fit, snap to the source's own flat palette, binary alpha, bold outline ring (1px / 2px @2x) in the
# palette's dark tones. stairs t1..4 (only stairs_twig art) are recoloured onto that tier's wall material ramp.
# Pieces with no sprite of their own are painted here with draw.C in cel mode (PAINT); campfire uses its bonfire art.
# Run from repo root after build.py / adr132 / adr135 / pets145: python3 packages/assets/pack/items/src/adr224.py [preview dir]
#   then python3 assets/tools/ktx2.py packages/assets/pack/items/manifest.items.json, gen_icon_css.py, lock:ids:pack.
import glob, json, math, os, sys
os.environ['CEL'] = '1'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from draw import C, lt, dk, hx
B = 'packages/assets/pack/'; G = 'packages/gameplay/data/'; OUT = B + 'items/'; AK = 'items_build'
PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/preview'
PIECES = json.load(open(G + 'pieces.json'))['pieces']; TIERS = json.load(open(G + 'tiers.json'))['tiers']
ROADS = json.load(open(G + 'roads.json')); FB = json.load(open(G + 'sprite_fallbacks.json'))['sprites']
SPR, PIECE = {}, {}
for f in [B + 'manifest.json'] + sorted(glob.glob(B + '*/manifest.*.json')):
    m = json.load(open(f)); A = {a['key']: a for a in m.get('atlases', [])}
    for s in m.get('sprites', []):
        if s.get('atlas') not in A: continue
        r = (os.path.dirname(f), s, A[s['atlas']]); SPR.setdefault(s['key'], r)
        if (s.get('building') or {}).get('piece'): PIECE.setdefault(s['building']['piece'], r)
def find(k): return PIECE.get(k) or SPR.get(k)
PAINT_OVER_FALLBACK = {'torch_stand', 'banner', 'lantern', 'market_counter', 'fireplace', 'wood_stove', 'windsock', 'banner_wall', 'gate_clan'}
def resolve(p, t):
    k = p['key']; tiered = p.get('tiered')
    for c in ([f'{k}@tier{t}', k] if tiered and t else [k + '_twig', k] if tiered else [k]):
        if find(c): return find(c), ('own' if c in (f'{k}@tier{t}', k + '_twig') or not tiered or t == 0 else 'base')
    if k in PAINT_OVER_FALLBACK: return None, 'none'
    q, seen = [k], set()
    while q:
        c = q.pop(0)
        if c in seen or c not in FB: continue
        seen.add(c)
        for to in FB[c]['to']:
            if find(to): return find(to), 'fallback:' + to
            q.append(to)
    return None, 'none'
def frame(r):
    base, s, a = r; fi = s['animations']['idle']['frames'][0]
    sc, img = max([(1, a['image'])] + [(p['scale'], p['image']) for p in a.get('pages') or []])
    im = Image.open(os.path.join(base, img)).convert('RGBA'); fw, fh = a['frameW'] * sc, a['frameH'] * sc
    cols = a.get('columns') or im.width // fw; x, y = fi % cols * fw, fi // cols * fh
    return im.crop((x, y, x + fw, y + fh))
def figure(im):  # binary figure, soft contact shadow / AA fringe dropped, cropped to its bbox
    a = np.array(im).astype(np.float32); al = a[..., 3]
    sh = (al < 200) & (a[..., :3].max(-1) < 70); fig = (al >= 128) & ~sh
    a[..., 3] = np.where(fig, 255, 0); a[~fig] = 0
    o = Image.fromarray(a.astype(np.uint8)); return o.crop(o.getbbox())
def palette(im, k=16):
    a = np.array(im); px = a[a[..., 3] > 0][:, :3]
    q = Image.fromarray(px[None]).quantize(min(k, max(2, len(np.unique(px, axis=0)))), method=Image.Quantize.MEDIANCUT)
    p = np.array(q.getpalette()[:3 * len(q.getcolors())], np.float32).reshape(-1, 3); return p
def snapto(rgb, P):
    out = np.empty_like(rgb)
    for y0 in range(0, rgb.shape[0], 32):
        r = rgb[y0:y0 + 32]; out[y0:y0 + 32] = P[((r[..., None, :] - P[None, None]) ** 2).sum(-1).argmin(-1)]
    return out
def ring(rgb, m, r):  # outline ring r px outside the mask; colour = dark tone of the neighbouring figure colour
    rgb, m = rgb.copy(), m.copy(); H, W = m.shape
    for _ in range(r):
        acc = np.zeros((H, W, 3), np.float32); n = np.zeros((H, W), np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not dx and not dy: continue
                sm = np.zeros_like(m); sc = np.zeros_like(rgb)
                ys, yd = (slice(max(0, dy), H + min(0, dy)), slice(max(0, -dy), H + min(0, -dy)))
                xs, xd = (slice(max(0, dx), W + min(0, dx)), slice(max(0, -dx), W + min(0, -dx)))
                sm[yd, xd] = m[ys, xs]; sc[yd, xd] = rgb[ys, xs]; acc += sc * sm[..., None]; n += sm
        new = (n > 0) & ~m; rgb[new] = acc[new] / n[new][:, None]; rgb[new] = rgb[new] + (np.array((40, 22, 40)) - rgb[new]) * 0.62
        m = m | new
    return rgb, m
def icon(fig, P, cell, pad, ow):
    box = cell - 2 * pad; w, h = fig.size; s = min(box / w, box / h)
    src = fig
    if s > 1: k = math.ceil(s); src = fig.resize((w * k, h * k), Image.NEAREST); w, h = src.size; s = min(box / w, box / h)
    tw, th = max(1, round(w * s)), max(1, round(h * s))
    a = np.array(src).astype(np.float32); pm = a.copy(); pm[..., :3] *= a[..., 3:] / 255
    sm = np.array(Image.fromarray(pm.astype(np.uint8), 'RGBA').resize((tw, th), Image.BOX)).astype(np.float32)
    al = sm[..., 3]; m = al >= 110; rgb = np.where(m[..., None], sm[..., :3] * 255 / np.maximum(al, 1)[..., None], 0)
    rgb = snapto(rgb, P)
    R = np.zeros((cell, cell, 3), np.float32); M = np.zeros((cell, cell), bool)
    x0, y0 = (cell - tw) // 2, (cell - th) // 2; R[y0:y0 + th, x0:x0 + tw] = rgb; M[y0:y0 + th, x0:x0 + tw] = m
    R2, M2 = ring(R, M, ow); ringm = M2 & ~M
    D = np.array([(np.array(c) + (np.array((40, 22, 40)) - np.array(c)) * 0.62) for c in P], np.float32)
    R2[ringm] = snapto(R2[ringm][None], D)[0]
    o = np.zeros((cell, cell, 4), np.uint8); o[M2, :3] = R2[M2].round().clip(0, 255); o[M2, 3] = 255
    return Image.fromarray(o, 'RGBA')
def recolour(fig, ramp_src):  # luminance-rank remap onto another material's ramp (stairs t1..4)
    a = np.array(fig).astype(np.float32); m = a[..., 3] > 0; Lum = a[..., :3] @ np.array([.299, .587, .114])
    R = palette(ramp_src, 10); R = R[np.argsort(R @ np.array([.299, .587, .114]))]
    v = Lum[m]; lo, hi = np.percentile(v, 2), np.percentile(v, 98); t = np.clip((v - lo) / max(1, hi - lo), 0, 1)
    a[m, :3] = R[np.minimum((t * len(R)).astype(int), len(R) - 1)]; return Image.fromarray(a.astype(np.uint8))
# ---- painted (no sprite of their own): iso 3/4 on the 32-unit draw.C canvas, cel mode ----
WOOD, WOODL, STONE, IRON, RED, CLOTH, GOLD, FIRE, FIREY, GREEN, BLUE = '#9a6a3c', '#c49058', '#9a978e', '#4c5058', '#b8403a', '#e8dcc0', '#e0b040', '#f08a2c', '#ffd860', '#5a8a3c', '#3c6ab0'
def box(c, cx, yb, ax, ay, h, col, sh=.1, **k):  # iso box: front-bottom corner (cx, yb), extents along the right/left axes, height
    F, Rt, Lt = (cx, yb), (cx + ax, yb - ax / 2), (cx - ay, yb - ay / 2); Bk = (cx + ax - ay, yb - ax / 2 - ay / 2); up = lambda p: (p[0], p[1] - h)
    c.poly([F, Lt, up(Lt), up(F)], col, shade=sh, **k); c.poly([F, Rt, up(Rt), up(F)], dk(col, .22), shade=sh, **k)
    c.poly([up(F), up(Rt), up(Bk), up(Lt)], lt(col, .22), shade=sh, **k)
def flame(c, x, y, s=1.0):
    c.poly([(x - 2.6 * s, y), (x - 1.6 * s, y - 3.5 * s), (x, y - 6.5 * s), (x + 1.6 * s, y - 3.5 * s), (x + 2.6 * s, y)], FIRE, shade=.2)
    c.poly([(x - 1.2 * s, y - .3), (x, y - 3.8 * s), (x + 1.2 * s, y - .3)], FIREY, ol=False)
def pyramid(c, cx, yb, a, h, col, col2=None):
    T = (cx, yb - a / 2 - h); L, F, R = (cx - a, yb - a / 2), (cx, yb), (cx + a, yb - a / 2)
    c.poly([L, F, T], col, shade=.1); c.poly([F, R, T], dk(col2 or col, .2), shade=.1)
def P_torch_stand(c):
    box(c, 16, 29, 4, 4, 3, STONE); box(c, 16, 26, 1.4, 1.4, 16, WOOD); box(c, 16, 11, 2.6, 2.6, 2, IRON); flame(c, 16, 8.5, 1.1)
def P_claim_totem(c):
    box(c, 16, 30, 5, 5, 2.5, STONE)
    for i, col in enumerate((WOOD, '#7a4e2c', WOOD)):
        y = 27 - i * 6.5; box(c, 16, y, 3.2, 3.2, 6, col); c.dot(14.2, y - 3.8, .7, '#2a1a20'); c.dot(12.6, y - 4.5, .7, '#2a1a20'); c.line([(12.4, y - 2), (14.6, y - 1)], .5, '#2a1a20')
    c.poly([(9, 8), (16, 5.5), (23, 8), (16, 9.8)], RED, shade=.15); c.poly([(16, 2), (18, 6), (14, 6)], GOLD)
def P_banner(c):
    c.stroke([(10, 29), (10, 3.5)], 1.4, WOOD); c.stroke([(9, 5), (24, 5)], 1.2, WOOD); c.dot(10, 3.2, 1.1, GOLD)
    c.poly([(11, 5.5), (23, 5.5), (23, 23), (17, 19.5), (11, 23)], RED, shade=.12); c.poly([(15, 9), (19, 9), (19, 13.5), (17, 15.5), (15, 13.5)], GOLD, owf=.6)
def P_lantern(c):
    box(c, 16, 30, 3.5, 3.5, 2, IRON); box(c, 16, 28, 1.1, 1.1, 13, IRON)
    box(c, 16, 15, 4, 4, 7, '#ffcf5a', sh=.05); flame(c, 15.6, 12.5, .7); pyramid(c, 16, 9, 5, 4, IRON); c.dot(16, 4.6, .9, IRON)
def P_stall_blanket(c):
    box(c, 15, 29, 10, 10, 1.2, '#4a7ab0', sh=.05)
    for x, y in ((8.6, 24.3), (12.6, 22.3), (16.6, 20.3)): c.line([(x, y), (x + 8, y + 4)], .9, CLOTH)
    c.ell(11, 21, 2.3, 1.6, '#d85a40'); c.ell(17, 22.5, 2.2, 1.5, '#e8c24a'); box(c, 20, 22, 2.5, 2.5, 3, WOODL); c.ell(14, 26, 2, 1.4, GREEN)
def P_stall_cart(c):
    box(c, 15, 25, 10, 5, 6, WOOD); c.ell(11, 25.5, 3.6, 3.6, '#6a4a2a'); c.ell(11, 25.5, 1.2, 1.2, IRON)
    c.stroke([(25, 20), (30, 21.5)], 1, WOOD)
    for x, col in ((6, '#d85a40'), (9.5, '#e8c24a'), (13, GREEN)): c.ell(x + 1, 14.5 + (x - 6) * .1, 1.6, 1.2, col)
    c.stroke([(6.5, 18), (6.5, 7)], .8, WOODL); c.stroke([(24, 15), (24, 4)], .8, WOODL)
    c.poly([(4, 8), (16, 2), (27, 5), (15, 11)], RED, shade=.1); c.line([(8, 6), (19.5, 9)], .9, CLOTH); c.line([(12, 4), (23.5, 7)], .9, CLOTH)
def P_stall_booth(c):
    box(c, 16, 30, 11, 5, 8, WOODL); box(c, 16, 22.4, 11.6, 5.6, 1.2, WOOD)
    for x, y in ((5.5, 22), (26.5, 17)): c.stroke([(x, y), (x, y - 15)], .9, WOOD)
    c.poly([(3, 9), (16, 2.5), (29.5, 4), (16.5, 12)], '#3c8a6a', shade=.1)
    for t in (.25, .5, .75): c.line([(3 + 13.5 * t, 9 + 3 * t), (16 + 13.5 * t, 2.5 + 1.5 * t)], 1.1, CLOTH)
    c.ell(10, 19.5, 1.8, 1.2, '#d85a40'); c.ell(15, 19, 1.8, 1.2, '#e8c24a'); c.ell(20, 17.5, 1.8, 1.2, GREEN)
def P_clan_pavilion(c):
    for x, y in ((4.5, 23), (16, 29), (27.5, 23)): c.stroke([(x, y), (x, y - 9)], 1, WOOD)
    c.poly([(3, 14), (16, 20.5), (29, 14), (16, 7.5)], CLOTH, shade=.1)
    pyramid(c, 16, 21.5, 13.5, 13, RED, RED); c.line([(16, 21.5), (16, 4)], .8, dk(RED, .4))
    c.stroke([(16, 4.5), (16, .8)], .7, WOOD); c.poly([(16.4, 1), (21, 2.2), (16.4, 3.4)], GOLD, owf=.6)
def P_market_counter(c):
    box(c, 16, 30, 12, 4, 9, WOOD); box(c, 16, 21, 12.6, 4.6, 1.4, WOODL)
    for i in range(3): c.line([(4 + i * 0, 0), (4, 0)], .1, WOOD)
    c.line([(16, 30), (16, 21)], .6, dk(WOOD, .5)); c.line([(22, 27), (22, 18)], .6, dk(WOOD, .5)); c.line([(10, 28), (10, 19)], .6, dk(WOOD, .5))
    c.ell(9, 16.4, 1.9, 1.3, '#d85a40'); c.ell(13.5, 17.6, 1.9, 1.3, '#e8c24a'); box(c, 21, 16.5, 2.4, 2.4, 2.4, '#c8a070'); c.ell(26, 13.6, 1.7, 1.2, GREEN)
def P_fireplace(c):
    box(c, 16, 30, 11, 4, 16, STONE)
    c.poly([(8, 27), (8, 19.5), (10.5, 17), (13.5, 18.5), (13.5, 29.5)], '#2a1e24', olc='#2a1e24'); flame(c, 10.8, 27.5, .9)
    box(c, 16, 14.5, 11.8, 4.6, 1.6, WOOD); box(c, 19, 12.5, 3.2, 3.2, 10, dk(STONE, .1))
    for y in (21, 25): c.line([(16, y), (27, y - 5.5)], .5, dk(STONE, .45))
def P_wood_stove(c):
    for x, y in ((9, 28), (16, 30.5), (23, 28)): c.stroke([(x, y), (x, y - 3)], .9, IRON)
    box(c, 16, 27.5, 7, 7, 10, IRON); c.poly([(10, 23), (14, 25), (14, 20.5), (10, 18.5)], FIRE, shade=.3, owf=.6); c.line([(11, 21), (13, 22)], .5, FIREY)
    box(c, 17, 14, 1.8, 1.8, 11, dk(IRON, .1)); c.dot(17, 3.2, 1.4, '#c8c8c8', 200)
def P_windsock(c):
    box(c, 11, 30, 3.5, 3.5, 2, STONE); c.stroke([(11, 28), (11, 4)], 1.1, '#c8c8c8'); c.dot(11, 4, 1, IRON)
    segs = [(12, 5, 7.8), (16.5, 6.3, 6.6), (21, 7.6, 5.4), (25.5, 8.9, 4.2), (29.5, 10, 3)]
    for i, ((x0, y0, h0), (x1, y1, h1)) in enumerate(zip(segs, segs[1:])):
        c.poly([(x0, y0), (x1, y1), (x1, y1 + h1), (x0, y0 + h0)], FIRE if i % 2 == 0 else CLOTH, shade=.1, owf=.8)
def P_banner_wall(c):
    c.poly([(5, 8), (27, 2), (27, 26), (5, 32)], dk(STONE, .05), shade=.05, owf=.7)
    c.stroke([(8.5, 9.5), (23.5, 5.5)], 1.2, WOOD)
    c.poly([(10, 9.5), (22, 6.3), (22, 23), (16, 22.5), (10, 27)], BLUE, shade=.12); c.poly([(14, 13), (18, 12), (18, 16), (16, 18.3), (14, 17)], GOLD, owf=.6)
def P_barricade_spiked(c):
    c.stroke([(5, 27), (27, 18)], 2.2, WOOD); c.stroke([(5, 19), (27, 27)], 2.2, WOOD)
    for (x0, y0, x1, y1) in ((7, 22, 3, 10), (13, 22, 11, 7), (19, 22, 21, 7), (25, 22, 29, 10)):
        c.stroke([(x0, y0), (x1, y1)], 1.8, WOODL); c.poly([(x1 - 1, y1 + .5), (x1 + (x1 - x0) * .12, y1 - 3.2), (x1 + 1, y1 + .5)], CLOTH, owf=.6)
    box(c, 16, 30, 3, 3, 2, '#7a4e2c')
def P_raid_bell(c):
    box(c, 16, 30, 9, 4, 1.5, STONE); c.stroke([(8, 25), (8, 5)], 1.6, WOOD); c.stroke([(24, 25), (24, 5)], 1.6, WOOD); c.stroke([(6, 5.5), (26, 5.5)], 1.8, WOOD)
    c.poly([(11, 21), (12.6, 13), (14.2, 9.6), (17.8, 9.6), (19.4, 13), (21, 21)], '#c0802c', shade=.3); c.ell(16, 21, 5.2, 1.4, '#a06420'); c.dot(16, 22.6, 1.3, IRON)
    c.line([(16, 6.5), (16, 9.6)], .7, IRON); c.shine(14, 13, .8)
def P_gate_clan(c):
    box(c, 5, 31, 3, 3, 26, STONE); box(c, 27.5, 21.5, 3, 3, 26, STONE)
    c.poly([(7.5, 29.5), (16, 25.2), (16, 6.8), (7.5, 11)], WOOD, shade=.08); c.poly([(16, 25.2), (25, 20.6), (25, 2.3), (16, 6.8)], dk(WOOD, .1), shade=.08)
    for t in (.25, .7): c.line([(7.5, 29.5 - 18.5 * t), (25, 20.6 - 18.3 * t)], 1.3, IRON)
    c.poly([(14.5, 14), (17.5, 12.5), (17.5, 16.5), (16, 18), (14.5, 17.4)], RED, owf=.6); c.dot(16, 15.2, .8, GOLD)
def P_clan_hall_door(c):
    c.poly([(5, 31), (27, 25), (27, 5), (16, 1.5), (5, 9)], dk(STONE, .05), shade=.06)
    c.poly([(8.5, 29.5), (23.5, 25.5), (23.5, 9), (16, 5.2), (8.5, 11.2)], '#7a4e2c', shade=.1); c.line([(16, 27.6), (16, 5.6)], .7, dk(WOOD, .55))
    for y in (12, 19): c.line([(8.5, y + 6), (23.5, y + 2)], 1.1, IRON)
    c.ell(16, 13.5, 2.4, 2.6, GOLD, owf=.6); c.dot(16, 13.5, 1, RED); c.dot(13.6, 21.5, .9, GOLD); c.dot(18.4, 20.3, .9, GOLD)
def P_watchtower(c):
    for (x0, y0, x1, y1) in ((6, 30, 9, 13), (16, 31.5, 16, 15), (26, 30, 23, 13)): c.stroke([(x0, y0), (x1, y1)], 1.5, WOOD)
    c.line([(7, 24), (16, 27)], .8, WOOD); c.line([(25, 24), (16, 27)], .8, WOOD)
    box(c, 16, 16.5, 8, 8, 2, WOODL); box(c, 16, 14.5, 8, 8, 4, WOOD, sh=.08)
    for x, y in ((8.5, 10.5), (23.5, 10.5), (16, 14.4)): c.stroke([(x, y), (x, y - 4)], .8, WOOD)
    pyramid(c, 16, 7, 9.5, 6.5, RED)
PAINT = {k[2:]: v for k, v in globals().items() if k.startswith('P_')}
def paint(k):
    c = C(32, 8); c.ow = 1.0; PAINT[k](c); b = c.out(64); s = c.out(32)
    return [Image.fromarray(np.where((np.array(x)[..., 3:] >= 128), np.concatenate([np.array(x)[..., :3], np.full(np.array(x).shape[:2] + (1,), 255, np.uint8)], -1), 0).astype(np.uint8)) for x in (b, s)]
# ---- enumerate ----
ENT = []  # (key, piece/source id, (2x, 1x), source label)
for p in PIECES:
    ts = range(p.get('minTier', 0), len(TIERS)) if p.get('tiered') else [None]
    for t in ts:
        key = f"build_{p['key']}" + (f'_t{t}' if t is not None else '')
        r, how = resolve(p, t)
        if p['key'] in PAINT: big, sm = paint(p['key']); ENT.append((key, p['key'], t, big, sm, 'painted')); continue
        if r is None: raise SystemExit(f'no source for {key}')
        f = figure(frame(r))
        if how == 'base' and t:  # base art only (stairs): recolour onto this tier's wall material
            f = recolour(f, figure(frame(find(f'wall@tier{t}')))); how = f'recolour:{r[1]["key"]}->wall@tier{t}'
        P = palette(f); ENT.append((key, p['key'], t, icon(f, P, 64, 3, 2), icon(f, P, 32, 2, 1), how if how != 'own' else r[1]['key']))
for s in ROADS['roads']['surfaces']:
    f = figure(frame(SPR['road_' + s['key']])); P = palette(f); ENT.append((f"build_road_{s['key']}", 'road:' + s['key'], None, icon(f, P, 64, 3, 2), icon(f, P, 32, 2, 1), 'road_' + s['key']))
for s in ROADS['signs']:
    f = figure(frame(SPR[s['key']])); P = palette(f); ENT.append((f"build_{s['key']}", 'sign:' + s['key'], None, icon(f, P, 64, 3, 2), icon(f, P, 32, 2, 1), s['key']))
if __name__ == '__main__':
    keys = [e[0] for e in ENT]; assert len(set(keys)) == len(keys)
    man = json.load(open(OUT + 'manifest.items.json'))
    clash = {s['key'] for s in man['sprites'] if s['atlas'] != AK} & set(keys); assert not clash, clash
    man['atlases'] = [a for a in man['atlases'] if a['key'] != AK]; man['sprites'] = [s for s in man['sprites'] if s['atlas'] != AK]
    cols = 16; rows = -(-len(ENT) // cols)
    a1 = Image.new('RGBA', (32 * cols, 32 * rows), (0,) * 4); a2 = Image.new('RGBA', (64 * cols, 64 * rows), (0,) * 4)
    for i, e in enumerate(ENT): a1.paste(e[4], (32 * (i % cols), 32 * (i // cols))); a2.paste(e[3], (64 * (i % cols), 64 * (i // cols)))
    a1.save(f'{OUT}atlases/{AK}.png', optimize=True); a2.save(f'{OUT}atlases/{AK}@2x.png', optimize=True)
    man['atlases'].append({"key": AK, "image": f"atlases/{AK}.png", "frameW": 32, "frameH": 32, "columns": cols, "rows": rows, "residency": "stream",
                           "pages": [{"scale": 2, "image": f"atlases/{AK}@2x.png", "ktx2": f"atlases/{AK}@2x.ktx2"}], "ktx2": f"atlases/{AK}.ktx2"})
    for i, k in enumerate(keys): man['sprites'].append({"key": k, "category": "ui", "atlas": AK, "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    json.dump(man, open(OUT + 'manifest.items.json', 'w'), indent=1); open(OUT + 'manifest.items.json', 'a').write('\n')
    # contact sheet: per icon 64 (@2x) / 48 (@2x downscaled, as the browser does) / 32 (1x) on a panel-dark and a light tile
    os.makedirs(PREV, exist_ok=True); font = ImageFont.load_default(); W, H, sc = 168, 92, 8
    im = Image.new('RGB', (W * sc, H * (-(-len(ENT) // sc)) + 24), (34, 30, 40)); d = ImageDraw.Draw(im)
    d.text((6, 6), f'{AK}: {len(ENT)} icons  (64 @2x | 48 | 32 1x; dark + light tile)  build_<piece>[_t<tier>] / build_road_<surface> / build_<sign kind>', fill=(255, 240, 200), font=font)
    for i, (k, pid, t, b, s, how) in enumerate(ENT):
        x, y = (i % sc) * W + 4, (i // sc) * H + 26
        for j, (bg, ox) in enumerate((((58, 50, 66), 0), ((214, 204, 184), 116))):
            d.rectangle([x + ox, y, x + ox + (112 if j == 0 else 48), y + 66], fill=bg)
        im.paste(b, (x + 1, y + 1), b); m = b.resize((48, 48), Image.LANCZOS); im.paste(m, (x + 66, y + 9), m); im.paste(s, (x + 119, y + 1), s)
        im.paste(s, (x + 119, y + 34), s)
        d.text((x, y + 68), k[6:][:27], fill=(255, 245, 225) if how != 'painted' else (255, 190, 120), font=font)
    im.save(f'{PREV}/build_piece_icons.png')
    srcless = sorted({pid for k, pid, t, b, s, how in ENT if how == 'painted' or how.startswith('fallback') or how.startswith('recolour')})
    print(len(ENT), 'icons', rows, 'rows'); print('no own sprite:', [(pid, how) for k, pid, t, b, s, how in ENT if how == 'painted' or how.startswith('fallback') or how.startswith('recolour')])
