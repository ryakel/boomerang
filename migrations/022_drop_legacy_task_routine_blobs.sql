-- Drop legacy app_data.tasks and app_data.routines JSON blobs.
--
-- Migrations 002 (tasks table) and 003 (routines table) replaced these blobs
-- with proper SQL tables. seedFromJsonBlobs() in db.js used to read these on
-- every server boot and re-populate the SQL tables if they were empty —
-- making any event that emptied the tasks/routines tables (corruption,
-- accidental drop, restore-with-empty-arrays) silently re-hydrate from a
-- months-stale snapshot instead of surfacing the failure.
--
-- The seed function was deleted on 2026-05-08. This migration cleans up the
-- now-orphaned rows so they don't sit in app_data forever.
DELETE FROM app_data WHERE collection = 'tasks';
DELETE FROM app_data WHERE collection = 'routines';
