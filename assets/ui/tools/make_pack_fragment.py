"""Write atlas/engine/manifest.ui.pack.json: the UI fragment with image paths rewritten for
engine/packages/assets/pack/ (images live in pack/atlases/). Run after gen_kit.py."""
import json, os
D = os.path.join(os.path.dirname(__file__), '..', 'atlas', 'engine')
m = json.load(open(os.path.join(D, 'manifest.ui.json')))
for a in m['atlases']:
    a['image'] = 'atlases/' + os.path.basename(a['image'])
json.dump({"atlases": m['atlases'], "sprites": m['sprites']}, open(os.path.join(D, 'manifest.ui.pack.json'), 'w'), indent=1)
print('wrote manifest.ui.pack.json', len(m['atlases']), 'atlases', len(m['sprites']), 'sprites')
