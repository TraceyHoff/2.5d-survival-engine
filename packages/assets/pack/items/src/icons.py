# Item icon recipes (32-unit space, art kept inside 2..30 for a 2px gutter). Weapons/tools are drawn diagonally, grip bottom-left.
import math
from draw import C, lt, dk, mix
M = dict(wood='#b5743d', dwood='#7d4a2b', bronze='#d9903f', iron='#8d97a6', steel='#c9d3df', alloy='#dcf1fb', bone='#f0e6cc',
         comp='#40444f', leather='#a05e34', flint='#707684', brass='#e9bb46', lead='#7f8794', black='#3c3f49', olive='#73803d', stone='#9a9aa3',
         red='#e2504a', cloth='#e9dfc4', reed='#c9b265', fur='#b98a5c', wax='#e8c44f', yellow='#f2c84b', green='#6fbf4e', blue='#5c8fe0')
NOSHADOW = [False]
def sh(c, w=10):
    if not NOSHADOW[0]: c.shadow(16, 28.2, w, 2.2)
# ---------- generic shapes
def handle_diag(c, a, b, w, col): c.stroke([a, b], w, col)
def blade(c, base, tip, w, col, edge=True):
    bx, by = base; tx, ty = tip; dx, dy = tx-bx, ty-by; L = math.hypot(dx, dy); nx, ny = -dy/L*w/2, dx/L*w/2
    c.poly([(bx+nx, by+ny), (bx+dx*0.75+nx*1.05, by+dy*0.75+ny*1.05), (tx, ty), (bx+dx*0.75-nx*0.7, by+dy*0.75-ny*0.7), (bx-nx, by-ny)], col, shade=0.38)
    if edge: c.line([(bx+nx*0.4, by+ny*0.4), (tx-dx*0.08, ty-dy*0.08)], 0.5, lt(col, 0.6), 170)
def gloss(c, col, x, y):
    if col in (M['steel'], M['alloy'], M['iron'], M['bronze'], M['brass']): c.shine(x, y, 0.8)
def axe(c, m, haft=M['wood'], big=False):
    sh(c); handle_diag(c, (8, 26), (22, 8), 2.6, haft)
    s = 1.25 if big else 1
    c.poly([(18, 7), (22, 3), (28*s-4*(s-1)*7, 9), (27, 15*s), (22, 14)], m, shade=0.4); c.line([(23, 4), (28, 10), (27, 14)], 0.6, lt(m, .7), 200)
    c.rect(19, 9.5, 23, 13, dk(haft, .2), r=1); gloss(c, m, 25, 8)
def pickaxe(c, m, haft=M['wood']):
    sh(c); handle_diag(c, (7, 27), (21, 9), 2.6, haft)
    c.poly([(8, 8), (14, 4.5), (22, 4.5), (28, 9), (29, 15), (25, 10), (20, 8.5), (14, 8.8), (9, 11)], m, shade=0.4); c.rect(19, 6, 23.5, 11, dk(haft, .2), r=1); gloss(c, m, 16, 6)
def shovel(c, m, haft=M['wood']):
    sh(c); handle_diag(c, (5, 27), (18, 12), 2.2, haft); c.stroke([(4, 28.5), (7.5, 25)], 3, dk(haft, .2))
    c.poly([(17, 11), (22, 4), (28, 4), (28.5, 10), (22, 15.5)], m, shade=0.4); c.line([(18.5, 11), (25, 6)], 0.6, dk(m, .3), 160); gloss(c, m, 25, 6)
def knife(c, m, grip=M['leather'], long=1.0, guard=True, shape='knife'):
    sh(c, 8); handle_diag(c, (7, 26), (12.5, 20.5), 3, grip)
    for i in range(3): c.line([(8+i*1.6, 23.5+0.2-i*1.6+1.5), (9.5+i*1.6, 25-i*1.6+1.5)], 0.4, dk(grip, .4), 160)
    if guard: c.stroke([(10.5, 18), (15.5, 23)], 1.6, dk(m, .1) if m != M['bone'] else M['dwood'])
    tip = (13+14*long, 21-14*long)
    if shape == 'knife': c.poly([(12.5, 19.5), (tip[0]-3, tip[1]+1), tip, (15, 22.5)], m, shade=0.38)
    elif shape == 'leaf': c.poly([(12.5, 20), (16, 15), (tip[0]-2.5, tip[1]+1.5), tip, (tip[0]-1, tip[1]+2.6), (18, 18.5), (14.5, 22)], m, shade=0.38)
    elif shape == 'stiletto': blade(c, (13.5, 20.5), tip, 2.4, m)
    else: blade(c, (13.5, 20.5), tip, 3.6, m)
    c.line([(13.6, 20.2), (tip[0]-1.5, tip[1]+1.2)], 0.5, lt(m, .7), 180); gloss(c, m, tip[0]-3, tip[1]+3)
def mace(c, m, spikes=False, flange=True, haft=M['wood']):
    sh(c); handle_diag(c, (7, 27), (19, 13), 2.4, haft); c.stroke([(6.5, 27.5), (9, 25)], 3, M['leather'])
    if spikes:
        for a in range(0, 360, 45):
            r = math.radians(a); c.poly([(21+math.cos(r)*3, 10+math.sin(r)*3), (21+math.cos(r+.3)*6.5, 10+math.sin(r+.3)*6.5), (21+math.cos(r+.6)*3, 10+math.sin(r+.6)*3)], dk(m, .1))
    c.ell(21, 10, 4.8, 4.8, m, shade=0.4)
    if flange:
        for a in range(0, 360, 60):
            r = math.radians(a); c.line([(21+math.cos(r)*1.5, 10+math.sin(r)*1.5), (21+math.cos(r)*5.2, 10+math.sin(r)*5.2)], 0.9, dk(m, .35))
    c.shine(19.5, 8.3, 1)
def hammer(c, m, haft=M['dwood'], spike=True, size=1.0, longh=False):
    sh(c); a = (5, 28) if longh else (8, 26); handle_diag(c, a, (20, 10), 2.4, haft)
    cx, cy = 21, 9; hw, hh = 4.5*size, 2.8*size
    pts = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]; ang = math.radians(45)
    P = [(cx+x*math.cos(ang)-y*math.sin(ang), cy+x*math.sin(ang)+y*math.cos(ang)) for x, y in pts]
    if spike: c.poly([P[0], (cx-hw*1.9*math.cos(ang), cy-hw*1.9*math.sin(ang)), P[3]], dk(m, .1))
    c.poly(P, m, shade=0.4); c.line([P[0], P[1]], 0.6, lt(m, .7), 190)
def sword(c, m, hilt=M['dwood'], guard=M['brass'], long=1.0, wide=3.2):
    sh(c); c.stroke([(5, 27), (9, 23)], 2.4, hilt); c.ell(4.8, 27.2, 1.6, 1.6, guard)
    c.stroke([(6.8, 20), (12, 25.2)], 1.8, guard); blade(c, (9.5, 22.5), (9.5+18*long, 22.5-18*long), wide, m)
    gloss(c, m, 16, 15)
def machete(c, m, grip=M['dwood']):
    sh(c); c.stroke([(5, 27), (10, 22)], 3, grip)
    c.poly([(9, 21), (24, 5.5), (28, 5), (27.5, 8.5), (12.5, 24)], m, shade=0.4); c.line([(11, 22), (26, 7)], 0.5, lt(m, .7), 180); c.dot(7, 25, .6, M['steel'])
def spear(c, m, haft=M['wood'], tip='leaf'):
    sh(c); handle_diag(c, (4, 29), (21, 12), 2, haft); c.stroke([(18.5, 13.5), (21, 16)], 2, M['leather'])
    c.poly([(20, 12), (24, 5), (29, 3), (27, 8), (20.5, 13.5)] if tip == 'leaf' else [(19.5, 11.5), (29, 3), (21, 13.5)], m, shade=0.4); gloss(c, m, 25, 6)
def throwaxe(c, m, haft=M['wood']):
    sh(c, 8); handle_diag(c, (8, 26), (20, 11), 2.2, haft)
    c.poly([(18, 10), (21, 6.5), (26, 9), (27, 15.5), (24, 15), (21.5, 12.5)], m, shade=0.4); c.line([(25.5, 9.5), (26.5, 15)], 0.6, lt(m, .7), 200); c.ell(8.3, 25.7, 1.5, 1.5, haft)
