"""Placeholder item icons + game-like iso background for previews ONLY (not shipped in the UI atlas).
If the art pack has real item icons (assets/sprites/item/<key>/... or assets/atlases/items.json), those are used instead."""
from __future__ import annotations
import glob, json, math, os, random
from PIL import Image, ImageFilter, ImageDraw, ImageChops
from .draw import hexc, lighten, darken, alpha, mix, rrect, blob, drop, star, jitter  # noqa: F401 (re-exported)
from .icon import Ink
from .kit import P, INK, leaf, wood_grain

ASSETS = '/workspace/assets'
_cache = {}


_atlas_index = None


def art_pack_icon(key):
    """Real icons from the art pack: assets/atlases/{items,equipment}.json (TexturePacker hash, frames keyed by item key)."""
    global _atlas_index
    if _atlas_index is None:
        _atlas_index = {}
        for name in ('items', 'equipment'):
            js = f'{ASSETS}/atlases/{name}.json'
            if not os.path.exists(js):
                continue
            d = json.load(open(js))
            img = Image.open(os.path.join(os.path.dirname(js), d['meta']['image'])).convert('RGBA')
            for fname, f in d['frames'].items():
                r = f['frame']
                _atlas_index.setdefault(fname.rsplit('.', 1)[0], img.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])))
    if key in _atlas_index:
        return _atlas_index[key]
    for pat in (f'{ASSETS}/sprites/item/{key}/*.png', f'{ASSETS}/sprites/equipment/{key}/*.png'):
        fs = sorted(glob.glob(pat))
        if fs:
            return Image.open(fs[0]).convert('RGBA')
    return None


def item_icon(key, size=32):
    ck = (key, size)
    if ck in _cache:
        return _cache[ck]
    im = art_pack_icon(key)
    if im is None:
        sc = 2 if size > 32 else 1
        c = Ink(32, 32, sc)
        DRAW.get(key, _unknown)(c)
        im = c.out()
    if im.size != (size, size):
        # integer upscales stay crisp (nearest), otherwise LANCZOS
        im = im.resize((size, size), Image.NEAREST if size % im.size[0] == 0 else Image.LANCZOS)
    _cache[ck] = im
    return im


def _unknown(c):
    c.part(blob(16, 16, 10, 10, wob=0.5, seed=1), P['slate-300'])
    c.line([(13, 12), (16, 10), (19, 12), (16, 16), (16, 18)], INK, 1.6)


def _log(c):
    c.part(rrect(4, 11, 26, 23, 6, wob=.4, seed=2), P['wood-400'])
    wood_grain(c, c.poly_mask(rrect(4, 11, 26, 23, 6)), P['wood-400'], 3, 'h', 2)
    c.part(blob(25, 17, 4.6, 6.2, wob=.3, seed=4), P['wood-200'])
    c.arc((22.5, 13.5, 27.5, 20.5), 0, 360, alpha(P['wood-500'], 220), 0.8)
    leaf(c, 10, 11, 3.4, -120)


def _stone(c):
    c.part(blob(16, 18, 11.5, 9, wob=1.0, seed=5), P['slate-300'])
    c.shine(12, 14, 3, 1.8, 160)


def _fiber(c):
    for i, (x, a) in enumerate(((10, -100), (14, -85), (18, -70), (22, -60))):
        pts = [(16, 28), (x, 16), (x + 2 * math.cos(math.radians(a)) * 3, 5 + i)]
        c.line(pts, INK, 3.4); c.line(pts, P['leaf-500'] if i % 2 else P['leaf-300'], 1.6)
    c.part(rrect(12, 22, 20, 26, 1.5), P['wood-300'], ow=1.2)


def _flint(c):
    c.part(jitter([(8, 22), (12, 8), (22, 6), (26, 16), (18, 27)], .4, 6), P['slate-500'])
    c.line([(13, 10), (20, 9)], alpha(P['parchment-50'], 200), 1)


def _ore(c):
    c.part(blob(16, 18, 11.5, 9.5, wob=1, seed=7), P['slate-500'])
    for x, y in ((11, 15), (19, 20), (17, 13)):
        c.part(blob(x, y, 2.2, 2, seed=x), P['pumpkin-300'], ow=1.0, shade=False)


