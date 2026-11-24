"""Changed-content persistence and existing parent-link coherence orchestration.

Explicit capabilities preserve existing caller contracts during migration.
No views, settings or provider runtime is imported here.
"""


def write_changed_authoring_rows(
    module_catalogue_id,
    week_payloads,
    component_payloads,
    mapping_payloads,
    stored_components_by_id,
    *,
    stored_rows=None,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_WEEKS_TABLE,
    authoring_bulk_upsert,
    authoring_fetch_all,
    authoring_mapping_owner,
    authoring_mapping_signature,
    authoring_row_differs,
    authoring_row_is_active,
    clean_str,
    defaultdict,
    soft_delete_authoring_ids,
):
    """Write only what differs from the stored module; withdraw only what left it.

    ``stored_rows`` reuses rows the caller already read under the module lock
    (module_structure_source_rows) instead of reading them again.
    """
    stored_weeks_by_id = {
        clean_str(row.get('id')): row
        for row in (
            stored_rows.get(AUTHORING_WEEKS_TABLE) or [] if stored_rows is not None
            else authoring_fetch_all(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        )
    }
    for table, payloads, stored_by_id in (
        (AUTHORING_WEEKS_TABLE, week_payloads, stored_weeks_by_id),
        (AUTHORING_COMPONENTS_TABLE, component_payloads, stored_components_by_id),
    ):
        kept = {clean_str(payload.get('id')) for payload in payloads}
        soft_delete_authoring_ids(table, [
            row_id for row_id, row in stored_by_id.items()
            if row_id not in kept and authoring_row_is_active(row)
        ])
        authoring_bulk_upsert(table, ['id'], [
            payload for payload in payloads
            if authoring_row_differs(payload, stored_by_id.get(clean_str(payload.get('id'))))
        ])

    stored_mappings_by_owner = defaultdict(list)
    for row in (
        stored_rows.get(AUTHORING_KSB_MAPPINGS_TABLE) or [] if stored_rows is not None
        else authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    ):
        if authoring_row_is_active(row):
            stored_mappings_by_owner[authoring_mapping_owner(row)].append(row)
    new_mappings_by_owner = defaultdict(list)
    for payload in mapping_payloads:
        new_mappings_by_owner[authoring_mapping_owner(payload)].append(payload)
    withdrawn, written = [], []
    for owner in set(stored_mappings_by_owner) | set(new_mappings_by_owner):
        stored_rows = stored_mappings_by_owner.get(owner, [])
        new_rows = new_mappings_by_owner.get(owner, [])
        if authoring_mapping_signature(stored_rows) == authoring_mapping_signature(new_rows):
            continue
        withdrawn.extend(clean_str(row.get('id')) for row in stored_rows)
        written.extend(new_rows)
    soft_delete_authoring_ids(AUTHORING_KSB_MAPPINGS_TABLE, withdrawn)
    authoring_bulk_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], written)


