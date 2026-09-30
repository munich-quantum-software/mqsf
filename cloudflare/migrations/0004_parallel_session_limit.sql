-- Check starts inside the changed interval, including its own start. Ends are exclusive.
-- The database enforces the limit atomically, including concurrent saves and restores.
CREATE TRIGGER IF NOT EXISTS events_insert_capacity AFTER INSERT ON events BEGIN
  SELECT RAISE(ABORT, 'MQSF_MAX_PARALLEL_SESSIONS') WHERE EXISTS (
    SELECT 1 FROM events AS point
    WHERE point.date = NEW.date AND point.start >= NEW.start AND point.start < NEW.end
      AND (SELECT COUNT(*) FROM events AS active
           WHERE active.date = NEW.date AND active.start <= point.start AND active.end > point.start) > 3
  );
END;

CREATE TRIGGER IF NOT EXISTS events_update_capacity AFTER UPDATE OF date, start, end ON events BEGIN
  SELECT RAISE(ABORT, 'MQSF_MAX_PARALLEL_SESSIONS') WHERE EXISTS (
    SELECT 1 FROM events AS point
    WHERE point.date = NEW.date AND point.start >= NEW.start AND point.start < NEW.end
      AND (SELECT COUNT(*) FROM events AS active
           WHERE active.date = NEW.date AND active.start <= point.start AND active.end > point.start) > 3
  );
END;