def bat(c):
    sh(c); c.poly([(5, 28), (7, 26.5), (25, 7), (27.5, 5.5), (28.5, 8.5), (8.5, 28)], M['wood'], shade=0.35); c.stroke([(5.5, 27.5), (9, 24.5)], 3, M['leather'])
    for i in range(6):
        x, y = 15+i*2.2, 18-i*2.2; c.stroke([(x-1.5, y-1.5), (x+1.5, y+1.5)], 0.7, M['iron'], owf=.5)
def maul(c, head, haft, lashed=True, longh=False):
    sh(c); handle_diag(c, (5, 28) if longh else (8, 26), (19, 12), 3 if not longh else 2.4, haft)
    if lashed: c.ell(21.5, 9, 6, 4.8, head, shade=0.4); c.stroke([(16.5, 6), (25, 14)], 1.4, M['reed'])
    else: hammer(c, head, haft, False, 1.15, longh)
# ---------- ranged
def bow(c, m=M['wood'], tips=None, recurve=False, scale=1.0, back=None):
    sh(c)
    pts = [(5, 27), (9, 17), (15, 10), (21, 6), (27, 4)] if not recurve else [(4, 24), (6, 22), (9, 16), (15, 10), (22, 7), (28, 6.5)]
    pts2 = [(6.5, 27.5), (13, 22.5), (18, 18), (22.5, 14.5), (26, 9.5)] if not recurve else [(5.5, 25.5), (14, 22), (19, 19), (24, 15), (26.5, 9)]
    c.line([pts[0], (27.5, 27)][:1] + [(26, 26)] if False else [pts[0], pts[-1]], 0.5, '#f4ecd8', 230)
    c.stroke(pts[:1]+[(9.5, 20), (17, 18)]+[(21, 11), pts[-1]] if False else [pts[0], (7, 14), (13, 8), pts[-1]] if not recurve else [pts[0], (5, 14), (13, 6), pts[-1]], 2*scale, m, shade=.35)
    if back: c.line([(7, 22), (8, 14), (13.5, 8.5), (22, 5)], 0.7, back, 230)
    c.rect(5, 13.5, 9, 17.5, M['leather'], r=1)
    if tips: c.ell(pts[0][0], pts[0][1], 1.4, 1.4, tips); c.ell(pts[-1][0], pts[-1][1], 1.4, 1.4, tips)
def compound(c):
    sh(c); c.line([(7, 26), (26, 6)], 0.5, '#f4ecd8', 230); c.line([(8, 25), (25, 7)], 0.4, '#d8d0c0', 200)
    c.stroke([(6, 26), (7, 15), (13, 9), (26, 7)], 2.2, M['black']); c.rect(6, 13, 11, 18, M['comp'], r=1.2)
    c.ell(6, 26, 1.8, 1.8, M['steel']); c.ell(26, 7, 1.8, 1.8, M['steel']); c.stroke([(9, 15), (14, 20)], 1, M['steel'])
def crossbow(c, stock=M['wood'], limb=M['bronze'], stirrup=False, crank=False):
    sh(c); c.poly([(5, 27), (8, 28), (24, 12), (21, 9)], stock, shade=.3); c.rect(5.5, 24, 9.5, 28.5, dk(stock, .2), r=1)
    c.stroke([(13, 8), (17, 13), (22, 22)], 2, limb, shade=.4); c.line([(13, 8), (18, 16), (22, 22)], 0.4, '#f4ecd8', 230)
    c.stroke([(20, 13.5), (27, 6.5)], 1, M['dwood']); c.poly([(26.5, 5.5), (28.5, 4.5), (27.5, 7)], M['steel'])
    if stirrup: c.stroke([(23, 10), (26, 11), (25, 14), (22.5, 13)], 0.9, M['iron'])
    if crank: c.ell(8, 24, 2, 2, M['steel']); c.stroke([(8, 24), (4, 22)], 1, M['steel'])
def gun(c, kind, body=M['wood'], metal=M['iron']):
    sh(c, 12)
    def rot(pts, cx=16, cy=16, a=-38):
        r = math.radians(a); return [(cx+(x-cx)*math.cos(r)-(y-cy)*math.sin(r), cy+(x-cx)*math.sin(r)+(y-cy)*math.cos(r)) for x, y in pts]
    if kind in ('flintlock', 'revolver', 'semi'):
        if kind == 'flintlock':
            c.poly(rot([(7, 20), (11, 14), (14, 14), (14, 17), (11, 22)]), body); c.rect(0, 0, 0, 0, body) if False else None
            c.poly(rot([(10, 13.5), (28, 13.5), (28, 16), (10, 16)]), metal); c.poly(rot([(11, 11), (13, 10), (14, 13.5), (12, 13.5)]), M['brass']); c.ell(*rot([(8, 21)])[0], 1.5, 1.5, M['brass'])
        elif kind == 'revolver':
            c.poly(rot([(7, 21.5), (10, 15), (13, 15), (13, 18), (10, 23)]), M['dwood']); c.poly(rot([(11, 12), (27, 12), (27, 14.5), (11, 15)]), metal)
            c.ell(*rot([(15, 14.5)])[0], 3, 2.4, dk(metal, .1)); [c.dot(*rot([(13.6+i*1.4, 14.5)])[0], .45, dk(metal, .5)) for i in range(3)]; c.stroke(rot([(14, 17), (15.5, 18.5)]), .8, metal)
        else:
            c.poly(rot([(8, 22), (10, 15), (14, 15), (13, 22)]), M['comp']); c.poly(rot([(9, 11.5), (27, 11.5), (27, 15.5), (9, 15.5)]), M['black'])
            for i in range(5): c.line(rot([(11+i, 12), (11+i, 15)]), .3, '#6a6f7c', 200)
        c.shine(*rot([(20, 12.5)])[0], .6, 180); return
    long = {'pipe': 1, 'pump': 1, 'hunting': 1, 'marks': 1, 'auto': 1, 'musket': 1.1, 'brifle': 1, 'carbine': .85}[kind]
    L = 3 + 26*long
    c.poly(rot([(2, 19), (3, 15.5), (11, 15), (12, 17), (8, 18), (4, 21)]), body, shade=.3)
    c.poly(rot([(10, 14), (L-1, 14), (L-1, 16), (10, 17)]), metal, shade=.35)
    if kind == 'pipe': c.rect(0, 0, 0, 0, metal) if False else c.poly(rot([(10, 13), (L, 13), (L, 16.5), (10, 16.5)]), M['iron']); [c.stroke(rot([(12+i*5, 12.5), (12+i*5, 17)]), .9, M['reed']) for i in range(3)]
    if kind == 'pump': c.poly(rot([(14, 16), (22, 16), (22, 18.5), (14, 18.5)]), M['black'])
    if kind in ('hunting', 'musket', 'brifle'): c.poly(rot([(10, 15.5), (L-5, 15.5), (L-5, 17.5), (11, 18)]), body, shade=.3)
    if kind in ('hunting', 'brifle'): c.stroke(rot([(12, 13), (13.5, 11.5)]), .8, M['steel'])
    if kind == 'musket': c.poly(rot([(10, 12.5), (12, 11.5), (13, 14), (11, 14)]), M['brass'])
    if kind == 'marks': c.rect(0, 0, 0, 0, M['black']) if False else c.poly(rot([(11, 11), (19, 11), (19, 13.4), (11, 13.4)]), M['comp']); c.ell(*rot([(19, 12.2)])[0], .8, .8, '#7fd0ff', ol=False)
    if kind in ('auto', 'carbine'): c.poly(rot([(13, 16.5), (16, 16.5), (17, 21), (14.5, 21)]), M['comp'])
    if kind in ('auto', 'marks', 'carbine'): c.poly(rot([(8, 15), (10, 16.5), (9, 19.5), (7.5, 19)]), M['comp'])
    if kind in ('musket', 'brifle', 'carbine'):
        tl = {'musket': 6, 'brifle': 6.5, 'carbine': 5}[kind]; c.poly(rot([(L-1.5, 13.6), (L+tl, 14.2), (L-1.5, 15)]), M['steel'], shade=.4)
    c.shine(*rot([(20, 14.3)])[0], .6, 170)
