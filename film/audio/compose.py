"""Музыка и звуковые акценты ролика — синтез на numpy, без чужих сэмплов.
Время берётся из ../timeline.json (то же, что у картинки).
Запуск: uv run --with numpy python audio/compose.py out.wav"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
HERE = Path(__file__).resolve().parent
TL = json.loads((HERE.parent / "timeline.json").read_text())
DUR = TL["duration"]
BEAT = 60.0 / TL["bpm"]
N = int(DUR * SR)
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)
S = {s["id"]: s for s in TL["scenes"]}


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def place(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * np.sqrt((1 - pan) / 2)
    R[i:i + len(sig)] += sig * gain * np.sqrt((1 + pan) / 2)


def env_ar(n, a, r):
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na)
    nr = max(1, int(r * SR))
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


# --- инструменты ---
def pluck(f, length=1.2):
    """Деревянный «маримба»-удар: основной тон + 4-й обертон, быстрый спад."""
    t = np.arange(int(length * SR)) / SR
    s = np.sin(2 * np.pi * f * t) * np.exp(-t * 4.2)
    s += 0.28 * np.sin(2 * np.pi * f * 4.0 * t) * np.exp(-t * 18)
    s += 0.12 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 40)
    s *= env_ar(len(t), 0.004, 0.08)
    return s


def pad(freqs, length):
    t = np.arange(int(length * SR)) / SR
    s = np.zeros_like(t)
    for f in freqs:
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            s += np.sin(2 * np.pi * ff * t) + 0.3 * np.sin(2 * np.pi * 2 * ff * t) + 0.12 * np.sin(2 * np.pi * 3 * ff * t)
    s /= len(freqs) * 3
    s *= 1 + 0.08 * np.sin(2 * np.pi * 0.25 * t)
    return s * env_ar(len(t), 0.9, 1.2)


def bass(f, length):
    t = np.arange(int(length * SR)) / SR
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return s * np.exp(-t * 1.6) * env_ar(len(t), 0.01, 0.1)


def kick():
    t = np.arange(int(0.35 * SR)) / SR
    f = 46 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)


def shaker():
    n = int(0.07 * SR)
    x = rng.standard_normal(n)
    x = x - lowpass(x, 5000)
    return x * np.exp(-np.arange(n) / SR * 60)


# --- звуковые акценты ---
def tick():
    t = np.arange(int(0.05 * SR)) / SR
    return (np.sin(2 * np.pi * 2300 * t) * np.exp(-t * 140) + 0.3 * rng.standard_normal(len(t)) * np.exp(-t * 300))


def swipe(pitch=1.0):
    """Маркер по бумаге: шум с полосой, которая плавно поднимается."""
    n = int(0.34 * SR)
    x = rng.standard_normal(n)
    out = np.empty(n)
    lo = hi = 0.0
    for i in range(n):
        p = i / n
        c1 = np.exp(-2 * np.pi * (1600 + 2600 * p) * pitch / SR)
        c2 = np.exp(-2 * np.pi * (500 + 900 * p) * pitch / SR)
        lo = (1 - c1) * x[i] + c1 * lo
        hi = (1 - c2) * lo + c2 * hi
        out[i] = lo - hi
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 0.7
    return out * e


def whoosh():
    n = int(0.6 * SR)
    x = lowpass(rng.standard_normal(n), 900)
    e = np.sin(np.pi * np.linspace(0, 1, n) ** 1.6) ** 2
    return x * e


def chime(f=hz(86)):
    t = np.arange(int(2.6 * SR)) / SR
    s = sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t * d) for m, a, d in ((1, 1, 1.6), (2.76, 0.4, 3.2), (5.4, 0.2, 6.0)))
    return s * env_ar(len(t), 0.003, 0.4)


# --- аранжировка: ре мажор, 100 уд/мин, гармония меняется каждые 2 такта ---
CHORDS = [  # (бас, аккорд пэда, арпеджио)
    (38, [62, 66, 69, 73], [74, 78, 81, 85, 81, 78]),   # Dmaj7
    (35, [59, 62, 66, 69], [71, 74, 78, 81, 78, 74]),   # Bm7
    (31, [55, 59, 62, 66], [71, 74, 78, 79, 78, 74]),   # Gmaj7
    (33, [57, 61, 64, 69], [69, 73, 76, 81, 76, 73]),   # A
]
bar = 4 * BEAT
seg = 2 * bar
end_t = S["end"]["start"]
t0 = 0.0
k = 0
while t0 < end_t:
    b, chord, arp = CHORDS[k % 4]
    length = min(seg, end_t - t0) + 1.2
    place(pad([hz(m) for m in chord], length), t0, 0.16)
    if t0 >= S["setup"]["start"] - 0.01:
        for beat in (0, 2, 4, 6):
            if t0 + beat * BEAT < end_t:
                place(bass(hz(b), BEAT * 2), t0 + beat * BEAT, 0.17)
    # арпеджио восьмыми; во вступлении — только сильные доли
    for i in range(16):
        tt = t0 + i * BEAT / 2
        if tt >= end_t:
            break
        if tt < S["marks"]["start"] and i % 4:
            continue
        if S["local"]["start"] <= tt < S["you"]["start"] and i % 2:
            continue  # «локальная модель» — дыхание
        note = arp[i % len(arp)]
        place(pluck(hz(note)), tt, 0.2 if i % 2 == 0 else 0.13, pan=(-0.35 if i % 2 else 0.35))
    # ритм — с поиска до финала, тише в «локальной» сцене
    for i in range(8):
        tt = t0 + i * BEAT
        if S["search"]["start"] <= tt < end_t:
            quiet = 0.5 if S["local"]["start"] <= tt < S["you"]["start"] else 1.0
            if i % 2 == 0:
                place(kick(), tt, 0.26 * quiet)
            place(shaker(), tt + BEAT / 2, 0.05 * quiet, pan=0.25)
    t0 += seg
    k += 1

# финал: ре мажор звучит и затихает
place(pad([hz(m) for m in (50, 62, 66, 69, 74)], DUR - end_t + 0.5), end_t, 0.22)
place(bass(hz(38), 3.5), end_t, 0.22)
for i, m in enumerate((74, 78, 81, 86)):
    place(pluck(hz(m), 2.0), end_t + i * BEAT / 2, 0.16)

for ev in TL["sfx"]:
    k_ = ev["kind"]
    if k_ == "tick":
        place(tick(), ev["t"], 0.16)
    elif k_ == "swipe":
        place(swipe(ev.get("pitch", 1.0)), ev["t"] - 0.12, 0.5, pan=0.1)
    elif k_ == "whoosh":
        place(whoosh(), ev["t"] - 0.35, 0.32)
    elif k_ == "chime":
        place(chime(), ev["t"], 0.2)

mix = np.stack([L, R], axis=1)
fade = int(1.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
mix[: int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))[:, None]
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix /= np.max(np.abs(mix)) / 0.89
out = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "mix.wav")
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"wrote {out}: {DUR:.2f} s, peak {np.max(np.abs(mix)):.2f}")
