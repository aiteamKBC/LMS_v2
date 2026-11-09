"""Independent reading completion for an exact, owned legacy reading/quiz pair."""
import re


def reading_part(enrolment_id, aptem_id, group_id, activity_id, definition):
    from . import canonical_learning

    owner = canonical_learning.require_profile(enrolment_id)
    if owner['aptem_id'] != aptem_id:
        raise canonical_learning.ServiceError('The learner identity needs review.', 'identity_conflict', 409)
    catalogue = canonical_learning.source_subjects(enrolment_id,
        lambda items: {'activities': items}, owner=owner, course_ids=[group_id], include_totals=False)
    materials = [item for item in catalogue['activities']
        if item.get('group_id') == group_id and item.get('source_activity_id') == activity_id
        and item.get('catalogue_kind') == 'material' and item.get('can_open_material') is not False
        and re.fullmatch(r'reading\s*\+\s*quiz', item.get('category') or '', re.I)]
    if len(materials) != 1 or not definition.get('has_reading'):
        raise canonical_learning.ServiceError('Reading and quiz pair not found.', 'not_found', 404)
    material = materials[0]
    quizzes = [item for item in catalogue['activities']
        if item.get('group_id') == group_id and item.get('catalogue_kind') == 'quiz'
        and item.get('source_material_activity_id') == material['activity_id']]
    # source_material_activity_id is produced only by verified, bidirectional
    # catalogue links. Never turn an arbitrary combined assessment into reading.
    if len(quizzes) != 1 or (definition.get('quiz') and
            str(definition['quiz']['id']) != str(quizzes[0]['source_activity_id'])):
        raise canonical_learning.ServiceError('The reading and quiz link needs review.', 'ambiguous_pair', 409)
    return {**definition, 'quiz': None, 'activity_part': 'reading'}, bool(material['completed'])
