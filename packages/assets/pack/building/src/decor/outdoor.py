"""ADR-112 commit 5: outdoor decor. Fences/gates run along the tile's x axis (2 drawn rows, emitted r0,r1,r0,r1);
paths and stepping stones are flat layer-1 pieces with no shadow; organic pieces (hedges, flower beds) are 1 row (mirror)."""
from .lib import piece, B, planksH, planksV, flat, cobble, tx_tile
from . import toons as TN

# ------------------------------------------------------------------ fences & gate
@piece('fence_picket', (1, 1), 1, 2, ['white', 'natural', 'rustic'], 'yard')
def fence_picket(v):
    rp = 'paint' if v == 'white' else ('wood' if v == 'natural' else 'wood_dark')
    bx = [B(-.5, .5, -.02, .02, z, z + 2, rp) for z in (6, 18)]
    for i in range(6):
        x = -.42 + i * .168; h = 26 if v != 'rustic' else 22 + (i * 5) % 7
        bx.append(B(x - .04, x + .04, .02, .05, 0, h, rp, flat(.1), planksV(1), planksV(1)))
    return bx

@piece('fence_rail', (1, 1), 1, 2, ['split', 'post'], 'yard')
def fence_rail(v):
    bx = [B(x - .05, x + .05, -.05, .05, 0, 28, 'wood_dark', planksH(1)) for x in (-.44, .44)]
    if v == 'post': bx.append(B(-.05, .05, -.05, .05, 0, 28, 'wood_dark'))
    bx += [B(-.5, .5, -.025, .025, z, z + 3, 'wood', None, planksH(1), planksH(1)) for z in ((10, 21) if v == 'split' else (8, 16, 24))]
    return bx

@piece('fence_iron', (1, 1), 1, 2, ['plain', 'spiked'], 'yard', tall=True)
def fence_iron(v):
    bx = [B(-.5, .5, -.015, .015, z, z + 2, 'black_iron') for z in (4, 30)] + [B(x - .05, x + .05, -.05, .05, 0, 40, 'stone') for x in (-.46, .46)]
    for i in range(9):
        x = -.36 + i * .09; bx.append(B(x - .01, x + .01, -.01, .01, 0, 34, 'black_iron'))
        if v == 'spiked': bx.append(B(x - .02, x + .02, -.02, .02, 34, 38, 'black_iron'))
    return bx

@piece('garden_gate', (1, 1), 1, 2, ['picket', 'iron', 'rustic'], 'yard', tall=True)
def garden_gate(v):
    post = 'stone' if v == 'iron' else 'wood_dark'
    bx = [B(x - .06, x + .06, -.06, .06, 0, 36, post) for x in (-.46, .46)]
    if v == 'iron': bx += [B(-.4, .4, -.015, .015, z, z + 2, 'black_iron') for z in (4, 28)] + [B(-.36 + i * .09, -.34 + i * .09, -.01, .01, 0, 32 + 4 * (1 - abs(i - 4) / 4), 'black_iron') for i in range(9)]
    elif v == 'picket': bx += [B(-.4, .4, -.02, .02, z, z + 2, 'paint') for z in (6, 18)] + [B(-.38 + i * .127, -.3 + i * .127, .02, .05, 0, 26 + (3 - abs(i - 3)) * 2, 'paint', flat(.1), planksV(1), planksV(1)) for i in range(7)]
    else: bx += [B(-.4, .4, -.03, .03, 2, 26, 'wood', None, planksV(5), planksV(5)), B(-.4, .4, .03, .05, 12, 15, 'wood_dark'), B(.28, .34, .05, .07, 14, 16, 'iron')]
    return bx

# ------------------------------------------------------------------ furniture-ish
@piece('bench_park', (2, 1), 2, 4, ['wood', 'iron', 'stone'], 'yard')
def bench_park(v):
    if v == 'stone': return [B(x - .12, x + .12, -.2, .2, 0, 12, 'stone', cobble(4)) for x in (-.6, .6)] + [B(-.86, .86, -.26, .26, 12, 17, 'stone', flat(.15), flat(.1), flat(.1))]
    fr = 'black_iron' if v == 'iron' else 'wood_dark'; sl = 'wood' if v == 'wood' else 'wood_dark'
    bx = [B(x - .04, x + .04, -.22, .22, 0, 14, fr) for x in (-.7, .7)] + [B(x - .04, x + .04, .18, .24, 14, 32, fr) for x in (-.7, .7)]
    bx += [B(-.86, .86, -.22 + i * .14, -.12 + i * .14, 14, 16, sl, planksH(1)) for i in range(3)] + [B(-.86, .86, .2, .24, z, z + 4, sl, None, planksH(1), planksH(1)) for z in (20, 27)]
    return bx

