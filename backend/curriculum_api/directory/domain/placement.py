"""Placement narrowing by stable identity; no infrastructure or display-name matching."""


def scope_programme_identifier(lineage, *, clean_str):
    """The identifier ``assigned_learners_for_programme`` should be asked with."""
    return clean_str(lineage.get('programmeId')) or clean_str(lineage.get('programmeName'))


def narrow_learners_to_placement(learners, id_key, scope_id, name_key, scope_name, *, clean_str):
    """Narrow educational membership by FK, never by a duplicated label."""
    scope_id = clean_str(scope_id)
    if not scope_id:
        return [] if clean_str(scope_name) else learners
    return [row for row in learners if clean_str(row.get(id_key)) == scope_id]
