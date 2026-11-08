"""Canonical educational placement; enrolment IDs are registration data only."""
from .models import EnrolmentUser, LearnerProfile

FIELDS = ('programme_id', 'cohort_id', 'group_id')
RELATIONS = ('programme_record', 'cohort_record', 'group_record')
CACHE = '_educational_placement'


def placement_profile(source):
    """Follow the explicit enrolment bridge; never match names or email.

    Missing profiles have no educational placement. Ambiguous bridges raise
    MultipleObjectsReturned instead of arbitrarily selecting another learner.
    """
    if not isinstance(source, EnrolmentUser):
        return source
    if CACHE not in source.__dict__:
        profile = None
        if source.pk is not None:
            try:
                profile = (LearnerProfile.objects.using(source._state.db or 'default')
                           .select_related(*RELATIONS)
                           .only('id', 'enrolment_id', *RELATIONS)
                           .get(enrolment_id=source.pk))
            except LearnerProfile.DoesNotExist:
                pass
        source.__dict__[CACHE] = profile
    return source.__dict__[CACHE]


def with_placements(sources):
    """Batch the canonical FK reads for directory/assignment consumers."""
    sources = list(sources)
    by_alias = {}
    for source in sources:
        by_alias.setdefault(source._state.db or 'default', []).append(source)
    for alias, records in by_alias.items():
        profiles = (LearnerProfile.objects.using(alias).select_related(*RELATIONS)
                    .only('id', 'enrolment_id', *RELATIONS)
                    .filter(enrolment_id__in=[record.pk for record in records]))
        linked = {}
        for profile in profiles:
            if profile.enrolment_id in linked:
                raise LearnerProfile.MultipleObjectsReturned('Ambiguous learner enrolment link.')
            linked[profile.enrolment_id] = profile
        for record in records:
            record.__dict__[CACHE] = linked.get(record.pk)
            record.__dict__.pop('_placement_names', None)
    return sources


def placement_ids(source):
    """Current learner FK IDs, with empty strings for missing relationships."""
    profile = placement_profile(source)
    return {field: (getattr(profile, field, None) or '') for field in FIELDS}


def placement_payload(source):
    ids = placement_ids(source)
    return {kind + 'Id': ids[kind + '_id'] for kind in ('programme', 'cohort', 'group')}


def validate_placement(fields, current=None, *, using='enrolment'):
    """Validate an explicit ID edit, preserving omitted fields and hierarchy."""
    from .mappers import ValidationError
    from .models import PlacementProgramme, PlacementCohort, PlacementGroup

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
        elif kind in payload and payload[kind]:
            raise ValidationError(f'Use {key} to change placement; names are display-only.')
    return result
