"""Atomic module archive orchestration, including owned quizzes and child authoring rows.

Explicit capabilities are supplied at the existing views composition seam.
No legacy views, application settings or provider runtime is imported here.
"""


def delete_module_authoring_structure(
    module_catalogue_id,
    *,
    AUTHORING_ADVANCED_TABLE,
    AUTHORING_COMPLETION_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    archive_module_child_quizzes,
    authoring_fetch_all,
    authoring_soft_delete,
    clean_str,
    ensure_module_authoring_tables,
    invalidate_curriculum_cache,
    ksb_mapping_placement,
    transaction,
):
    module_catalogue_id = clean_str(module_catalogue_id)
    ensure_module_authoring_tables()
    existing = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    with transaction.atomic():
        archive_module_child_quizzes(module_catalogue_id)
        authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, *ksb_mapping_placement.where(module_catalogue_id), via_parent=module_catalogue_id, deleted_by='module-delete')
        authoring_soft_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], via_parent=module_catalogue_id, deleted_by='module-delete')
        authoring_soft_delete(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], via_parent=module_catalogue_id, deleted_by='module-delete')
        authoring_soft_delete(AUTHORING_COMPLETION_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], via_parent=module_catalogue_id, deleted_by='module-delete')
        authoring_soft_delete(AUTHORING_ADVANCED_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], via_parent=module_catalogue_id, deleted_by='module-delete')
        authoring_soft_delete(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], deleted_by='module-delete')
    invalidate_curriculum_cache()
    return bool(existing)
