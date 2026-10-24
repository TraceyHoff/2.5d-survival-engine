"""ADR-112 commit 3: kitchen & workshop furniture and decorations (statues, vessels, storage props, flags, signs,
curtains, clocks, mirrors, tabletop clutter). Wall-mounted (`edge`) pieces hang on the front face of a centre-line wall
(y = +0.15, buildings2 T = 0.12) and keep 4 drawn rows like the building pack's asymmetric pieces."""
from .lib import piece, B, planksH, planksV, flat, cobble, tx_tile, tx_books, tx_woven, CELLS
from .furniture import MAT, legs, slab, panel, cushion, cabinet
from . import toons as TN
WY = .15   # wall face

# ------------------------------------------------------------------ kitchen & workshop
@piece('counter_rustic', (1, 1), 2, 4, ['plain', 'tiled', 'butcher_block'], 'deco', tall=True)
def counter_rustic(v): return counter(MAT['rustic'], v)
@piece('counter_fine', (1, 1), 2, 4, ['plain', 'tiled', 'butcher_block'], 'deco', tall=True)
def counter_fine(v): return counter(MAT['fine'], v)
def counter(m, v):
    bx = [panel(-.44, .44, -.44, .34, 3, 24, m), B(-.42, .42, -.42, .3, 0, 3, m['leg']), B(-.38, .38, .34, .36, 6, 20, m['trim']), B(-.05, .05, .36, .38, 16, 18, 'gold')]
    top = {'plain': slab(-.48, .48, -.48, .4, 24, 27, m), 'tiled': B(-.48, .48, -.48, .4, 24, 27, 'enamel', tx_tile(5), flat(.05), flat(.05)),
           'butcher_block': B(-.48, .48, -.48, .4, 24, 30, 'wood', planksH(3), planksV(2), planksV(2))}[v]
    return bx + [top]

@piece('kitchen_sink', (1, 1), 2, 4, ['stone', 'metal'], 'deco', tall=True)
def kitchen_sink(v):
    m = MAT['rustic']; mt = 'stone' if v == 'stone' else 'iron'; tx = cobble(5) if v == 'stone' else flat(.05)
    bx = [panel(-.44, .44, -.44, .34, 0, 22, m), B(-.38, .38, .34, .36, 4, 18, m['trim'])]
    bx += [B(-.48, .48, -.48, -.34, 22, 30, mt, tx, tx, tx), B(-.48, .48, .26, .4, 22, 30, mt, tx, tx, tx), B(-.48, -.36, -.34, .26, 22, 30, mt, tx, tx, tx), B(.36, .48, -.34, .26, 22, 30, mt, tx, tx, tx),
           B(-.36, .36, -.34, .26, 22, 24, 'water', flat(.1))]
    bx += [B(-.04, .04, -.44, -.38, 30, 42, 'iron'), B(-.04, .04, -.38, -.18, 40, 43, 'iron')]
    return bx

@piece('kitchen_cupboard', (1, 1), 2, 4, ['plain', 'glass', 'painted'], 'deco', tall=True)
def kitchen_cupboard(v):
    m = MAT['rustic']; bx = cabinet(m, v, 'rustic')
    shelf = 'paint' if v == 'painted' else m['w']
    bx += [panel(-.4, .4, -.38, -.18, 47, 66, m, shelf), slab(-.44, .44, -.42, -.14, 66, 69, m), B(-.36, .36, -.18, -.16, 49, 64, 'glass' if v == 'glass' else m['trim'])]
    return bx

@piece('pantry', (1, 1), 2, 4, ['plain', 'slatted'], 'deco', tall=True)
def pantry(v):
    m = MAT['rustic']; H = 64
    bx = [panel(-.42, .42, -.38, .22, 0, H, m), slab(-.46, .46, -.42, .26, H, H + 3, m)]
    if v == 'slatted': bx += [B(-.38, .38, .22, .24, z, z + 2, m['trim']) for z in range(6, H - 4, 5)]
    else: bx += [B(-.38, -.01, .22, .24, 4, H - 4, m['trim'], None, planksV(4)), B(.01, .38, .22, .24, 4, H - 4, m['trim'], None, planksV(4))]
    bx += [B(-.06, -.03, .24, .26, 30, 36, 'iron'), B(.03, .06, .24, .26, 30, 36, 'iron')]
    return bx

