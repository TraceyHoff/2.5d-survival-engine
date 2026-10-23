"""Previews for survival-hook art -> ui/hooks/preview/*.png (+ fx GIFs)."""
import json, os
from PIL import Image, ImageDraw
UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')); H = os.path.join(UI, 'hooks'); FX = os.path.join(UI, '..', 'survival_events')
PV = os.path.join(H, 'preview'); os.makedirs(PV, exist_ok=True)
tp = json.load(open(os.path.join(H, 'atlas', 'ui_hooks@2x.json'))); sheet = Image.open(os.path.join(H, 'atlas', 'ui_hooks@2x.png')).convert('RGBA')
fr = tp['frames']
def spr(n):
    f = fr[n]['frame']; return sheet.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
BG = (238, 226, 204, 255)
def grid(names, cols, cell, out, label=True):
    rows = -(-len(names) // cols); im = Image.new('RGBA', (cols * cell, rows * (cell + (14 if label else 0))), BG); d = ImageDraw.Draw(im)
    for i, n in enumerate(names):
        s = spr(n); s.thumbnail((cell - 8, cell - 8)); x, y = (i % cols) * cell, (i // cols) * (cell + (14 if label else 0))
        im.alpha_composite(s, (x + (cell - s.width) // 2, y + (cell - s.height) // 2))
        if label: d.text((x + 3, y + cell), n.replace('vb_ctx_', '')[:22], fill=(80, 60, 50))
    im.save(os.path.join(PV, out)); return out
K = sorted(fr)
outs = [grid([k for k in K if k.startswith('vb_ctx_')], 9, 120, 'touch_context_buttons.png'),
        grid([k for k in K if k.startswith('cq_')], 10, 120, 'craft_queue_parts.png'),
        grid([k for k in K if k.startswith(('ic_', 'banner_', 'ghost_', 'hit48', 'ctxi_'))], 10, 120, 'events_touch_parts.png')]
# craft queue mock: 4 slots, 3 states + ring progress
im = Image.new('RGBA', (640, 200), (60, 82, 70, 255)); d = ImageDraw.Draw(im)
for i, (st, p) in enumerate([('active', .62), ('queued', 0), ('paused', .35), ('empty', 0)]):
    x = 20 + i * 150; s = spr(f'cq_slot_{st}').resize((128, 128)); im.alpha_composite(s, (x, 30))
    if st != 'empty':
        im.alpha_composite(spr('cq_ring_track'), (x + 8, 38))
        if st in ('active', 'paused'): im.alpha_composite(spr(f"cq_ring{'_paused' if st == 'paused' else ''}_{int(p * 23):02d}"), (x + 8, 38))
        im.alpha_composite(spr('ctxi_craft'), (x + 32, 62)); im.alpha_composite(spr('cq_cancel'), (x + 100, 22))
    d.text((x + 30, 170), st + (f' {int(p * 100)}%' if p else ''), fill=(255, 245, 220))
im.save(os.path.join(PV, 'ui_craft_queue.png')); outs.append('ui_craft_queue.png')
# phone touch mock: ctx button + ghost offset with pointer line
im = Image.new('RGBA', (780, 360), (120, 160, 96, 255)); d = ImageDraw.Draw(im)
for x in range(0, 780, 64):
    for y in range(0, 360, 32): d.line([(x, y), (x + 32, y + 16), (x, y + 32)], fill=(108, 146, 88))
fx, fy = 300, 270; gx, gy = 300, 150
for t in range(1, 7):
    px, py = fx + (gx - fx) * t / 7, fy + (gy - fy) * t / 7; s = spr('ghost_seg').rotate(90, expand=True); im.alpha_composite(s, (int(px - s.width / 2), int(py - s.height / 2)))
for n, (x, y) in [('ghost_reticle_ok', (gx, gy)), ('ghost_dot', (gx, gy)), ('ghost_finger', (fx, fy))]:
    s = spr(n); im.alpha_composite(s, (x - s.width // 2, y - s.height // 2))
s = spr('ghost_reticle_bad'); im.alpha_composite(s, (520 - s.width // 2, 150 - s.height // 2)); d.text((480, 190), 'invalid spot', fill=(255, 255, 255))
for i, v in enumerate(['chop', 'mine', 'talk']):
    s = spr(f'vb_ctx_{v}_normal'); im.alpha_composite(s, (600 + (i % 2) * 0, 20 + i * 110)); d.text((600, 20 + i * 110 + 96), v, fill=(255, 255, 255))
h = spr('hit48'); im.alpha_composite(h, (40, 40)); d.text((40, 140), '48dp tap target', fill=(255, 255, 255)); d.text((fx - 60, fy + 40), 'finger (ghost 1.5 tiles up)', fill=(255, 255, 255))
im.save(os.path.join(PV, 'touch_phone_mock.png')); outs.append('touch_phone_mock.png')
# banners
im = Image.new('RGBA', (560, 260), (40, 40, 52, 255))
for i, n in enumerate(['banner_breach', 'banner_breach_win', 'banner_respawn']):
    b = spr(n).resize((420, 70)); im.alpha_composite(b, (70, 14 + i * 82)); ic = spr({0: 'ic_gate_breach', 1: 'ic_gate_breach', 2: 'ic_respawn'}[i]); ic.thumbnail((60, 60)); im.alpha_composite(ic, (80, 19 + i * 82))
im.save(os.path.join(PV, 'banners.png')); outs.append('banners.png')
# fx strips + gifs
man = json.load(open(os.path.join(FX, 'manifest.fragment.json'))); A = {a['key']: a for a in man['atlases']}
for s in man['sprites']:
    a = A[s['atlas']]
    if not a['image'].startswith('survival_events'): continue
    pg = Image.open(os.path.join(FX, 'atlases', os.path.basename(a['pages'][0]['image']))).convert('RGBA'); w, h = a['frameW'] * 2, a['frameH'] * 2
    for an, spec in s['animations'].items():
        fs = [pg.crop(((f % a['columns']) * w, (f // a['columns']) * h, (f % a['columns'] + 1) * w, (f // a['columns'] + 1) * h)) for f in spec['frames']]
        strip = Image.new('RGBA', (w * len(fs), h), BG)
        for i, f in enumerate(fs): strip.alpha_composite(f, (i * w, 0))
        nm = f"fx_{s['key']}_{an}"; strip.save(os.path.join(PV, nm + '.png')); outs.append(nm + '.png')
        g = [Image.alpha_composite(Image.new('RGBA', (w, h), BG), f).convert('P') for f in fs]
        g[0].save(os.path.join(PV, nm + '.gif'), save_all=True, append_images=g[1:], duration=int(1000 / spec['fps']), loop=0)
print('\n'.join(outs))
