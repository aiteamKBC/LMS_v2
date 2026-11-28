-- Captured SELECT-only from verified Development on 2026-11-26.
-- Test fixture only: never apply this file to an application database.

-- Finalization guard is loaded separately from finalization_guard.sql.

CREATE OR REPLACE FUNCTION "Learner".sync_journal_document_to_activity_ssot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    linked_progress_id BIGINT;
BEGIN
    SELECT j.progress_id
    INTO STRICT linked_progress_id
    FROM "Learner".learner_journal_rows j
    WHERE j.id = NEW.manual_activity_id
      AND j.learner_id = NEW.learner_id;

    IF TG_OP = 'UPDATE' THEN
        UPDATE "Learner".learner_activity_documents s
        SET
            container = NEW.container,
            blob_name = NEW.blob_name,
            display_name = NEW.display_name,
            content_type = COALESCE(NEW.content_type, ''),
            size_bytes = NEW.size_bytes,
            uploaded_by = COALESCE(NEW.uploaded_by, ''),
            uploaded_at = NEW.uploaded_at,
            deleted_at = CASE
                WHEN OLD.deleted_at IS NULL
                 AND NEW.deleted_at IS NOT NULL
                THEN COALESCE(s.deleted_at, NEW.deleted_at)
                ELSE s.deleted_at
            END,
            updated_at = NOW()
        WHERE s.source_system = 'journal'
          AND s.source_document_id =
              'manual-document:' || NEW.id::TEXT
          AND s.learner_id = NEW.learner_id;

        IF FOUND THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO "Learner".learner_activity_documents (
        learner_id,
        progress_id,
        source_system,
        source_document_id,
        container,
        blob_name,
        display_name,
        content_type,
        size_bytes,
        uploaded_by,
        uploaded_at,
        deleted_at,
        created_at,
        updated_at
    )
    VALUES (
        NEW.learner_id,
        linked_progress_id,
        'journal',
        'manual-document:' || NEW.id::TEXT,
        NEW.container,
        NEW.blob_name,
        NEW.display_name,
        COALESCE(NEW.content_type, ''),
        NEW.size_bytes,
        COALESCE(NEW.uploaded_by, ''),
        NEW.uploaded_at,
        NEW.deleted_at,
        COALESCE(NEW.uploaded_at, NOW()),
        NOW()
    )
    ON CONFLICT (source_system, source_document_id)
    DO NOTHING;

    RETURN NEW;
END;
$function$;


CREATE TRIGGER trg_guard_finalized_manual_docs BEFORE INSERT OR DELETE OR UPDATE ON "Learner".manual_activity_documents FOR EACH ROW EXECUTE FUNCTION "Learner".guard_finalized_journal_month();

CREATE TRIGGER trg_sync_journal_document_to_activity_ssot AFTER INSERT OR UPDATE ON "Learner".manual_activity_documents FOR EACH ROW EXECUTE FUNCTION "Learner".sync_journal_document_to_activity_ssot();