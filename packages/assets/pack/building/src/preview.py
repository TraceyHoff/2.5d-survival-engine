# Preview composites: sample house per tier x 4 rotations, and damage-stage sheets. Reads /tmp/bld_frames.pkl from build.py.
import pickle, sys, math
from PIL import Image, ImageDraw, ImageOps
import pieces as PC
D = pickle.load(open('/tmp/bld_frames.pkl', 'rb')); OUT = sys.argv[1]
PX, PY, WALL = 42, 72, 48
def frame(t, k, rot, stage=0):
    rows = PC.PIECES[k][3]
    if rows == 1:
        im = D[(t, k, 0)][stage]; return ImageOps.mirror(im) if rot >= 2 else im
    return D[(t, k, rot % rows)][stage]
def rotp(x, y, r):
    for _ in range(r): x, y = -y, x
    return x, y
def house(t, rot, roof=True):
    items = []  # (depth, z, key, x, y, rowrot)
    cells = [(-.5, -.5), (.5, -.5), (-.5, .5), (.5, .5)]
    for c in cells: items.append((c, 0, 'foundation', 0, -1))
    # outer walls: edges on x = +-1 / y = +-1 ; axis 0 = along x, 1 = along y
    walls = [((-.5, -1), 0, 'wall'), ((.5, -1), 0, 'wall_window'), ((-.5, 1), 0, 'wall_doorway'), ((.5, 1), 0, 'wall_arched'),
             ((-1, -.5), 1, 'wall_fortified'), ((-1, .5), 1, 'wall'), ((1, -.5), 1, 'wall_window'), ((1, .5), 1, 'wall')]
    for p, ax, k in walls: items.append((p, 0, k, ax, 0))
    # corners are vertex-snapped: post on the tile corner; outer row 0 has stubs toward -x/-y, i.e. sits on the (+1,+1) vertex
    for i, p in enumerate([(1, 1), (-1, 1), (-1, -1), (1, -1)]): items.append((p, 0, 'wall_corner_outer', i, 2))
    items.append(((-.5, 1.5), 0, 'foundation_ramp', 0, -1))   # ramp up to the doorway (high edge toward -y)
    TX, TY = 1 + 1 / (2 * 3 ** .5), .5   # equilateral foundation_triangle on the east edge (rot 0: edge 0 faces +x, so flip -> row 2)
    items.append(((TX, TY), 0, 'foundation_triangle', 2, -1))
    if not roof: items.append(((TX, TY), WALL, 'floor_triangle', 2, -1))
    ceil = ['floor', 'floor_skylight', 'floor_hatch_frame', 'floor']
    for c, k in zip(cells, ceil if not roof else ['floor'] * 4): items.append((c, WALL, k, 0, -1))
    if roof:
        for i, c in enumerate([(-.5, -.5), (.5, -.5), (.5, .5), (-.5, .5)]): items.append((c, WALL, 'roof_hip', i, 1))
        items.append(((.5, -.5), WALL + 1, 'roof_chimney', 0, 2))
    W, H = 460, 330; img = Image.new('RGBA', (W, H), (236, 228, 205, 255)); ox, oy = W // 2, 200
    dr = ImageDraw.Draw(img)
    for gx in range(-3, 4):
        for gy in range(-3, 4):
            a = [(gx + dx, gy + dy) for dx, dy in [(0, 0), (1, 0), (1, 1), (0, 1)]]
            dr.polygon([(ox + (x - y) * 32, oy + (x + y) * 16) for x, y in [(p[0] - .5, p[1] - .5) for p in a]], outline=(205, 195, 170))
    out = []
    for (x, y), z, k, rr, pri in items:
        X, Y = rotp(x, y, rot)
        rows = PC.PIECES[k][3]
        if rows == 2: fr = rr + rot
        elif rows == 4: fr = rr + rot
        else: fr = rot
        out.append(((z > 0, X + Y, pri), X, Y, z, k, fr))
    for _, X, Y, z, k, fr in sorted(out, key=lambda o: o[0]):
        im = frame(t, k, fr % 4)
        img.alpha_composite(im, (int(ox + (X - Y) * 32 - PX), int(oy + (X + Y) * 16 - z - PY)))
    return img
for t in range(1, 5):
    sheet = Image.new('RGBA', (460 * 4, 330 * 2), (255, 255, 255, 255))
    for r in range(4):
        sheet.paste(house(t, r, True), (460 * r, 0)); sheet.paste(house(t, r, False), (460 * r, 330))
    sheet.save(f'{OUT}/house_tier{t}_{PC.TIER_NAMES[t]}.png')
    keys = list(PC.PIECES); cols = 6; rows = math.ceil(len(keys) / cols)
    dm = Image.new('RGBA', (cols * 4 * 84, rows * 96), (236, 228, 205, 255))
    for i, k in enumerate(keys):
        for s in range(4): dm.alpha_composite(frame(t, k, 0, s), (((i % cols) * 4 + s) * 84, (i // cols) * 96))
    dm.save(f'{OUT}/damage_tier{t}_{PC.TIER_NAMES[t]}.png')
print('ok')
