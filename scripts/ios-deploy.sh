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

echo "==> 4/6 xcodebuild ($SCHEME / $CONFIG)…"
build_app() {
  # Drop the previous watch product first. Xcode tracks the asset catalog by
  # its outputs, and edits *inside* an .appiconset have repeatedly not
  # invalidated it — the build then reuses an old Assets.car and the watch app
  # ships with no icon (which watchOS treats as a hard install failure).
  # Deleting the product makes the outputs missing, so actool is forced to run
  # again. Costs a couple of seconds; the phone app's own incremental build is
  # untouched.
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
}
build_app

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

# A green build says nothing about whether the watch app can actually install:
# a missing icon or a profile that doesn't cover watchOS both end in "App could
# not be installed at this time" on the wrist. The doctor prints which one it
# is — don't restate a guess here, just point at it.
echo "==> 5/6 Checking the watch app…"
WATCH_ID=$(sh scripts/find-watch.sh 2>/dev/null || true)
WATCH_OK=1
# Hand the doctor the watch we already resolved so it can check whether the
# profile actually covers this watch, without repeating the live devicectl
# query (a couple of seconds per candidate).
export BOOMERANG_WATCH_UDID="$WATCH_ID"

if ! sh scripts/watch-icon-doctor.sh "$CONFIG"; then
  WATCH_OK=0
  # The usual cause on a first run is that the watch has never been registered
  # with the developer account, so automatic signing fell back to the iOS
  # wildcard profile. Registering it means building a watch scheme against the
  # watch — which we can just do, rather than making it a separate errand.
  # Harmless if registration was not the problem: it only builds a target that
  # was going to build anyway.
  if [ -n "$WATCH_ID" ]; then
    echo ""
    echo "    Watch found ($WATCH_ID) — registering it and rebuilding once."
    echo "    This can pause while Apple issues the profile."
    REGLOG=$(mktemp)
    if sh scripts/watch-register.sh "$CONFIG" >"$REGLOG" 2>&1; then
      echo "    Registered. Rebuilding so the phone app embeds the re-signed watch app…"
      build_app
      if sh scripts/watch-icon-doctor.sh "$CONFIG"; then
        WATCH_OK=1
      fi
    else
      echo "    Registration did not succeed. Last 25 lines:"
      tail -25 "$REGLOG" | sed 's/^/      /'
      echo "      (full log: $REGLOG)"
    fi
    # NB: not `[ … ] && rm …` — under `set -e` a false test there would take
    # the whole script down right before the install step.
    if [ "$WATCH_OK" -eq 1 ]; then rm -f "$REGLOG"; fi
  fi
fi

if [ "$WATCH_OK" -ne 1 ]; then
  echo ""
  echo "  !! The watch app in this build will not install — see the check above"
  echo "  !! for which part failed."
  echo "  !! Continuing; the phone app itself is unaffected."
  echo ""
fi

echo "==> 6/6 Installing + launching on the phone…"
xcrun devicectl device install app --device "$UDID" "$APP_PATH"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" || {
  echo "(Installed, but auto-launch failed — tap the icon; this can happen while the phone is locked.)"
}

# Push the watch app across too. Installing the phone app makes watchOS offer
# the watch app in the Watch app's list, but it does not put it on the wrist —
# best-effort direct install saves that round trip. Never fatal: the phone app
# is already on and a failure here is a watch-side problem, not a build one.
if [ "$WATCH_OK" -eq 1 ] && [ -n "$WATCH_ID" ]; then
  WATCH_APP="$APP_PATH/Watch/BoomerangWatch.app"
  if [ -d "$WATCH_APP" ]; then
    echo "    Installing the watch app on $WATCH_ID…"
    xcrun devicectl device install app --device "$WATCH_ID" "$WATCH_APP" || {
      echo "    (Direct watch install failed — open the Watch app on the phone and"
      echo "     install Boomerang from Available Apps. Keep the watch unlocked and"
      echo "     on the charger.)"
    }
  fi
fi

echo "Done: $SCHEME is on the phone."
if [ "$WATCH_OK" -ne 1 ]; then
  echo "Watch app check FAILED earlier in this run — scroll up, or re-run:"
  echo "  npm run ios:watch-doctor $CONFIG"
elif [ -z "$WATCH_ID" ]; then
  echo "No paired Apple Watch was visible, so the watch app was not installed."
  echo "Enable Developer Mode on the watch and re-run to pick it up."
fi
