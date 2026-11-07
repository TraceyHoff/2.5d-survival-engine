"""ADR-265: original split-ash rails, mortised rungs and fibre bindings. No borrowed sprite.
One 16px terrain-level section repeated at native size for any face height, never stretched.
The build icon is a separate full ladder painting from this original geometry. Four rotations,
four damage states, streamed 1x/2x page; no existing atlas is touched.
Run from this directory: python3 ladder.py ..
Then encode its updated PNG pages with assets/tools/ktx2.py (standard pack settings).
"""
import os, sys, json
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../../assets/tools'))
from buildings import B, render_boxes, flat, planksV
from iso import damage, add_outline
from toon import downscale
W=64; H=64; OX=32; OY=48

def geom(height=16):
    g=[]
    for x in (-.23,.18):
        g.append(B(x,x+.055,-.032,.032,0,height,'wood',planksV(7),flat(.05),flat(.05)))
        g.append(B(x+.012,x+.025,.033,.04,0,height,'sand',edge=False))
    for z in range(3,height,8):
        g.append(B(-.20,.21,-.045,.045,z,z+1.1,'wood_dark',flat(.04),flat(.04),flat(.04)))
        g.append(B(-.19,.20,.046,.05,z+.8,z+1.1,'wood',edge=False))
        for x in (-.23,.18):
            for zz in (z-.4,z+.5):g.append(B(x-.008,x+.063,-.042,.044,zz,zz+.45,'thatch',edge=False))
    for b in g:b.edge=False
    return g

def frame(rot,st,height=16):
    cv=render_boxes(geom(height),rot,seed=265,cell=(W,H),origin=(OX,OY if height==16 else 58))
    img=add_outline(damage(cv.img,st,265+rot),1.05,265+rot)
    return [downscale(img,(W*s,H*s)) for s in (1,2)]

def apply(out):
    f=[[frame(r,st) for st in range(4)] for r in range(4)]
    for s,suf in ((1,''),(2,'@2x')):
        im=Image.new('RGBA',(W*4*s,H*4*s))
        for r in range(4):
            for st in range(4):im.paste(f[r][st][s-1],(st*W*s,r*H*s))
        im.save(f'{out}/atlases/ladder{suf}.png',optimize=True)
        frame(0,0,48)[s-1].save(f'{out}/atlases/ladder_icon{suf}.png',optimize=True)
    p=f'{out}/manifest.building.json';m=json.load(open(p))
    m['atlases']=[a for a in m['atlases'] if a['key'] not in ('ladder','ladder_icon')]
    m['sprites']=[a for a in m['sprites'] if a['key'] not in ('ladder','build_ladder')]
    m['atlases'].append({'key':'ladder','image':'atlases/ladder.png','frameW':W,'frameH':H,'columns':4,'rows':4,'pages':[{'scale':2,'image':'atlases/ladder@2x.png'}],'residency':'stream'})
    m['atlases'].append({'key':'ladder_icon','image':'atlases/ladder_icon.png','frameW':W,'frameH':H,'columns':1,'rows':1,'pages':[{'scale':2,'image':'atlases/ladder_icon@2x.png'}],'residency':'stream'})
    m['sprites'].append({'key':'ladder','category':'building','atlas':'ladder','anchor':{'x':OX/W,'y':OY/H},'animations':{'idle':{'frames':[0],'fps':1}},'building':{'piece':'ladder','footprint':{'w':1,'h':1},'layer':3,'frames':[[r*4+st for st in range(4)] for r in range(4)]},'rotationArt':'unique4'})
    m['sprites'].append({'key':'build_ladder','category':'item','atlas':'ladder_icon','anchor':{'x':.5,'y':.5},'animations':{'idle':{'frames':[0],'fps':1}}})
    json.dump(m,open(p,'w'),indent=1);open(p,'a').write('\n')
if __name__=='__main__':apply(sys.argv[1] if len(sys.argv)>1 else '..')
