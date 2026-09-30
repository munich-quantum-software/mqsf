ALTER TABLE events ADD COLUMN table_number INTEGER
  CHECK (table_number IS NULL OR table_number IN (1, 2, 3));

-- Unassigned sessions stay valid. Assigned sessions cannot share a table at the same time.
CREATE TRIGGER events_insert_table AFTER INSERT ON events WHEN NEW.table_number IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'MQSF_TABLE_OCCUPIED') WHERE EXISTS (
    SELECT 1 FROM events WHERE id != NEW.id AND date = NEW.date AND table_number = NEW.table_number
      AND start < NEW.end AND end > NEW.start
  );
END;

CREATE TRIGGER events_update_table AFTER UPDATE OF date, start, end, table_number ON events
WHEN NEW.table_number IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'MQSF_TABLE_OCCUPIED') WHERE EXISTS (
    SELECT 1 FROM events WHERE id != NEW.id AND date = NEW.date AND table_number = NEW.table_number
      AND start < NEW.end AND end > NEW.start
  );
END;

-- Include table assignments in the existing private history and notification outbox.
DROP TRIGGER events_created_history;
DROP TRIGGER events_updated_history;
DROP TRIGGER events_deleted_history;

CREATE TRIGGER events_created_history AFTER INSERT ON events BEGIN
  INSERT INTO event_changes(event_id, action, before_json, after_json)
  VALUES (NEW.id, 'created', NULL, json_object('id', NEW.id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'title', NEW.title, 'description', NEW.description, 'audience', NEW.audience, 'organizers', NEW.organizers, 'version', NEW.version, 'updated_at', NEW.updated_at, 'contact_email', NEW.contact_email, 'table_number', NEW.table_number));
END;

CREATE TRIGGER events_updated_history AFTER UPDATE ON events BEGIN
  INSERT INTO event_changes(event_id, action, before_json, after_json)
  VALUES (NEW.id, 'updated', json_object('id', OLD.id, 'date', OLD.date, 'start', OLD.start, 'end', OLD.end, 'title', OLD.title, 'description', OLD.description, 'audience', OLD.audience, 'organizers', OLD.organizers, 'version', OLD.version, 'updated_at', OLD.updated_at, 'contact_email', OLD.contact_email, 'table_number', OLD.table_number), json_object('id', NEW.id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'title', NEW.title, 'description', NEW.description, 'audience', NEW.audience, 'organizers', NEW.organizers, 'version', NEW.version, 'updated_at', NEW.updated_at, 'contact_email', NEW.contact_email, 'table_number', NEW.table_number));
END;

CREATE TRIGGER events_deleted_history AFTER DELETE ON events BEGIN
  INSERT INTO event_changes(event_id, action, before_json, after_json)
  VALUES (OLD.id, 'deleted', json_object('id', OLD.id, 'date', OLD.date, 'start', OLD.start, 'end', OLD.end, 'title', OLD.title, 'description', OLD.description, 'audience', OLD.audience, 'organizers', OLD.organizers, 'version', OLD.version, 'updated_at', OLD.updated_at, 'contact_email', OLD.contact_email, 'table_number', OLD.table_number), NULL);
END;
