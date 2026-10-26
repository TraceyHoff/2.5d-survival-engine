# ADR-113 skill icons: 11 skill_branch_* shields + 122 skill_* medallions (32px cells, items_skills atlas).
# Each icon = branch-coloured frame + a glyph (existing item/nature icon painters, or the small custom glyphs below)
# + tier pips (training/_1 .. _4) and a gold rim for master/mastery nodes. Same painter conventions as icons.py.
import math, os, sys, re
from PIL import Image
from draw import C, lt, dk, mix
import icons
from icons import M, hammer
from table import T as IT
import new8
_NAT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../nature/src'))
if _NAT not in sys.path: sys.path.append(_NAT)
import itemicons as _ni
NT = _ni.T
BR = dict(survival='#5f9e4a', combat='#c8443c', crafting='#d9903f', farming='#a8b83a', husbandry='#9a6a44', cooking='#e07a32',
          medicine='#e8e4dc', building='#6f86a8', vehicles='#4f7fa8', stealth='#6a4f8f', leadership='#e9bb46')
BR['perks'] = '#c0508a'  # ADR-132 perks branch (same PERK colour as adr132.py); nodes moved to perks in skills.json
GOLD = '#f2c23a'
# ---------- custom glyphs (32-unit space)
def paw(c, col='#7a4f30'):
    c.ell(16, 20, 6, 5, col, shade=.3)
    for x, y in ((9.5, 13), (13.5, 9.5), (18.5, 9.5), (22.5, 13)): c.ell(x, y, 2.4, 2.8, col, shade=.3)
def heart(c, col='#e2504a'):
    c.poly([(16, 26)] + [(16 + 7.5 * math.sin(a) ** 3 * 1.6 / 1.6, 15.5 - (6.5 * math.cos(a) - 2.5 * math.cos(2 * a) - 1.2 * math.cos(3 * a) - .5 * math.cos(4 * a)) * .85) for a in [i * math.pi / 20 for i in range(1, 40)]], col, shade=.35)
    c.shine(12, 11.5, 1.2, 220)
def flame(c, col='#f08a2c'):
    c.poly([(16, 4), (21, 11), (24, 18), (22, 25), (16, 28), (10, 25), (8, 18), (11, 12), (13, 15)], col, shade=.35)
    c.poly([(16, 13), (19, 18), (19.5, 23), (16, 26), (12.5, 23), (13, 18)], '#f7d24a', owf=.5, shade=.2)
def embers(c):
    c.stroke([(7, 24), (25, 21)], 3, M['dwood']); c.stroke([(8, 20), (24, 25)], 3, M['wood'])
    for x, y, r in ((12, 18, 2), (17, 16, 2.4), (21, 18.5, 1.8)): c.ell(x, y, r, r * .8, '#f07a2c', owf=.5)
    c.dot(17, 15.4, .9, '#ffe27a')
def eye(c):
    c.poly([(4, 16), (10, 10.5), (16, 9), (22, 10.5), (28, 16), (22, 21.5), (16, 23), (10, 21.5)], '#f4f0e6', shade=.2)
    c.ell(16, 16, 4.6, 4.6, '#5c8fe0'); c.dot(16, 16, 2, '#23202a'); c.shine(14.4, 14.4, 1, 230)
def crosshair(c):
    c.ell(16, 16, 10, 10, '#e2504a', shade=.3); c.ell(16, 16, 7, 7, '#f4f0e6', ol=False); c.ell(16, 16, 4, 4, '#e2504a', owf=.6); c.dot(16, 16, 1.4, '#f4f0e6')
    for a, b in (((16, 2.5), (16, 8)), ((16, 24), (16, 29.5)), ((2.5, 16), (8, 16)), ((24, 16), (29.5, 16))): c.stroke([a, b], 1.4, '#3c3f49')
def crown(c, col=GOLD):
    c.poly([(5, 24), (6, 11), (11, 17), (16, 8), (21, 17), (26, 11), (27, 24)], col, shade=.35); c.rect(5, 22, 27, 26, dk(col, .15), r=1)
    for x, cc in ((10.5, '#e2504a'), (16, '#5c8fe0'), (21.5, '#6fbf4e')): c.ell(x, 24, 1.4, 1.3, cc, owf=.5)
    for x, y in ((6, 11), (16, 8), (26, 11)): c.ell(x, y, 1.6, 1.6, lt(col, .3), owf=.6)
