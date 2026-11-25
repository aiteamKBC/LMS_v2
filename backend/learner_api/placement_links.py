"""Canonical educational placement; enrolment IDs are registration data only."""
from .identity_placement.public import (
    CACHE,
    FIELDS,
    RELATIONS,
    placement_ids,
    placement_payload,
    placement_profile,
    with_placements,
)
from .models import EnrolmentUser, LearnerProfile

__all__ = (
    'CACHE', 'FIELDS', 'RELATIONS', 'EnrolmentUser', 'LearnerProfile',
    'placement_ids', 'placement_input', 'placement_payload', 'placement_profile',
    'validate_placement', 'with_placements',
)


def validate_placement(fields, current=None, *, using='enrolment'):
    """Validate an explicit ID edit, preserving omitted fields and hierarchy."""
    from .mappers import ValidationError
    from .models import PlacementCohort, PlacementGroup, PlacementProgramme

    requested = {key: value for key, value in fields.items() if key in FIELDS}
    if not requested:
        return {}
    ids = {key: getattr(current, key, None) if current is not None else None for key in FIELDS}
    ids.update(requested)
    programme, cohort, group = (ids[key] for key in FIELDS)
    if programme and not PlacementProgramme.objects.using(using).filter(pk=programme).exists():
        raise ValidationError('Choose an existing programme ID.')
    if cohort and not PlacementCohort.objects.using(using).filter(pk=cohort, programme_id=programme).exists():
        raise ValidationError('The cohort must belong to the selected programme.')
    if group and not PlacementGroup.objects.using(using).filter(pk=group, programme_id=programme, cohort_id=cohort).exists():
        raise ValidationError('The group must belong to the selected programme and cohort.')
    return requested


def placement_input(payload):
    """API ID fields only. Names are output labels, never placement authority."""
    from .mappers import ValidationError

    result = {}
    for kind in ('programme', 'cohort', 'group'):
        key, column = kind + 'Id', kind + '_id'
        if key in payload and column in payload and payload[key] != payload[column]:
            raise ValidationError(f'Conflicting {key} values.')
        if key in payload or column in payload:
            value = payload[key] if key in payload else payload[column]
            if value is not None and not isinstance(value, str):
                raise ValidationError(f'{key} must be a string ID or null.')
            result[column] = value.strip() or None if value is not None else None
        elif kind in payload and payload[kind]:  # noqa: RUF019 - preserve legacy semantics
            raise ValidationError(f'Use {key} to change placement; names are display-only.')
    return result
