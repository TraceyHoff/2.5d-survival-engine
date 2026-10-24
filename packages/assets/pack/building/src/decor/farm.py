"""ADR-113: feeding_trough (2x1, layer 2, 4 rotations; variants wood / stone / hay)."""
from .lib import piece, B, planksH, planksV, flat, cobble, toon_at, ellipse_pts

@piece('feeding_trough', (2, 1), 2, 2, ['wood', 'stone', 'hay'], 'farm')
def feeding_trough(v):
    hx, hy, H = .82, .32, 15
    if v == 'stone':
        mat, top, side, t = 'stone', cobble(6), cobble(6), .1
    else:
        mat, top, side, t = 'wood', planksH(5), planksH(4), .06
    bx = []
    if v != 'stone':  # legs
        for sx in (-1, 1):
            bx.append(B(sx * hx - .07 + (.07 if sx < 0 else 0) * 0, sx * hx + .07 * (1 if sx < 0 else 0) + (0 if sx < 0 else -0) , -hy - .03, hy + .03, 0, 5, 'wood_dark', flat(), flat(), flat(), edge=False))
    z0 = 0 if v == 'stone' else 4
    bx += [B(-hx, hx, -hy, -hy + t, z0, H, mat, top, side, side),            # back wall
           B(-hx, -hx + t, -hy + t, hy - t, z0, H, mat, top, side, side),    # left end
           B(hx - t, hx, -hy + t, hy - t, z0, H, mat, top, side, side),      # right end
           B(-hx + t, hx - t, -hy + t, hy - t, z0, z0 + 3, mat, top, side, side, edge=False)]  # floor
    fill = {'wood': ('wood', 0), 'stone': ('wood', 0), 'hay': ('hay', 1)}[v]
    # contents: grain mash (wood/stone) or heaped hay
    zt = H - 3 if v != 'hay' else H + 3
    bx.append(B(-hx + t, hx - t, -hy + t, hy - t, z0 + 3, zt, 'hay' if v == 'hay' else 'fur_pale', flat(.35), flat(.3), flat(.3), edge=False))
    bx += [B(-hx, hx, hy - t, hy, z0, H, mat, top, side, side)]              # front wall
    return bx
