#!/usr/bin/env python3
"""Render ui/preview/*.png by interpreting ui/screens/*.json against screens/mock/state.json.
This is a reference implementation of the layout + binding model (UI_GUIDE.md §9) - the runtime should match it."""
import copy, json, math, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
sys.path.insert(0, os.path.dirname(__file__))
from uikit.expr import value as V, truthy
from uikit.nine import nine
from uikit import kit
from uikit.draw import hexc, lighten, darken, alpha, mix
from uikit import placeholders as PH

UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
THEME = json.load(open(os.path.join(UI, 'theme.json')))
ATLAS = json.load(open(os.path.join(UI, 'atlas', 'ui_atlas.json')))
ATLAS_IMG = Image.open(os.path.join(UI, 'atlas', 'ui_atlas.png')).convert('RGBA')
ATLAS2 = json.load(open(os.path.join(UI, 'atlas', 'ui_atlas@2x.json')))
ATLAS2_IMG = Image.open(os.path.join(UI, 'atlas', 'ui_atlas@2x.png')).convert('RGBA')
PAL = THEME['palette']
STATE = json.load(open(os.path.join(UI, 'screens', 'mock', 'state.json')))
SCREENS = os.path.join(UI, 'screens')
_frames = {}


def frame(name, scale=1):
    k = (name, scale)
    if k not in _frames:
        A, I = (ATLAS, ATLAS_IMG) if scale == 1 else (ATLAS2, ATLAS2_IMG)
        f = A['frames'][name]['frame']
        _frames[k] = I.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
    return _frames[k]


def insets(name):
    n = ATLAS['frames'][name].get('nineSlice')
    return (n['l'], n['t'], n['r'], n['b']) if n else None


def color(c, default=None):
    if c is None: return default
    if isinstance(c, (tuple, list)): return tuple(c)
    if c.startswith('#'): return hexc(c)
    if c in PAL: return hexc(PAL[c])
    if c.startswith('text.'): return hexc(THEME['color']['text'][c[5:]])
    if c.startswith('food.'):
        st = next((s for s in THEME['food']['stages'] if s['key'] == c[5:]), None); return hexc(st['color']) if st else default
    if c.startswith('rarity.'):
        r = THEME['rarity'].get(c[7:]); return hexc(darken(r['color'], 0.25) if False else r['color']) if r else default
    return default


# ---------------------------------------------------------------- fonts / text
_fonts = {}


def font(style):
    st = THEME['font']['styles'][style] if isinstance(style, str) else style
    fam = THEME['font']['family'][st['family']]
    k = (fam['file'], st['size'], st['weight'])
    if k not in _fonts:
        f = ImageFont.truetype(os.path.join(UI, fam['file']), st['size'])
        try:
            axes = f.get_variation_axes()
            vals = []
            for a in axes:
                n = a['name'] if isinstance(a['name'], str) else a['name'].decode()
                vals.append(st['weight'] if n.lower().startswith('weight') else a['default'] if not n.lower().startswith('width') else 100)
            f.set_variation_by_axes(vals)
        except Exception:
            pass
        _fonts[k] = f
    return _fonts[k], st


def text_size(s, style):
    f, st = font(style)
    if s is None or s == '': return 0, st['size']
    s = str(s)
    b = f.getbbox(s, stroke_width=int(st.get('stroke', {}).get('width', 0)))
    return b[2] - b[0], int(st['size'] * 1.25)


def wrap(s, style, w):
    words = str(s).split(); lines = []; cur = ''
    for wd in words:
        t = (cur + ' ' + wd).strip()
        if text_size(t, style)[0] <= w or not cur: cur = t
        else: lines.append(cur); cur = wd
    if cur: lines.append(cur)
    return lines


def draw_text(img, s, style, rect, align='left', col=None, valign='center', wrap_=False):
    if s is None or s == '': return
    s = str(s)
    f, st = font(style)
    x, y, w, h = rect
    c0 = st.get('color', PAL['ink']); fill = col or (hexc(c0) if isinstance(c0, str) else tuple(c0))
    sw = st.get('stroke', {}).get('width', 0); sc = hexc(st.get('stroke', {}).get('color', PAL['ink'])) if sw else None
    lines = wrap(s, style, w) if wrap_ else [s]
    lh = int(st['size'] * 1.22)
    total = lh * len(lines)
    ty = y + (h - total) / 2 if valign == 'center' else y
    d = ImageDraw.Draw(img)
    shadow = st.get('shadow')
    for ln in lines:
        tw = text_size(ln, style)[0]
        tx = x if align == 'left' else (x + (w - tw) / 2 if align == 'center' else x + w - tw)
        oy = ty + (lh - st['size']) / 2 - st['size'] * 0.12
        if shadow:
            sh = THEME['shadow'][shadow]
            d.text((tx + sh['x'], oy + sh['y']), ln, font=f, fill=hexc(sh['color'][:7]), stroke_width=int(round(sw)), stroke_fill=hexc(sh['color'][:7]))
        d.text((tx, oy), ln, font=f, fill=fill, stroke_width=int(round(sw)), stroke_fill=sc)
        ty += lh


def paste(img, im, x, y):
    img.alpha_composite(im, (int(round(x)), int(round(y))))


def paste_nine(img, name, x, y, w, h):
    ins = insets(name)
    fr = frame(name)
    if ins: im = nine(fr, ins, int(round(w)), int(round(h)))
    else: im = fr.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS) if fr.size != (int(w), int(h)) else fr
    paste(img, im, x, y)


def icon_img(name, size):
    if not name: return None
    if name.startswith('item_'):
        return PH.item_icon(name[5:], size)
    if name not in ATLAS['frames']:
        return None
    s = kit.SPRITES[name]
    if (s['w'], s['h']) == (size, size): return frame(name)
    src = frame(name, 2 if size > s['w'] else 1)
    return src.resize((size, int(size * s['h'] / s['w'])), Image.LANCZOS)


# ---------------------------------------------------------------- layout
ANCH = {'t': 0, 'l': 0, 'c': 0.5, 'b': 1, 'r': 1}


def num(v, avail, scope):
    v = V(v, scope) if isinstance(v, str) and '{' in v else v
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, str) and v.endswith('%'): return avail * float(v[:-1]) / 100
    return None


def pad4(p):
    if p is None: return (0, 0, 0, 0)
    if isinstance(p, (int, float)): return (p, p, p, p)
    if len(p) == 2: return (p[0], p[1], p[0], p[1])
    return tuple(p)


