"""SurVivaZ ambience & weather: cozy, slightly eerie beds (stereo) and one-shot critters."""
import numpy as np
from dsp import *  # noqa
from sfx import click, bubble, chime_note, voice, V, thump


def _st(rng, fn, n):
    """Decorrelated stereo pair from a mono generator."""
    return np.stack([fn(np.random.default_rng(rng.integers(1 << 30)), n) for _ in range(2)], 1)


def pan(x, p):
    p = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(p), x * np.sin(p)], 1)


def bird_call(rng, f=2800, dur=1.5):
    n = n_(dur)
    y = np.zeros(n)
    style = rng.integers(4)
    t = 0.0
    f = f * rng.uniform(0.75, 1.3)
    cnt = rng.integers(3, 8)
    for i in range(cnt):
        if t > dur - 0.15:
            break
        m = n_(rng.uniform(0.04, 0.12))
        if style == 0:
            fr = glide(f, f * 1.5, m, 0.5)
        elif style == 1:
            fr = glide(f * 1.4, f * 0.9, m, 1.5)
        elif style == 2:
            fr = f * (1 + 0.12 * np.sin(2 * np.pi * 30 * np.arange(m) / SR))
        else:
            fr = glide(f * (1 + 0.1 * i), f * (1.2 + 0.1 * i), m)
        place(y, (sine(fr) + 0.15 * sine(fr * 2)) * env_bell(m, 0.3, 1.2), t)
        t += m / SR + rng.uniform(0.03, 0.15)
    return y


def hoot(rng, dur, f):
    n = n_(dur)
    y = np.zeros(n)
    pattern = [(0, 0.25, 1.0), (0.35, 0.2, 0.97), (0.65, 0.45, 0.93)][: rng.integers(2, 4)]
    f = f * rng.uniform(0.9, 1.1)
    for at, L, r in pattern:
        m = n_(L)
        fr = glide(f * r * 1.03, f * r * 0.97, m)
        s = (sine(fr) + 0.1 * sine(fr * 2)) * env_bell(m, 0.3, 1.0) + bp(noise(rng, m), f * 0.8, f * 3) * env_bell(m, 0.3) * 0.05
        place(y, lp(s, 1500), at)
    return y


def crickets(rng, n, density=1.0):
    y = np.zeros(n)
    dur = n / SR
    for c in range(int(5 * density)):
        f = rng.uniform(3800, 5200)
        rate = rng.uniform(2.0, 3.5)
        g = rng.uniform(0.1, 0.4)
        t = rng.uniform(0, 1)
        while t < dur:
            m = n_(0.07)
            chirp = sine(f, m) * (0.5 + 0.5 * np.sin(2 * np.pi * 60 * np.arange(m) / SR)) * env_bell(m, 0.5)
            place(y, chirp * g, t)
            t += 1 / rate * rng.uniform(0.9, 1.1)
    return y


def frogs(rng, n):
    y = np.zeros(n)
    t = rng.uniform(0, 2)
    while t < n / SR:
        m = n_(0.12)
        f = rng.uniform(250, 400)
        ph = phase(np.full(m, f))
        s = lp(np.tanh(4 * np.sin(ph)) * (0.5 + 0.5 * np.sin(2 * np.pi * 40 * np.arange(m) / SR)), 1200) * env_bell(m, 0.3)
        place(y, s * 0.15, t)
        t += rng.uniform(0.6, 3.0)
    return y


def wind_bed(rng, n, f=600, q=1.0, slow=0.08):
    t = np.arange(n) / SR
    m = 0.5 + 0.5 * np.sin(2 * np.pi * slow * t + rng.uniform(0, 6)) * np.sin(2 * np.pi * slow * 2.3 * t + rng.uniform(0, 6))
    x = sweep_bp(pink(rng, n), f * (0.6 + 0.9 * m), q) * (0.4 + 0.6 * m)
    return x + lp(brown(rng, n), 200) * 0.3


