"""Server-owned attendance baseline for the first live-session reflection."""
from django.db import connections


def attendance_baseline(record, history, *, source=None, learner=None):
    if (record.get('kind') not in {'component', 'video'}
            or str(record.get('componentType') or '').replace('-', '_').lower() not in {'live_session', 'recording_placeholder', 'video'}
            or record.get('retakeTimeChoice') not in ('correct', 'add', 'retry')):
        return 0
    component_id = record.get('componentId')
    if any(row.get('componentId') == component_id and row.get('kind') in ('component', 'video')
           and row.get('passed') is not False for row in history):
        return 0
    if source is None:
        from .models import CommercialUser, EnrolmentUser
        model = {'commercial': CommercialUser, 'apprenticeship': EnrolmentUser}.get(learner.learner_type)
        if model is None or not learner.enrolment_id:
            return 0
        source = model.objects.get(pk=learner.enrolment_id)
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('SELECT module_catalogue_id,settings_json FROM curriculum.components WHERE id=%s', [component_id])
        row = cursor.fetchone()
    if not row:
        return 0
    if record.get('componentType') == 'video' and not all(
            (row[1] or {}).get(key) for key in ('recordingSeriesId', 'recordingSessionNumber', 'recordingDate')):
        return 0
    # Read the whole module so another card for the same occurrence cannot be
    # hidden by a single-component request. Existing attendance rules own credit.
    from .live_session_progress import read_live_credits
    credits = read_live_credits(source, module_ids=[row[0]])
    matches = [credit for credit in credits if credit['componentId'] == component_id]
    return matches[0]['hours'] * 3600 if len(matches) == 1 else 0
