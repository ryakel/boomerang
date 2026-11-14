#!/bin/sh
# Source from the iOS entry points. Select Xcode for this process only; never
# change the Mac's global xcode-select setting or inherit a stale beta override.
# Optional explicit alternative: BOOMERANG_XCODE_APP=/path/to/Xcode.app.
if [ "$(uname -s)" != Darwin ]; then
  echo "The iOS scripts need a Mac with Xcode installed." >&2
  exit 1
fi

BOOMERANG_XCODE_APP=${BOOMERANG_XCODE_APP:-/Applications/Xcode.app}
BOOMERANG_XCODE_APP=${BOOMERANG_XCODE_APP%/}
DEVELOPER_DIR="$BOOMERANG_XCODE_APP/Contents/Developer"
if [ ! -d "$DEVELOPER_DIR" ]; then
  echo "Xcode developer directory not found: $DEVELOPER_DIR" >&2
  echo "Install standard Xcode at /Applications/Xcode.app, or explicitly set BOOMERANG_XCODE_APP." >&2
  exit 1
fi
export BOOMERANG_XCODE_APP DEVELOPER_DIR
printf 'Using Xcode: %s\n' "$BOOMERANG_XCODE_APP"
xcodebuild -version
