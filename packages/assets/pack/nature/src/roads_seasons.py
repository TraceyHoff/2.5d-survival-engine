"""Seasonal road twins (ADR-239/246 follow-up): road_<path|gravel|paved>[_mN]_fall (leaf litter) and _winter
(snow / slush), same 64x32 frames, frame indices, autotile rules and anchor as the summer keys in nature_roads.
Derived from the committed nature_roads pages (1x + @2x) so each twin keeps the summer footprint and alpha exactly
(seams stay identical to summer). Everything added is a function of tile-local world coords (u, v), periodic with
period 1 (wrapped noise + wrapped scatter), so neighbouring frames meet. Added detail is flat cel colour with hard
edges; partial alpha only exists where the summer road already had its soft rim.
Pages: season_roads_fall / season_roads_winter (8x6 cells, 1x + @2x), residency "stream", every twin has
placeholder = its summer key (resident nature_roads), so the summer road shows while a twin streams in.
Usage (from repo root): python3 packages/assets/pack/nature/src/roads_seasons.py [--no-manifest]
Then: python3 assets/tools/ktx2.py packages/assets/pack/nature/manifest.nature.json"""
import os, sys, json, math
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); FRAG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from roads import pnoise, scatter, wrapd, SURF, TW, TH

def hexa(h): h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)

def uvgrid(scale):
    ys, xs = np.mgrid[0:TH * scale, 0:TW * scale].astype(np.float32)
    X = (xs + .5) / scale - TW / 2; Y = (ys + .5) / scale - TH / 2
    a, b = X / (TW / 2), Y / (TH / 2)
    return (a + b) / 2 + .5, (b - a) / 2 + .5