def sling(c):
    sh(c, 8); c.stroke([(5, 6), (11, 14), (14, 19)], .9, M['reed']); c.stroke([(27, 6), (21, 14), (18, 19)], .9, M['reed'])
    c.ell(16, 21, 4.5, 3.2, M['leather']); c.ell(16, 20, 2, 1.4, M['stone']); c.ell(5, 6, 1.4, 1.4, M['reed']); c.ell(27, 6, 1.4, 1.4, M['reed'])
# ---------- ammo
def arrow(c, head, fl='#d9d2c2', fire=False, n=2, bolt=False):
    for k in range(n):
        o = k*4.2-2.1*(n-1); L = 0.55 if bolt else 1
        a, b = (5+o, 27-o*0.0+o), (5+o+20*L, 27+o-20*L)
        c.stroke([a, b], 1.2 if not bolt else 1.6, M['wood'] if not bolt else M['dwood'])
        c.poly([(a[0]-1, a[1]-3.2), (a[0]+3, a[1]-4.2), (a[0]+1.2, a[1]-1)], fl); c.poly([(a[0]+3.2, a[1]+1), (a[0]+4.2, a[1]-3), (a[0]+1, a[1]-1.2)], fl)
        hx_, hy = b; c.poly([(hx_-1.6, hy-0.6), (hx_+3.2, hy-3.2), (hx_+0.6, hy+1.6)], head, shade=.4)
        if fire: c.ell(b[0]-3, b[1]+3, 2.2, 2.2, '#c99a6b'); c.poly([(b[0]-4.5, b[1]+2), (b[0]-2, b[1]-4), (b[0]-0.5, b[1]+1.5)], '#ff9a2e'); c.dot(b[0]-2.4, b[1]+0.8, .7, '#ffe36b')
    sh(c, 9)
def cartridge(c, case=M['brass'], tip=M['lead'], n=3, long=1.0, paper=False):
    sh(c, 10)
    for i in range(n):
        x = 9+i*6 if n == 3 else 12+i*8; top = 9 if long > 1 else 13
        if paper: c.rect(x-2.5, 12, x+2.5, 26, '#e8dcb8', r=1.2); c.ell(x, 11.5, 2.4, 2.4, M['lead']); c.line([(x-2.4, 17), (x+2.4, 17)], .5, '#b9a67a'); continue
        c.rect(x-2.2, top+4, x+2.2, 26, case, r=.6); c.poly([(x-2, top+4.2), (x-1.2, top+0.8), (x, top-1.2 if long > 1 else top), (x+1.2, top+0.8), (x+2, top+4.2)], tip)
        c.line([(x-2.2, 24.5), (x+2.2, 24.5)], .5, dk(case, .4)); c.shine(x-1, top+7, .6, 160)
def shell(c, band='#e04a3c', slug=False, n=2, inc=False):
    sh(c, 10)
    for i in range(n):
        x = 11+i*10; c.rect(x-3.4, 9, x+3.4, 22, band if not inc else '#e8752f', r=1); c.rect(x-3.6, 21, x+3.6, 26, M['brass'], r=.6)
        if inc: c.rect(x-3.4, 13, x+3.4, 15.5, M['yellow'], ol=False)
        if slug: c.ell(x, 9, 3, 1.8, M['lead'])
        c.line([(x-2, 10.5), (x-2, 20)], .6, (255, 255, 255), 90)
def stones(c):
    sh(c, 11)
    for x, y, r in ((11, 21, 4.3), (20, 22, 4), (16, 14.5, 4.2)): c.ell(x, y, r, r*.85, M['stone'], shade=.4); c.shine(x-1.5, y-1.5, .8, 150)
# ---------- materials / resources
def ore(c, rock, fleck, cubic=False, sheen=None):
    sh(c, 11); c.poly([(5, 21), (8, 12), (15, 7), (23, 9), (27, 16), (26, 24), (15, 27), (7, 26)], rock, shade=.4)
    if cubic:
        for x, y in ((11, 14), (18, 12), (16, 20), (22, 18)): c.poly([(x, y), (x+3.5, y-1), (x+4.5, y+2.5), (x+1, y+3.5)], fleck, shade=.5)
    else:
        for x, y in ((11, 14), (19, 12), (15, 20), (22, 19), (9, 21)): c.ell(x, y, 1.6, 1.3, fleck, owf=.6)
    if sheen: c.line([(10, 11), (17, 9)], .9, sheen, 200)
def crystals(c, col, base=None):
    sh(c, 11)
    if base: c.ell(16, 24, 11, 4.5, base)
    for x, h, w, a in ((11, 12, 3.5, -12), (16, 17, 4.5, 0), (21, 12, 3.5, 14), (13.5, 8, 2.6, -25), (19.5, 9, 2.8, 25)):
        r = math.radians(a); top = (x+math.sin(r)*h, 25-math.cos(r)*h)
        c.poly([(x-w/2, 25), (x-w/2+math.sin(r)*h*0.8, 25-math.cos(r)*h*0.8), top, (x+w/2+math.sin(r)*h*0.8, 25-math.cos(r)*h*0.8), (x+w/2, 25)], col, shade=.45)
        c.line([(x-w/4, 24), top], .4, lt(col, .8), 170)
def pile(c, col, grains=None):
    sh(c, 12); c.poly([(4, 26), (9, 17), (14, 12), (18, 12), (23, 17), (28, 26)], col, shade=.35)
    for x, y in ((10, 22), (15, 17), (20, 21), (17, 24), (13, 24.5), (23, 24)): c.dot(x, y, .7, grains or dk(col, .25), 200)
def stalks(c, col, top=None, n=7, tie=M['reed'], fluffy=None):
    sh(c, 10)
    for i in range(n):
        x0 = 13+i*1.0; x1 = 6+i*3.3
        c.stroke([(x0, 28), (x0+0.2, 18), (x1, 5+abs(i-n/2)*1.1)], 1.1, col, owf=.6)
        if top: c.ell(x1, 5+abs(i-n/2)*1.1, 1.6, 1.6, top, owf=.6); c.dot(x1, 5+abs(i-n/2)*1.1, .5, '#fff6c8')
        if fluffy: c.ell(x1, 5+abs(i-n/2)*1.1, 2.6, 2.3, fluffy, owf=.6)
    c.rect(12, 18, 20.5, 21, tie, r=1)
def bolls(c):
    sh(c, 11); c.stroke([(16, 28), (16, 18)], 1.2, M['dwood'])
    for x, y in ((10, 13), (21, 12), (16, 19), (15.5, 8)):
        c.poly([(x-4, y+2), (x-2, y+4), (x+2, y+4), (x+4, y+2)], '#8b5a35'); c.ell(x-1.6, y, 2.6, 2.4, '#fbfaf3'); c.ell(x+1.6, y, 2.6, 2.4, '#fbfaf3'); c.ell(x, y-1.6, 2.6, 2.4, '#ffffff')
def block(c, col, top=None, iso=True, mark=None):
    sh(c, 12); top = top or lt(col, .3)
    c.poly([(5, 13), (16, 8), (27, 13), (27, 21), (16, 27), (5, 21)], col, shade=.3); c.poly([(5, 13), (16, 8), (27, 13), (16, 18)], top, shade=.15, ol=False)
    c.line([(16, 18), (16, 26.5)], .5, dk(col, .35), 160); c.line([(5, 13), (16, 18), (27, 13)], .5, dk(col, .35), 160)
    if mark == 'hex':
        for x, y in ((12, 13), (16, 11.5), (20, 13), (16, 14.5)): c.line([(x-1.5, y), (x, y-.8), (x+1.5, y), (x, y+.8), (x-1.5, y)], .4, dk(col, .3), 200)
def ingot(c, col):
    sh(c, 12); c.poly([(4, 23), (9, 14), (23, 14), (28, 23)], dk(col, .1), shade=.35); c.poly([(9, 14), (11, 11), (21, 11), (23, 14)], lt(col, .35), shade=.1)
    c.line([(11, 13), (19, 13)], .7, (255, 255, 255), 150); c.shine(22, 18, .7, 140)
def plate(c, col, rivets=None, curved=False):
    sh(c, 12); c.poly([(4, 16), (16, 9), (28, 16), (16, 23)], col, shade=.4); c.poly([(4, 16), (16, 23), (28, 16), (28, 18.5), (16, 25.5), (4, 18.5)], dk(col, .25), shade=.1)
    if rivets: [c.dot(x, y, .7, rivets) for x, y in ((9, 16), (16, 12), (23, 16), (16, 20))]
    c.line([(10, 14), (16, 11)], .7, (255, 255, 255), 150)
