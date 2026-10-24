"""SurVivaZ procedural music: a tiny seeded sequencer + synthesized cozy folk instruments.

Everything is synthesized here (Karplus-Strong ukulele/guitar/upright bass, modal music box, additive flute,
clarinet, tuba, accordion and soft percussion). No samples. Loops are rendered as whole bars and the reverb
/ ringing tail is folded back onto the start (dsp.loop_fold) so the loop seam is musically seamless.
Output: stereo float, normalized to -16 LUFS integrated with a peak limiter at -2 dBFS.
"""
import numpy as np
import pyloudnorm as pyln
from scipy.signal import fftconvolve
from dsp import *  # noqa

CEIL = 10 ** (-2.0 / 20)


def mf(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- instruments (mono)
def additive(f, n, amps, vib=(0.0, 0.0), rng=None, detune=0.0):
    t = np.arange(n) / SR
    fr = f * (1 + vib[1] * np.sin(2 * np.pi * vib[0] * t) * np.clip(t / 0.3, 0, 1)) * (1 + detune)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    y = np.zeros(n)
    for k, a in enumerate(amps, 1):
        if a and f * k < 16000:
            y += a * np.sin(k * ph)
    return y


def adsr(n, a, d, s, r, hold):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    e = np.where(t > hold, e * np.exp(-(t - hold) / max(r, 1e-4)), e)
    tail = np.clip((n - np.arange(n)) / (0.04 * SR), 0, 1)  # always land on zero, no cut-off clicks
    return e * tail


def uke(rng, f, dur, bright=0.45, vel=1.0):
    n = n_(dur + 1.2)
    y = ks_pluck(f, n, rng, bright, 0.9975 if f < 300 else 0.996, 0.18)
    y = lp(y, 5000) + 0.25 * bp(y, 180, 600)  # little wooden body
    return y * vel


def mbox(rng, f, dur, vel=1.0):
    n = n_(min(dur + 1.5, 3.0))
    y = modal([f, f * 2.0 * 1.003, f * 3.0 * 1.012, f * 5.4], [0.9, 0.35, 0.18, 0.06], [1, 0.25, 0.12, 0.05], n, rng, 0.0015)
    return y * np.minimum(1, np.arange(n) / (0.002 * SR)) * vel


def flute(rng, f, dur, vel=1.0):
    n = n_(dur + 0.25)
    y = additive(f, n, [1, 0.18, 0.07, 0.02], vib=(5.0, 0.006))
    br = bp(noise(rng, n), f * 0.9, f * 3) * 0.08
    return (y + br) * adsr(n, 0.06, 0.4, 0.8, 0.12, dur) * vel


def clarinet(rng, f, dur, vel=1.0):
    n = n_(dur + 0.2)
    y = lp(additive(f, n, [1, 0.02, 0.45, 0.02, 0.22, 0.01, 0.1], vib=(5.5, 0.004)), 3000)
    return y * adsr(n, 0.03, 0.3, 0.75, 0.08, dur) * vel


def pad(rng, freqs, dur, vel=1.0, bright=1500):
    n = n_(dur + 1.5)
    y = np.zeros(n)
    for f in freqs:
        for dt in (-0.004, 0.0, 0.005):
            y += additive(f, n, [1, 0.3, 0.12, 0.05], detune=dt, vib=(0.3 + rng.uniform(0, 0.4), 0.002))
    y = lp(y, bright) / (3 * max(1, len(freqs)))
    return y * adsr(n, 0.7, 1.0, 0.85, 0.7, dur) * vel


def bass(rng, f, dur, vel=1.0):
    n = n_(dur + 0.6)
    y = lp(ks_pluck(f, n, rng, 0.15, 0.998, 0.3), 900) + 0.5 * sine(f, n) * np.exp(-np.arange(n) / SR / 0.6)
    return y * adsr(n, 0.004, 1.0, 1.0, 0.15, dur) * vel


def tuba(rng, f, dur, vel=1.0):
    n = n_(dur + 0.15)
    y = lp(additive(f, n, [1, 0.6, 0.35, 0.2, 0.1, 0.05]), 700)
    return y * adsr(n, 0.02, 0.15, 0.6, 0.06, dur) * vel


def accordion(rng, freqs, dur, vel=1.0):
    n = n_(dur + 0.1)
    y = np.zeros(n)
    for f in freqs:
        for dt in (-0.003, 0.003):
            y += additive(f, n, [1 / k for k in range(1, 9)], detune=dt, vib=(6.0, 0.002))
    y = lp(y, 2600) / (2 * len(freqs))
    return y * adsr(n, 0.015, 0.1, 0.7, 0.04, dur) * vel


def kick(rng, vel=1.0):
    n = n_(0.25)
    return sine(glide(110, 48, n, 0.4)) * env_exp(n, 0.09, 0.003) * vel


def shaker(rng, vel=1.0):
    n = n_(0.06)
    return hp(noise(rng, n), 6000) * env_bell(n, 0.4, 2) * 0.35 * vel


def brush(rng, vel=1.0):
    n = n_(0.16)
    return bp(noise(rng, n), 1500, 6000) * env_exp(n, 0.05, 0.004) * 0.5 * vel


def block(rng, f=850, vel=1.0):
    n = n_(0.12)
    return modal([f, f * 2.7], [0.03, 0.012], [1, 0.3], n, rng, 0.02) * vel


def bell(rng, f, vel=1.0):  # eerie tuned bell for the night
    n = n_(4.0)
    y = modal([f, f * 2.76, f * 5.4, f * 0.5], [2.2, 0.9, 0.3, 2.5], [1, 0.35, 0.12, 0.25], n, rng, 0.001)
    return y * np.minimum(1, np.arange(n) / (0.004 * SR)) * vel


# ---------------------------------------------------------------- arranger
class Mix:
    def __init__(self, n):
        self.y = np.zeros((n, 2))

    def add(self, x, at, panv=0.0, gain=1.0):
        i = max(0, int(at * SR))
        if i >= len(self.y):
            return
        m = min(len(x), len(self.y) - i)
        l, r = np.cos((panv + 1) * np.pi / 4), np.sin((panv + 1) * np.pi / 4)
        self.y[i:i + m, 0] += x[:m] * l * gain * 1.414
        self.y[i:i + m, 1] += x[:m] * r * gain * 1.414


QUAL = {"M": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10], "M7": [0, 4, 7, 11], "dim": [0, 3, 6], "sus": [0, 5, 7]}
MAJ = [0, 2, 4, 5, 7, 9, 11]
MIN = [0, 2, 3, 5, 7, 8, 10]
HARM = [0, 2, 3, 5, 7, 8, 11]