def green_mask(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (g > r + 12) & (g > b + 12)

def lum(rgb): return rgb @ np.array([.299, .587, .114], np.float32)

def ramp(l, cols, cuts):
    """luminance -> flat cel tone (len(cols) = len(cuts) + 1)."""
    out = np.empty(l.shape + (3,), np.float32); out[:] = cols[0]
    for c, t in zip(cols[1:], cuts): out[l > t] = c
    return out

# ---- fall: leaf litter ----
LEAF = [(hexa('#e06a2c'), hexa('#a8441f')), (hexa('#f0a83c'), hexa('#c07a22')), (hexa('#c9472c'), hexa('#8e2f20')), (hexa('#f4cc58'), hexa('#c49a32'))]
LEAF_INK = hexa('#5a2a18')
GRASS_FALL = [hexa('#8a7a34'), hexa('#b8a24a'), hexa('#d9c56a')]

def leaves(rgb, inside, u, v, scale, n, seed, keep):
    """scatter of small cel leaves (periodic). keep: fraction of scatter points that carry a leaf."""
    px = 1.0 / 32.0                                     # one 1x pixel in screen units (32 px per unit on y)
    for pu, pv, r, q in scatter(n, seed):
        if r > keep: continue
        du, dv = wrapd(u - pu), wrapd(v - pv)
        sx, sy = (du - dv), (du + dv) * .5              # screen units, both axes 32 px (1x) per unit
        ang = (q - .5) * 1.7; ca, sa = math.cos(ang), math.sin(ang)
        lx, ly = sx * ca + sy * sa, -sx * sa + sy * ca
        L, Wd = (1.6 + .9 * ((q * 7) % 1)) * px, (1.0 + .3 * r) * px
        e = (lx / L) ** 2 + (ly / Wd) ** 2
        m = (e < 1) & inside
        if not m.any(): continue
        base, dark = LEAF[int(q * 97) % len(LEAF)]
        rgb[m & (ly >= 0)] = dark; rgb[m & (ly < 0)] = base
        rim = m & (e > (1 - 1.2 / (scale * 2.2 * Wd / px))) & (ly > 0)
        rgb[rim] = LEAF_INK
        vein = m & (np.abs(ly) < .35 * px / scale) & (np.abs(lx) < .7 * L)
        if scale == 2: rgb[vein] = dark

def fall(rgb, al, u, v, scale, surf):
    inside = al >= 128
    g = green_mask(rgb) & (al > 0)
    rgb[g] = ramp(lum(rgb[g]), GRASS_FALL, [110, 150])        # tufts -> straw gold, flat 3-tone
    dens = {"path": (6, .42), "gravel": (6, .36), "paved": (5, .28)}[surf]
    leaves(rgb, inside, u, v, scale, dens[0], 901, dens[1])
    leaves(rgb, inside, u, v, scale, 3, 917, .35)
    return rgb

# ---- winter: snow + slush ----
SNOW, SNOW_SH, SNOW_DEEP = hexa('#f6faff'), hexa('#d6e2f3'), hexa('#b4c4de')
SLUSH = {"path": [hexa('#6f6052'), hexa('#8b7b69'), hexa('#a49481')],
         "gravel": [hexa('#7d7d82'), hexa('#9c9ca2'), hexa('#bdbec6')],
         "paved": [hexa('#4b4f5a'), hexa('#5d626e'), hexa('#737987')]}
GRASS_WINTER = [hexa('#6e5a3e'), hexa('#9a8460'), hexa('#e8eef8')]

def field(u, v, surf):
    k = SURF.index(surf)
    return pnoise(u, v, 8, 711 + k) * .65 + pnoise(u, v, 16, 721 + k) * .35

def edge_dist(al, scale):
    """1x-px distance from each pixel to the road's own edge (transparent texels inside the diamond). Texels outside
    the diamond count as road, so an arm that runs off the frame has no edge at the seam (matches the neighbour)."""
    from scipy.ndimage import distance_transform_edt
    h, w = al.shape; ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    a, b = ((xs + .5) / scale - TW / 2) / (TW / 2), ((ys + .5) / scale - TH / 2) / (TH / 2)
    off = np.abs(a) + np.abs(b) > 1 - 1.5 / (TH / 2)        # outer 1.5 px of the diamond: treat as road
    road = (al >= 128) | off
    return distance_transform_edt(road) / scale, off

def winter(rgb, al, u, v, scale, surf):
    src = rgb.copy(); inside = al > 0
    g = green_mask(src) & inside
    l = lum(src)
    out = ramp(l, SLUSH[surf], [100, 150] if surf != "paved" else [95, 125])   # wet cold slush base (flat tones)
    if surf == "paved":
        dash = (src[..., 0] > 200) & (src[..., 1] > 180) & (src[..., 2] < 190) & (src[..., 0] - src[..., 2] > 40)
        out[dash] = hexa('#d9cf9e')                                            # faded centre dashes
        kerb = (l > 175) & ~dash
        out[kerb] = SNOW                                                       # kerbs carry snow banks
    thr = {"path": .50, "gravel": .60, "paved": .72}[surf]
    bank = {"path": 5.0, "gravel": 3.5, "paved": 3.0}[surf]                    # 1x px of edge snow bank
    f = field(u, v, surf); d, off = edge_dist(al, scale)
    seam = inside & (al < 255) & off & ~(out == SNOW).all(-1)
    out[seam] = SLUSH[surf][1]                                                 # seam AA texels: one flat tone (no light seam line)
    rim = inside & (al < 255) & ~off                                           # soft summer rim -> snow edge (not the seam AA)
    snow = inside & ((f > thr) | rim | (d < bank + 5.0 * (f - .5)))
    out[snow] = SNOW
    inner = snow & ~rim & (f <= thr) & (d >= bank + 5.0 * (f - .5) - 1.0 / scale)   # bank lip (1 px band)
    out[inner | (snow & ~rim & (f > thr) & (f < thr + .03))] = SNOW_SH            # hard shade band on the snow edge
    # cast shade: slush pixels just under (screen +y) a snow edge
    sh = max(1, int(round(1.0 * scale)))                                        # 1 px (1x) cast shade under snow
    up = np.zeros_like(snow); up[sh:] = snow[:-sh]
    under = ~snow & up & inside
    out[under] = np.minimum(out[under], SLUSH[surf][0])
    # wheel / foot tracks of compacted snow on path: thin ruts parallel to the road axes stay slush (keep as is)
    # frosted tufts: dry brown with white tips
    out[g] = ramp(l[g], GRASS_WINTER[:2], [120])
    tip = g & (np.roll(~g, 1, 0) | (np.roll(al, 1, 0) == 0))
    out[tip] = GRASS_WINTER[2]
    # sparkles on snow (periodic)
    for pu, pv, r, q in scatter(5, 777):
        if r > .5: continue
        du, dv = wrapd(u - pu), wrapd(v - pv); sx, sy = (du - dv), (du + dv) * .5
        m = (np.abs(sx) < .6 / 32) & (np.abs(sy) < .6 / 32) & snow & (out == SNOW).all(-1)
        out[m] = hexa('#ffffff')
    return out

def build(season, scale):
    src = np.array(Image.open(os.path.join(FRAG, f"atlases/nature_roads{'@2x' if scale == 2 else ''}.png")).convert("RGBA")).astype(np.float32)
    out = src.copy(); u, v = uvgrid(scale); w, h = TW * scale, TH * scale
    for i in range(48):
        x, y = i % 8, i // 8; surf = SURF[i // 16]
        cell = src[y * h:(y + 1) * h, x * w:(x + 1) * w]; rgb, al = cell[..., :3].copy(), cell[..., 3]
        rgb = fall(rgb, al, u, v, scale, surf) if season == "fall" else winter(rgb, al, u, v, scale, surf)
        rgb[al == 0] = 0
        out[y * h:(y + 1) * h, x * w:(x + 1) * w, :3] = rgb
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8), "RGBA")

