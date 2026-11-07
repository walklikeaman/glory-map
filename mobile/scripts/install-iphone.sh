#!/usr/bin/env bash
# Build GloryMap (Capacitor iOS shell) and install it on a real iPhone
# from the command line. No Xcode GUI. Runs on the Mac where Xcode is
# signed in to the Apple team and the iPhone is paired (cable or Wi-Fi).
#
# Usage:  mobile/scripts/install-iphone.sh   (or: cd mobile && npm run iphone)
# Env overrides:
#   DEVICE_ID    iPhone UDID (skips lookup by name)
#   DEVICE_NAME  iPhone name to look up when DEVICE_ID is empty (default "Oz iPhone Pro")
#   TEAM_ID      Apple development team (default NM3FPYR56P)
#   BUNDLE_ID    app bundle id (default com.walklikeaman.glorymap)
#   SKIP_PULL=1  do not run git pull
set -euo pipefail

DEVICE_NAME="${DEVICE_NAME:-Oz iPhone Pro}"
DEVICE_ID="${DEVICE_ID:-}"
TEAM_ID="${TEAM_ID:-NM3FPYR56P}"
BUNDLE_ID="${BUNDLE_ID:-com.walklikeaman.glorymap}"

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MOBILE_DIR"

# 1. Update from main only when the working tree is clean.
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  if [[ -z "$(git status --porcelain)" ]]; then
    git pull --ff-only origin main
  else
    echo "Working tree has local changes; skipping git pull." >&2
  fi
fi

# 2. Web shell -> native project.
npm install --no-audit --no-fund
npx cap sync ios

# 3. Find the iPhone by name when no UDID is given.
if [[ -z "$DEVICE_ID" ]]; then
  json="$(mktemp)"
  trap 'rm -f "$json"' EXIT
  xcrun devicectl list devices --json-output "$json" >/dev/null
  DEVICE_ID="$(/usr/bin/python3 -I - "$json" "$DEVICE_NAME" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for d in data.get("result", {}).get("devices", []):
    props = d.get("deviceProperties", {})
    hw = d.get("hardwareProperties", {})
    if props.get("name") == sys.argv[2] and hw.get("reality") == "physical":
        print(hw.get("udid", ""))
        break
PY
)"
  if [[ -z "$DEVICE_ID" ]]; then
    echo "iPhone \"$DEVICE_NAME\" not found. Check: xcrun devicectl list devices" >&2
    exit 1
  fi
fi
echo "Device: $DEVICE_NAME ($DEVICE_ID), team $TEAM_ID"

# 4. Build, signed automatically for the device.
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath build \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  build

APP="build/Build/Products/Debug-iphoneos/App.app"
[[ -d "$APP" ]] || { echo "Built app not found at $APP" >&2; exit 1; }

# 5. Install and launch. A locked phone installs but does not launch.
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" \
  || echo "Installed, but launch failed (is the phone locked?)." >&2