@piece('tool_bench', (2, 1), 2, 4, ['vise', 'saw', 'clutter'], 'deco')
def tool_bench(v):
    m = MAT['rustic']
    bx = legs(-.84, .84, -.36, .36, 22, m['leg'], .09) + [slab(-.88, .88, -.4, .4, 22, 26, m), slab(-.8, .8, -.32, .32, 6, 8, m),
          panel(-.88, .88, -.44, -.4, 26, 52, m)] + [B(x, x + .04, -.4, -.36, 34, 46, 'iron') for x in (-.6, -.4, -.2, .2, .5)]
    if v == 'vise': bx += [B(.6, .84, -.1, .14, 26, 34, 'iron'), B(.66, .78, .14, .3, 28, 31, 'iron')]
    if v == 'saw': bx += [B(-.5, .2, .0, .03, 26, 34, 'silver'), B(.2, .34, -.02, .05, 26, 34, 'wood_dark'), B(.4, .8, -.2, .2, 26, 30, 'wood', planksH(3))]
    if v == 'clutter': bx += [B(-.6, -.3, -.2, .05, 26, 32, 'wood'), B(-.2, .0, .0, .2, 26, 28, 'iron'), B(.1, .3, -.25, -.05, 26, 34, 'clay'), B(.4, .7, .05, .25, 26, 29, 'leather'), B(.5, .56, -.3, -.24, 26, 38, 'wood_dark')]
    return bx

@piece('stove_iron', (1, 1), 2, 4, ['black', 'enamel', 'rustic'], 'deco', tall=True)
def stove_iron(v):
    mt = {'black': 'black_iron', 'enamel': 'enamel', 'rustic': 'copper'}[v]
    bx = legs(-.36, .36, -.34, .34, 4, 'black_iron', .06) + [B(-.38, .38, -.36, .36, 4, 26, mt), B(-.4, .4, -.38, .38, 26, 29, 'black_iron'),
          B(-.26, .26, .36, .38, 8, 20, 'black_iron'), B(-.18, .18, .38, .39, 11, 17, 'fire'), B(-.08, .08, -.34, -.18, 29, 70, 'black_iron')]
    bx += [B(x - .1, x + .1, y - .1, y + .1, 29, 30, 'iron') for x, y in ((-.18, .1), (.18, .1))]
    return bx

@piece('cook_range', (2, 1), 2, 4, ['plain', 'tiled'], 'deco', tall=True)
def cook_range(v):
    body = ('brick', cobble(5)) if v == 'plain' else ('enamel', tx_tile(4))
    bx = [B(-.86, .86, -.4, .34, 0, 26, body[0], body[1], body[1], body[1]), B(-.88, .88, -.42, .36, 26, 29, 'black_iron')]
    bx += [B(x - .22, x + .22, .34, .36, 6, 20, 'black_iron') for x in (-.45, .45)] + [B(-.2, .2, .36, .37, 9, 17, 'fire')]
    bx += [B(x - .12, x + .12, -.1 - .12, -.1 + .12, 29, 30, 'iron') for x in (-.5, 0, .5)] + [B(-.3, .3, -.42, -.2, 29, 46, body[0], body[1], body[1], body[1]), B(-.12, .12, -.38, -.24, 46, 76, 'brick', cobble(4), cobble(4), cobble(4))]
    return bx

