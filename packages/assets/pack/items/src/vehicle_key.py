# vehicle_key icon (items_icons cell 199), moved verbatim from assets/tools/adr108_art.py key_icon (29ef4c0).
# Uses the repo's toon painter (assets/tools), not draw.C, so it stays pixel-identical to the committed cell.
import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../../assets/tools')))
from palette import ramp
from toon import Canvas, ellipse_pts, capsule_pts
def key_icon(S):
    k = S / 32; cv = Canvas(S, S, seed=7)
    hx, hy = 11 * k, 12 * k
    cv.part(capsule_pts(hx + 5 * k, hy + 4 * k, 23 * k, 20 * k, 2.2 * k), "gold", lw=1.0 * k, shade=0.3, hl=0.3)
    for t in (0.55, 0.78): x, y = hx + 5 * k + (12 * k) * t, hy + 4 * k + 8 * k * t + 1.2 * k; cv.part([(x - 1 * k, y), (x + 1.6 * k, y + 0.4 * k), (x + 1.2 * k, y + 3 * k), (x - 1.2 * k, y + 2.6 * k)], "gold", lw=0.8 * k, shade=0.3, hl=0.2)
    cv.part(ellipse_pts(hx, hy, 7.5 * k, 7 * k, n=28), "cloth_red", lw=1.0 * k, shade=0.3, hl=0.3, gloss=[(hx - 2.5 * k, hy - 2.5 * k, 1.6 * k, 1.1 * k)])
    cv.fill(ellipse_pts(hx - 2.4 * k, hy - 1.6 * k, 2.3 * k, 1.6 * k, n=12), ramp("ink")[2])   # tiny car window
    cv.fill(ellipse_pts(hx + 2.4 * k, hy - 1.6 * k, 2.3 * k, 1.6 * k, n=12), ramp("ink")[2])
    cv.part(ellipse_pts(hx, hy + 3 * k, 3.2 * k, 1.3 * k, n=12), "cloth_cream", lw=0.5 * k, shade=0.1)
    cv.part(ellipse_pts(hx + 6 * k, hy - 6 * k, 2.6 * k, 2.6 * k, n=14), "iron", lw=0.8 * k, shade=0.3, hl=0.3)   # ring
    cv.fill(ellipse_pts(hx + 6 * k, hy - 6 * k, 1.2 * k, 1.2 * k, n=10), ramp("ink")[1])
    return np.asarray(cv.final()).copy()
def render(): return Image.fromarray(key_icon(64), 'RGBA'), Image.fromarray(key_icon(32), 'RGBA')
