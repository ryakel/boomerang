#!/bin/sh
# Register the paired Apple Watch with the developer account so automatic
# signing can issue a *watchOS* provisioning profile.
#
#   npm run ios:watch-register          # prod flavor (Debug)
#   npm run ios:watch-register Debug-Dev
#
# `npm run ios:prod` / `ios:dev` do this automatically when they detect the
# problem, so you should not normally need this. It stays as a standalone
# escape hatch for when you want to register without a full deploy.
#
# Why registration is a thing at all: `xcrun devicectl list devices` seeing the
# watch is not the same as Xcode having registered it with Apple. Registration
# happens when the device is used as a build destination — and until it does,
# automatic signing silently falls back to the iOS wildcard profile
# ("iOS Team Provisioning Profile: *", Platform = iOS/xrOS/visionOS). The watch
# app then builds, signs and embeds cleanly, and watchOS refuses to install it
# with a bare "App could not be installed at this time".
set -e

CONFIG="${1:-Debug}"
case "$CONFIG" in
  Debug)     SCHEME="Watch" ;;
  Debug-Dev) SCHEME="Watch Dev" ;;
  *) echo "Unknown config '$CONFIG' — use Debug or Debug-Dev"; exit 1 ;;
esac

echo "==> Finding the paired Apple Watch…"
WATCH_ID=$(sh scripts/find-watch.sh) || {
  echo "No paired Apple Watch found with Developer Mode enabled."
  echo "On the watch: Settings > Privacy & Security > Developer Mode > On, then restart it."
  echo "Keep it unlocked and on the charger, near the Mac, and try again."
  xcrun devicectl list devices 2>/dev/null || true
  exit 1
}
echo "    watch: $WATCH_ID"
# The doctor checks profile-device coverage against this watch specifically;
# reuse what we already resolved rather than making it query again.
export BOOMERANG_WATCH_UDID="$WATCH_ID"

echo "==> Building scheme \"$SCHEME\" against the watch (registers it with your account)…"
echo "    This can pause while Apple issues the profile; that is the point of the run."
# Tee'd so the known failure modes can be recognised and answered concretely.
# Not checking the pipeline's exit status: under a pipe that is tee's status,
# and PIPESTATUS is not POSIX sh. xcodebuild's own banner is authoritative.
BUILDLOG=$(mktemp)
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$WATCH_ID" \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates \
  build 2>&1 | tee "$BUILDLOG" || true

# `-allowProvisioningUpdates` will renew profiles and mint certificates, but it
# does NOT register an unknown device — it fails with this instead. Grepping
# without the apostrophe on purpose: xcodebuild mixes straight and typographic
# ones in the same sentence.
if grep -q "registered in your developer account" "$BUILDLOG" 2>/dev/null; then
  echo ""
  echo "The watch is not registered with your developer account, and xcodebuild"
  echo "will not add it for you. Register it here:"
  echo ""
  echo "    https://developer.apple.com/account/resources/devices/list"
  echo ""
  echo "    Platform:   watchOS   <- a separate device class from iOS; a watch"
  echo "                             filed under iOS does not count"
  echo "    Device ID:  $WATCH_ID"
  echo ""
  echo "Then re-run this command. Nothing else needs changing — Developer Mode"
  echo "on the wrist and a device registration are two different things, and"
  echo "only the registration puts the watch into a provisioning profile."
  rm -f "$BUILDLOG"
  exit 1
fi

if ! grep -q 'BUILD SUCCEEDED' "$BUILDLOG" 2>/dev/null; then
  echo ""
  echo "The registration build failed for a reason this script does not know how"
  echo "to explain — read the xcodebuild errors above."
  rm -f "$BUILDLOG"
  exit 1
fi
rm -f "$BUILDLOG"

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
