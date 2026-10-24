"""ADR-112 commit 4: house plants, wall hangings and rugs. Wall pieces hang on the front face of a centre-line wall
(y = +0.15) with 4 rows; plants are 1 row (mirror); rugs are flat layer-1 pieces (no shadow, 1 row) whose pattern is
baked two-tone through the 'rugbase' ramp so paint (R) x pattern (G) tints from the tintmask."""
from .lib import piece, B, planksH, planksV, flat, cobble, tx_rug, tx_woven
from . import toons as TN
WY = .15
CANV = [B(-.3, .3, WY, WY + .03, 24, 50, 'wood_dark')]

def pot(rp='clay', r=.18, h=12, z0=0):
    return [B(-r, r, -r, r, z0, z0 + h, rp, flat(.15), flat(.1), flat(.1)), B(-r - .03, r + .03, -r - .03, r + .03, z0 + h - 2, z0 + h, rp), B(-r + .02, r - .02, -r + .02, r - .02, z0 + h - 1, z0 + h, 'dirt')]

# ------------------------------------------------------------------ house plants
@piece('plant_floor', (1, 1), 3, 1, ['fern', 'palm', 'ficus', 'monstera', 'snake_plant'], 'home', tall=True)
def plant_floor(v): return pot('clay', .22, 16), [TN.at(0, 0, 15, TN.plant(v), 64)]
@piece('fern', (1, 1), 3, 1, ['boston', 'maidenhair'], 'home')
def fern(v): return pot('enamel', .16, 10), [TN.at(0, 0, 9, TN.plant(v), 40)]
@piece('cactus', (1, 1), 3, 1, ['barrel', 'saguaro', 'prickly', 'flowering'], 'home')
def cactus(v): return pot('clay', .15, 9), [TN.at(0, 0, 8, TN.plant(v), 36)]
@piece('flowers_pot', (1, 1), 3, 1, ['rose', 'tulip', 'daisy', 'lavender', 'sunflower'], 'home')
def flowers_pot(v): return pot('clay', .15, 9), [TN.at(0, 0, 8, TN.plant(v), 40 if v == 'sunflower' else 34)]
@piece('hanging_plant', (1, 1), 3, 1, ['ivy', 'spider', 'pearls'], 'home', tall=True, shadow=False)
def hanging_plant(v):
    bx = [B(-.01, .01, -.01, .01, 46, 72, 'iron')] + pot('clay', .15, 8, 38)
    return bx, [TN.at(0, 0, 18, TN.plant(v), 44)]
@piece('bonsai', (1, 1), 3, 1, ['pine', 'maple'], 'home')
def bonsai(v): return [B(-.22, .22, -.15, .15, 0, 5, 'clay', flat(.1)), B(-.2, .2, -.13, .13, 4, 5, 'dirt')], [TN.at(0, 0, 5, TN.plant(v), 36)]

PLM = {'wood': ('wood', planksH(3)), 'clay': ('clay', flat(.15)), 'stone': ('stone', cobble(5))}
@piece('herb_planter', (1, 1), 2, 1, ['wood', 'clay', 'stone'], 'home')
def herb_planter(v):
    m, t = PLM[v]
    return [B(-.4, .4, -.3, .3, 0, 14, m, t, t, t), B(-.36, .36, -.26, .26, 13, 14, 'dirt', flat(.4))], [TN.at(0, 0, 13, TN.plant('herbs'), 48)]
@piece('window_planter', (1, 1), 3, 4, ['wood', 'clay'], 'home', tall=True, shadow=False)
def window_planter(v):
    m, t = PLM[v]
    return [B(-.4, .4, WY, WY + .18, 20, 28, m, t, t, t), B(-.37, .37, WY + .02, WY + .16, 27, 28, 'dirt'), B(-.3, -.26, WY, WY + .12, 16, 20, 'iron'), B(.26, .3, WY, WY + .12, 16, 20, 'iron')], \
           [TN.at(0, WY + .09, 27, TN.plant('daisy'), 30), TN.at(-.22, WY + .09, 27, TN.plant('herbs'), 26), TN.at(.22, WY + .09, 27, TN.plant('tulip'), 26)]

# ------------------------------------------------------------------ wall hangings
SCENE = {'landscape': [('grass', 24, 34), ('cloth_blue', 34, 50), ('leaf', 30, 38, -.1, .12)], 'portrait': [('wood_dark', 24, 50), ('skin_light', 36, 44, -.06, .06), ('cloth_red', 26, 36, -.12, .12)],
         'still_life': [('cloth_cream', 24, 50), ('berry', 28, 32, -.14, -.04), ('flower_yel', 28, 33, .02, .12), ('clay', 28, 38, -.04, .04)], 'abstract': [('cloth_yellow', 24, 50), ('cloth_red', 30, 46, -.2, 0), ('cloth_blue', 26, 38, .05, .25)],
         'seascape': [('water_deep', 24, 34), ('water', 34, 38), ('cloth_cream', 38, 50), ('snow', 34, 42, .08, .12)], 'battle': [('smoke', 24, 50), ('fire', 34, 42, -.2, -.05), ('iron', 26, 34, .0, .2)],
         'map': [('sand', 24, 50), ('grass', 30, 40, -.2, .02), ('water', 26, 32, .05, .25)], 'hunt': [('grass_deep', 24, 34), ('cloth_cream', 34, 50), ('fur_brown', 32, 38, -.05, .1)]}