@piece('clay_oven', (1, 1), 2, 1, ['dome', 'brick'], 'deco', tall=True)
def clay_oven(v):
    if v == 'brick':
        bx = [B(-.44, .44, -.44, .44, 0, 14, 'brick', cobble(4), cobble(4), cobble(4)), B(-.38, .38, -.38, .38, 14, 34, 'brick', cobble(4), cobble(4), cobble(4)),
              B(-.3, .3, -.3, .3, 34, 40, 'brick', cobble(4), cobble(4), cobble(4)), B(-.12, .12, .38, .39, 16, 28, 'ink'), B(-.08, .08, -.08, .08, 40, 54, 'brick')]
        return bx
    bx = [B(-.44, .44, -.44, .44, 0, 12, 'stone', cobble(5), cobble(5), cobble(5))]
    def dome(c):
        c.part(TN.ellipse_pts(16, 20, 13, 12)[:25] + [(3, 24), (29, 24)], 'clay', shade=.35); c.part(TN.ellipse_pts(16, 21, 4, 4)[:25] + [(12, 24), (20, 24)], 'ink', outline=False, flat=True)
        c.part(TN.ellipse_pts(16, 21, 2.6, 2), 'fire', outline=False)
    return bx, [TN.at(0, 0, 12, dome, 48)]

# ------------------------------------------------------------------ statues
@piece('statue', (1, 1), 2, 1, ['bust', 'warrior', 'angel', 'deer', 'bear', 'abstract'], 'deco', tall=True)
def statue(v):
    return [B(-.3, .3, -.3, .3, 0, 6, 'stone', cobble(6), cobble(6), cobble(6)), B(-.22, .22, -.22, .22, 6, 22, 'marble'), B(-.26, .26, -.26, .26, 22, 25, 'marble')], [TN.at(0, 0, 25, TN.statue_fig(v, 'marble'), 48)]

@piece('statue_large', (2, 2), 2, 1, ['hero', 'horse', 'obelisk'], 'deco')
def statue_large(v):
    bx = [B(-.8, .8, -.8, .8, 0, 6, 'stone', cobble(7), cobble(7), cobble(7)), B(-.6, .6, -.6, .6, 6, 20, 'stone', cobble(6), cobble(6), cobble(6)), B(-.64, .64, -.64, .64, 20, 23, 'marble')]
    if v == 'obelisk': return bx + [B(-.24, .24, -.24, .24, 23, 80, 'marble'), B(-.16, .16, -.16, .16, 80, 92, 'marble'), B(-.06, .06, -.06, .06, 92, 98, 'gold')]
    return bx, [TN.at(0, 0, 23, TN.statue_fig(v, 'patina' if v == 'horse' else 'marble'), 88)]

# ------------------------------------------------------------------ vessels (paintable: body R, band G)
PROF = {'tall': [(5, 24), (6, 20), (6.5, 14), (5, 8), (3, 5), (4, 3)], 'round': [(4, 24), (8, 21), (9, 17), (7, 12), (3.5, 10), (4, 9)],
        'painted': [(4.5, 24), (7.5, 20), (8, 15), (6, 10), (3.5, 7), (4.5, 5)], 'amphora': [(2, 24), (6, 19), (7.5, 13), (6, 8), (3, 6), (3, 2), (4, 1)],
        'jug': [(5, 24), (7, 19), (6, 13), (3, 10), (3.5, 8)], 'urn': [(5, 24), (8, 20), (8.5, 14), (6, 10), (6.5, 8)], 'pitcher': [(5, 24), (6, 18), (5, 12), (4.5, 9), (6, 7)]}
def vessel_decor(kind, z=0, size=28, band=True):
    p = PROF[kind]; out = [TN.at(0, 0, z, TN.vessel(p, 'paint', handles=kind in ('amphora', 'jug', 'pitcher', 'urn')), size, role='R')]
    if band: out.append(TN.at(0, 0, z, TN.vessel_band(p, 17, 13.5, 'paint2'), size, role='G'))
    return out

@piece('vase', (1, 1), 3, 1, ['tall', 'round', 'painted', 'amphora'], 'deco')
def vase(v):
    return [], vessel_decor(v, 0, 34, band=v in ('painted', 'amphora'))

