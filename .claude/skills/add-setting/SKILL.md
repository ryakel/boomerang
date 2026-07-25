---
name: add-setting
description: Decision tree for adding any new setting to Boomerang. Load before adding a key to settings, app_data, or the Settings UI — the sync blob's last-writer-wins semantics have destroyed data twice.
---

# Adding a setting safely

The bulk settings sync pushes the WHOLE settings blob, last writer wins. A stale client (unhydrated localStorage, a `pagehide` sendBeacon) can overwrite the server's copy within seconds. Two real incidents: the erased streak-anchor repair and the "toggle never saves" `pushover_open_native` loop. Full history: `wiki/Claude-Notes-Platform.md` (Derived-Stat Durability Rules).

## Decision tree

1. **Is it a secret** (API key, token, credential)?
   → Server-only if possible (env var or `app_data` never round-tripped to the browser). If it must be a setting, add it to the Quokka secret blocklist in `adviserToolsMisc.js` (write-block + read-redaction) and to the Security Posture list in `wiki/Claude-Notes-Platform.md`.

2. **Must it survive cross-device conflicts** (anchors, high-water marks, earned values, unions)?
   → Server-side per-key merge guard in `mergeDurableStreakSettings()` (`server/server.js`): backward-only for anchors, union for sets. Client-side guards cannot fix this — any unhydrated device is a loaded gun.

3. **Is it a boolean/small value that must never silently revert?**
   → Give it its own `app_data` carve-out key with dedicated GET/POST endpoints (the `pushover_link_mode` pattern), NOT the synced blob. `preserveAbsentSettings()` protects a key only when a stale client omits it — an explicit stale `false` still wins in the blob.

4. **Ordinary preference?**
   → The settings blob is fine. `preserveAbsentSettings()` keeps it from being erased by pre-feature clients.

## Always

- [ ] Give it a UI control in the right Settings tab (or Quokka access) — never ship a dead setting; the 2026-07-11 IA audit found several gated features nobody could enable.
- [ ] Notification-type toggles: display-gate by the channel master.
- [ ] Default in `src/store.js`; document in `wiki/Configuration.md`; Version-History entry.
- [ ] If Quokka may write it, confirm it's non-secret — Quokka `update_settings` writes bypass the sync-path guards via `setData()` (deliberate: repairs must stick).