def cloth(c, col, pattern=None, glossy=False, quilt=False):
    sh(c, 12); c.poly([(5, 15), (16, 10), (27, 15), (16, 20)], lt(col, .1), shade=.2)
    for k in range(3):
        y = 15+k*2.6; c.poly([(5, y), (16, y+5), (27, y), (27, y+2.4), (16, y+7.4), (5, y+2.4)], mix(col, '#000000', 0.06*k), shade=.15)
    if quilt:
        for i in range(-2, 3): c.line([(10+i*3, 12.5+i*1.5+1), (16+i*3, 15.5+i*1.5+1)], .4, dk(col, .3), 160); c.line([(10+i*3+6, 12.5-i*1.5+1), (4+i*3+6, 15.5-i*1.5+1+3)], .4, dk(col, .3), 0)
        for i in range(1, 4): c.line([(5+i*2.75, 15-i*1.25), (16+i*2.75, 20-i*1.25)], .4, dk(col, .3), 170); c.line([(16-i*2.75, 10+i*1.25), (27-i*2.75, 15+i*1.25)], .4, dk(col, .3), 170)
    if pattern == 'weave':
        for i in range(1, 7): c.line([(5+i*1.6, 15-i*0.72), (16+i*1.6, 20-i*0.72)], .35, dk(col, .35), 170); c.line([(16-i*1.6, 10+i*.72), (27-i*1.6, 15+i*.72)], .35, dk(col, .35), 170)
    if glossy: c.line([(9, 14), (15, 11.5)], .9, (255, 255, 255), 170); c.line([(18, 12.5), (22, 14)], .6, (255, 255, 255), 130)
def spool(c, col):
    sh(c, 9); c.rect(10, 7, 22, 10, M['wood'], r=1); c.rect(11.5, 9, 20.5, 23, col, r=1.5)
    for y in range(11, 23, 2): c.line([(11.8, y), (20.2, y+0.8)], .4, dk(col, .3), 170)
    c.rect(10, 22, 22, 25, M['wood'], r=1); c.stroke([(20.5, 18), (25, 20), (26, 25)], .7, col, owf=.5)
def coil(c, col, rings=4, tight=False, end=None):
    sh(c, 11)
    for i in range(rings):
        y = 19-i*(1.6 if tight else 2.2); c.ell(16, y, 9 - (0 if not tight else 3), 4, col, shade=.4, owf=.8)
        c.ell(16, y, 6.5-(0 if not tight else 3), 2.3, (0, 0, 0), ol=False, shade=0) if False else None
    c.ell(16, 19-(rings-1)*(1.6 if tight else 2.2), 5.5-(0 if not tight else 2.5), 2, dk(col, .55), ol=False)
    if end: c.stroke([(23, 18), (27, 22), (26, 26)], 1.2, col); c.dot(26, 26, .9, end)
def pot(c, body, content, label=None, lid=None):
    sh(c, 10); c.poly([(9, 12), (23, 12), (24, 24), (21, 27), (11, 27), (8, 24)], body, shade=.35); c.ell(16, 12, 7.2, 2.4, dk(body, .1))
    c.ell(16, 12, 6, 1.7, content, ol=False)
    if lid: c.ell(16, 11, 7.8, 2.6, lid); c.rect(14.5, 7.5, 17.5, 10.5, dk(lid, .2), r=1)
    if label: c.rect(10, 16, 22, 22, label, r=.8)
    c.shine(11.5, 15.5, .8, 140)
def jar(c, content, lid='#c8874a', label='#f7ead1', dot=None):
    sh(c, 9); c.rect(9.5, 10, 22.5, 27, content, r=3.5, shade=.35); c.rect(10.5, 8, 21.5, 11, lid, r=1); c.rect(11, 15, 21, 21, label, r=1)
    if dot: c.ell(16, 18, 2.2, 1.8, dot, owf=.5)
    c.line([(11.5, 12), (11.5, 25)], .8, (255, 255, 255), 120)
def bottle(c, glass, liquid=None, cork='#c99a6b', fat=False, steam=False, label=None):
    sh(c, 9); w = 7 if fat else 5.5
    c.poly([(16-w, 15), (16-2, 10), (16-2, 6), (16+2, 6), (16+2, 10), (16+w, 15), (16+w, 26), (16-w, 26)], glass, shade=.3)
    if liquid: c.poly([(16-w+.8, 18), (16+w-.8, 18), (16+w-.8, 25.2), (16-w+.8, 25.2)], liquid, ol=False)
    if label: c.rect(16-w+.6, 18, 16+w-.6, 23, label, r=.5)
    c.rect(14, 3.5, 18, 6.5, cork, r=.8); c.line([(16-w+1.5, 16), (16-w+1.5, 24)], .8, (255, 255, 255), 130)
    if steam: [c.line([(x, 3), (x+1, 1.5), (x, 0.5)], .6, (255, 255, 255), 150) for x in (11, 21)]
def can(c, label, art=None, opened=False):
    sh(c, 9); c.rect(9, 9, 23, 26, M['steel'], r=1.5); c.ell(16, 9.5, 7, 2, lt(M['steel'], .3) if not opened else dk(M['steel'], .4))
    for y in (11, 24): c.line([(9.3, y), (22.7, y)], .5, dk(M['steel'], .3), 170)
    if label: c.rect(9, 13, 23, 22.5, label, r=0, shade=.25)
    if art == 'meat': c.ell(16, 17.7, 3.3, 2.5, '#9b4a37'); c.dot(17, 16.8, .8, '#f1d8c0')
    if art == 'fish': c.poly([(12, 17.7), (16, 15.5), (19, 17.7), (16, 20)], '#8fb3d1'); c.poly([(19, 17.7), (21.5, 15.8), (21.5, 19.6)], '#8fb3d1')
    if art == 'corn': c.ell(16, 17.7, 2, 3.5, M['yellow']); c.poly([(13, 21), (16, 16), (15, 21.5)], M['green'])
    c.line([(10.3, 12), (10.3, 25)], .7, (255, 255, 255), 130)
def bowl(c, soup, bits=(), steam=True):
    sh(c, 12); c.poly([(4, 16), (28, 16), (25, 24), (19, 27), (13, 27), (7, 24)], '#c57a4a', shade=.35); c.ell(16, 16, 12, 3.6, '#a2623c'); c.ell(16, 16, 10.5, 2.8, soup, ol=False)
    for x, y, col in bits: c.ell(x, y, 1.3, .9, col, owf=.5)
    c.line([(7, 20), (12, 23.5)], .8, '#f1c08f', 170)
    if steam: [c.line([(x, 12), (x+1.2, 9), (x-.4, 6.5), (x+.6, 4.5)], .7, (255, 255, 255), 160) for x in (11, 16, 21)]
def sack(c, col, label=None, tie=M['reed'], dust=None):
    sh(c, 10); c.poly([(8, 27), (6, 20), (9, 13), (13, 11), (19, 11), (23, 13), (26, 20), (24, 27)], col, shade=.35)
    c.poly([(12.5, 11), (11, 7), (14, 8.5), (16, 6), (18, 8.5), (21, 7), (19.5, 11)], lt(col, .1)); c.stroke([(12, 11), (20, 11)], 1.1, tie)
    if label: c.ell(16, 20, 4, 3.2, label, owf=.5)
    if dust: c.dot(16, 7.5, 1.6, dust)
def pouch(c, col, content=None, tie='#8a5a35'):
    sh(c, 10); c.ell(16, 20, 9, 7.5, col, shade=.35); c.poly([(10, 14), (13, 10), (19, 10), (22, 14)], lt(col, .05)); c.stroke([(11, 13.5), (21, 13.5)], 1.2, tie)
    if content: [c.ell(x, y, 1.4, 1.2, cc, owf=.5) for x, y, cc in content]
def bone(c, col=M['bone'], scale=1):
    sh(c, 11); c.stroke([(9, 23), (23, 9)], 3.6, col, shade=.25)
    for x, y in ((7, 22), (10, 25), (22, 7), (25, 10)): c.ell(x, y, 2.7, 2.7, col, shade=.25)
    c.line([(10, 21), (21, 10)], .6, (255, 255, 255), 150)
