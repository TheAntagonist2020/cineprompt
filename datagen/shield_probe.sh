#!/usr/bin/env bash
# shield_probe.sh — can we see what the Criterion Channel app is playing?
#
# The Criterion Channel has no Trakt integration and no public API, and it is
# watched here on an NVIDIA Shield (Android TV). The one remaining hook is
# Android's MediaSession: apps that publish playback metadata for the remote /
# voice control also expose it to `dumpsys media_session`. If the Criterion app
# publishes the film title there, an auto-scrobbler is buildable. If it only
# reports something generic, it is not.
#
# This script answers that question. It only READS from the device.
#
# Setup (once, on the Shield):
#   Settings -> Device Preferences -> About -> click "Build" 7x (dev mode)
#   Settings -> Device Preferences -> Developer options -> Network debugging ON
#   Note the Shield's IP (Settings -> Network).
#
# Then, WITH A FILM PLAYING on the Criterion app:
#   ./shield_probe.sh 192.168.1.42
set -uo pipefail

IP="${1:-}"
if [ -z "$IP" ]; then
  echo "usage: $0 <shield-ip>   (with a Criterion film playing)" >&2
  exit 2
fi
command -v adb >/dev/null || { echo "adb not found — install android-platform-tools" >&2; exit 2; }

echo "==> connecting to $IP"
adb connect "$IP:5555" || exit 1
sleep 1

echo
echo "==> active media sessions (looking for a Criterion package)"
adb -s "$IP:5555" shell dumpsys media_session \
  | grep -iE "package|state=PlaybackState|metadata|description" \
  | grep -viE "^\s*$" | head -40

echo
echo "==> what is in the foreground"
adb -s "$IP:5555" shell dumpsys activity activities \
  | grep -iE "mResumedActivity|topResumedActivity" | head -3

echo
echo "==> Criterion package name (if installed)"
adb -s "$IP:5555" shell pm list packages | grep -iE "criterion|vhx" || echo "  (no criterion/vhx package matched)"

cat <<'EOF'

------------------------------------------------------------------
READ THE OUTPUT LIKE THIS

  If a line shows the FILM'S TITLE (e.g. description=Seven Samurai)
  next to a criterion package -> an auto-scrobbler IS buildable.
  Send this output back and it can be written.

  If the metadata is empty, or the title is generic ("Criterion
  Channel", "Video"), then the app does not publish per-film
  metadata and no scrobbler can identify what you watched. In that
  case logging to Letterboxd stays the route -- and the RSS sync
  already carries it into Cineprompt automatically.
------------------------------------------------------------------
EOF
