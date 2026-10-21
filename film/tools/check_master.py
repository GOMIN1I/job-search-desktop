"""Проверка готового файла: потоки, длительность, число кадров, громкость и истинный пик (по декодированному AAC).
Использование: python3 tools/check_master.py film.mp4"""
import json
import re
import subprocess
import sys

f = sys.argv[1]
probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-count_frames", "-of", "json", f],
                                  capture_output=True, text=True, check=True).stdout)
v = next(s for s in probe["streams"] if s["codec_type"] == "video")
a = next(s for s in probe["streams"] if s["codec_type"] == "audio")
print(f"{f}: {int(probe['format']['size']) / 1e6:.1f} MB, {float(probe['format']['duration']):.2f} s")
print(f"  video {v['codec_name']} {v['width']}x{v['height']} {v['r_frame_rate']} fps, {v.get('nb_read_frames')} frames, {v['pix_fmt']}")
print(f"  audio {a['codec_name']} {a['sample_rate']} Hz, {a['channels']} ch, {float(a['duration']):.2f} s")
err = subprocess.run(["ffmpeg", "-nostats", "-i", f, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"],
                     capture_output=True, text=True).stderr
summ = err[err.rfind("Summary:"):]
i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summ).group(1))
tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ).group(1))
print(f"  loudness {i} LUFS, true peak {tp} dBTP")
dec = subprocess.run(["ffmpeg", "-v", "error", "-i", f, "-f", "null", "-"], capture_output=True, text=True).stderr.strip()
ok = abs(i + 16) <= 1.0 and tp <= -1.0 and not dec
print("  decode errors:", dec or "none")
print("  RESULT:", "OK" if ok else "CHECK")
sys.exit(0 if ok else 1)