def feather(c, col='#9b8466', tip='#5e4b39'):
    sh(c, 9); c.poly([(7, 26), (11, 15), (18, 8), (26, 4), (24, 11), (18, 18), (10, 24)], col, shade=.35)
    c.poly([(21, 7), (26, 4), (24.5, 9)], tip, ol=False); c.line([(6, 27.5), (24.5, 5.5)], .6, '#efe5d0', 230)
    for i in range(4): c.line([(11+i*3, 21-i*3.5), (8.5+i*3, 18.5-i*3.5)], .4, dk(col, .3), 160)
def tuft(c, col, base=None):
    sh(c, 11)
    for i, (x, y, r) in enumerate(((10, 20, 6), (21, 20, 6), (16, 14, 6.5), (16, 22, 6.5))): c.ell(x, y, r, r*.85, col if i % 2 else lt(col, .08), shade=.35, owf=.8)
    for x, y in ((11, 17), (15, 12), (20, 16), (17, 20)): c.line([(x, y), (x+1.6, y+2.2)], .5, dk(col, .3), 170)
def lump(c, col, glossy=True, drips=False):
    sh(c, 11); c.poly([(6, 22), (8, 14), (14, 10), (21, 11), (26, 16), (25, 24), (16, 27), (9, 26)], col, shade=.4)
    if glossy: c.shine(12, 14, 1.4, 190); c.shine(15, 13, .7, 150)
    if drips: c.ell(23, 26, 1.4, 1.9, col)
def pelt(c, col):
    sh(c, 13); c.poly([(5, 10), (10, 8), (12, 4), (16, 7), (20, 4), (22, 8), (27, 10), (25, 16), (28, 22), (22, 23), (19, 28), (13, 28), (10, 23), (4, 22), (7, 16)], col, shade=.35)
    c.poly([(9, 12), (23, 12), (21, 22), (11, 22)], lt(col, .15), ol=False, shade=.1)
    for x, y in ((12, 14), (18, 13), (15, 18), (20, 19)): c.line([(x, y), (x+1, y+2)], .5, dk(col, .3), 160)
def gear(c, cx, cy, r, col, teeth=8):
    pts = []
    for i in range(teeth*2):
        a = math.pi*2*i/(teeth*2); rr = r if i % 2 else r*0.78; pts.append((cx+math.cos(a)*rr, cy+math.sin(a)*rr))
    c.poly(pts, col, shade=.4); c.ell(cx, cy, r*.3, r*.3, dk(col, .4), ol=False)
def spring_(c, col):
    sh(c, 8)
    for i in range(7): c.ell(16, 8+i*2.6, 5, 1.7, col, shade=.4, owf=.6)
    c.ell(16, 8, 4, 1, dk(col, .5), ol=False)
def chain(c, col):
    sh(c, 12)
    for i, (x, y) in enumerate(((8, 20), (12, 16), (16, 20), (20, 16), (24, 20), (12, 23), (20, 23))):
        c.ell(x, y, 3, 2.3, col, shade=.4, owf=.7); c.ell(x, y, 1.6, 1, dk(col, .55), ol=False)
def pipe_(c, col, rifled=False, caps=False):
    sh(c, 12); c.poly([(5, 21), (22, 6), (27, 11), (10, 26)], col, shade=.4); c.ell(24.5, 8.5, 3.3, 3.3, dk(col, .1)); c.ell(24.5, 8.5, 1.8, 1.8, dk(col, .6), ol=False)
    if rifled: [c.line([(9+i*3, 20.5-i*2.6), (11.5+i*3, 23-i*2.6)], .5, dk(col, .35), 170) for i in range(5)]; c.rect(5, 19, 10, 26, M['steel'], r=.8)
    c.line([(7, 20), (21, 7.5)], .7, lt(col, .6), 180)
# ---------- food
def potato(c, col='#b98a55', split=False, char=False):
    sh(c, 11); c.ell(16, 18, 10, 7.5, col if not char else '#6b4430', shade=.35)
    if split: c.ell(16, 16, 6.5, 3.6, '#f6e2a0', shade=.2); c.ell(16, 15.5, 2.6, 1.5, '#fff6c8', ol=False); c.dot(15, 15, 1, '#f9d74a')
    else: [c.dot(x, y, .6, dk(col, .4)) for x, y in ((11, 16), (18, 14), (21, 20), (14, 21))]
def corn(c, husk=True, grilled=False):
    sh(c, 10)
    if husk: c.poly([(6, 27), (11, 18), (17, 14), (11, 23)], M['green']); c.poly([(9, 28), (19, 20), (22, 16), (14, 26)], '#8fd06a')
    c.poly([(9, 24), (20, 6), (25, 7), (13, 26)], M['yellow'] if not grilled else '#f0b844', shade=.3)
    for i in range(6):
        t = i/6; c.line([(10.5+t*10.5, 24-t*17.5), (13.5+t*10.5, 25.5-t*17.5)], .45, dk(M['yellow'], .35), 170)
    if grilled: [c.line([(12+i*3, 21-i*4.5), (16+i*3, 21.5-i*4.5)], .8, '#5a3420', 220) for i in range(4)]; c.stroke([(7, 27), (10, 24)], 2, M['wood'])
def onion(c):
    sh(c, 10); c.ell(16, 20, 7.5, 7, '#a95bc8', shade=.35); c.poly([(14, 13), (13, 4), (16, 9), (19, 3), (18, 13)], M['green'])
    for x in (13, 16, 19): c.line([(x, 14.5), (x+(x-16)*.3, 26)], .5, dk('#a95bc8', .3), 160)
    c.line([(14, 27), (18, 27)], .8, '#e5dcc4')
def egg(c):
    sh(c, 12); c.poly([(5, 18), (7, 12), (13, 9), (20, 10), (27, 14), (26, 21), (19, 25), (10, 24)], '#fffaf0', shade=.18); c.ell(16, 16, 4.4, 4, '#ffb92e', shade=.3); c.shine(14.5, 14.5, .9, 230)
def omelette(c):
    sh(c, 12); c.poly([(4, 21), (10, 12), (20, 9), (28, 13), (24, 20), (14, 24)], '#ffd54f', shade=.3)
    for x, y in ((12, 15), (18, 13), (21, 17), (15, 19)): c.ell(x, y, 1.2, .8, '#b56fc9', owf=.5)
    c.dot(17, 16, .9, M['green'])
def fishflat(c, col='#c9d6df', salted=True):
    sh(c, 12); c.poly([(4, 19), (10, 13), (19, 12), (24, 15), (28, 11), (27, 21), (23, 18), (17, 22), (9, 22)], col, shade=.35); c.dot(9, 16.5, .9, '#2a2a33')
    if salted: [c.dot(x, y, .5, '#ffffff') for x, y in ((13, 15), (16, 18), (19, 15), (14, 19), (21, 17))]
    for x in (14, 17, 20): c.line([(x, 14), (x-1, 20)], .4, dk(col, .3), 140)
def jerky(c):
    sh(c, 11)
    for i in range(3): c.poly([(5+i*1.5, 22-i*5), (12+i*1.5, 18-i*5), (20+i*1.5, 19.5-i*5), (27+i*1.5, 15-i*5), (27.5+i*1.5, 18-i*5), (20+i*1.5, 23-i*5), (12+i*1.5, 21.5-i*5), (5.5+i*1.5, 25.5-i*5)], ['#8a3d2a', '#9e4a31', '#7a3424'][i], shade=.3)
    [c.dot(x, y, .45, '#ffffff', 200) for x, y in ((10, 20), (18, 15), (22, 10), (14, 22))]
def pie(c, filling, lattice=True):
    sh(c, 12); c.poly([(4, 18), (28, 18), (26, 24), (6, 24)], '#c98a46', shade=.3); c.ell(16, 18, 12, 5, '#e6a95a'); c.ell(16, 18, 10, 3.8, filling, ol=False)
    if lattice: [c.line([(9+i*4, 15), (7+i*4, 21)], 1, '#f2c27b') for i in range(4)]; [c.line([(6, 16.5+i*2.2), (26, 16.5+i*2.2)], 1, '#f2c27b') for i in range(2)]
    else: c.ell(16, 18, 10, 3.8, '#e8ac5c', ol=False); [c.line([(x, 16.5), (x+1, 19.5)], .7, '#a8692e') for x in (12, 16, 20)]
