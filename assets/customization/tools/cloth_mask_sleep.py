"""Dedicated live-v1 cloth-mask bed overlay, using the existing bed/occlusion contract.
The shared sleeper geometry is read-only: registration is process-local to the v1
accessory generator and never writes or expands customization_v2_sample.
"""
import numpy as np
from rig import NEU_INK


def configure(sl):
    sl.ACC['cloth_mask'] = (30, 'cloth_mask', {})
    sl.ORD['cloth_mask'] = 30
    for k in ('P', 'S'):
        hl, base, shade, _ink, tint = sl.ROLE[k]
        sl.ROLE[k] = (hl, base, shade, NEU_INK, tint)
    original = sl.acc_prims

    def acc_prims(kinds):
        rest = tuple(k for k in kinds if k != 'cloth_mask')
        base = original(rest)

        def build(br, r):
            out = base(br, r)
            if 'cloth_mask' not in kinds:
                return out
            x = sl.figure.ctx
            c, fq = x['c'], x['fq']

            def cut(p, n, a):
                u, v, f = fq(p)
                panel = (np.abs(u) < .76) & (v > .02 + np.abs(u) * .09) & (v < .66 - np.abs(u) * .12) & (f > .2)
                straps = ((np.abs(v - .18) < .045) | (np.abs(v - .48) < .045)) & (f < .45)
                return panel | straps

            def deco(p, n, a):
                u, v, f = fq(p)
                out = np.full(p.shape[:-1], sl.RID['P'])
                out[f < .45] = sl.RID['S']
                out[((np.abs(v - .29) < .035) | (np.abs(v - .45) < .035)) & (f > .45)] = sl.RID['S']
                return out

            out.append(sl.Ell(c, (sl.HR + .9,) * 3, 'cloth_mask', clip=sl.Z_PIL - .5,
                              cut=cut, deco=deco, name='pleated_cloth_mask'))
            return out
        return build
    sl.acc_prims = acc_prims
