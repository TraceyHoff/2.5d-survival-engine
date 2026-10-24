# ADR-110 bone/antler tools. Their inventory icons live in the nature pack (nature_icons, drawn by
# nature/src/itemicons.py, which imports these same painters); the items build only renders their held_<key>
# in-hand sprites (items_held_c) so the icon keys are never defined twice.
from icons import M, sh, axe, knife, handle_diag
def pick_antler(c):
    sh(c); handle_diag(c, (7, 27), (21, 9), 2.6, M['wood']); col = '#e8d8b8'
    c.stroke([(8, 10), (14, 6), (21, 6), (27, 10), (28.5, 15)], 2.2, col, shade=.3); c.rect(19, 6, 23.5, 11, '#8a6a3a', r=1)
    c.line([(18, 5), (24, 11)], .5, M['reed'], 220); c.line([(23.5, 5), (19, 11)], .5, M['reed'], 220)
BONE = {'bone_knife': lambda c: knife(c, M['bone'], M['leather'], .85, guard=False, shape='leaf'),
        'bone_axe': lambda c: axe(c, M['bone'], M['wood']),
        'antler_pickaxe': pick_antler}
