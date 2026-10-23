"""Uniform-grid atlas writer: PNG + TexturePacker-hash JSON (+ optional emissive page) + individual frames."""
import json, os, numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def write_atlas(key, frames, fw, fh, cols, category, pivot, emissive_frames=None, emissive_pred=None, frame_dir=None):
    """frames: list of (name, Image|None). Returns engine AtlasJson."""
    n = len(frames); rows = (n + cols - 1) // cols
    sheet = Image.new("RGBA", (fw * cols, fh * rows), (0, 0, 0, 0))
    has_em = emissive_pred is not None or any(len(f) > 2 and f[2] and f[2].get("emissive") is not None for f in frames)
    em = Image.new("RGBA", sheet.size, (0, 0, 0, 0)) if has_em else None
    tp = {"frames": {}, "meta": {"app": "cozy-wild tools/build_all.py", "version": "1.0", "image": f"{key}.png", "format": "RGBA8888",
                                  "size": {"w": sheet.width, "h": sheet.height}, "scale": "1", "grid": {"frameW": fw, "frameH": fh, "columns": cols, "rows": rows}}}
    fdir = os.path.join(ROOT, "sprites", category, frame_dir or key); os.makedirs(fdir, exist_ok=True)
    for i, fr in enumerate(frames):
        name, im = fr[0], fr[1]; extra = fr[2] if len(fr) > 2 and fr[2] else {}
        if im is None: continue
        assert im.size == (fw, fh), (key, name, im.size)
        x, y = (i % cols) * fw, (i // cols) * fh
        sheet.alpha_composite(im, (x, y))
        piv = pivot(name) if callable(pivot) else pivot
        tp["frames"][name] = {"frame": {"x": x, "y": y, "w": fw, "h": fh}, "rotated": False, "trimmed": False,
                              "spriteSourceSize": {"x": 0, "y": 0, "w": fw, "h": fh}, "sourceSize": {"w": fw, "h": fh},
                              "pivot": {"x": piv[0], "y": piv[1]}, "index": i}
        if extra.get("hand"): tp["frames"][name]["hand"] = extra["hand"]
        im.save(os.path.join(fdir, f"{name}.png"))
        if extra.get("emissive") is not None: em.alpha_composite(extra["emissive"], (x, y))
        elif em is not None and emissive_pred is not None and (emissive_frames is None or i in emissive_frames):
            a = np.asarray(im).astype(np.float32); m = emissive_pred(a)
            out = a.copy(); out[..., 3] = out[..., 3] * m
            em.alpha_composite(Image.fromarray(out.astype(np.uint8)), (x, y))
    os.makedirs(os.path.join(ROOT, "atlases"), exist_ok=True)
    sheet.save(os.path.join(ROOT, "atlases", f"{key}.png"), optimize=True)
    json.dump(tp, open(os.path.join(ROOT, "atlases", f"{key}.json"), "w"), indent=1)
    entry = {"key": key, "image": f"atlases/{key}.png", "frameW": fw, "frameH": fh, "columns": cols, "rows": rows}
    if em is not None:
        em.save(os.path.join(ROOT, "atlases", f"{key}_emissive.png"), optimize=True); entry["emissive"] = True
    return entry, sheet

def warm_glow_pred(a):
    """fire-like pixels: bright, red>green>blue, saturated."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 200) & (g > 70) & (b < 170) & (r - b > 90)
    return m.astype(np.float32)

def cool_glow_pred(a):
    """eerie cyan glow pixels (glow mushrooms, lanterns)."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (g > 180) & (b > 160) & (r < 200) & (g - r > 40)
    return m.astype(np.float32)

def both_glow(a): return np.maximum(warm_glow_pred(a), cool_glow_pred(a))
