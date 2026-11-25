"""Programme read operations; legacy adapters supply explicit existing capabilities.

HTTP, cache lifetime, authorization and writes remain in the outer adapters.
"""
from collections import Counter
from . import authoring_columns as _columns


def _authoring():
    from . import authoring_runtime
    return authoring_runtime


def _live_rows_sql(table):
    from .authoring_sql import live_authoring_rows_sql
    return live_authoring_rows_sql(table)

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise


def active_learner_programme_counts(
    *,
    clean_str=_default_clean_str,
    connection,
    learner_relation_exists,
    learners_link_programme_by_id,
    logger,
    normalise=_default_normalise,
    schema_compat,
):
    """Count learners per programme from the canonical learner table.

    Returns ``(by_programme_id, by_name_for_unlinked)``. A learner carrying an
    explicit ``programme_id`` counts only toward that one programme; a learner
    without one still counts by name so rows predating the link do not vanish
    from the card. Keeping the two apart is what stops two programmes sharing a
    name -- an archived one and its replacement -- from both claiming the same
    learner.
    """
    by_id = Counter()
    by_name = Counter()
    if connection.vendor != 'postgresql':
        return dict(by_id), dict(by_name)
    try:
        if learner_relation_exists('learners'):
            has_programme_id = learners_link_programme_by_id()
            id_column = 'programme_id' if has_programme_id else "''"
            # The normalised Learner.learners keeps only programme_id: there a
            # learner counts by id alone (the name bucket below stays empty).
            # Unknown columns keep the original statement.
            learner_columns = schema_compat.columns_of('Learner', 'learners')
            with connection.cursor() as cursor:
                if learner_columns and 'programme' not in learner_columns:
                    cursor.execute(
                        f"select '', coalesce({id_column}, ''), count(*) "
                        'from "Learner"."learners" '
                        f"where coalesce(btrim({id_column}), '') <> '' "
                        f"group by coalesce({id_column}, '')"
                    )
                else:
                    # Counted by the database, one row per distinct pair, rather
                    # than one row per learner; the buckets below are unchanged.
                    cursor.execute(
                        f'select programme, coalesce({id_column}, \'\'), count(*) '
                        'from "Learner"."learners" '
                        "where coalesce(btrim(programme), '') <> '' "
                        f'group by programme, coalesce({id_column}, \'\')'
                    )
                for programme_name, programme_id, learner_count in cursor.fetchall():
                    linked_id = clean_str(programme_id)
                    if linked_id:
                        by_id[linked_id] += learner_count
                        continue
                    programme_key = normalise(programme_name)
                    if not programme_key:
                        continue
                    by_name[programme_key] += learner_count
    except Exception as exc:
        logger.warning('Could not count active learners by programme: %s', exc)
    return dict(by_id), dict(by_name)


def programme_list_learner_counts(
    source,
    *,
    active_learner_programme_counts,
    clean_str=_default_clean_str,
    fetch_all,
):
    if 'has_learner_table' not in source:
        return active_learner_programme_counts()
    if not source['has_learner_table']:
        return {}, {}
    # By programme_id only: the normalised Learner.learners has no programme name
    # column, so there is no by-name bucket to fill. Like the rule it replaced,
    # this does not filter lifecycle_status. Grouped in SQL so no rows travel.
    rows = fetch_all('''
        select coalesce(programme_id::text, '') as programme_id, count(*) as learner_count
        from "Learner"."learners" learner
        where btrim(coalesce(programme_id::text, '')) <> ''
        group by 1
    ''')
    by_id = Counter()
    for row in rows:
        programme_id = clean_str(row['programme_id'])
        if programme_id:
            by_id[programme_id] += row['learner_count']
    return dict(by_id), {}


