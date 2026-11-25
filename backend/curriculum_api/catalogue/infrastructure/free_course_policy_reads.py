"""Read existing live activities retained by an adopted Free Course."""
FREE_COURSE_SOURCE = 'free_course'

def retained_live_component_ids(stored):
    """Only already stored live components of an adopted course are allowed."""
    from curriculum_api.legacy_free_course_migration import adopted_id
    source_id = (stored or {}).get('source_id')
    if (not source_id or stored.get('source_type') != FREE_COURSE_SOURCE
            or stored.get('module_catalogue_id') != adopted_id('MOD', source_id, source_id)):
        return set()
    from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
    from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
    return {row['id'] for row in authoring_fetch_all(
        AUTHORING_COMPONENTS_TABLE,
        "module_catalogue_id = %s and type = 'live_session' and lower(btrim(coalesce(status, ''))) <> 'inactive'",
        [stored['module_catalogue_id']], columns=['id'],
    )}
