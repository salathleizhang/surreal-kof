#!/bin/sh
set -eu

input="public/assets/player/chenmian/_work/walk/video.mp4"
outdir="public/assets/player/chenmian/_review-v2/videos/walk-v6-continuous-frames"
preview="public/assets/player/chenmian/_review-v2/videos/walk-v6-continuous.mp4"
contact="public/assets/player/chenmian/_review-v2/videos/walk-v6-continuous-contact.png"

mkdir -p "$outdir"

# One complete one-second gait cycle, sampled consecutively at 12 fps.
# The same fixed scale/crop is applied to every frame; no per-frame repositioning.
ffmpeg -hide_banner -loglevel error -ss 0 -t 1 -i "$input" \
  -vf "fps=12,scale=694:932:flags=neighbor,crop=560:752:134:116" \
  "$outdir/%04d.png" -y

# Repeat the cycle twice so loop smoothness is visible during review.
ffmpeg -hide_banner -loglevel error -stream_loop 1 -framerate 12 \
  -i "$outdir/%04d.png" -frames:v 24 -c:v libx264 -pix_fmt yuv420p \
  -vf "scale=560:752:flags=neighbor" "$preview" -y

ffmpeg -hide_banner -loglevel error -framerate 12 -i "$outdir/%04d.png" \
  -vf "scale=280:376:flags=neighbor,tile=4x3" -frames:v 1 "$contact" -y
