import json,os,sys
from PIL import Image
import importlib.util as _iu, os as _os  # ADR-138: manifest may be a v2 shard index
_spec = _iu.spec_from_file_location("cz_manifest", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "../../../packages/assets/scripts/cz_manifest.py"))
czm = _iu.module_from_spec(_spec); _spec.loader.exec_module(czm)
D='packages/assets/pack/customization/';m=czm.load(D+'manifest.customization.json')
tot=st=0
for a in m['atlases']:
  b=D+'atlases/'+a['key']; px=0
  for f in (b+'.png',b+'.tintmask.png'):
    if os.path.exists(f): w,h=Image.open(f).size; px+=w*h
  tot+=px
  if a.get('residency')=='stream': st+=px
T=float(sys.argv[1]); print(f"total {T} MiB; stream {T*st/tot:.1f}; resident {T*(1-st/tot):.1f}")
