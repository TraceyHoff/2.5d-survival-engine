# Tiny supersampled vector painter: every part gets a soft gradient fill + bold darker outline (cartoony icon look).
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops
def hx(c):
    if isinstance(c, tuple): return c
    c = c.lstrip('#'); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))
def mix(a, b, t): a, b = hx(a), hx(b); return tuple(int(a[i] + (b[i]-a[i])*t) for i in range(3))
def lt(c, t=0.3): return mix(c, (255, 250, 235), t)
def dk(c, t=0.3): return mix(c, (40, 22, 40), t)
class C:
    def __init__(s, n=32, S=8):
        s.n, s.S = n, S; s.W = n*S; s.img = Image.new('RGBA', (s.W, s.W), (0, 0, 0, 0)); s.ow = 1.0
        yy, xx = np.mgrid[0:s.W, 0:s.W].astype(np.float32); s.yy, s.xx = yy, xx
    def P(s, pts): return [(x*s.S, y*s.S) for x, y in pts]
    def _mask(s, fn):
        m = Image.new('L', (s.W, s.W), 0); fn(ImageDraw.Draw(m)); return m
    def _paint(s, m, col, ol=True, shade=0.28, ang=(0.6, 0.8), owf=1.0, olc=None):
        col = hx(col)
        if ol:
            r = max(1, int(s.S*s.ow*owf)); d = m.filter(ImageFilter.MaxFilter(2*r+1))
            s.img.alpha_composite(Image.composite(Image.new('RGBA', m.size, olc and hx(olc)+(255,) or dk(col, 0.62)+(255,)), Image.new('RGBA', m.size, (0,)*4), d))
        bb = m.getbbox()
        if not bb: return
        x0, y0, x1, y1 = bb
        t = ((s.xx-x0)/max(1, x1-x0)*ang[0] + (s.yy-y0)/max(1, y1-y0)*ang[1]) / (ang[0]+ang[1])
        t = np.clip(t, 0, 1)[..., None]
        L, D = np.array(lt(col, shade), np.float32), np.array(dk(col, shade*0.9), np.float32)
        rgb = np.where(t < 0.5, L + (np.array(col, np.float32)-L)*(t*2), np.array(col, np.float32) + (D-np.array(col, np.float32))*((t-0.5)*2))
        a = np.array(m, np.float32)[..., None]
        layer = Image.fromarray(np.concatenate([rgb, a], -1).astype(np.uint8), 'RGBA'); s.img.alpha_composite(layer)
    def poly(s, pts, col, **k): s._paint(s._mask(lambda d: d.polygon(s.P(pts), fill=255)), col, **k)
    def ell(s, cx, cy, rx, ry, col, **k): s._paint(s._mask(lambda d: d.ellipse([(cx-rx)*s.S, (cy-ry)*s.S, (cx+rx)*s.S, (cy+ry)*s.S], fill=255)), col, **k)
    def rect(s, x0, y0, x1, y1, col, r=0, **k): s._paint(s._mask(lambda d: d.rounded_rectangle([x0*s.S, y0*s.S, x1*s.S, y1*s.S], radius=r*s.S, fill=255)), col, **k)
    def stroke(s, pts, w, col, **k):
        def f(d):
            p = s.P(pts); d.line(p, fill=255, width=int(w*s.S), joint='curve')
            for x, y in (p[0], p[-1]): d.ellipse([x-w*s.S/2, y-w*s.S/2, x+w*s.S/2, y+w*s.S/2], fill=255)
        s._paint(s._mask(f), col, **k)
    # unoutlined detail ink
    def line(s, pts, w, col, a=255):
        L = Image.new('RGBA', s.img.size, (0,)*4); ImageDraw.Draw(L).line(s.P(pts), fill=hx(col)+(a,), width=max(1, int(w*s.S)), joint='curve'); s.img.alpha_composite(L)
    def dot(s, x, y, r, col, a=255):
        L = Image.new('RGBA', s.img.size, (0,)*4); ImageDraw.Draw(L).ellipse([(x-r)*s.S, (y-r)*s.S, (x+r)*s.S, (y+r)*s.S], fill=hx(col)+(a,)); s.img.alpha_composite(L)
    def shine(s, x, y, r=0.9, a=200): s.dot(x, y, r, (255, 255, 250), a)
    def shadow(s, cx, cy, rx, ry, a=70):
        L = Image.new('RGBA', s.img.size, (0,)*4); ImageDraw.Draw(L).ellipse([(cx-rx)*s.S, (cy-ry)*s.S, (cx+rx)*s.S, (cy+ry)*s.S], fill=(30, 20, 40, a))
        s.img.alpha_composite(L.filter(ImageFilter.GaussianBlur(s.S*0.8)))
    def out(s, px):
        im = s.img.resize((px, px), Image.LANCZOS)
        a = np.array(im); al = a[..., 3].astype(np.float32); a[..., 3] = np.clip((al-20)*1.12, 0, 255).astype(np.uint8); return Image.fromarray(a)
