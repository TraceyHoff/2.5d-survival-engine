"""Synthesized cozy SFX + seamless ambience loops (numpy only; FFT-domain filtering is circular -> perfect loops).
Writes WAV (44.1k mono 16-bit) + OGG (vorbis, via ffmpeg) and audio/manifest.json (engine SoundJson list)."""
import os, json, wave, subprocess, numpy as np
from atlas import ROOT
SR = 44100; A = os.path.join(ROOT, "audio")
rng = np.random.default_rng(42)

def t_(d): return np.arange(int(SR * d)) / SR
def env(n, a=0.005, d=0.2, curve=4.0):
    t = np.arange(n) / SR; e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / d * curve / 4)
    return e
def spec_filter(x, fn):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); return np.fft.irfft(X * fn(f), len(x))
def lp(x, fc, order=2): return spec_filter(x, lambda f: 1 / (1 + (f / fc) ** (2 * order)) ** 0.5)
def hp(x, fc, order=2): return spec_filter(x, lambda f: 1 - 1 / (1 + (f / max(fc, 1)) ** (2 * order)) ** 0.5)
def bp(x, fc, q=2.0): return spec_filter(x, lambda f: np.exp(-0.5 * (np.log2(np.maximum(f, 1) / fc) * q * 2) ** 2))
def formants(x, fs_, qs, gains):
    return spec_filter(x, lambda f: sum(g * np.exp(-0.5 * ((f - fc) / (fc / q)) ** 2) for fc, q, g in zip(fs_, qs, gains)))
def noise(n): return rng.standard_normal(n)
def pink(n): return spec_filter(noise(n), lambda f: 1 / np.sqrt(np.maximum(f, 20)))
def norm(x, peak=0.8): m = np.max(np.abs(x)) or 1; return x / m * peak
def fade_edges(x, ms=4):
    n = int(SR * ms / 1000); x = x.copy(); x[:n] *= np.linspace(0, 1, n); x[-n:] *= np.linspace(1, 0, n); return x

def write(rel, x, peak=0.8, loop=False):
    x = norm(x, peak) if not loop else x / (np.max(np.abs(x)) or 1) * peak
    if not loop: x = fade_edges(x)
    path = os.path.join(A, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
    wav = path.rsplit(".", 1)[0] + ".wav"
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "5", path], check=True)
    return rel

# ---------------------------------------------------------------- sfx
def footstep(v):
    n = int(SR * 0.16); x = lp(noise(n), 1800 + v * 300) * env(n, 0.003, 0.05)
    x += 0.6 * np.sin(2 * np.pi * (90 + v * 8) * t_(0.16)) * env(n, 0.002, 0.04)
    x += 0.25 * hp(noise(n), 4000) * env(n, 0.001, 0.02)   # grass rustle
    return x
def chop(v):
    n = int(SR * 0.32); t = t_(0.32)
    x = bp(noise(n), 900 + v * 120, 1.5) * env(n, 0.001, 0.05) * 1.4
    for f, d, g in [(170 + v * 10, 0.12, 0.9), (410 + v * 15, 0.07, 0.5), (760, 0.04, 0.3)]: x += g * np.sin(2 * np.pi * f * t) * env(n, 0.001, d)
    x += 0.5 * hp(noise(n), 3000) * env(n, 0.0005, 0.006)
    return x
def mine(v):
    n = int(SR * 0.5); t = t_(0.5)
    x = np.zeros(n)
    for f, d, g in [(1250, 0.22, 0.6), (2730, 0.12, 0.45), (4160, 0.07, 0.3), (5900, 0.04, 0.2)]: x += g * np.sin(2 * np.pi * f * (1 + v * 0.03) * t + rng.random() * 6) * env(n, 0.0005, d)
    x += 0.8 * lp(noise(n), 700) * env(n, 0.001, 0.05) + 0.4 * np.sin(2 * np.pi * 80 * t) * env(n, 0.001, 0.06)
    return x
def hit(v):
    n = int(SR * 0.2); t = t_(0.2); f = 320 * np.exp(-t * 14) + 110 + v * 15
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.09) + 0.5 * bp(noise(n), 1500, 1.0) * env(n, 0.0005, 0.02)
def groan(v):
    d = 1.1 + v * 0.15; n = int(SR * d); t = t_(d)
    f0 = (118 + v * 14) * (1 + 0.06 * np.sin(2 * np.pi * 5.5 * t)) * (1.08 - 0.18 * t / d + 0.08 * np.sin(np.pi * t / d))
    ph = np.cumsum(f0) / SR; saw = 2 * (ph % 1) - 1
    vow = formants(saw, [320 + v * 30, 800, 2400], [4, 6, 8], [1.0, 0.5, 0.15])
    e = np.minimum(1, t / 0.12) * np.minimum(1, (d - t) / 0.3)
    burble = 1 + 0.25 * np.sin(2 * np.pi * (9 + v) * t)
    return vow * e * burble + 0.05 * lp(noise(n), 600) * e
def pickup():
    x = np.zeros(int(SR * 0.22)); t = t_(0.22)
    for i, (f, st) in enumerate([(1046.5, 0.0), (1568, 0.06)]):
        n0 = int(st * SR); seg = t[: len(t) - n0]
        x[n0:] += np.sin(2 * np.pi * f * seg) * env(len(seg), 0.003, 0.08) * (0.8 if i else 1.0)
        x[n0:] += 0.2 * np.sin(2 * np.pi * f * 2 * seg) * env(len(seg), 0.003, 0.04)
    return x