class Node:
    def __init__(self, d, scope):
        self.d = d; self.scope = scope; self.kids = None; self.rect = (0, 0, 0, 0)

    def get(self, k, default=None):
        v = self.d.get(k, default)
        return V(v, self.scope) if isinstance(v, str) else v


def load_partial(src):
    path, _, variant = src.partition('#')
    d = json.load(open(os.path.join(SCREENS, path)))
    if variant: return d['variants'][variant], {}
    return d['root'], d.get('params', {})


def expand(node):
    """Return the child Nodes (expanding include/repeat)."""
    if node.kids is not None: return node.kids
    out = []
    for c in node.d.get('children', []):
        out.extend(instantiate(c, node.scope))
    node.kids = out
    return out


def instantiate(d, scope):
    if d['type'] == 'include':
        root, defaults = load_partial(d['src'])
        root = copy.deepcopy(root)
        for k in ('anchor', 'x', 'y', 'visible', 'worldAnchor', 'id'):
            if k in d: root[k] = d[k]
        params = dict(defaults); params.update(d.get('params', {}))
        ps = {f'${k}': V(v, scope) for k, v in params.items()}
        return instantiate(root, [ps] + scope)
    if 'visible' in d and not truthy(V(d['visible'], scope)):
        return []
    if d['type'] == 'repeat':
        items = V(d['each'], scope) or []
        n = Node(dict(d, type='box', children=[]), scope)
        kids = []
        for i, it in enumerate(items[: d.get('limit', 999)]):
            sc = [{d.get('as', 'item'): it, '$index': i}] + scope
            kids.extend(instantiate(d['template'], sc))
        n.kids = kids
        return [n]
    return [Node(d, scope)]


def intrinsic(n):
    t = n.d['type']
    if t == 'text':
        s = n.get('text', '')
        style = n.d.get('font', 'body')
        if n.d.get('wrap'):
            return None
        return text_size(s, style)
    if t == 'keyhint':
        kw = max(28, text_size(str(n.get('key')), 'label')[0] + 18)
        lw = text_size(n.get('label') or '', 'hudSmall')[0]
        return (kw + (10 + lw + 12 if lw else 0), 30)
    if t == 'icon': return (32, 32)
    return None


def measure(n, aw, ah):
    w = num(n.d.get('w'), aw, n.scope); h = num(n.d.get('h'), ah, n.scope)
    if n.d.get('w') == 'fill': w = aw
    if n.d.get('h') == 'fill': h = ah
    if w is not None and h is not None: return w, h
    ins = intrinsic(n)
    if ins:
        return (w if w is not None else ins[0]), (h if h is not None else ins[1])
    if n.d['type'] == 'text' and n.d.get('wrap'):
        lines = wrap(n.get('text', ''), n.d.get('font', 'body'), w or aw)
        return (w or aw), (h if h is not None else len(lines) * int(font(n.d.get('font', 'body'))[1]['size'] * 1.22))
    # content-sized container
    pt, pr, pb, pl = pad4(n.d.get('pad'))
    lay = n.d.get('layout', 'abs'); gap = n.d.get('gap', 0)
    kids = expand(n)
    cw = (w if w is not None else aw) - pl - pr
    sizes = [measure(k, cw, ah) if k.d.get('w') != 'fill' and k.d.get('h') != 'fill' else measure(k, cw, 0) for k in kids]
    if lay == 'col':
        ch = sum(s[1] for s in sizes) + gap * max(0, len(kids) - 1); cwm = max([s[0] for s in sizes] or [0])
    elif lay == 'row':
        cwm = sum(s[0] for s in sizes) + gap * max(0, len(kids) - 1); ch = max([s[1] for s in sizes] or [0])
    elif lay == 'grid':
        cols = n.d.get('cols', 1); cell = n.d.get('cell', [48, 48]); rows = math.ceil(len(kids) / cols)
        cwm = cols * cell[0] + (cols - 1) * gap; ch = rows * cell[1] + max(0, rows - 1) * gap
    else:
        cwm = max([s[0] for s in sizes] or [0]); ch = max([s[1] for s in sizes] or [0])
    return (w if w is not None else cwm + pl + pr), (h if h is not None else ch + pt + pb)


