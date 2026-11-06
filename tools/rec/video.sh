#!/usr/bin/env bash
# usage: video.sh <name> <cam> <from> <to> [w h]
set -e
cd "$(dirname "$0")"
OUT=${TMPDIR:-/tmp}/lab/v_$1; rm -rf $OUT
node rec.mjs $OUT $2 $3 $4 1 ${5:-540} ${6:-760}
ffmpeg -y -loglevel error -framerate 30 -i $OUT/f%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart $OUT.mp4
echo $OUT.mp4
