#!/usr/bin/env bash
# Local-only dev launcher that gives the menu BGM true zero-interaction autoplay.
#
# Browsers block audible autoplay until the user interacts — there's no way around
# that in normal page code. For personal/local use we instead launch Chrome with
# `--autoplay-policy=no-user-gesture-required`, so the AudioContext starts
# "running" and Phaser plays the music the moment the title screen loads.
#
# A throwaway --user-data-dir is required: Chrome ignores the flag if it attaches
# to an already-running instance using your normal profile.
set -e

PORT=5173
URL="http://localhost:${PORT}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome not found at: $CHROME"
  echo "Install Chrome, or just run 'npm run dev' (music will start on first key/click)."
  exit 1
fi

# Start Vite without its own auto-open (NO_OPEN is read by vite.config.js).
NO_OPEN=1 npx vite --port "$PORT" --strictPort &
VITE_PID=$!
trap 'kill "$VITE_PID" 2>/dev/null' EXIT INT TERM

# Wait for the dev server to answer before pointing Chrome at it.
for _ in $(seq 1 60); do
  if curl -sf "$URL" >/dev/null 2>&1; then break; fi
  sleep 0.3
done

"$CHROME" \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="${TMPDIR:-/tmp}/kof-chrome-profile" \
  --new-window "$URL" >/dev/null 2>&1 &

wait "$VITE_PID"
