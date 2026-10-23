"""Fredoka MTSDF font atlases (regular 400 + bold 700, wdth 100) for world-space stall text.
Generator: msdfgen v1.12 (mtsdf mode, -varfont) as bundled by npm msdf-bmfont-xml@2.8.0 (no msdf-atlas-gen/cmake on the box);
this script lays glyphs out and writes BMFont-style JSON (same shape as ui/fonts/sdf/font_prompt.json + distanceField).
Charset: ASCII 0x20-0x7E + Latin-1 0xA0-0xFF. em = 48px, pxRange = 4 (atlas px). RGB = MSDF, A = true SDF.
Setup once: (cd /tmp/msdf && npm i msdf-bmfont-xml@2.8.0); MSDFGEN env overrides the binary path."""
import os, re, subprocess, json, math, tempfile
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from fontTools.ttLib import TTFont
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FONT = "/workspace/assets/ui/fonts/Fredoka.ttf"
MSDFGEN = os.environ.get("MSDFGEN", "/tmp/msdf/node_modules/msdf-bmfont-xml/bin/linux/msdfgen.linux")
EM, RANGE, PAD = 48, 4, 3
CHARS = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))
OUT = os.path.join(ROOT, "fonts")

def run(args): return subprocess.run([MSDFGEN] + args, capture_output=True, text=True, check=True).stdout

def instance(var, tmp):
    """static instance via fontTools.varLib.instancer (msdfgen -varfont ignored the wght axis in testing)"""
    from fontTools.varLib import instancer
    axes = {k: float(v) for k, v in (p.split("=") for p in var.split("&"))}
    p = os.path.join(tmp, "inst.ttf"); instancer.instantiateVariableFont(TTFont(FONT), axes).save(p); return p

def glyph(src, cp, tmp):
    spec = ["-font", src, str(cp), "-emnormalize"]
    m = run(["metrics"] + spec)
    adv = float(re.search(r"advance = ([-\d.]+)", m).group(1))
    b = re.search(r"bounds = ([-\d.e]+), ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)", m)
    if not b: return cp, adv, None, None
    l, bo, r, t = map(float, b.groups())
    x0, y0 = math.floor(l * EM) - PAD, math.floor(bo * EM) - PAD
    w, h = math.ceil(r * EM) + PAD - x0, math.ceil(t * EM) + PAD - y0
    f = os.path.join(tmp, f"{cp}.png")
    run(["mtsdf"] + spec + ["-size", str(w), str(h), "-pxrange", str(RANGE), "-scale", str(EM),
         "-translate", str(-x0 / EM), str(-y0 / EM), "-o", f])
    return cp, adv, (x0, y0, w, h), Image.open(f).convert("RGBA").copy()

def build(name, var, weight):
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(8) as ex:
        src = instance(var, tmp); gl = list(ex.map(lambda cp: glyph(src, cp, tmp), CHARS))
    for W in (512, 1024):   # shelf pack; widen instead of doubling height past 512
        x = y = 1; rowh = 0; place = {}
        for cp, adv, box, im in sorted(gl, key=lambda g: -(g[2][3] if g[2] else 0)):
            if im is None: continue
            if x + im.width + 1 > W: x = 1; y += rowh + 1; rowh = 0
            place[cp] = (x, y); x += im.width + 1; rowh = max(rowh, im.height)
        if y + rowh + 1 <= 512: break
    H = 1 << math.ceil(math.log2(y + rowh + 1))
    page = Image.new("RGBA", (W, H), (0, 0, 0, 0)); chars = []
    f = TTFont(FONT); upm = f["head"].unitsPerEm; asc = f["hhea"].ascent / upm * EM; desc = -f["hhea"].descent / upm * EM
    for cp, adv, box, im in gl:
        c = {"id": cp, "char": chr(cp), "xadvance": round(adv * EM, 2), "page": 0, "chnl": 15}
        if im is None: c.update(width=0, height=0, xoffset=0, yoffset=0, x=0, y=0)
        else:
            px, py = place[cp]; page.paste(im, (px, py)); x0, y0, w, h = box
            c.update(width=w, height=h, x=px, y=py, xoffset=x0, yoffset=round(asc - (y0 + h), 2))   # BMFont: yoffset from line top
        chars.append(c)
    png = f"fredoka_{name}_mtsdf.png"; page.save(os.path.join(OUT, png), optimize=True)
    js = {"pages": [png], "chars": chars,
          "info": {"face": f"Fredoka {name.title()}", "size": EM, "bold": int(weight >= 700), "italic": 0, "charset": "ASCII+Latin-1", "unicode": 1,
                   "padding": [PAD] * 4, "variation": var},
          "common": {"lineHeight": round(asc + desc, 2), "base": round(asc, 2), "scaleW": W, "scaleH": H, "pages": 1, "packed": 0},
          "distanceField": {"fieldType": "mtsdf", "distanceRange": RANGE},
          "kernings": [], "$comment": "RGB = MSDF (shader: median(r,g,b)), A = true SDF (outlines/glow). Metrics in atlas px at em 48. No kerning pairs (Fredoka ships GPOS only)."}
    json.dump(js, open(os.path.join(OUT, f"fredoka_{name}_mtsdf.json"), "w"), indent=0)
    print(name, W, H, sum(1 for g in gl if g[3] is not None), "glyphs")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for src in ("/workspace/assets/ui/fonts/OFL-Fredoka.txt",):
        open(os.path.join(OUT, "OFL-Fredoka.txt"), "w").write(open(src).read())
    build("regular", "wght=400&wdth=100", 400); build("bold", "wght=700&wdth=100", 700)