def cornbread(c):
    sh(c, 12); block(c, '#e5b244', '#f6d36a'); [c.dot(x, y, .6, '#b9822c') for x, y in ((12, 13), (17, 11.5), (20, 14), (15, 15))]
def cake(c):
    sh(c, 10); c.poly([(6, 15), (26, 15), (26, 23), (6, 23)], '#e2a352', shade=.3); c.ell(16, 23, 10, 3.5, '#d0904a'); c.ell(16, 15, 10, 3.5, '#f7c64e')
    c.poly([(8, 15), (10, 20), (12, 16.5), (15, 21), (18, 17), (21, 20.5), (24, 15)], '#f5b83a', ol=False); c.shine(13, 14, 1, 200); c.ell(16, 12.5, 1.6, 1.4, M['red'])
def skewer(c):
    sh(c, 10); c.stroke([(5, 27), (27, 5)], .9, M['wood'])
    for i in range(3): x, y = 11+i*5, 21-i*5; c.ell(x, y-1, 3.6, 2.4, '#b06b3c', shade=.35); c.rect(x-1.2, y, x+1.2, y+3, '#efdcbc'); c.line([(x-2, y-1.5), (x+1, y-2.4)], .6, '#5a3420')
def trail(c): pouch(c, '#d7b98a', [(13, 19, '#7a2f6b'), (17, 21, M['red']), (20, 18, '#8a5a35'), (15, 23, '#f3c24b'), (19, 23.5, '#7a2f6b')])
def poultice(c):
    sh(c, 11); c.poly([(6, 18), (16, 13), (26, 18), (16, 24)], '#f0e8d3', shade=.2); c.ell(16, 17.5, 6.5, 3, '#6dae4a', shade=.3)
    for x, y in ((14, 16.5), (17, 18), (18, 16)): c.dot(x, y, .7, '#3f7a2a'); c.stroke([(6, 18), (16, 23)], .8, M['reed'])
def medkit(c):
    sh(c, 12); c.rect(5, 11, 27, 26, '#fbfaf4', r=2, shade=.2); c.rect(12, 7.5, 20, 11.5, '#9aa3ae', r=1)
    c.rect(14.3, 13.5, 17.7, 23.5, M['red'], ol=False); c.rect(11, 16.8, 21, 20.2, M['red'], ol=False); c.line([(6.5, 13), (6.5, 24)], .7, (255, 255, 255), 200)
# ---------- clothing
def hat(c, kind, col, band=None):
    sh(c, 12)
    if kind == 'straw':
        c.ell(16, 20, 13, 5, col, shade=.3); c.poly([(9, 19), (10, 11), (14, 8.5), (18, 8.5), (22, 11), (23, 19)], lt(col, .1)); c.rect(9.5, 15.5, 22.5, 18, band or M['red'], ol=False)
        for i in range(5): c.line([(5+i*5, 21), (8+i*4, 19)], .4, dk(col, .3), 150)
    elif kind == 'cap':
        c.poly([(7, 20), (8, 13), (13, 9), (19, 9), (24, 13), (25, 20)], col, shade=.3); c.poly([(5, 20), (27, 20), (26, 23), (6, 23)], dk(col, .1)); c.line([(16, 9.5), (16, 20)], .4, dk(col, .3), 160)
    elif kind == 'hood':
        c.poly([(6, 26), (6, 14), (10, 7), (16, 5), (22, 7), (26, 14), (26, 26), (21, 22), (16, 21), (11, 22)], col, shade=.35); c.poly([(10, 23), (10, 15), (16, 11), (22, 15), (22, 23), (16, 20)], dk(col, .45), ol=False)
        c.stroke([(14, 22), (13, 27)], .7, '#f4ecd8'); c.stroke([(18, 22), (19, 27)], .7, '#f4ecd8'); c.line([(9, 10), (13, 7)], .9, (255, 255, 255), 140)
    elif kind == 'fur':
        c.poly([(6, 25), (6, 16), (26, 16), (26, 25), (22, 25), (22, 19), (10, 19), (10, 25)], M['fur']); c.ell(16, 13, 10, 7, col, shade=.35); c.poly([(6, 15), (26, 15), (26, 19), (6, 19)], M['fur'])
        [c.line([(x, 16), (x+1, 18.5)], .5, dk(M['fur'], .3), 150) for x in range(8, 25, 3)]
def shirt(c, col, long=True, quilt=False, coat=False, accent=None, hood=False):
    sh(c, 12); L = 29 if coat else 25
    c.poly([(10, 5), (13, 7), (19, 7), (22, 5), (28, 9), (29, 18) if long else (27, 13), (25, 18.5) if long else (24, 14), (23, 12), (23, L), (9, L), (9, 12), (7, 18.5) if long else (8, 14), (3, 18) if long else (5, 13), (4, 9)], col, shade=.3)
    c.poly([(13, 7), (16, 11), (19, 7)], dk(col, .3), ol=False); c.line([(16, 11), (16, L-.5)], .4, dk(col, .35), 170)
    if quilt: [c.line([(9.5, y), (22.5, y)], .4, dk(col, .3), 170) for y in range(12, L, 3)]
    if accent: c.poly([(9, L-3), (23, L-3), (23, L), (9, L)], accent, ol=False); c.poly([(10, 5), (13, 7), (16, 10), (19, 7), (22, 5), (20, 4.3), (16, 7.5), (12, 4.3)], accent, ol=False)
    if hood: c.ell(16, 5.5, 5, 2.5, dk(col, .1))
    for y in (14, 18, 22): c.dot(17, y, .45, dk(col, .5))
def trousers(c, col, quilt=False, fur=None, pocket=False):
    sh(c, 11); c.poly([(9, 4), (23, 4), (25, 27), (18.5, 27), (16, 12), (13.5, 27), (7, 27)], col, shade=.3); c.rect(8.6, 4, 23.4, 7, dk(col, .15), r=.4)
    if quilt: [c.line([(8, y), (24, y)], .4, dk(col, .3), 160) for y in range(10, 27, 3)]
    if fur: c.rect(6.5, 24.5, 13.8, 27.5, fur, r=1); c.rect(18.2, 24.5, 25.5, 27.5, fur, r=1)
    if pocket: c.rect(19, 9, 22.5, 13, dk(col, .1), r=.5)
    c.line([(16, 7), (16, 12)], .4, dk(col, .4), 170)
def boots(c, col, sole='#4a3326', fur=None, sandal=False, plates=None, lace=None, tall=False):
    sh(c, 12)
    for ox in (0, 9):
        x = 5+ox; top = 7 if tall else 10
        if sandal:
            c.poly([(x-1, 26), (x+1, 23), (x+8, 23), (x+9.5, 26)], col); c.line([(x+1, 23), (x+4, 17), (x+7, 23)], .9, dk(col, .2)); continue
        c.poly([(x, top), (x+5.5, top), (x+6, 20), (x+10, 22), (x+10.5, 25.5), (x-.5, 25.5)], col, shade=.3); c.rect(x-.8, 24.5, x+10.8, 27, sole, r=.7)
        if fur: c.rect(x-1, top-1.5, x+6.5, top+2, fur, r=1.4)
        if lace: [c.line([(x+1.2, y), (x+4.5, y+1)], .5, lace, 220) for y in range(top+2, 20, 2)]
        if plates: c.poly([(x+.5, top+2), (x+5, top+2), (x+5.4, 18), (x+.4, 18)], plates, shade=.4); c.dot(x+2.7, top+5, .6, dk(plates, .5))
