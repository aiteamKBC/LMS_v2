"""KSB source persistence, freshness reads, module locks and conversion assignment cleanup.

Dependencies are supplied at the existing composition seam; no legacy views import.
"""


def set_programme_modules_ksb_source(
    programme_values,
    source_value,
    *,
    AUTHORING_MODULES_TABLE,
    authoring_fetch_all,
    authoring_table_name,
    clean_str,
    connection,
    datetime,
    ensure_module_authoring_tables,
    load_content_cache,
    normalise,
    normalise_ksb_profile_source_value,
    table_name,
    unique,
    update_authoring_rows,
):
    """Module selectors inherit the programme pair; there is no copied column."""
    from curriculum_api import content_cache
    content_cache.retire_all()
    return 0


def component_source_inputs_fingerprint(*, authoring_table_name, column_names, connection, quote_ident, table_exists):
    """What a mapping's inferred KSB source depends on beyond the curriculum epoch.

    The component reads infer a mapping's source from the Skills England KSBs
    (``ksb_standard_definitions``). It is not written through a curriculum handler, so no
    epoch bump retires a cached read when it changes. This is its row count and
    newest stamp: one round trip, taken when a cached entry passes its ttl, so
    the entry is rebuilt only when it has moved (see cached_curriculum_value's
    ``fingerprint``).
    """
    parts = []
    for table in ('ksb_standard_definitions',):
        if not table_exists(table):
            parts.append((table, None))
            continue
        stamps = [column for column in ('updated_at', 'date_updated') if column in column_names(table)]
        stamp_sql = ', '.join(f'max({quote_ident(column)})::text' for column in stamps) or 'null'
        with connection.cursor() as cursor:
            cursor.execute(f'select count(*), {stamp_sql} from {authoring_table_name(table)}')
            parts.append((table, tuple(cursor.fetchone())))
    return tuple(parts)


def lock_module_structure_row(
    module_catalogue_id,
    *,
    AUTHORING_MODULES_TABLE,
    authoring_table_name,
    clean_str,
    connection,
    course,
    quote_ident,
):
    """Hold this module's row for the rest of the transaction.

    Without it the revision check is a read followed by a write, and two saves
    that both read revision 41 both pass it -- the second overwriting the first
    with the very payload the check exists to refuse. The lock makes
    check-and-write one operation: the second save blocks here until the first
    commits, then reads the revision the first one produced and is refused.

    SQLite (the test runner) has no row locks and needs none: a write
    transaction takes the whole database.
    """
    if connection.vendor != 'postgresql':
        return
    if course(clean_str(module_catalogue_id), lock=True):
        return
    with connection.cursor() as cursor:
        cursor.execute(
            'select 1 from %s where %s = %%s for update'
            % (
                authoring_table_name(AUTHORING_MODULES_TABLE),
                quote_ident('module_catalogue_id'),
            ),
            [clean_str(module_catalogue_id)],
        )
        cursor.fetchall()


def _scrub_free_course_learner_assignments(course_id, *, clean_str, connection, json):
    """Remove a moved free course from every learner it was assigned to.

    ``free_course_ref`` is a plain reference with no FK cascade, so deleting the
    course would otherwise leave orphans. ``default`` and ``enrolment`` are the
    same physical Neon database, so this raw cross-schema SQL runs on the
    curriculum connection and stays inside the convert transaction (the ORM would
    use the ``enrolment`` alias — a separate connection, a separate transaction).
    """
    course_id = clean_str(course_id)
    if not course_id:
        return
    marker = json.dumps([{'freeCourseId': course_id}])
    with connection.cursor() as cursor:
        # Enrolment source of truth: drop the matching element from each learner's
        # Free_courses JSONB. `is distinct from` keeps non-matching and malformed
        # (null-key) elements rather than silently dropping them.
        cursor.execute(
            '''
            update "enrolment"."Created_users"
               set "Free_courses" = coalesce((
                     select jsonb_agg(elem)
                       from jsonb_array_elements("Free_courses"::jsonb) elem
                      where elem->>'freeCourseId' is distinct from %s
                   ), '[]'::jsonb)
             where "Free_courses"::jsonb @> %s::jsonb
            ''',
            [course_id, marker],
        )
        # Relational mirror kept by the learner-side sync.
        cursor.execute(
            'delete from "Learner"."learner_free_courses" where free_course_ref = %s',
            [course_id],
        )