def flag(c, col='#e2504a'):
    c.stroke([(9, 28), (9, 4)], 2, M['dwood']); c.poly([(10, 5), (26, 7), (22, 11.5), (26, 16), (10, 15)], col, shade=.35); c.dot(9, 4, 1.6, GOLD)
def gear(c, col='#9aa3b0'):
    pts = []
    for i in range(32):
        a = i * math.pi / 16; r = 11 if (i // 2) % 2 == 0 else 8.4; pts.append((16 + r * math.cos(a), 16 + r * math.sin(a)))
    c.poly(pts, col, shade=.35); c.ell(16, 16, 3.6, 3.6, dk(col, .5), owf=.6); c.shine(11, 10, 1, 210)
def wrench(c, col='#b6bfcc'):
    c.stroke([(8, 25), (19, 14)], 3.6, col)
    c.poly([(17, 12), (19, 6), (22.5, 4), (21.5, 8.5), (24, 11), (28.5, 10), (26.5, 13.5), (20.5, 16)], col, shade=.3)
    c.ell(8, 25, 2.4, 2.4, col, owf=.6)
def wheel(c):
    c.ell(16, 16, 11.5, 11.5, '#3c3f49', shade=.3); c.ell(16, 16, 7, 7, '#9aa3b0', shade=.3)
    for i in range(5):
        a = i * 2 * math.pi / 5 - math.pi / 2; c.line([(16, 16), (16 + 6 * math.cos(a), 16 + 6 * math.sin(a))], 1.2, '#5a6270')
    c.ell(16, 16, 2.2, 2.2, '#c9d3df', owf=.6)
def jerrycan(c, col='#d8403a'):
    c.rect(8, 9, 24, 28, col, r=2, shade=.35); c.rect(9.5, 5, 15.5, 9.5, dk(col, .2), r=1); c.rect(19, 5.5, 22.5, 9, '#9aa3b0', r=.6)
    c.line([(10.5, 12), (21.5, 25)], 1.1, dk(col, .35), 200); c.line([(21.5, 12), (10.5, 25)], 1.1, dk(col, .35), 200)
def shield(c, col='#6f86a8'):
    c.poly([(6, 6), (16, 3.5), (26, 6), (25, 17), (16, 28.5), (7, 17)], col, shade=.35); c.poly([(16, 6), (23.5, 8), (22.8, 16.5), (16, 25.5)], lt(col, .25), ol=False)
    c.stroke([(16, 7), (16, 25)], 1.4, GOLD, owf=.6)
def fist(c, col='#e8b48c'):
    c.rect(8, 11, 24, 25, col, r=4, shade=.3)
    for x in (10.5, 14.5, 18.5): c.line([(x + 1.5, 11.5), (x + 1.5, 16)], .8, dk(col, .4), 200)
    c.rect(6, 15, 12, 21, col, r=2.5, owf=.8); c.rect(10, 24, 22, 29, '#a05e34', r=1)
def book(c, col='#8a3a2e'):
    c.poly([(5, 9), (16, 11), (27, 9), (27, 25), (16, 27), (5, 25)], '#f4ecd6', shade=.2); c.line([(16, 11), (16, 27)], .8, '#9a8a6a')
    for y in (14, 17, 20): c.line([(8, y), (14, y + .6)], .6, '#9a8a6a', 200); c.line([(18, y + .6), (24, y)], .6, '#9a8a6a', 200)
    c.poly([(4, 24.5), (16, 27.5), (28, 24.5), (28, 26.5), (16, 29.5), (4, 26.5)], col, owf=.7)
def moon(c, col='#f2e2a0'):
    c.ell(16, 16, 11, 11, col, shade=.3); c.ell(21, 12.5, 9.5, 9.5, '#2c2440', ol=False)
    c.dot(24, 23, .9, '#ffffff'); c.dot(27, 18, .6, '#ffffff')
def ghost(c, col='#e6ecf4'):
    c.poly([(7, 28), (7, 14)] + [(16 + 9 * math.cos(a), 14 - 9 * math.sin(a)) for a in [i * math.pi / 12 for i in range(13)]] + [(25, 28), (22, 25), (19, 28), (16, 25), (13, 28), (10, 25)], col, shade=.25)
    c.ell(12.5, 14, 1.6, 2.2, '#2c2440', ol=False); c.ell(19.5, 14, 1.6, 2.2, '#2c2440', ol=False)
def mask(c, col='#3c3f49'):
    c.poly([(4, 13), (10, 10), (16, 11.5), (22, 10), (28, 13), (26, 19), (20, 20.5), (16, 18), (12, 20.5), (6, 19)], col, shade=.3)
    c.ell(11, 15.2, 2.6, 1.8, '#f4f0e6', ol=False); c.ell(21, 15.2, 2.6, 1.8, '#f4f0e6', ol=False)
    c.stroke([(28, 13), (30, 18)], 1, col)
def footprint(c, col='#7a6a8a'):
    for dx, dy in ((-4.5, 4), (4.5, -3)):
        c.ell(16 + dx, 18 + dy, 3.4, 5.4, col, shade=.3)
        for i, (tx, ty) in enumerate(((-2.4, -7.2), (-.6, -8.4), (1.4, -8), (3, -6.6))): c.ell(16 + dx + tx, 18 + dy + ty, .9 + (.3 if i == 0 else 0), 1.1, col, owf=.5)
def cow(c):
    c.ell(16, 17, 9, 8.5, '#f4f0e6', shade=.25); c.ell(16, 22.5, 6, 4, '#f0b8b0', owf=.7)
    for d in (-1, 1): c.poly([(16 + d * 7, 10), (16 + d * 12, 6), (16 + d * 10, 11)], '#e8dcc0', owf=.6); c.ell(16 + d * 10.5, 13, 3, 1.8, '#f4f0e6', owf=.6)
    c.ell(12, 13, 3, 2.4, '#3c3f49', ol=False); c.dot(13, 17, 1.1, '#23202a'); c.dot(19, 17, 1.1, '#23202a')
    c.dot(14, 23, .8, '#a06060'); c.dot(18, 23, .8, '#a06060')
def chef_hat(c):
    for x, y, r in ((10, 12, 5), (16, 9, 6), (22, 12, 5)): c.ell(x, y, r, r, '#f8f6f0', shade=.15)
    c.rect(9, 13, 23, 25, '#f8f6f0', r=1, shade=.15); c.line([(9.5, 21), (22.5, 21)], .8, '#c8c4bc')
def cross(c, col='#e2504a'):
    c.poly([(12, 5), (20, 5), (20, 12), (27, 12), (27, 20), (20, 20), (20, 27), (12, 27), (12, 20), (5, 20), (5, 12), (12, 12)], col, shade=.3)
def heartcross(c): heart(c); c.poly([(14.6, 11), (17.4, 11), (17.4, 14.6), (21, 14.6), (21, 17.4), (17.4, 17.4), (17.4, 21), (14.6, 21), (14.6, 17.4), (11, 17.4), (11, 14.6), (14.6, 14.6)], '#f8f6f0', owf=.5)
def scalpel(c):
    c.stroke([(7, 26), (17, 16)], 2.6, '#9aa3b0'); c.poly([(16, 15.5), (26, 5), (24, 11), (18.5, 18)], '#e6ecf4', shade=.3)
def pill(c):
    c.stroke([(9, 23), (23, 9)], 7, '#f4f0e6'); c.stroke([(16, 16), (23, 9)], 7, '#e2504a', ol=False); c.line([(13.5, 13.5), (18.5, 18.5)], .8, '#a03a34')
    c.shine(20, 9.5, 1, 220)
def sprout(c):
    c.ell(16, 26, 9, 3, '#8a5a3a', shade=.2); c.stroke([(16, 26), (16, 13)], 1.6, '#4f9a45')
    c.poly([(16, 15), (9, 13), (6, 7), (13, 8)], '#6fbf4e', shade=.3); c.poly([(16, 12), (22, 7), (27, 8), (24, 13)], '#7fcf5a', shade=.3)
def fence(c):
    for x in (7, 13, 19, 25): c.poly([(x - 2, 28), (x - 2, 9), (x, 6), (x + 2, 9), (x + 2, 28)], M['wood'], owf=.8)
    for y in (13, 21): c.rect(4, y, 28, y + 2.4, M['dwood'], r=.5, owf=.8)
def brick(c):
    for r, y in enumerate((8, 14, 20)):
        for i in range(3): x = 4 + i * 8.5 - (4 if r % 2 else 0); c.rect(max(3, x), y, min(29, x + 8), y + 5.4, '#c0644a', r=.6, owf=.7)
    c.rect(4, 25.5, 28, 28, '#9a9aa3', owf=.7)
def saw(c):
    c.poly([(5, 21), (24, 9), (26, 12.5), (8, 25)], '#c9d3df', shade=.3)
    for i in range(8): x = 8.5 + i * 2.1; y = 24.3 - i * 1.4; c.poly([(x, y), (x + 1.2, y + 1.6), (x + 2, y - 1.2)], '#9aa3b0', ol=False)
    c.rect(22, 5, 29, 13, M['wood'], r=2, owf=.8)
def ruler(c):
    c.poly([(5, 27), (5, 5), (10, 5), (10, 22), (27, 22), (27, 27)], '#e9bb46', shade=.3)
    for i in range(4): c.line([(5, 8 + i * 3.6), (7.5, 8 + i * 3.6)], .6, '#7a5a20'); c.line([(13 + i * 3.6, 27), (13 + i * 3.6, 24.5)], .6, '#7a5a20')
def palisade(c):
    for x in (6, 11, 16, 21, 26): c.poly([(x - 2.4, 28), (x - 2.4, 10), (x, 4), (x + 2.4, 10), (x + 2.4, 28)], '#9a6a44', shade=.35, owf=.8)
    c.rect(3, 18, 29, 20.5, '#5a6270', owf=.7)
def chair(c):
    c.rect(9, 4, 22, 17, '#c08050', r=1.5, shade=.3); c.rect(8, 16, 24, 20, '#e0a060', r=1, owf=.8)
    for x in (9.5, 22.5): c.stroke([(x, 20), (x, 28)], 1.8, M['dwood'], owf=.7)
    c.rect(11, 6.5, 20, 14, '#e2504a', r=1, owf=.5)
def hearth(c): brick(c); c.rect(11, 14, 21, 25.5, '#2c2028', r=1, owf=.6); flame_small(c)
def flame_small(c): c.poly([(16, 15), (19, 20), (18.5, 24.5), (16, 25.5), (13.5, 24.5), (13, 20)], '#f08a2c', owf=.5)
def house(c):
    c.rect(7, 15, 25, 28, '#e0c89a', shade=.25); c.poly([(4, 16), (16, 5), (28, 16)], '#c0644a', shade=.35)
    c.rect(13.5, 20, 18.5, 28, M['dwood'], owf=.7); c.rect(19.5, 18, 23, 21.5, '#9fd0f0', owf=.6)
def horn(c):
    c.poly([(5, 13), (20, 8), (27, 4), (28, 16), (20, 14), (5, 17)], '#e8dcc0', shade=.3); c.ell(27.5, 10, 2, 6, '#c8b490', owf=.7)
    c.stroke([(9, 15), (13, 24), (22, 21), (23, 13)], .9, '#a05e34', ol=False)
def sprig(c):
    c.stroke([(7, 26), (24, 7)], 1.3, '#6b5a34')
    for i in range(5):
        t = .15 + i * .17; x, y = 7 + 17 * t, 26 - 19 * t
        for d in (-1, 1): c.ell(x + d * 2.6, y + d * 1.4 - 1, 2.6, 1.3, '#8fae4a', owf=.5)
    c.ell(22, 12, 1.6, 1.4, '#4a5a2a', owf=.5)
def mapg(c):
    c.poly([(4, 8), (11, 5), (18, 8), (28, 5), (28, 24), (18, 27), (11, 24), (4, 27)], '#efe0b4', shade=.2)
    c.line([(11, 5), (11, 24)], .6, '#b09a6a'); c.line([(18, 8), (18, 27)], .6, '#b09a6a')
    c.line([(7, 20), (12, 16), (16, 19), (22, 12)], .8, '#c0644a', 230); c.stroke([(22, 9.5), (25, 12.5)], .8, '#e2504a', ol=False); c.stroke([(25, 9.5), (22, 12.5)], .8, '#e2504a', ol=False)
def compass(c):
    c.ell(16, 16, 11, 11, '#e9bb46', shade=.3); c.ell(16, 16, 8.6, 8.6, '#f4f0e6', ol=False)
    c.poly([(16, 8), (18, 16), (16, 24), (14, 16)], '#3c3f49', owf=.5); c.poly([(16, 8), (18, 16), (14, 16)], '#e2504a', ol=False)
def anvil(c):
    c.poly([(4, 10), (24, 10), (28, 13), (22, 15), (20, 19), (23, 24), (9, 24), (12, 19), (10, 15), (6, 14)], '#5a6270', shade=.35)
    c.rect(7, 24, 25, 27.5, '#3c3f49', owf=.7); c.shine(10, 11.5, .9, 200)
def hammer_g(c): hammer(c, M['iron'])
def pawheart(c): paw(c); c.ell(16, 20, 3, 2.4, '#e2504a', owf=.5)
G = dict(paw=paw, heart=heart, flame=flame, embers=embers, eye=eye, crosshair=crosshair, crown=crown, flag=flag, gear=gear, wrench=wrench,
         wheel=wheel, jerrycan=jerrycan, shield=shield, fist=fist, book=book, moon=moon, ghost=ghost, mask=mask, footprint=footprint, cow=cow,
         chef_hat=chef_hat, cross=cross, heartcross=heartcross, scalpel=scalpel, pill=pill, sprout=sprout, fence=fence, brick=brick, saw=saw,
         ruler=ruler, palisade=palisade, chair=chair, hearth=hearth, house=house, horn=horn, sprig=sprig, map=mapg, compass=compass, anvil=anvil,
         hammer=hammer_g, pawheart=pawheart)
# glyph spec: custom glyph name, or 'T:<items icon>' / 'N:<nature icon>'
BRANCH_G = dict(survival='flame', combat='T:steel_sword', crafting='hammer', farming='N:wheat', husbandry='paw', cooking='T:stew_bowl',
                medicine='cross', building='house', vehicles='wheel', stealth='moon', leadership='crown')
SKILL_G = {
 'forager': 'N:blueberry', 'pack_mule': 'T:leather_backpack', 'firekeeper': 'flame', 'iron_stomach': 'T:rot', 'scavenger': 'T:salvaged_parts',
 'beast_of_burden': 'T:frame_pack', 'ember_saver': 'embers', 'hardy': 'heart', 'lumberjack': 'T:steel_axe', 'wilderness_master': 'compass',
 'brawler': 'fist', 'battle_hardened': 'shield', 'blade': 'T:steel_sword', 'blunt': 'T:iron_mace', 'axe': 'T:alloy_axe', 'spear': 'T:iron_spear',
 'bow': 'T:recurve_bow', 'crossbow': 'T:crossbow', 'firearm': 'T:revolver', 'berserker': 'T:nail_bat', 'deadeye': 'crosshair',
 'tinkerer': 'gear', 'smithing': 'anvil', 'armorsmithing': 'T:iron_helmet', 'tailoring': 'T:thread', 'chemistry': 'T:glass_bottle',
 'demolitions': 'T:black_powder_bomb', 'bowyery': 'T:bowstring', 'gunsmithing': 'T:mechanism',
 'green_thumb': 'sprout', 'composter': 'N:fertilizer', 'seed_saver': 'N:wheat_seeds', 'irrigator': 'N:watering_can', 'orchardist': 'N:apple_sapling',
 'herbalist': 'N:yarrow', 'master_farmer': 'N:hoe', 'monoculture': 'N:wheat',
 'husbandry': 'paw', 'husbandry_pens': 'fence', 'husbandry_gentle': 'N:wool', 'husbandry_dairy': 'N:milk', 'husbandry_breeding': 'T:egg',
 'husbandry_whisperer': 'pawheart', 'husbandry_rancher': 'cow', 'husbandry_butcher': 'N:raw_prime_cut',
 'camp_cook': 'T:stew_bowl', 'seasoning': 'T:salt', 'preserver': 'T:canned_fish', 'baker': 'T:bread', 'brewer': 'N:willow_tea',
 'butcher_block': 'T:jerky', 'gourmet': 'T:meat_pie', 'glutton': 'T:honey_cake', 'master_chef': 'chef_hat',
 'first_aid': 'T:herbal_poultice', 'field_medic': 'T:medkit', 'apothecary': 'N:aloe', 'triage': 'cross', 'antiseptics': 'T:antiseptic',
 'surgeon': 'scalpel', 'pharmacologist': 'pill', 'doctor': 'heartcross',
 'carpenter': 'saw', 'mason': 'brick', 'joiner': 'hammer', 'architect': 'ruler', 'fortifier': 'palisade', 'interior_designer': 'chair',
 'hearth_builder': 'hearth', 'master_builder': 'house',
 'grease_monkey': 'wrench', 'mechanic': 'wrench', 'hauler': 'wheel', 'fuel_economist': 'jerrycan', 'road_warrior': 'wheel', 'salvager': 'T:scrap_metal',
 'light_step': 'footprint', 'shadow': 'moon', 'backstabber': 'T:steel_dagger', 'silent_hunter': 'T:longbow', 'assassin': 'T:bone_dagger',
 'ghost': 'ghost', 'phantom': 'mask', 'light_pack': 'T:reed_satchel',
 'rally': 'horn', 'mentor': 'book', 'quartermaster': 'T:tactical_pack', 'diplomat': 'sprig', 'warlord': 'T:alloy_sword', 'commander': 'flag',
 'chieftain': 'crown', 'tactician': 'map'}
TIER = {'training': 1, 'expert': 2, 'mastery': 3}
def parse(node):
    """skill node key (without skill_) -> (glyph spec, pips, gold)"""
    m = re.match(r'^(.*)_(training|expert|mastery)$', node)
    if m: return SKILL_G[m.group(1)], TIER[m.group(2)], m.group(2) == 'mastery'
    m = re.match(r'^(.*)_(\d)$', node)
    if m: return SKILL_G[m.group(1)], int(m.group(2)), False
    gold = node.startswith('master_') or node.endswith('_master') or node in ('chieftain', 'phantom', 'doctor')
    return SKILL_G[node], 0, gold
def glyph_img(spec, px):
    icons.NOSHADOW[0] = True
    c = C(32, 8)
    if spec.startswith('T:'): k = spec[2:]; (IT.get(k) or new8.NEW8[k])(c)
    elif spec.startswith('N:'): NT[spec[2:]](c)
    else: G[spec](c)
    icons.NOSHADOW[0] = False
    return c.out(px)
def frame(c, col, branch, gold):
    rim = GOLD if gold else col
    if branch:  # heraldic shield
        c.poly([(3, 3), (29, 3), (29, 16), (16, 30), (3, 16)], rim, shade=.35)
        c.poly([(5.5, 5.5), (26.5, 5.5), (26.5, 15.2), (16, 26.6), (5.5, 15.2)], dk(col, .55), ol=False, shade=.3)
    else:
        c.ell(16, 16, 14, 14, rim, shade=.35); c.ell(16, 16, 11.4, 11.4, dk(col, .55), ol=False, shade=.3)
        c.shine(9, 8, 1.1, 200)
def pips(c, n, col):
    if not n: return
    w = 3.4; x0 = 16 - (n - 1) * w / 2
    for i in range(n): c.ell(x0 + i * w, 28.2, 1.5, 1.5, lt(col, .35) if n < 3 else GOLD, owf=.6)
def render(key):
    """-> (@2x 64px, 1x 32px) RGBA for skill_branch_<b> / skill_<node>"""
    if key.startswith('skill_branch_'):
        b = key[13:]; spec, n, gold, branch, col = BRANCH_G[b], 0, False, True, BR[b]
    else:
        node = key[6:]; spec, n, gold = parse(node); branch = False; col = BR[BRANCH_OF[node]]
    out = []
    for px in (64, 32):
        c = C(32, 8); frame(c, col, branch, gold); pips(c, n, col)
        base = c.out(px); g = glyph_img(spec, int(round(px * (.62 if branch else .66))))
        off = ((px - g.size[0]) // 2, int(round((px - g.size[1]) / 2 - (px * .05 if branch else px * .02))))
        base.alpha_composite(g, off)
        if n:  # pips on top of the glyph
            c2 = C(32, 8); pips(c2, n, col); base.alpha_composite(c2.out(px))
        out.append(base)
    return tuple(out)
import json as _json
_SK = _json.load(open(os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../gameplay/data/skills.json'))))
BRANCHES = [b['icon'] for b in _SK['branches']]
NODES = [n['icon'] for n in _SK['nodes']]
BRANCH_OF = {n['key']: n['branch'] for n in _SK['nodes']}
KEYS = BRANCHES + NODES