def place(n, x, y, w, h):
    n.rect = (x, y, w, h)
    pt, pr, pb, pl = pad4(n.d.get('pad'))
    if n.d['type'] == 'list': pr += 22  # scrollbar gutter
    cx, cy, cw, ch = x + pl, y + pt, w - pl - pr, h - pt - pb
    kids = expand(n)
    lay = n.d.get('layout', 'abs'); gap = n.d.get('gap', 0)
    align = n.d.get('align', 'start'); justify = n.d.get('justify', 'start')
    if lay in ('row', 'col'):
        main = 0 if lay == 'row' else 1
        avail_main = cw if main == 0 else ch
        fixed = []; nfill = 0
        for k in kids:
            key = 'w' if main == 0 else 'h'
            if k.d.get(key) == 'fill': fixed.append(None); nfill += 1
            else:
                s = measure(k, cw, ch); fixed.append(s[main])
        used = sum(f for f in fixed if f is not None) + gap * max(0, len(kids) - 1)
        fill_sz = max(0, (avail_main - used) / nfill) if nfill else 0
        sizes_main = [f if f is not None else fill_sz for f in fixed]
        total = sum(sizes_main) + gap * max(0, len(kids) - 1)
        free = avail_main - total
        pos = 0; g = gap
        if nfill == 0:
            if justify == 'center': pos = free / 2
            elif justify == 'end': pos = free
            elif justify == 'between' and len(kids) > 1: g = gap + free / (len(kids) - 1)
        for k, sm in zip(kids, sizes_main):
            cross_avail = ch if main == 0 else cw
            ckey = 'h' if main == 0 else 'w'
            if k.d.get(ckey) == 'fill': sc_ = cross_avail
            else:
                s = measure(k, sm if main == 0 else cw, sm if main == 1 else ch); sc_ = s[1 - main]
            off = 0 if align == 'start' else ((cross_avail - sc_) / 2 if align == 'center' else cross_avail - sc_)
            if main == 0: place(k, cx + pos, cy + off, sm, sc_)
            else: place(k, cx + off, cy + pos, sc_, sm)
            pos += sm + g
    elif lay == 'grid':
        cols = n.d.get('cols', 1); cell = n.d.get('cell', [48, 48])
        for i, k in enumerate(kids):
            place(k, cx + (i % cols) * (cell[0] + gap), cy + (i // cols) * (cell[1] + gap), cell[0], cell[1])
    else:
        for k in kids:
            kw, kh = measure(k, cw, ch)
            a = k.d.get('anchor', 'tl'); ay, ax = (a[0], a[1]) if len(a) == 2 else ('c', 'c')
            ox = num(k.d.get('x', 0), cw, k.scope) or 0; oy = num(k.d.get('y', 0), ch, k.scope) or 0
            fx = ANCH[ax]; fy = ANCH[ay]
            px = cx + fx * (cw - kw) + (ox if ax != 'r' else -ox)
            py = cy + fy * (ch - kh) + (oy if ay != 'b' else -oy)
            place(k, px, py, kw, kh)


# ---------------------------------------------------------------- widgets
def draw(img, n):
    t = n.d['type']
    fn = WIDGETS.get(t)
    x, y, w, h = n.rect
    if fn: fn(img, n, x, y, w, h)
    if t == 'list':  # clip children to the viewport
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        for k in expand(n):
            draw(layer, k)
        m = Image.new('L', img.size, 0); ImageDraw.Draw(m).rectangle((x, y, x + w - 1, y + h - 1), fill=255)
        layer.putalpha(ImageChops.multiply(layer.getchannel('A'), m))
        img.alpha_composite(layer)
    else:
        for k in expand(n):
            draw(img, k)
    post = POST.get(t)
    if post: post(img, n, x, y, w, h)


def w_panel(img, n, x, y, w, h):
    paste_nine(img, n.get('frame', 'panel_parchment'), x, y, w, h)


def w_text(img, n, x, y, w, h):
    style = n.d.get('font', 'body')
    col = color(n.get('color'))
    draw_text(img, n.get('text'), style, (x, y, w, h), n.d.get('align', 'left'), col, wrap_=n.d.get('wrap', False), valign='top' if n.d.get('wrap') else 'center')


def w_icon(img, n, x, y, w, h):
    name = n.get('icon')
    if n.d.get('lowWhen') and truthy(n.get('lowWhen')): name = n.d.get('iconLow', name)
    if n.d.get('bindTemp'):
        tv = n.get('bindTemp') or 37
        name = 'vital_cold' if tv < 36 else ('vital_hot' if tv > 38 else name)
    im = icon_img(name, int(w))
    if im is not None:
        tint = n.get('tint')
        if tint and name == 'ic_signal':
            im = im.copy()
        paste(img, im, x, y + (h - im.size[1]) / 2)


def w_button(img, n, x, y, w, h):
    var = n.get('variant', 'primary')
    dis = truthy(n.get('disabled')) if 'disabled' in n.d else False
    if var == 'close':
        paste(img, icon_img('btn_close_normal', int(w)), x, y); return
    st = n.d.get('_state', 'normal')
    name = 'btn_disabled' if dis else f'btn_{var}_{st}'
    paste_nine(img, name, x, y, w, h)
    label = n.get('label'); ic = n.get('icon')
    inner_h = h - 4
    isz = 24 if h >= 40 else 20
    lw = text_size(label, 'button')[0] if label else 0
    total = (isz if ic else 0) + (8 if ic and label else 0) + lw
    sx = x + (w - total) / 2
    if ic:
        im = icon_img(ic, isz)
        if im: paste(img, im, sx, y + (inner_h - isz) / 2)
        sx += isz + 8
    if label:
        draw_text(img, label, 'button', (sx, y - 1, lw + 4, inner_h), 'left', hexc(PAL['slate-700']) if dis else None)


def item_of(b):
    if isinstance(b, dict):
        return b.get('item') if 'item' in b or 'index' in b else b
    return None


def w_slot(img, n, x, y, w, h):
    b = n.get('bind')
    it = item_of(b) if b is not None else None
    state = b.get('state') if isinstance(b, dict) and 'index' in b else None
    rar = it.get('rarity') if it else None
    name = 'slot_empty'
    if it and rar and rar != 'common': name = f'slot_{rar}'
    if state == 'hover': name = 'slot_hover'
    if state == 'selected': name = 'slot_selected'
    if truthy(n.get('missing')): name = 'slot_locked'
    paste_nine(img, name, x, y, w, h)
    if it:
        isz = 64 if min(w, h) >= 62 else (32 if min(w, h) >= 44 else int(min(w, h) * 0.75))
        stage = n.get('foodStage') or ((it.get('food') or {}).get('stage'))
        im = food_icon(it['key'], stage, isz) if stage else None
        if im is None: im = PH.item_icon(it['key'], isz)
        paste(img, im, x + (w - isz) / 2, y + (h - isz) / 2 - 1)
        if stage:
            b = food_badge(stage, 2 if min(w, h) >= 62 else 1)
            if b: paste(img, b, x + w - b.width - 3, y + 3)
        ct = n.get('countText')
        cnt = it.get('count', 1)
        if ct: draw_text(img, ct, 'count', (x, y + h - 22, w - 5, 18), 'right', hexc(PAL['berry-300']) if truthy(n.get('missing')) else None)
        elif n.d.get('showCount', True) and cnt and cnt > 1:
            draw_text(img, str(cnt), 'count', (x, y + h - 22, w - 6, 18), 'right')
        if it.get('durability') is not None:
            d = ImageDraw.Draw(img); bw = w - 16
            d.rounded_rectangle((x + 8, y + h - 9, x + 8 + bw, y + h - 5), 2, fill=hexc(PAL['ink']))
            d.rounded_rectangle((x + 9, y + h - 8, x + 9 + (bw - 2) * it['durability'], y + h - 6), 1, fill=hexc(PAL['leaf-500']))
    elif n.d.get('placeholderIcon'):
        im = icon_img(n.d['placeholderIcon'], 32)
        paste(img, im, x + (w - 32) / 2, y + (h - 32) / 2)
    hk = n.get('hotkey')
    if hk:
        draw_text(img, str(hk), 'hudSmall', (x + 6, y + 3, 16, 16), 'left')


_FOOD = None


def _food_atlas():
    global _FOOD
    if _FOOD is None:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', THEME['food']['atlas'])
        try: _FOOD = (json.load(open(p)), Image.open(p.replace('.json', '.png')).convert('RGBA'))
        except Exception: _FOOD = ({'frames': {}}, None)
    return _FOOD


def _food_frame(key):
    d, im = _food_atlas(); f = d['frames'].get(key)
    if not f or im is None: return None
    f = f['frame']; return im.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))


