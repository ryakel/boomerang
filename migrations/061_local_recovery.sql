CREATE TABLE IF NOT EXISTS adviser_entity_versions (
  kind TEXT NOT NULL, entity_id TEXT NOT NULL, field TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind, entity_id, field)
);
CREATE TABLE IF NOT EXISTS adviser_local_undo (
  execution_id TEXT NOT NULL, step_id TEXT NOT NULL, position INTEGER NOT NULL,
  kind TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, versions_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available', PRIMARY KEY(execution_id, step_id)
);
CREATE TRIGGER adviser_task_insert AFTER INSERT ON tasks BEGIN
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, '*', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, 'title', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, 'notes', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, 'due_date', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_task_delete AFTER DELETE ON tasks BEGIN
INSERT INTO adviser_entity_versions VALUES ('task', OLD.id, '*', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('task', OLD.id, 'title', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('task', OLD.id, 'notes', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('task', OLD.id, 'due_date', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_task_update AFTER UPDATE ON tasks BEGIN
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, '*', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_task_title AFTER UPDATE OF title ON tasks WHEN OLD.title IS NOT NEW.title BEGIN
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, 'title', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_task_notes AFTER UPDATE OF notes ON tasks WHEN OLD.notes IS NOT NEW.notes BEGIN
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, 'notes', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_task_due_date AFTER UPDATE OF due_date ON tasks WHEN OLD.due_date IS NOT NEW.due_date BEGIN
INSERT INTO adviser_entity_versions VALUES ('task', NEW.id, 'due_date', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_note_insert AFTER INSERT ON notes BEGIN
INSERT INTO adviser_entity_versions VALUES ('note', NEW.id, '*', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('note', NEW.id, 'body', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('note', NEW.id, 'pinned', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_note_delete AFTER DELETE ON notes BEGIN
INSERT INTO adviser_entity_versions VALUES ('note', OLD.id, '*', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('note', OLD.id, 'body', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
INSERT INTO adviser_entity_versions VALUES ('note', OLD.id, 'pinned', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_note_update AFTER UPDATE ON notes BEGIN
INSERT INTO adviser_entity_versions VALUES ('note', NEW.id, '*', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_note_body AFTER UPDATE OF body ON notes WHEN OLD.body IS NOT NEW.body BEGIN
INSERT INTO adviser_entity_versions VALUES ('note', NEW.id, 'body', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER adviser_note_pinned AFTER UPDATE OF pinned ON notes WHEN OLD.pinned IS NOT NEW.pinned BEGIN
INSERT INTO adviser_entity_versions VALUES ('note', NEW.id, 'pinned', 1) ON CONFLICT(kind,entity_id,field) DO UPDATE SET version=version+1;
END;
