"""Canonical profile SQL reads; connections and schema probes are supplied by composition."""


def read_programme_profiles(
    programme_id, lifecycle_status='', *, strict=False, connection, learner_schema_table_exists,
    clean_str, rows_as_dicts, DatabaseError, logger,
):
    if connection.vendor != 'postgresql' or not learner_schema_table_exists('learners'):
        if strict:
            raise DatabaseError('The learner directory is unavailable.')
        canonical_rows = []
    else:
        try:
            params = [clean_str(programme_id)]
            status_sql = ''
            if lifecycle_status:
                status_sql = 'AND lower(l.lifecycle_status) = %s'
                params.append(clean_str(lifecycle_status).lower())
            from learner_api.learner_coach_columns import owner_coach_sql

            with connection.cursor() as cursor:
                cursor.execute(f"""
                    SELECT l.id, l.enrolment_id, l.full_name, l.email,
                           p.name AS programme, l.programme_status, c.cohort_name AS cohort,
                           g.group_name, l.cohort_id, l.group_id, l.lifecycle_status,
                           {owner_coach_sql('l', connection.alias)}, l.completed_hours, l.planned_hours,
                           l.target_hours, l.progress_hours, l.progress_variance, l.otjh_status
                    FROM "Learner".learners l
                    LEFT JOIN curriculum.programmes p ON p.programme_id = l.programme_id
                    LEFT JOIN curriculum.cohorts c ON c.cohort_id = l.cohort_id
                    LEFT JOIN curriculum.groups g ON g.group_id = l.group_id
                    WHERE l.programme_id = %s {status_sql}
                    ORDER BY lower(l.full_name), l.id
                """, params)
                canonical_rows = rows_as_dicts(cursor)
        except Exception as exc:
            if strict:
                raise
            logger.warning('Could not load assigned learners for programme %s: %s', programme_id, exc)
            canonical_rows = []
    return canonical_rows
