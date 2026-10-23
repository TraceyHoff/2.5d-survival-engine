"""9-slice drawing for previews (mirrors what the runtime does)."""
from PIL import Image


def nine(img: Image.Image, insets, w: int, h: int, scale: int = 1) -> Image.Image:
    l, t, r, b = [int(round(v * scale)) for v in insets]
    W, H = img.size
    w, h = max(int(w), l + r + 1), max(int(h), t + b + 1)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    xs = [(0, l, 0, l), (l, W - r, l, w - r), (W - r, W, w - r, w)]
    ys = [(0, t, 0, t), (t, H - b, t, h - b), (H - b, H, h - b, h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if sx1 <= sx0 or sy1 <= sy0 or dx1 <= dx0 or dy1 <= dy0:
                continue
            piece = img.crop((sx0, sy0, sx1, sy1))
            if (dx1 - dx0, dy1 - dy0) != piece.size:
                piece = piece.resize((dx1 - dx0, dy1 - dy0), Image.BILINEAR)
            out.alpha_composite(piece, (dx0, dy0))
    return out
