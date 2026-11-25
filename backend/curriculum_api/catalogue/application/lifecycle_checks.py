"""Resolve archive eligibility, recovery decisions and retained-content plans.

Reads and history annotation are explicit capabilities; this module deletes nothing."""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def programme_permanent_delete_plan(
    identifier, programme=None, config=None, *, AUTHORING_COMPONENTS_TABLE, AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE, COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE, WEEK_TEMPLATES_TABLE,
    clean_str, curriculum_ids_matching, curriculum_in_clause, orphan_programme_name_clause, parse_int,
    programme_dependency_counts, programme_identifier_candidates, programme_permanent_delete_blockers,
):
    """Read-only plan for a permanent delete: what would go, and what blocks it.

    Children are resolved through their own parents as well as through
    ``programme_id``. A group whose programme_id was never stamped, or a module
    attached only to a group, still belongs to the programme and must not survive
    it - those are precisely the orphans migration 0038 was added to stop.
    """
    candidates = programme_identifier_candidates(identifier, programme, config)
    programme_name = clean_str((programme or {}).get('name') or (config or {}).get('name'))
    plan = {
        'candidates': candidates,
        'childIds': {
            'cohortIds': [],
            'groupIds': [],
            'moduleIds': [],
            'weekIds': [],
            'componentIds': [],
            'weekTemplateIds': [],
        },
        'blockers': {},
        'learners': 0,
    }
    if not candidates:
        return plan

    programme_clause = curriculum_in_clause('programme_id', candidates)
    child = plan['childIds']
    child['cohortIds'] = curriculum_ids_matching(
        COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', [
            programme_clause,
            orphan_programme_name_clause(COHORT_AUTHORING_DETAILS_TABLE, programme_name),
        ],
    )
    child['groupIds'] = curriculum_ids_matching(GROUPS_TABLE, 'group_id', [
        programme_clause,
        curriculum_in_clause('cohort_id', child['cohortIds']),
        orphan_programme_name_clause(GROUPS_TABLE, programme_name),
    ])
    child['moduleIds'] = curriculum_ids_matching(AUTHORING_MODULES_TABLE, 'module_catalogue_id', [
        programme_clause,
        curriculum_in_clause('cohort_id', child['cohortIds']),
        curriculum_in_clause('group_id', child['groupIds']),
    ])
    child['weekIds'] = curriculum_ids_matching(AUTHORING_WEEKS_TABLE, 'id', [
        curriculum_in_clause('module_catalogue_id', child['moduleIds']),
    ])
    child['componentIds'] = curriculum_ids_matching(AUTHORING_COMPONENTS_TABLE, 'id', [
        curriculum_in_clause('module_catalogue_id', child['moduleIds']),
        curriculum_in_clause('week_id', child['weekIds']),
    ])
    child['weekTemplateIds'] = curriculum_ids_matching(WEEK_TEMPLATES_TABLE, 'id', [
        programme_clause,
        curriculum_in_clause('group_id', child['groupIds']),
        curriculum_in_clause('module_catalogue_id', child['moduleIds']),
    ])
    plan['blockers'] = programme_permanent_delete_blockers(child)
    plan['learners'] = parse_int(programme_dependency_counts(identifier, config).get('learners'), 0)
    return plan


def archived_authoring_ids(
    table, id_column, *, authoring_fetch_all, clean_str, curriculum_row_effectively_deleted, logger,
):
    """Ids of the soft-deleted rows in an authoring table.

    Archiving stamps ``deleted_at`` and leaves the row where it is, and the
    ``*_authoring_detail_rows`` readers deliberately return every row so archive
    views can still show withdrawn curriculum. Anything that matches a *new*
    record against the stored ones has to skip these ids first: treating an
    archived row as a duplicate turns "create it again" into an update of a
    tombstone, so the write lands on a row nothing lists and the caller is told
    the record already exists while no record appears.
    """
    ident = clean_str(id_column)
    try:
        rows = authoring_fetch_all(
            table,
            columns=[ident, 'status'],
        )
    except (Exception, AssertionError) as exc:
        logger.warning('Could not read archived ids for %s: %s', table, exc)
        return set()
    return {
        clean_str(row.get(ident))
        for row in rows
        if clean_str(row.get(ident)) and curriculum_row_effectively_deleted(row)
    }


