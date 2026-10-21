#!/usr/bin/env bash
# Сборка ролика: картинка (Remotion) + музыка (numpy) → мастер (ffmpeg, −16 LUFS, пик −1.5 dBTP).
# Использование: bash make_film.sh [ru|en|all]   Результат: renders/ и ../site/media/
set -euo pipefail
cd "$(dirname "$0")"
LANGS=${1:-all}; [ "$LANGS" = all ] && LANGS="ru en"
CHROME=${REMOTION_BROWSER:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
BROWSER_ARG=(); [ -x "$CHROME" ] && BROWSER_ARG=(--browser-executable="$CHROME")
mkdir -p renders ../site/media
uv run -q --with numpy python audio/compose.py audio/mix.wav
for L in $LANGS; do
  U=$(echo "$L" | tr a-z A-Z)
  npx remotion render src/index.ts "Film$U" "renders/picture-$L.mp4" --codec=h264 --crf=14 --concurrency=4 --log=error "${BROWSER_ARG[@]}"
  npx remotion still src/index.ts "Poster$U" "renders/poster-$L.png" --log=error "${BROWSER_ARG[@]}"
  ffmpeg -y -loglevel error -i "renders/picture-$L.mp4" -i audio/mix.wav \
    -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5:LRA=7[a]" -map 0:v -map "[a]" \
    -c:v libx264 -crf 21 -preset slow -profile:v high -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "renders/job-search-desktop-film-$L.mp4"
  SUFFIX=""; [ "$L" = ru ] || SUFFIX="-$L"
  cp "renders/job-search-desktop-film-$L.mp4" "../site/media/job-search-desktop-film$SUFFIX.mp4"
  ffmpeg -y -loglevel error -i "renders/poster-$L.png" -vf scale=1600:-1 -q:v 3 "../site/media/poster$SUFFIX.jpg"
  python3 tools/check_master.py "renders/job-search-desktop-film-$L.mp4"
done