def food_icon(key, stage, size):
    im = _food_frame(f'food_{key}/{stage}/0')
    if im is None: return None
    return im if size == im.width else im.resize((size, size), Image.NEAREST if size % im.width == 0 else Image.LANCZOS)


def food_badge(stage, scale=1):
    im = _food_frame(f'food_badge_{stage}/idle/0')
    if im is None: return None
    im = im.crop(im.getbbox()); return im if scale == 1 else im.resize((im.width * scale, im.height * scale), Image.NEAREST)


def w_foodbadge(img, n, x, y, w, h):
    b = food_badge(n.get('stage') or 'fresh')
    if b: paste(img, b, x + (w - b.width) / 2, y + (h - b.height) / 2)


def member_pins(img, d, n, cx, cy, sc):
    for m in n.get('memberPins') or []:
        px, py = cx + m['x'] * sc, cy + m['y'] * sc
        col = THEME['groups']['marker'][m.get('kind', 'party')]['tint']
        d.polygon([(px, py + 9), (px - 7, py - 2), (px, py - 10), (px + 7, py - 2)], fill=hexc(PAL['ink']))
        d.polygon([(px, py + 6), (px - 5, py - 2), (px, py - 7), (px + 5, py - 2)], fill=hexc(col))
        if m.get('hp', 255) != 255:
            d.rectangle((px - 8, py + 11, px + 8, py + 14), fill=hexc(PAL['ink'])); d.rectangle((px - 7, py + 12, px - 7 + 14 * m['hp'] / 100, py + 13), fill=hexc(PAL['red-500']))


def bar_fill_img(vital, w, h):
    name = f'bar_fill_{vital}' if f'bar_fill_{vital}' in ATLAS['frames'] else 'bar_fill_stamina'
    return nine(frame(name), insets(name), max(15, int(w)), int(h))


def w_bar(img, n, x, y, w, h):
    vital = n.d.get('vital', 'health'); style = n.d.get('style')
    if style: vital = style
    val = float(n.get('value') or 0); mx = float(n.get('max') or 1); mn = float(n.d.get('min', 0))
    frac = max(0.0, min(1.0, (val - mn) / (mx - mn) if mx > mn else 0))
    paste_nine(img, 'bar_track', x, y, w, h)
    inset = 3 if h >= 16 else 2
    fw, fh = w - 2 * inset, h - 2 * inset
    if vital == 'temperature':
        f = bar_fill_img('temperature', fw, fh); paste(img, f, x + inset, y + inset)
        mk = frame('bar_marker')
        mh = int(h + 8); mk = mk.resize((int(16 * mh / 28), mh), Image.LANCZOS)
        paste(img, mk, x + inset + fw * frac - mk.size[0] / 2, y - 4)
        return
    if frac > 0:
        f = bar_fill_img(vital, fw, fh)
        cw = max(1, int(round(fw * frac)))
        paste(img, f.crop((0, 0, cw, f.size[1])), x + inset, y + inset)  # clip, don't squash
        if 0 < cw < fw:
            d = ImageDraw.Draw(img); d.line((x + inset + cw, y + inset + 1, x + inset + cw, y + inset + fh - 2), fill=hexc(PAL['ink'], 150), width=1)
    if h >= 16 and not n.d.get('thin'):
        paste_nine(img, 'bar_shine', x, y, w, h)
    if n.d.get('showText') or n.d.get('label'):
        draw_text(img, n.d.get('label') or f'{int(val)}/{int(mx)}', 'hudSmall', (x, y, w, h), 'center')


def w_ribbon(img, n, x, y, w, h):
    paste_nine(img, 'ribbon_title', x, y, w, h)
    draw_text(img, n.get('text'), 'title' if h >= 40 else 'button', (x, y - 4, w, h - 6), 'center')


def w_tabs(img, n, x, y, w, h):
    items = n.d.get('items', []); active = n.get('bind')
    small = n.d.get('small')
    tw = min(140, (w - 4 * (len(items) - 1)) / max(1, len(items)))
    for i, it in enumerate(items):
        tx = x + i * (tw + 4)
        st = 'active' if it['id'] == active else 'normal'
        paste_nine(img, f'tab_{st}', tx, y + (0 if st == 'active' else 4), tw, h + (6 if st == 'active' else 0) - (0 if st == 'active' else 4))
        ic = it.get('icon'); lbl = it['label']
        lw = text_size(lbl, 'label')[0]; tot = lw + (30 if ic else 0)
        sx = tx + (tw - tot) / 2
        if ic:
            paste(img, icon_img(ic, 24), sx, y + (h - 24) / 2 + 1); sx += 30
        draw_text(img, lbl, 'label', (sx, y + 2, lw + 4, h - 2), 'left', None if st == 'active' else hexc(PAL['parchment-100']))


def w_minimap(img, n, x, y, w, h):
    tex = PH.map_texture(int(w * 2), int(h * 2), seed=5).crop((int(w * 0.5), int(h * 0.5), int(w * 1.5), int(h * 1.5)))
    inner = int(w * 140 / 176)
    tex = tex.resize((inner, inner), Image.LANCZOS)
    mask = frame('minimap_mask').resize((inner, inner), Image.LANCZOS).getchannel('A')
    tex.putalpha(mask)
    ox = x + (w - inner) / 2; oy = y + (h - inner) / 2
    paste(img, tex, ox, oy)
    d = ImageDraw.Draw(img)
    for m in n.get('markers') or []:
        mx_, my_ = ox + inner / 2 + m['x'] * 1.6, oy + inner / 2 + m['y'] * 1.6
        if m['kind'] == 'camp': paste(img, icon_img('ic_home', 20), mx_ - 10, my_ - 10)
        elif m['kind'] in ('friend', 'member'):
            d.ellipse((mx_ - 6, my_ - 6, mx_ + 6, my_ + 6), fill=hexc(PAL['ink'])); d.ellipse((mx_ - 4, my_ - 4, mx_ + 4, my_ + 4), fill=hexc(m.get('color', PAL['sky-500'])))
    # out-of-view party/clan members (groups.markers), clamped to the ring edge
    pins = []
    for m in n.get('memberPins') or []:
        vx, vy = (m['x'] - 16) * 1.6, (m['y'] - 16) * 1.6; ln = (vx * vx + vy * vy) ** 0.5; rmax = inner / 2 - 10
        if ln > rmax: vx, vy = vx / ln * rmax, vy / ln * rmax
        pins.append(dict(m, x=vx, y=vy))
    member_pins(img, d, type('N', (), {'get': lambda self, k: pins})(), ox + inner / 2, oy + inner / 2, 1)
    paste(img, frame('minimap_player'), ox + inner / 2 - 12, oy + inner / 2 - 12)
    paste(img, frame('minimap_frame').resize((int(w), int(h)), Image.LANCZOS) if w != 176 else frame('minimap_frame'), x, y)


