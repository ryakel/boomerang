#!/bin/sh
# One command to rebuild the iOS app after pulling changes.
# Handles the step that's easy to forget: `npm install` (needed whenever a
# branch adds/changes a dependency — otherwise the Vite build fails with
# "failed to resolve import ...").
#
# Usage:  npm run ios      (preferred)
#   or:   sh scripts/ios-rebuild.sh
set -e

echo "==> 1/4  Installing dependencies (safe to run every time)…"
npm install

echo "==> 2/4  Building the web bundle…"
npm run build

echo "==> 3/4  Syncing the bundle + native config into Xcode…"
npx cap sync ios

echo "==> 4/4  Opening Xcode. Press the ▶ Run button (or Cmd-R) to launch."
npx cap open ios

echo "Done. If Xcode shows a signing error, pick your Team under the target's"
echo "Signing & Capabilities, then Run again."
