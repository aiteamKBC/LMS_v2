"""Programme ownership over persisted identities, with bounded name compatibility."""


def owns_record(programme, record_id, record_name, *, known_ids=(),
                clean_str, matches_curriculum_identifier, identifier_looks_exact):
    ids = [clean_str(programme.get(key)) for key in ('id', 'sourceId')]
    ids = [value for value in ids if value]
    record_id = clean_str(record_id)
    if record_id and any(matches_curriculum_identifier(record_id, value) for value in ids):
        return True
    # A known/canonical foreign key cannot be reassigned by an old display name.
    if record_id and (record_id in known_ids or identifier_looks_exact(record_id)):
        return False
    name = clean_str(programme.get('name'))
    return bool(name) and matches_curriculum_identifier(record_name, name)


def module_catalogue_id(module, *, clean_str):
    return clean_str(module.get('moduleCatalogueId') or module.get('catalogueId')
                     or module.get('moduleId') or module.get('structureId')
                     or module.get('module_catalogue_id'))
