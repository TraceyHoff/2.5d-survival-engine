"""Clan + trade-stall piece art from the unserved fragments (assets/pvp_clan, assets/stalls) -> building pack.

Those fragments are not in the client MANIFEST_INDEX, so their pieces (banner, banner_wall, claim_totem, barricade_spiked,
raid_bell, gate_clan, clan_hall_door, watchtower, stall_blanket/cart/booth, clan_pavilion, market_counter) drew a
fallback stand-in or nothing. This copies only the piece atlases (PNG + @2x + masks, unchanged) into building/atlases and
appends their building sprites with `residency: "stream"`. Changes from the fragment sprites:
  - crackOverlay `crack_1x1` (pvp_clan, unserved) -> `bld_crack`;
  - `stateVfx` dropped (its raid_* vfx live in the unserved pvp_clan fragment);
  - stall looks keep their keys with `building.piece = "<piece>@<variantName>"` (pieces.json variantNames), and the
    first variant is also copied as the bare key (`stall_blanket`, ...) so un-varianted pieces draw it;
  - banner_small / banner_large -> `banner@small` / `banner@large` (pieces.json banner has 3 variants without names).
Idempotent. Called at the end of build.py; standalone: cd src && python3 fragment_pieces.py ..
"""
import json, os, shutil, sys, copy

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../../../assets')
PVP = {'banner': 'banner', 'banner_small': 'banner@small', 'banner_large': 'banner@large', 'banner_wall': 'banner_wall',
       'claim_totem': 'claim_totem', 'barricade_spiked': 'barricade_spiked', 'raid_bell': 'raid_bell', 'gate_clan': 'gate_clan',
       'clan_hall_door': 'clan_hall_door', 'watchtower': 'watchtower'}
STALL_VARIANTS = {'stall_blanket': ['patch', 'gingham', 'picnic'], 'stall_cart': ['pine_red', 'dark_teal', 'sunny'],
                  'stall_booth': ['thatch', 'redroof', 'bluecloth']}
STALLS = {f'{p}_{v}': f'{p}@{v}' for p, vs in STALL_VARIANTS.items() for v in vs}
STALLS.update({'clan_pavilion': 'clan_pavilion', 'clan_trading_post': 'market_counter'})
BASE = {f'{p}_{vs[0]}': p for p, vs in STALL_VARIANTS.items()}   # first look doubles as the bare piece key
SRC = [('pvp_clan', PVP), ('stalls', STALLS)]

def _copy(rel, out):
    """fragment-relative path 'pvp_clan/atlases/x.png' -> pack 'atlases/x.png' (copied with its @2x twin if any)."""
    name = os.path.basename(rel); shutil.copyfile(os.path.join(ASSETS, rel), os.path.join(out, 'atlases', name))
    return f'atlases/{name}'

def apply(man, out):
    keys = set(); atl = {}
    for frag, table in SRC:
        m = json.load(open(os.path.join(ASSETS, frag, 'manifest.fragment.json'))); A = {a['key']: a for a in m['atlases']}
        for s in m['sprites']:
            if s['key'] not in table: continue
            atl.setdefault(s['atlas'], A[s['atlas']]); keys.add(s['key'])
            sp = copy.deepcopy(s); b = sp['building']; b['piece'] = table[s['key']]
            b.pop('stateVfx', None)
            if b.get('crackOverlay') == 'crack_1x1': b['crackOverlay'] = 'bld_crack'
            yield_ = [sp]
            if s['key'] in BASE:
                bs = copy.deepcopy(sp); bs['key'] = BASE[s['key']]; bs['building']['piece'] = BASE[s['key']]; yield_.insert(0, bs)
            for x in yield_: keys.add(x['key']); man['sprites'].append(x)
    man['atlases'] = [a for a in man['atlases'] if a['key'] not in atl]
    for k, a in atl.items():
        a = copy.deepcopy(a); a['image'] = _copy(a['image'], out)
        for pg in a.get('pages', []): pg['image'] = _copy(pg['image'], out)
        ms = a.get('masks') or {}
        for mk, mv in list(ms.items()):
            if mv is True:   # derived `<image>_emissive.png`: copy the 1x one (+ @2x twin) next to the image
                base = a['image'].replace('atlases/', '')
                for src in (base.replace('.png', '_emissive.png'), base.replace('.png', '_emissive@2x.png')):
                    p = os.path.join(ASSETS, frag_of(k), 'atlases', src)
                    if os.path.exists(p): shutil.copyfile(p, os.path.join(out, 'atlases', src))
            else:
                ms[mk] = _copy(mv, out); tw = mv.replace('.png', '@2x.png')
                if os.path.exists(os.path.join(ASSETS, tw)): _copy(tw, out)
        a['residency'] = 'stream'; man['atlases'].append(a)
    return sorted(atl), len(keys)

def frag_of(atlas_key):
    for frag, _ in SRC:
        if any(a['key'] == atlas_key for a in json.load(open(os.path.join(ASSETS, frag, 'manifest.fragment.json')))['atlases']): return frag

def strip(man):
    """remove earlier output (idempotent re-run on an already-built manifest)."""
    ks = set(PVP) | set(STALLS) | set(BASE.values())
    man['sprites'] = [s for s in man['sprites'] if s['key'] not in ks]

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '..'
    p = f'{out}/manifest.building.json'; man = json.load(open(p)); strip(man)
    atl, n = apply(man, out)
    json.dump(man, open(p, 'w'), indent=1); open(p, 'a').write('\n')
    print('fragment pieces:', n, 'sprites on', atl)