@piece('pottery', (1, 1), 3, 1, ['jug', 'bowl_stack', 'urn', 'pitcher'], 'deco')
def pottery(v):
    if v == 'bowl_stack':
        bx = [B(-.2 + i * .02, .2 - i * .02, -.2 + i * .02, .2 - i * .02, i * 3, i * 3 + 3, 'paint' if i % 2 == 0 else 'paint2', flat(.05), flat(.05), flat(.05)) for i in range(4)]
        return bx
    return [], vessel_decor(v, 0, 28)

# ------------------------------------------------------------------ crates & barrels
@piece('crate_decor', (1, 1), 2, 4, ['single', 'stack', 'open'], 'deco')
def crate_decor(v):
    def crate(x0, x1, y0, y1, z0, z1, lid=True):
        bx = [B(x0, x1, y0, y1, z0, z1, 'wood', planksH(4) if lid else flat(.2), planksH(4), planksH(4))]
        bx += [B(x0 - .01, x1 + .01, y1 - .02, y1 + .01, z0, z0 + 2, 'wood_dark'), B(x0 - .01, x1 + .01, y1 - .02, y1 + .01, z1 - 2, z1, 'wood_dark'), B(x1 - .02, x1 + .01, y0 - .01, y1 + .01, z0, z1, 'wood_dark')]
        return bx
    if v == 'stack': return crate(-.4, .4, -.4, .4, 0, 20) + crate(-.3, .26, -.34, .2, 20, 34)
    if v == 'open': return crate(-.36, .36, -.36, .36, 0, 18, lid=False) + [B(-.3, .3, -.3, .3, 16, 18, 'hay', flat(.4)), B(-.1, .1, -.12, .08, 18, 22, 'carrot'), B(.1, .25, .05, .2, 18, 22, 'pumpkin')]
    return crate(-.36, .36, -.36, .36, 0, 22)

def barrel(z0=0, rp='wood', band='iron', h=26, r=.3, water=False, top=None):
    bx = [B(-r, r, -r * .6, r * .6, z0, z0 + h, rp, top, planksV(3), planksV(3)), B(-r * .6, r * .6, -r, r, z0, z0 + h, rp, top, planksV(3), planksV(3)), B(-r * .85, r * .85, -r * .85, r * .85, z0, z0 + h, rp, top, planksV(3), planksV(3))]
    for zb in (z0 + 4, z0 + h - 6): bx.append(B(-r * .87, r * .87, -r * .87, r * .87, zb, zb + 2, band, faces='lr'))
    if water: bx.append(B(-r * .7, r * .7, -r * .7, r * .7, z0 + h - 1, z0 + h, 'water', flat(.1)))
    return bx

@piece('barrel_decor', (1, 1), 2, 1, ['upright', 'side', 'water'], 'deco')
def barrel_decor(v):
    if v == 'side':
        return [B(-.4, .4, -.18, .18, 4, 20, 'wood', planksH(3), planksH(3), planksH(3)), B(-.4, .4, -.24, .24, 6, 18, 'wood', planksH(3), planksH(3), planksH(3)),
                B(-.24, -.2, -.25, .25, 4, 20, 'iron'), B(.2, .24, -.25, .25, 4, 20, 'iron'), B(.4, .42, -.14, .14, 7, 17, 'wood_dark'), B(-.3, -.1, -.3, -.1, 0, 4, 'wood_dark'), B(-.3, -.1, .1, .3, 0, 4, 'wood_dark')]
    return barrel(water=v == 'water')

@piece('barrel_storage', (1, 1), 2, 1, ['oak', 'iron_band'], 'deco')
def barrel_storage(v):
    return barrel(rp='wood' if v == 'oak' else 'wood_dark', band='wood_dark' if v == 'oak' else 'black_iron', h=30, r=.34, top=planksH(4))

# ------------------------------------------------------------------ wall-mounted
def plaque(rp='wood_dark', w=.2, z0=26, z1=44):
    return B(-w, w, WY, WY + .04, z0, z1, rp, flat(.1), planksV(3), planksV(3))

