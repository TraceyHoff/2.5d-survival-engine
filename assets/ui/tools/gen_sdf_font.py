#!/usr/bin/env python3
"""Fredoka MTSDF font for WebGL world UI (interaction prompts with device glyphs, build hints).
MTSDF = multi-channel SDF in RGB + true SDF in A. msdf-bmfont-xml has no mtsdf mode, so we run it twice with identical
settings (msdf, then sdf), check the glyph layouts match exactly, and merge: RGB <- msdf, A <- sdf.
Output: ui/fonts/sdf/font_prompt.png + font_prompt.json (BMFont JSON, distanceField.fieldType = "mtsdf").
Static instance cut from the OFL variable font with fontTools (OFL permits modified versions; renamed per RFN rules)."""
import json, os, shutil, subprocess, tempfile
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(UI, 'fonts', 'sdf')
MSDF = '/workspace/pvp_tmp/node_modules/.bin/msdf-bmfont'
SIZE, RANGE, TEX = 42, 6, '1024,1024'
CHARS = ''.join(chr(c) for c in range(32, 127)) + 'ÀÁÂÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÖØÙÚÛÜàáâäåçèéêëìíîïñòóôöøùúûüÿßæœ¡¿«»·•…×★♥°–—’“”'


def main():
    os.makedirs(OUT, exist_ok=True)
    f = TTFont(os.path.join(UI, 'fonts', 'Fredoka.ttf'))
    inst = instancer.instantiateVariableFont(f, {'wght': 600, 'wdth': 100})
    for rec in inst['name'].names:
        if rec.nameID in (1, 4, 16): rec.string = 'CozyPrompt SemiBold' if rec.nameID == 4 else 'CozyPrompt'
        if rec.nameID == 6: rec.string = 'CozyPrompt-SemiBold'
    ttf = os.path.join(OUT, 'CozyPrompt-SemiBold.ttf'); inst.save(ttf)
    shutil.copy(os.path.join(UI, 'fonts', 'OFL-Fredoka.txt'), OUT)
    cmap = TTFont(ttf).getBestCmap(); chars = ''.join(ch for ch in CHARS if ord(ch) in cmap or ch == ' ')
    missing = [ch for ch in CHARS if ord(ch) not in cmap and ch != ' ']
    res = {}
    for ft in ('msdf', 'sdf'):
        tmp = tempfile.mkdtemp(); cs = os.path.join(tmp, 'cs.txt'); open(cs, 'w', encoding='utf-8').write(chars)
        base = os.path.join(tmp, 'font_prompt')
        r = subprocess.run([MSDF, '-f', 'json', '-o', base, '-s', str(SIZE), '-r', str(RANGE), '-m', TEX, '-p', '2', '-b', '2', '-t', ft, '-i', cs, ttf],
                           capture_output=True, text=True, timeout=900)
        if r.returncode: raise SystemExit(r.stdout[-2000:] + r.stderr[-2000:])
        js = [p for p in os.listdir(tmp) if p.endswith('.json')][0]; pngs = sorted(p for p in os.listdir(tmp) if p.endswith('.png'))
        res[ft] = (json.load(open(os.path.join(tmp, js))), [Image.open(os.path.join(tmp, p)).convert('RGBA') for p in pngs])
    (jm, im_m), (js_, im_s) = res['msdf'], res['sdf']
    key = lambda d: [(c['id'], c['x'], c['y'], c['width'], c['height'], c['page']) for c in d['chars']]
    assert key(jm) == key(js_) and len(im_m) == len(im_s), 'msdf/sdf layouts differ'
    pages = []
    for i, (a, b) in enumerate(zip(im_m, im_s)):
        r, g, bl, _ = a.split(); sd = b.convert('RGB').split()[0]
        out = Image.merge('RGBA', (r, g, bl, sd)); name = f'font_prompt{"" if i == 0 else "_" + str(i)}.png'
        out.save(os.path.join(OUT, name), optimize=True); pages.append(name)
    jm['pages'] = pages
    jm['info']['face'] = 'CozyPrompt-SemiBold (Fredoka 600, OFL)'
    jm['distanceField'] = {'fieldType': 'mtsdf', 'distanceRange': RANGE}
    jm['x_cozy'] = {'channels': 'RGB = MSDF (median), A = true SDF (soft outlines/glow/shadow at any width)',
                    'recommended': {'fill': '#FFFAF0', 'outline': '#3B2433', 'outlineWidthPx@1x': 2.0, 'shadow': {'dx': 0, 'dy': 2, 'color': '#3B2433A6'}},
                    'missing': missing, 'source': 'tools/gen_sdf_font.py'}
    json.dump(jm, open(os.path.join(OUT, 'font_prompt.json'), 'w'))
    print('pages', pages, 'chars', len(jm['chars']), 'missing', missing)


if __name__ == '__main__':
    main()
