#!/bin/sh
# Mac-only unsigned compilation. Does not install, launch, arm alarms, or deploy.
set -eu
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ]; then
  echo "This check needs a Mac with Xcode (26.1+ SDK; use Xcode 27 for the owner's iOS 27 phone)." >&2
  exit 1
fi
xcodebuild -version
PROBE_SDK=$(xcrun --sdk iphonesimulator --show-sdk-version)
node --input-type=module -e '
  const [major, minor = 0] = process.argv[1].split(".").map(Number)
  if (!(major > 26 || (major === 26 && minor >= 1))) {
    console.error("The alarm experiment needs the iOS 26.1+ SDK."); process.exit(1)
  }
' "$PROBE_SDK"
npm run test:alarm-probe
npm run build:mobile
PROBE_BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/boomerang-alarm-build.XXXXXX")
echo "Unsigned build artifacts: $PROBE_BUILD_DIR"
for PROBE_SCHEME in "App Dev" App; do
  case "$PROBE_SCHEME" in
    "App Dev") PROBE_CONFIG=Debug-Dev ;;
    App) PROBE_CONFIG=Debug ;;
  esac
  xcodebuild -project ios/App/App.xcodeproj -scheme "$PROBE_SCHEME" \
    -configuration "$PROBE_CONFIG" -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$PROBE_BUILD_DIR" \
    CODE_SIGNING_ALLOWED=NO build
  PROBE_APP="$PROBE_BUILD_DIR/Build/Products/$PROBE_CONFIG-iphonesimulator/App.app"
  test -d "$PROBE_APP/PlugIns/AlarmProbeWidget.appex"
  /usr/libexec/PlistBuddy -c 'Print :NSAlarmKitUsageDescription' "$PROBE_APP/Info.plist"
  /usr/libexec/PlistBuddy -c 'Print :NSSupportsLiveActivities' "$PROBE_APP/Info.plist"
done
echo "Both simulator builds and extension packaging passed. Physical-device sound/snooze are still unverified."
