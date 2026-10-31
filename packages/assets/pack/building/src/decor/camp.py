"""Missing-art pass: survivor-camp pieces that only had stand-ins (windsock, mirror). Fired pieces with lit/unlit
animation (campfire, torch_stand, fireplace, wood_stove, lantern) are in ../hearths.py."""
from .lib import piece, B, flat, planksV, toon_at, ellipse_pts, RAMPS

RAMPS.setdefault('rust', ['#e8a070', '#b86a44', '#8a4a34', '#5e3328'])
RAMPS.setdefault('tin', ['#f4f8fa', '#c8d2da', '#94a2b0', '#66727f'])

@piece('windsock', (1, 1), 3, 1, ['plain'], 'camp', tall=True)
def windsock(v):
    """lashed pole with a ring and a striped sock sewn from scraps (one cream panel patched)."""
    bx = [B(-.09, .09, -.09, .09, 0, 3, 'stone', flat(.1), flat(.1), flat(.1)),
          B(-.03, .03, -.03, .03, 0, 66, 'wood_dark', flat(), planksV(3), planksV(3)),
          B(-.045, .045, -.045, .045, 22, 25, 'rope' if 'rope' in RAMPS else 'hay', flat(.05), flat(.05), flat(.05)),
          B(-.04, .04, -.04, .04, 66, 69, 'tin', flat(.05), flat(.05), flat(.05))]
    x = .03; z = 64; r = 7.0; cols = ['cloth_red', 'cloth_cream', 'cloth_red', 'cloth_cream', 'cloth_red']
    for i, c in enumerate(cols):   # sock tapers and droops away from the pole
        L = .1; h = r * (1 - i * .13); d = .07 * (1 - i * .13)
        bx.append(B(x, x + L, -d, d, z - h, z, c, flat(.08), flat(.08), flat(.08)))
        x += L; z -= 1.6
    bx.append(B(.15, .2, d - .001, d + .01, z + 1, z + 4, 'wood', edge=False))   # patch on a cream panel
    return bx

@piece('mirror', (1, 1), 2, 4, ['plain'], 'camp', tall=True)
def mirror(v):
    """cheval mirror from salvage: plank stand on splayed feet, a cracked pane taped together."""
    bx = [B(-.32, -.24, -.16, .16, 0, 3, 'wood_dark', flat(), flat(), flat()), B(.24, .32, -.16, .16, 0, 3, 'wood_dark', flat(), flat(), flat()),
          B(-.3, -.25, -.03, .03, 3, 52, 'wood', flat(), planksV(3), planksV(3)), B(.25, .3, -.03, .03, 3, 52, 'wood', flat(), planksV(3), planksV(3)),
          B(-.25, .25, -.02, .03, 10, 13, 'wood', flat(), flat(), flat()),                         # bottom rail
          B(-.25, .25, -.02, .03, 50, 53, 'wood', flat(), flat(), flat()),                         # top rail
          B(-.25, -.21, -.02, .03, 13, 50, 'wood', flat(), flat(), flat()), B(.21, .25, -.02, .03, 13, 50, 'wood', flat(), flat(), flat()),
          B(-.21, .21, .0, .025, 13, 50, 'silver', flat(.03), flat(.03), flat(.03), edge=False),  # pane
          B(-.21, .21, .025, .03, 30, 32, 'cloth_cream', edge=False),                              # tape strip across the crack
          B(-.02, .01, .025, .03, 20, 44, 'cloth_cream', edge=False),
          B(-.33, -.24, -.04, .04, 30, 33, 'gold', edge=False), B(.24, .33, -.04, .04, 30, 33, 'gold', edge=False)]   # pivot bolts
    def crack(cv, r, m):
        def d(c):
            c.line([(10, 8), (14, 14), (12, 20), (17, 26)], (90, 100, 120), .6); c.line([(14, 14), (20, 12)], (90, 100, 120), .5)
            c.part(ellipse_pts(20, 18, 3.2, 1.6), 'snow', outline=False, flat=True, base_col=(255, 255, 255))
        if r in (0, 3): toon_at(cv, 0, .03, 32, r, m, d, size=32)
    return bx, [(-1, crack)]
