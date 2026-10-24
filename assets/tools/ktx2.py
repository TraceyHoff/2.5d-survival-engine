"""Encode KTX2/Basis siblings for atlas pages and record them in the manifest (optional, non-breaking fields).
  colour pages (atlas image + scale pages) -> ETC1S (basis-lz), sRGB
  masks: tintmask -> UASTC linear, emissive -> UASTC sRGB, other masks -> UASTC linear
Fields: atlas.ktx2 (scale-1 image), pages[i].ktx2, atlas.masksKtx2.{tintmask,emissive,...}. PNG stays the source of truth.
Usage: python3 ktx2.py <manifest.json>... [--report out.json]   (needs KTX-Software `toktx` >= 4.3)"""
import sys, os, json, subprocess
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
args = sys.argv[1:]; rep = None
if "--report" in args: i = args.index("--report"); rep = args[i + 1]; del args[i:i + 2]
def kpath(p): return os.path.splitext(p)[0] + ".ktx2"
def enc(job):
    src, dst, mode, oetf = job
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src): return
    cmd = ["toktx", "--t2", "--assign_oetf", oetf]
    cmd += ["--encode", "etc1s", "--clevel", "2", "--qlevel", "192"] if mode == "etc1s" else ["--encode", "uastc", "--uastc_quality", "2", "--uastc_rdo_l", "0.5", "--zcmp", "19"]
    subprocess.run(cmd + [dst, src], check=True, capture_output=True)
stats = {}; orig_nl = {}
for mf in args:
    orig_nl[mf] = open(mf).read().endswith("\n"); base = os.path.dirname(mf); m = json.load(open(mf)); jobs = []; st = {"pages": 0, "png_bytes": 0, "ktx2_bytes": 0, "vram_rgba8": 0, "vram_gpu_compressed": 0, "dpr1_rgba8": 0, "dpr1_compressed": 0, "dpr2_rgba8": 0, "dpr2_compressed": 0}
    for a in m["atlases"]:
        a["ktx2"] = kpath(a["image"]); jobs.append((a["image"], a["ktx2"], "etc1s", "srgb"))
        for pg in a.get("pages", []): pg["ktx2"] = kpath(pg["image"]); jobs.append((pg["image"], pg["ktx2"], "etc1s", "srgb"))
        mk = {}
        for k, v in (a.get("masks") or {}).items():
            if isinstance(v, str): mk[k] = kpath(v); jobs.append((v, mk[k], "uastc", "srgb" if k == "emissive" else "linear"))
        if mk: a["masksKtx2"] = mk
        # VRAM: RGBA8 = 4 B/px; ETC1S->ETC2 RGBA / BC7 and UASTC->ASTC4x4 / BC7 = 1 B/px (no mips)
        def px(p): w, h = Image.open(os.path.join(base, p)).size; return w * h
        p1 = px(a["image"]); hi = [(pg["scale"], px(pg["image"])) for pg in a.get("pages", [])]; mpx = sum(px(v) for v in (a.get("masks") or {}).values() if isinstance(v, str))
        tot = p1 + sum(x for _, x in hi) + mpx; st["vram_rgba8"] += 4 * tot; st["vram_gpu_compressed"] += tot
        d2 = next((x for s, x in sorted(hi) if s >= 2), max([p1] + [x for _, x in hi]))
        st["dpr1_rgba8"] += 4 * (p1 + mpx); st["dpr1_compressed"] += p1 + mpx; st["dpr2_rgba8"] += 4 * (d2 + mpx); st["dpr2_compressed"] += d2 + mpx
    jobs = [(os.path.join(base, s), os.path.join(base, d), mo, oe) for s, d, mo, oe in jobs]
    with ThreadPoolExecutor(os.cpu_count()) as ex: list(ex.map(enc, jobs))
    st["pages"] = len(jobs); st["png_bytes"] = sum(os.path.getsize(s) for s, *_ in jobs); st["ktx2_bytes"] = sum(os.path.getsize(d) for _, d, *_ in jobs)
    pretty = open(mf).read(3).startswith("{\n")  # keep each manifest's existing formatting
    with open(mf, "w") as fh: json.dump(m, fh, indent=1) if pretty else json.dump(m, fh, separators=(",", ":"))
    if pretty: open(mf, "a").write("\n") if open(mf).read()[-1:] != "\n" and orig_nl.get(mf) else None
    stats[mf] = st
    print(mf, {k: (f"{v / 2**20:.1f} MiB" if k != "pages" else v) for k, v in st.items()})
if rep: json.dump(stats, open(rep, "w"), indent=1)
