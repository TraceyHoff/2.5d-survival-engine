# piece_garage: 3x2 iso garage (2:1, 64x32 tiles), pivot at footprint centre on the ground. 4 rotations x 4 damage stages, 3 material tiers.
import math, random
from draw import C, lt, dk, mix
CELL = 176; PX, PY = 88, 132  # pivot -> anchor (0.5, 0.75)
TIERS = {1: dict(wall='#b5743d', trim='#7d4a2b', roof='#d9534a', mat='plank', door='#c9b98f'),
         2: dict(wall='#c8644a', trim='#efe2c4', roof='#4f6fae', mat='brick', door='#c9d3df'),
         3: dict(wall='#7fa9b8', trim='#4a5a6a', roof='#5a6f7f', mat='metal', door='#e9bb46')}
def build(rot, stage, tier):
    c = C(CELL, 4); T = TIERS[tier]; rnd = random.Random(rot*31+stage*7+tier)
    long_x = rot in (0, 2); a, b = (1.5, 1.0) if long_x else (1.0, 1.5)
    H = 46 if stage < 3 else 0; R = 26
    P = lambda x, y, z: (PX+(x-y)*32, PY+(x+y)*16-z)
    # ground pad + soft shadow
    c.shadow(PX, PY, 92, 44, 60)
    c.poly([P(-a-.15, -b-.15, 0), P(a+.15, -b-.15, 0), P(a+.15, b+.15, 0), P(-a-.15, b+.15, 0)], '#a59a8a', shade=.15, owf=.8)
    if stage == 3:  # wreck: stub walls, collapsed roof, rubble
        h = 14
        c.poly([P(-a, b, 0), P(a, b, 0), P(a, b, h), P(.3, b, h*.5), P(-a, b, h+4)], T['wall'], shade=.3)
        c.poly([P(a, -b, 0), P(a, b, 0), P(a, b, h), P(a, 0, h+8), P(a, -b, h*.6)], dk(T['wall'], .15), shade=.3)
        c.poly([P(-a+.3, -b+.2, 6), P(a-.4, -b+.4, 2), P(a-.2, .6, 16), P(-a+.5, .3, 22)], T['roof'], shade=.35)
        c.line([P(-a+.6, -.2, 18), P(a-.5, 0, 12)], 1.2, dk(T['roof'], .5))
        for i in range(14):
            x, y = rnd.uniform(-a, a), rnd.uniform(-b*.2, b+.2); sx, sy = P(x, y, 0); s = rnd.uniform(3, 6)
            c.poly([(sx-s, sy), (sx-s*.3, sy-s*.8), (sx+s, sy-s*.3), (sx+s*.6, sy+s*.3)], rnd.choice([T['wall'], T['trim'], T['roof'], '#9a9aa3']), shade=.3, owf=.6)
        for _ in range(3): x = rnd.uniform(-a, a); c.stroke([P(x, b, 0), P(x+rnd.uniform(-.4, .4), b+.3, 20)], 2.2, T['trim'])
        return c.out(CELL*2), c.out(CELL)
    # back roof plane (behind), walls, gable, front roof plane
    if long_x:
        back = [P(-a-.1, -b-.12, H-2), P(a+.1, -b-.12, H-2), P(a+.1, 0, H+R), P(-a-.1, 0, H+R)]
        front = [P(-a-.1, 0, H+R), P(a+.1, 0, H+R), P(a+.1, b+.12, H-2), P(-a-.1, b+.12, H-2)]
        gable = [P(a, -b, H), P(a, b, H), P(a, 0, H+R)]
    else:
        back = [P(-a-.12, -b-.1, H-2), P(-a-.12, b+.1, H-2), P(0, b+.1, H+R), P(0, -b-.1, H+R)]
        front = [P(0, -b-.1, H+R), P(0, b+.1, H+R), P(a+.12, b+.1, H-2), P(a+.12, -b-.1, H-2)]
        gable = [P(-a, b, H), P(a, b, H), P(0, b, H+R)]
    c.poly(back, dk(T['roof'], .2), shade=.25)
    fy = [P(-a, b, 0), P(a, b, 0), P(a, b, H), P(-a, b, H)]; fx = [P(a, -b, 0), P(a, b, 0), P(a, b, H), P(a, -b, H)]
    c.poly(fy, T['wall'], shade=.25); c.poly(fx, dk(T['wall'], .14), shade=.25); c.poly(gable, dk(T['wall'], .14) if long_x else T['wall'], shade=.25)
    # materials
    def face_pt(face, u, v): return P(u, b, v) if face == 'y' else P(a, u, v)
    for face, L in (('y', a), ('x', b)):
        col = dk(T['wall'], .45)
        if T['mat'] == 'plank':
            n = int(L*2*5)
            for i in range(1, n): u = -L+2*L*i/n; c.line([face_pt(face, u, 1), face_pt(face, u, H-1)], .5, col, 150)
        elif T['mat'] == 'brick':
            for r in range(1, int(H/6)):
                v = r*6; c.line([face_pt(face, -L, v), face_pt(face, L, v)], .45, lt(T['wall'], .5), 170)
                for i in range(int(L*2*4)):
                    u = -L+(i+(.5 if r % 2 else 0))*0.25
                    if -L < u < L: c.line([face_pt(face, u, v), face_pt(face, u, v-6)], .4, lt(T['wall'], .5), 120)
        else:
            n = int(L*2*9)
            for i in range(1, n): u = -L+2*L*i/n; c.line([face_pt(face, u, 1), face_pt(face, u, H-1)], .6, lt(T['wall'], .45) if i % 2 else dk(T['wall'], .3), 170)
        c.line([face_pt(face, -L, H-1), face_pt(face, L, H-1)], 1.4, T['trim'])
        c.line([face_pt(face, -L, 1.5), face_pt(face, L, 1.5)], 1.2, dk(T['wall'], .35))
    # door / windows
    door_face = {0: 'y', 1: 'x', 2: None, 3: None}[rot]
    def quad(face, u0, u1, v0, v1, col, **k): c.poly([face_pt(face, u0, v0), face_pt(face, u1, v0), face_pt(face, u1, v1), face_pt(face, u0, v1)], col, **k)
    if door_face:
        L = a if door_face == 'y' else b
        quad(door_face, -L*.62, L*.62, 0, 31, T["trim"], shade=.2)
        quad(door_face, -L*.55, L*.55, 0, 28, T["door"], shade=.3, owf=.6)
        for v in range(4, 28, 4): c.line([face_pt(door_face, -L*.55, v), face_pt(door_face, L*.55, v)], .5, dk(T['door'], .35), 190)
        c.line([face_pt(door_face, -.12, 4), face_pt(door_face, .12, 4)], 1.2, dk(T['door'], .5))
        # sign with wrench
        sx, sy = face_pt(door_face, 0, 36.5); c.rect((sx-9)/1, sy-3.5, sx+9, sy+3.5, '#f2c84b', r=1.5, owf=.6)
        c.stroke([(sx-5, sy+1.5), (sx+4, sy-1.5)], 1.3, '#4a4f5c'); c.ell(sx+4.5, sy-1.6, 1.6, 1.6, '#4a4f5c', ol=False)
        other = 'x' if door_face == 'y' else 'y'
    else: other = None
    for face in ('y', 'x'):
        if face == door_face: continue
        L = a if face == 'y' else b
        us = [-L*.5, L*.5] if L > 1.2 else [0.0]
        for u in us:
            quad(face, u-.22, u+.22, 18, 32, T['trim'], shade=.2); quad(face, u-.17, u+.17, 20, 30, '#9fd8f0', shade=.2, owf=.5)
            c.line([face_pt(face, u-.1, 21.5), face_pt(face, u+.05, 28.5)], .7, '#ffffff', 170)
        if face == 'x' and not door_face: quad(face, -L*.9, -L*.5, 0, 24, T['trim'], shade=.3)
    # roof
    c.poly(front, T['roof'], shade=.3)
    rr = lambda t, s: (front[0][0]+(front[3][0]-front[0][0])*t+(front[1][0]-front[0][0])*s, front[0][1]+(front[3][1]-front[0][1])*t+(front[1][1]-front[0][1])*s)
    for i in range(1, 5): t = i/5; c.line([rr(t, 0.01), rr(t, .99)], .6, dk(T['roof'], .35), 170)
    if T['mat'] == 'metal':
        for i in range(1, 16): s = i/16; c.line([rr(0.02, s), rr(.98, s)], .45, lt(T['roof'], .4), 140)
    c.line([front[0], front[1]], 1.6, lt(T['roof'], .35))
    # chimney / vent
    vx, vy = rr(.35, .78); c.rect(vx-3, vy-12, vx+3, vy, '#8d97a6', r=1, owf=.7); c.rect(vx-4, vy-14, vx+4, vy-11, '#5a6270', r=1, owf=.6)
    # damage stages 1-2: bespoke cracks, holes, loose planks
    if stage >= 1:
        for face in ('y', 'x'):
            L = a if face == 'y' else b
            for _ in range(2 if stage == 1 else 4):
                u, v = rnd.uniform(-L*.9, L*.9), rnd.uniform(8, H-8); pts = [face_pt(face, u, v)]
                for _ in range(4): u += rnd.uniform(-.15, .15); v += rnd.uniform(-7, 7); pts.append(face_pt(face, u, v))
                c.line(pts, .8, '#2a1c28', 210)
    if stage >= 2:
        for face in ('y', 'x'):
            L = a if face == 'y' else b; u, v = rnd.uniform(-L*.8, L*.8), rnd.uniform(10, H-14)
            c.poly([face_pt(face, u-.2, v), face_pt(face, u+.05, v-5), face_pt(face, u+.22, v+2), face_pt(face, u, v+8), face_pt(face, u-.15, v+6)], '#2e2230', ol=False)
        hx, hy = rr(.45, .3); c.poly([(hx-8, hy), (hx-2, hy-5), (hx+7, hy-3), (hx+5, hy+4), (hx-4, hy+5)], '#2e2230', ol=False)
        c.stroke([(hx-7, hy+2), (hx+6, hy-6)], 1.5, T['trim'])
        for _ in range(5):
            x = rnd.uniform(-a, a); sx, sy = P(x, b+.25, 0); c.poly([(sx-3, sy), (sx, sy-3), (sx+3, sy-.5)], rnd.choice([T['wall'], T['roof']]), owf=.5)
    return c.out(CELL*2), c.out(CELL)
def crack(stage):
    c = C(CELL, 4); rnd = random.Random(99+stage); P = lambda x, y, z: (PX+(x-y)*32, PY+(x+y)*16-z)
    for _ in range(stage*3):
        face = rnd.choice('yx'); L = 1.5 if face == 'y' else 1.0; u, v = rnd.uniform(-L*.9, L*.9), rnd.uniform(8, 40)
        pt = (lambda u, v: P(u, 1.0, v)) if face == 'y' else (lambda u, v: P(1.5, u, v)); pts = [pt(u, v)]
        for _ in range(3+stage): u += rnd.uniform(-.14, .14); v += rnd.uniform(-6, 6); pts.append(pt(u, v))
        c.line(pts, .9, '#2a1c28', 200)
    return c.out(CELL*2), c.out(CELL)
