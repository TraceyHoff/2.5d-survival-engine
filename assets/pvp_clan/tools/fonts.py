"""MSDF font atlases (msdfgen via msdf-bmfont-xml) for damage numbers (Fredoka 700) and nameplates (Nunito 800).
Reuses the UI kit's OFL fonts (assets/ui/fonts). Static instances are cut with fontTools (OFL permits modified versions)."""
import os, json, shutil, subprocess
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from common import ROOT
UIF = "/workspace/assets/ui/fonts"; OUT = os.path.join(ROOT, "fonts")
MSDF = "/workspace/pvp_tmp/node_modules/.bin/msdf-bmfont"
SETS = {
    "damage": {"src": "Fredoka.ttf", "axes": {"wght": 700, "wdth": 100}, "lic": "OFL-Fredoka.txt", "size": 48, "range": 6, "tex": "512,512",
               "chars": "0123456789+-x×!?.,:%/ ABCDEFGHIJKLMNOPQRSTUVWXYZ★♥"},
    "nameplate": {"src": "Nunito.ttf", "axes": {"wght": 800}, "lic": "OFL-Nunito.txt", "size": 36, "range": 5, "tex": "1024,1024",
                  "chars": "".join(chr(c) for c in range(32, 127)) + "ÀÁÂÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÖØÙÚÛÜÝàáâäåçèéêëìíîïñòóôöøùúûüýÿßæœ¡¿«»·•…★♥♪"},
}
def build():
    os.makedirs(OUT, exist_ok=True); res = {}
    for key, c in SETS.items():
        f = TTFont(os.path.join(UIF, c["src"]))
        inst = instancer.instantiateVariableFont(f, c["axes"]) if "fvar" in f else f
        for rec in inst["name"].names:
            if rec.nameID in (1, 4, 6, 16):
                try: rec.string = rec.toUnicode() + (" PvpClan" if rec.nameID != 6 else "-PvpClan")
                except Exception: pass
        ttf = os.path.join(OUT, f"{key}_{os.path.splitext(c['src'])[0]}.ttf"); inst.save(ttf)
        shutil.copy(os.path.join(UIF, c["lic"]), OUT)
        cmap = TTFont(ttf).getBestCmap(); chars = "".join(ch for ch in c["chars"] if ord(ch) in cmap or ch == " ")
        cs = os.path.join(OUT, f"{key}_charset.txt"); open(cs, "w", encoding="utf-8").write(chars)
        base = os.path.join(OUT, f"font_{key}")
        r = subprocess.run([MSDF, "-f", "json", "-o", base, "-s", str(c["size"]), "-r", str(c["range"]), "-m", c["tex"], "-p", "2", "-b", "2",
                            "-t", "msdf", "-i", cs, ttf], capture_output=True, text=True, timeout=600)
        if r.returncode: print(r.stdout[-2000:], r.stderr[-2000:])
        # normalize file names: msdf-bmfont names the json after the face; move to font_<key>.json
        js = [p for p in os.listdir(OUT) if p.endswith(".json") and p.startswith(f"{key}_")]
        for p in js: shutil.move(os.path.join(OUT, p), base + ".json")
        missing = [ch for ch in c["chars"] if ord(ch) not in cmap and ch != " "]
        res[key] = {"ttf": os.path.basename(ttf), "json": f"font_{key}.json", "missing": missing}
        print(key, r.returncode, os.listdir(OUT))
    return res
if __name__ == "__main__": print(build())
