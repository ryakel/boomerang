#!/bin/sh
# One-liner Mac build+install+launch for the iOS app, no Xcode UI.
#
#   npm run ios:prod   -> scheme "App"      (Boomerang,      ryakel.boomerang.app)
#   npm run ios:dev    -> scheme "App Dev"  (Boomerang Dev,  ryakel.boomerang.app.dev)
#
# Optional 2nd arg: a device UDID (otherwise the first connected iPhone found
# via `xcrun devicectl` is used). Phone must be plugged in (or paired over
# Wi-Fi), unlocked, with Developer Mode on.
#
# First-time note: automatic signing runs headlessly via
# -allowProvisioningUpdates, but brand-new capabilities (a new App Group) can
# need ONE interactive Xcode build (Cmd-R) to register with Apple. After that
# this script is all you need.
set -e

SCHEME="${1:-App}"
UDID="${2:-}"
case "$SCHEME" in
  App)       CONFIG="Debug";     BUNDLE_ID="ryakel.boomerang.app" ;;
  "App Dev") CONFIG="Debug-Dev"; BUNDLE_ID="ryakel.boomerang.app.dev" ;;
  *) echo "Unknown scheme '$SCHEME' — use \"App\" or \"App Dev\""; exit 1 ;;
esac

echo "==> 1/5 npm install…"
npm install

echo "==> 2/5 Building web bundle + syncing into the iOS project…"
npm run build
npx cap sync ios

if [ -z "$UDID" ]; then
  echo "==> 3/5 Finding your iPhone…"
  # Parse devicectl's JSON (the table format and its identifier column vary
  # by Xcode version — grepping it proved unreliable). Prefer a device whose
  # tunnel is up ('connected'), else any paired device (Wi-Fi pairing shows
  # as 'available'); devicectl can reach those too.
  DEVJSON=$(mktemp)
  xcrun devicectl list devices --json-output "$DEVJSON" >/dev/null 2>&1 || true
  UDID=$(python3 - "$DEVJSON" <<'PYINNER'
import json, re, sys
try:
    devices = json.load(open(sys.argv[1])).get('result', {}).get('devices', [])
except Exception:
    devices = []
# PHYSICAL devices only: hardware UDIDs look like 00008120-XXXXXXXXXXXXXXXX.
# Simulators carry standard UUIDs — an earlier fallback to d['identifier']
# happily picked one and devicectl staged the install into CoreSimulator
# (EBADARCH: device build, simulator target). Never fall back past this.
HW = re.compile(r'^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$')
phys = [d for d in devices if HW.match(d.get('hardwareProperties', {}).get('udid') or '')]
def key(d):
    tunnel = (d.get('connectionProperties', {}).get('tunnelState') or '').lower()
    return 0 if tunnel == 'connected' else 1
phys.sort(key=key)
if phys:
    print(phys[0]['hardwareProperties']['udid'])
PYINNER
)
  rm -f "$DEVJSON"
  if [ -z "$UDID" ]; then
    echo "No physical iPhone found (simulators are deliberately excluded)."
    echo "Plug the phone in (unlocked + trusted), or pass a UDID:"
    echo "  sh scripts/ios-deploy.sh \"$SCHEME\" <udid>"
    xcrun devicectl list devices 2>/dev/null || true
    exit 1
  fi
fi
echo "    device: $UDID"

echo "==> 4/5 xcodebuild ($SCHEME / $CONFIG)…"
# Drop the previous watch product first. Xcode tracks the asset catalog by its
# outputs, and edits *inside* an .appiconset have repeatedly not invalidated
# it — the build then reuses an old Assets.car and the watch app ships with no
# icon (which watchOS treats as a hard install failure). Deleting the product
# makes the outputs missing, so actool is forced to run again. Costs a couple
# of seconds; the phone app's own incremental build is untouched.
rm -rf ios/build/Build/Products/*-watchos/BoomerangWatch.app \
       "ios/build/Build/Products/${CONFIG}-iphoneos/App.app/Watch" 2>/dev/null || true

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$UDID" \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates \
  build

APP_PATH="ios/build/Build/Products/${CONFIG}-iphoneos/App.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Build product not found at $APP_PATH"; exit 1
fi

# Safety: never install a bundle whose identity doesn't match the requested
# flavor — catches config/scheme mixups before they touch the phone.
BUILT_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist" 2>/dev/null || true)
if [ "$BUILT_ID" != "$BUNDLE_ID" ]; then
  echo "REFUSING TO INSTALL: built bundle id is '$BUILT_ID' but scheme $SCHEME expects '$BUNDLE_ID'."
  echo "The build configuration didn't apply — check that your checkout is current (git pull) and retry."
  exit 1
fi
echo "    built: $BUILT_ID ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP_PATH/Info.plist" 2>/dev/null))"

# A watch app with no icon in its bundle is not a cosmetic problem: watchOS
# refuses to install it ("App could not be installed at this time"). Say so
# here rather than letting a green build imply the watch side is fine.
WATCH_OK=1
if ! sh scripts/watch-icon-doctor.sh "$CONFIG"; then
  WATCH_OK=0
  echo ""
  echo "  !! The watch app in this build has no usable icon (see above)."
  echo "  !! Installing anyway — the phone app is fine and the watch app may"
  echo "  !! simply refuse to install on the watch."
  echo ""
fi

echo "==> 5/5 Installing + launching on the phone…"
xcrun devicectl device install app --device "$UDID" "$APP_PATH"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" || {
  echo "(Installed, but auto-launch failed — tap the icon; this can happen while the phone is locked.)"
}

echo "Done: $SCHEME is on the phone."
if [ "$WATCH_OK" -ne 1 ]; then
  echo "Watch icon check FAILED earlier in this run — scroll up, or re-run:"
  echo "  npm run ios:watch-doctor $CONFIG"
fi
