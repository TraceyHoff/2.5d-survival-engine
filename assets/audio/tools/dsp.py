"""SurVivaZ procedural audio: DSP primitives (numpy/scipy only, no samples). 48 kHz float64."""
import numpy as np
from scipy import signal

SR = 48000


class Sig(np.ndarray):
    """ndarray whose +/- pad the shorter operand with silence (and * truncates), so layers of different
    lengths mix naturally."""
    def _fit(self, o, pad):
        if isinstance(o, np.ndarray) and o.ndim >= 1 and self.ndim >= 1 and o.shape[0] != self.shape[0] and o.ndim == self.ndim:
            a, b = np.asarray(self), np.asarray(o)
            if pad:
                m = max(len(a), len(b))
                a = np.pad(a, [(0, m - len(a))] + [(0, 0)] * (a.ndim - 1))
                b = np.pad(b, [(0, m - len(b))] + [(0, 0)] * (b.ndim - 1))
            else:
                m = min(len(a), len(b)); a, b = a[:m], b[:m]
            return a.view(Sig), b
        return self, o
    def __add__(self, o):
        a, b = self._fit(o, True); return np.add(np.asarray(a), b).view(Sig)
    __radd__ = __add__
    def __iadd__(self, o):
        return self.__add__(o)
    def __sub__(self, o):
        a, b = self._fit(o, True); return np.subtract(np.asarray(a), b).view(Sig)
    def __isub__(self, o):
        return self.__sub__(o)
    def __mul__(self, o):
        a, b = self._fit(o, False); return np.multiply(np.asarray(a), b).view(Sig)
    __rmul__ = __mul__
    def __imul__(self, o):
        return self.__mul__(o)


def S_(x):
    return np.asarray(x, float).view(Sig)


def T(sec):
    return np.arange(int(round(sec * SR))) / SR


def n_(sec):
    return int(round(sec * SR))


def noise(rng, n):
    return S_(rng.standard_normal(n))


def pink(rng, n):
    w = rng.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return S_(signal.lfilter(b, a, w) * 4)


def brown(rng, n):
    x = np.cumsum(rng.standard_normal(n))
    x = signal.sosfilt(signal.butter(1, 20, "hp", fs=SR, output="sos"), x)
    return S_(x / (np.std(x) + 1e-9) * 0.3)


def _sos(kind, f, order=2):
    f = np.clip(np.atleast_1d(f), 10, SR / 2 - 100)
    return signal.butter(order, f if len(f) > 1 else f[0], kind, fs=SR, output="sos")


def lp(x, f, order=2):
    return S_(signal.sosfilt(_sos("lowpass", f, order), x))


def hp(x, f, order=2):
    return S_(signal.sosfilt(_sos("highpass", f, order), x))


def bp(x, lo, hi, order=2):
    lo, hi = max(lo, 20), min(hi, SR / 2 - 200)
    if hi <= lo * 1.05:
        hi = lo * 1.1
    return S_(signal.sosfilt(_sos("bandpass", [lo, hi], order), x))


def reson(x, f, q):
    """Resonant 2-pole bandpass at f with quality q."""
    b, a = signal.iirpeak(min(max(f, 30), SR / 2 - 500), q, fs=SR)
    return S_(signal.lfilter(b, a, x))


def sweep_bp(x, f, q=4.0):
    """Time-varying state-variable bandpass (f may be an array). Block-wise to stay fast."""
    f = np.broadcast_to(np.asarray(f, float), x.shape)
    y = np.zeros_like(x)
    low = band = 0.0
    blk = 32
    damp = 1.0 / q
    for i in range(0, len(x), blk):
        fc = min(f[i], SR / 6)
        g = 2 * np.sin(np.pi * fc / SR)
        seg = x[i:i + blk]
        out = np.empty_like(seg)
        for j, v in enumerate(seg):
            high = v - low - damp * band
            band += g * high
            low += g * band
            out[j] = band
        y[i:i + blk] = out
    return S_(y)


