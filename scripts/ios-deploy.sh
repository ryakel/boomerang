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
  echo "==> 3/5 Finding a connected iPhone…"
  # devicectl UDIDs look like 00008120-XXXXXXXXXXXXXXXX; take the first
  # device whose row says 'connected'.
  UDID=$(xcrun devicectl list devices 2>/dev/null | grep -i 'connected' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)
  if [ -z "$UDID" ]; then
    echo "No connected iPhone found. Plug it in (unlocked), or pass a UDID:"
    echo "  sh scripts/ios-deploy.sh \"$SCHEME\" <udid>"
    xcrun devicectl list devices 2>/dev/null || true
    exit 1
  fi
fi
echo "    device: $UDID"

echo "==> 4/5 xcodebuild ($SCHEME / $CONFIG)…"
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

echo "==> 5/5 Installing + launching on the phone…"
xcrun devicectl device install app --device "$UDID" "$APP_PATH"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" || {
  echo "(Installed, but auto-launch failed — tap the icon; this can happen while the phone is locked.)"
}

echo "Done: $SCHEME is on the phone."
