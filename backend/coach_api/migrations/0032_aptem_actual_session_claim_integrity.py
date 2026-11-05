"""Reserve imported Review provider identities on the physical Coach overlay table.

The calendar ORM model maps to a view; no calendar index is created here. This
migration is PostgreSQL-only and must not be run by the offline SQLite runners.
"""
from django.db import migrations


def require_postgresql(_apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        raise RuntimeError("Actual Session claim integrity requires PostgreSQL.")


FORWARD = r'''
CREATE FUNCTION "Coach".aptem_actual_session_claim_valid(
    doc jsonb, overlay_event_key text, overlay_profile_id integer,
    overlay_source_id bigint
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $claim$
DECLARE
    c jsonb;
    k text;
BEGIN
    -- Legacy rows without a claim are outside this new constraint.
    IF jsonb_typeof(doc) IS DISTINCT FROM 'object' THEN RETURN true; END IF;
    IF NOT (doc ? 'actualSession') THEN RETURN true; END IF;
    c := doc -> 'actualSession';
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    FOR k IN SELECT jsonb_object_keys(c) LOOP
        IF k <> ALL (ARRAY[
            'schemaVersion','selectionVersion','sourceReviewId','profileId',
            'calendarId','eventKey','overlayEventKey','ownerEmail','graphEventId',
            'bookingFingerprint','tenantId','organizerId','onlineMeetingId',
            'callId','reportId','associationMethod','claimedAt','actorAccountId'
        ]) THEN RETURN false; END IF;
    END LOOP;
    IF c -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
       OR c -> 'selectionVersion' IS DISTINCT FROM '1'::jsonb
       OR jsonb_typeof(c -> 'sourceReviewId') IS DISTINCT FROM 'number'
       OR (c ->> 'sourceReviewId') !~ '^[1-9][0-9]{0,18}$'
       OR c ->> 'sourceReviewId' IS DISTINCT FROM overlay_source_id::text
       OR jsonb_typeof(c -> 'profileId') IS DISTINCT FROM 'number'
       OR (c ->> 'profileId') !~ '^[1-9][0-9]{0,18}$'
       OR c ->> 'profileId' IS DISTINCT FROM overlay_profile_id::text
       OR jsonb_typeof(c -> 'calendarId') IS DISTINCT FROM 'number'
       OR (c ->> 'calendarId') !~ '^[1-9][0-9]{0,18}$'
       OR c ->> 'overlayEventKey' IS DISTINCT FROM overlay_event_key
       OR jsonb_typeof(c -> 'actorAccountId') IS DISTINCT FROM 'number'
       OR (c ->> 'actorAccountId') !~ '^[1-9][0-9]{0,18}$'
       OR c ->> 'associationMethod' IS DISTINCT FROM 'single-run-corroborated'
       OR jsonb_typeof(c -> 'claimedAt') IS DISTINCT FROM 'string'
       OR (c ->> 'claimedAt') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?Z$'
       OR jsonb_typeof(c -> 'bookingFingerprint') IS DISTINCT FROM 'string'
       OR (c ->> 'bookingFingerprint') !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(c -> 'tenantId') IS DISTINCT FROM 'string'
       OR (c ->> 'tenantId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR c ->> 'tenantId' = '00000000-0000-0000-0000-000000000000'
       OR jsonb_typeof(c -> 'organizerId') IS DISTINCT FROM 'string'
       OR (c ->> 'organizerId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR c ->> 'organizerId' = '00000000-0000-0000-0000-000000000000'
    THEN RETURN false; END IF;
    BEGIN
        PERFORM make_date(substring(c ->> 'claimedAt' from 1 for 4)::integer,
                          substring(c ->> 'claimedAt' from 6 for 2)::integer,
                          substring(c ->> 'claimedAt' from 9 for 2)::integer);
    EXCEPTION WHEN datetime_field_overflow THEN
        RETURN false;
    END;
    FOREACH k IN ARRAY ARRAY[
        'eventKey','overlayEventKey','ownerEmail','graphEventId','onlineMeetingId','callId','reportId'
    ] LOOP
        IF jsonb_typeof(c -> k) IS DISTINCT FROM 'string'
           OR octet_length(c ->> k) NOT BETWEEN 1 AND 240
           OR (c ->> k) !~ '^[!-~]+$'
           OR (c ->> k) LIKE '%://%'
        THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
END
$claim$;

ALTER TABLE "Coach"."coach_imported_review_instance"
    ADD CONSTRAINT aptem_actual_session_claim_valid
    CHECK ("Coach".aptem_actual_session_claim_valid(
        meeting_intelligence, event_key, learner_id, source_review_id));

CREATE UNIQUE INDEX aptem_actual_session_meeting_uniq
    ON "Coach"."coach_imported_review_instance" (
        ((meeting_intelligence #>> '{actualSession,tenantId}') COLLATE "C"),
        ((meeting_intelligence #>> '{actualSession,organizerId}') COLLATE "C"),
        ((meeting_intelligence #>> '{actualSession,onlineMeetingId}') COLLATE "C")
    ) WHERE meeting_intelligence ? 'actualSession';

CREATE UNIQUE INDEX aptem_actual_session_call_uniq
    ON "Coach"."coach_imported_review_instance" (
        ((meeting_intelligence #>> '{actualSession,tenantId}') COLLATE "C"),
        ((meeting_intelligence #>> '{actualSession,callId}') COLLATE "C")
    ) WHERE meeting_intelligence ? 'actualSession';

CREATE FUNCTION "Coach".aptem_actual_session_claim_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
DECLARE
    prior jsonb;
    incoming jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.meeting_intelligence ? 'actualSession' THEN
            RAISE EXCEPTION 'An Actual Session claim reserves historical provider identity.'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    incoming := NEW.meeting_intelligence -> 'actualSession';
    IF TG_OP = 'INSERT' THEN
        IF incoming IS NOT NULL THEN
            RAISE EXCEPTION 'An Actual Session claim requires an existing Review.'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    prior := OLD.meeting_intelligence -> 'actualSession';
    IF prior IS NOT NULL THEN
        IF incoming IS DISTINCT FROM prior
           OR NEW.source_review_id IS DISTINCT FROM OLD.source_review_id
           OR NEW.learner_id IS DISTINCT FROM OLD.learner_id
           OR NEW.event_key IS DISTINCT FROM OLD.event_key THEN
            RAISE EXCEPTION 'An Actual Session claim cannot be changed or transferred.'
                USING ERRCODE = '23514';
        END IF;
    ELSIF incoming IS NOT NULL THEN
        IF NEW.status NOT IN ('scheduled', 'in-progress')
           OR NEW.owner_email IS DISTINCT FROM incoming ->> 'ownerEmail' THEN
            RAISE EXCEPTION 'An Actual Session claim requires an owned editable Review.'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER aptem_actual_session_claim_guard
    BEFORE INSERT OR UPDATE OR DELETE ON "Coach"."coach_imported_review_instance"
    FOR EACH ROW EXECUTE FUNCTION "Coach".aptem_actual_session_claim_guard();
'''

REVERSE = r'''
DO $reverse$
BEGIN
    IF EXISTS (SELECT 1 FROM "Coach"."coach_imported_review_instance"
               WHERE meeting_intelligence ? 'actualSession') THEN
        RAISE EXCEPTION 'Refusing to release existing Actual Session claims.';
    END IF;
END
$reverse$;
DROP TRIGGER aptem_actual_session_claim_guard ON "Coach"."coach_imported_review_instance";
DROP FUNCTION "Coach".aptem_actual_session_claim_guard();
DROP INDEX "Coach".aptem_actual_session_call_uniq;
DROP INDEX "Coach".aptem_actual_session_meeting_uniq;
ALTER TABLE "Coach"."coach_imported_review_instance"
    DROP CONSTRAINT aptem_actual_session_claim_valid;
DROP FUNCTION "Coach".aptem_actual_session_claim_valid(jsonb, text, integer, bigint);
'''


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0031_merge_coaching_features")]
    operations = [
        migrations.RunPython(require_postgresql, migrations.RunPython.noop),
        migrations.RunSQL(FORWARD, REVERSE),
    ]
