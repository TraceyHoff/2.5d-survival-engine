"""ADR-135/137 gameplay gear art: tier materials (bone/bronze/iron/steel/composite), per-spec ramp remap, tier marks and the
gear-only hat / glove / back-pack styles. Imported by parts.py (styles registered into HATS / GLOVES / draw_acc)."""
import math
import palette
from rig import circle, hull, capsule_pts, ramp
palette.RAMPS.update({   # build-time only (customization art); 4 tones light -> deep like every palette ramp
    "bone": ["#fffbea", "#efe4c4", "#cdbb92", "#9c8862"], "bronze": ["#ffd49c", "#f2a252", "#c8722e", "#8c4a22"],
    "steel": ["#f6fcff", "#c8def2", "#90aecb", "#5c7898"], "composite": ["#848ea0", "#565f71", "#3a4150", "#23272f"],
    "oilskin": ["#ece4a4", "#bcb064", "#8c8240", "#5e562c"], "snake": ["#dcecaa", "#a6c264", "#70903e", "#4a5e2a"],
    "reed": ["#f4e8a8", "#d8c070", "#a8904a", "#76643a"]})
TIERS = ("bone", "bronze", "iron", "steel", "composite")
ACCENT = "metal_teal"

def apply_remap(c, spec):
    """spec["remap"] = {"P": ramp, "S": ramp}: draw that wearable's primary/secondary in an untinted material."""
    R = spec.get("remap")
    if not R: return
    cv = c.cv; part, fill, line = cv.part, cv.fill, cv.line
    cv.part = lambda polys, rp, *a, **k: part(polys, R.get(rp, rp) if isinstance(rp, str) else rp, *a, **k)

def marks(c, tier, p, r, m=None, vertical=True):
    """Tier signature at screen point p (size r) clipped to mask m: bone = leather lashings, bronze = warm boss + glint,
    iron = rivets, steel = bright streak, composite = accent stripe."""
    cv = c.cv; x, y = p
    if tier == "bone":
        for s in (-1, 1): cv.line([(x - r, y - r * .6 * s), (x + r, y + r * .6 * s)], ramp("leather")[2], .8, clip=m)
    elif tier == "bronze":
        cv.fill(circle((x, y), max(.9, r * .35)), ramp("gold")[1], clip=m); cv.line([(x - r, y - r * .5), (x - r * .2, y - r * .8)], ramp("bronze")[0], .6, clip=m)
    elif tier == "iron":
        for k in (-1, 0, 1): cv.fill(circle((x + k * r * .6, y), .55), ramp("iron")[3], clip=m)
    elif tier == "steel":
        cv.line([(x - r * .7, y + r * .5), (x + r * .3, y - r * .7)], (255, 255, 255), .7, clip=m, alpha=220)
    elif tier == "composite":
        if vertical: cv.line([(x, y - r * 1.4), (x, y + r * 1.4)], ramp(ACCENT)[1], 1.2, clip=m)
        else: cv.line([(x - r * 1.4, y), (x + r * 1.4, y)], ramp(ACCENT)[1], 1.2, clip=m)