def w_badge(img, n, x, y, w, h):
    col = color(n.get('color'), hexc(PAL['plum-500']))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x, y, x + w, y + h), h / 2, fill=hexc(PAL['ink']))
    d.rounded_rectangle((x + 2, y + 2, x + w - 2, y + h - 2), h / 2 - 2, fill=col)
    d.rounded_rectangle((x + 6, y + 3, x + w - 6, y + h / 2 - 1), 3, fill=lighten(col, 0.25))
    ic = n.get('icon'); sx = x
    if ic:
        paste(img, icon_img(ic, int(h - 4)), x + 4, y + 2); sx = x + h - 2
    draw_text(img, n.get('text'), 'hudSmall', (sx, y, w - (sx - x), h), 'center')


def w_status(img, n, x, y, w, h):
    tone = n.get('tone')
    paste_nine(img, 'slot_uncommon' if tone == 'good' else ('slot_empty' if tone != 'bad' else 'slot_locked'), x, y, w, h)
    if tone == 'bad':
        d = ImageDraw.Draw(img)
    im = icon_img(n.get('icon'), int(w * 0.75))
    if im: paste(img, im, x + (w - im.size[0]) / 2, y + (h - im.size[1]) / 2)
    rem = n.get('remaining')
    if rem:
        draw_text(img, f'{int(rem)}s', 'hudSmall', (x, y + h - 14, w - 2, 16), 'right')


def w_keyhint(img, n, x, y, w, h):
    key = str(n.get('key')); kw = max(28, text_size(key, 'label')[0] + 18)
    paste_nine(img, 'keycap', x, y + (h - 30) / 2, kw, 30)
    if key in ('LMB', 'RMB'):
        paste(img, icon_img('ic_mouse_left' if key == 'LMB' else 'ic_mouse_right', 24), x + (kw - 24) / 2, y + (h - 30) / 2 + 1)
    else:
        draw_text(img, key, 'label', (x, y + (h - 30) / 2 - 1, kw, 27), 'center')
    lbl = n.get('label')
    if lbl: draw_text(img, lbl, 'hudSmall', (x + kw + 8, y, w - kw - 8, h), 'left')


def w_toast(img, n, x, y, w, h):
    paste_nine(img, f"toast_{n.get('kind', 'info')}", x, y, w, h)
    im = icon_img(n.get('icon'), 28)
    if im: paste(img, im, x + 5, y + (h - 2 - 28) / 2)
    draw_text(img, n.get('title'), 'label', (x + 46, y + 7, w - 54, 20), 'left')
    draw_text(img, n.get('text'), 'small', (x + 46, y + 27, w - 54, 18), 'left')


def player_color(pid):
    cols = THEME['chat']['playerNameColors']
    try: return cols[int(pid) % len(cols)]
    except (TypeError, ValueError): return pid if isinstance(pid, str) and pid.startswith('#') else cols[0]


def w_chatline(img, n, x, y, w, h):
    chan = n.get('channel'); kind = n.get('kind'); frm = n.get('from'); txt = n.get('text') or ''; dark = n.d.get('dark', True)
    if isinstance(chan, (int, float)): chan = THEME['chat']['channelIds'].get(str(int(chan)), 'global')
    chan = chan or 'global'
    if kind == 'warning': chan = 'warning'
    ch = THEME['chat']['channels'].get(chan, THEME['chat']['channels']['global'])
    style = dict(THEME['font']['styles']['chat' if dark else 'body'])
    style['color'] = ch['text'] if dark else ch['textOnLight']
    if truthy(n.get('highlight')):
        d = ImageDraw.Draw(img); d.rounded_rectangle((x - 4, y, x + w, y + h), 6, fill=hexc(PAL['sun-500'], 90 if dark else 120))
    sx = x
    if n.get('time') and not dark:
        draw_text(img, n.get('time'), 'tiny', (sx, y, 40, h), 'left'); sx += 44
    if chan in ('system', 'warning'):
        im = icon_img('ic_info' if chan == 'system' else 'ic_warn', 18)
        paste(img, im, sx, y + (h - 18) / 2); sx += 22
        draw_text(img, txt, style, (sx, y, w - (sx - x), h), 'left')
        return
    if ch.get('prefix'):
        pw = text_size(ch['label'], 'tiny')[0] + 12
        d = ImageDraw.Draw(img); d.rounded_rectangle((sx, y + 3, sx + pw, y + h - 3), 5, fill=hexc(ch['tag']))
        draw_text(img, ch['label'], 'tiny', (sx, y + 1, pw, h - 2), 'center', hexc(PAL['parchment-50'])); sx += pw + 6
    nst = dict(THEME['font']['styles']['hudSmall' if dark else 'label'])
    nc = ch['name'] if chan in ('global', 'local') else ch['name']
    nst['color'] = nc if dark else darken(ch['textOnLight'] if chan not in ('global', 'local') else PAL['ink-soft'], 0.0)
    em = n.get('emote')
    if em:
        verb = THEME['chat']['emotes'].get(str(em), {}).get('verb', '') if isinstance(em, (int, float)) else str(em)
        draw_text(img, f'* {frm} {verb} {txt}'.rstrip(), dict(style, color=ch['name'] if dark else PAL['ink-faint']), (sx, y, w - (sx - x), h), 'left'); return
    fw = text_size(frm + ':', nst)[0]
    draw_text(img, frm + ':', nst, (sx, y, fw + 4, h), 'left')
    draw_text(img, txt, style, (sx + fw + 6, y, w - fw - 6 - (sx - x), h), 'left')


