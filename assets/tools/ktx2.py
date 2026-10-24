"""Encode KTX2/Basis siblings for atlas pages and record them in the manifest (optional, non-breaking fields).
  colour pages (atlas image + scale pages) -> ETC1S (basis-lz), sRGB
  masks: tintmask -> UASTC linear, emissive -> UASTC sRGB, other masks -> UASTC linear
Fields: atlas.ktx2 (scale-1 image), pages[i].ktx2, atlas.masksKtx2.{tintmask,emissive,...}, pages[i].masksKtx2 (`<mask>@Nx`). PNG stays the source of truth.
Mips: every file carries a full mip chain (toktx --genmipmap). Colour pages with alpha are first "dilated": transparent
texels get the colour of the nearest opaque art (push-pull fill, alpha untouched) so box-filtered mips and bilinear
taps don't pull black into edges (dark halos). Files are re-encoded when the PNG is newer or the KTX2 has no mips.
Usage: python3 ktx2.py <manifest.json>... [--report out.json] [--force]   (needs KTX-Software `toktx` >= 4.3)"""
import sys, os, json, struct, subprocess, tempfile
import numpy as np
import re
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
args = sys.argv[1:]; rep = None
if "--report" in args: i = args.index("--report"); rep = args[i + 1]; del args[i:i + 2]
force = "--force" in args; args = [a for a in args if a != "--force"]
def levels(p):
    with open(p, "rb") as fh: h = fh.read(44)
    return struct.unpack_from("<I", h, 40)[0] if len(h) >= 44 else 0
def dilate(im):
    """Push-pull fill of RGB under alpha == 0 (alpha kept): each empty texel takes the coverage-weighted colour of the
    nearest art at the coarsest pyramid level that has any, so mip averaging never mixes in black."""
    a = np.asarray(im, dtype=np.float32); rgb, al = a[..., :3], a[..., 3]
    w = (al > 0).astype(np.float32)
    if w.all() or not w.any(): return im
    pyr = [(rgb * w[..., None], w)]
    while min(pyr[-1][1].shape) > 1:
        c, ww = pyr[-1]; H, W = ww.shape; H2, W2 = (H + 1) // 2, (W + 1) // 2
        cp = np.zeros((H2 * 2, W2 * 2, 3), np.float32); cp[:H, :W] = c; wp = np.zeros((H2 * 2, W2 * 2), np.float32); wp[:H, :W] = ww
        pyr.append((cp.reshape(H2, 2, W2, 2, 3).sum((1, 3)), wp.reshape(H2, 2, W2, 2).sum((1, 3))))
    c, ww = pyr[-1]; col = c / np.maximum(ww, 1e-6)[..., None]
    for c, ww in reversed(pyr[:-1]):
        H, W = ww.shape; up = np.repeat(np.repeat(col, 2, 0), 2, 1)[:H, :W]
        col = np.where(ww[..., None] > 0, c / np.maximum(ww, 1e-6)[..., None], up)
    out = a.copy(); hole = al == 0; out[..., :3][hole] = col[hole]
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGBA")
# bodies are NOT dilated: ART_body_4px_packing.md requires RGB=0 under alpha=0 in their >=2px cell borders
def kpath(p): return os.path.splitext(p)[0] + ".ktx2"
def enc(job):
    src, dst, mode, oetf = job
    if not force and os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src) and levels(dst) > 1: return
    im = Image.open(src); tmp = None
    if mode == "etc1s" and not os.path.basename(src).startswith("body_") and (im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)):
        fd, tmp = tempfile.mkstemp(suffix=".png"); os.close(fd); dilate(im.convert("RGBA")).save(tmp, compress_level=1); src = tmp
    cmd = ["toktx", "--t2", "--genmipmap", "--assign_oetf", oetf]
    cmd += ["--encode", "etc1s", "--clevel", "2", "--qlevel", "192"] if mode == "etc1s" else ["--encode", "uastc", "--uastc_quality", "2", "--uastc_rdo_l", "0.5", "--zcmp", "19"]
    try: subprocess.run(cmd + [dst, src], check=True, capture_output=True)
    finally:
        if tmp: os.remove(tmp)
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
        for pg in a.get("pages", []):  # `<mask>@<scale>x` variants -> pages[i].masksKtx2 (non-breaking field)
            pk = {}
            for k, v in (a.get("masks") or {}).items():
                if not isinstance(v, str): continue
                mv = re.sub(r"(\.[a-z]+)$", f"@{pg['scale']}x\\1", v)
                if os.path.exists(os.path.join(base, mv)): pk[k] = kpath(mv); jobs.append((mv, pk[k], "uastc", "srgb" if k == "emissive" else "linear"))
            if pk: pg["masksKtx2"] = pk
            else: pg.pop("masksKtx2", None)
        # VRAM: RGBA8 = 4 B/px; ETC1S->ETC2 RGBA / BC7 and UASTC->ASTC4x4 / BC7 = 1 B/px; full mip chain = x4/3
        def px(p): w, h = Image.open(os.path.join(base, p)).size; return w * h * 4 / 3
        p1 = px(a["image"]); hi = [(pg["scale"], px(pg["image"])) for pg in a.get("pages", [])]; mpx = sum(px(v) for v in (a.get("masks") or {}).values() if isinstance(v, str))
        tot = p1 + sum(x for _, x in hi) + mpx; st["vram_rgba8"] += 4 * tot; st["vram_gpu_compressed"] += tot
        d2 = next((x for s, x in sorted(hi) if s >= 2), max([p1] + [x for _, x in hi]))
        st["dpr1_rgba8"] += 4 * (p1 + mpx); st["dpr1_compressed"] += p1 + mpx; st["dpr2_rgba8"] += 4 * (d2 + mpx); st["dpr2_compressed"] += d2 + mpx
    jobs = [(os.path.join(base, s), os.path.join(base, d), mo, oe) for s, d, mo, oe in jobs]
    with ThreadPoolExecutor(os.cpu_count()) as ex: list(ex.map(enc, jobs))
    st["pages"] = len(jobs); st["png_bytes"] = sum(os.path.getsize(s) for s, *_ in jobs); st["ktx2_bytes"] = sum(os.path.getsize(d) for _, d, *_ in jobs)
    pretty = open(mf).read(3).startswith("{\n")  # keep each manifest's existing formatting
    ind = (len(open(mf).read(64).split("\n")[1]) - len(open(mf).read(64).split("\n")[1].lstrip(" "))) or 1 if pretty else 1
    with open(mf, "w") as fh: json.dump(m, fh, indent=ind) if pretty else json.dump(m, fh, separators=(",", ":"))
    if pretty: open(mf, "a").write("\n") if open(mf).read()[-1:] != "\n" and orig_nl.get(mf) else None
    stats[mf] = st
    for k in st:
        if k != "pages": st[k] = round(st[k])
    print(mf, {k: (f"{v / 2**20:.1f} MiB" if k != "pages" else v) for k, v in st.items()})
if rep: json.dump(stats, open(rep, "w"), indent=1)
