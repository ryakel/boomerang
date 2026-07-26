#!/bin/sh
# Print the identifier of the paired PHYSICAL Apple Watch, or nothing.
# Exit 0 when one was found, 1 otherwise. Shared by ios-deploy.sh and
# watch-register.sh so the selection rules live in exactly one place.
#
# 'reality' is the field behind devicectl's Reality column (physical vs
# simulated). Registering or installing to a simulated watch accomplishes
# nothing while looking like it worked, and a watch simulator is a normal thing
# to have installed — so filter on that rather than on any UDID-shape
# heuristic. Watch UDIDs are plain UUIDs, so the hardware-UDID regex the iPhone
# finder uses does not transfer.
set -e

DEVJSON=$(mktemp)
xcrun devicectl list devices --json-output "$DEVJSON" >/dev/null 2>&1 || true
WATCH_ID=$(python3 - "$DEVJSON" <<'PYINNER'
import json, sys
try:
    devices = json.load(open(sys.argv[1])).get('result', {}).get('devices', [])
except Exception:
    devices = []
for d in devices:
    hw = d.get('hardwareProperties', {})
    if (hw.get('reality') or '').lower() != 'physical':
        continue
    if (hw.get('platform') or '').lower() != 'watchos':
        continue
    if (d.get('deviceProperties', {}).get('developerModeStatus') or '') == 'disabled':
        continue
    # devicectl accepts either as `-destination id=` / `--device`; the
    # identifier is what it prints in its own table and is always present.
    print(d.get('identifier') or hw.get('udid') or '')
    break
PYINNER
)
rm -f "$DEVJSON"

[ -n "$WATCH_ID" ] || exit 1
echo "$WATCH_ID"
