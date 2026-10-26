"""Cel post pass shared by the toon kit (assets/tools/toon.py) and the items painter (pack/items/src/draw.py).
Enabled with CEL=1 in the environment (default off, so plain rebuilds reproduce the committed art).
snap(): every figure pixel snaps to a colour the painter actually drew (flat fills, one hard shade, a hard highlight,
the bold outline) and alpha goes binary; translucent contact-shadow pixels (SHADOW tones) are left soft on purpose."""
import os
import numpy as np
from PIL import Image
CEL = os.environ.get("CEL") == "1"
SHADOWS = [(0x2a, 0x1b, 0x2e), (30, 20, 40)]   # toon SHADOW, draw.C.shadow ink
def snap(im, pal, shadows=SHADOWS):
    a = np.asarray(im.convert("RGBA")).astype(np.float32); rgb, al = a[..., :3], a[..., 3]
    P = np.array(sorted({tuple(int(v) for v in c[:3]) for c in pal}), np.float32)
    S = np.array(shadows, np.float32)
    sh = (al < 200) & (np.abs(rgb[..., None, :] - S[None, None]).sum(-1).min(-1) < 70)
    out = np.zeros_like(a); fig = (al >= 128) & ~sh
    if len(P):
        q = np.empty_like(rgb)
        for y0 in range(0, rgb.shape[0], 64):   # chunked: big pages
            r = rgb[y0:y0 + 64]; q[y0:y0 + 64] = P[((r[..., None, :] - P[None, None]) ** 2).sum(-1).argmin(-1)]
    else: q = rgb
    out[fig, :3] = q[fig]; out[fig, 3] = 255
    out[sh, :] = a[sh]                           # soft contact shadow kept as drawn
    return Image.fromarray(out.astype(np.uint8), "RGBA")