# ------------------------------------------------------------------ hats
def hats(P):
    """P = parts module (crown/band/hz/fv/h_* helpers). Returns {style: fn(c)}."""
    def helmet(tier):
        def f(c):
            cv = c.cv; fv = P.fv(c)
            for sd in (-1, 1):
                p, v = c.sph(sd * 70, -25, 1.12)
                if v > -.6: m = cv.part(circle(p, 3.8, 5.4, wob=.04), tier, lw=1.0, shade=.25, hl=.14)
            if tier == "bronze":   # tinted crest plume
                cv.part(c.solid([(P.hz(c, 0, 4, 13), 2.2), (P.hz(c, 0, -4, 15.5), 2.6), (P.hz(c, 0, -9, 11), 1.8)]), "P", lw=.9, shade=.22, hl=.12)
            m = P.crown(c, [((0, -.3, 1.2), 13.2), ((0, -.3, 7), 11.6), ((0, -.3, 11), 8), ((0, -.3, 13.6), 3.6)], tier)
            if fv > -.2:   # chin strap (tinted S; leather for bone)
                for sd in (-1, 1):
                    a, va = c.sph(sd * 70, -40, 1.1); b, _ = c.sph(sd * 25, -80, 1.0)
                    if va > -.4: cv.line([a, b], ramp("leather")[2] if tier == "bone" else "S1", .7)
            if tier != "composite": P.band(c, m, 1.2, 14, 1.4, tier)
            else: P.band(c, m, 1.2, 14, 1.4, ACCENT)
            front = fv > -.2; p, _ = c.sph(0 if front else 180, 40, 1.12)
            marks(c, tier, p, 3.2, m, vertical=True)
            if tier == "bronze" and front: pass
            if front and tier in ("iron", "steel", "bone"):
                a, _ = c.sph(0, 8, 1.14); b, _ = c.sph(0, -14, 1.1)
                cv.part([(a[0] - 1, a[1]), (a[0] + 1, a[1]), (b[0] + .7, b[1]), (b[0] - .7, b[1])], tier, lw=.7, shade=.2, hl=.15)
            if front and tier == "composite":   # visor brow with glowing accent slit
                a, _ = c.sph(0, 6, 1.14); cv.line([(a[0] - 6, a[1]), (a[0] + 6, a[1])], ramp(ACCENT)[0], 1.0, clip=m)
            if tier == "bone":   # little tusk horns
                for sd in sorted((-1, 1), key=lambda s: c.nv(s, 0)):
                    a = c.p(P.hz(c, sd * 11, 0, 7)); b = c.p(P.hz(c, sd * 15, 0, 13))
                    cv.part(capsule_pts(a[0], a[1], b[0], b[1], 2.0, .6), "bone", lw=.9, shade=.25, hl=.15)
        return f
    H = {f"{t}_helmet": helmet(t) for t in TIERS}
    def straw(c):
        P.h_straw(c)
        if P.fv(c) < .2:
            p = c.p(P.hz(c, 0, -10, 5)); c.cv.part(capsule_pts(p[0], p[1], p[0] + 2, p[1] + 6, 1.0, .8), "S", lw=.6, shade=.2, hl=0)
    def linen_cap(c): P.h_cap(c)
    def rain_hood(c):
        P.h_hood(c)
        if P.fv(c) > -.3:
            for sd in (-1, 1):
                p, _ = c.sph(sd * 25, -55, 1.05); c.cv.line([p, (p[0], p[1] + 3.5)], "S1", .6, tm=(0, 1)); c.cv.fill(circle((p[0], p[1] + 3.8), .8), "S2", tm=(0, 1))
    def fur_hat(c):
        P.h_fur_hat(c); p = c.p(P.hz(c, 0, -.5, 15)); c.cv.part(circle(p, 2.6, 2.4, wob=.15), "fur_brown", lw=.8, shade=.2, hl=.1)
    def leather_cap(c):
        P.h_leather_cap(c)
        for sd in (-1, 1):
            p, v = c.sph(sd * 75, 5, 1.12)
            if v > 0: c.cv.part(circle(p, 1.3, 1.2), "gold", lw=.5, shade=.2, hl=.2)
    def wool_hat(c):
        P.h_beanie(c)
        for sd in sorted((-1, 1), key=lambda s: c.nv(s, 0)):
            p, v = c.sph(sd * 80, -30, 1.14)
            if v > -.5: c.cv.part(capsule_pts(p[0], p[1] - 3, p[0], p[1] + 4, 1.4, 1.0), "S", lw=.7, shade=.2, hl=.1)
    H.update(gear_straw=straw, linen_cap=linen_cap, rain_hood=rain_hood, gear_fur_hat=fur_hat, gear_leather_cap=leather_cap, wool_hat=wool_hat)
    return H