def sweep_lp(x, f):
    """One-pole lowpass with time-varying cutoff (vectorised per 64-sample block)."""
    f = np.broadcast_to(np.asarray(f, float), x.shape)
    y = np.zeros_like(x)
    z = np.zeros(1)
    blk = 64
    for i in range(0, len(x), blk):
        a = np.exp(-2 * np.pi * min(f[i], SR / 2.2) / SR)
        seg, z = signal.lfilter([1 - a], [1, -a], x[i:i + blk], zi=z * 1.0 if z.shape == (1,) else z)
        y[i:i + blk] = seg
    return S_(y)


def env_exp(n, tau, att=0.002):
    t = np.arange(n) / SR
    e = np.exp(-t / max(tau, 1e-4))
    a = n_(att)
    if a > 1:
        e[:a] *= np.linspace(0, 1, a) ** 1.5
    return S_(e)


def env_ad(n, att, dec, curve=2.0):
    t = np.arange(n) / SR
    e = np.where(t < att, (t / max(att, 1e-5)), np.clip(1 - (t - att) / max(dec, 1e-5), 0, 1) ** curve)
    return S_(e)


def env_bell(n, peak=0.5, sharp=2.0):
    """Smooth hump peaking at fraction `peak` of the length."""
    x = np.linspace(0, 1, n)
    up = np.clip(x / peak, 0, 1)
    dn = np.clip((1 - x) / (1 - peak), 0, 1)
    return S_(np.where(x < peak, np.sin(up * np.pi / 2) ** sharp, np.sin(dn * np.pi / 2) ** sharp))


def phase(freq):
    freq = np.asarray(freq, float)
    return S_(2 * np.pi * np.cumsum(freq) / SR)


def sine(freq, n=None):
    if np.isscalar(freq):
        return np.sin(2 * np.pi * freq * np.arange(n) / SR)
    return S_(np.sin(phase(freq)))


def glide(f0, f1, n, curve=1.0):
    x = np.linspace(0, 1, n) ** curve
    return S_(f0 * (f1 / f0) ** x)


def modal(freqs, decays, amps, n, rng=None, jitter=0.0):
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f, d, a in zip(freqs, decays, amps):
        if rng is not None and jitter:
            f *= 1 + rng.uniform(-jitter, jitter)
        if f >= SR / 2 - 200:
            continue
        y += a * np.sin(2 * np.pi * f * t + (rng.uniform(0, 6.28) if rng is not None else 0)) * np.exp(-t / d)
    return S_(y)


def ks_pluck(freq, n, rng, bright=0.5, decay=0.996, pick=0.2):
    """Karplus-Strong string via lfilter comb (physical-model-ish pluck)."""
    N = max(2, int(round(SR / freq)))
    frac = SR / freq - N
    exc = rng.uniform(-1, 1, N)
    exc = lp(exc, 600 + bright * 9000, 1)
    # pick position comb
    p = max(1, int(N * pick))
    exc = exc - np.roll(exc, p) * 0.7
    x = np.zeros(n)
    x[:N] = exc
    # y[n] = x[n] + decay*((1-frac)*0.5*(y[n-N]+y[n-N-1]))  (approx fractional delay)
    a = np.zeros(N + 2)
    a[0] = 1
    a[N] = -decay * 0.5 * (1 + (1 - frac) * 0) 
    a[N + 1] = -decay * 0.5
    y = signal.lfilter([1.0], a, x)
    return S_(y / (np.max(np.abs(y[:N * 4])) + 1e-9))


