"""ADR-112 commit 2: most common furniture - seating, beds, tables, desks, shelves/bookcases, storage.
Local frame: footprint centred on the pivot, x along footprint w, y along h, z in px (1 floor = 48). rot0 'front' faces +y
(towards the camera, lit face); backs / headboards sit at -y."""
from .lib import piece, B, planksH, planksV, flat, tx_quilt, tx_books, tx_tile, tx_woven

MAT = {'rustic': dict(w='wood', top=planksH(5), side=planksH(4), vt=planksV(4), leg='wood_dark', cloth='cloth_cream', cloth2='cloth_red', trim='wood_dark'),
       'fine': dict(w='wood_dark', top=flat(.1), side=flat(.1), vt=flat(.1), leg='wood_dark', cloth='cloth_green', cloth2='cloth_teal', trim='wood'),
       'luxury': dict(w='wood_dark', top=flat(.06), side=flat(.06), vt=flat(.06), leg='wood_dark', cloth='cloth_red', cloth2='cloth_purple', trim='gold')}
VARS = {}

def legs(x0, x1, y0, y1, z, rp, t=.06):
    return [B(x, x + t, y, y + t, 0, z, rp, edge=False) for x in (x0, x1 - t) for y in (y0, y1 - t)]

def slab(x0, x1, y0, y1, z0, z1, m, rp=None):
    return B(x0, x1, y0, y1, z0, z1, rp or m['w'], m['top'], m['side'], m['side'])

def panel(x0, x1, y0, y1, z0, z1, m, rp=None):
    return B(x0, x1, y0, y1, z0, z1, rp or m['w'], m['top'], m['vt'], m['vt'])

def cushion(x0, x1, y0, y1, z0, z1, rp, tex=None):
    t = tex or flat(.08); return B(x0, x1, y0, y1, z0, z1, rp, t, t, t)

# ------------------------------------------------------------------ seating
def chair(m, v, tier):
    arm = v == 'armchair'; hw = .3 if arm else .24
    bx = legs(-hw, hw, -hw, hw, 12, m['leg'])
    bx.append(slab(-hw, hw, -hw, hw, 12, 15, m))
    if v in ('padded', 'armchair'): bx.append(cushion(-hw + .03, hw - .03, -hw + .06, hw - .02, 15, 19, m['cloth']))
    if v == 'slat':
        bx += [panel(-hw, hw, -hw, -hw + .06, 30, 34, m)] + [panel(x - .025, x + .025, -hw, -hw + .05, 15, 30, m) for x in (-hw + .03, -.08, 0.03, .14, hw - .03) if abs(x) <= hw]
    else:
        bx.append(panel(-hw, hw, -hw, -hw + .06, 15, 36 if arm else 33, m))
        if v in ('padded', 'armchair'): bx.append(cushion(-hw + .04, hw - .04, -hw + .06, -hw + .11, 19, 33 if arm else 31, m['cloth']))
    if arm:
        for s in (-1, 1): bx.append(slab(s * hw - .05 * (s > 0) - (0 if s > 0 else 0), s * hw + .05 * (s < 0), -hw, hw, 15, 25, m) if False else slab(min(s * hw, s * hw - .06 * s), max(s * hw, s * hw - .06 * s), -hw, hw, 15, 25, m))
    if tier == 'luxury': bx.append(B(-hw, hw, -hw - .01, -hw + .07, 34 if not arm else 37, 36 if not arm else 39, 'gold'))
    return bx

for t in ('rustic', 'fine', 'luxury'):
    piece(f'chair_{t}', (1, 1), 2, 4, ['plain', 'slat', 'padded', 'armchair'], 'furn')(lambda v, t=t: chair(MAT[t], v, t))

def stool(m, v):
    h = 26 if v == 'tall' else 15
    if v == 'round':
        bx = [B(-.2, -.14, -.03, .03, 0, h, m['leg'], edge=False), B(.14, .2, -.03, .03, 0, h, m['leg'], edge=False), B(-.03, .03, .14, .2, 0, h, m['leg'], edge=False), B(-.03, .03, -.2, -.14, 0, h, m['leg'], edge=False)]
        return bx + [slab(-.22, .22, -.13, .13, h, h + 3, m), slab(-.13, .13, -.22, .22, h, h + 3, m), slab(-.18, .18, -.18, .18, h, h + 3, m)]
    bx = legs(-.2, .2, -.2, .2, h, m['leg'])
    if v == 'tall': bx += [B(-.2, .2, .14, .2, 8, 10, m['leg']), B(.14, .2, -.2, .2, 8, 10, m['leg'])]
    return bx + [slab(-.22, .22, -.22, .22, h, h + 3, m)]