@piece('trophy_mount', (1, 1), 3, 4, ['deer', 'elk', 'moose', 'boar', 'wolf', 'bear', 'bison', 'rabbit'], 'deco', tall=True, shadow=False)
def trophy_mount(v):
    return [plaque()], [TN.at(0, WY + .06, 22, TN.head(v), 36, flip_odd=True)]

@piece('sign_wall', (1, 1), 3, 4, ['plain', 'carved'], 'deco', tall=True, shadow=False)
def sign_wall(v):
    bx = [B(-.36, .36, WY, WY + .04, 30, 44, 'wood', flat(.1), planksH(4), planksH(4))]
    if v == 'carved': bx += [B(-.38, .38, WY, WY + .05, 44, 46, 'wood_dark'), B(-.38, .38, WY, WY + .05, 28, 30, 'wood_dark'), B(-.22, .22, WY + .04, WY + .05, 34, 40, 'gold')]
    else: bx += [B(-.24, .2, WY + .04, WY + .05, 36, 38, 'ink')]
    return bx

@piece('curtains', (1, 1), 3, 4, ['short', 'long', 'sheer', 'heavy'], 'deco', tall=True, shadow=False)
def curtains(v):
    z0 = 0 if v in ('long', 'heavy') else 18; tex = planksV(2)
    bx = [B(-.48, .48, WY + .04, WY + .07, 52, 54, 'wood_dark')]
    w = .2 if v != 'heavy' else .24
    for s in (-1, 1):
        x0, x1 = (-.46, -.46 + w) if s < 0 else (.46 - w, .46)
        bx.append(B(x0, x1, WY + .02, WY + .07, z0, 52, 'paint', flat(.05), tex, tex))
        if v == 'heavy': bx.append(B(x0 - .01, x1 + .01, WY + .07, WY + .08, 22, 25, 'paint2'))
    if v == 'sheer': bx.append(B(-.46 + w, .46 - w, WY + .03, WY + .04, z0 + 4, 52, 'glass', flat(.05), planksV(2), planksV(2)))
    if v == 'short': bx.append(B(-.46, .46, WY + .03, WY + .07, 46, 52, 'paint2', flat(.05), tex, tex))
    return bx

@piece('clock', (1, 1), 2, 4, ['grandfather', 'mantel'], 'deco', tall=True)
def clock(v):
    m = MAT['fine']
    if v == 'mantel':
        return [panel(-.24, .24, -.12, .12, 0, 16, m), slab(-.27, .27, -.15, .15, 16, 18, m), B(-.14, .14, .12, .13, 4, 14, 'enamel'), B(-.01, .01, .13, .14, 8, 12, 'ink'), B(-.01, .07, .13, .14, 9, 10, 'ink')]
    return [panel(-.24, .24, -.2, .16, 0, 64, m), slab(-.28, .28, -.24, .2, 64, 68, m), B(-.18, .18, .16, .17, 46, 60, 'enamel'), B(-.01, .01, .17, .18, 52, 58, 'ink'), B(-.01, .08, .17, .18, 52, 53, 'ink'),
            B(-.12, .12, .16, .17, 10, 40, 'glass'), B(-.02, .02, .17, .18, 16, 38, 'gold'), B(-.06, .06, .17, .18, 16, 22, 'gold')]

@piece('clock_wall', (1, 1), 3, 4, ['round', 'cuckoo'], 'deco', tall=True, shadow=False)
def clock_wall(v):
    if v == 'cuckoo':
        return [B(-.16, .16, WY, WY + .1, 28, 46, 'wood_dark', planksH(3), planksV(3), planksV(3)), B(-.2, .2, WY, WY + .14, 46, 49, 'wood'), B(-.1, .1, WY + .1, WY + .11, 33, 43, 'enamel'),
                B(-.04, .04, WY + .1, WY + .11, 44, 46, 'ink'), B(-.08, -.05, WY + .02, WY + .05, 12, 26, 'gold'), B(.05, .08, WY + .02, WY + .05, 16, 26, 'gold')]
    return [B(-.18, .18, WY, WY + .04, 28, 48, 'wood_dark'), B(-.15, .15, WY + .04, WY + .05, 30, 46, 'enamel'), B(-.01, .01, WY + .05, WY + .06, 37, 44, 'ink'), B(-.01, .1, WY + .05, WY + .06, 37, 38, 'ink')]

