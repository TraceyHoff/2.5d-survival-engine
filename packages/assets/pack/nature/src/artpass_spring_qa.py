#!/usr/bin/env python3
"""Spring pack invariants and comparison previews; run from the repository root.

Optional --baseline /path/to/pre-pass-md5.json checks all preexisting PNG/KTX2.
Requires git HEAD to be the pre-pass baseline for manifest / lock append checks.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from artpass_spring_foliage import KEYS, GROUPS
import seasons_art as art
from artpass_spring_roads import spring, uvgrid

PACK = Path('packages/assets/pack')
OUT = Path('/workspace/assets/preview')


def head_json(path):
    return json.loads(subprocess.check_output(['git', 'show', f'HEAD:{path}']))


class Pack:
    def __init__(self, path):
        self.path = path
        self.base = path.parent
        self.m = json.loads(path.read_text())
        self.at = {a['key']: a for a in self.m['atlases']}
        self.sp = {s['key']: s for s in self.m['sprites']}
        assert len(self.at) == len(self.m['atlases'])
        assert len(self.sp) == len(self.m['sprites'])

    def frame(self, key, anim='idle', idx=0, scale=1):
        s = self.sp[key]
        a = self.at[s['atlas']]
        path = a['image'] if scale == 1 else next(p['image'] for p in a['pages'] if p['scale'] == scale)
        im = Image.open(self.base / path).convert('RGBA')
        fi = s['animations'][anim]['frames'][idx]
        w, h = a['frameW'] * scale, a['frameH'] * scale
        x, y = fi % a['columns'] * w, fi // a['columns'] * h
        return im.crop((x, y, x + w, y + h))


def unpad(im, scale):
    return im.crop((2 * scale, 2 * scale, im.width - 2 * scale, im.height - 2 * scale))


def verify(root, nature, baseline):
    report = {'plants': [], 'road_sprites': [], 'unchanged_png_ktx2': 0, 'pixel_hash_checks': 0}
    for pack in (root, nature):
        old = head_json(pack.path)
        for field in ('atlases', 'sprites'):
            current = {v['key']: v for v in pack.m[field]}
            for v in old[field]:
                assert current[v['key']] == v, ('existing record changed', pack.path, v['key'])
    if baseline:
        for path, md5 in json.loads(Path(baseline).read_text()).items():
            assert hashlib.md5(Path(path).read_bytes()).hexdigest() == md5, path
            report['unchanged_png_ktx2'] += 1
    for key in KEYS:
        summer, twin = root.sp[key], root.sp[key + '_spring']
        a = root.at[summer['atlas']]
        assert twin['placeholder'] == key
        assert twin['anchor'] == art.pad_anchor(summer['anchor'], a['frameW'], a['frameH'])
        assert twin.get('sway') == summer.get('sway')
        assert twin['animations'].keys() == summer['animations'].keys()
        for anim, ad in summer['animations'].items():
            td = twin['animations'][anim]
            assert {k: v for k, v in ad.items() if k != 'frames'} == {k: v for k, v in td.items() if k != 'frames'}
            assert len(ad['frames']) == len(td['frames'])
            for j, fi in enumerate(ad['frames']):
                for scale in (1, 2):
                    fr = unpad(root.frame(key + '_spring', anim, j, scale), scale)
                    pixels = np.asarray(fr)
                    assert set(np.unique(pixels[..., 3])).issubset({0, 255})
                    source = art.binary(art.src(summer['atlas'], fi, scale)).astype(np.uint8)
                    assert np.array_equal(pixels[..., 3], source[..., 3])
                    if key in ('tree', 'tree_apple', 'tree_pine', 'oak_tree'):
                        _, source_fol, _, _, _ = art.classes(source)
                        bottom = np.max(np.nonzero(source_fol)[0])
                        assert np.array_equal(pixels[bottom + 1:], source[bottom + 1:]), (key, 'trunk paint')
                    for suffix in ('', '_fall', '_winter'):
                        if key + suffix not in root.sp:
                            continue
                        # Summer @2x source is sharper than legacy upscaled summer atlas.
                        other = Image.fromarray(source) if not suffix else unpad(root.frame(key + suffix, anim, j, scale), scale)
                        assert pixels.shape == np.asarray(other).shape
                        assert hashlib.md5(fr.tobytes()).hexdigest() != hashlib.md5(other.tobytes()).hexdigest(), (key, anim, suffix, scale)
                        report['pixel_hash_checks'] += 1
        # Sway pixels, including their original continuous values, must be copied verbatim.
        sa = root.at[twin['atlas']]
        sw = Image.open(root.base / sa['masks']['sway'])
        for anim, ad in summer['animations'].items():
            for j, fi in enumerate(ad['frames']):
                ti = twin['animations'][anim]['frames'][j]
                x, y = ti % sa['columns'] * sa['frameW'], ti // sa['columns'] * sa['frameH']
                actual = unpad(sw.crop((x, y, x + sa['frameW'], y + sa['frameH'])), 1)
                assert np.array_equal(actual, art.frame(summer['atlas'], fi, 'sway').astype(np.uint8))
        report['plants'].append(twin['key'])
    spring_roads = {k for k, v in nature.sp.items() if v['atlas'] == 'season_roads_spring'}
    fall_roads = {k.removesuffix('_fall') + '_spring' for k, v in nature.sp.items() if v['atlas'] == 'season_roads_fall'}
    assert spring_roads == fall_roads and len(spring_roads) == 51
    for key in sorted(spring_roads):
        base = key.removesuffix('_spring')
        twin, summer = nature.sp[key], nature.sp[base]
        normalized = {**twin, 'key': base, 'atlas': summer['atlas']}
        normalized.pop('placeholder')
        assert normalized == summer
        for scale in (1, 2):
            fr = nature.frame(key, scale=scale)
            assert np.array_equal(np.asarray(fr)[..., 3], np.asarray(nature.frame(base, scale=scale))[..., 3])
            for suffix in ('', '_fall', '_winter'):
                assert fr.tobytes() != nature.frame(base + suffix, scale=scale).tobytes(), (key, suffix, scale)
                report['pixel_hash_checks'] += 1
        report['road_sprites'].append(key)
    # Wrapped detail periodicity independent of material/arm masks.
    u, v = uvgrid(2)
    rgb = np.full((64, 128, 3), 120, np.float32)
    alpha = np.full((64, 128), 255, np.uint8)
    assert np.array_equal(spring(rgb, alpha, u, v, 2, 'path'), spring(rgb, alpha, u + 1, v - 1, 2, 'path'))
    for pack, names in ((root, GROUPS.values()), (nature, ['season_roads_spring'])):
        for name in names:
            a = pack.at[name]
            assert a['residency'] == 'stream'
            for record in [a] + a['pages']:
                png = Image.open(pack.base / record['image'])
                scale = record.get('scale', 1)
                assert png.size == (a['columns'] * a['frameW'] * scale, a['rows'] * a['frameH'] * scale)
                ktx = (pack.base / record['ktx2']).read_bytes()
                assert ktx[:12] == b'\xabKTX 20\xbb\r\n\x1a\n'
                assert struct.unpack_from('<I', ktx, 40)[0] > 1
    old = head_json(PACK / 'ids.lock.json')
    lock = json.loads((PACK / 'ids.lock.json').read_text())
    for field, values in old.items():
        if isinstance(values, dict):
            assert all(lock[field][k] == v for k, v in values.items())
    new = {k: v for k, v in lock['sprites'].items() if k not in old['sprites']}
    assert set(new) == set(report['plants']) | spring_roads
    report['appended_ids'] = [min(new.values()), max(new.values())]
    assert sorted(new.values()) == list(range(max(old['sprites'].values()) + 1, max(new.values()) + 1))
    return report


def preview(pack, rows, path, plants=False):
    cellw, cellh, label = (280, 300, 140) if plants else (280, 155, 140)
    out = Image.new('RGB', (label + cellw * 4, 52 + cellh * len(rows)), '#303a42')
    d = ImageDraw.Draw(out)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
    for i, season in enumerate(['Summer', 'Fall', 'Winter', 'Spring']):
        d.text((label + i * cellw + 95, 16), season, font=font, fill='#fff3db')
    for row, key in enumerate(rows):
        y = 52 + row * cellh
        d.text((8, y + cellh // 2), key.replace('road_', ''), font=font, fill='#fff3db')
        for col, suffix in enumerate(['', '_fall', '_winter', '_spring']):
            if key + suffix not in pack.sp:
                d.text((label + col * cellw + 95, y + cellh // 2), 'Evergreen', font=font, fill='#9faeae')
                continue
            scale = 2 if pack.at[pack.sp[key + suffix]['atlas']].get('pages') else 1
            fr = pack.frame(key + suffix, scale=scale)
            if suffix and plants:
                fr = unpad(fr, scale)
            if scale == 1:
                fr = fr.resize((fr.width * 2, fr.height * 2), Image.Resampling.NEAREST)
            # Native 2x art for large oak, 2x enlarged little sprites, NN for crisp edges.
            zoom = min(2 if plants else 2, (cellw - 20) / fr.width, (cellh - 25) / fr.height)
            fr = fr.resize((round(fr.width * zoom), round(fr.height * zoom)), Image.Resampling.NEAREST)
            out.paste(fr, (label + col * cellw + (cellw - fr.width) // 2, y + cellh - 10 - fr.height), fr)
    out.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    root = Pack(PACK / 'manifest.json')
    nature = Pack(PACK / 'nature/manifest.nature.json')
    report = verify(root, nature, args.baseline)
    preview(root, KEYS, OUT / 'spring_plants_compare.png', plants=True)
    preview(nature, ['road_path', 'road_gravel', 'road_paved'], OUT / 'spring_roads_compare.png')
    (OUT / 'spring_qa.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: len(v) if isinstance(v, list) and k != 'appended_ids' else v for k, v in report.items()}, indent=2))


if __name__ == '__main__':
    main()