PB = {'long': (-.44, .44, -.22, .22, 12), 'square': (-.34, .34, -.34, .34, 14), 'raised': (-.4, .4, -.3, .3, 22)}
@piece('planter_box', (1, 1), 2, 1, ['long', 'square', 'raised'], 'yard')
def planter_box(v):
    x0, x1, y0, y1, h = PB[v]
    bx = [B(x0, x1, y0, y1, 0 if v != 'raised' else 10, h, 'wood', planksH(3), planksH(3), planksH(3)), B(x0 + .03, x1 - .03, y0 + .03, y1 - .03, h - 1, h, 'dirt', flat(.4))]
    if v == 'raised': bx += [B(x - .04, x + .04, y - .04, y + .04, 0, 10, 'wood_dark') for x in (x0 + .05, x1 - .05) for y in (y0 + .05, y1 - .05)]
    return bx, [TN.at(0, 0, h - 1, TN.plant('daisy' if v == 'square' else 'herbs'), 44)]

@piece('garden_bed', (2, 1), 1, 1, ['raised', 'stone'], 'yard')
def garden_bed(v):
    m, t = ('wood', planksH(2)) if v == 'raised' else ('stone', cobble(4)); h = 10 if v == 'raised' else 7
    bx = [B(-.9, .9, -.4, -.32, 0, h, m, t, t, t), B(-.9, .9, .32, .4, 0, h, m, t, t, t), B(-.9, -.82, -.32, .32, 0, h, m, t, t, t), B(.82, .9, -.32, .32, 0, h, m, t, t, t), B(-.82, .82, -.32, .32, 0, h - 2, 'dirt', flat(.5))]
    return bx, [TN.at(x, 0, h - 2, TN.plant('herbs'), 30) for x in (-.5, 0, .5)]

@piece('fountain', (2, 2), 2, 1, ['tiered', 'round', 'lion'], 'yard', tall=False)
def fountain(v):
    t = cobble(6)
    bx = [B(-.86, .86, -.6, .6, 0, 10, 'stone', t, t, t), B(-.6, .6, -.86, .86, 0, 10, 'stone', t, t, t), B(-.76, .76, -.76, .76, 0, 10, 'stone', t, t, t),
          B(-.7, .7, -.5, .5, 9, 10, 'water', flat(.1)), B(-.5, .5, -.7, .7, 9, 10, 'water', flat(.1))]
    if v == 'tiered': bx += [B(-.1, .1, -.1, .1, 10, 34, 'marble'), B(-.34, .34, -.34, .34, 24, 28, 'marble'), B(-.28, .28, -.28, .28, 27, 28, 'water'), B(-.16, .16, -.16, .16, 40, 43, 'marble'), B(-.06, .06, -.06, .06, 28, 48, 'marble'), B(-.03, .03, -.03, .03, 48, 54, 'water')]
    if v == 'round': bx += [B(-.14, .14, -.14, .14, 10, 22, 'marble'), B(-.04, .04, -.04, .04, 22, 34, 'water')]
    if v == 'lion': return bx + [B(-.3, .3, -.2, .2, 10, 22, 'stone', t, t, t)], [TN.at(0, 0, 22, TN.head('bear'), 36)]
    return bx

@piece('well', (2, 2), 2, 1, ['stone', 'roofed'], 'yard', tall=True)
def well(v):
    t = cobble(5)
    bx = [B(-.5, .5, -.36, .36, 0, 18, 'stone', t, t, t), B(-.36, .36, -.5, .5, 0, 18, 'stone', t, t, t), B(-.44, .44, -.44, .44, 0, 18, 'stone', t, t, t), B(-.3, .3, -.3, .3, 17, 18, 'water_deep')]
    if v == 'roofed':
        bx += [B(x - .04, x + .04, -.04, .04, 18, 56, 'wood_dark') for x in (-.5, .5)] + [B(-.54, .54, -.03, .03, 44, 47, 'wood'), B(-.04, .04, -.04, .04, 26, 44, 'iron'), B(-.08, .08, -.08, .08, 22, 28, 'wood')]
        bx += [B(-.66, .66, -.5, .0, 56, 64, 'thatch', planksH(4), planksH(4), planksH(4)), B(-.66, .66, .0, .5, 56, 64, 'thatch', planksH(4), planksH(4), planksH(4)), B(-.6, .6, -.25, .25, 64, 70, 'thatch', planksH(3), planksH(3), planksH(3))]
    else: bx += [B(-.3, -.26, -.02, .02, 18, 40, 'wood_dark'), B(.26, .3, -.02, .02, 18, 40, 'wood_dark'), B(-.3, .3, -.02, .02, 38, 40, 'wood_dark')]
    return bx

