"""Camper station panel mockup (2x) composed from assets/ui/kit/css crops + pack item icons. python3 mockup.py <repo> <out.png>"""
import sys, json
from PIL import Image, ImageDraw, ImageFont
R, OUT = sys.argv[1], sys.argv[2]
K = R + '/assets/ui/kit/css/'
F = '/usr/share/fonts/truetype/sand-box/google/Fredoka/Fredoka-VariableFont_wdth,wght.ttf'
def font(sz, w=600):
    f = ImageFont.truetype(F, sz)
    try: f.set_variation_by_axes([100, w])
    except Exception: pass
    return f
def kit(n): return Image.open(K + n + '@2x.png').convert('RGBA')
def nine(n, w, h, s=None):
    im = kit(n); W, H = im.size; s = s or round(W * 0.29167); out = Image.new('RGBA', (w, h))
    xs = [(0, s, 0, s), (s, W - s, s, w - s), (W - s, W, w - s, w)]; ys = [(0, s, 0, s), (s, H - s, s, h - s), (H - s, H, h - s, h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if dx1 > dx0 and dy1 > dy0: out.paste(im.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS), (dx0, dy0))
    return out
P = R + '/packages/assets/pack/'
icons = {}
for f, a in [('manifest.json', 'items'), ('items/manifest.items.json', 'items_icons'), ('vehicle_items/manifest.vehicle_items.json', 'vitems_icons')]:
    m = json.load(open(P + f)); A = {x['key']: x for x in m['atlases']}[a]; base = P + (f.rsplit('/', 1)[0] + '/' if '/' in f else '')
    pg = A.get('pages'); sheet = Image.open(base + (pg[0]['image'] if pg else A['image'])).convert('RGBA'); fw = A['frameW'] * (2 if pg else 1)
    for s in m['sprites']:
        if s.get('atlas') == a:
            i = s['animations']['idle']['frames'][0]; icons[s['key']] = sheet.crop(((i % A['columns']) * fw, (i // A['columns']) * fw, (i % A['columns'] + 1) * fw, (i // A['columns'] + 1) * fw))
def icon(k, sz=72):
    for c in (k, 'item_' + k):
        if c in icons: return icons[c].resize((sz, sz), Image.LANCZOS)
    return kit('ui_ic_bag').resize((sz, sz), Image.LANCZOS)
INK = (59, 36, 51); BARK = (116, 67, 44); CREAM = (255, 250, 240)
W, H = 1440, 1090
img = Image.new('RGBA', (W, H), (92, 140, 110, 255)); d = ImageDraw.Draw(img)
for y in range(H): d.line([(0, y), (W, y)], fill=(86 + y // 40, 132 + y // 60, 104, 255))
def put(im, x, y): img.alpha_composite(im, (int(x), int(y)))
def text(x, y, t, sz=28, c=INK, w=600, anchor='la'): d.text((x, y), t, font=font(sz, w), fill=c, anchor=anchor)
# panel
d.rounded_rectangle((60, 40, W - 60, H - 40), 36, fill=(246, 234, 210), outline=INK, width=6)
d.rounded_rectangle((60, 40, W - 60, 130), 36, fill=BARK, outline=INK, width=6); d.rectangle((66, 100, W - 66, 124), fill=BARK)
put(icon('item_vehicle_kit_camper_rv', 64), 96, 52); text(176, 85, 'Camper Station', 44, CREAM, 700, 'lm')
x0 = W - 140; put(nine('ui_btn_gold_normal', 64, 64), x0, 54); put(kit('ui_ic_cross').resize((40, 40)), x0 + 12, 64)
text(x0 - 16, 85, '(B) Close', 24, CREAM, 600, 'rm')
# fuel row
put(nine('ui_panel_inset', W - 200, 120), 100, 150)
text(130, 210, 'Fuel', 30, BARK, 700, 'lm')
def slot(x, y, k=None, n=None, st='ui_slot_empty', sz=104):
    put(nine(st, sz, sz), x, y)
    if k: put(icon(k, sz - 32), x + 16, y + 14)
    if n: text(x + sz - 10, y + sz - 6, str(n), 26, CREAM, 700, 'rs'); 
def bar(x, y, w, p, c0=(255, 212, 90), c1=(240, 138, 52), h=36):
    put(nine('ui_bar_track', w, h, 18), x, y); fw = int((w - 8) * p)
    if fw < 16: return
    d.rounded_rectangle((x + 4, y + 6, x + 4 + fw, y + h - 6), 12, fill=c1, outline=INK, width=3); d.rounded_rectangle((x + 8, y + 9, x + fw, y + 15), 4, fill=c0)
slot(230, 158, 'item_gasoline', 6, 'ui_slot_selected')
bar(360, 190, 760, 0.62); text(1140, 208, '62%  · 3m 10s', 26, INK, 600, 'lm')
# tabs
for i, (t, on) in enumerate([('Craft  LB', True), ('Cook  RB', False)]):
    bx = 100 + i * 330; put(nine('ui_btn_gold_normal' if on else 'ui_slot_empty', 310, 76), bx, 290)
    put(kit('ui_ic_craft' if i == 0 else 'ui_ic_star').resize((40, 40)), bx + 24, 308); text(bx + 80, 328, t, 30, INK, 700, 'lm')
    if on: put(kit('ui_ic_check').resize((36, 36)), bx + 284, 278)
text(780, 328, 'Cook tab: 3 input slots + output, same job bar', 22, BARK, 500, 'lm')
# craft section
text(100, 400, 'Recipes', 28, BARK, 700)
recs = [('item_patch_kit', 'Patch kit', True), ('item_tire', 'Tire', True), ('item_battery', 'Battery', False), ('item_biofuel', 'Biofuel', True), ('item_engine_small', 'Engine', False), ('item_seat', 'Seat', True)]
for i, (k, n, ok) in enumerate(recs):
    x, y = 100 + (i % 3) * 196, 444 + (i // 3) * 160
    slot(x, y, k, None, 'ui_slot_hover' if i == 0 else ('ui_slot_empty' if ok else 'ui_slot_locked'), 120)
    if not ok: put(kit('ui_ic_lock').resize((34, 34)), x + 86, y - 6)
    text(x + 60, y + 126, n, 22, INK if ok else (125, 106, 92), 600, 'ma')
# tooltip on focused recipe
put(nine('ui_panel_tooltip', 340, 110), 230, 382); text(250, 410, 'Patch kit · 2 rubber + 1 cloth', 20, INK, 600); text(250, 440, '(A) craft  ·  hold (A) for x5', 20, BARK, 500)
# job queue
text(100, 768, 'Queue', 28, BARK, 700)
text(100, 760, '', 1)
for j, (k, p) in enumerate([('item_patch_kit', 0.45), ('item_tire', 0.0)]):
    y = 806 + j * 90; put(nine('ui_slot_empty', 560, 84), 100, y); put(icon(k, 52), 118, y + 16)
    text(186, y + 30, ['Patch kit  ·  12s', 'Tire  ·  waiting'][j], 22, INK, 600, 'lm'); bar(186, y + 44, 450, p, (159, 216, 106), (90, 154, 74), 28)
# inventory
put(nine('ui_panel_inset', 660, 560), 700, 400); text(730, 430, 'Camper storage  12/24', 28, BARK, 700, 'lm')
inv = ['wood', 'item_spark_plug', 'cotton', 'item_tire_car', 'gasoline', 'item_reeds', 'item_flax', 'diesel', 'plant_oil', None, None, None, 'item_fuel_filter', None, None, None]
inv = [('wood', 18), ('scrap_metal', 9), ('cotton', 6), ('item_tire', 2), ('item_gasoline', 4), ('item_reeds', 23), ('item_flax', 11), ('item_diesel', 3), ('item_plant_oil', 5), ('item_rubber', 7), ('item_battery', 1), ('item_copper_wire', 4)] + [(None, None)] * 12
for i, (k, n) in enumerate(inv):
    x, y = 730 + (i % 6) * 100, 470 + (i // 6) * 130
    slot(x, y, k, n, 'ui_slot_selected' if i == 5 else 'ui_slot_empty', 92)
text(100, 1022, '(A) move  ·  (X) split  ·  (Y) add fuel  ·  LB/RB tabs  ·  tap/hold = tooltip  ·  drag with mouse', 22, BARK, 500)
img.convert('RGB').save(OUT); print(OUT, img.size)
