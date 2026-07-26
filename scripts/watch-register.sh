#!/bin/sh
# Register the paired Apple Watch with the developer account so automatic
# signing can issue a *watchOS* provisioning profile.
#
#   npm run ios:watch-register          # prod flavor (Debug)
#   npm run ios:watch-register Debug-Dev
#
# Why this exists: `xcrun devicectl list devices` seeing the watch is not the
# same as Xcode having registered it with Apple. Registration happens when the
# device is used as a build destination — and until it happens, automatic
# signing silently falls back to the iOS wildcard profile
# ("iOS Team Provisioning Profile: *", Platform = iOS/xrOS/visionOS). The watch
# app then builds, signs and embeds cleanly, and watchOS refuses to install it
# with a bare "App could not be installed at this time".
#
# Building the watch scheme against the watch itself is what triggers the
# registration. The Devices and Simulators window does the same thing, but it
# moved in Xcode 26 and this does not depend on finding it.
set -e

CONFIG="${1:-Debug}"
case "$CONFIG" in
  Debug)     SCHEME="Watch" ;;
  Debug-Dev) SCHEME="Watch Dev" ;;
  *) echo "Unknown config '$CONFIG' — use Debug or Debug-Dev"; exit 1 ;;
esac

echo "==> Finding the paired Apple Watch…"
DEVJSON=$(mktemp)
xcrun devicectl list devices --json-output "$DEVJSON" >/dev/null 2>&1 || true
WATCH_ID=$(python3 - "$DEVJSON" <<'PYINNER'
import json, sys
try:
    devices = json.load(open(sys.argv[1])).get('result', {}).get('devices', [])
except Exception:
    devices = []
for d in devices:
    hw = d.get('hardwareProperties', {})
    # Physical watches only — a simulator here would register nothing useful.
    if hw.get('platform') == 'watchOS' and hw.get('isProductionFused') is not False:
        if (d.get('deviceProperties', {}).get('developerModeStatus') or '') != 'disabled':
            print(hw.get('udid') or d.get('identifier') or '')
            break
PYINNER
)
rm -f "$DEVJSON"

if [ -z "$WATCH_ID" ]; then
  echo "No paired Apple Watch found with Developer Mode enabled."
  echo "On the watch: Settings > Privacy & Security > Developer Mode > On, then restart it."
  echo "Keep it unlocked and on the charger, near the Mac, and try again."
  xcrun devicectl list devices 2>/dev/null || true
  exit 1
fi
echo "    watch: $WATCH_ID"

echo "==> Building scheme \"$SCHEME\" against the watch (registers it with your account)…"
echo "    This can pause while Apple issues the profile; that is the point of the run."
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$WATCH_ID" \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates \
  build

echo ""
echo "==> Verifying the profile that came out of it…"
sh scripts/watch-icon-doctor.sh "$CONFIG" || {
  echo ""
  echo "Still not right. If 'platform' is still WRONG, the account did not issue a"
  echo "watchOS profile — open the project in Xcode once, pick the watch in the"
  echo "run-destination dropdown, and build. That path can prompt for credentials"
  echo "in ways a headless xcodebuild cannot."
  exit 1
}

echo ""
echo "Watch registered. Now rebuild the phone app so it embeds the re-signed watch app:"
echo "  npm run ios:prod    (or ios:dev)"