def _ingot(c):
    c.part([(5, 22), (9, 13), (25, 13), (28, 22)], P['slate-300'])
    c.paint(c.poly_mask([(9, 13), (25, 13), (23, 16), (11, 16)]), lighten(P['slate-300'], .4))


def _berries(c):
    leaf(c, 16, 8, 4, -150); leaf(c, 16, 8, 4, -30, P['leaf-300'])
    for x, y in ((11, 16), (20, 15), (15, 22), (22, 23), (9, 23)):
        c.part(blob(x, y, 4.4, 4.4, wob=.2, seed=x), P['berry-500'], ow=1.3)
        c.ellipse((x - 2, y - 2.4, x - 0.6, y - 1), (255, 255, 255, 220))


def _flask(c):
    c.part(rrect(13, 3, 19, 8, 1.4), P['wood-700'], ow=1.3)
    c.part(blob(16, 19, 10, 10, wob=.4, seed=9), P['wood-300'])
    c.part(blob(16, 20, 6, 6), P['sky-500'], ow=1.2)
    c.shine(14, 17, 1.4, 2, 200)


def _tool(c, head_col, kind):
    c.line([(9, 27), (21, 7)], INK, 5.4); c.line([(9, 27), (21, 7)], P['wood-400'], 3)
    if kind == 'axe':
        c.part(jitter([(17, 5), (26, 4), (28, 12), (22, 15), (19, 11)], .3, 10), head_col)
    else:
        c.part(jitter([(8, 7), (16, 3), (28, 7), (27, 9.5), (16, 6.6), (9, 10)], .2, 11), head_col)
    c.line([(18, 10), (21, 12)], INK, 1.5)


def _campfire(c):
    from .icons import SPRITES_icon_campfire
    SPRITES_icon_campfire(c)


def _workbench(c):
    c.part(rrect(3, 11, 29, 17, 2, wob=.3, seed=65), P['wood-400'])
    c.part(rrect(5, 17, 9, 29, 1.2), P['wood-600'], ow=1.4); c.part(rrect(23, 17, 27, 29, 1.2), P['wood-600'], ow=1.4)
    c.part(rrect(16, 5, 24, 11, 1.5), P['slate-300'], ow=1.4)


def _acorn(c):
    c.part(blob(16, 19, 9, 10, wob=.3, seed=12), P['sun-500'])
    c.part(rrect(6, 7, 26, 15, 5, wob=.4, seed=13), P['sun-700'])
    c.part(rrect(15, 2.5, 17.5, 8, 1), P['wood-700'], ow=1.1)
    c.part(star(23, 22, 3.2, 1.2, 4, rot=0), P['parchment-50'], ow=0.9, shade=False)


def _hat(c):
    c.part(blob(16, 21, 14, 5.5, wob=.4, seed=14), P['sun-300'])
    c.part(rrect(9, 9, 23, 21, 6, wob=.3, seed=15), P['sun-500'])
    c.part(rrect(9, 16, 23, 19.5, 1), P['berry-500'], ow=1.1)


def _sweater(c):
    c.part([(9, 5), (13, 5), (16, 8), (19, 5), (23, 5), (29, 12), (25, 16), (23, 14), (23, 28), (9, 28), (9, 14), (7, 16), (3, 12)], P['plum-500'])
    for y in (18, 23):
        c.line([(10, y), (22, y)], alpha(P['parchment-50'], 200), 1.2)


def _boots(c):
    c.part([(5, 6), (13, 6), (13, 18), (21, 21), (21, 27), (5, 27)], P['wood-500'])
    c.part(rrect(5, 24, 21.5, 28, 1.5), P['wood-700'], ow=1.2)


def _meat(c):
    c.part(rrect(16, 16, 23, 28, 3), P['parchment-50'])
    c.part(blob(13, 13, 10, 9, wob=.6, seed=16, rot=-.5), P['pumpkin-700'])
    c.shine(9.5, 10, 2.6, 1.6, 170)


def _torch(c):
    c.line([(12, 29), (19, 13)], INK, 5); c.line([(12, 29), (19, 13)], P['wood-400'], 2.8)
    c.part(jitter([(20, 2), (26, 10), (24, 16), (17, 16), (15, 10)], .4, 17), P['pumpkin-500'])
    c.part([(20, 7), (23, 12), (19, 14), (17.5, 11)], P['sun-500'], ow=1)


