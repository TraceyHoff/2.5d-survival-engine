#!/usr/bin/env python3
"""ui/preview/ui_kit_sheet.png - every atlas frame (shown from the @2x atlas) grouped by tag + 9-slice stretch demos at 1x."""
import os, sys, json
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
import render_previews as R
from uikit import kit
from uikit.nine import nine

W = 1600
PAL = R.PAL
GROUPS = [("Panels & frames", ['panel']), ("Buttons", ['button']), ("Slots (states + rarity tiers)", ['slot']), ("Bars", ['bar']),
          ("Tabs · scroll · input · checkbox · toggle · slider", ['tab', 'scroll', 'input', 'checkbox', 'toggle', 'slider']),
          ("Chat bubble · toasts · minimap · deco", ['chat', 'toast', 'minimap', 'deco']), ("Icons: vitals, status, UI glyphs, build categories", ['icon']),
          ("Equipment silhouettes", ['equip']), ("Cursors (hotspot = red dot)", ['cursor'])]


def main():
    rows = []
    sheet = Image.new('RGBA', (W, 6000), R.hexc(PAL['parchment-200']))
    d = ImageDraw.Draw(sheet)
    y = 24
    R.draw_text(sheet, 'Cozy Camp UI kit', 'title', (24, y, 800, 44), 'left'); y += 52
    R.draw_text(sheet, 'atlas/ui_atlas(@2x).png · TexturePacker JSON hash + nineSlice · shown at 2x', 'body', (26, y, 1200, 22), 'left'); y += 36
    for title, tags in GROUPS:
        names = [n for n, s in kit.SPRITES.items() if set(s['tags']) & set(tags)]
        R.paste_nine(sheet, 'ribbon_title', 20, y, 40 + R.text_size(title, 'button')[0] + 60, 40)
        R.draw_text(sheet, title, 'button', (50, y - 3, 1200, 34), 'left'); y += 52
        x = 30; rowh = 0
        for n in names:
            s = kit.SPRITES[n]; im = R.frame(n, 2)
            cw = max(im.size[0], 110)
            if x + cw > W - 30:
                x = 30; y += rowh + 34; rowh = 0
            # checker for transparency
            bx = Image.new('RGBA', im.size, R.hexc(PAL['parchment-100']))
            if n.startswith('minimap_mask'): bx = Image.new('RGBA', im.size, R.hexc(PAL['slate-500']))
            sheet.alpha_composite(bx, (x, y)); sheet.alpha_composite(im, (x, y))
            if s['hotspot']:
                hx, hy = x + s['hotspot'][0] * 2, y + s['hotspot'][1] * 2
                d.ellipse((hx - 3, hy - 3, hx + 3, hy + 3), fill=R.hexc(PAL['berry-500']))
            if s['nine']:
                l, t, r_, b = [v * 2 for v in s['nine']]; w_, h_ = im.size
                for xx in (x + l, x + w_ - r_):
                    d.line((xx, y, xx, y + h_), fill=R.hexc(PAL['sky-700'], 140), width=1)
                for yy in (y + t, y + h_ - b):
                    d.line((x, yy, x + w_, yy), fill=R.hexc(PAL['sky-700'], 140), width=1)
            R.draw_text(sheet, n, 'tiny', (x, y + im.size[1] + 2, cw, 16), 'left')
            x += cw + 16; rowh = max(rowh, im.size[1])
        y += rowh + 44
    # 9-slice demos
    R.paste_nine(sheet, 'ribbon_title', 20, y, 420, 40); R.draw_text(sheet, '9-slice stretch demos (1x)', 'button', (50, y - 3, 600, 34), 'left'); y += 56
    x = 30
    for n, w_, h_ in (('panel_wood_vine', 360, 220), ('panel_parchment', 300, 180), ('panel_hud', 260, 90), ('panel_tooltip', 240, 120), ('bubble', 220, 80)):
        sheet.alpha_composite(nine(R.frame(n), R.insets(n), w_, h_), (x, y)); x += w_ + 24
    y += 240
    x = 30
    for n, w_, h_ in (('btn_primary_normal', 200, 48), ('btn_gold_hover', 200, 48), ('btn_danger_pressed', 160, 48), ('btn_disabled', 160, 48), ('btn_wood_plank', 220, 44), ('ribbon_title', 300, 40)):
        sheet.alpha_composite(nine(R.frame(n), R.insets(n), w_, h_), (x, y)); x += w_ + 20
    y += 70
    x = 30
    for v in ('health', 'hunger', 'thirst', 'stamina', 'xp', 'temperature'):
        class N: pass
        n = R.Node({'type': 'bar', 'vital': v, 'value': 0.62 if v != 'temperature' else 36.5, 'max': 1 if v != 'temperature' else 45, 'min': 0 if v != 'temperature' else 25}, [{}])
        R.w_bar(sheet, n, x, y + 6, 220, 20); x += 250
    y += 60
    sheet = sheet.crop((0, 0, W, y + 20))
    out = os.path.join(R.UI, 'preview', 'ui_kit_sheet.png')
    sheet.convert('RGB').save(out)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
