"""Concrete catalogue / domain / row values capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.archive_policy import row_has_deleted_at
from curriculum_api.catalogue.domain.values import clean_str


def link_training_row_to_catalogue(training_id, module_catalogue_id):
    return False


def require_fields(payload, fields):
    missing = [field for field in fields if payload.get(field) in (None, '')]
    return missing


def curriculum_name_only_patch(payload, *, allow_title=False):
    """Revision metadata does not turn a display-name edit into a delivery save."""
    fields = {'name', 'title'} if allow_title else {'name'}
    return any(clean_str(payload.get(key)) for key in fields) and set(payload).issubset(
        fields | {'expectedRevision', 'expected_revision'},
    )


def authoring_row_is_active(row):
    return not row_has_deleted_at(row)


def narrow_learners_to_placement(learners, id_key, scope_id, name_key, scope_name):
    from curriculum_api.directory.domain.placement import narrow_learners_to_placement as implementation
    return implementation(learners, id_key, scope_id, name_key, scope_name, clean_str=clean_str)


def iso_or_blank(value):
    """A date/datetime as ISO text, passing strings through and nulls to ''."""
    if value is None:
        return ''
    return value.isoformat() if hasattr(value, 'isoformat') else clean_str(value)