DRAW = {'wood': _log, 'stone': _stone, 'fiber': _fiber, 'flint': _flint, 'iron_ore': _ore, 'iron_ingot': _ingot, 'berries': _berries,
        'water_flask': _flask, 'stone_axe': lambda c: _tool(c, P['slate-300'], 'axe'), 'stone_pickaxe': lambda c: _tool(c, P['slate-300'], 'pick'),
        'iron_axe': lambda c: _tool(c, P['sky-300'], 'axe'), 'iron_pickaxe': lambda c: _tool(c, P['sky-300'], 'pick'), 'campfire_kit': _campfire,
        'workbench_kit': _workbench, 'golden_acorn': _acorn, 'straw_hat': _hat, 'wool_sweater': _sweater, 'leather_boots': _boots, 'cooked_meat': _meat, 'torch': _torch}


# ------------------------------------------------------------------ game-like background
def find_scene():
    for f in sorted(glob.glob(f'{ASSETS}/preview/*.png')):
        n = os.path.basename(f)
        if 'scene' in n or 'mock' in n:
            im = Image.open(f)
            if im.size[0] >= 1200 and im.size[1] >= 680 and 'ui' not in n:
                return im.convert('RGBA').resize((1280, 720), Image.LANCZOS) if im.size != (1280, 720) else im.convert('RGBA')
    return None


def _tree(c, x, y, s, seed):
    r = random.Random(seed)
    c.part(rrect(x - 4 * s, y - 26 * s, x + 4 * s, y, 3 * s, wob=.5, seed=seed), '#8A5A3C')
    for dx, dy, rr, col in ((-10, -36, 13, '#479B55'), (10, -38, 13, '#479B55'), (0, -48, 15, '#72C45C'), (-6, -40, 12, '#72C45C'), (7, -44, 11, '#B4EA80')):
        c.part(blob(x + dx * s, y + dy * s, rr * s, rr * s * 0.92, wob=1.2, seed=r.randint(0, 999)), col)
    for _ in range(3):
        c.part(blob(x + r.uniform(-12, 12) * s, y + r.uniform(-50, -30) * s, 2 * s, 2 * s), '#E8475F', ow=1)


def _pine(c, x, y, s, seed):
    c.part(rrect(x - 3 * s, y - 12 * s, x + 3 * s, y, 2, seed=seed), '#654130')
    for k, (w, h) in enumerate(((16, 18), (13, 16), (9, 14))):
        yy = y - 10 * s - k * 12 * s
        c.part(jitter([(x - w * s, yy), (x, yy - h * s - 6 * s), (x + w * s, yy)], .6, seed + k), '#4FA37A' if k % 2 == 0 else '#34806A')


def _rock(c, x, y, s, seed):
    c.part(blob(x, y - 6 * s, 12 * s, 8 * s, wob=1.2, seed=seed), '#B8B2B0')


def _bush(c, x, y, s, seed):
    c.part(blob(x, y - 8 * s, 13 * s, 10 * s, wob=1.4, seed=seed), '#64B04C')
    for i in range(4):
        r = random.Random(seed + i)
        c.part(blob(x + r.uniform(-8, 8) * s, y - r.uniform(4, 14) * s, 2.2 * s, 2.2 * s), '#6A8EF0', ow=1)


def _chibi(c, x, y, s, shirt, hair, skin='#FFD2AD', zombie=False):
    c.part(blob(x, y - 2, 9 * s, 3 * s), alpha('#2A1B2E', 70), outline=False, shade=False)
    c.part(rrect(x - 7 * s, y - 20 * s, x + 7 * s, y - 4 * s, 5 * s, wob=.4, seed=1), shirt)
    c.part(rrect(x - 6 * s, y - 6 * s, x - 1 * s, y, 2 * s), '#5A6FB0', ow=1.2)
    c.part(rrect(x + 1 * s, y - 6 * s, x + 6 * s, y, 2 * s), '#5A6FB0', ow=1.2)
    c.part(blob(x, y - 30 * s, 11 * s, 10.5 * s, wob=.5, seed=2), skin)
    c.paint(c.poly_mask(blob(x, y - 36 * s, 11.5 * s, 6 * s, wob=.6, seed=3)), hair)
    if zombie:
        c.ellipse((x - 6 * s, y - 33 * s, x - 1 * s, y - 28 * s), '#FFFAF0'); c.ellipse((x - 4.4 * s, y - 31.5 * s, x - 2.6 * s, y - 29.6 * s), INK)
        c.ellipse((x + 2 * s, y - 32 * s, x + 5 * s, y - 29 * s), INK)
        c.line([(x - 3 * s, y - 24.5 * s), (x + 3 * s, y - 25 * s)], INK, 1)
    else:
        c.face(x, y - 29 * s, 1.1 * s, 'happy')