def chord_notes(root, q, lo=55):
    ns = [root + i for i in QUAL[q]]
    return [x + 12 * int(np.ceil((lo - x) / 12)) if x < lo else x for x in ns]


def scale_notes(tonic, scale, lo, hi):
    return [m for m in range(lo, hi + 1) if (m - tonic) % 12 in scale]


def motif(rng, chords, tonic, scale, beats, lo=72, hi=88, density=0.6, rhythms=None):
    """Generate one phrase (list of (beat, midi, len_beats)) over the given chord list (one chord per bar)."""
    pool = scale_notes(tonic, scale, lo, hi)
    out = []
    cur = pool[len(pool) // 2]
    rhythms = rhythms or [[0, 1, 2, 3], [0, 1.5, 2, 3], [0, 2, 3], [0, 0.5, 1, 2, 3], [0, 1, 1.5, 2], [0, 2]]
    for b, (root, q) in enumerate(chords):
        rh = rhythms[rng.integers(len(rhythms))] if rng.random() < density + 0.3 else [0]
        rh = [x for x in rh if x < beats]
        tones = {(root + i) % 12 for i in QUAL[q]}
        for j, st in enumerate(rh):
            ln = (rh[j + 1] if j + 1 < len(rh) else beats) - st
            if st == 0 or rng.random() < 0.5:  # strong beats land on chord tones
                cands = [m for m in pool if m % 12 in tones and abs(m - cur) <= 7] or [cur]
            else:
                cands = [m for m in pool if 0 < abs(m - cur) <= 2] or [cur]
            cur = int(rng.choice(cands))
            out.append((b * beats + st, cur, ln))
    return out


def form(rng, prog, tonic, scale, beats, lo, hi, density=0.6, rhythms=None):
    """AABA-ish melody across the whole progression (prog length multiple of 8 not required)."""
    A = motif(rng, prog[:4], tonic, scale, beats, lo, hi, density, rhythms)
    B = motif(rng, prog[4:8] if len(prog) >= 8 else prog[:4], tonic, scale, beats, lo, hi, density, rhythms)
    mel = []
    blocks = (len(prog) + 3) // 4
    order = ["A", "A", "B", "A"]
    for k in range(blocks):
        src = A if order[k % 4] == "A" else B
        for (bt, m, ln) in src:
            if bt / beats + k * 4 < len(prog):
                mel.append((bt + k * 4 * beats, m, ln))
    return mel


def finish(mix, rng, L, size=1.6, wet=0.22, loop=True):
    y = mix.y
    n = n_(size)
    t = np.arange(n) / SR
    out = np.zeros((len(y) + n - 1, 2))
    for c in range(2):
        ir = lp(rng.standard_normal(n) * np.exp(-t / (size / 5)), 3500, 1)
        ir[: n_(0.012)] = 0  # predelay
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
        out[:, c] = fftconvolve(y[:, c], ir) * wet
    out[: len(y)] += y * (1 - wet * 0.5)
    out = np.stack([hp(out[:, 0], 35), hp(out[:, 1], 35)], 1)
    if loop:
        out = loop_fold(out, L)
    else:
        out = out[:L]
        out = np.stack([fade(out[:, 0], 0.001, 0.25), fade(out[:, 1], 0.001, 0.25)], 1)
    return loudness(np.asarray(out))


def limiter(x, ceil=CEIL, rel=0.08):
    a = np.abs(x).max(1)
    g = np.minimum(1, ceil / np.maximum(a, 1e-9))
    # lookahead-ish: spread each reduction 3 ms both sides, then smooth release
    w = n_(0.003)
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(g, 2 * w + 1)
    k = np.exp(-1 / (rel * SR))
    from scipy.signal import lfilter
    sm = 1 - lfilter([1 - k], [1, -k], 1 - g)  # smoothed gain reduction (attack via min filter)
    sm = np.minimum(sm, g)  # never above the instantaneous requirement
    return x * sm[:, None]


def loudness(y, target=-16.0):
    meter = pyln.Meter(SR)
    for _ in range(4):
        lu = meter.integrated_loudness(y)
        y = y * 10 ** ((target - lu) / 20)
        y = limiter(y)
    return np.clip(y, -CEIL, CEIL)


# ---------------------------------------------------------------- pieces
def grid(L_sec, bpm, beats):
    spb = 60.0 / bpm
    bars = int(round(L_sec / (spb * beats)))
    spb = L_sec / (bars * beats)  # exact fit so the loop length matches the spec
    return bars, spb


def cozy(rng, L, tonic, prog_cycle, lead="mbox", bpm=84, strum="uke", perc=True, pad_on=True):
    bars, spb = grid(L, bpm, 4)
    prog = [prog_cycle[i % len(prog_cycle)] for i in range(bars)]
    mix = Mix(n_(L) + SR * 4)
    hum = lambda: rng.uniform(-0.012, 0.012)  # noqa: E731 human timing
    for b, (root, q) in enumerate(prog):
        t0 = b * 4 * spb
        cn = chord_notes(root, q, 57 if strum == "uke" else 52)
        if strum == "uke":  # ukulele strums: D . D U . U D U
            for st, down, v in [(0, 1, 1.0), (1, 1, 0.7), (1.5, 0, 0.55), (2.5, 0, 0.5), (3, 1, 0.75), (3.5, 0, 0.5)]:
                notes = cn if down else cn[::-1]
                for j, m in enumerate(notes):
                    mix.add(uke(rng, mf(m), spb, 0.35 + 0.2 * v, 0.16 * v), t0 + st * spb + j * 0.012 + hum(), -0.25 + 0.15 * j)
        else:  # fingerpicked guitar arpeggio
            pat = [0, 2, 1, 2, 0, 2, 1, 3] if len(cn) > 3 else [0, 2, 1, 2, 0, 2, 1, 2]
            for k, idx in enumerate(pat):
                m = cn[idx % len(cn)] + (12 if idx == 3 and len(cn) <= 3 else 0)
                mix.add(uke(rng, mf(m - 12 if k == 0 else m), spb, 0.3, 0.22 if k % 4 == 0 else 0.15), t0 + k * 0.5 * spb + hum(), 0.3 - 0.1 * (k % 3))
        # bass on 1 and 3 (root, fifth)
        mix.add(bass(rng, mf(36 + (root % 12)), 1.6 * spb, 0.5), t0 + hum(), 0.0)
        mix.add(bass(rng, mf(36 + (root % 12) + 7), 1.6 * spb, 0.4), t0 + 2 * spb + hum(), 0.0)
        if pad_on and b % 2 == 0:
            mix.add(pad(rng, [mf(m) for m in chord_notes(root, q, 60)], 8 * spb - 0.6, 0.11), t0, 0.0)
        if perc:
            for k in range(8):
                mix.add(shaker(rng, 0.5 if k % 2 else 0.8), t0 + k * 0.5 * spb + hum(), 0.5)
            mix.add(kick(rng, 0.35), t0, 0)
            mix.add(kick(rng, 0.25), t0 + 2 * spb, 0)
            mix.add(brush(rng, 0.3), t0 + 1 * spb + hum(), -0.3)
            mix.add(brush(rng, 0.3), t0 + 3 * spb + hum(), -0.3)
    sc = MAJ
    mel = form(rng, prog, tonic, sc, 4, tonic + 12, tonic + 28, 0.55)
    inst = {"mbox": (mbox, 0.22, 0.2), "flute": (flute, 0.13, -0.2)}[lead]
    for i, (bt, m, ln) in enumerate(mel):
        # breathe: rest every 4th bar's second half on the A repeat, plus random rests
        if (bt // 4) % 8 == 7 and bt % 4 >= 2 or rng.random() < 0.08:
            continue
        mix.add(inst[0](rng, mf(m), ln * spb * 0.95, 1.0), bt * spb + hum(), inst[2], inst[1])
    # counter melody: music box doubles an octave up sparsely in second half of each 16 bars
    if lead == "flute":
        for (bt, m, ln) in mel:
            if (bt // 4) % 16 >= 8 and rng.random() < 0.4:
                mix.add(mbox(rng, mf(m + 12), ln * spb, 0.5), bt * spb, 0.4, 0.12)
    return finish(mix, rng, n_(L), 1.8, 0.2)


def night(rng, L, tonic, variant):
    bars, spb = grid(L, 66, 3)  # gentle waltz
    cyc = [(tonic, "m"), (tonic - 4, "M7"), (tonic + 5, "m7"), (tonic - 5, "sus")] if variant == 1 else \
          [(tonic, "m"), (tonic + 3, "M"), (tonic - 2, "M"), (tonic + 5, "m"), (tonic, "m"), (tonic + 8, "M7"), (tonic + 7, "7"), (tonic + 7, "sus")]
    prog = [cyc[(i // 2) % len(cyc)] for i in range(bars)]
    mix = Mix(n_(L) + SR * 6)
    for b, (root, q) in enumerate(prog):
        t0 = b * 3 * spb
        if b % 2 == 0:
            mix.add(pad(rng, [mf(m) for m in chord_notes(root, q, 52)], 6 * spb - 0.5, 0.16, 900), t0, 0.0)
            mix.add(bass(rng, mf(36 + root % 12), 2.5 * spb, 0.35), t0, 0)
        # soft plucked waltz arpeggio
        cn = chord_notes(root, q, 57)
        for k, m in enumerate([cn[0], cn[1], cn[2 % len(cn)]]):
            mix.add(uke(rng, mf(m), spb, 0.15, 0.08), t0 + k * spb + rng.uniform(-0.01, 0.02), -0.4 + 0.3 * k)
    mel = form(rng, prog, tonic, MIN if variant == 1 else HARM, 3, tonic + 12, tonic + 26, 0.35,
               [[0, 2], [0], [0, 1, 2], [0, 1.5]])
    for (bt, m, ln) in mel:
        if rng.random() < 0.12:
            continue
        mix.add(mbox(rng, mf(m), ln * spb, 1.0), bt * spb, 0.25, 0.2)
        if rng.random() < 0.25:  # ghostly flute echo, slightly flat
            mix.add(flute(rng, mf(m - 12) * 0.997, ln * spb, 1.0), bt * spb + 1.5 * spb, -0.4, 0.06)
    for _ in range(int(L / 9)):  # distant eerie bells
        at = rng.uniform(0, L)
        mix.add(bell(rng, mf(tonic + 24 + int(rng.choice([0, 3, 7, 6]))), 0.5), at, rng.uniform(-0.8, 0.8), 0.09)
    return finish(mix, rng, n_(L), 2.6, 0.32)


def polka(rng, L, tonic, high):
    bars, spb = grid(L, 150 if high else 126, 2)
    cyc = [(tonic, "m"), (tonic, "m"), (tonic + 7, "7"), (tonic + 7, "7"), (tonic + 7, "7"), (tonic + 7, "7"), (tonic, "m"), (tonic, "m"),
           (tonic + 5, "m"), (tonic + 5, "m"), (tonic, "m"), (tonic, "m"), (tonic + 7, "7"), (tonic + 7, "7"), (tonic, "m"), (tonic + 7, "7")]
    prog = [cyc[i % len(cyc)] for i in range(bars)]
    mix = Mix(n_(L) + SR * 3)
    for b, (root, q) in enumerate(prog):
        t0 = b * 2 * spb
        r = 36 + root % 12
        mix.add(tuba(rng, mf(r if b % 2 == 0 else r - 5), 0.45 * spb, 0.5), t0, 0)          # oom
        mix.add(accordion(rng, [mf(m) for m in chord_notes(root, q, 60)], 0.35 * spb, 0.3), t0 + spb, -0.2)  # pah
        if high:
            mix.add(accordion(rng, [mf(m) for m in chord_notes(root, q, 60)], 0.3 * spb, 0.2), t0 + 1.5 * spb, -0.2)
            if b % 4 == 3:  # walking pickup
                mix.add(tuba(rng, mf(r + 7), 0.4 * spb, 0.35), t0 + 0.5 * spb, 0)
        mix.add(block(rng, 900, 0.25), t0 + spb, 0.5)
        mix.add(kick(rng, 0.3), t0, 0)
        if high:
            mix.add(brush(rng, 0.35), t0 + spb, -0.4)
            mix.add(shaker(rng, 0.5), t0 + 0.5 * spb, 0.5)
            mix.add(shaker(rng, 0.5), t0 + 1.5 * spb, 0.5)
    rh = [[0, 0.5, 1, 1.5], [0, 1], [0, 0.5, 1], [0, 0.75, 1, 1.5]]
    mel = form(rng, prog, tonic, HARM, 2, tonic + 12, tonic + 26, 0.8 if high else 0.6, rh)
    for (bt, m, ln) in mel:
        stac = min(ln, 0.45) * spb  # bouncy, staccato
        mix.add(clarinet(rng, mf(m), stac, 1.0), bt * spb, 0.15, 0.17)
        if high:
            mix.add(uke(rng, mf(m + 12), stac, 0.5, 0.12), bt * spb, 0.45)
        elif rng.random() < 0.3:
            mix.add(mbox(rng, mf(m + 12), stac, 0.6), bt * spb, 0.45, 0.1)
    return finish(mix, rng, n_(L), 1.2, 0.15)


def stinger_death(rng, L):
    mix = Mix(n_(L) + SR * 2)
    # sad-goofy: three wobbly descending clarinet/tuba "wah"s then a long sagging one
    seq = [(62, 0.0, 0.42), (61, 0.5, 0.42), (60, 1.0, 0.42), (59, 1.5, 1.8)]
    for i, (m, at, d) in enumerate(seq):
        n = n_(d + 0.35)
        f = mf(m) * (glide(1, 0.94, n, 2) if i == 3 else 1)
        vib = (6.5, 0.02) if i == 3 else (5, 0.004)
        t = np.arange(n) / SR
        ff = f * (1 + vib[1] * np.sin(2 * np.pi * vib[0] * t) * np.clip(t / 0.3, 0, 1))
        ph = 2 * np.pi * np.cumsum(ff * np.ones(n)) / SR
        y = sum(a * np.sin(k * ph) for k, a in enumerate([1, 0.6, 0.45, 0.3, 0.2, 0.12, 0.06], 1))
        y = sweep_lp(y, np.linspace(500, 2200, n) if i < 3 else 500 + 1500 * np.exp(-t / 0.6))  # "wah" mute
        y = y * adsr(n, 0.03, 0.3, 0.8, 0.12, d)
        mix.add(y, at, 0, 0.35)
        mix.add(tuba(rng, mf(m - 24), d * 0.6, 0.3), at, 0)
    mix.add(block(rng, 700, 0.3), 3.45, 0.3)  # plonk
    return finish(mix, rng, n_(L), 1.4, 0.2, loop=False)


def stinger_dawn(rng, L):
    mix = Mix(n_(L) + SR * 2)
    t = 67  # G major sunrise
    arp = [t - 12, t - 5, t, t + 4, t + 7, t + 12, t + 16, t + 19, t + 24]
    for i, m in enumerate(arp):
        mix.add(mbox(rng, mf(m), 1.5, 1.0), 0.18 * i, -0.6 + 0.15 * i, 0.22)
        mix.add(uke(rng, mf(m), 1.0, 0.4, 0.12), 0.18 * i + 0.01, 0.6 - 0.15 * i)
    mix.add(pad(rng, [mf(x) for x in (t - 12, t - 5, t + 4, t + 7)], 4.2, 0.25, 2200), 0.0, 0)
    mix.add(flute(rng, mf(t + 12), 1.0, 1.0), 1.7, 0.1, 0.12)
    mix.add(flute(rng, mf(t + 14), 0.5, 1.0), 2.7, 0.1, 0.12)
    mix.add(flute(rng, mf(t + 19), 2.2, 1.0), 3.2, 0.1, 0.12)
    mix.add(bass(rng, mf(43), 4.5, 0.5), 0.0, 0)
    return finish(mix, rng, n_(L), 2.0, 0.25, loop=False)


def render(key, i, rng, dur):
    L = float(dur)
    if key == "music.menu":
        return cozy(rng, L, 65, [(65, "M"), (62, "m"), (70, "M"), (72, "M")], "mbox", 84, "uke")  # F major
    if key == "music.explore":
        if i == 1:
            return cozy(rng, L, 67, [(67, "M"), (64, "m"), (72, "M"), (74, "M"), (67, "M"), (72, "M"), (74, "sus"), (74, "7")], "flute", 88, "guitar")
        if i == 2:
            return cozy(rng, L, 62, [(62, "M"), (67, "M"), (59, "m"), (69, "7")], "mbox", 76, "uke", perc=False)
        return cozy(rng, L, 60, [(60, "M7"), (65, "M7"), (57, "m7"), (67, "7")], "flute", 80, "guitar", perc=True)
    if key == "music.night":
        return night(rng, L, 57 if i == 1 else 62, i)
    if key == "music.combat.low":
        return polka(rng, L, 62, False)
    if key == "music.combat.high":
        return polka(rng, L, 64, True)
    if key == "music.stinger.death":
        return stinger_death(rng, L)
    if key == "music.stinger.dawn":
        return stinger_dawn(rng, L)
    raise KeyError(key)
