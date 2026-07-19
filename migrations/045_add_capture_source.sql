-- Voice/quick capture provenance (2026-07-19): tasks created through the
-- POST /api/capture endpoint (Siri shortcut, dictation, future capture
-- surfaces) record where they came from. NULL = not created via capture
-- (unchanged behavior for every existing task); a value ('siri', 'shortcut',
-- 'manual', 'api', ...) doubles as the created-via-capture flag so a future
-- digest can call out voice-captured items for triage.
ALTER TABLE tasks ADD COLUMN capture_source TEXT DEFAULT NULL;
