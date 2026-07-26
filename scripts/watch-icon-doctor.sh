#!/bin/sh
# Report what the last build actually put in the watch app's bundle.
#
#   npm run ios:watch-doctor            # inspect every config present in ios/build
#   npm run ios:watch-doctor Debug-Dev  # just one
#
# Why this exists: a watchOS app icon can fail three different ways that all
# leave `xcodebuild` reporting BUILD SUCCEEDED — an icon set with no matching
# entries, an asset catalog Xcode decided was up to date and never recompiled,
# or a bundle plist with no CFBundleIconName to look the icon up by. The
# symptom for all three is identical (placeholder crosshair on the phone's
# Watch app list, and sometimes a flat "App could not be installed at this
# time", because watchOS refuses to install an app with no valid icon).
# Reading the build log does not distinguish them. Reading the built bundle
# does, so measure the bundle.
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
  echo "RESULT: the watch icon is NOT in the bundle. Details above."
  exit 1
fi

echo "RESULT: watch icons are present in every bundle checked."