for t in ('rustic', 'fine'):
    piece(f'stool_{t}', (1, 1), 2, 1, ['round', 'square', 'tall'], 'furn')(lambda v, t=t: stool(MAT[t], v))

def bench(m, v, tier):
    bx = []
    if v == 'carved':
        bx += [panel(-.86, -.78, -.2, .2, 0, 22, m), panel(.78, .86, -.2, .2, 0, 22, m)]
    else:
        bx += legs(-.8, .8, -.18, .18, 12, m['leg'], .07)
    bx.append(slab(-.86, .86, -.2, .2, 12, 15, m))
    if v in ('backed', 'carved'):
        bx += [panel(-.84, .84, -.24, -.18, 15, 32, m)]
        if v == 'carved': bx += [B(-.86, .86, -.25, -.17, 32, 35, m['trim'])]
    return bx

for t in ('rustic', 'fine'):
    piece(f'bench_{t}', (2, 1), 2, 4, ['plain', 'backed', 'carved'], 'furn')(lambda v, t=t: bench(MAT[t], v, t))

def sofa(m, v, tier):
    c = 'leather' if v == 'leather' else m['cloth']; tex = tx_quilt if v == 'tufted' else flat(.08)
    foot = 'gold' if tier == 'luxury' else m['leg']
    bx = legs(-.82, .82, -.32, .32, 4, foot, .06)
    bx += [cushion(-.84, .84, -.34, .34, 4, 13, c), cushion(-.84, .84, -.36, -.18, 13, 32, c, tex)]
    for s in (-1, 1): bx.append(cushion(min(s * .84, s * .7), max(s * .84, s * .7), -.34, .36, 13, 22, c))
    bx += [cushion(-.7, -.01, -.18, .34, 13, 17, c, tex), cushion(.01, .7, -.18, .34, 13, 17, c, tex)]
    if tier == 'luxury': bx.append(B(-.86, .86, -.37, -.3, 32, 34, 'gold'))
    return bx

for t in ('fine', 'luxury'):
    piece(f'sofa_{t}', (2, 1), 2, 4, ['plain', 'tufted', 'leather'], 'furn')(lambda v, t=t: sofa(MAT[t], v, t))

# ------------------------------------------------------------------ beds (headboard at -y)
def bed_double(m, v, tier):
    bx = [slab(-.82, .82, -.86, .9, 3, 10, m), cushion(-.78, .78, -.82, .86, 10, 16, 'cloth_cream')]
    blanket = {'quilted': tx_quilt, 'fur': flat(.4)}.get(v, planksH(3))
    brp = 'fur_brown' if v == 'fur' else m['cloth2']
    bx += [cushion(-.8, .8, -.2, .88, 16, 19, brp, blanket),
           cushion(-.68, -.06, -.8, -.5, 16, 21, 'snow'), cushion(.06, .68, -.8, -.5, 16, 21, 'snow'),
           panel(-.88, .88, -.98, -.86, 0, 38 if tier != 'rustic' else 32, m), panel(-.88, .88, .88, .98, 0, 18, m)]
    bx += legs(-.88, .88, -.98, .98, 3, m['leg'], .08)
    if tier == 'luxury': bx += [B(-.9, .9, -1.0, -.84, 38, 42, 'gold'), B(-.9, .9, .86, 1.0, 18, 20, 'gold')]
    if v == 'canopy':
        H = 66
        bx += [B(x, x + .08, y, y + .08, 0, H, m['w'], edge=True) for x in (-.9, .82) for y in (-1.0, .9)]
        bx += [B(-.9, .9, -1.0, -.92, H - 4, H, m['w']), B(-.9, .9, .9, .98, H - 4, H, m['w']),
               cushion(-.9, .9, -1.0, -.94, H - 12, H, m['cloth'], planksV(3)), cushion(-.9, .9, .92, .98, H - 12, H, m['cloth'], planksV(3)),
               cushion(-.9, -.84, -.94, .92, H - 12, H, m['cloth'], planksV(3)), cushion(.84, .9, -.94, .92, H - 12, H, m['cloth'], planksV(3))]
    return bx

for t in ('rustic', 'fine', 'luxury'):
    piece(f'bed_double_{t}', (2, 2), 2, 4, ['plain', 'canopy', 'quilted', 'fur'], 'furn')(lambda v, t=t: bed_double(MAT[t], v, t))

