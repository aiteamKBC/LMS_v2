-- Captured READ ONLY from verified Development, 2026-11-26. Isolated tests ONLY.
CREATE OR REPLACE FUNCTION "Learner".guard_finalized_journal_month()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    old_learner_id BIGINT;
    old_month TEXT;
    new_learner_id BIGINT;
    new_month TEXT;
    scope RECORD;
    latest_event TEXT;
BEGIN
    IF TG_TABLE_NAME = 'manual_activity_documents' THEN

        IF TG_OP <> 'INSERT' THEN
            SELECT j.learner_id, j.month
            INTO STRICT old_learner_id, old_month
            FROM "Learner".learner_journal_rows j
            WHERE j.id = OLD.manual_activity_id
              AND j.learner_id = OLD.learner_id;
        END IF;

        IF TG_OP <> 'DELETE' THEN
            SELECT j.learner_id, j.month
            INTO STRICT new_learner_id, new_month
            FROM "Learner".learner_journal_rows j
            WHERE j.id = NEW.manual_activity_id
              AND j.learner_id = NEW.learner_id;
        END IF;

    ELSE

        IF TG_OP <> 'INSERT' THEN
            old_learner_id := OLD.learner_id;
            old_month := OLD.month;
        END IF;

        IF TG_OP <> 'DELETE' THEN
            new_learner_id := NEW.learner_id;
            new_month := NEW.month;
        END IF;

    END IF;

    IF TG_OP <> 'INSERT'
       AND (old_learner_id IS NULL OR old_month IS NULL)
    THEN
        RAISE EXCEPTION 'Invalid old journal scope';
    END IF;

    IF TG_OP <> 'DELETE'
       AND (new_learner_id IS NULL OR new_month IS NULL)
    THEN
        RAISE EXCEPTION 'Invalid new journal scope';
    END IF;

    FOR scope IN
        SELECT DISTINCT
            v.learner_id,
            v.report_month
        FROM (
            VALUES
                (old_learner_id, old_month),
                (new_learner_id, new_month)
        ) AS v(learner_id, report_month)
        JOIN "Learner".learners l
            ON l.id = v.learner_id
        ORDER BY v.learner_id, v.report_month
    LOOP

        PERFORM pg_advisory_xact_lock(hashtextextended(
            'canonical-journal-finalization:' || scope.learner_id::text || ':' || scope.report_month, 0));

        SELECT e.event_type
        INTO latest_event
        FROM "Learner".manual_month_finalization_events e
        WHERE e.learner_id = scope.learner_id
          AND e.report_month = scope.report_month
        ORDER BY e.id DESC
        LIMIT 1;

        IF latest_event = 'finalized' THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE =
                    'Journal month is finalized and read-only: '
                    || scope.learner_id::TEXT
                    || '/'
                    || scope.report_month;
        END IF;

    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION "Learner".lock_manual_finalization_event_scope()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'canonical-journal-finalization:' || NEW.learner_id::text || ':' || NEW.report_month, 0));
    RETURN NEW;
END;
$function$
;
CREATE TRIGGER trg_guard_finalized_manual_docs BEFORE INSERT OR DELETE OR UPDATE ON "Learner".manual_activity_documents FOR EACH ROW EXECUTE FUNCTION "Learner".guard_finalized_journal_month();
CREATE TRIGGER trg_guard_finalized_manual_rows BEFORE INSERT OR DELETE OR UPDATE ON "Learner".learner_journal_rows FOR EACH ROW EXECUTE FUNCTION "Learner".guard_finalized_journal_month();
CREATE TRIGGER trg_lock_manual_finalization_event_scope BEFORE INSERT ON "Learner".manual_month_finalization_events FOR EACH ROW EXECUTE FUNCTION "Learner".lock_manual_finalization_event_scope();
