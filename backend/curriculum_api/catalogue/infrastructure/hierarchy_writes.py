"""Cohort/group row persistence with existing NULL, retry and failure contracts.

Named capabilities are supplied by the existing composition seam during migration.
No legacy module, provider or settings object is imported here.
"""


def update_cohort_fields(
    cohort_id,
    fields,
    allow_null_columns=None,
    *,
    COHORT_AUTHORING_DETAILS_TABLE,
    clean_str,
    datetime,
    fetch_cohort_row,
    update_authoring_rows,
):
    """Apply a targeted field update to a single normalized cohort row.

    Only the provided columns are written; the canonical ``cohort_id`` and all
    unrelated columns (programme_id, group_ids, dates, status, …) are preserved.
    ``None`` means "leave this column alone" unless the column is named in
    ``allow_null_columns``, which lets a value be cleared outright.
    """
    ident = clean_str(cohort_id)
    if not ident:
        return None
    nullable = set(allow_null_columns or ())
    values = {key: value for key, value in fields.items() if value is not None or key in nullable}
    if not values:
        return fetch_cohort_row(ident)
    values['updated_at'] = datetime.utcnow()
    rows = update_authoring_rows(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [ident], values)
    return rows[0] if rows else fetch_cohort_row(ident)


def persist_cohort_authoring_detail(
    cohort,
    rows=None,
    groups=None,
    holiday_rows=None,
    extra=None,
    *,
    raise_on_error=False,
    COHORT_AUTHORING_DETAILS_TABLE,
    authoring_upsert,
    cohort_authoring_payload,
    logger,
):
    """Store one cohort's authoring row.

    Failure is swallowed by default because most callers are sync/repair passes
    rebuilding rows in bulk, where one bad row must not abandon the rest.
    ``raise_on_error`` is for the create endpoints, where the caller is a person
    waiting on an answer: they need the reason, not a warning in a log they
    cannot read.
    """
    payload = cohort_authoring_payload(cohort, rows, groups, holiday_rows, extra)
    if not payload.get('cohort_id'):
        return None
    try:
        return authoring_upsert(
            COHORT_AUTHORING_DETAILS_TABLE,
            ['cohort_id'],
            payload,
            # Clearing the EPA period or the authored apprenticeship end date has
            # to reach the database; the keys are only present when the caller
            # sent one (see cohort_authoring_payload).
            allow_null_columns=('epa_months', 'apprenticeship_end_date', 'apprenticeship_end_override'),
        )
    except (Exception, AssertionError) as exc:
        logger.warning(
            'Could not persist cohort authoring details for %s: %s',
            payload.get('cohort_id'), exc, exc_info=True,
        )
        if raise_on_error:
            raise
        return None


def update_group_fields(group_id, fields, *, GROUPS_TABLE, clean_str, datetime, fetch_group_row, update_authoring_rows):
    """Apply a targeted field update to a single normalized group row."""
    ident = clean_str(group_id)
    if not ident:
        return None
    values = {key: value for key, value in fields.items() if value is not None}
    if not values:
        return fetch_group_row(ident)
    values['updated_at'] = datetime.utcnow()
    rows = update_authoring_rows(GROUPS_TABLE, 'group_id = %s', [ident], values)
    return rows[0] if rows else fetch_group_row(ident)


def persist_group_authoring_detail(
    group,
    rows=None,
    module_rows=None,
    extra=None,
    *,
    raise_on_error=False,
    GROUPS_TABLE,
    authoring_upsert,
    group_authoring_payload,
    logger,
):
    """Store one group's authoring row. See persist_cohort_authoring_detail
    for why failure is swallowed by default and what ``raise_on_error`` is for."""
    payload = group_authoring_payload(group, rows, module_rows, extra)
    if not payload.get('group_id'):
        return None
    try:
        return authoring_upsert(GROUPS_TABLE, ['group_id'], payload)
    except (Exception, AssertionError) as exc:
        logger.warning(
            'Could not persist group authoring details for %s: %s',
            payload.get('group_id'), exc, exc_info=True,
        )
        if raise_on_error:
            raise
        return None


def unassign_authoring_modules_from_group(
    group_id, keep_catalogue_ids=None, *, AUTHORING_MODULES_TABLE, authoring_fetch_all, clean_str,
    update_authoring_rows,
):
    """Clear this group's omitted module links from ``curriculum.modules``.

    Module Builder content is preserved; only the delivery relationship columns
    are cleared for modules no longer present in the group's saved draft.
    """
    group_id = clean_str(group_id)
    keep = {clean_str(value) for value in (keep_catalogue_ids or []) if clean_str(value)}
    if not group_id:
        return []
    rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'group_id = %s', [group_id])
    removed = []
    for row in rows:
        module_id = clean_str(row.get('module_catalogue_id'))
        if module_id in keep:
            continue
        update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
            'cohort_id': None,
            'group_id': None,
        })
        removed.append(module_id)
    return removed
