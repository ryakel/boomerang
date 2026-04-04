-- Migrate from flat checklist_json to named checklists_json
-- Wraps existing checklist data into the new format: [{id, name, items, hideCompleted}]
ALTER TABLE tasks ADD COLUMN checklists_json TEXT DEFAULT '[]';

-- Migrate existing checklist data: wrap non-empty arrays into a named checklist
UPDATE tasks
SET checklists_json = json_array(json_object(
  'id', lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
  'name', 'Checklist',
  'items', json(checklist_json),
  'hideCompleted', json('false')
))
WHERE checklist_json IS NOT NULL AND checklist_json != '[]' AND checklist_json != '';