def w_rank(img, n, x, y, w, h):
    rk = n.get('rank') or n.get('role') or 'member'
    if isinstance(rk, (int, float)):
        ro = THEME['groups']['roles'].get(str(int(rk))); rk = ro['key'] if isinstance(ro, dict) else 'member'
    col = {'leader': PAL['sun-500'], 'officer': PAL['plum-500'], 'member': PAL['leaf-500'], 'recruit': PAL['slate-500']}.get(rk, PAL['slate-500'])
    d = ImageDraw.Draw(img); d.rounded_rectangle((x, y, x + w, y + h), h / 2, fill=hexc(PAL['ink'])); d.rounded_rectangle((x + 1.5, y + 1.5, x + w - 1.5, y + h - 1.5), h / 2 - 1.5, fill=hexc(col))
    draw_text(img, rk, 'tiny', (x, y, w, h), 'center', hexc(PAL['ink']))
    if rk == 'leader': paste(img, icon_img('ic_crown', 18), x - 10, y - 4)


def w_banner(img, n, x, y, w, h):
    c = PH.Ink(w, h, 1, ow=1.4)
    b = n.get('bind') or {}
    cols = (b.get('colors') if isinstance(b, dict) else None) or [PAL['plum-500'], PAL['sun-500']]
    c.part([(2, 2), (w - 2, 2), (w - 2, h * 0.7), (w / 2, h - 1.5), (2, h * 0.7)], cols[0])
    c.part(PH.star(w / 2, h * 0.42, w * 0.22, w * 0.09, 5), cols[1], ow=1.0, shade=False)
    paste(img, c.out(), x, y)