@piece('scarecrow', (1, 1), 2, 1, ['classic', 'pumpkin', 'tattered'], 'yard', tall=True)
def scarecrow(v):
    shirt = {'classic': 'cloth_denim', 'pumpkin': 'cloth_red', 'tattered': 'hide'}[v]
    bx = [B(-.03, .03, -.03, .03, 0, 58, 'wood_dark'), B(-.4, .4, -.03, .03, 44, 47, 'wood_dark'), B(-.14, .14, -.08, .08, 26, 48, shirt, flat(.2), planksV(2), planksV(2)), B(-.4, -.14, -.05, .05, 42, 48, shirt), B(.14, .4, -.05, .05, 42, 48, shirt),
          B(-.05, .05, -.05, .05, 22, 26, 'hay'), B(-.44, -.38, -.03, .03, 40, 46, 'hay'), B(.38, .44, -.03, .03, 40, 46, 'hay')]
    if v == 'pumpkin': bx += [B(-.12, .12, -.12, .12, 48, 60, 'pumpkin'), B(-.02, .02, -.02, .02, 60, 63, 'grass_deep')]
    else: bx += [B(-.09, .09, -.09, .09, 48, 60, 'cloth_cream' if v == 'classic' else 'hide'), B(-.18, .18, -.18, .18, 60, 62, 'hay'), B(-.1, .1, -.1, .1, 62, 68, 'hay')]
    if v == 'tattered': bx += [B(-.14, -.08, .08, .09, 20, 26, 'hide'), B(.06, .12, .08, .09, 18, 26, 'hide')]
    return bx

# ------------------------------------------------------------------ ground
PATH = {'cobble': ('cobble', cobble(4)), 'flagstone': ('slate', cobble(7)), 'gravel': ('stone', flat(.6)), 'brick': ('brick', tx_tile(5)), 'plank': ('wood', planksH(5))}
@piece('path_stone', (1, 1), 1, 1, list(PATH), 'yard', flat_=True)
def path_stone(v):
    rp, t = PATH[v]; return [B(-.48, .48, -.48, .48, 0, 1, rp, t)]

@piece('stepping_stone', (1, 1), 1, 1, ['round', 'slate'], 'yard', flat_=True)
def stepping_stone(v):
    rp = 'stone' if v == 'round' else 'slate'
    if v == 'round': return [B(-.22, .22, -.3, .3, 0, 1.5, rp, flat(.2)), B(-.3, .3, -.22, .22, 0, 1.5, rp, flat(.2)), B(-.27, .27, -.27, .27, 0, 1.5, rp, flat(.2))]
    return [B(-.34, .1, -.3, .14, 0, 1.5, rp, flat(.2)), B(.04, .36, .02, .34, 0, 1.5, rp, flat(.2))]

@piece('hedge', (1, 1), 2, 1, ['box', 'round', 'tall'], 'yard', tall=True)
def hedge(v):
    if v == 'box': return [B(-.46, .46, -.46, .46, 0, 24, 'leaf', flat(.7), flat(.7), flat(.7))]
    if v == 'tall': return [B(-.4, .4, -.4, .4, 0, 50, 'leaf', flat(.7), flat(.7), flat(.7))]
    return [B(-.06, .06, -.06, .06, 0, 8, 'bark')], [TN.at(0, 0, 4, TN.plant('shrub'), 56)]

FB = {'red': ['rose'] * 3, 'yellow': ['sunflower', 'daisy', 'sunflower'], 'mixed': ['rose', 'tulip', 'lavender'], 'wild': ['daisy', 'lavender', 'tulip']}
@piece('flower_bed', (1, 1), 1, 1, list(FB), 'yard', tall=True)
def flower_bed(v):
    bx = [B(-.46, .46, -.46, .46, 0, 3, 'dirt', flat(.5))] + [B(-.48, .48, y - .02, y + .02, 0, 4, 'stone') for y in (-.46, .46)]
    return bx, [TN.at(x, y, 3, TN.plant(k), 30) for (x, y), k in zip(((-.24, -.18), (.22, -.1), (0, .22)), FB[v])]

@piece('birdbath', (1, 1), 2, 1, ['stone', 'copper'], 'yard')
def birdbath(v):
    rp = 'stone' if v == 'stone' else 'patina'
    return [B(-.18, .18, -.18, .18, 0, 4, rp), B(-.07, .07, -.07, .07, 4, 22, rp), B(-.3, .3, -.3, .3, 22, 26, rp), B(-.25, .25, -.25, .25, 25, 26, 'water')]

@piece('sundial', (1, 1), 2, 1, ['stone', 'bronze'], 'yard')
def sundial(v):
    rp = 'stone' if v == 'stone' else 'copper'
    return [B(-.16, .16, -.16, .16, 0, 4, 'stone'), B(-.1, .1, -.1, .1, 4, 20, 'stone', cobble(3)), B(-.24, .24, -.24, .24, 20, 23, rp, flat(.1)), B(-.01, .01, -.12, .08, 23, 30, rp)]
