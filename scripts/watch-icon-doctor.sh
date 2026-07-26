#!/bin/sh
# Report whether the last build produced an installable watch app.
#
#   npm run ios:watch-doctor            # inspect every config present in ios/build
#   npm run ios:watch-doctor Debug-Dev  # just one
#
# Why this exists: an embedded watch app can be broken several different ways
# that all leave `xcodebuild` reporting BUILD SUCCEEDED with no warning — an
# icon set with no matching entries, an asset catalog Xcode decided was up to
# date and never recompiled, a bundle plist with no CFBundleIconName to look
# the icon up by, or a code-signing profile that does not cover watchOS. On the
# wrist they collapse into two indistinguishable symptoms: a placeholder
# crosshair, and a bare "App could not be installed at this time". Reading the
# build log does not separate them — every one of the above was chased from
# logs and screenshots first, and every one of those attempts was wrong.
# Reading the built bundle does separate them, so measure the bundle.
set -e

WANT="${1:-}"
PRODUCTS="ios/build/Build/Products"

if [ ! -d "$PRODUCTS" ]; then
  echo "No build products at $PRODUCTS — run npm run ios:dev (or ios:prod) first."
  exit 1
fi

ASSETUTIL=$(xcrun --find assetutil 2>/dev/null || command -v assetutil || true)
FAILED=0
CHECKED=0

plist_get() {
  # plist_get <bundle> <key>  -> value, or empty when absent
  /usr/libexec/PlistBuddy -c "Print :$2" "$1/Info.plist" 2>/dev/null || true
}

inspect() {
  BUNDLE="$1"
  LABEL="$2"
  [ -d "$BUNDLE" ] || return 0
  CHECKED=$((CHECKED + 1))

  echo ""
  echo "--- $LABEL"
  echo "    path        $BUNDLE"
  echo "    bundle id   $(plist_get "$BUNDLE" CFBundleIdentifier)"
  echo "    version     $(plist_get "$BUNDLE" CFBundleShortVersionString) ($(plist_get "$BUNDLE" CFBundleVersion))"
  echo "    companion   $(plist_get "$BUNDLE" WKCompanionAppBundleIdentifier)"

  # Signing platform. An embedded watch app can be signed with an iOS profile
  # and still build, sign, validate and embed without a single warning — the
  # phone app installs, the watch app then fails on the wrist with a bare "App
  # could not be installed at this time". Automatic signing falls back to the
  # iOS wildcard profile whenever it cannot mint a watchOS one, which is what
  # happens until the paired Watch is registered as a development device.
  PROF="$BUNDLE/embedded.mobileprovision"
  if [ -f "$PROF" ]; then
    PROF_PLIST=$(security cms -D -i "$PROF" 2>/dev/null || true)
    PROF_NAME=$(printf '%s' "$PROF_PLIST" | plutil -extract Name raw -o - - 2>/dev/null || true)
    PLATFORMS=$(printf '%s' "$PROF_PLIST" | plutil -extract Platform json -o - - 2>/dev/null || true)
    DEVICES=$(printf '%s' "$PROF_PLIST" | plutil -extract ProvisionedDevices json -o - - 2>/dev/null \
      | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || true)
    echo "    profile     ${PROF_NAME:-<unreadable>} (${DEVICES:-?} devices)"
    if printf '%s' "$PLATFORMS" | grep -qi 'watchos'; then
      echo "    platform    OK — profile covers watchOS ${PLATFORMS}"
    else
      echo "    platform    WRONG — profile does not cover watchOS: ${PLATFORMS:-<none>}"
      echo "                The watch app is signed with a profile for another"
      echo "                platform, so watchOS will refuse to install it."
      echo "                Enable Developer Mode on the Watch, then pair it for"
      echo "                development in Xcode (Window > Devices and Simulators)"
      echo "                so automatic signing can issue a watchOS profile."
      FAILED=1
    fi
  else
    echo "    profile     none embedded — unsigned or ad-hoc; it will not install on a watch"
    FAILED=1
  fi

  ICON_NAME=$(plist_get "$BUNDLE" CFBundleIconName)
  if [ -n "$ICON_NAME" ]; then
    echo "    icon key    CFBundleIconName = $ICON_NAME"
  else
    echo "    icon key    MISSING — no CFBundleIconName, so nothing names an icon to load"
    FAILED=1
  fi

  CAR="$BUNDLE/Assets.car"
  if [ -f "$CAR" ]; then
    CAR_SIZE=$(wc -c < "$CAR" | tr -d ' ')
    echo "    Assets.car  present, ${CAR_SIZE} bytes"
    if [ -n "$ASSETUTIL" ]; then
      # assetutil prints one JSON object per asset; count the app-icon images
      # and show which names are actually compiled in.
      NAMES=$("$ASSETUTIL" --info "$CAR" 2>/dev/null \
        | grep -i '"Name"' \
        | sed 's/.*: *"//; s/".*//' \
        | sort -u \
        | tr '\n' ' ' || true)
      echo "    asset names ${NAMES:-<none readable>}"
      if [ -n "$ICON_NAME" ]; then
        if "$ASSETUTIL" --info "$CAR" 2>/dev/null | grep -qi "\"$ICON_NAME\""; then
          echo "    icon data   OK — '$ICON_NAME' is compiled into Assets.car"
        else
          echo "    icon data   MISSING — Assets.car has no '$ICON_NAME' entry"
          echo "                (stale catalog: rm -rf ios/build and rebuild)"
          FAILED=1
        fi
      fi
    fi
  else
    echo "    Assets.car  MISSING — the asset catalog never compiled for this target"
    echo "                (stale catalog or the .xcassets is not in its Resources phase;"
    echo "                 rm -rf ios/build and rebuild to rule out the cache)"
    FAILED=1
  fi
}

for DIR in "$PRODUCTS"/*-iphoneos; do
  [ -d "$DIR" ] || continue
  CONFIG=$(basename "$DIR" | sed 's/-iphoneos$//')
  if [ -n "$WANT" ] && [ "$WANT" != "$CONFIG" ]; then continue; fi
  echo ""
  echo "=== $CONFIG"
  # The standalone watch product, and the copy actually embedded in the phone
  # app. They can differ: the embed phase copies whatever exists, so a stale
  # standalone product ships even when the fresh one would have been fine.
  inspect "$PRODUCTS/$CONFIG-watchos/BoomerangWatch.app" "watch product (built)"
  inspect "$DIR/App.app/Watch/BoomerangWatch.app" "watch app embedded in App.app"
done

echo ""
if [ "$CHECKED" -eq 0 ]; then
  echo "No BoomerangWatch.app found under $PRODUCTS — the watch target did not build."
  echo "Check that the scheme builds implicit dependencies, then rebuild."
  exit 1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: this watch app will not install correctly. Details above."
  exit 1
fi

echo "RESULT: every watch bundle checked is signed for watchOS and has its icon."
