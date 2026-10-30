"""Copy the clan palettes into the building manifest (served to the client) as `clanPalettes`.

Source of truth: assets/pvp_clan/clan_palettes.json (index order = clan tint index - 1). The pvp_clan fragment is not in
the client's MANIFEST_INDEX, so without this copy registry.clanPaletteForTint() is empty in-game and decor tintmask R/G
(rugs, curtains, tapestry, clan_flag, vases, ...) has no clan colours. Idempotent; build.py calls apply() before writing,
or run standalone: python3 clan_palettes.py  (rewrites manifest.building.json in place).
packages/assets/test/clan_palettes.test.ts keeps the copy byte-equal to the source."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../../../../..'))
SRC = os.path.join(ROOT, 'assets/pvp_clan/clan_palettes.json')
MAN = os.path.normpath(os.path.join(HERE, '../manifest.building.json'))


def palettes():
    pal = json.load(open(SRC))['palettes']
    assert [p['index'] for p in pal] == list(range(len(pal))), 'clan_palettes.json indices must be 0..n-1 in order'
    return [{'key': p['key'], 'primary': p['primary'], 'secondary': p['secondary']} for p in pal]


def apply(man):
    man['clanPalettes'] = palettes()
    return man


if __name__ == '__main__':
    man = apply(json.load(open(MAN)))
    json.dump(man, open(MAN, 'w'), indent=1); open(MAN, 'a').write('\n')
    print('clanPalettes', len(man['clanPalettes']), '->', MAN)
