"""Historical course percentages are display references, never activity credit."""
from datetime import datetime
import json
from math import isfinite


def public_reference(snapshot, owner, course):
    """Only expose a verified snapshot for this learner's exact membership."""
    if isinstance(snapshot, str):
        try:
            snapshot = json.loads(snapshot)
        except ValueError:
            return None
    if not isinstance(snapshot, dict) or snapshot.get('version') != 1:
        return None
    if snapshot.get('basis') != 'old_lms:course_progress':
        return None
    identities = {
        'learner_id': owner.get('id'), 'enrolment_id': owner.get('enrolment_id'),
        'source_learner_id': course.get('source_learner_id'),
        'source_course_ref': course.get('source_course_ref'),
    }
    if any(value is None or str(snapshot.get(key)) != str(value) for key, value in identities.items()):
        return None
    percent = snapshot.get('percent')
    if type(percent) not in (int, float) or not isfinite(percent) or not 0 <= percent <= 100:
        return None
    try:
        captured = datetime.fromisoformat(snapshot['captured_at'].replace('Z', '+00:00'))
        if captured.tzinfo is None:
            return None
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    return {'percent': percent, 'capturedAt': captured.isoformat()}
