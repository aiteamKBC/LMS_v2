"""Read the existing learner-side achievement cache fingerprint."""
import time


def achievement_inputs_fingerprint(
    programme_id,
    cache_key,
    *,
    ACHIEVEMENT_INPUTS_MAX_AGE_SECONDS,
    DatabaseError,
    _ACHIEVEMENT_LEARNER_IDS,
    component_source_inputs_fingerprint,
    connection,
    logger,
):
    """Whether the learner data behind a cached Achievement read has moved.

    One round trip, one row back: every placement (the whole learners table is
    ~500 rows), and for this programme's learners -- by programme id, plus the
    ids the last build read -- their progress entries, those entries' KSB rows,
    and the KSB exclusion registry, each folded to a count and a sum of row
    hashes over every column the read depends on. Order-independent, so no sort:
    ~0.5 s on the server for the largest programme, against a rebuild that
    ships ~9 MB of progress rows. The curriculum side (components, mappings,
    required KSBs) is the programme's cache generation plus
    component_source_inputs_fingerprint. Any read failure answers a value that
    never matches, so the entry is rebuilt rather than trusted.
    """
    learner_ids = sorted(int(value) for value in (_ACHIEVEMENT_LEARNER_IDS.get(cache_key) or ()) if str(value).isdigit())
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                with scoped as (
                    select id from "Learner".learners where programme_id = %s or id = any(%s)
                ), entries as (
                    select p.id, hashtext(concat_ws('|', p.id, p.learner_id, p.kind, p.passed, p.component_ref,
                           p.component_title, p.component_type, p.module_ref, p.module_title, p.week_ref,
                           p.week_title, p.submitted_at, p.programme_ref, p.cohort_ref, p.group_ref,
                           p.deleted_at, p.ssot_updated_at)) as h
                    from "Learner".learner_progress_entries p
                    where p.learner_id in (select id from scoped)
                )
                select
                    (select count(*)::text || ':' || coalesce(sum(hashtext(concat_ws('|', l.id, l.full_name,
                            l.programme_id, l.cohort_id, l.group_id, l.programme_status, l.lifecycle_status,
                            l.updated_at,l.standard_ref,l.standard_version))::bigint), 0) from "Learner".learners l),
                    (select count(*)::text || ':' || coalesce(sum(h::bigint), 0) from entries),
                    (select count(*)::text || ':' || coalesce(sum(hashtext(concat_ws('|', k.progress_id, k.position,
                            k.ksb_code, k.weight, k.weight_class,k.standard_ksb_id,k.is_excluded,k.mapping_status))::bigint), 0)
                       from "Learner".ksb_learner_progress k where k.progress_id in (select id from entries)),
                    (select count(*)::text || ':' || coalesce(sum(hashtext(concat_ws('|', d.id,
                            d.standard_ref,d.standard_version,d.ksb_code,d.ksb_description))::bigint), 0)
                       from curriculum.ksb_standard_definitions d)
                ''',
                [programme_id, learner_ids],
            )
            learner_side = tuple(cursor.fetchone())
    except DatabaseError:
        logger.warning('Could not fingerprint KSB achievement inputs for %s.', programme_id, exc_info=True)
        return ('unavailable', time.monotonic())
    return (
        learner_side,
        component_source_inputs_fingerprint(),
        int(time.time() // ACHIEVEMENT_INPUTS_MAX_AGE_SECONDS),
    )
