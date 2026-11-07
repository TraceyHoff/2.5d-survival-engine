"""Unique `leg_splint` inventory/crafting icon in nature_icons (frame 123).

Same pipeline as artpass_unique_craft_icons.py (cel paint via assets/tools draw.C, 32px @1x + 64px @2x,
blit into an unused nature_icons cell, append the sprite record, re-encode nature_icons ktx2 only).
Bandage has no ground/held sprite (inventory icon only), so neither does leg_splint.
Idempotent: python3 packages/assets/pack/nature/src/artpass_leg_splint_icon.py
"""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import artpass_unique_craft_icons as U
from artpass_unique_craft_icons import sh, dk, lt

FRAME = 123
KEY = "leg_splint"


def _rot(pts, a, cx=16, cy=16):
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in pts]


def leg_splint(c):
    """Two light wooden slats bound by three cream cloth wraps with a knot tail — not a bandage roll, not a stick/plank."""
    sh(c, 10)
    A = math.radians(-35)
    wood = '#e0b06a'
    for x0 in (10.4, 16.6):  # two flat boards side by side
        c.poly(_rot([(x0, 2.2), (x0 + 5.0, 2.2), (x0 + 5.0, 29.8), (x0, 29.8)], A), wood, shade=.3)
        c.line(_rot([(x0 + 1.3, 5.0), (x0 + 1.3, 27.0)], A), .5, lt(wood, .45), 170)  # grain highlight
        c.line(_rot([(x0 + 3.3, 17.5), (x0 + 3.3, 21.5)], A), .45, dk(wood, .35), 170)      # grain
    cloth = '#f4ead2'
    for y in (7.0, 15.8, 24.6):  # wraps
        c.poly(_rot([(9.4, y - 1.1), (22.6, y - 1.1), (22.6, y + 1.1), (9.4, y + 1.1)], A), cloth, shade=.25)
        c.line(_rot([(9.6, y + .1), (22.4, y + .1)], A), .45, dk(cloth, .3), 200)
    # knot + tails on the middle wrap
    kx, ky = _rot([(23.0, 15.8)], A)[0]
    c.stroke([(kx, ky), (kx + 4.2, ky + 1.2), (kx + 5.6, ky + 3.6)], 1.2, cloth)
    c.stroke([(kx, ky), (kx + 2.6, ky + 3.6), (kx + 2.4, ky + 6.2)], 1.2, cloth)
    c.ell(kx, ky, 1.7, 1.5, cloth, shade=.25)
    c.shine(*_rot([(12.6, 6.0)], A)[0], .8, 180)


def patch_manifest():
    data = json.load(open(U.MAN))
    if any(s["key"] == KEY for s in data["sprites"]):
        print("manifest already has", KEY); return
    data["sprites"].append({"key": KEY, "category": "item", "atlas": "nature_icons", "anchor": {"x": 0.5, "y": 0.5},
                            "animations": {"idle": {"frames": [FRAME], "fps": 1}}})
    open(U.MAN, "w").write(json.dumps(data, indent=2, ensure_ascii=False) + "\n"); print("nature manifest +", KEY, FRAME)


def main():
    imgs = U.render_icon(leg_splint)
    U.blit_icon(FRAME, imgs); print("painted", KEY, "->", FRAME)
    patch_manifest()
    tok = "/tmp/ktx/out/KTX-Software-4.4.2-Linux-x86_64/bin/toktx"
    if os.path.exists(tok):
        os.environ["TOKTX"] = tok
        os.environ["LD_LIBRARY_PATH"] = "/tmp/ktx/out/KTX-Software-4.4.2-Linux-x86_64/lib:" + os.environ.get("LD_LIBRARY_PATH", "")
    if not os.environ.get("NO_KTX"):
        U.encode_ktx2(os.path.join(U.ATLAS, "nature_icons.png"))
        U.encode_ktx2(os.path.join(U.ATLAS, "nature_icons@2x.png"))


if __name__ == "__main__":
    main()