def w_lockstamp(img, n, x, y, w, h):
    lay = Image.new('RGBA', (int(w), int(h)), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    d.rounded_rectangle((2, 2, w - 2, h - 2), 10, outline=hexc(PAL['leaf-700'], 230), width=4, fill=hexc(PAL['leaf-300'], 90))
    draw_text(lay, 'LOCKED', dict(THEME['font']['styles']['title'], size=22, color=PAL['leaf-700'], stroke={"width": 0, "color": PAL['ink']}, shadow=None), (28, 0, w - 30, h), 'center')
    paste(lay, icon_img('ic_lock', 24), 8, (h - 24) / 2)
    paste(img, lay.rotate(-8, expand=True, resample=Image.BICUBIC), x - 6, y - 8)


def w_input(img, n, x, y, w, h):
    dis = truthy(n.get('disabled')) if 'disabled' in n.d else False
    st = 'disabled' if dis else ('focus' if n.d.get('focus') else 'normal')
    paste_nine(img, f'input_{st}', x, y, w, h)
    v = n.get('bind'); ic = n.d.get('icon'); sx = x + 14
    if ic and ic in ATLAS['frames']:
        paste(img, icon_img(ic, 22), x + 10, y + (h - 22) / 2); sx = x + 38
    if v: draw_text(img, v, 'body', (sx, y, w - (sx - x) - 10, h), 'left')
    else: draw_text(img, n.d.get('placeholder', ''), 'body', (sx, y, w - (sx - x) - 10, h), 'left', hexc(PAL['ink-faint'], 170))
    if st == 'focus' and not v:
        d = ImageDraw.Draw(img); d.line((sx - 3, y + 12, sx - 3, y + h - 12), fill=hexc(PAL['ink']), width=2)


def w_scrim(img, n, x, y, w, h):
    a = int(255 * n.d.get('alpha', 0.4)); col = hexc(PAL[n.d.get('color', 'choc-800')])
    lay = Image.new('RGBA', img.size, (col[0], col[1], col[2], a))
    if n.d.get('vignette'):
        v = Image.new('L', img.size, 0); ImageDraw.Draw(v).ellipse((-100, -100, img.size[0] + 100, img.size[1] + 100), fill=255)
        v = ImageChops.invert(v.filter(ImageFilter.GaussianBlur(140)))
        lay.putalpha(ImageChops.lighter(lay.getchannel('A'), v))
    img.alpha_composite(lay)


def w_divider(img, n, x, y, w, h):
    paste_nine(img, 'divider', x, y, w, 14)


def w_tooltip(img, n, x, y, w, h):
    paste_nine(img, 'panel_tooltip', x - 2, y - 2, w + 4, h + 6)


def w_list(img, n, x, y, w, h):
    # scrollbar on the right when content may overflow
    paste_nine(img, 'scroll_track', x + w - 16, y, 16, h)
    th = max(40, h * 0.45)
    paste_nine(img, 'scroll_thumb', x + w - 16, y + 4, 16, th)
    paste(img, frame('scroll_grip').resize((12, 12), Image.LANCZOS), x + w - 14, y + 4 + th / 2 - 7)


def w_listitem(img, n, x, y, w, h):
    sel = truthy(n.get('selected')); dis = truthy(n.get('disabled'))
    paste_nine(img, 'slot_selected' if sel else ('slot_locked' if dis else 'panel_inset'), x, y, w - 20, h)


def w_card(img, n, x, y, w, h):
    sel = truthy(n.get('selected')); dis = truthy(n.get('disabled'))
    paste_nine(img, 'slot_selected' if sel else ('slot_locked' if dis else 'slot_empty'), x, y, w, h)
    im = icon_img(n.get('icon'), 32)
    if im: paste(img, im, x + (w - 32) / 2, y + 8)
    draw_text(img, n.get('label'), 'tiny', (x + 2, y + h - 26, w - 4, 18), 'center', hexc(PAL['slate-700']) if dis else None)
    if dis: paste(img, icon_img('ic_lock', 20), x + w - 22, y + 4)


def w_stepper(img, n, x, y, w, h):
    paste_nine(img, 'input_normal', x + 34, y, w - 68, h)
    paste_nine(img, 'btn_secondary_normal', x, y, 32, h); paste(img, icon_img('ic_minus', 20), x + 6, y + (h - 24) / 2)
    paste_nine(img, 'btn_secondary_normal', x + w - 32, y, 32, h); paste(img, icon_img('ic_plus', 20), x + w - 26, y + (h - 24) / 2)
    draw_text(img, str(n.get('bind')), 'heading', (x + 34, y, w - 68, h), 'center')


def w_mapview(img, n, x, y, w, h):
    tex = PH.map_texture(int(w), int(h), seed=5)
    paste(img, tex, x, y)
    d = ImageDraw.Draw(img)
    # dashed path + markers
    pts = [(x + w * 0.36, y + h * 0.62), (x + w * 0.45, y + h * 0.5), (x + w * 0.55, y + h * 0.52), (x + w * 0.62, y + h * 0.4)]
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        for k in range(0, 10, 2):
            t0, t1 = k / 10, (k + 1) / 10
            d.line((ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1), fill=hexc(PAL['berry-700']), width=3)
    for ic, fx, fy in (('ic_home', 0.36, 0.62), ('ic_campfire', 0.5, 0.56), ('ic_zombie', 0.72, 0.3), ('ic_skull', 0.62, 0.4), ('ic_pin', 0.25, 0.3)):
        paste(img, icon_img(ic, 32), x + w * fx - 16, y + h * fy - 16)
    paste(img, frame('minimap_player'), x + w * 0.45 - 12, y + h * 0.5 - 12)
    member_pins(img, d, n, x + w * 0.45, y + h * 0.5, 4)
    for m in n.get('memberPins') or []:
        draw_text(img, m['name'], 'tiny', (x + w * 0.45 + m['x'] * 4 - 40, y + h * 0.5 + m['y'] * 4 + 14, 80, 14), 'center')
    for fx, fy, col in ((0.55, 0.52, PAL['blue-500']), (0.4, 0.66, PAL['leaf-500'])):
        d.ellipse((x + w * fx - 8, y + h * fy - 8, x + w * fx + 8, y + h * fy + 8), fill=hexc(PAL['ink'])); d.ellipse((x + w * fx - 6, y + h * fy - 6, x + w * fx + 6, y + h * fy + 6), fill=hexc(col))
    # fog of war at edges
    fog = Image.new('L', (int(w), int(h)), 0); ImageDraw.Draw(fog).rectangle((0, 0, w, h), fill=0)
    m = Image.new('L', (int(w), int(h)), 255); ImageDraw.Draw(m).ellipse((w * 0.12, h * 0.08, w * 0.88, h * 0.95), fill=0)
    m = m.filter(ImageFilter.GaussianBlur(40))
    fogc = Image.new('RGBA', (int(w), int(h)), hexc(PAL['parchment-300'])); fogc.putalpha(m.point(lambda v: int(v * 0.9)))
    paste(img, fogc, x, y)
    # compass rose
    paste(img, icon_img('ic_star', 40), x + w - 60, y + h - 60)
    draw_text(img, 'N', 'label', (x + w - 60, y + h - 82, 40, 20), 'center')


def w_checkbox(img, n, x, y, w, h):
    on = truthy(n.get('bind'))
    paste(img, icon_img('checkbox_on' if on else 'checkbox_off', int(min(w, h))), x, y)
    if n.d.get('label'): draw_text(img, n.d['label'], 'small', (x + w + 8, y, 260, h), 'left')


def w_toggle(img, n, x, y, w, h):
    paste(img, frame('toggle_on' if truthy(n.get('bind')) else 'toggle_off'), x, y + (h - 28) / 2)


def w_slider(img, n, x, y, w, h):
    v = float(n.get('bind') or 0); mn = float(n.d.get('min', 0)); mx = float(n.d.get('max', 1))
    f = (v - mn) / (mx - mn) if mx > mn else 0
    tw = w - 60
    paste_nine(img, 'slider_track', x, y + (h - 20) / 2, tw, 20)
    paste_nine(img, 'slider_fill', x, y + (h - 20) / 2, max(20, tw * f), 20)
    paste(img, frame('slider_knob'), x + tw * f - 16, y + (h - 32) / 2 - 2)
    if n.d.get('valueText'): draw_text(img, n.get('valueText'), 'label', (x + tw + 6, y, 54, h), 'right')


def w_portrait(img, n, x, y, w, h):
    c = PH.Ink(w, h, 1, ow=1.6)
    PH._chibi(c, w / 2, h - 8, min(w / 30, h / 52), PAL['red-500'], '#8A5232')
    paste(img, c.out(), x, y)


def w_avatar(img, n, x, y, w, h):
    col = player_color(n.get('color'))
    c = PH.Ink(w, h, 1, ow=1.5)
    c.part(PH.blob(w / 2, h / 2 + 1, w / 2 - 3, h / 2 - 3, wob=0.6, seed=4), col)
    c.face(w / 2, h / 2, w / 34, 'happy')
    paste(img, c.out(), x, y)


def w_swatch(img, n, x, y, w, h):
    sel = truthy(n.get('selected'))
    d = ImageDraw.Draw(img); cy = y + 8
    if sel: d.ellipse((x - 3, cy - 3, x + w + 3, cy + w + 3), fill=hexc(PAL['sun-500']))
    d.ellipse((x, cy, x + w, cy + w), fill=hexc(PAL['ink'])); d.ellipse((x + 2.5, cy + 2.5, x + w - 2.5, cy + w - 2.5), fill=hexc(n.get('color')))
    d.ellipse((x + 7, cy + 6, x + 12, cy + 10), fill=(255, 255, 255, 170))


def w_logo(img, n, x, y, w, h):
    t = n.get('text')
    st = dict(THEME['font']['styles']['hero']); st['size'] = 84; st['stroke'] = {"width": 7, "color": PAL['ink']}
    st['shadow'] = 'drop-text-lg'
    tw = text_size(t, st)[0]
    # leafy sprig ornaments
    c = PH.Ink(w, h, 1, ow=1.4)
    from uikit.kit import vine, leaf
    vine(c, [(w / 2 - tw / 2 - 70, 70), (w / 2 - tw / 2 - 40, 50), (w / 2 - tw / 2 - 10, 46)], seed=3, leaves=3)
    vine(c, [(w / 2 + tw / 2 + 70, 70), (w / 2 + tw / 2 + 40, 50), (w / 2 + tw / 2 + 10, 46)], seed=8, leaves=3)
    paste(img, c.out(), x, y)
    st['color'] = PAL['sun-300']
    draw_text(img, t, st, (x, y + 4, w, 100), 'center')
    paste_nine(img, 'ribbon_title', x + w / 2 - 230, y + 104, 460, 40)
    draw_text(img, n.get('subtitle'), 'button', (x, y + 104, w, 34), 'center')


def w_backdrop(img, n, x, y, w, h):
    bg = PH.game_background('dusk', seed=11)
    img.alpha_composite(bg)


def w_ghost(img, n, x, y, w, h):
    c = PH.Ink(w, h, 1, ow=2.2)
    cx, top, R = w / 2, 14, 36
    pts = [(cx + R * math.cos(math.radians(a)), top + R + R * math.sin(math.radians(a))) for a in range(180, 361, 6)]
    bottom = top + R + 52
    pts += [(cx + R + 4, bottom - 6)]
    for i in range(7):  # wavy hem
        t = i / 6
        pts.append((cx + R + 4 - t * (2 * R + 8), bottom + (8 if i % 2 else -2)))
    pts += [(cx - R - 4, bottom - 6)]
    c.part(PH.jitter(pts, 0.8, 7), PAL['parchment-50'])
    c.part(PH.blob(cx - R - 6, top + R + 22, 9, 6, wob=0.5, seed=2, rot=0.6), PAL['parchment-50'], ow=1.8)  # little arms
    c.part(PH.blob(cx + R + 6, top + R + 16, 9, 6, wob=0.5, seed=3, rot=-0.6), PAL['parchment-50'], ow=1.8)
    c.face(cx, top + R + 6, 2.3, 'dead', blush=True, eye_gap=3.6)
    c.part(PH.star(cx + R + 14, top + 6, 7, 2.6, 4, rot=0), PAL['sun-300'], ow=1.2, shade=False)
    c.part(PH.star(cx - R - 12, top + 18, 5, 2, 4, rot=0), PAL['sun-300'], ow=1.2, shade=False)
    for k, (dx, dy, rr) in enumerate(((-30, 100, 14), (-8, 108, 16), (18, 104, 15), (38, 98, 11))):  # poof cloud
        c.part(PH.blob(cx + dx, dy, rr, rr * 0.7, wob=1, seed=k + 20), PAL['slate-300'], ow=1.8)
    paste(img, c.out(), x, y)


def w_stat(img, n, x, y, w, h):
    paste(img, icon_img(n.get('icon'), 32), x + (w - 32) / 2, y)
    draw_text(img, n.get('value'), 'heading', (x, y + 34, w, 26), 'center')
    draw_text(img, n.get('label'), 'tiny', (x, y + 60, w, 18), 'center')


def w_statrow(img, n, x, y, w, h):
    paste(img, icon_img(n.get('icon'), 22), x, y + 1)
    draw_text(img, n.get('label'), 'small', (x + 28, y, w - 120, h), 'left')
    draw_text(img, n.get('value'), 'label', (x + w - 120, y, 120, h), 'right')


def w_pips(img, n, x, y, w, h):
    v = int(n.get('value') or 0); mx = int(n.d.get('max', 5))
    for i in range(mx):
        im = icon_img('ic_star', int(h + 4))
        if i >= v:
            im = im.copy(); a = im.getchannel('A').point(lambda p: int(p * 0.3)); im.putalpha(a)
        paste(img, im, x + i * (h + 6), y - 2)


WIDGETS = dict(panel=w_panel, text=w_text, icon=w_icon, button=w_button, slot=w_slot, bar=w_bar, ribbon=w_ribbon, tabs=w_tabs, minimap=w_minimap,
               badge=w_badge, status=w_status, keyhint=w_keyhint, toast=w_toast, chatline=w_chatline, input=w_input, scrim=w_scrim, divider=w_divider,
               tooltip=w_tooltip, listitem=w_listitem, card=w_card, stepper=w_stepper, mapview=w_mapview, checkbox=w_checkbox, toggle=w_toggle,
               slider=w_slider, portrait=w_portrait, avatar=w_avatar, swatch=w_swatch, logo=w_logo, backdrop=w_backdrop, ghost=w_ghost, stat=w_stat,
               statrow=w_statrow, pips=w_pips, rank=w_rank, foodbadge=w_foodbadge, banner=w_banner, lockstamp=w_lockstamp)
POST = dict(list=w_list)


def render_screen(screen_id, bg=None, extra_state=None, also=None, out=None, pre=None):
    st = copy.deepcopy(STATE)
    if extra_state:
        for k, v in extra_state.items():
            cur = st
            ks = k.split('.')
            for kk in ks[:-1]: cur = cur[kk]
            cur[ks[-1]] = v
    img = Image.new('RGBA', (1280, 720), (0, 0, 0, 255)) if bg is None else bg.copy()
    for k, v in json.load(open(os.path.join(SCREENS, screen_id + '.json'))).get('setsState', {}).items():
        a, b = k.split('.'); st.setdefault(a, {})[b] = v
    st.setdefault('ui', {})
    if pre: pre(img)
    for sid in (also or []) + [screen_id]:
        d = json.load(open(os.path.join(SCREENS, sid + '.json')))
        scope = [st, d.get('derive', {})]
        root = instantiate(d['root'], scope)[0]
        root.d = dict(root.d, w='fill', h='fill')
        place(root, 0, 0, 1280, 720)
        draw(img, root)
    if out:
        img.convert('RGB').save(out)
    return img


if __name__ == '__main__':
    os.makedirs(os.path.join(UI, 'preview'), exist_ok=True)
    only = sys.argv[1:]
    day = PH.game_background('day'); dusk = PH.game_background('dusk')
    def build_ghost(img):
        g = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(g)
        cx, cy = 720, 330
        top = [(cx, cy - 48), (cx + 64, cy - 16), (cx + 32, cy), (cx - 32, cy - 32)]
        left = [(cx - 32, cy - 32), (cx + 32, cy), (cx + 32, cy + 48), (cx - 32, cy + 16)]
        right = [(cx + 32, cy), (cx + 64, cy - 16), (cx + 64, cy + 32), (cx + 32, cy + 48)]
        for poly, col in ((left, (114, 196, 92, 120)), (right, (71, 155, 85, 120)), (top, (180, 234, 128, 140))):
            d.polygon(poly, fill=col, outline=(255, 250, 240, 230))
        foot = [(cx - 64, cy + 16), (cx + 32, cy + 64), (cx + 96, cy + 32), (cx, cy - 16)]
        d.line(foot + [foot[0]], fill=(255, 250, 240, 200), width=2)
        img.alpha_composite(g)
    jobs = {
        'hud': dict(bg=dusk),
        'inventory': dict(bg=dusk, also=['hud']),
        'crafting': dict(bg=dusk, also=['hud']),
        'building': dict(bg=day, also=['hud'], pre=build_ghost),
        'world_map': dict(bg=day, also=['hud']),
        'character': dict(bg=dusk, also=['hud']),
        'chat': dict(bg=day, also=['hud']),
        'main_menu': dict(bg=None),
        'pause_settings': dict(bg=day, also=['hud']),
        'death': dict(bg=dusk),
        'trade': dict(bg=day, also=['hud']),
    }
    for sid, kw in jobs.items():
        if only and sid not in only: continue
        p = os.path.join(UI, 'preview', f'{sid}.png')
        render_screen(sid, out=p, **kw)
        print('wrote', p)