def picture(spec, z0=24, z1=50, w=.3, frame='gold'):
    bx = [B(-w - .03, w + .03, WY, WY + .03, z0 - 2, z1 + 2, frame)]
    for s in spec:
        rp, a, b = s[:3]; x0, x1 = (s[3], s[4]) if len(s) > 3 else (-w, w)
        k = len(bx); bx.append(B(x0, x1, WY + .03 + k * .001, WY + .031 + k * .001, a + (z0 - 24), b + (z0 - 24), rp, flat(.1), flat(.1), flat(.1)))
    return bx
@piece('painting_wall', (1, 1), 3, 4, list(SCENE), 'home', tall=True, shadow=False)
def painting_wall(v): return picture(SCENE[v], frame='gold' if v in ('portrait', 'battle', 'seascape') else 'wood_dark')

POST = {'wanted': ('sand', 'ink', 'skin_tan'), 'propaganda': ('cloth_red', 'ink', 'cloth_yellow'), 'band': ('ink', 'cloth_purple', 'flower_pink'), 'map': ('sand', 'grass', 'water'),
        'recruit': ('cloth_blue', 'snow', 'cloth_red'), 'travel': ('cloth_teal', 'flower_yel', 'water')}
@piece('poster', (1, 1), 3, 4, list(POST), 'home', tall=True, shadow=False)
def poster(v):
    a, b, c = POST[v]
    return [B(-.18, .18, WY, WY + .01, 24, 50, a, flat(.2)), B(-.14, .14, WY + .01, WY + .015, 44, 48, b), B(-.1, .1, WY + .01, WY + .015, 30, 42, c), B(-.14, .14, WY + .01, WY + .015, 26, 28, b)]

TAP = {'hunt': [(-.2, .0, 22, 30), (.05, .2, 30, 36)], 'crest': [(-.1, .1, 26, 42)], 'forest': [(-.25, -.1, 14, 40), (.08, .24, 14, 36)], 'dragon': [(-.22, .2, 24, 32), (.1, .22, 32, 40)]}
@piece('tapestry', (1, 1), 3, 4, list(TAP), 'home', tall=True, shadow=False)
def tapestry(v):
    bx = [B(-.36, .36, WY + .03, WY + .05, 52, 54, 'wood_dark'), B(-.32, .32, WY, WY + .03, 8, 52, 'paint', flat(.05), planksV(2), planksV(2))]
    bx += [B(x0, x1, WY + .03, WY + .035, a, b, 'paint2') for x0, x1, a, b in TAP[v]] + [B(-.32 + i * .08, -.29 + i * .08, WY, WY + .03, 4, 8, 'paint2') for i in range(9)]
    return bx

@piece('weapon_rack', (1, 1), 3, 4, ['swords', 'spears', 'rifles', 'bows'], 'home', tall=True, shadow=False)
def weapon_rack(v):
    bx = [B(-.4, .4, WY, WY + .06, 44, 47, 'wood_dark'), B(-.4, .4, WY, WY + .06, 22, 25, 'wood_dark')]
    for x in (-.24, 0, .24):
        if v == 'swords': bx += [B(x - .015, x + .015, WY + .06, WY + .08, 20, 48, 'silver'), B(x - .06, x + .06, WY + .06, WY + .08, 40, 42, 'gold'), B(x - .02, x + .02, WY + .06, WY + .08, 42, 48, 'leather')]
        if v == 'spears': bx += [B(x - .012, x + .012, WY + .06, WY + .08, 8, 58, 'wood'), B(x - .03, x + .03, WY + .06, WY + .08, 58, 66, 'silver')]
        if v == 'rifles': bx += [B(x - .02, x + .02, WY + .06, WY + .09, 26, 54, 'black_iron'), B(x - .04, x + .03, WY + .06, WY + .09, 14, 28, 'wood')]
        if v == 'bows': bx += [B(x - .01, x + .03, WY + .06, WY + .08, 14, 54, 'wood'), B(x - .03, x - .02, WY + .06, WY + .07, 16, 52, 'snow')]
    return bx

