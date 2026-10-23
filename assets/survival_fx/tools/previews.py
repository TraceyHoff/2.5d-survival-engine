"""Previews: contact sheet per category, day/night strip (graded in Python), status-effects sheet, food grid, GIFs."""
import json, math, os, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from fxlib import ROOT, OUT_BUILD, pnoise
import gen_daynight as DN

PV = os.path.join(ROOT, "preview"); os.makedirs(PV, exist_ok=True)
A = "/workspace/assets"
def font(sz, bold=False):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",):
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
F, FB, FS = font(12), font(14, True), font(10)
CREAM = (246, 234, 210); INK = (59, 36, 51)

# ---------- sprite access (fragment + main pack) ----------
FRAG = json.load(open(os.path.join(ROOT, "manifest.fragment.json")))
MAIN = json.load(open(os.path.join(A, "manifest.json"))) if os.path.exists(os.path.join(A, "manifest.json")) else {"atlases": [], "sprites": []}
_img = {}
def page(path):
    if path not in _img: _img[path] = Image.open(os.path.join(A, path)).convert("RGBA") if os.path.exists(os.path.join(A, path)) else None
    return _img[path]
FLAME_RGB = (1.0, 0.6, 0.29)   # natural flame light (#ff9a4a)
_CLAIMS = os.path.join(ROOT, "key_claims.json")
ALIAS = json.load(open(_CLAIMS))["emitted"] if os.path.exists(_CLAIMS) else {}
def find(key):
    if key in ALIAS:  # gameplay key emitted under a fallback key (collision with the main pack)
        for s in FRAG["sprites"]:
            if s["key"] == ALIAS[key]: return s, next(a for a in FRAG["atlases"] if a["key"] == s["atlas"]), True
    for m in (FRAG, MAIN):
        for s in m["sprites"]:
            if s["key"] == key: return s, next(a for a in m["atlases"] if a["key"] == s["atlas"]), m is FRAG
    raise KeyError(key)
