"""Atomic programme-tree use case. Returns values for the HTTP adapter; never serializes responses.

Named capabilities are supplied by the existing composition seam during migration.
No legacy module, provider or settings object is imported here.
"""


def save_programme_tree(
    payload,
    *,
    AUTHORING_MODULES_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    authoring_fetch_all,
    authoring_soft_delete,
    bool_payload,
    clean_str,
    clean_tree_remove_ids,
    fetch_cohort_row,
    fetch_group_row,
    invalidate_curriculum_cache,
    repair_curriculum_parent_links,
    save_tree_cohort,
    save_tree_group,
    save_tree_group_modules,
    transaction,
    unassign_authoring_modules_from_group,
    update_authoring_rows,
    upsert_programme_for_tree,
    versioning,
):
    with transaction.atomic(), versioning.source('tree-save'):
        programme = upsert_programme_for_tree(payload.get('programme') or payload)
        programme_id = clean_str(programme.get('sourceId') or programme.get('id') or payload.get('programmeId'))
        programme_name = clean_str(programme.get('name') or (payload.get('programme') or {}).get('name'))
        saved_cohorts = []
        saved_groups = []
        saved_modules = []
        saved_cohort_ids = set()
        saved_group_ids = set()
        removed_module_ids = []
        removed_group_ids = []
        removed_cohort_ids = []
        partial_tree = bool_payload(payload.get('partialTree'))
        remove_missing = bool_payload(payload.get('removeMissing')) and bool_payload(payload.get('hydrationComplete'))
        for cohort_payload in payload.get('cohorts') or []:
            cohort = save_tree_cohort(cohort_payload, programme_id, programme_name, preserve_missing_groups=partial_tree)
            saved_cohorts.append(cohort)
            saved_cohort_ids.add(cohort['id'])
            cohort_row = fetch_cohort_row(cohort['id'])
            for group_payload in cohort_payload.get('groups') or []:
                group = save_tree_group(group_payload, cohort_row)
                saved_groups.append(group)
                saved_group_ids.add(group['id'])
                if not partial_tree or 'modules' in group_payload:
                    modules, removed = save_tree_group_modules(
                        group,
                        cohort,
                        group_payload.get('modules') or [],
                        preserve_missing=partial_tree and bool_payload(group_payload.get('modulesPartial')),
                    )
                    saved_modules.extend(modules)
                    removed_module_ids.extend(removed)

        explicit_module_ids = clean_tree_remove_ids(payload, 'removeModuleIds', 'removedModuleIds', 'deleteModuleIds', 'deletedModuleIds')
        explicit_group_ids = clean_tree_remove_ids(payload, 'removeGroupIds', 'removedGroupIds', 'deleteGroupIds', 'deletedGroupIds')
        explicit_cohort_ids = clean_tree_remove_ids(payload, 'removeCohortIds', 'removedCohortIds', 'deleteCohortIds', 'deletedCohortIds')

        for module_id in explicit_module_ids:
            module_row = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id])
            if not module_row or clean_str((module_row[0] or {}).get('programme_id')) != programme_id:
                continue
            update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
                'cohort_id': None,
                'group_id': None,
            })
            removed_module_ids.append(module_id)

        for group_id in explicit_group_ids:
            if group_id in saved_group_ids:
                continue
            group_row = fetch_group_row(group_id) or {}
            if clean_str(group_row.get('programme_id')) != programme_id:
                continue
            removed_module_ids.extend(unassign_authoring_modules_from_group(group_id))
            authoring_soft_delete(GROUPS_TABLE, 'group_id = %s', [group_id], via_parent=programme_id, deleted_by='programme-tree-save')
            removed_group_ids.append(group_id)

        for cohort_id in explicit_cohort_ids:
            if cohort_id in saved_cohort_ids:
                continue
            cohort_row = fetch_cohort_row(cohort_id) or {}
            if clean_str(cohort_row.get('programme_id')) != programme_id:
                continue
            for group_row in authoring_fetch_all(GROUPS_TABLE, 'cohort_id = %s', [cohort_id]):
                group_id = clean_str(group_row.get('group_id'))
                if group_id and group_id not in saved_group_ids:
                    removed_module_ids.extend(unassign_authoring_modules_from_group(group_id))
                    authoring_soft_delete(GROUPS_TABLE, 'group_id = %s', [group_id], via_parent=cohort_id, deleted_by='programme-tree-save')
                    removed_group_ids.append(group_id)
            authoring_soft_delete(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id], via_parent=programme_id, deleted_by='programme-tree-save')
            removed_cohort_ids.append(cohort_id)

        if remove_missing:
            for group_row in authoring_fetch_all(GROUPS_TABLE, 'programme_id = %s', [programme_id]):
                group_id = clean_str(group_row.get('group_id'))
                if group_id and group_id not in saved_group_ids:
                    removed_module_ids.extend(unassign_authoring_modules_from_group(group_id))
                    authoring_soft_delete(GROUPS_TABLE, 'group_id = %s', [group_id], via_parent=programme_id, deleted_by='programme-tree-save')
                    removed_group_ids.append(group_id)
            for cohort_row in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE, 'programme_id = %s', [programme_id]):
                cohort_id = clean_str(cohort_row.get('cohort_id'))
                if cohort_id and cohort_id not in saved_cohort_ids:
                    authoring_soft_delete(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id], via_parent=programme_id, deleted_by='programme-tree-save')
                    removed_cohort_ids.append(cohort_id)

        repair_curriculum_parent_links(programme_id)
        invalidate_curriculum_cache()
    return (programme, saved_cohorts, saved_groups, saved_modules, removed_module_ids, removed_group_ids, removed_cohort_ids, remove_missing)