def game_background(kind='day', seed=7):
    sc = find_scene()
    if sc is not None:
        return sc
    cache = f'/tmp/cozy_ui_bg_{kind}_{seed}.png'
    if os.path.exists(cache):
        return Image.open(cache).convert('RGBA')
    img = _game_background(kind, seed)
    img.save(cache)
    return img


def _game_background(kind='day', seed=7):
    W, H = 1280, 720
    r = random.Random(seed)
    img = Image.new('RGBA', (W, H), hexc('#3F8A47'))
    d = ImageDraw.Draw(img)
    TW, TH = 64, 32
    grass = ['#8FD15C', '#86CB57', '#94D561', '#8ACE5A']
    cx0, cy0 = W // 2, -300
    tiles = []
    for ty in range(-2, 46):
        for tx in range(-2, 46):
            sx = cx0 + (tx - ty) * TW // 2; sy = cy0 + (tx + ty) * TH // 2
            if -TW < sx < W + TW and -TH < sy < H + TH:
                tiles.append((tx, ty, sx, sy))
    for tx, ty, sx, sy in tiles:
        river = abs((tx - ty) * 0.5 + math.sin(ty * 0.35) * 1.6 + 9) < 1.4
        path = abs((tx + ty) - 34 + math.sin(tx * 0.4) * 1.2) < 0.9 and not river
        col = '#5CC6DC' if river else ('#DCA878' if path else grass[(tx * 7 + ty * 13) % 4])
        poly = [(sx, sy), (sx + TW // 2, sy + TH // 2), (sx, sy + TH), (sx - TW // 2, sy + TH // 2)]
        d.polygon(poly, fill=hexc(col))
        if not river and not path and r.random() < 0.18:
            fx, fy = sx + r.randint(-14, 14), sy + TH // 2 + r.randint(-6, 6)
            d.ellipse((fx - 1.5, fy - 1.5, fx + 1.5, fy + 1.5), fill=hexc(r.choice(['#FF9EC4', '#FFD75E', '#FFFAF0', '#93C6FF'])))
        if river and r.random() < 0.25:
            d.line((sx - 10, sy + 16, sx + 6, sy + 16), fill=hexc('#BDF2F0'), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    c = Ink(W, H, 1, ow=1.2)
    c.img = img
    c.S = 1
    # Ink canvases at S=1 are fine for a background.
    objs = []
    for i in range(70):
        x, y = r.uniform(0, W), r.uniform(40, H + 40)
        objs.append((y, r.choice(['tree', 'tree', 'pine', 'rock', 'bush']), x, i))
    objs += [(420, 'camp', 640, 0), (440, 'player', 680, 0), (470, 'friend', 590, 0), (360, 'zombie', 880, 0), (560, 'zombie2', 360, 0)]
    def local(fn, x, y, *a, size=(160, 150), foot=130):
        lc = Ink(size[0], size[1], 1, ow=1.2)
        fn(lc, size[0] / 2, foot, *a)
        c.img.alpha_composite(lc.out(), (int(x - size[0] / 2), int(y - foot)))
    for y, kind_, x, i in sorted(objs):
        if kind_ in ('tree', 'pine', 'rock', 'bush') and 470 < x < 830 and 300 < y < 520:
            continue
        if kind_ == 'tree': local(_tree, x, y, 1.2, i)
        elif kind_ == 'pine': local(_pine, x, y, 1.2, i)
        elif kind_ == 'rock': local(_rock, x, y, 1.1, i, size=(60, 40), foot=30)
        elif kind_ == 'bush': local(_bush, x, y, 1.0, i, size=(60, 50), foot=40)
        elif kind_ == 'camp':
            glow = Image.new('L', (W, H), 0); ImageDraw.Draw(glow).ellipse((x - 120, y - 70, x + 120, y + 50), fill=110)
            c.paint(glow.filter(ImageFilter.GaussianBlur(30)), '#FFD04A')
            def camp(lc, x, y):
                for a, b in (((x - 16, y), (x + 16, y - 8)), ((x - 16, y - 8), (x + 16, y))):
                    lc.line([a, b], INK, 7); lc.line([a, b], '#A2633A', 4)
                lc.part(jitter([(x, y - 34), (x + 11, y - 16), (x + 9, y - 6), (x - 9, y - 6), (x - 11, y - 16), (x - 4, y - 22)], 1, 3), '#FF8A2A')
                lc.part([(x, y - 22), (x + 6, y - 12), (x + 4, y - 7), (x - 4, y - 7), (x - 6, y - 12)], '#FFD04A')
            local(camp, x, y, size=(60, 60), foot=50)
        elif kind_ == 'player': local(_chibi, x, y, 1.15, '#E85D4F', '#8A5232', size=(60, 70), foot=62)
        elif kind_ == 'friend': local(_chibi, x, y, 1.15, '#4F8FD6', '#F48FB1', '#D9975F', size=(60, 70), foot=62)
        elif kind_ == 'zombie': local(_chibi, x, y, 1.15, '#9B72D6', '#3F8676', '#94DCA8', True, size=(60, 70), foot=62)
        elif kind_ == 'zombie2': local(_chibi, x, y, 1.1, '#5A6FB0', '#65539E', '#BBA4F0', True, size=(60, 70), foot=62)
    img = c.img
    if kind == 'dusk':
        tint = Image.new('RGBA', (W, H), (255, 140, 90, 60)); img.alpha_composite(tint)
        tint = Image.new('RGBA', (W, H), (60, 36, 90, 50)); img.alpha_composite(tint)
    # vignette
    v = Image.new('L', (W, H), 0); ImageDraw.Draw(v).ellipse((-200, -160, W + 200, H + 160), fill=255)
    v = ImageChops.invert(v.filter(ImageFilter.GaussianBlur(120)))
    dark = Image.new('RGBA', (W, H), (42, 27, 46, 255)); dark.putalpha(v.point(lambda p: int(p * 0.55)))
    img.alpha_composite(dark)
    return img


def map_texture(w, h, seed=3):
    """Parchment world map painting for map/minimap previews."""
    r = random.Random(seed)
    img = Image.new('RGBA', (w, h), hexc('#5CB8D8'))
    land = Image.new('L', (w, h), 0); d = ImageDraw.Draw(land)
    for _ in range(26):
        x, y = r.uniform(0.15, 0.85) * w, r.uniform(0.15, 0.85) * h; rr = r.uniform(0.06, 0.16) * min(w, h) * 1.6
        d.ellipse((x - rr, y - rr * 0.8, x + rr, y + rr * 0.8), fill=255)
    land = land.filter(ImageFilter.GaussianBlur(min(w, h) * 0.02)).point(lambda v: 255 if v > 128 else 0)
    coast = land.filter(ImageFilter.MaxFilter(9))
    img.paste(hexc('#BDF2F0'), (0, 0), coast)
    img.paste(hexc('#F6DFA4'), (0, 0), land.filter(ImageFilter.MaxFilter(3)))
    inner = land.filter(ImageFilter.MinFilter(9))
    img.paste(hexc('#8FD15C'), (0, 0), inner)
    forest = Image.new('L', (w, h), 0); fd = ImageDraw.Draw(forest)
    for _ in range(14):
        x, y = r.uniform(0.2, 0.8) * w, r.uniform(0.2, 0.8) * h; rr = r.uniform(0.04, 0.1) * min(w, h)
        fd.ellipse((x - rr, y - rr, x + rr, y + rr), fill=255)
    forest = ImageChops.multiply(forest.filter(ImageFilter.GaussianBlur(6)).point(lambda v: 255 if v > 128 else 0), inner.filter(ImageFilter.MinFilter(5)))
    img.paste(hexc('#479B55'), (0, 0), forest)
    dd = ImageDraw.Draw(img)
    for _ in range(int(w * h / 900)):
        x, y = r.uniform(0, w), r.uniform(0, h)
        if forest.getpixel((int(x) % w, int(y) % h)) > 0:
            dd.polygon([(x, y - 4), (x + 3, y + 2), (x - 3, y + 2)], fill=hexc('#2D7050'))
    # paper tone
    paper = Image.new('RGBA', (w, h), hexc('#F6EAD2', 70)); img.alpha_composite(paper)
    return img