@piece('bunk_bed', (1, 2), 2, 4, ['plain', 'rail', 'ladder'], 'furn')
def bunk_bed(v):
    m = MAT['rustic']; bx = []
    for z in (6, 36):
        bx += [slab(-.42, .42, -.9, .9, z, z + 5, m), cushion(-.38, .38, -.86, .86, z + 5, z + 9, 'cloth_cream'),
               cushion(-.4, .4, -.2, .88, z + 9, z + 11, 'cloth_blue' if z == 6 else 'cloth_red', planksH(3)), cushion(-.28, .28, -.84, -.56, z + 9, z + 13, 'snow')]
    bx += [B(x, x + .08, y, y + .08, 0, 58, m['w']) for x in (-.46, .38) for y in (-.96, .88)]
    bx += [panel(-.46, .46, -.96, -.88, 44, 56, m), panel(-.46, .46, .88, .96, 44, 54, m)]
    if v in ('rail', 'ladder'): bx.append(panel(.38, .46, -.88, .3 if v == 'ladder' else .88, 50, 54, m))
    if v == 'ladder':
        bx += [B(.46, .5, .34, .38, 0, 52, 'wood'), B(.46, .5, .78, .82, 0, 52, 'wood')] + [B(.46, .5, .38, .78, z, z + 2, 'wood') for z in (12, 22, 32, 42)]
    return bx

# ------------------------------------------------------------------ tables & desks
def table_dining(m, v, tier):
    bx = []
    if v == 'carved': bx += legs(-.8, .8, -.36, .36, 20, m['w'], .1) + [panel(-.78, .78, -.34, .34, 15, 20, m)]
    else: bx += legs(-.8, .8, -.36, .36, 20, m['leg'], .07)
    bx.append(slab(-.86, .86, -.42, .42, 20, 23, m))
    if v == 'clothed':
        cl = 'cloth_cream' if tier != 'luxury' else 'cloth_red'
        bx += [cushion(-.9, .9, -.46, .46, 12, 24, cl, planksV(6)), cushion(-.12, .12, -.08, .08, 24, 30, 'glass')]
    if tier == 'luxury': bx += [B(-.87, .87, .41, .44, 19, 23, 'gold'), B(.85, .88, -.43, .43, 19, 23, 'gold')]
    return bx

for t in ('rustic', 'fine', 'luxury'):
    piece(f'table_dining_{t}', (2, 1), 2, 2, ['plain', 'carved', 'clothed'], 'furn')(lambda v, t=t: table_dining(MAT[t], v, t))

def table_low(m, v, h, r):
    if v == 'round':
        return [B(-.05, .05, -.05, .05, 0, h, m['leg']), B(-.18, .18, -.18, .18, 0, 2, m['leg']),
                slab(-r, r, -r * .6, r * .6, h, h + 3, m), slab(-r * .6, r * .6, -r, r, h, h + 3, m), slab(-r * .85, r * .85, -r * .85, r * .85, h, h + 3, m)]
    bx = legs(-r + .02, r - .02, -r + .02, r - .02, h, m['leg'])
    if v == 'glass_top': return bx + [slab(-r, r, -r, r, h - 2, h, m), B(-r + .05, r - .05, -r + .05, r - .05, h, h + 1, 'glass', edge=False)]
    if v == 'drawer': return bx[:0] + [panel(-r, r, -r, r, 0, h, m), B(-r + .06, r - .06, r, r + .01, h - 9, h - 3, m['trim']), B(-.04, .04, r + .01, r + .03, h - 7, h - 5, 'gold')] + [slab(-r - .02, r + .02, -r - .02, r + .02, h, h + 3, m)]
    return bx + [slab(-r, r, -r, r, h, h + 3, m)]

for t in ('rustic', 'fine'):
    piece(f'table_coffee_{t}', (1, 1), 2, 1, ['round', 'square', 'glass_top'], 'furn')(lambda v, t=t: table_low(MAT[t], v, 10, .4))
    piece(f'table_side_{t}', (1, 1), 2, 1, ['round', 'square', 'drawer'], 'furn')(lambda v, t=t: table_low(MAT[t], v, 18, .28))