def gloves(c, col, kind='glove', cuff=None, plates=None, fingerless=False):
    sh(c, 12)
    for i, ox in enumerate((0, 11)):
        x = 4+ox
        if kind == 'mitten': c.ell(x+5.5, 13, 5, 6.5, col, shade=.35); c.ell(x+(0.8 if i == 0 else 10.2), 15.5, 2, 3, col)
        else:
            c.rect(x+1, 10, x+10, 21, col, r=2)
            for f in range(4):
                fx = x+1.6+f*2.2; c.rect(fx, 4+(f in (0, 3))*1.5 + (3 if fingerless else 0), fx+2, 12, col, r=1, owf=.7)
                if plates: c.rect(fx+.2, 6+(f in (0, 3))*1.5, fx+1.8, 9, plates, r=.5, owf=.5)
            c.poly([(x+(1 if i else 10), 15), (x+(-2.5 if i else 13.5), 11), (x+(-1.5 if i else 12.5), 9.5), (x+(2 if i else 9), 12.5)], col)
        if plates: c.rect(x+1.3, 12, x+9.7, 17, plates, r=1, shade=.45); c.dot(x+5.5, 14.5, .6, dk(plates, .5))
        c.rect(x+.5, 20, x+10.5, 25.5, cuff or dk(col, .15), r=1.2)
def cloak(c, col, collar):
    sh(c, 13); c.poly([(11, 6), (21, 6), (27, 26), (22, 28), (16, 27), (10, 28), (5, 26)], col, shade=.3)
    c.ell(16, 7.5, 9, 3.8, collar, shade=.3); [c.line([(x, 5), (x+.8, 8.5)], .5, dk(collar, .3), 150) for x in range(9, 24, 2)]; c.ell(16, 10.5, 1.6, 1.6, M['brass'])
    for x in (11, 16, 21): c.line([(x, 12), (x+(x-16)*.35, 26)], .5, dk(col, .3), 160)
def bag(c, kind, col, strap=None, acc=None):
    sh(c, 12)
    if kind == 'satchel':
        c.stroke([(8, 16), (11, 5), (21, 5), (24, 16)], 1.4, strap or dk(col, .2), olc=None)
        c.rect(6, 14, 26, 27, col, r=3, shade=.3); c.poly([(6, 14), (26, 14), (25, 20), (7, 20)], lt(col, .1)); c.ell(16, 20, 1.5, 1.2, acc or M['wood'])
        for i in range(5): c.line([(7, 15+i*2.4), (25, 15+i*2.4)], .4, dk(col, .3), 150)
        return
    if kind == 'frame': c.rect(5, 3, 7, 29, M['iron'], r=1); c.rect(25, 3, 27, 29, M['iron'], r=1); c.rect(5, 6, 27, 7.6, M['iron'], r=.5)
    c.rect(7, 6 if kind != 'frame' else 8, 25, 27, col, r=4, shade=.3); c.rect(7, 6 if kind != 'frame' else 8, 25, 14, lt(col, .1), r=4)
    c.rect(10, 18, 22, 25, dk(col, .08), r=2); c.stroke([(16, 12), (16, 16)], 1, acc or M['brass'])
    if kind == 'tactical':
        [c.line([(10.5, y), (21.5, y)], .5, '#5d6270', 230) for y in (20, 22, 24)]; c.rect(4.5, 13, 7.5, 24, dk(col, .1), r=1); c.rect(24.5, 13, 27.5, 24, dk(col, .1), r=1)
# ---------- armor
ARM = dict(bone=(M['bone'], M['reed'], None), bronze=(M['bronze'], M['leather'], '#7a4a2a'), iron=(M['iron'], M['leather'], '#5a6370'),
           steel=(M['steel'], '#5a6370', '#8a93a0'), composite=(M['comp'], '#262830', '#6fd0e8'))
def armor(c, piece, mat):
    col, sub, acc = ARM[mat]; sh(c, 12)
    if piece == 'helmet':
        c.poly([(6, 22), (6, 14), (10, 7), (16, 5), (22, 7), (26, 14), (26, 22), (22, 24), (22, 18), (10, 18), (10, 24)], col, shade=.4)
        if mat == 'bone': [c.line([(x, 6.5), (x+(x-16)*.6, 18)], .6, dk(col, .35), 200) for x in (12, 16, 20)]; c.stroke([(6, 15), (26, 15)], .9, sub)
        if mat == 'bronze': c.poly([(15, 3), (17, 3), (18, 9), (14, 9)], M['red']); c.stroke([(6.5, 16), (25.5, 16)], 1, dk(col, .1))
        if mat == 'iron': [c.dot(x, y, .55, dk(col, .5)) for x, y in ((9, 13), (12, 9), (16, 8), (20, 9), (23, 13))]; c.poly([(10, 18), (22, 18), (22, 25), (10, 25)], '#6f7884') ; [c.dot(x, y, .4, '#4a515b') for x in range(11, 22, 2) for y in (19.5, 21.5, 23.5)]
        if mat == 'steel': c.poly([(9, 13), (23, 13), (23, 15.5), (9, 15.5)], '#3a3f4a', ol=False); c.line([(16, 5.5), (16, 12.5)], .8, lt(col, .6))
        if mat == 'composite': c.poly([(8.5, 12), (23.5, 12), (22, 16.5), (10, 16.5)], acc, ol=False); c.line([(8, 9.5), (13, 7)], .6, '#6a6f7c')
        c.shine(11, 9.5, 1, 170)
    elif piece == 'cuirass':
        c.poly([(7, 6), (12, 5), (16, 8), (20, 5), (25, 6), (27, 11), (25, 14), (25, 27), (7, 27), (7, 14), (5, 11)], col, shade=.4); c.line([(16, 9), (16, 26)], .6, dk(col, .35), 190)
        if mat == 'bone': [c.line([(8, y), (24, y)], .6, dk(col, .35), 190) for y in (12, 16, 20, 24)]; [c.stroke([(9, y), (23, y)], .6, sub, owf=.4) for y in (14, 22)]
        if mat == 'bronze': c.ell(16, 16, 4, 3.5, lt(col, .15)); c.ell(16, 16, 1.5, 1.3, dk(col, .3), ol=False)
        if mat == 'iron': [c.dot(x, y, .4, '#4a515b') for x in range(9, 24, 2) for y in range(17, 27, 2)]; [c.dot(x, y, .55, dk(col, .5)) for x, y in ((9, 8), (23, 8))]
        if mat == 'steel': c.poly([(8, 14), (24, 14), (24, 17), (8, 17)], dk(col, .1)); c.line([(9, 9), (14, 7)], .8, (255, 255, 255), 170)
        if mat == 'composite': [c.rect(x, y, x+5, y+4, '#4c515e', r=.6) for x in (9.5, 17.5) for y in (11, 17)]; c.line([(9, 23.5), (23, 23.5)], .8, acc)
    elif piece == 'greaves':
        trousers(c, sub if mat != 'composite' else '#2b2e36')
        for x in (7.8, 18.6):
            c.poly([(x, 13), (x+5.6, 13), (x+6, 26), (x+.2, 26)], col, shade=.4); c.ell(x+2.9, 13.5, 3.4, 2.4, lt(col, .1))
            if mat == 'bone': c.stroke([(x, 19), (x+5.8, 19)], .6, M['reed'], owf=.4)
            if mat == 'iron': c.dot(x+2.9, 17, .55, dk(col, .5)); c.dot(x+2.9, 22, .55, dk(col, .5))
            if mat == 'composite': c.line([(x+1, 20), (x+5, 20)], .7, acc)
    elif piece == 'boots':
        boots(c, sub if mat != 'composite' else '#2b2e36', plates=col, tall=True, sole=dk(sub, .3))
        if mat == 'composite': c.line([(7, 20), (10, 20)], .6, acc); c.line([(16, 20), (19, 20)], .6, acc)
    elif piece == 'gauntlets':
        gloves(c, sub if mat != 'composite' else '#2b2e36', plates=col, cuff=col)
        if mat == 'composite': c.line([(6, 22.5), (13, 22.5)], .6, acc); c.line([(17, 22.5), (24, 22.5)], .6, acc)
# ---------- explosives
def molotov(c):
    bottle(c, '#6fae5a', '#3a2a1e', cork='#e8dcc0'); c.poly([(13, 4), (12, 0.5), (14.5, 2), (16, -0.5) if False else (16, 0.5), (18, 2), (20, 0.5), (19, 4.5)], '#ff8a2a', ol=False); c.dot(16, 3.2, 1.1, '#ffe36b')
