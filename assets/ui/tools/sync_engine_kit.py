import json,os,shutil,glob,re
S='/workspace/assets'; EN='/workspace/engine-art'; U=EN+'/assets/ui'; PACK=EN+'/packages/assets/pack'
cp=lambda a,b:(os.makedirs(os.path.dirname(b),exist_ok=True),shutil.copy2(a,b))
def tree(a,b):
  for r,ds,fs in os.walk(a):
    ds[:]=[d for d in ds if d!='__pycache__']
    for f in fs: cp(os.path.join(r,f),os.path.join(b,os.path.relpath(os.path.join(r,f),a)))
# 1 source trees (hooks, input atlas, tools, screens)
tree(S+'/ui/hooks',U+'/hooks'); tree(S+'/ui/input',U+'/input'); tree(S+'/ui/tools',U+'/tools')
for f in ['theme.json','UI_GUIDE.md']: cp(S+'/ui/'+f,U+'/'+f)
for f in glob.glob(S+'/ui/fonts/**/*',recursive=True):
  if os.path.isfile(f):
    d=U+'/fonts/'+os.path.relpath(f,S+'/ui/fonts')
    if not os.path.exists(d): cp(f,d); print('font',d)
# 2 schema + screens
cp(S+'/ui/screens/screen.schema.json',U+'/screen.schema.json')
if os.path.exists(U+'/screens/screen.schema.json'): os.remove(U+'/screens/screen.schema.json')
def put(src,dst,depth):
  j=json.load(open(src))
  if '$schema' in j or True: j={'$schema':'../'*depth+'screen.schema.json',**{k:v for k,v in j.items() if k!='$schema'}}
  if isinstance(j.get('strings'),str): j['strings']='strings/en.json'
  json.dump(j,open(dst,'w'),indent=2); open(dst,'a').write('\n')
n=0
for f in glob.glob(S+'/ui/screens/*.json'):
  if f.endswith('screen.schema.json'): continue
  put(f,U+'/screens/'+os.path.basename(f),1); n+=1
for f in glob.glob(S+'/ui/screens/_partials/*.json'): put(f,U+'/screens/_partials/'+os.path.basename(f),2); n+=1
st=0
for f in glob.glob(S+'/stalls/ui/screens/*.json'): put(f,U+'/screens/'+os.path.basename(f),1); st+=1
for f in glob.glob(S+'/stalls/ui/screens/_partials/*.json'): put(f,U+'/screens/_partials/'+os.path.basename(f),2); st+=1  # item_tooltip: stalls drop-in successor wins
cp(S+'/ui/screens/mock/state.json',U+'/screens/mock/state.json'); cp(S+'/stalls/ui/screens/mock/state.json',U+'/screens/mock/stall_state.json')
print('screens',n,'stall screens',st)
# 3 strings
en={}
en.update(json.load(open(S+'/ui/hooks/strings.json')))
en.update(json.load(open(S+'/customization/ui/strings.json')))
en.update({k:v for k,v in json.load(open(S+'/stalls/strings/en.json')).items() if k!='$comment'})
os.makedirs(U+'/strings',exist_ok=True); json.dump(en,open(U+'/strings/en.json','w'),indent=2,ensure_ascii=False); print('strings',len(en))
# 4 kit: atlases 1x/2x into assets/ui/kit + fragment; pack copies under atlases/
K=U+'/kit'; os.makedirs(K,exist_ok=True)
frags=[(S+'/ui/atlas/engine/manifest.ui.json',S+'/ui/atlas/engine'),(S+'/ui/input/atlas/engine/manifest.input.json',S+'/ui/input/atlas/engine')]
kit={'version':1,'name':'ui-cozy-camp-kit','atlases':[],'sprites':[],'glyphs':{}}
for fp,base in frags:
  m=json.load(open(fp))
  for a in m['atlases']:
    imgs=[a['image']]+[p['image'] for p in a.get('pages',[])]
    for i in imgs: cp(os.path.join(base,i),K+'/'+os.path.basename(i))
    kit['atlases'].append(a)
  kit['sprites']+=m['sprites']
  if isinstance(m.get('glyphs'),dict): kit['glyphs'].update(m['glyphs'])
  elif m.get('glyphs'): kit['glyphs']=m['glyphs']
# hooks ui atlases from survival_events fragment
se=json.load(open(S+'/survival_events/manifest.fragment.json'))
hk={a['key'] for a in se['atlases'] if a['image'].startswith('hooks/')}
for a in se['atlases']:
  if a['key'] in hk:
    a=json.loads(json.dumps(a))
    for i in [a['image']]+[p['image'] for p in a.get('pages',[])]: cp(S+'/ui/hooks/atlas/engine/'+os.path.basename(i),K+'/'+os.path.basename(i))
    a['image']=os.path.basename(a['image'])
    for p in a.get('pages',[]): p['image']=os.path.basename(p['image'])
    kit['atlases'].append(a)
kit['sprites']+=[s for s in se['sprites'] if s['atlas'] in hk]
if not kit['glyphs']: del kit['glyphs']
json.dump(kit,open(K+'/manifest.ui.kit.json','w'),indent=1); open(K+'/manifest.ui.kit.json','a').write('\n')
# 5 merge into pack: kit images copied flat to pack/atlases (branding pattern); se fx atlases to pack/atlases too
m=json.load(open(PACK+'/manifest.json'))
def addA(a,src_dir):
  a=json.loads(json.dumps(a))
  for i,setter in [(a['image'],lambda v:a.__setitem__('image',v))]+[(p['image'],(lambda p:lambda v:p.__setitem__('image',v))(p)) for p in a.get('pages',[])]:
    b=os.path.basename(i); cp(os.path.join(src_dir,b),PACK+'/atlases/'+b); setter('atlases/'+b)
  for k,v in list(a.get('masks',{}).items()):
    b=os.path.basename(v); cp(os.path.join(src_dir,b),PACK+'/atlases/'+b); a['masks'][k]='atlases/'+b
  return a
newA=[addA(a,K) for a in kit['atlases']]+[addA(a,S+'/survival_events/atlases') for a in se['atlases'] if a['key'] not in hk]
newS=kit['sprites']+[s for s in se['sprites'] if s['atlas'] not in hk]
newV=se.get('vfx',[])
ex={sec:{e['key'] for e in m.get(sec,[])} for sec in ('atlases','sprites','vfx')}
col=[(sec,e['key']) for sec,L in (('atlases',newA),('sprites',newS),('vfx',newV)) for e in L if e['key'] in ex[sec]]
print('collisions',col[:10],len(col))
ak={a['key'] for a in newA}; sk={s['key'] for s in newS}; vk={v['key'] for v in newV}
m['atlases']=[a for a in m['atlases'] if a['key'] not in ak]+newA
m['sprites']=[s for s in m['sprites'] if s['key'] not in sk]+newS
m['vfx']=[v for v in m['vfx'] if v['key'] not in vk]+newV
if kit.get('glyphs'):
  g=m.setdefault('glyphs',{}); 
  if isinstance(g,dict): g.update(kit['glyphs'])
json.dump(m,open(PACK+'/manifest.json','w'),indent=2); open(PACK+'/manifest.json','a').write('\n')
print('kit atlases',len(kit['atlases']),'kit sprites',len(kit['sprites']),'fx atlases',len(newA)-len(kit['atlases']),'fx sprites',len(newS)-len(kit['sprites']),'vfx',len(newV))
