#!/usr/bin/env bash
# Capture the app window and crop it out of a full-screen grab.
#
# `screencapture -l` needs a CoreGraphics window id we cannot get from the shell,
# so instead we ask System Events for the window rect (logical points), scale it
# by the display's backing factor, and crop the retina screenshot to match.
set -euo pipefail

OUT="${1:?usage: shot.sh <output.png>}"
PROCESS="${SHOT_PROCESS:-gui-timelapse-maker}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Raise the app first, otherwise we crop its rect out of whatever is stacked
# on top of it.
osascript -e "tell application \"System Events\" to set frontmost of process \"$PROCESS\" to true"
sleep 1

read -r X Y W H < <(
  osascript -e "tell application \"System Events\" to tell process \"$PROCESS\" to get {position, size} of window 1" \
    | tr -d ' ' | tr ',' ' '
)

screencapture -x -o "$WORK/full.png"
PHYS_W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$WORK/full.png")
LOGICAL_W=$(osascript -e 'tell application "Finder" to get item 3 of (get bounds of window of desktop)')
SCALE=$((PHYS_W / LOGICAL_W))

# Inset slightly so the rounded window corners do not leave wallpaper specks.
INSET=$((SCALE))
CROP="$(( W * SCALE - INSET * 2 )):$(( H * SCALE - INSET * 2 )):$(( X * SCALE + INSET )):$(( Y * SCALE + INSET ))"

mkdir -p "$(dirname "$OUT")"
ffmpeg -v error -y -i "$WORK/full.png" \
  -vf "crop=${CROP},scale=1600:-2:flags=lanczos" "$OUT"

echo "$OUT  ($(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT"))"
