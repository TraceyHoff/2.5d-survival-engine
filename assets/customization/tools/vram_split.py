import json,os,sys
from PIL import Image
D='packages/assets/pack/customization/';m=json.load(open(D+'manifest.customization.json'))
tot=st=0
for a in m['atlases']:
  b=D+'atlases/'+a['key']; px=0
  for f in (b+'.png',b+'.tintmask.png'):
    if os.path.exists(f): w,h=Image.open(f).size; px+=w*h
  tot+=px
  if a.get('residency')=='stream': st+=px
T=float(sys.argv[1]); print(f"total {T} MiB; stream {T*st/tot:.1f}; resident {T*(1-st/tot):.1f}")