@piece('wall_shelf', (1, 1), 3, 4, ['plank', 'double', 'corner', 'potted'], 'home', tall=True, shadow=False)
def wall_shelf(v):
    sh = lambda z, w=.38, d=.16: [B(-w, w, WY, WY + d, z, z + 2, 'wood', planksH(2)), B(-w + .04, -w + .07, WY, WY + .1, z - 6, z, 'iron'), B(w - .07, w - .04, WY, WY + .1, z - 6, z, 'iron')]
    if v == 'corner': return [B(-.38, -.1, WY, WY + .28, z, z + 2, 'wood', planksH(2)) for z in (26, 38, 50)] + [B(-.12, -.09, WY, WY + .26, 26, 52, 'wood_dark'), B(-.32, -.22, WY + .05, WY + .15, 28, 34, 'clay')]
    bx = sh(32)
    if v == 'double': bx += sh(46) + [B(-.3 + i * .07, -.25 + i * .07, WY + .02, WY + .13, 48, 56 + i % 3, ['cloth_red', 'cloth_blue', 'leather', 'cloth_green'][i % 4]) for i in range(5)]
    if v == 'plank': bx += [B(-.3, -.18, WY + .03, WY + .13, 34, 40, 'clay'), B(.1, .3, WY + .03, WY + .13, 34, 37, 'enamel')]
    if v == 'potted': bx += pot('clay', .06, 6, 34)[:1]
    return bx if v != 'potted' else (bx, [TN.at(0, WY + .1, 40, TN.plant('ivy'), 32)])

@piece('shield_mount', (1, 1), 3, 4, ['round', 'kite', 'clan'], 'home', tall=True, shadow=False)
def shield_mount(v):
    if v == 'round': return [B(-.22, .22, WY, WY + .04, 24, 46, 'wood', planksV(4), planksV(4), planksV(4)), B(-.24, .24, WY, WY + .04, 34, 36, 'iron'), B(-.05, .05, WY + .04, WY + .07, 32, 38, 'iron')]
    if v == 'kite': return [B(-.18, .18, WY, WY + .04, 32, 50, 'iron'), B(-.12, .12, WY, WY + .04, 24, 32, 'iron'), B(-.06, .06, WY, WY + .04, 18, 24, 'iron'), B(-.12, .12, WY + .04, WY + .05, 34, 46, 'cloth_red')]
    return [B(-.2, .2, WY, WY + .04, 26, 48, 'paint'), B(-.04, .04, WY + .04, WY + .05, 28, 46, 'paint2'), B(-.16, .16, WY + .04, WY + .05, 38, 42, 'paint2'), B(-.22, .22, WY, WY + .045, 46, 49, 'gold')]

@piece('map_board', (1, 1), 3, 4, ['region', 'battle'], 'home', tall=True, shadow=False)
def map_board(v):
    bx = [B(-.42, .42, WY, WY + .04, 22, 50, 'wood_dark'), B(-.38, .38, WY + .04, WY + .045, 25, 47, 'sand', flat(.3)), B(-.2, .1, WY + .045, WY + .05, 30, 42, 'grass'), B(.12, .34, WY + .045, WY + .05, 27, 34, 'water')]
    pins = [(-.1, 38), (.2, 31), (-.3, 28)] if v == 'region' else [(-.14, 36), (-.08, 33), (.02, 39), (.18, 30), (.26, 41)]
    bx += [B(x - .02, x + .02, WY + .05, WY + .07, z, z + 2, 'cloth_red' if i % 2 else 'cloth_blue') for i, (x, z) in enumerate(pins)]
    if v == 'battle': bx.append(B(-.14, .18, WY + .05, WY + .055, 34, 35, 'ink'))
    return bx

# ------------------------------------------------------------------ rugs (flat, two-tone pattern through tintmask)
PATS = ['plain', 'striped', 'checker', 'diamond', 'floral', 'border', 'tribal', 'braided']
def rug(w, h, v, round_=False):
    t = tx_rug(v); hw, hh = w / 2 - .04, h / 2 - .04
    if round_: return [B(-hw * .72, hw * .72, -hh, hh, 0, 1, 'rugbase', t), B(-hw, hw, -hh * .72, hh * .72, 0, 1, 'rugbase', t), B(-hw * .9, hw * .9, -hh * .9, hh * .9, 0, 1, 'rugbase', t)]
    return [B(-hw, hw, -hh, hh, 0, 1, 'rugbase', t)]
for _k, _fp, _r in (('rug_1x1', (1, 1), 0), ('rug_2x1', (2, 1), 0), ('rug_2x2', (2, 2), 0), ('rug_3x2', (3, 2), 0), ('rug_round', (2, 2), 1), ('rug_runner', (3, 1), 0)):
    piece(_k, _fp, 1, 1, PATS, 'home', flat_=True)((lambda fp, rr: lambda v: rug(fp[0], fp[1], v, bool(rr)))(_fp, _r))