def grenade_(c, inc=False):
    sh(c, 9)
    if inc: c.rect(9, 10, 23, 26, '#9aa3ae', r=1.5); c.rect(9, 15, 23, 18.5, M['yellow'], ol=False); c.ell(16, 10, 7, 2, '#c8cfd8')
    else:
        c.ell(16, 19, 7.5, 8.5, M['olive'], shade=.4)
        for y in (14, 19, 24): c.line([(9, y), (23, y)], .5, dk(M['olive'], .4), 190)
        for x in (12.5, 16, 19.5): c.line([(x, 11), (x, 27)], .5, dk(M['olive'], .4), 190)
    c.rect(13, 6, 19, 10.5, '#8d97a6', r=.8); c.poly([(18, 7), (24, 9), (23.5, 15), (22, 15), (22.5, 10), (18, 9.5)], '#c9d3df'); c.stroke([(12, 6.5), (9, 4.5)], .5, '#e9bb46', owf=.4); c.ell(8, 4, 1.6, 1.6, '#e9bb46', owf=.5)
def bomb(c):
    sh(c, 11); c.ell(16, 18.5, 9.5, 8.5, '#c0703e', shade=.4); c.ell(16, 11, 4, 1.7, '#8f4f2c'); c.stroke([(16, 11), (18, 7), (22, 5)], .9, '#3a3438')
    c.poly([(21, 5), (23, 2), (24.5, 5.5), (22.5, 6.8)], '#ff9a2e', ol=False); c.dot(22.6, 4.8, .8, '#ffe36b'); c.line([(9, 20), (23, 20)], .7, '#8f4f2c', 200); c.shine(12, 14, 1.2, 160)
def pipebomb(c):
    pipe_(c, M['iron']); c.ell(7.5, 23.5, 3.3, 3.3, M['steel']); c.ell(24.5, 8.5, 3.3, 3.3, M['steel']); c.stroke([(24.5, 8.5), (27, 4), (29.5, 3.5)], .7, '#2e2a2e'); c.dot(29.5, 3.2, .9, '#ff9a2e')
def satchel(c):
    bag(c, 'satchel', '#b7a173', strap='#7d5a35', acc=M['red']); c.rect(10, 8, 15, 14, '#d24a3a', r=.8); c.rect(16, 8, 21, 14, '#d24a3a', r=.8); c.stroke([(21, 10), (25, 6), (28, 6)], .7, '#2e2a2e'); c.dot(28, 6, .8, '#ff9a2e')
def breach(c):
    sh(c, 12); c.poly([(5, 14), (16, 9), (27, 14), (27, 21), (16, 26), (5, 21)], '#33363f', shade=.3); c.poly([(5, 14), (16, 9), (27, 14), (16, 19)], '#474b56', ol=False)
    c.rect(12, 11.5, 20, 15.5, '#151a1f', r=.8, owf=.5); c.line([(13, 13.5), (19, 13.5)], .9, '#ff4a3a'); c.dot(18.6, 13.5, .6, '#ffd36b'); c.stroke([(20, 13), (24, 11)], .5, M['red'], owf=.4)
# ---------- misc intermediates
def glass_bottle(c): bottle(c, '#79c08a')
def tin(c): can(c, None, opened=True)
def oil_jug(c): sh(c, 10); c.poly([(9, 13), (12, 10), (20, 10), (23, 13), (24, 25), (21, 27), (11, 27), (8, 25)], '#c5834e', shade=.35); c.rect(13, 6, 19, 10.5, '#a96a3d', r=1); c.stroke([(21, 12), (26, 14), (24, 20)], 1.2, '#a96a3d'); c.dot(16, 7, 1.6, '#1d1a22'); c.poly([(13.5, 10), (15, 15), (16.5, 10)], '#1d1a22', ol=False)
def parts(c):
    sh(c, 12); c.poly([(4, 15), (28, 15), (26, 27), (6, 27)], '#a8774a', shade=.3); c.line([(5, 20), (27, 20)], .5, '#6e4a2c', 200)
    gear(c, 11, 12, 4.5, M['iron']); gear(c, 19.5, 11, 3.4, M['brass'], 7); c.stroke([(22, 14), (25, 7), (27, 9)], .7, '#e2504a', owf=.5); c.dot(14.5, 15, 1, M['steel']); c.dot(24, 14, .8, M['steel'])
def mechanism(c):
    sh(c, 11); c.rect(6, 9, 26, 25, '#8a6a4a', r=1.5); gear(c, 12.5, 15, 5, M['brass'], 9); gear(c, 20.5, 19.5, 4, M['steel'], 8); c.stroke([(19, 10), (24, 12)], .9, M['iron']); c.ell(22, 12, 1.2, 1.2, M['steel'])
    for x, y in ((7.5, 10.5), (24.5, 10.5), (7.5, 23.5), (24.5, 23.5)): c.dot(x, y, .5, '#4a3326')
def casings(c):
    sh(c, 12)
    for x, y, a in ((10, 18, 30), (17, 16, -20), (21, 21, 70), (13, 23, -60)):
        r = math.radians(a); dx, dy = math.cos(r)*4, math.sin(r)*4; c.stroke([(x-dx, y-dy), (x+dx, y+dy)], 3.2, M['brass'], shade=.4); c.ell(x+dx, y+dy, 1.1, 1.1, dk(M['brass'], .5), ol=False)
def bowstring(c): coil(c, '#f1e7cf', 3, True, end='#c9b265'); c.shine(12, 15, .6)
def fuse(c): coil(c, '#3b363a', 4, end='#ff9a2e')
def polymer(c): plate(c, '#2f3138'); c.line([(8, 17), (14, 20)], .5, '#6a6f7c'); c.poly([(25, 15.5), (28, 16), (28, 18.5), (26, 17.5)], '#25272d')
def aramid(c): cloth(c, '#f0c43a', pattern='weave')
def ceramic(c): sh(c, 11); c.poly([(9, 5), (23, 5), (25, 8), (25, 22), (16, 27), (7, 22), (7, 8)], '#f6f4ee', shade=.25); c.line([(10, 8), (14, 7)], .8, (255, 255, 255)); c.line([(9, 21), (16, 25)], .5, '#c9c4b8')
def glue(c): pot(c, '#c88a55', '#8a5a2a', label=None); c.stroke([(16, 12), (22, 3)], 1, M['wood']); c.ell(16, 12, 3.5, 1.2, '#6e4520', ol=False)
def flour(c): sack(c, '#efe2c4', label='#e3b448', dust='#ffffff')
def gunpowder(c): pouch(c, '#3a3438', tie='#c9b265'); [c.dot(x, y, .5, '#7a7480') for x, y in ((12, 21), (17, 23), (20, 19), (14, 17))]; c.poly([(13, 26), (19, 26), (22, 28), (10, 28)], '#2a262b', ol=False)
def thread(c): spool(c, '#e6d8a8')
def linen(c): cloth(c, '#efe6d2', pattern='weave')
def padded(c): cloth(c, '#f3ede0', quilt=True)
def waxed(c): cloth(c, '#9b8a52', glossy=True)
def hleather(c): plate(c, '#6d3f25', rivets='#c9a46a')
def beeswax(c): block(c, M['wax'], mark='hex')
def resin(c): lump(c, '#e59a2a', drips=True); c.dot(15, 19, .8, '#7a3d12', 200)
def salt(c): pile(c, '#f7f6f1', '#c6cbd2')
def scrap(c): sh(c, 12); c.poly([(5, 20), (12, 13), (16, 17), (11, 24)], '#b0683d'); c.poly([(13, 23), (16, 8), (20, 9), (17, 25)], '#8d97a6'); c.poly([(18, 14), (27, 12), (26, 18), (19, 21)], '#a0603a'); [c.dot(x, y, .8, '#d58a4a', 200) for x, y in ((9, 18), (22, 16), (17, 13))]
def fat(c): lump(c, '#f6efd9'); c.line([(11, 20), (20, 22)], .5, '#e4d2ad')
def sinew(c):
    sh(c, 11)
    for i in range(4): c.stroke([(6, 10+i*3), (12, 14+i*2), (20, 10+i*3.5), (26, 15+i*2.5)], .9, ['#c88f6a', '#b57955', '#d39d78', '#a8694a'][i], owf=.5)
def herbal_tea(c): bottle(c, '#bfe6c4', '#79b84a', steam=True)
def antiseptic(c): bottle(c, '#8a5a2a', cork='#f4ecd8', label='#f7f1e0'); c.rect(14.5, 19.2, 17.5, 21.8, M['red'], ol=False)
def lamp_oil(c): bottle(c, '#f3d18a', '#e39a2a', fat=True, cork='#8a5a2a')