def programme_archived_for_authoring(
    programme_id, *, clean_str, get_program_config_rows, is_archived_program_config, logger,
    program_config_by_id,
):
    """Is the programme a module is being saved against archived or deleted?

    Used to re-derive ``modules.is_programme_deleted`` on save instead of
    trusting the flag already on the row: the flag records *the programme's*
    state, so a module moved onto a live programme has to lose it.
    """
    identifier = clean_str(programme_id)
    if not identifier:
        return False
    try:
        config = program_config_by_id(get_program_config_rows()).get(identifier)
    except (Exception, AssertionError):
        logger.debug('Unable to resolve programme %s for delete-flag derivation.', identifier, exc_info=True)
        return False
    return bool(config) and is_archived_program_config(config)


def module_withdrawn_on_its_own(
    row,
    *,
    AUTHORING_MODULES_TABLE,
    archive_state,
    clean_str=_default_clean_str,
    row_has_deleted_at,
):
    """Was this module withdrawn by the module DELETE, rather than by a parent?

    A programme or group archive stamps its children with ``deleted_via_parent``
    (and ``deleted_by='programme-delete'``); a module archived on its own
    carries neither. The difference matters because the two are undone
    differently: a parent's children come back with the parent, while a module
    withdrawn deliberately stays withdrawn until someone restores it.
    """
    if not row_has_deleted_at(row):
        return False
    row = dict(row)
    if archive_state.row_inactive(row) and not row.get('deleted_by'):
        # Normalised schema: the reason and parent are history's record.
        archive_state.annotate(AUTHORING_MODULES_TABLE, [row], key_column='module_catalogue_id')
    return (
        not clean_str(row.get('deleted_via_parent'))
        and clean_str(row.get('deleted_by')) == 'module-delete'
    )


def module_recovered_by_move_to_live(
    existing_module_row,
    programme_id,
    *,
    clean_str=_default_clean_str,
    module_withdrawn_on_its_own,
    programme_archived_for_authoring,
    programme_deleted_row,
):
    """Is this save moving an already-withdrawn module onto a live programme?

    That move is the recovery route, and the backend owns its outcome rather
    than reading it back off the payload. The drawer PATCH rebuilds its body
    from ``get_authoring_structure_payload``, which reports
    ``isProgrammeDeleted``, so a module being rescued sent its own stale
    ``true`` straight back and pinned itself withdrawn: ``programme_id`` moved
    to the live programme and the module stayed hidden from every list. The
    Builder's structure PATCH sends the same key from the same source, so both
    paths carried the same stale flag -- derived here, once, they recover a
    module identically.

    Not for a module withdrawn on its own: restoring that stays an explicit
    operation, and re-parenting it must not quietly undo it.
    """
    if not programme_deleted_row(existing_module_row):
        return False
    target = clean_str(programme_id)
    # Only a real move. Saving a withdrawn module where it already sits changes
    # nothing about why it was withdrawn -- under an archived programme it must
    # stay withdrawn, which is what keeps it editable there without reviving it.
    if not target or target == clean_str((existing_module_row or {}).get('programme_id')):
        return False
    if programme_archived_for_authoring(target):
        return False
    return not module_withdrawn_on_its_own(existing_module_row)