def frame(key, anim=None, i=0, d=0, hi=False, emissive=False):
    s, a, mine = find(key)
    an = s["animations"][anim] if anim else list(s["animations"].values())[0]
    f = an["frames"][i % len(an["frames"])] + d * an.get("dirStride", a["columns"]) * (1 if an.get("directions", 1) > 1 else 0)
    img = a["image"]; k = 1
    if hi and mine: img = next(pg["image"] for pg in a["pages"] if pg["scale"] == 2); k = 2
    if emissive: img = img.replace(".png", "_emissive.png")
    p = page(img)
    if p is None: return None, (0, 0)
    fw, fh = a["frameW"] * k, a["frameH"] * k; x, y = (f % a["columns"]) * fw, (f // a["columns"]) * fh
    anc = s.get("anchor", {"x": 0.5, "y": 0.9})
    return p.crop((x, y, x + fw, y + fh)), (int(round(anc["x"] * fw)), int(round(anc["y"] * fh)))
def nframes(key, anim): s, _, _ = find(key); return len(s["animations"][anim]["frames"])
def blit(dst, key, x, y, anim=None, i=0, d=0, emis=None, alpha=1.0):
    im, (ax, ay) = frame(key, anim, i, d)
    if im is None: return
    if alpha < 1: a = np.asarray(im).copy(); a[..., 3] = (a[..., 3] * alpha).astype(np.uint8); im = Image.fromarray(a)
    dst.alpha_composite(im, (int(x - ax), int(y - ay)))
    if emis is not None:
        try:
            e, _ = frame(key, anim, i, d, emissive=True)
            if e is not None: emis.alpha_composite(e, (int(x - ax), int(y - ay)))
        except Exception: pass

def checker(w, h, c1=(250, 243, 228), c2=(240, 230, 210), s=8):
    y, x = np.mgrid[0:h, 0:w]; m = ((x // s + y // s) % 2)[..., None]
    return Image.fromarray(np.where(m, c1, c2).astype(np.uint8), "RGB").convert("RGBA")

# ---------- contact sheets ----------
def contact(name, title, dark=False):
    d = json.load(open(os.path.join(OUT_BUILD, name + ".json")))
    rows = []
    for p in d["parts"]:
        for s in p["sprites"]:
            for an, a in s["animations"].items(): rows.append((p["atlas"]["key"], s["key"], an, len(a["frames"]), p["atlas"].get("emissive", False)))
    # layout: label column + frames at 2x atlas
    cells = []
    for (atl, key, an, n, em) in rows:
        ims = [frame(key, an, i, hi=True)[0] for i in range(min(n, 16))]
        ems = [frame(key, an, 0, hi=True, emissive=True)[0]] if em else []
        cells.append((f"{key} / {an}  ({n}f)", ims, ems))
    maxw = 1600; pad = 6; y = 40; layout = []
    for lab, ims, ems in cells:
        w0 = ims[0].width; h0 = ims[0].height; sc = 1 if h0 <= 160 else 0.5 if h0 <= 320 else 0.25
        if w0 * sc > 400: sc = min(sc, 400 / w0)
        ww, hh = int(w0 * sc), int(h0 * sc); x = 230; per = max(1, (maxw - x) // (ww + pad))
        nrow = math.ceil((len(ims) + len(ems)) / per)
        layout.append((lab, ims, ems, ww, hh, per, y)); y += nrow * (hh + pad) + 10
    tex = [t for t in d["textures"] if t.endswith(".png") and "lut_" not in t]
    th = 140 if tex else 0
    H = y + (th + 30) * math.ceil(len(tex) / 8) + 10
    bg = checker(maxw, H, (52, 46, 74), (44, 39, 64)) if dark else checker(maxw, H)
    dr = ImageDraw.Draw(bg); fg = (240, 232, 220) if dark else INK
    dr.text((10, 10), title, font=FB, fill=fg)
    for lab, ims, ems, ww, hh, per, y0 in layout:
        dr.text((10, y0 + hh // 2 - 7), lab, font=F, fill=fg)
        for j, im in enumerate(ims + ems):
            x = 230 + (j % per) * (ww + pad); yy = y0 + (j // per) * (hh + pad)
            im2 = im.resize((ww, hh), Image.LANCZOS) if (ww, hh) != im.size else im
            if j >= len(ims):
                box = Image.new("RGBA", (ww, hh), (20, 16, 30, 255)); box.alpha_composite(im2); im2 = box
                dr.text((x, yy - 1), "emissive", font=FS, fill=(255, 200, 120))
            bg.alpha_composite(im2, (x, yy))
    y = layout[-1][6] + layout[-1][4] + 30 if layout else 40
    for j, t in enumerate(tex):
        im = Image.open(os.path.join(ROOT, t)).convert("RGBA"); im.thumbnail((th, th))
        x = 10 + (j % 8) * (maxw // 8); yy = y + (j // 8) * (th + 30)
        box = checker(im.width, im.height, (90, 90, 110), (70, 70, 90), 6); box.alpha_composite(im)
        bg.alpha_composite(box, (x, yy)); dr.text((x, yy + im.height + 2), os.path.basename(t), font=FS, fill=fg)
    out = os.path.join(PV, f"contact_{name}.png"); bg.convert("RGB").save(out); return out

# ---------- scene + grading simulation ----------
def ground(w, h, key="tile_grass", ox=0, oy=0, alt=("tile_grass_b", "tile_grass_c")):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); rng = np.random.default_rng(3)
    for ty in range(-2, h // 16 + 3):
        for tx in range(-1, w // 64 + 2):
            x = tx * 64 + (32 if ty % 2 else 0) + ox; y = ty * 16 + oy
            k = key if rng.random() > 0.35 else alt[rng.integers(0, len(alt))]
            try: blit(img, k, x, y)
            except KeyError: blit(img, key, x, y)
    return img

def shadow(img, x, y, rx, ry, col=(42, 27, 46), a=0.3):
    m = Image.new("L", img.size, 0); ImageDraw.Draw(m).ellipse([x - rx, y - ry, x + rx, y + ry], fill=int(255 * a)); m = m.filter(ImageFilter.GaussianBlur(1.5))
    lay = Image.new("RGBA", img.size, col + (0,)); lay.putalpha(m); img.alpha_composite(lay)

def light_map(w, h, ambient, lights, daylight):
    L = np.zeros((h, w, 3), np.float32) + np.array(ambient, np.float32)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    scale = 0.25 + 0.75 * (1 - daylight)   # daylightLightScale ~0.25
    for (lx, ly, r, col, inten) in lights:
        d = ((x - lx) / r) ** 2 + ((y - ly) / (r * 0.5)) ** 2
        att = np.clip(1 - d, 0, 1) ** 2 + np.exp(-d * 9) * 0.6 * (d < 1)
        L += att[..., None] * np.array(col, np.float32) * inten * scale
    return L

def grade_scene(scene, emis, key, lights, style=None):
    st = {"bands": 4, "bandMix": 0.55, "nightMin": 0.30, "nightTint": np.array([0.55, 0.58, 0.95])}
    w, h = scene.size; s = np.asarray(scene.convert("RGB"), np.float32) / 255
    e = np.asarray(emis, np.float32)[..., 3:4] / 255 if emis is not None else 0
    daylight = max(0.0, min(1.0, math.sin(max(0, key["sunElevationDeg"]) / 90 * math.pi / 2) * 1.6))
    L = light_map(w, h, key["ambient"], lights, daylight)
    ll = (L * [0.299, 0.587, 0.114]).sum(-1, keepdims=True)
    nt = st["nightTint"] * (st["nightMin"] / (st["nightTint"] @ [0.299, 0.587, 0.114]))
    L = np.where(ll < st["nightMin"], L * (ll / st["nightMin"]) + nt * (1 - ll / st["nightMin"]), L)
    q = np.floor(L * st["bands"] + 0.5) / st["bands"]; L = L * (1 - st["bandMix"]) + q * st["bandMix"]
    col = s * L * (1 - e) + s * e   # emissive bypasses scene lighting (engine d30cdda)
    fog = np.array(DN.h2f(key["fogTint"])); col = col * 0.93 + fog * 0.07 * (0.3 + 0.7 * min(1, sum(key["ambient"]) / 3))
    lut = Image.open(os.path.join(ROOT, f"lut/lut_{key['name']}.png")).convert("RGB")
    col = DN.apply_lut(np.clip(col, 0, 1), lut)
    vg = np.asarray(Image.open(os.path.join(ROOT, "textures/night_vignette_512.png")).convert("RGBA").resize((w, h), Image.BILINEAR), np.float32) / 255
    va = vg[..., 3:4] * key["vignette"]; col = col * (1 - va) + vg[..., :3] * va
    return Image.fromarray((np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")

def small_scene(t=0):
    w, h = 220, 140; sc = ground(w, h, oy=0); em = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shadow(sc, 62, 112, 18, 6); shadow(sc, 128, 116, 10, 3.5)
    blit(sc, "glow_mushrooms", 30, 132, emis=em) if any(s["key"] == "glow_mushrooms" for s in MAIN["sprites"]) else None
    blit(sc, "prop_glow_mushroom_c", 196, 78, i=t, emis=em)
    blit(sc, "tree", 62, 112, emis=em)
    blit(sc, "player", 128, 116, anim="idle", i=t % 4, d=1, emis=em) if any(s["key"] == "player" for s in MAIN["sprites"]) else None
    blit(sc, "campfire", 168, 116, anim="idle", i=t, emis=em)
    lights = [(168, 104, 70, FLAME_RGB, 1.05), (196, 70, 26, (0.5, 0.95, 0.85), 0.5)]
    return sc, em, lights

def daynight_strip():
    keys = sorted(DN.KEYS, key=lambda k: (k["hour"] - 4) % 24)
    panels = []
    for k in keys:
        sc, em, lights = small_scene(0); g = grade_scene(sc, em, k, lights).resize((440, 280), Image.NEAREST)
        panels.append((k, g))
    W = 440 * 4 + 50; H = 2 * 310 + 60
    out = Image.new("RGB", (W, H), (34, 28, 48)); d = ImageDraw.Draw(out)
    d.text((10, 8), "Day/night grading (lighting + bands + night floor + LUT + vignette, simulated)", font=FB, fill=(240, 232, 220))
    for j, (k, g) in enumerate(panels):
        x = 10 + (j % 4) * 450; y = 36 + (j // 4) * 312
        out.paste(g, (x, y)); d.text((x + 4, y + 284), f"{k['name']}  {k['hour']:.1f}h  ambient {k['ambient']}", font=F, fill=(240, 232, 220))
    sc, em, _ = small_scene(0); raw = sc.convert("RGB").resize((440, 280), Image.NEAREST)
    x = 10 + 3 * 450; y = 36 + 312; out.paste(raw, (x, y)); d.text((x + 4, y + 284), "ungraded source", font=F, fill=(240, 232, 220))
    p = os.path.join(PV, "daynight_strip.png"); out.save(p)
    # LUT strip overview
    lw = Image.new("RGB", (256 * 2 + 160, 8 + len(DN.KEYS) * 40 + 40), (34, 28, 48)); d = ImageDraw.Draw(lw)
    for j, k in enumerate(DN.KEYS):
        l = Image.open(os.path.join(ROOT, f"lut/lut_{k['name']}.png")).resize((512, 32), Image.NEAREST); lw.paste(l, (150, 8 + j * 40)); d.text((8, 16 + j * 40), k["name"], font=F, fill=(240, 232, 220))
    t = Image.open(os.path.join(ROOT, "lut/tod_ramp_256x8.png")).resize((512, 32), Image.NEAREST); lw.paste(t, (150, 8 + len(DN.KEYS) * 40)); d.text((8, 16 + len(DN.KEYS) * 40), "tod_ramp 256x8", font=F, fill=(240, 232, 220))
    lw.save(os.path.join(PV, "luts.png"))
    return p

# ---------- status effects sheet ----------
def rim(im, color, width=1, alpha=0.8):
    a = np.asarray(im)[..., 3]
    m = Image.fromarray(a).filter(ImageFilter.MaxFilter(3 if width <= 1 else 5)); m = np.asarray(m).astype(np.float32)
    sh = np.roll(np.roll(m, 1, 0), 1, 1)  # bias top-left
    ring = np.clip(np.maximum(m, sh) - a, 0, 255) / 255 * alpha
    # inner rim (lit edge) too
    er = np.asarray(Image.fromarray(a).filter(ImageFilter.MinFilter(3)), np.float32); inner = np.clip(a - er, 0, 255) / 255 * alpha * 0.6
    out = np.asarray(im).astype(np.float32).copy(); c = np.array(color, np.float32)
    out[..., :3] = out[..., :3] * (1 - inner[..., None]) + c * inner[..., None]
    base = Image.fromarray(out.astype(np.uint8))
    rl = np.zeros(out.shape, np.float32); rl[..., :3] = c; rl[..., 3] = ring * 255
    r = Image.fromarray(rl.astype(np.uint8)); r.alpha_composite(base); return r

def tint(im, mul, sat=1.0, bright=1.0):
    a = np.asarray(im).astype(np.float32); c = a[..., :3] / 255
    l = (c * [0.299, 0.587, 0.114]).sum(-1, keepdims=True); c = l + (c - l) * sat
    c = c * np.array(mul) * bright; a[..., :3] = np.clip(c, 0, 1) * 255; return Image.fromarray(a.astype(np.uint8))

def wet(im, sheen, w=1.0, t=0):
    a = np.asarray(im).astype(np.float32); m = np.asarray(sheen).astype(np.float32) / 255
    c = a[..., :3] / 255; dark = 1 - (1 - np.array([0.80, 0.85, 0.97])) * (m[..., 1:2] * w * 0.9)
    c = c * dark; l = (c * [0.299, 0.587, 0.114]).sum(-1, keepdims=True); c = l + (c - l) * (1 + 0.1 * w)
    c = c + np.array([0.91, 0.965, 1.0]) * m[..., 0:1] * w * 0.35 * (0.8 + 0.2 * math.sin(t))
    a[..., :3] = np.clip(c, 0, 1) * 255; return Image.fromarray(a.astype(np.uint8))

def char_frames(kind):
    key = "player" if kind == "player" else next(s["key"] for s in MAIN["sprites"] if s["category"] == "zombie")
    s, a, _ = find(key); im, anc = frame(key, "idle", 0, 1)
    sheen_p = os.path.join(ROOT, "sheen", os.path.basename(a["image"]).replace(".png", "_sheen.png"))
    an = s["animations"]["idle"]; f = an["frames"][0] + 1 * an.get("dirStride", a["columns"])
    sh = Image.open(sheen_p).crop(((f % a["columns"]) * a["frameW"], (f // a["columns"]) * a["frameH"], (f % a["columns"] + 1) * a["frameW"], (f // a["columns"] + 1) * a["frameH"]))
    return key, im, anc, sh

def status_cell(kind, effect, t=0):
    W, H = 72, 96; cell = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    key, im, (ax, ay), sh = char_frames(kind)
    px, py = 36, 88
    if effect == "wet":
        for (pk, sz) in (("tile_ov_puddle_m", 0),): blit(cell, pk, px, py - 4)
        cell.alpha_composite(wet(im, sh, 1.0, t), (px - ax, py - ay))
        blit(cell, "fx_drip", px - 10, py - 40, i=t % 4); blit(cell, "fx_drip", px + 9, py - 28, i=(t + 2) % 4)
        blit(cell, "fx_splash_feet", px, py, i=t % 5)
    elif effect == "cold":
        ch = rim(tint(im, [0.92, 0.96, 1.08], 0.86), (207, 234, 255), 1, 0.85)
        dx = [0, 1, 0, -1][t % 4]
        cell.alpha_composite(ch, (px - ax + dx, py - ay)); blit(cell, "fx_icicles", px + dx, py - 50)
        blit(cell, "fx_breath_puff", px + 8, py - 28, i=t % 6)
    elif effect == "hot":
        hm = tint(im, [1.10, 0.95, 0.92], 1.08)
        # simulate shimmer: offset rows with RG noise
        rg = np.asarray(Image.open(os.path.join(ROOT, "textures/heat_shimmer_rg_128.png")).convert("RGB"), np.float32)
        arr = np.asarray(hm); out = arr.copy()
        for y in range(arr.shape[0]):
            o = (rg[(y + t * 3) % 128, 10, 0] - 128) / 127 * 1.2; out[y] = np.roll(arr[y], int(round(o)), 0)
        cell.alpha_composite(Image.fromarray(out), (px - ax, py - ay))
        blit(cell, "fx_sweat_drop", px - 9, py - 44, i=t % 4); blit(cell, "fx_sweat_drop", px + 10, py - 40, i=(t + 2) % 4)
    elif effect == "exhausted":
        ex = tint(im, [0.95, 0.94, 1.0], 0.78, 0.94); ex = ex.resize((ex.width, int(ex.height * 0.97)), Image.LANCZOS)
        cell.alpha_composite(ex, (px - ax, py - int(ay * 0.97))); blit(cell, "fx_tired_spiral", px, py - 46, i=t % 6)
    else:
        cell.alpha_composite(im, (px - ax, py - ay))
    return cell

def status_sheet():
    effects = ["normal", "wet", "cold", "hot", "exhausted"]
    S = 4; W = 72 * S; H = 96 * S
    out = Image.new("RGB", (len(effects) * (W + 10) + 10, 2 * (H + 30) + 60 + 150), CREAM); d = ImageDraw.Draw(out)
    d.text((10, 8), "Status effects (renderer-side tints/sheen/rim simulated + survival_fx particles)", font=FB, fill=INK)
    for r, kind in enumerate(("player", "zombie")):
        for c, e in enumerate(effects):
            bg = checker(72, 96, (200, 230, 160), (190, 222, 150), 8)
            bg.alpha_composite(status_cell(kind, e, 1))
            x = 10 + c * (W + 10); y = 36 + r * (H + 30)
            out.paste(bg.resize((W, H), Image.NEAREST), (x, y)); d.text((x + 4, y + H + 4), f"{kind}: {e}", font=F, fill=INK)
    # emote bubbles + badges row
    y = 36 + 2 * (H + 30)
    for j, k in enumerate(["fx_bubble_hungry", "fx_bubble_freezing", "fx_bubble_overheating", "fx_bubble_exhausted", "fx_zzz", "fx_sweat_swirl", "fx_icicles"]):
        im, _ = frame(k, i=1, hi=True); im = im.resize((128, 128), Image.NEAREST)
        bg = checker(128, 128, (200, 230, 160), (190, 222, 150), 16); bg.alpha_composite(im)
        out.paste(bg, (10 + j * 140, y)); d.text((10 + j * 140, y + 130), k, font=FS, fill=INK)
    p = os.path.join(PV, "status_effects.png"); out.save(p)
    # animated status gif
    frames = []
    for t in range(12):
        fr = Image.new("RGB", (5 * 72 * 3, 96 * 3), CREAM)
        for c, e in enumerate(effects):
            bg = checker(72, 96, (200, 230, 160), (190, 222, 150), 8); bg.alpha_composite(status_cell("player", e, t))
            fr.paste(bg.resize((216, 288), Image.NEAREST), (c * 216, 0))
        frames.append(fr)
    frames[0].save(os.path.join(PV, "status_effects.gif"), save_all=True, append_images=frames[1:], duration=110, loop=0)
    return p

# ---------- food grid ----------
def food_grid():
    from gen_food import FOODS, STAGES
    S = 64; out = Image.new("RGB", (150 + 4 * (S * 2 + 12) + 200, 50 + len(FOODS) * (S * 2 + 10) + 160), CREAM); d = ImageDraw.Draw(out)
    d.text((10, 10), "Food decay: fresh / stale / spoiling / rotten  (2x art shown at 2x, plus 1x inset)", font=FB, fill=INK)
    for j, st in enumerate(STAGES): d.text((150 + j * (S * 2 + 12) + 30, 32), st, font=F, fill=INK)
    for i, f in enumerate(FOODS):
        y = 50 + i * (S * 2 + 10); d.text((10, y + S - 8), f, font=F, fill=INK)
        for j, st in enumerate(STAGES):
            im, _ = frame(f"food_{f}", st, hi=True); im1, _ = frame(f"food_{f}", st)
            x = 150 + j * (S * 2 + 12); bg = checker(128, 128, (250, 243, 228), (240, 230, 210), 16); bg.alpha_composite(im.resize((128, 128), Image.NEAREST))
            out.paste(bg, (x, y)); out.paste(Image.alpha_composite(Image.new("RGBA", (32, 32), CREAM + (255,)), im1).convert("RGB"), (x + 96, y + 96))
    y = 50 + len(FOODS) * (S * 2 + 10); x = 150
    for k in ["food_badge_fresh", "food_badge_stale", "food_badge_spoiling", "food_badge_rotten", ("food_overlay_fuzz", "light"), ("food_overlay_fuzz", "heavy"), "food_overlay_stink", "fx_flies"]:
        key, an = (k if isinstance(k, tuple) else (k, None)); im, _ = frame(key, an, 1, hi=True)
        bg = checker(128, 128, (250, 243, 228), (240, 230, 210), 16); bg.alpha_composite(im.resize((128, 128), Image.NEAREST)); out.paste(bg, (x, y)); d.text((x, y + 130), key + (f"/{an}" if an else ""), font=FS, fill=INK); x += 140
    p = os.path.join(PV, "food_decay_grid.png"); out.save(p); return p

# ---------- GIFs ----------
def gif_campfire():
    k_dusk = next(k for k in DN.KEYS if k["name"] == "night"); frames = []
    for t in range(12):
        sc = ground(240, 110, oy=-4); em = Image.new("RGBA", sc.size, (0, 0, 0, 0))
        xs = [(40, "small"), (110, "medium"), (190, "large")]
        lights = []
        for x, s in xs:
            blit(sc, "campfire", x, 90, anim="idle" if s == "medium" else f"idle_{s}", i=t % 6, emis=em)
            fl = 1 + 0.08 * math.sin(t * 2.1 + x)
            lights.append((x, 80, {"small": 45, "medium": 62, "large": 80}[s] * fl, FLAME_RGB, 1.1))
            for j in range(2):  # ember particles
                ph = ((t / 12) + j * 0.5 + x * 0.01) % 1
                blit(sc, "fx_ember", x + math.sin(ph * 9 + j) * 4, 70 - ph * 50, i=t % 4, emis=em, alpha=1 - ph)
        g = grade_scene(sc, em, k_dusk, lights).resize((720, 330), Image.NEAREST); frames.append(g)
    day = next(k for k in DN.KEYS if k["name"] == "morning")
    for t in range(12):
        sc = ground(240, 110, oy=-4); em = Image.new("RGBA", sc.size, (0, 0, 0, 0))
        for x, (key, an) in [(30, ("torch_stand", "idle")), (80, ("lantern", "idle")), (140, ("heat_brazier", "idle")), (200, ("campfire", "idle_large"))]:
            blit(sc, key, x, 90, anim=an, i=t % nframes(key, an), emis=em)
        frames.append(grade_scene(sc, em, day, []).resize((720, 330), Image.NEAREST))
    frames[0].save(os.path.join(PV, "campfire.gif"), save_all=True, append_images=frames[1:], duration=100, loop=0)
    return os.path.join(PV, "campfire.gif")

def gif_rain():
    key = next(k for k in DN.KEYS if k["name"] == "morning"); key = dict(key, ambient=[0.72, 0.76, 0.86], saturation=0.9)
    rain = Image.open(os.path.join(ROOT, "textures/rain_streak_tile_128x256.png")).convert("RGBA")
    W, H = 240, 150; frames = []; rng = np.random.default_rng(5); spl = [(rng.random() * W, 30 + rng.random() * (H - 30), rng.integers(0, 5)) for _ in range(14)]
    base = ground(W, H, key="tile_dirt", alt=("tile_grass",)); wetl = Image.new("RGBA", (W, H))
    for ty in range(-2, H // 16 + 3):
        for tx in range(-1, W // 64 + 2): blit(wetl, "tile_ov_wet_ground", tx * 64 + (32 if ty % 2 else 0), ty * 16)
    base.alpha_composite(wetl)
    for t in range(12):
        sc = base.copy()
        for (x, y, sz) in ((60, 70, "l"), (170, 110, "m"), (200, 50, "s")):
            blit(sc, f"tile_ov_puddle_{sz}", x, y); blit(sc, f"tile_ov_puddle_{sz}", x, y, anim="ripple", i=(t + x) % 6)
        key_c, im, (ax, ay), sh = char_frames("player")
        shadow(sc, 120, 100, 10, 3.5); sc.alpha_composite(wet(im, sh, 1.0, t), (120 - ax, 100 - ay))
        blit(sc, "fx_drip", 112, 62 + (t % 4), i=t % 4); blit(sc, "fx_drip", 128, 74, i=(t + 2) % 4); blit(sc, "fx_splash_feet", 120, 100, i=t % 5)
        for (x, y, ph) in spl: blit(sc, "fx_rain_splash_crown", x, y, i=(t + ph) % 5)
        # rain layer: tile texture scrolled + sheared
        lay = Image.new("RGBA", (W + 128, H)); off = (t * 70) % 256
        for xx in range(0, W + 128, 128):
            for yy in range(-256, H + 256, 256): lay.alpha_composite(rain, (xx, yy + off))
        lay = lay.transform((W, H), Image.AFFINE, (1, -0.12, 20, 0, 1, 0), Image.BILINEAR)
        a = np.asarray(lay).copy(); a[..., 3] = np.clip(a[..., 3] * 0.75, 0, 255).astype(np.uint8); sc.alpha_composite(Image.fromarray(a))
        frames.append(grade_scene(sc, None, key, []).resize((720, 450), Image.NEAREST))
    frames[0].save(os.path.join(PV, "rain.gif"), save_all=True, append_images=frames[1:], duration=90, loop=0)
    return os.path.join(PV, "rain.gif")

def gif_snow():
    key = next(k for k in DN.KEYS if k["name"] == "morning"); key = dict(key, ambient=[0.9, 0.93, 1.0])
    W, H = 240, 150; base = ground(W, H)
    cov = Image.new("RGBA", (W, H))
    # snow on the upper-left half of the map, edge autotiles on the boundary
    def snowy(tx, ty): return tx + ty * 0.5 < 2.6
    for ty in range(-2, H // 16 + 3):
        for tx in range(-1, W // 64 + 2):
            x = tx * 64 + (32 if ty % 2 else 0); y = ty * 16
            # iso neighbour coords on the staggered layout
            gx, gy = tx + (0.5 if ty % 2 else 0), ty
            if snowy(gx, gy * 0.5): blit(cov, "tile_ov_snow_cover", x, y)
            else:
                m = 0
                if snowy(gx + 0.5, (gy + 1) * 0.5): m |= 1
                if snowy(gx - 0.5, (gy + 1) * 0.5): m |= 2
                if snowy(gx - 0.5, (gy - 1) * 0.5): m |= 4
                if snowy(gx + 0.5, (gy - 1) * 0.5): m |= 8
                if m: blit(cov, "tile_ov_snow_edge", x, y, i=m)
    base.alpha_composite(cov); rng = np.random.default_rng(2)
    fl = [(rng.random() * W, rng.random() * H, rng.integers(0, 6), 0.6 + rng.random() * 0.8) for _ in range(46)]
    frames = []
    for t in range(16):
        sc = base.copy(); blit(sc, "tile_ov_frost", 180, 100, alpha=0.7)
        key_c, im, (ax, ay), sh = char_frames("player")
        ch = rim(tint(im, [0.92, 0.96, 1.08], 0.86), (207, 234, 255), 1, 0.85); dx = [0, 1, 0, -1][t % 4] if t % 8 < 4 else 0
        shadow(sc, 120, 104, 10, 3.5); sc.alpha_composite(ch, (120 - ax + dx, 104 - ay)); blit(sc, "fx_icicles", 120 + dx, 54)
        blit(sc, "fx_breath_puff", 128, 76, i=t % 8 if t % 8 < 6 else 5, alpha=1.0 if t % 8 < 6 else 0.0)
        for (x, y, k, sp) in fl:
            yy = (y + t * 6 * sp) % H; xx = (x + math.sin((t + x) * 0.4) * 3 + t * 1.5) % W
            blit(sc, "fx_snowflake", xx, yy, i=k)
        frames.append(grade_scene(sc, None, key, []).resize((720, 450), Image.NEAREST))
    frames[0].save(os.path.join(PV, "snow.gif"), save_all=True, append_images=frames[1:], duration=100, loop=0)
    return os.path.join(PV, "snow.gif")

if __name__ == "__main__":
    import sys
    what = sys.argv[1:] or ["contact", "daynight", "status", "food", "gif"]
    if "contact" in what:
        for n, t, dk in (("heat", "Heat sources", True), ("status", "Status particles + emote bubbles", False), ("wind", "Wind", False),
                         ("weather", "Weather", False), ("food", "Food decay", False), ("daynight", "Day / night", True)):
            print(contact(n, t, dk))
    if "daynight" in what: print(daynight_strip())
    if "status" in what: print(status_sheet())
    if "food" in what: print(food_grid())
    if "gif" in what: print(gif_campfire(), gif_rain(), gif_snow())
