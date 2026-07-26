#!/bin/sh
# Print the hardware UDID of the paired PHYSICAL Apple Watch, or nothing.
# Exit 0 when one was found, 1 otherwise. Shared by ios-deploy.sh and
# watch-register.sh so the selection rules live in exactly one place.
#
# Two traps here, both of which cost a long debugging session on 2026-07-26.
# Neither is obvious from the output of either command in isolation.
#
# 1. `devicectl list devices` serves a CACHED record, and its
#    deviceProperties.developerModeStatus goes stale. For a watch that
#    `devicectl device info details` reported LIVE as "Enabled (1)", the
#    listing still said 'disabled'. This script used to filter on the cached
#    field, so it returned nothing — which silently disabled ios-deploy.sh's
#    register-and-rebuild branch. The watch was therefore never used as a build
#    destination, never got registered with the developer account, no watchOS
#    profile was ever issued, and automatic signing fell back to the iOS
#    wildcard ("iOS Team Provisioning Profile: *", Platform = iOS/xrOS/
#    visionOS). The watch app then built, signed and embedded cleanly and
#    watchOS refused to install it. Confirm Developer Mode with a live query or
#    do not confirm it at all; never trust the listing for it.
#
# 2. Watch UDIDs are NOT plain UUIDs — an earlier comment here claimed they
#    were. devicectl reports two ids per device: `identifier`, a GUID
#    (30B4B8C9-…), and hardwareProperties.udid, the real one
#    (00008310-001605683C40E01E — same shape as the iPhone's). devicectl
#    accepts either, but `xcodebuild -destination "id=…"` matches only the
#    hardware UDID, and watch-register.sh passes our output straight to
#    xcodebuild. Print the UDID.
#
# Filtering on `reality` stays: a watch simulator is a normal thing to have
# installed, and registering or installing to one accomplishes nothing while
# looking like it worked.
set -e

DEVJSON=$(mktemp)
xcrun devicectl list devices --json-output "$DEVJSON" >/dev/null 2>&1 || true
CANDIDATES=$(python3 - "$DEVJSON" <<'PYINNER'
import json, sys
try:
    devices = json.load(open(sys.argv[1])).get('result', {}).get('devices', [])
except Exception:
    devices = []
# Physical watches only. Deliberately NOT filtered on developerModeStatus —
# that field is cached and lies (see trap 1); the live check below owns it.
watches = []
for d in devices:
    hw = d.get('hardwareProperties', {})
    if (hw.get('reality') or '').lower() != 'physical':
        continue
    if (hw.get('platform') or '').lower() != 'watchos':
        continue
    udid = hw.get('udid') or d.get('identifier')
    if not udid:
        continue
    tunnel = (d.get('connectionProperties', {}).get('tunnelState') or '').lower()
    watches.append((0 if tunnel == 'connected' else 1, udid))
watches.sort()
for _, udid in watches:
    print(udid)
PYINNER
)
rm -f "$DEVJSON"

[ -n "$CANDIDATES" ] || exit 1

# Live Developer Mode check, one watch at a time. This costs a couple of
# seconds per device and is worth every one of them: it is the only reading of
# developerModeStatus that reflects the wrist.
FALLBACK=""
for UDID in $CANDIDATES; do
  DETAILS=$(xcrun devicectl device info details --device "$UDID" 2>/dev/null || true)
  case "$DETAILS" in
    *"Developer Mode Status: Enabled"*)
      echo "$UDID"
      exit 0
      ;;
    *"Developer Mode Status: Disabled"*)
      # Trustworthy no. The caller prints the enable-it instructions.
      continue
      ;;
    *)
      # No live answer at all — asleep, off the network, or the query failed.
      # That is not evidence against the watch, so keep it as a fallback.
      [ -n "$FALLBACK" ] || FALLBACK="$UDID"
      ;;
  esac
done

# Nothing answered "Enabled". Hand back a watch we merely could not reach
# rather than reporting none: the caller then fails with a real error from
# xcodebuild or devicectl, which beats the silent empty return of trap 1.
[ -n "$FALLBACK" ] || exit 1
echo "$FALLBACK"