def voice(f0, n, rng, vowels, fry=0.0, vib=(5.0, 0.0), breath=0.05, bright=1.0):
    """Formant voice: glottal-ish pulse at contour f0 (array) through morphing vowel formants.
    vowels: list of (F1,F2,F3) the voice morphs through across the duration."""
    f0 = np.broadcast_to(np.asarray(f0, float), (n,)).copy()
    t = np.arange(n) / SR
    if vib[1]:
        f0 *= 1 + vib[1] * np.sin(2 * np.pi * vib[0] * t + rng.uniform(0, 6))
    if fry:
        jit = lp(rng.standard_normal(n), 30, 1)
        f0 *= 1 + fry * jit / (np.std(jit) + 1e-9) * 0.5
    ph = np.cumsum(f0) / SR
    frac = ph % 1.0
    src = (1 - frac) ** 3 - 0.25  # soft sawtooth-ish glottal pulse
    src = src - lp(src, 30, 1)
    src = src + breath * hp(rng.standard_normal(n), 800)
    vs = np.array(vowels, float)
    k = np.linspace(0, len(vs) - 1, n)
    out = np.zeros(n)
    gains = [1.0, 0.6 * bright, 0.25 * bright]
    bws = [80, 120, 180]
    blk = 512
    for fi in range(3):
        ftraj = np.interp(k, np.arange(len(vs)), vs[:, fi])
        y = np.zeros(n)
        zi = None
        for i in range(0, n, blk):
            fc = ftraj[i]
            bw = bws[fi] + fc * 0.05
            b, a = signal.iirpeak(min(fc, SR / 2 - 1000), max(fc / bw, 0.7), fs=SR)
            if zi is None:
                zi = signal.lfilter_zi(b, a) * 0
            y[i:i + blk], zi = signal.lfilter(b, a, src[i:i + blk], zi=zi)
        out += gains[fi] * y
    return S_(out)


VOW = {"u": (300, 870, 2240), "o": (450, 800, 2600), "a": (750, 1150, 2600), "e": (500, 1750, 2500),
       "i": (300, 2200, 3000), "uh": (600, 1200, 2500), "m": (250, 900, 2200), "aw": (650, 950, 2500)}


def V(*names):
    return S_([VOW[n] for n in names])


def place(dst, src, at, gain=1.0):
    i = int(at * SR) if isinstance(at, float) else int(at)
    if i >= len(dst):
        return dst
    m = min(len(src), len(dst) - i)
    dst[i:i + m] += src[:m] * gain
    return dst


def fade(x, fin=0.002, fout=0.01):
    x = x.copy()
    a, b = n_(fin), n_(fout)
    if a > 0:
        x[:a] *= np.linspace(0, 1, a)
    if b > 0:
        x[-b:] *= np.linspace(1, 0, b) ** 2
    return S_(x)


def softclip(x, drive=1.0):
    return S_(np.tanh(x * drive) / np.tanh(drive))


def reverb(x, rng, size=0.4, wet=0.2, damp=4000, stereo=False):
    """Cheap diffuse reverb: convolution with decaying filtered noise (seeded)."""
    n = n_(0.25 + size * 2)
    t = np.arange(n) / SR
    chans = 2 if stereo else 1
    outs = []
    for c in range(chans):
        ir = rng.standard_normal(n) * np.exp(-t / (0.08 + size * 0.5))
        ir = lp(ir, damp, 1)
        ir[: n_(0.01)] = 0
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
        xs = x if x.ndim == 1 else x[:, c]
        outs.append(signal.fftconvolve(xs, ir)[: len(xs)])
    w = np.stack(outs, 1) if stereo else outs[0]
    dry = x if (not stereo or x.ndim == 2) else np.stack([x, x], 1)
    return S_(dry * (1 - wet * 0.5) + w * wet)


def trim_lead(x, thresh=0.003):
    a = np.abs(x if x.ndim == 1 else x.max(1))
    pk = a.max() + 1e-12
    idx = np.argmax(a > pk * thresh)
    idx = max(0, idx - n_(0.001))
    return S_(x[idx:])


def norm_peak(x, db=-1.0):
    pk = np.max(np.abs(x)) + 1e-12
    return S_(x * (10 ** (db / 20) / pk))


def loop_xfade(x, L, xf):
    """x has length >= L+xf. Returns seamless loop of length L (end flows into start)."""
    y = x[:L].copy()
    w = np.sin(np.linspace(0, np.pi / 2, xf)) ** 2
    if x.ndim == 2:
        w = w[:, None]
    y[:xf] = x[:xf] * np.sqrt(w) + x[L:L + xf] * np.sqrt(1 - w)
    return S_(y)


def loop_fold(x, L):
    """Event-rendered loop: tail past L is wrapped onto the start (ringing notes continue across the seam)."""
    y = x[:L].copy()
    rest = x[L:]
    while len(rest):
        m = min(L, len(rest))
        y[:m] += rest[:m]
        rest = rest[m:]
    return S_(y)
