import sys
from PIL import Image
sys.path.insert(0, '.')
from common import apply_tint
from viewtool import view
a = sys.argv; base = a[1]; im = Image.open(base + ".png").convert("RGBA"); m = Image.open(base.replace("@2x", "") + "_tintmask" + ("@2x" if "@2x" in base else "") + ".png").convert("RGB")
apply_tint(im, m, a[3] if len(a) > 3 else "#E8475F", a[4] if len(a) > 4 else "#F6EAD2").save("/workspace/pvp_tmp/_t.png")
view("/workspace/pvp_tmp/_t.png", a[2], int(a[5]) if len(a) > 5 else 1)
