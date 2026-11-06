"""Spring-only page encoding. Never scans or rewrites other atlases."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image

TOKTX = Path('/tmp/ktx/out/KTX-Software-4.4.2-Linux-x86_64/bin/toktx')


def dilate(im):
    """Push-pull colour under transparent texels; alpha is never modified."""
    a = np.asarray(im, dtype=np.float32)
    rgb, al = a[..., :3], a[..., 3]
    w = (al > 0).astype(np.float32)
    if w.all() or not w.any():
        return im
    pyr = [(rgb * w[..., None], w)]
    while min(pyr[-1][1].shape) > 1:
        c, ww = pyr[-1]
        h, width = ww.shape
        h2, w2 = (h + 1) // 2, (width + 1) // 2
        cp = np.zeros((h2 * 2, w2 * 2, 3), np.float32)
        wp = np.zeros((h2 * 2, w2 * 2), np.float32)
        cp[:h, :width], wp[:h, :width] = c, ww
        pyr.append((cp.reshape(h2, 2, w2, 2, 3).sum((1, 3)), wp.reshape(h2, 2, w2, 2).sum((1, 3))))
    c, ww = pyr[-1]
    col = c / np.maximum(ww, 1e-6)[..., None]
    for c, ww in reversed(pyr[:-1]):
        h, width = ww.shape
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)[:h, :width]
        col = np.where(ww[..., None] > 0, c / np.maximum(ww, 1e-6)[..., None], up)
    out = a.copy()
    out[..., :3][al == 0] = col[al == 0]
    return Image.fromarray(np.clip(out + .5, 0, 255).astype(np.uint8))


def encode_atlas(base, atlas):
    """Encode exactly the passed new spring atlas, including its optional sway mask."""
    assert atlas['key'].endswith('_spring'), atlas['key']
    env = {**os.environ, 'LD_LIBRARY_PATH': str(TOKTX.parent.parent / 'lib')}
    for record in [atlas] + atlas.get('pages', []):
        src = Path(base) / record['image']
        dst = src.with_suffix('.ktx2')
        with tempfile.TemporaryDirectory(prefix='spring-ktx-') as td:
            tmp = Path(td) / 'dilated.png'
            dilate(Image.open(src).convert('RGBA')).save(tmp)
            subprocess.run([str(TOKTX), '--t2', '--genmipmap', '--assign_oetf', 'srgb', '--encode', 'etc1s', '--clevel', '2', '--qlevel', '192', str(dst), str(tmp)], env=env, check=True, capture_output=True)
        record['ktx2'] = str(dst.relative_to(base))
    for mask, path in atlas.get('masks', {}).items():
        src = Path(base) / path
        dst = src.with_suffix('.ktx2')
        subprocess.run([str(TOKTX), '--t2', '--genmipmap', '--assign_oetf', 'linear', '--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '0.5', '--zcmp', '19', str(dst), str(src)], env=env, check=True, capture_output=True)
        atlas.setdefault('masksKtx2', {})[mask] = str(dst.relative_to(base))


def merge_owned(path, atlases, sprites, indent):
    """Replace only this pass's exact keys; leave every unrelated record intact."""
    m = json.loads(Path(path).read_text())
    for field, values in [('atlases', atlases), ('sprites', sprites)]:
        own = {v['key'] for v in values}
        m[field] = [v for v in m[field] if v['key'] not in own] + values
    Path(path).write_text(json.dumps(m, indent=indent, ensure_ascii=False) + '\n')