def build_place(v):
    n = int(SR * 0.36); x = np.zeros(n)
    for st, f, g in [(0.0, 140, 1.0), (0.09 + v * 0.01, 220, 0.6), (0.16, 260, 0.45)]:
        n0 = int(st * SR); m = n - n0; tt = np.arange(m) / SR
        x[n0:] += g * (np.sin(2 * np.pi * f * tt) * env(m, 0.001, 0.05) + 0.6 * bp(noise(m), 1100, 1.4) * env(m, 0.0005, 0.02))
    return x
def ui_click():
    n = int(SR * 0.05); t = t_(0.05)
    return np.sin(2 * np.pi * 2200 * t) * env(n, 0.0005, 0.012) + 0.3 * hp(noise(n), 5000) * env(n, 0.0003, 0.004)

# ---------------------------------------------------------------- loops (circular -> seamless)
def campfire_loop(d=6.0):
    n = int(SR * d); x = 0.35 * lp(pink(n), 500)
    x *= 1 + 0.2 * np.sin(2 * np.pi * np.arange(n) / n * 3)
    for _ in range(int(d * 14)):
        p = rng.integers(0, n); L = rng.integers(60, 600); g = rng.uniform(0.2, 1.0) ** 2
        c = bp(noise(L), rng.uniform(1500, 5000), 1.2) * env(L, 0.0002, L / SR * 0.5) * g * 1.8
        idx = (p + np.arange(L)) % n; x[idx] += c
    return x
def rain_loop(d=8.0):
    n = int(SR * d); x = 0.6 * bp(pink(n), 2500, 0.6) + 0.2 * lp(pink(n), 400)
    for _ in range(int(d * 40)):
        p = rng.integers(0, n); L = rng.integers(80, 400)
        c = bp(noise(L), rng.uniform(2000, 7000), 2) * env(L, 0.0002, 0.003) * rng.uniform(0.1, 0.5)
        x[(p + np.arange(L)) % n] += c
    return x
def forest_loop(d=12.0):
    n = int(SR * d); t = np.arange(n) / SR
    wind = lp(pink(n), 700) * (0.6 + 0.4 * np.sin(2 * np.pi * t / d * 2 + 1)) * 0.5
    leaves = hp(pink(n), 3000) * (0.5 + 0.5 * np.sin(2 * np.pi * t / d * 3)) * 0.08
    x = wind + leaves
    for k in range(7):   # cute bird chirps
        st = rng.uniform(0, d); f0 = rng.uniform(2400, 3800)
        for j in range(rng.integers(2, 5)):
            L = int(SR * rng.uniform(0.05, 0.11)); tt = np.arange(L) / SR
            f = f0 * (1 + 0.35 * np.sin(np.pi * tt / (L / SR))) * (1 + 0.05 * j)
            c = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / (L / SR)) ** 2 * 0.12
            p = int((st + j * 0.14) * SR); x[(p + np.arange(L)) % n] += c
    return x

def main():
    S = []
    def add(key, files, cat, vol=0.8, jit=0.0, loop=False):
        S.append({"key": key, "files": files, "volume": vol, "pitchJitter": jit, "loop": loop, "category": cat})
    add("sfx_footstep", [write(f"sfx/footstep_{i}.ogg", footstep(i), 0.5) for i in range(1, 5)], "sfx", 0.45, 0.08)
    add("sfx_chop", [write(f"sfx/chop_{i}.ogg", chop(i), 0.85) for i in range(1, 4)], "sfx", 0.8, 0.1)
    add("sfx_mine", [write(f"sfx/mine_{i}.ogg", mine(i), 0.8) for i in range(1, 4)], "sfx", 0.75, 0.08)
    add("sfx_hit", [write(f"sfx/hit_{i}.ogg", hit(i), 0.85) for i in range(1, 3)], "sfx", 0.8, 0.12)
    add("sfx_zombie_groan", [write(f"sfx/zombie_groan_{i}.ogg", groan(i), 0.7) for i in range(1, 4)], "sfx", 0.6, 0.12)
    add("sfx_pickup", [write("sfx/pickup_1.ogg", pickup(), 0.7)], "sfx", 0.6, 0.05)
    add("sfx_build_place", [write(f"sfx/build_place_{i}.ogg", build_place(i), 0.85) for i in range(1, 3)], "sfx", 0.8, 0.06)
    add("ui_click", [write("ui/click.ogg", ui_click(), 0.6)], "ui", 0.6, 0.03)
    add("amb_campfire", [write("ambience/campfire_loop.ogg", campfire_loop(), 0.6, loop=True)], "ambience", 0.55, 0, {"start": 0.0, "end": 6.0})
    add("amb_rain", [write("ambience/rain_loop.ogg", rain_loop(), 0.6, loop=True)], "ambience", 0.5, 0, {"start": 0.0, "end": 8.0})
    add("amb_forest", [write("ambience/forest_loop.ogg", forest_loop(), 0.55, loop=True)], "ambience", 0.45, 0, {"start": 0.0, "end": 12.0})
    for s in S: s["files"] = ["audio/" + f for f in s["files"]]
    json.dump({"version": 1, "sampleRate": SR, "format": "ogg vorbis q5 mono (+ .wav masters)", "sounds": S}, open(os.path.join(A, "manifest.json"), "w"), indent=1)
    print(len(S), "sounds")

if __name__ == "__main__": main()