def desk(m, v):
    bx = legs(-.82, -.2, -.34, .34, 20, m['leg'], .07) + [panel(.3, .84, -.36, .36, 0, 20, m)]
    bx += [B(.34, .8, .36, .37, z, z + 6, m['trim'], edge=False) for z in (3, 12)]
    if v == 'drafting':
        bx += [slab(-.86, .86, -.4, .4, 20, 22, m)] + [B(-.8, .2, -.36 + i * .14, -.22 + i * .14, 22, 30 - i * 2, 'paint', flat(.05)) for i in range(5)][:1]
        bx += [B(-.8, .2, -.36, .3, 22, 26, 'cloth_cream', flat(.04))]
    else:
        bx.append(slab(-.86, .86, -.4, .4, 20, 23, m))
    if v == 'writing':
        bx += [panel(-.86, .86, -.4, -.26, 23, 40, m), slab(-.86, .86, -.4, -.24, 40, 42, m), B(-.3, .1, -.1, .12, 23, 24, 'snow'), B(.2, .28, -.18, -.1, 23, 28, 'ink')]
    return bx

for t in ('rustic', 'fine'):
    piece(f'desk_{t}', (2, 1), 2, 4, ['plain', 'writing', 'drafting'], 'furn')(lambda v, t=t: desk(MAT[t], v))

# ------------------------------------------------------------------ shelves & bookcases (backs at -y)
def books(x0, x1, y0, y1, z, h, rp, seed=0):
    return B(x0, x1, y0, y1, z, z + h, rp, flat(.3), tx_books, tx_books, edge=False)

def shelf(m, v):
    if v == 'corner':
        H = 50; bx = [panel(-.46, .46, -.46, -.4, 0, H, m), panel(-.46, -.4, -.4, .46, 0, H, m)]
        for z in (0, 16, 32, 48): bx += [slab(-.4, .2, -.4, -.1, z, z + 2, m), slab(-.4, -.1, -.1, .2, z, z + 2, m)]
        bx += [books(-.36, .0, -.38, -.18, 18, 9, 'cloth_blue'), books(-.38, -.18, -.08, .14, 34, 9, 'cloth_red'), B(.02, .14, -.36, -.24, 2, 12, 'clay')]
        return bx
    H = 24 if v == 'low' else 58; zs = (0, 12, 22) if v == 'low' else (0, 14, 28, 42, 56)
    bx = [panel(-.44, .44, -.44, -.4, 0, H, m), panel(-.46, -.4, -.44, -.1, 0, H, m), panel(.4, .46, -.44, -.1, 0, H, m)]
    for z in zs: bx.append(slab(-.4, .4, -.4, -.12, z, z + 2, m))
    cols = ['cloth_red', 'cloth_blue', 'cloth_green', 'leather']
    for i, z in enumerate(zs[:-1]):
        bx.append(books(-.38, -.02 + .1 * (i % 2), -.38, -.16, z + 2, 9, cols[i % 4]))
        if i % 2 == 0: bx.append(B(.12, .26, -.34, -.2, z + 2, z + 9, 'clay'))
    return bx

for t in ('rustic', 'fine'):
    piece(f'shelf_{t}', (1, 1), 2, 4, ['low', 'tall', 'corner'], 'furn', tall=True)(lambda v, t=t: shelf(MAT[t], v))

def bookcase(m, v):
    H = 62; zs = (2, 16, 30, 44)
    bx = [panel(-.46, .46, -.46, -.4, 0, H, m), panel(-.48, -.4, -.46, -.08, 0, H, m), panel(.4, .48, -.46, -.08, 0, H, m), slab(-.48, .48, -.48, -.06, H, H + 3, m), slab(-.4, .4, -.4, -.1, 0, 2, m)]
    for z in zs[1:]: bx.append(slab(-.4, .4, -.4, -.1, z - 2, z, m))
    cols = ['cloth_red', 'cloth_blue', 'leather', 'cloth_green']
    fill = {'empty': 0, 'half': 2, 'full': 4, 'ladder': 4}[v]
    for i, z in enumerate(zs[:fill]):
        x1 = .38 if v != 'half' else .05 * (i + 1)
        bx.append(books(-.38, x1, -.38, -.14, z, 11, cols[i]))
    if v == 'empty': bx.append(B(-.1, .06, -.32, -.18, 2, 6, 'wood'))
    if v == 'ladder':
        bx += [B(-.3, -.26, .12, .16, 0, 60, 'wood'), B(.26, .3, .12, .16, 0, 60, 'wood')] + [B(-.26, .26, .12, .16, z, z + 2, 'wood') for z in (10, 22, 34, 46)]
    return bx

