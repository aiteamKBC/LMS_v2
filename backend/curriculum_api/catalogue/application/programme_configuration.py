"""Resolve or create a programme configuration for an explicit authoring write.

Dependencies are bound at the existing composition seam; no legacy views import.
"""


def ensure_programme_config_for_authoring(
    programme_name, programme_id=None, status='', *, clean_str, datetime,
    ensure_program_config_archive_columns, get_program_config_rows, insert_row,
    invalidate_curriculum_cache, normalise, normalise_programme_status, programme_config_id,
    programme_config_identity, programme_config_key_column, programme_status_from_payload,
    quote_ident, sanitised_programme_id, unique_program_id, update_rows,
):
    name = clean_str(programme_name)
    if not name or normalise(name) in {'unassignedprogramme', 'unassigned'}:
        return None

    ensure_program_config_archive_columns()
    configs = get_program_config_rows()
    # A placeholder id from an unsaved local draft ("programme-local") must not
    # be matched against or persisted; fall back to matching on name instead so
    # the draft attaches to the real programme rather than inventing one.
    requested_id = sanitised_programme_id(programme_id)
    existing = next((
        config for config in configs
        if requested_id and programme_config_identity(config) == requested_id
    ), None)
    if not existing:
        existing = next((
            config for config in configs
            if normalise(config.get('name')) == normalise(name)
        ), None)
    now = datetime.utcnow()

    if existing:
        programme_status = programme_status_from_payload({'status': status} if clean_str(status) else {}, existing)
        try:
            key_column = programme_config_key_column()
        except Exception:
            key_column = programme_config_key_column()
        key_value = existing.get(key_column)
        wanted = {
            'name': name,
            'status': programme_status,
        }
        # Only when something differs. Every module save calls this, and an
        # unconditional UPDATE held the programme row locked for the rest of the
        # save's transaction -- so two people saving two different modules of
        # one programme queued behind each other, and a long enough queue ran
        # past the 15s statement timeout.
        if any(
            column in existing and (
                bool(existing.get(column)) != bool(value) if isinstance(value, bool)
                else clean_str(existing.get(column)) != clean_str(value)
            )
            for column, value in wanted.items()
        ):
            update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], {**wanted, 'updated_at': now})
            invalidate_curriculum_cache()
        source_id = programme_config_id(existing) or clean_str(key_value)
        return {
            'id': source_id,
            'sourceId': source_id,
            'name': name,
            'standard': name,
        }

    # Seed from the requested id only. Passing `name` here was misleading: a
    # name never matches the PROG-* shape, so unique_prefixed_id() discards it
    # and mints a timestamp id anyway. Being explicit keeps a programme name
    # from ever being mistaken for an identifier.
    source_id = unique_program_id(requested_id, configs)
    programme_status = normalise_programme_status(status, 'active')
    insert_row('programmes', {
        'programme_id': source_id,
        'id': source_id,
        'program_id': source_id,
        'name': name,
        'color': '#6941c6',
        'description': '',
        'status': programme_status,
        'created_at': now,
        'updated_at': now,
    })
    invalidate_curriculum_cache()
    return {'id': source_id, 'sourceId': source_id, 'name': name, 'standard': name}
