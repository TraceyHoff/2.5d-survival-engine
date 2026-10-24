#!/usr/bin/env python3
"""Verify delivered audio: format, channels, decoded peak, loudness (music), loop seam continuity, sizes."""
import glob, json, os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import build as B

def decode(path, ch):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", str(ch), "-ar", "48000", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch)

def probe(path):
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path], capture_output=True).stdout)
    s = j["streams"][0]
    return s["codec_name"], int(s["channels"]), int(s["sample_rate"]), float(j["format"]["duration"]), int(j["format"].get("bit_rate", 0))

def main(group="all"):
    import pyloudnorm as pyln
    rows = B.table(); bad = []; done = 0; total = 0; size = 0
    for r in rows:
        if r["key"] == "music.stinger.dawn": r["bus"] = "music"
        if group != "all" and B.group_of(r["key"], r["bus"]) != group: continue
        d = "music" if r["bus"] == "music" else B.DIRS[r["bus"]]
        for i in range(1, r["variants"] + 1):
            total += 1
            base = os.path.join(B.OUT, d, r["key"].replace(".", "_") + f"_{i}")
            if not (os.path.exists(base + ".ogg") and os.path.exists(base + ".m4a")):
                bad.append(f"missing {base}"); continue
            done += 1; size += os.path.getsize(base + ".ogg") + os.path.getsize(base + ".m4a")
            c, ch, sr, dur, br = probe(base + ".ogg")
            want_ch = 2 if (r["bus"] == "music" or (r["loop"] and r["bus"] == "ambient")) else 1
            if c != "opus" or sr != 48000 or ch != want_ch: bad.append(f"{base}.ogg fmt {c} {ch}ch {sr}")
            x = decode(base + ".ogg", ch)
            pk = 20 * np.log10(np.abs(x).max() + 1e-12)
            if r["bus"] != "music" and pk > -0.9: bad.append(f"{base}.ogg peak {pk:.2f}")
            if not np.isfinite(x).all() or pk < -40: bad.append(f"{base}.ogg silent/nan {pk:.1f}")
            if r["bus"] == "music":
                lu = pyln.Meter(48000).integrated_loudness(x.astype(float))
                if abs(lu + 16) > 1.0: bad.append(f"{base}.ogg LUFS {lu:.1f}")
            if r["loop"]:
                dif = np.abs(np.diff(x, axis=0)).mean(0).max() + 1e-9
                seam = np.abs(x[0] - x[-1]).max()
                if seam > max(6 * dif, 0.02): bad.append(f"{base}.ogg loop seam {seam:.4f} vs mean step {dif:.4f}")
    print(f"{group}: {done}/{total} recordings present, {size/1e6:.2f} MB (ogg+m4a)")
    for b in bad: print("  !", b)
    return not bad

if __name__ == "__main__":
    sys.exit(0 if main(sys.argv[1] if len(sys.argv) > 1 else "all") else 1)