@piece('mirror_standing', (1, 1), 2, 4, ['oval', 'tall'], 'deco', tall=True)
def mirror_standing(v):
    m = MAT['fine']
    if v == 'oval':
        return [B(-.2, .2, -.16, .16, 0, 3, m['w']), B(-.18, -.14, -.02, .02, 3, 40, m['w']), B(.14, .18, -.02, .02, 3, 40, m['w']), B(-.14, .14, -.03, .02, 18, 56, 'gold'), B(-.11, .11, .02, .03, 21, 53, 'glass')]
    return [B(-.24, .24, -.2, .0, 0, 64, m['w']), B(-.2, .2, .0, .01, 4, 60, 'glass'), B(-.26, .26, -.22, .02, 64, 67, 'gold')]

@piece('mirror_wall', (1, 1), 3, 4, ['round', 'gilded'], 'deco', tall=True, shadow=False)
def mirror_wall(v):
    rp = 'gold' if v == 'gilded' else 'wood_dark'
    bx = [B(-.22, .22, WY, WY + .03, 24, 52, rp), B(-.18, .18, WY + .03, WY + .04, 27, 49, 'glass')]
    if v == 'gilded': bx += [B(-.26, .26, WY, WY + .04, 52, 56, 'gold'), B(-.06, .06, WY, WY + .04, 56, 60, 'gold')]
    return bx

# ------------------------------------------------------------------ flags & signs
@piece('clan_flag', (1, 1), 3, 1, ['pole', 'crossed', 'tall'], 'deco', tall=True)
def clan_flag(v):
    H = 84 if v == 'tall' else 64
    bx = [B(-.12, .12, -.12, .12, 0, 4, 'stone')]
    poles = [(0, 0)] if v != 'crossed' else [(-.1, 0), (.1, 0)]
    for px, py in poles: bx.append(B(px - .02, px + .02, py - .02, py + .02, 4, H, 'wood_dark'))
    if v == 'crossed':
        bx += [B(-.5, -.08, -.01, .01, H - 34, H - 4, 'paint', flat(.05), planksV(3), planksV(3)), B(.08, .5, -.01, .01, H - 30, H - 2, 'paint', flat(.05), planksV(3), planksV(3)),
               B(-.36, -.22, .01, .02, H - 24, H - 14, 'paint2'), B(.22, .36, .01, .02, H - 20, H - 10, 'paint2')]
    else:
        bx += [B(.02, .5, -.01, .01, H - 30, H - 2, 'paint', flat(.05), planksV(3), planksV(3)), B(.18, .34, .01, .02, H - 22, H - 10, 'paint2'), B(-.03, .03, -.03, .03, H, H + 3, 'gold')]
    return bx

@piece('sign', (1, 1), 3, 4, ['post', 'hanging', 'arrow', 'board'], 'deco', tall=True)
def sign(v):
    bx = [B(-.03, .03, -.03, .03, 0, 52 if v != 'board' else 40, 'wood_dark')]
    if v == 'post': bx += [B(-.3, .3, .03, .06, 28, 42, 'wood', flat(.1), planksH(4), planksH(4))]
    if v == 'hanging': bx += [B(-.03, .4, -.02, .02, 48, 51, 'wood_dark'), B(.06, .38, -.01, .01, 26, 42, 'wood', flat(.1), planksH(4), planksH(4)), B(.08, .09, -.01, .01, 42, 48, 'iron'), B(.35, .36, -.01, .01, 42, 48, 'iron')]
    if v == 'arrow': bx += [B(-.1, .4, .03, .06, 40, 46, 'wood', flat(.1), planksH(2), planksH(2)), B(.4, .46, .03, .06, 41, 45, 'wood'), B(-.4, .1, -.06, -.03, 30, 36, 'wood', flat(.1), planksH(2), planksH(2))]
    if v == 'board': bx = [B(x - .03, x + .03, -.03, .03, 0, 40, 'wood_dark') for x in (-.34, .34)] + [B(-.4, .4, .03, .06, 16, 40, 'wood', flat(.1), planksH(4), planksH(4)), B(-.3, -.1, .06, .07, 26, 36, 'snow'), B(.0, .24, .06, .07, 22, 34, 'cloth_cream')]
    return bx