def authoring_programme_config_for_save(
    programme_id, programme_name='', *, clean_str, get_program_config_rows, logger, normalise,
    persistable_programme_id, programme_config_identity,
):
    """The programme row a module save would attach the module to.

    Mirrors how ``ensure_programme_config_for_authoring`` picks its row -- id
    first, then name -- minus the write. A payload that carries only a programme
    *name* (an id that no longer resolves, or a module left unassigned) is still
    attached by name on save, so anything judging that save has to resolve it
    the same way or it judges a different programme than the one written.
    """
    identifier = persistable_programme_id(programme_id)
    name = clean_str(programme_name)
    try:
        configs = get_program_config_rows()
    except (Exception, AssertionError):
        logger.debug('Unable to resolve the programme a module save would attach to.', exc_info=True)
        return None
    if identifier:
        match = next((
            config for config in configs if programme_config_identity(config) == identifier
        ), None)
        if match:
            return match
    if name and normalise(name) not in {'unassignedprogramme', 'unassigned'}:
        return next((
            config for config in configs if normalise(config.get('name')) == normalise(name)
        ), None)
    return None


def module_archive_event_bounds(
    module_row, *, AUTHORING_MODULES_TABLE, MODULE_ARCHIVE_EVENT_WINDOW, archive_state, stamp_datetime,
):
    """The (earliest, latest) ``deleted_at`` a child of this archive can carry.

    None when the module carries no usable stamp, which leaves the marker as the
    only test -- exactly the behaviour before the window existed.
    """
    module_row = dict(module_row or {})
    if archive_state.row_inactive(module_row) and not module_row.get('deleted_by'):
        # Normalised schema: the archive moment is history's, not a column.
        archive_state.annotate(AUTHORING_MODULES_TABLE, [module_row], key_column='module_catalogue_id')
    archived_at = stamp_datetime(module_row.get('deleted_at'))
    if archived_at is None:
        return None
    return archived_at - MODULE_ARCHIVE_EVENT_WINDOW, archived_at + MODULE_ARCHIVE_EVENT_WINDOW


def archived_parent_programme(
    programme_id, *, clean_str, ensure_program_config_archive_columns, is_archived_program_config,
    logger, programme_config_by_identifier,
):
    """The programme config for ``programme_id``, but only while it is archived.

    Used to refuse a restore that would produce an orphan: every cohort list is
    scoped by programme, so a cohort restored under an archived programme comes
    back invisible.
    """
    identifier = clean_str(programme_id)
    if not identifier:
        return None
    try:
        ensure_program_config_archive_columns()
        config = programme_config_by_identifier(identifier)
    except Exception:
        logger.warning('Could not read programme %s while checking the archive.', identifier, exc_info=True)
        return None
    return config if config and is_archived_program_config(config) else None


def surviving_authoring_module_rows(
    module_rows=None, *, curriculum_row_effectively_deleted, safe_authoring_module_rows,
):
    """Module rows that are not soft-deleted, directly or through a parent.

    ``safe_authoring_module_rows`` deliberately reads every row so archive views
    can still show withdrawn curriculum. Anything that rebuilds a *surviving*
    parent's denormalized child list has to filter first, otherwise an archived
    module keeps being written back into it.
    """
    rows = module_rows if module_rows is not None else safe_authoring_module_rows()
    return [row for row in rows if row and not curriculum_row_effectively_deleted(row)]


def soft_deleted_structure_ids(
    candidates, *, AUTHORING_COMPONENTS_TABLE, AUTHORING_WEEKS_TABLE, authoring_fetch_all,
    authoring_row_is_active, clean_str,
):
    """Which of these week/component ids exist as withdrawn rows.

    A save that sends an id the live module does not hold is either creating it
    or bringing back a deleted row, and only the second needs the caller's
    explicit say-so (``restoreIds``). One indexed read per table, and none at
    all for a save that creates nothing.
    """
    found = set()
    for table, wanted in (
        (AUTHORING_WEEKS_TABLE, (candidates or {}).get('weeks') or []),
        (AUTHORING_COMPONENTS_TABLE, (candidates or {}).get('components') or []),
    ):
        if not wanted:
            continue
        placeholders = ', '.join(['%s'] * len(wanted))
        rows = authoring_fetch_all(
            table, f'id in ({placeholders})', list(wanted),
            columns=['id', 'status'],
        )
        found.update(clean_str(row.get('id')) for row in rows if not authoring_row_is_active(row))
    return found
