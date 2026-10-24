"""Tool-requirement icons (32x32 + @2x 64x64, page nature_toolicons, resident, category item): what a resource node
needs to be gathered. Keys tool_req_<hand|axe|pickaxe|shovel|hoe|knife|sickle>; tool_req_hand = bare hands / tier 1
(ADR-107 bareHands). Prefixed because hoe / *_axe etc. are item keys already. Painted with the items-pack painter."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ITEMS = os.path.normpath(os.path.join(HERE, "../../items/src"))
if ITEMS not in sys.path: sys.path.append(ITEMS)
from draw import C
from common import FRAG

HANDLE, METAL, SKIN = '#a8743f', '#b9c2cc', '#f2c19a'

def handle(c, a, b, w=3.0): c.stroke([a, b], w, HANDLE)

def hand(c):
    c.shadow(16, 28, 9, 2)
    c.poly([(9, 27), (8, 17), (10, 14), (23, 14), (25, 17), (24, 27)], SKIN, shade=.22)
    for x, t in ((10.5, 6), (14.2, 3.5), (17.9, 4), (21.6, 7)):
        c.ell(x, t + 5, 1.9, 5.5, SKIN, shade=.2, owf=.8)
    c.ell(7.2, 19, 2.2, 4.6, SKIN, shade=.2, owf=.8)
    c.dot(13, 21, 2.2, '#ffffff', 70)

def axe(c):
    c.shadow(16, 28, 9, 2); handle(c, (9, 28), (22, 5))
    c.poly([(17, 6), (25, 3), (29, 9), (27, 16), (20, 13)], METAL, shade=.3)
    c.line([(26, 4.5), (28.5, 10)], 1.0, '#ffffff', 170)

def pickaxe(c):
    c.shadow(16, 28, 9, 2); handle(c, (8, 28), (20, 8))
    c.poly([(4, 10), (11, 4), (20, 4), (29, 10), (27, 12), (20, 9), (12, 9), (6, 12)], '#9aa4b0', shade=.3)
    c.line([(11, 5.5), (20, 5.5)], 1.0, '#ffffff', 150)

def shovel(c):
    c.shadow(16, 28, 9, 2); handle(c, (22, 4), (13, 19))
    c.stroke([(19.5, 3.5), (24.5, 4.5)], 2.6, HANDLE)
    c.poly([(11, 16), (17, 21), (13, 28), (8, 29), (6, 25)], METAL, shade=.3)
    c.line([(9, 20), (7.5, 25)], 1.0, '#ffffff', 160)

def hoe(c):
    c.shadow(16, 28, 9, 2); handle(c, (9, 28), (21, 5))
    c.poly([(19, 6), (28, 7), (28, 13), (25, 12), (24, 9), (19, 9)], METAL, shade=.3)

def knife(c):
    c.shadow(16, 28, 9, 2)
    c.poly([(8, 26), (12, 22), (14, 24), (10, 28)], '#8a5a32', shade=.25)
    c.poly([(12, 21), (25, 6), (27, 5), (26, 9), (15, 24)], METAL, shade=.3)
    c.line([(14, 21), (25.5, 7)], 1.0, '#ffffff', 170)

def sickle(c):
    c.shadow(16, 28, 9, 2); handle(c, (8, 28), (13, 20), 3.2)
    c.poly([(12, 21), (9, 13), (12, 6), (19, 3), (26, 5), (20, 6), (15, 9), (14, 15), (16, 20)], METAL, shade=.3)
    c.line([(12, 9), (17, 5)], 1.0, '#ffffff', 160)

ICONS = [("tool_req_" + f.__name__, f) for f in (hand, axe, pickaxe, shovel, hoe, knife, sickle)]

def g(b):
    from PIL import Image
    cols = len(ICONS); p1 = Image.new("RGBA", (32 * cols, 32)); p2 = Image.new("RGBA", (64 * cols, 64)); prev = []
    for i, (key, fn) in enumerate(ICONS):
        c = C(32, 8); fn(c); i1, i2 = c.out(32), c.out(64); p1.alpha_composite(i1, (i * 32, 0)); p2.alpha_composite(i2, (i * 64, 0)); prev.append((key, i2))
    p1.save(os.path.join(FRAG, "atlases/nature_toolicons.png"), optimize=True); p2.save(os.path.join(FRAG, "atlases/nature_toolicons@2x.png"), optimize=True)
    b.atlases.append({"key": "nature_toolicons", "image": "atlases/nature_toolicons.png", "frameW": 32, "frameH": 32, "columns": cols, "rows": 1, "pages": [{"scale": 2, "image": "atlases/nature_toolicons@2x.png"}]})
    for i, (key, _) in enumerate(ICONS):
        b.sprites.append({"key": key, "category": "item", "atlas": "nature_toolicons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    b.previews["nature_toolicons"] = prev
GROUPS = [g]