# ------------------------------------------------------------------ tabletop clutter (layer 3)
@piece('books', (1, 1), 3, 1, ['stack', 'open', 'row'], 'deco')
def books(v):
    cols = ['cloth_red', 'cloth_blue', 'leather', 'cloth_green', 'cloth_purple']
    if v == 'stack': return [B(-.2 + .02 * (i % 2), .18 + .02 * (i % 3), -.14 - .01 * i, .14, i * 3, i * 3 + 3, cols[i], flat(.1), planksH(1), planksH(1)) for i in range(5)]
    if v == 'open': return [B(-.24, .24, -.16, .16, 0, 3, 'leather'), B(-.22, -.01, -.14, .14, 3, 5, 'snow'), B(.01, .22, -.14, .14, 3, 5, 'snow'), B(-.02, .02, -.14, .14, 3, 4, 'ink')]
    return [B(-.3 + i * .1, -.22 + i * .1, -.14, .14, 0, 14 + (i * 7) % 5, cols[i % 5], flat(.1), flat(.1), flat(.1)) for i in range(6)] + [B(-.34, -.3, -.14, .14, 0, 16, 'iron'), B(.3, .34, -.14, .14, 0, 16, 'iron')]

@piece('dishes', (1, 1), 3, 1, ['plates', 'cups', 'set', 'cutlery'], 'deco')
def dishes(v):
    if v == 'plates': return [B(-.18, .18, -.18, .18, i * 1.5, i * 1.5 + 1.5, 'enamel', flat(.05), flat(.05), flat(.05)) for i in range(6)]
    if v == 'cups': return [B(x - .07, x + .07, y - .07, y + .07, 0, 7, 'enamel') for x, y in ((-.14, -.1), (.1, -.14), (.0, .12))]
    if v == 'cutlery': return [B(-.2, .2, -.16, .16, 0, 2, 'wood'), B(-.12, .12, -.08, -.06, 2, 3, 'silver'), B(-.12, .12, -.01, .01, 2, 3, 'silver'), B(-.12, .12, .06, .08, 2, 3, 'silver')]
    return [B(-.2, .2, -.2, .2, 0, 1.5, 'enamel'), B(-.06, .06, -.06, .06, 1.5, 9, 'enamel'), B(.12, .2, -.16, -.08, 1.5, 6, 'enamel'), B(-.2, -.12, .08, .16, 1.5, 6, 'enamel')]

@piece('basket', (1, 1), 3, 1, ['wicker', 'laundry', 'fruit'], 'deco')
def basket(v):
    h = 18 if v == 'laundry' else 9; r = .24 if v != 'fruit' else .28
    bx = [B(-r, r, -r, r, 0, h, 'hay', tx_woven, tx_woven, tx_woven)]
    if v == 'laundry': bx += [B(-r + .03, r - .03, -r + .03, r - .03, h, h + 3, 'cloth_cream', flat(.3)), B(-.08, .08, -.1, .1, h + 3, h + 5, 'cloth_blue')]
    if v == 'fruit': bx += [B(x - .07, x + .07, y - .07, y + .07, h, h + 5, c) for x, y, c in ((-.1, -.08, 'berry'), (.1, -.05, 'carrot'), (0, .1, 'leaf'), (.05, -.12, 'flower_yel'))]
    if v == 'wicker': bx += [B(-.02, .02, -r, r, h, h + 10, 'wood', faces='lr')]
    return bx
