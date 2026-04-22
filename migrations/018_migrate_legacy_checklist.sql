-- Migrate any legacy flat `checklist` items into the named `checklists` format.
-- For each task that still has items in checklist_json and NO entries in
-- checklists_json, wrap them as a single named "Checklist" list and clear
-- the legacy column. After this migration, no code should ever write to
-- checklist_json again — the column stays for now (SQLite column drops are
-- painful) but will be inert.
UPDATE tasks
SET
  checklists_json = json_array(
    json_object(
      'id', printf('cl-migrated-%s', id),
      'name', 'Checklist',
      'items', json(checklist_json),
      'hideCompleted', json('false')
    )
  ),
  checklist_json = '[]'
WHERE checklist_json IS NOT NULL
  AND checklist_json != ''
  AND checklist_json != '[]'
  AND (checklists_json IS NULL OR checklists_json = '' OR checklists_json = '[]');
