"""Procedural vehicle SFX -> ogg (vorbis, mono 44.1k)."""
import sys, os, wave, subprocess, numpy as np
SR = 44100; rng = np.random.default_rng(7)
def t_(d): return np.arange(int(SR * d)) / SR
def sf(x, fn): X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); return np.fft.irfft(X * fn(f), len(x))
def lp(x, fc, o=2): return sf(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * o)))
def hp(x, fc, o=2): return sf(x, lambda f: 1 - 1 / np.sqrt(1 + (f / fc) ** (2 * o)))
def bp(x, fc, q=2.0): return sf(x, lambda f: np.exp(-0.5 * (np.log2(np.maximum(f, 1) / fc) * q * 2) ** 2))
def noise(n): return rng.standard_normal(n)
def norm(x, p=0.8): return x / (np.max(np.abs(x)) or 1) * p
def fade(x, a=0.004, b=0.02): n = len(x); x = x.copy(); ia, ib = int(a * SR), int(b * SR); x[:ia] *= np.linspace(0, 1, ia); x[-ib:] *= np.linspace(1, 0, ib); return x
def engine(f0, dur, rough=0.4, cyl=4):
    t = t_(dur) if np.isscalar(f0) else np.arange(len(f0)) / SR; f = f0; ph = 2 * np.pi * np.cumsum(np.broadcast_to(f, t.shape)) / SR
    pulses = sum((1 / (k)) * np.sin(k * ph + rng.random() * 6) for k in range(1, 9))
    fire = (np.sin(ph * cyl / 2) > 0.2) * 1.0
    x = pulses * (0.6 + 0.4 * fire) + rough * lp(noise(len(t)), 900) * (0.5 + fire)
    return lp(x, 1400)
def engine_start():
    d = 1.6; t = t_(d)
    crank = np.zeros_like(t); n1 = int(0.7 * SR)
    cf = 9 + 3 * np.sin(2 * np.pi * 1.3 * t[:n1]); crank[:n1] = lp(noise(n1), 500) * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(cf) / SR)) ** 2
    rev = np.concatenate([np.zeros(n1), engine(np.interp(t[n1:], [0.7, 0.95, 1.6], [30, 70, 34]), d - 0.7)])
    env = np.concatenate([np.zeros(n1), np.minimum(1, (t[n1:] - 0.7) / 0.05)])
    return fade(crank * 0.9 + rev * env * 0.8)
def engine_idle(f0=32, rough=0.35, cyl=4):
    d = 2.0; x = engine(f0 + 0.6 * np.sin(2 * np.pi * 0.5 * t_(d)), d, rough, cyl)
    # seamless loop: crossfade tail into head
    n = int(0.15 * SR); w = np.linspace(0, 1, n); y = x[:len(x) - n].copy(); y[:n] = y[:n] * w + x[-n:] * (1 - w); return y
def bell():
    t = t_(1.4); x = np.zeros_like(t)
    for start in (0, 0.18):
        tt = np.clip(t - start, 0, None); on = t >= start
        for fr, a, dec in ((2350, 1, 3.5), (5120, 0.5, 6), (7600, 0.25, 9), (3010, 0.35, 4.5)):
            x += on * a * np.sin(2 * np.pi * fr * tt) * np.exp(-dec * tt)
    return fade(x, 0.001)
def horn(freqs=(415, 523), d=0.7, buzz=0.5):
    t = t_(d); x = sum(np.sign(np.sin(2 * np.pi * f * t)) * 0.6 + np.sin(2 * np.pi * f * t) for f in freqs)
    x = bp(x, 900, 0.8) * (1 - buzz) + lp(x, 2500) * buzz; return fade(x, 0.01, 0.05)
def crash():
    d = 1.5; t = t_(d); x = lp(noise(len(t)), 3000) * np.exp(-t * 6) + 0.8 * bp(noise(len(t)), 120, 1) * np.exp(-t * 4)
    for k in range(14):  # metallic clatters + glass tinkles
        s = int(rng.uniform(0.02, 1.0) * SR); n = int(0.25 * SR); tt = t_(0.25); f = rng.uniform(400, 4500)
        seg = np.sin(2 * np.pi * f * tt) * np.exp(-tt * rng.uniform(15, 40)) * rng.uniform(0.15, 0.5)
        x[s:s + n] += seg[:len(x[s:s + n])]
    return fade(x, 0.001)
def door():
    d = 0.5; t = t_(d); x = bp(noise(len(t)), 180, 1.2) * np.exp(-t * 18) + 0.3 * bp(noise(len(t)), 1800, 2) * np.exp(-t * 30)
    x += 0.5 * np.sin(2 * np.pi * 95 * t) * np.exp(-t * 20); return fade(x, 0.001)
def hitch():
    d = 0.45; t = t_(d); x = np.zeros_like(t)
    for s0, f in ((0.0, 1900), (0.12, 1400)):
        tt = np.clip(t - s0, 0, None); x += (t >= s0) * (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 2.7 * tt)) * np.exp(-tt * 28)
    return fade(x + 0.2 * hp(noise(len(t)), 3000) * np.exp(-t * 40), 0.001)
SOUNDS = {"sfx_vehicle_engine_start": (engine_start, 0.7, 0.05, False), "sfx_vehicle_engine_idle": (engine_idle, 0.45, 0.0, True),
          "sfx_vehicle_engine_idle_diesel": (lambda: engine_idle(22, 0.6, 6), 0.5, 0.0, True), "sfx_vehicle_bike_bell": (bell, 0.6, 0.04, False),
          "sfx_vehicle_horn": (horn, 0.7, 0.02, False), "sfx_vehicle_horn_truck": (lambda: horn((185, 233, 277), 1.1, 0.7), 0.8, 0.02, False),
          "sfx_vehicle_crash": (crash, 0.85, 0.1, False), "sfx_vehicle_door": (door, 0.6, 0.08, False), "sfx_vehicle_hitch": (hitch, 0.55, 0.06, False)}
def build(OUT):
    os.makedirs(OUT + "/audio", exist_ok=True); entries = []
    for key, (fn, vol, pj, loop) in SOUNDS.items():
        x = norm(fn(), 0.85); pcm = (x * 32767).astype(np.int16); wp = f"/tmp/{key}.wav"
        with wave.open(wp, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wp, "-c:a", "libvorbis", "-q:a", "4", f"{OUT}/audio/{key}.ogg"], check=True)
        entries.append({"key": key, "files": [f"vehicles/audio/{key}.ogg"], "volume": vol, "pitchJitter": pj, "loop": loop, "category": "sfx"})
    return entries
if __name__ == "__main__":
    import json; e = build(sys.argv[1]); json.dump(e, open(sys.argv[1] + "/_sounds_part.json", "w")); print(len(e))
