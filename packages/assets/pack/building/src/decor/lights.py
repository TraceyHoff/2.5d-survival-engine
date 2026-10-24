"""ADR-112 commit 2: lighting (candle, candelabra, floor/table lamps, chandelier, hanging lantern, wall sconce, lamp post)."""
from .lib import piece, B, flat, toon_at, ellipse_pts

def flame(c):
    c.part(ellipse_pts(16, 21, 2.4, 4.2), 'fire', lw=0.6, shade=0.1); c.part(ellipse_pts(16, 22.5, 1.1, 2.0), 'glow', outline=False, flat=True)

def flames(pts):
    return [(-1, lambda cv, r, m, x=x, y=y, z=z: toon_at(cv, x, y, z, r, m, flame, size=16)) for x, y, z in pts]

def candle_box(x, y, z, h, w=.05):
    return B(x - w, x + w, y - w, y + w, z, z + h, 'snow', flat(.05), flat(.05), flat(.05))

@piece('candle', (1, 1), 3, 1, ['single', 'trio', 'tall'], 'light')
def candle(v):
    pts = {'single': [(0, 0, 8)], 'trio': [(-.12, -.06, 8), (.1, -.1, 6), (0, .12, 4)], 'tall': [(0, 0, 18)]}[v]
    bx = [B(-.12, .12, -.12, .12, 0, 2, 'gold')] if v != 'trio' else [B(-.22, .22, -.22, .22, 0, 2, 'clay')]
    bx += [candle_box(x, y, 2, h - 2) for x, y, h in pts]
    return bx, flames([(x, y, h + 1) for x, y, h in pts])

@piece('candelabra', (1, 1), 3, 1, ['brass', 'iron', 'silver'], 'light', tall=True)
def candelabra(v):
    mt = {'brass': 'gold', 'iron': 'black_iron', 'silver': 'silver'}[v]
    bx = [B(-.12, .12, -.12, .12, 0, 3, mt), B(-.03, .03, -.03, .03, 3, 30, mt), B(-.26, .26, -.03, .03, 26, 28, mt)]
    pts = [(-.24, 0), (0, 0), (.24, 0)]
    bx += [B(x - .04, x + .04, y - .04, y + .04, 28 if x else 30, 30 if x else 32, mt) for x, y in pts] + [candle_box(x, y, 30 if x else 32, 8) for x, y in pts]
    return bx, flames([(x, y, (38 if x else 40) + 1) for x, y in pts])

@piece('floor_lamp', (1, 1), 3, 1, ['shade', 'oil', 'brass'], 'light', tall=True)
def floor_lamp(v):
    mt = 'gold' if v == 'brass' else 'black_iron'
    bx = [B(-.14, .14, -.14, .14, 0, 3, mt), B(-.025, .025, -.025, .025, 3, 52, mt)]
    if v == 'oil':
        bx += [B(-.1, .1, -.1, .1, 52, 54, 'gold'), B(-.08, .08, -.08, .08, 54, 66, 'glass'), B(-.1, .1, -.1, .1, 66, 68, 'gold')]
        return bx, flames([(0, 0, 57)])
    bx += [B(-.2, .2, -.2, .2, 54, 68, 'cloth_cream' if v == 'shade' else 'cloth_yellow', flat(.05), flat(.05), flat(.05))]
    return bx

@piece('table_lamp', (1, 1), 3, 1, ['shade', 'oil'], 'light')
def table_lamp(v):
    bx = [B(-.1, .1, -.1, .1, 0, 8, 'clay'), B(-.02, .02, -.02, .02, 8, 14, 'gold')]
    if v == 'oil':
        bx += [B(-.09, .09, -.09, .09, 8, 10, 'gold'), B(-.07, .07, -.07, .07, 10, 20, 'glass'), B(-.08, .08, -.08, .08, 20, 22, 'gold')]
        return bx[:1] + bx[2:], flames([(0, 0, 13)])
    return bx + [B(-.16, .16, -.16, .16, 14, 24, 'cloth_cream', flat(.05), flat(.05), flat(.05))]

