import sys, os
from PIL import Image
# view.py <atlas> <scale> [x y w h] [bg]
a = sys.argv; k = a[1]; s = int(a[2])
p = os.path.join(os.path.dirname(__file__), "..", "atlases", k + ".png")
im = Image.open(p).convert("RGBA")
if len(a) >= 7: x, y, w, h = map(int, a[3:7]); im = im.crop((x, y, x + w, y + h))
bg = a[7] if len(a) > 7 else "#8fc865"
c = Image.new("RGBA", im.size, bg); c.alpha_composite(im)
c = c.resize((im.width * s, im.height * s), Image.NEAREST); c.save(a[-1] if a[-1].endswith(".png") else "/tmp/view.png"); print(c.size)