for t in ('rustic', 'fine'):
    piece(f'bookcase_{t}', (1, 1), 2, 4, ['empty', 'half', 'full', 'ladder'], 'furn', tall=True)(lambda v, t=t: bookcase(MAT[t], v))

# ------------------------------------------------------------------ storage (paintable bodies use the 'paint' ramp)
def cabinet(m, v, tier):
    body = 'paint' if v == 'painted' else m['w']; pm = dict(m, top=flat(.06), side=flat(.06), vt=flat(.06)) if v == 'painted' else m
    H = 44 if tier == 'rustic' else 48
    bx = [panel(-.4, .4, -.36, .2, 3, H, pm, body), slab(-.44, .44, -.4, .24, H, H + 3, m), B(-.38, .38, -.34, .18, 0, 3, m['leg'])]
    door = 'paint2' if v == 'painted' else m['trim']
    bx += [B(-.36, -.02, .2, .22, 6, H - 3 if v != 'glass' else 22, door, edge=True), B(.02, .36, .2, .22, 6, H - 3 if v != 'glass' else 22, door)]
    if v == 'glass': bx += [B(-.36, -.02, .2, .22, 25, H - 3, 'glass'), B(.02, .36, .2, .22, 25, H - 3, 'glass'), B(-.3, .3, -.2, .0, 26, 34, 'enamel')]
    bx += [B(-.07, -.04, .22, .24, 18, 24, 'gold'), B(.04, .07, .22, .24, 18, 24, 'gold')]
    return bx

for t in ('rustic', 'fine'):
    piece(f'cabinet_{t}', (1, 1), 2, 4, ['plain', 'glass', 'painted'], 'furn', tall=True)(lambda v, t=t: cabinet(MAT[t], v, t))

def wardrobe(m, v, tier):
    H = 66
    bx = [panel(-.84, .84, -.4, .22, 3, H, m), slab(-.88, .88, -.44, .26, H, H + 3, m), B(-.8, .8, -.36, .18, 0, 3, m['leg'])]
    for x0, x1 in ((-.8, -.02), (.02, .8)):
        bx.append(B(x0, x1, .22, .24, 6, H - 4, m['trim'] if v != 'carved' else m['w'], None, planksV(5) if tier == 'rustic' else flat(.08)))
    if v == 'mirrored': bx.append(B(-.66, -.16, .24, .25, 14, H - 12, 'glass'))
    if v == 'carved': bx += [B(-.9, .9, -.46, .28, H + 3, H + 7, m['trim']), B(-.7, -.12, .24, .25, 14, 22, m['trim']), B(.12, .7, .24, .25, 14, 22, m['trim']), B(-.7, -.12, .24, .25, 46, 54, m['trim']), B(.12, .7, .24, .25, 46, 54, m['trim'])]
    if tier == 'luxury': bx += [B(-.9, .9, .24, .28, H, H + 3, 'gold')]
    bx += [B(-.1, -.06, .24, .26, 30, 38, 'gold'), B(.06, .1, .24, .26, 30, 38, 'gold')]
    return bx

for t in ('rustic', 'fine', 'luxury'):
    piece(f'wardrobe_{t}', (2, 1), 2, 4, ['plain', 'mirrored', 'carved'], 'furn', tall=True)(lambda v, t=t: wardrobe(MAT[t], v, t))

def dresser(m, v):
    body = 'paint' if v == 'painted' else m['w']; pm = dict(m, top=flat(.06), side=flat(.06), vt=flat(.06)) if v == 'painted' else m
    H = 28; bx = [panel(-.8, .8, -.34, .22, 3, H, pm, body), slab(-.84, .84, -.38, .26, H, H + 3, m), B(-.76, .76, -.3, .18, 0, 3, m['leg'])]
    dr = 'paint2' if v == 'painted' else m['trim']
    for z in (5, 13, 21):
        for x0, x1 in ((-.76, -.02), (.02, .76)): bx += [B(x0, x1, .22, .24, z, z + 6, dr), B((x0 + x1) / 2 - .03, (x0 + x1) / 2 + .03, .24, .26, z + 2, z + 4, 'gold')]
    if v == 'mirror_top': bx += [panel(-.5, .5, -.36, -.3, H + 3, H + 34, m), B(-.42, .42, -.3, -.29, H + 7, H + 30, 'glass')]
    return bx

for t in ('rustic', 'fine'):
    piece(f'dresser_{t}', (2, 1), 2, 4, ['plain', 'mirror_top', 'painted'], 'furn')(lambda v, t=t: dresser(MAT[t], v))