def repair_curriculum_parent_links(
    programme_id='',
    *,
    allow_writes=True,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    authoring_delete,
    authoring_fetch_all,
    authoring_table_name,
    clean_str,
    curriculum_row_effectively_deleted,
    logger,
    safe_authoring_module_rows,
    update_authoring_rows,
    update_group_fields,
):
    """Keep denormalized parent arrays and child links coherent.

    True foreign keys are risky for existing installations because legacy rows
    can pre-date the normalized tables. These guards repair relationships that
    are in scope for a save and clean obvious authoring orphans.

    ``allow_writes=False`` makes this a no-op, which is what GET handlers pass.
    Two reasons this must not run on a read:

    1. It writes, so it breaks any read-only connection and hides a mutation
       behind an apparently read-only endpoint.
    2. It sets ``groups.programme_id = ''`` when a group's cohort is missing.
       That is the most likely origin of the empty-string programme_id rows
       still present in production, and once migration 0038 adds the foreign
       key such a write is rejected outright ('' is not NULL and has no parent),
       which would turn a plain GET into a 500.

    Write paths keep the default and still repair what they are saving.

    Soft delete
    -----------
    Repair is a coherence pass over *surviving* curriculum, and it obeys two
    rules so it cannot undo a delete by accident:

    1. It never writes to an effectively deleted row. An archived cohort, group
       or module keeps exactly the lineage it was archived with.
    2. It never points a surviving row at an effectively deleted one. A
       surviving group does not inherit a deleted cohort's programme, a
       surviving module does not inherit a deleted group's names, and a
       surviving parent's denormalized child arrays (``cohorts.group_ids``,
       ``groups.module_ids``) list only surviving children.

    Deletion is read here, never written: no branch touches ``deleted_at``,
    ``deleted_by`` or ``deleted_via_parent``, so a surviving child holding an
    old parent id can never restore that parent. Restoring stays an explicit
    operation (``restore_soft_delete_payload``).
    """
    if not allow_writes:
        return
    programme_id = clean_str(programme_id)
    try:
        cohorts = authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE)
        groups = authoring_fetch_all(GROUPS_TABLE)
        modules = safe_authoring_module_rows()
        cohort_by_id = {clean_str(row.get('cohort_id')): row for row in cohorts if clean_str(row.get('cohort_id'))}
        group_by_id = {clean_str(row.get('group_id')): row for row in groups if clean_str(row.get('group_id'))}

        for group in groups:
            group_id = clean_str(group.get('group_id'))
            cohort_id = clean_str(group.get('cohort_id'))
            cohort = cohort_by_id.get(cohort_id)
            if not group_id or curriculum_row_effectively_deleted(group):
                continue
            if not cohort:
                if not programme_id or clean_str(group.get('programme_id')) == programme_id:
                    update_group_fields(group_id, {
                        'cohort_id': '',
                        'programme_id': '',
                    })
                continue
            # The cohort row is still there but withdrawn. Leave the group's
            # stored lineage alone: copying a deleted cohort's programme down
            # would reconnect a surviving group to deleted curriculum, and
            # blanking it would destroy the archive relationship instead.
            if curriculum_row_effectively_deleted(cohort):
                continue
            updates = {}
            if clean_str(group.get('cohort_name')) != clean_str(cohort.get('cohort_name')):
                updates['cohort_name'] = clean_str(cohort.get('cohort_name'))
            if clean_str(group.get('programme_id')) != clean_str(cohort.get('programme_id')):
                updates['programme_id'] = clean_str(cohort.get('programme_id'))
            if updates:
                update_group_fields(group_id, updates)

        groups = authoring_fetch_all(GROUPS_TABLE)
        group_by_id = {clean_str(row.get('group_id')): row for row in groups if clean_str(row.get('group_id'))}

        for module in modules:
            module_id = clean_str(module.get('module_catalogue_id'))
            group_id = clean_str(module.get('group_id'))
            if not module_id or not group_id or curriculum_row_effectively_deleted(module):
                continue
            group = group_by_id.get(group_id)
            if not group:
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
                    'cohort_id': '',
                    'group_id': '',
                })
                continue
            if programme_id and clean_str(group.get('programme_id')) != programme_id:
                continue
            # Same reasoning as the cohort branch: a withdrawn group must not
            # push its lineage onto a module that is still live, and the module
            # must not appear in that group's surviving-children arrays.
            if curriculum_row_effectively_deleted(group):
                continue
            updates = {}
            for column, group_column in (
                ('cohort_id', 'cohort_id'),
                ('programme_id', 'programme_id'),
            ):
                if clean_str(module.get(column)) != clean_str(group.get(group_column)):
                    updates[column] = clean_str(group.get(group_column))
            if updates:
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], updates)

        # Authoring orphans only: these match a child whose parent ROW is
        # physically gone. A soft-deleted week/module/component still has its
        # row, so an archived branch of curriculum is never swept up here and
        # historical learner progress stays joinable to it.
        authoring_delete(AUTHORING_WEEKS_TABLE, "coalesce(module_catalogue_id, '') <> '' and module_catalogue_id not in (select module_catalogue_id from " + authoring_table_name(AUTHORING_MODULES_TABLE) + ")")
        authoring_delete(AUTHORING_COMPONENTS_TABLE, "coalesce(module_catalogue_id, '') <> '' and module_catalogue_id not in (select module_catalogue_id from " + authoring_table_name(AUTHORING_MODULES_TABLE) + ")")
        authoring_delete(AUTHORING_COMPONENTS_TABLE, "coalesce(week_id, '') <> '' and week_id not in (select id from " + authoring_table_name(AUTHORING_WEEKS_TABLE) + ")")
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, "coalesce(component_id, '') <> '' and component_id not in (select id from " + authoring_table_name(AUTHORING_COMPONENTS_TABLE) + ")")
    except (Exception, AssertionError):
        logger.warning('Could not repair curriculum parent links.', exc_info=True)