def home_source_rows(
    visibility,
    *,
    authoring_modules_as_catalogue_rows,
    authoring_modules_as_training_rows,
    curriculum_names,
    decode_counts,
    home_relationship_rows,
    serialize_cohort_authoring_detail,
    serialize_group_authoring_detail,
):
    """Read each relationship table once; Home needs no holiday/schedule detail.

    The ordinary overview keeps its full source path. Use the same serializers
    and grouping rules here, but pass already-read rows instead of asking them
    to read the same tables again under different SQL orderings.
    """
    relationships = home_relationship_rows(include_weeks=visibility == 'all')
    modules, groups, cohorts = (relationships[key] for key in ('modules', 'groups', 'cohorts'))
    # The raw jsonb_agg path bypasses authoring_fetch_all's curriculum_names.attach(),
    # which resolves tutor_name (modules.tutor_id -> tutors) and coach_name
    # (group_coaches -> coaches) in the normalised schema. Apply before training
    # rows are built, as those read tutor_name and coach_name from these rows.
    curriculum_names.attach('modules', modules)
    curriculum_names.attach('groups', groups)
    training = authoring_modules_as_training_rows(
        module_rows=modules, group_rows=groups, cohort_rows=cohorts,
    )
    # Operational delivery rows already carry a numeric sessions_number,
    # including zero. Only unused catalogue modules fall back to week titles.
    weeks = relationships.get('weeks', [])
    catalogue = authoring_modules_as_catalogue_rows(module_rows=modules, week_rows=weeks)
    rows = {
        'training': training, 'modules': catalogue, 'authoring_modules': modules,
        'ksb_profiles': relationships['ksb_profiles'], 'program_configs': relationships['program_configs'],
        'holidays': [], 'tutors': [], 'coaches': [], 'tutor_modules': [],
        'ksb_counts': decode_counts(relationships.get('ksb_counts')),
    }
    delivery = {
        'modules': modules,
        'cohorts': [serialize_cohort_authoring_detail(row, []) for row in cohorts],
        'groups': [serialize_group_authoring_detail(row) for row in groups],
    }
    return rows, delivery


def programme_structure_child_rows(
    module_ids,
    *,
    component_text=True,
    AUTHORING_COMPONENTS_TABLE='components',
    AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings',
    AUTHORING_MODULES_TABLE='modules',
    AUTHORING_WEEKS_TABLE='weeks',
    CATALOGUE_SUMMARY_COMPONENT_COLUMNS=_columns.CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
    authoring_fetch_all=lambda *args, **kwargs: _authoring().authoring_fetch_all(*args, **kwargs),
    clean_str=_default_clean_str,
    compact_authoring_rows=lambda *args, **kwargs: _authoring().compact_authoring_rows(*args, **kwargs),
    live_authoring_rows_sql=lambda table: _live_rows_sql(table),
    prefetch_authoring_reads=lambda calls: _authoring().prefetch_authoring_reads(calls),
    workspace_component_text_columns=_columns.workspace_component_text_columns,
):
    """The child rows both module builders read, for the union of their ids.

    ``component_text=False`` reads the components without their title,
    description and reflection question -- on a large programme the bulk of
    what the read moves -- and gives every row the same empty value for each.
    Only a caller that has checked component_text_cancels() on what it built
    may keep the result; see there.
    """

    ids = sorted({clean_str(value) for value in module_ids if clean_str(value)})
    if not ids:
        return {'components': [], 'mappings': [], 'modules': [], 'weeks': []}
    scope = f'module_catalogue_id in ({", ".join(["%s"] * len(ids))})'

    def read(table, order, columns=None):
        # These SQL filters exclude only rows the existing active_* predicates
        # already reject. Keep those Python predicates in the builders as well.
        live, params = live_authoring_rows_sql(table)
        where = f'({scope}) and ({live})' if live else scope
        return compact_authoring_rows(table, where, [*ids, *params], order, columns=columns, reuse_unchanged=True)

    # The module and week reads at the end, sent together in one round trip.
    prefetch_authoring_reads([
        ((AUTHORING_MODULES_TABLE, scope, ids), {}),
        ((AUTHORING_WEEKS_TABLE, scope, ids, 'display_order, week_number, id'), {}),
    ])
    component_columns = CATALOGUE_SUMMARY_COMPONENT_COLUMNS
    if not component_text:
        text = workspace_component_text_columns()
        component_columns = tuple(column for column in component_columns if column not in text)
    components = read(AUTHORING_COMPONENTS_TABLE, 'display_order, id', component_columns)
    if not component_text:
        for row in components:
            for column in workspace_component_text_columns():
                row[column] = ''

    return {
        'components': components,
        'mappings': read(AUTHORING_KSB_MAPPINGS_TABLE, 'created_at, id'),
        # Both builders read these too, each for its own overlapping id list:
        # two module reads and two week reads of the same programme. Read once
        # for the union, unfiltered, exactly as get_authoring_structure_payloads
        # reads them; it takes its own ids from here. Weeks are in a total order
        # (id is unique), so each caller's slice is the sequence it read before.
        'modules': authoring_fetch_all(AUTHORING_MODULES_TABLE, scope, ids),
        'weeks': authoring_fetch_all(AUTHORING_WEEKS_TABLE, scope, ids, 'display_order, week_number, id'),
    }


def get_program_config_rows_raw(*, fetch_all, has_column, table_name):
    try:
        ordered_by_hand = has_column('programmes', 'display_order')
    except Exception:
        ordered_by_hand = False
    ordering = 'order by coalesce(display_order, 0), name' if ordered_by_hand else 'order by name'
    return fetch_all(f'''
        select *
        from {table_name("programmes")}
        {ordering}
    ''')
