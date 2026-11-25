"""Validate destination lineage over already-read rows without changing identity."""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.hierarchy_values import programme_status_is_archived


def destination_identifiers(payload):
    identifiers = {key: clean_str(payload.get(key)) for key in ('programmeId', 'cohortId', 'groupId')}
    if not all(identifiers.values()):
        raise ValueError('Choose a Programme, Cohort and Group.')
    return identifiers


def placement_from_rows(identifiers, programme, cohort, group, *, curriculum_row_effectively_deleted):
    if not programme or not cohort or not group:
        raise ValueError('The destination Programme, Cohort or Group no longer exists.')
    if (is_archived_program_config(programme)
            or curriculum_row_effectively_deleted(cohort)
            or curriculum_row_effectively_deleted(group)
            or programme_status_is_archived(cohort.get('status'))
            or programme_status_is_archived(group.get('status'))):
        raise ValueError('Choose an active Programme, Cohort and Group.')
    if (clean_str(cohort.get('programme_id')) != identifiers['programmeId']
            or clean_str(group.get('programme_id')) != identifiers['programmeId']
            or clean_str(group.get('cohort_id')) != clean_str(cohort.get('cohort_id'))):
        raise ValueError('The selected Group must belong to the selected Cohort and Programme.')
    return {
        'programme_id': identifiers['programmeId'], 'programme_name': clean_str(programme.get('name')),
        'cohort_id': clean_str(cohort.get('cohort_id')), 'cohort_name': clean_str(cohort.get('cohort_name')),
        'group_id': clean_str(group.get('group_id')), 'group_name': clean_str(group.get('group_name')),
    }, group