@piece('chandelier', (2, 2), 3, 1, ['wood', 'iron', 'crystal'], 'light', shadow=False)
def chandelier(v):
    mt = {'wood': 'wood_dark', 'iron': 'black_iron', 'crystal': 'gold'}[v]; z = 50
    bx = [B(-.02, .02, -.02, .02, z + 10, z + 30, mt), B(-.5, .5, -.04, .04, z, z + 3, mt), B(-.04, .04, -.5, .5, z, z + 3, mt)]
    if v == 'wood': bx = [B(-.55, .55, -.55, .55, z, z + 3, mt), B(-.45, .45, -.45, .45, z, z + 3, 'wood', faces='t')] + bx[:1]
    pts = [(-.5, 0), (.5, 0), (0, -.5), (0, .5)] + ([(-.36, -.36), (.36, .36), (-.36, .36), (.36, -.36)] if v != 'iron' else [])
    if v == 'crystal': bx += [B(x - .03, x + .03, y - .03, y + .03, z - 10, z, 'glass') for x, y in [(-.25, 0), (.25, 0), (0, -.25), (0, .25)]]
    bx += [candle_box(x, y, z + 3, 6) for x, y in pts]
    return bx, flames([(x, y, z + 10) for x, y in pts])

@piece('lantern_hanging', (1, 1), 3, 1, ['iron', 'paper', 'brass'], 'light', tall=True, shadow=False)
def lantern_hanging(v):
    z = 40
    if v == 'paper':
        bx = [B(-.01, .01, -.01, .01, z + 16, z + 30, 'black_iron'), B(-.15, .15, -.15, .15, z, z + 16, 'cloth_red', flat(.05), flat(.05), flat(.05)), B(-.1, .1, -.1, .1, z - 1, z, 'ink'), B(-.1, .1, -.1, .1, z + 16, z + 17, 'ink')]
        return bx
    mt = 'gold' if v == 'brass' else 'black_iron'
    bx = [B(-.01, .01, -.01, .01, z + 18, z + 30, mt), B(-.12, .12, -.12, .12, z, z + 2, mt), B(-.09, .09, -.09, .09, z + 2, z + 14, 'glass'), B(-.12, .12, -.12, .12, z + 14, z + 16, mt), B(-.06, .06, -.06, .06, z + 16, z + 18, mt)]
    return bx, flames([(0, 0, z + 5)])

@piece('wall_sconce', (1, 1), 3, 4, ['torch', 'candle', 'oil'], 'light', tall=True, shadow=False)
def wall_sconce(v):
    y = .15  # against the front face of a centre-line wall (buildings2 T = .12)
    bx = [B(-.08, .08, y, y + .03, 26, 40, 'black_iron'), B(-.02, .02, y + .03, y + .16, 28, 31, 'black_iron')]
    if v == 'torch':
        bx += [B(-.03, .03, y + .12, y + .18, 28, 44, 'wood_dark')]; return bx, flames([(0, y + .15, 46)])
    if v == 'candle':
        bx += [B(-.06, .06, y + .1, y + .2, 31, 33, 'gold'), candle_box(0, y + .15, 33, 8, .03)]; return bx, flames([(0, y + .15, 42)])
    bx += [B(-.06, .06, y + .1, y + .2, 31, 34, 'gold'), B(-.05, .05, y + .11, y + .19, 34, 44, 'glass'), B(-.06, .06, y + .1, y + .2, 44, 46, 'gold')]
    return bx, flames([(0, y + .15, 37)])

@piece('lamp_post', (1, 1), 2, 1, ['iron', 'wood', 'double'], 'light', tall=True)
def lamp_post(v):
    mt = 'wood_dark' if v == 'wood' else 'black_iron'; H = 70
    bx = [B(-.12, .12, -.12, .12, 0, 6, mt), B(-.04, .04, -.04, .04, 6, H, mt)]
    heads = [(0, 0)] if v != 'double' else [(-.26, .0), (.26, .0)]
    if v == 'double': bx.append(B(-.3, .3, -.02, .02, H - 2, H, mt))
    for x, y in heads:
        bx += [B(x - .09, x + .09, y - .09, y + .09, H, H + 2, mt), B(x - .07, x + .07, y - .07, y + .07, H + 2, H + 12, 'glass'), B(x - .1, x + .1, y - .1, y + .1, H + 12, H + 14, mt), B(x - .04, x + .04, y - .04, y + .04, H + 14, H + 16, mt)]
    return bx, flames([(x, y, H + 4) for x, y in heads])