def main():
    for s in ("fall", "winter"):
        for sc in (1, 2):
            build(s, sc).save(os.path.join(FRAG, f"atlases/season_roads_{s}{'@2x' if sc == 2 else ''}.png"), optimize=True)
    if "--no-manifest" in sys.argv: return
    mf = os.path.join(FRAG, "manifest.nature.json"); m = json.load(open(mf))
    road = [a for a in m["atlases"] if a["key"] == "nature_roads"][0]
    old = {a["key"]: a for a in m["atlases"]}
    m["atlases"] = [a for a in m["atlases"] if not a["key"].startswith("season_roads_")]
    m["sprites"] = [sp for sp in m["sprites"] if not (sp.get("atlas", "").startswith("season_roads_"))]
    ri = m["atlases"].index(road)
    summer = [sp for sp in m["sprites"] if sp.get("atlas") == "nature_roads"]
    last = max(i for i, sp in enumerate(m["sprites"]) if sp.get("atlas") == "nature_roads")
    new_a, new_s = [], []
    for s in ("fall", "winter"):
        k = f"season_roads_{s}"
        a = {"key": k, "image": f"atlases/{k}.png", "frameW": TW, "frameH": TH, "columns": road["columns"], "rows": road["rows"],
             "pages": [{"scale": 2, "image": f"atlases/{k}@2x.png"}], "residency": "stream"}
        o = old.get(k)
        if o and o.get("ktx2"): a["ktx2"] = o["ktx2"]
        if o and o.get("pages") and o["pages"][0].get("ktx2"): a["pages"][0]["ktx2"] = o["pages"][0]["ktx2"]
        new_a.append(a)
        for sp in summer:
            t = json.loads(json.dumps(sp)); t["key"] = f"{sp['key']}_{s}"; t["atlas"] = k; t["placeholder"] = sp["key"]
            new_s.append(t)
    m["atlases"][ri + 1:ri + 1] = new_a
    m["sprites"][last + 1:last + 1] = new_s
    with open(mf, "w") as fh: json.dump(m, fh, indent=1); fh.write("\n")
    print("season_roads:", len(new_s), "sprites")

if __name__ == "__main__": main()
