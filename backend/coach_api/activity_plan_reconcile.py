"""Small source revisions catch bulk SQL/import updates that bypass ORM signals."""
from django.db import connections
from django.utils import timezone


def fingerprints(profile_ids):
    if not profile_ids:
        return {}
    # Aggregate inside Postgres: only an ID and digest leave the database.
    # Include soft deletes, changed outcomes/links and imported source verdicts.
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''WITH wanted AS (
            SELECT l.id,md5(to_jsonb(l)::text || coalesce(to_jsonb(u)::text,'')) AS identity
            FROM "Learner".learners l LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
            WHERE l.id=ANY(%s)
        ), progress AS (
            SELECT p.learner_id,md5(string_agg(md5(jsonb_build_array(
                p.id,p.kind,p.component_ref,p.quiz_ref,p.module_ref,p.passed,p.submitted_at,p.deleted_at,
                p.source_system,p.component_link_source,p.activity_status,p.accepted,
                p.actual_seconds,p.source_payload->'course_display_placement',
                p.source_payload->'original_source_ref',p.source_payload->'reconciliation')::text),'' ORDER BY p.id)) AS revision
            FROM "Learner".learner_progress_entries p JOIN wanted w ON w.id=p.learner_id GROUP BY p.learner_id
        ), sources AS (
            SELECT s.learner_id,md5(string_agg(md5(jsonb_build_array(s.id,s.canonical_progress_id,
                s.source_catalog_activity_id,s.source_activity_id,s.source_system,s.completed,
                s.activity_status,s.curriculum_component_ref,s.deleted_at)::text),'' ORDER BY s.id)) AS revision
            FROM "Learner".learner_activity_sources s JOIN wanted w ON w.id=s.learner_id GROUP BY s.learner_id
        ), journal AS (
            SELECT j.canonical_learner_id,md5(string_agg(md5(jsonb_build_array(j.id,j.progress_id,
                j.source_id,j.group_id,j.activity_id,j.activity_date,j.deleted_at)::text),'' ORDER BY j.id)) AS revision
            FROM "Learner".learner_journal_rows j JOIN wanted w ON w.id=j.canonical_learner_id GROUP BY j.canonical_learner_id
        ) SELECT w.id,md5(w.identity || coalesce(p.revision,'') || coalesce(s.revision,'') || coalesce(j.revision,''))
            FROM wanted w LEFT JOIN progress p ON p.learner_id=w.id
            LEFT JOIN sources s ON s.learner_id=w.id LEFT JOIN journal j ON j.canonical_learner_id=w.id''', [list(profile_ids)])
        return dict(cursor.fetchall())


def reconcile():
    from .activity_plan_snapshots import store, mark_dirty
    # Already queued rows must keep their place. Repeatedly touching their
    # dirty timestamp could invalidate an in-flight build without a new edit.
    rows = list(store().filter(payload__has_key='sourceFingerprint', expires_at__gt=timezone.now())
                .values_list('scope_id', 'payload__sourceFingerprint'))
    current = fingerprints([int(pk) for pk, _ in rows])
    dirty = [int(pk) for pk, previous in rows if current.get(int(pk)) != previous]
    if dirty:
        mark_dirty(dirty)
    return len(dirty)
