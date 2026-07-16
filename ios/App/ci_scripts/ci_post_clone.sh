#!/bin/sh
# Xcode Cloud post-clone hook. Xcode Cloud clones the repo and runs xcodebuild
# — nothing else — so the web bundle (dist/) and the Capacitor sync output
# (ios/App/App/public + capacitor.config.json) don't exist yet. This script
# builds them, exactly like the local one-liners do, before the archive step.
#
# Lives in ios/App/ci_scripts/ because Xcode Cloud looks for ci_scripts next
# to the .xcodeproj it's building.
set -e
set -x

# Node isn't on the Xcode Cloud runners by default; Homebrew is.
if ! command -v node >/dev/null 2>&1; then
  export HOMEBREW_NO_AUTO_UPDATE=1
  export HOMEBREW_NO_INSTALL_CLEANUP=1
  brew install node
fi
node --version
npm --version

# Repo root (CI_PRIMARY_REPOSITORY_PATH is set by Xcode Cloud; fall back to
# walking up from this script for local testing).
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_ROOT"

npm ci
npm run build
npx cap sync ios

# TestFlight rejects re-used build numbers. Xcode Cloud provides a
# monotonically increasing CI_BUILD_NUMBER — stamp it into the project so
# every cloud build uploads cleanly. Local builds keep the static value.
if [ -n "$CI_BUILD_NUMBER" ]; then
  cd "$REPO_ROOT/ios/App"
  xcrun agvtool new-version -all "$CI_BUILD_NUMBER"
fi

echo "ci_post_clone complete"