def render_amb(key, rng, dur, f):
    """Returns (audio, is_stereo_loop)."""
    xf = 2.0
    L = n_(dur)
    n = L + n_(xf)
    if key == "amb.bird":
        return bird_call(rng, f, dur), False
    if key == "amb.owl":
        return hoot(rng, dur, f), False
    if key == "weather.thunder":
        y = np.zeros(L)
        for k in range(rng.integers(2, 5)):
            m = n_(rng.uniform(1.0, 2.5))
            r = sweep_lp(brown(rng, m) * 5, glide(rng.uniform(300, 600), 60, m, 0.5)) * env_ad(m, rng.uniform(0.05, 0.3), m / SR, 1.5)
            place(y, r * rng.uniform(0.4, 1), rng.uniform(0, dur * 0.4))
        y = lp(y, 800)
        return np.stack([y, lp(np.roll(y, n_(0.015)), 700)], 1), False
    if key.startswith("weather.rain"):
        indoor = key.endswith("indoor")
        def ch(r, n):
            bed = bp(pink(r, n), 400 if indoor else 800, 2500 if indoor else 8000) * 0.25
            drops = np.zeros(n)
            cnt = int(n / SR * (40 if indoor else 160))
            for _ in range(cnt):
                place(drops, click(r, 0.015, r.uniform(1500, 5000)) * r.uniform(0.05, 0.4), r.uniform(0, n / SR))
            if indoor:
                drops = lp(drops, 2000)
                for _ in range(int(n / SR * 3)):  # cozy drip on a wooden sill
                    place(drops, bubble(r, r.uniform(900, 1500), 0.05) * 0.2, r.uniform(0, n / SR))
            return bed + drops
        y = _st(rng, ch, n)
        return loop_xfade(y, L, n_(xf)), True
    if key in ("weather.wind", "weather.snow", "amb.day.rocky", "amb.day.beach"):
        par = {"weather.wind": (600, 1.2), "weather.snow": (1500, 2.0), "amb.day.rocky": (450, 3.0), "amb.day.beach": (500, 0.8)}[key]
        y = _st(rng, lambda r, n: wind_bed(r, n, *par), n)
        if key == "weather.snow":
            y *= 0.5
            for _ in range(int(dur * 0.4)):  # tiny twinkles
                at = rng.uniform(0, dur)
                place(y, pan(chime_note(rng, rng.choice([2093, 2349, 2637, 3136]), 1.5, 0.4) * 0.02, rng.uniform(-0.8, 0.8)), at)
        if key == "amb.day.beach":
            y = y * 0.5 + _waves(rng, n)
            for _ in range(int(dur / 4)):
                place(y, pan(bird_call(rng, 1800, 1.0) * 0.08, rng.uniform(-0.9, 0.9)), rng.uniform(0, dur))
        if key == "amb.day.rocky":
            for _ in range(int(dur / 5)):
                place(y, pan(bird_call(rng, 3500, 0.8) * 0.06, rng.uniform(-0.9, 0.9)), rng.uniform(0, dur))
        return loop_xfade(y, L, n_(xf)), True
    if key == "amb.water.shore":
        y = _waves(rng, n) + _st(rng, lambda r, n: lp(pink(r, n), 600) * 0.1, n)
        return loop_xfade(y, L, n_(xf)), True
    if key == "amb.indoor":
        y = _st(rng, lambda r, n: lp(brown(r, n), 180) * 0.5 + sine(60, n) * 0.004 + bp(pink(r, n), 200, 900) * 0.03, n)
        for _ in range(int(dur / 3)):  # house creaks / ticks
            place(y, pan(click(rng, 0.03, rng.uniform(400, 900)) * 0.05, rng.uniform(-0.7, 0.7)), rng.uniform(0, dur))
        return loop_xfade(y, L, n_(xf)), True
    if key.startswith("amb.day"):
        forest = "forest" in key
        y = _st(rng, lambda r, n: wind_bed(r, n, 2500, 0.7, 0.05) * 0.15 + bp(pink(r, n), 1500, 7000) * 0.02, n)
        cnt = int(dur * (0.9 if forest else 0.5))
        for _ in range(cnt):
            place(y, pan(bird_call(rng, rng.choice([2200, 2800, 3500, 4200])) * rng.uniform(0.05, 0.2), rng.uniform(-0.9, 0.9)), rng.uniform(0, dur))
        if forest:
            for _ in range(int(dur / 6)):  # woodpecker / far knock
                at = rng.uniform(0, dur - 1)
                for k in range(rng.integers(4, 9)):
                    place(y, pan(click(rng, 0.03, 700) * 0.06, -0.6), at + k * 0.07)
        return loop_xfade(y, L, n_(xf)), True
    if key.startswith("amb.night"):
        forest = "forest" in key
        y = _st(rng, lambda r, n: crickets(r, n, 1.4 if forest else 1.0) * 0.4 + lp(pink(r, n), 700) * 0.05, n)
        y += _st(rng, lambda r, n: frogs(r, n), n) * (0.7 if not forest else 0.4)
        for _ in range(int(dur / 10)):  # eerie-but-gentle soft hoots & breeze
            place(y, pan(hoot(rng, 1.5, 420) * 0.08, rng.uniform(-0.9, 0.9)), rng.uniform(0, dur - 1.5))
        return loop_xfade(y, L, n_(xf)), True
    if key == "amb.zombie_distant":
        from sfx import zombie
        z = zombie(rng, dur * 0.7, f * rng.uniform(1.0, 1.4), "idle")
        z = np.pad(z, (0, L - len(z)))
        z = lp(z, 900)
        z = reverb(z, rng, 0.8, 0.6, 1500, stereo=True)
        return z, False
    raise KeyError(key)


def _waves(rng, n):
    dur = n / SR
    y = np.zeros((n, 2))
    t = 0.0
    while t < dur:
        L = rng.uniform(4, 7)
        m = n_(L)
        e = env_ad(m, L * 0.45, L * 0.55, 1.5)
        w = sweep_lp(pink(rng, m), 300 + 2500 * e) * e * 0.35
        for _ in range(12):
            place(w, bubble(rng, rng.uniform(800, 2000), 0.04) * 0.04, rng.uniform(L * 0.4, L * 0.8))
        place(y, pan(w, rng.uniform(-0.4, 0.4)), t)
        t += L * rng.uniform(0.6, 0.8)
    return y
