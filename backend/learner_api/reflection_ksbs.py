"""Programme-owned reflection choices and audited KSB-only coach corrections."""
from copy import deepcopy

PENDING_KSB_REVIEW_SQL = "coalesce(full_submission #>> '{ksbReview,status}', '') = 'pending'"
KSB_FIELDS = {
    'ksb_codes': 'ksbCodes', 'ksb_weights': 'ksbWeights', 'ksb_explanations': 'ksbExplanations',
    'confidence_before': 'confidenceBefore', 'confidence_after': 'confidenceAfter',
}


class KsbReviewError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def programme_catalogue(kind, learner_id):
    from .models import EnrolmentUser
    from .active_users import _resolve_programme_id, _resolve_ksb_profile_source_id
    from .mappers import get_training_plan
    from .ksb_sources import resolve_source

    source = EnrolmentUser.all_learners.using('enrolment').filter(pk=learner_id, learner_type=kind).first()
    if source is None:
        raise KsbReviewError('The learner programme could not be verified.', 503)
    plan = get_training_plan(source)
    programme_id = _resolve_programme_id(source.programme, plan)
    source_id = _resolve_ksb_profile_source_id(programme_id, source.programme, plan)
    resolved = resolve_source(source_id, using='enrolment')
    if not source_id or not resolved.items:
        raise KsbReviewError('The programme KSB list is unavailable. Please reload before submitting.', 503)
    return {'programme': source.programme, 'sourceId': resolved.source_value,
            'items': [{'code': item['code'], 'description': item['description']} for item in resolved.items]}


def checked_codes(values, catalogue, *, required=False):
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise KsbReviewError('Choose KSBs from the programme list.')
    codes = list(dict.fromkeys(value.strip().upper() for value in values if value.strip()))
    allowed = {item['code'].strip().upper() for item in catalogue['items']}
    invalid = [code for code in codes if code not in allowed]
    if invalid:
        raise KsbReviewError('These KSBs do not belong to the learner programme: ' + ', '.join(invalid) + '.')
    if required and not codes:
        raise KsbReviewError('Select at least one programme KSB.')
    return codes


def review_summary(document):
    marker = document.get('ksbReview') if isinstance(document, dict) else None
    if not isinstance(marker, dict) or marker.get('status') not in {'pending', 'completed'}:
        return None
    return {key: deepcopy(marker.get(key)) for key in (
        'status', 'revision', 'programme', 'sourceId', 'requestedAt', 'reason', 'originalCodes',
        'reviewedAt', 'reviewedBy', 'correctionReason',
    )}


def request_review(row, catalogue, *, actor, requested_at, revision):
    """Keep the accepted decision and original KSB documents intact."""
    document = deepcopy(row.get('full_submission') or {})
    if document.get('ksbReview'):
        raise KsbReviewError('This submission already has a KSB review record.', 409)
    if row['status'] != 'accepted':
        raise KsbReviewError('Only the selected accepted reflections can be flagged.', 409)
    codes = row.get('ksb_codes') or []
    valid = {item['code'] for item in catalogue['items']}
    if not set(codes) - valid:
        raise KsbReviewError('The saved codes already belong to the programme.', 409)
    original = {name: deepcopy(row.get(column)) for column, name in KSB_FIELDS.items()}
    original.update({key: str(row[key]) if row.get(key) is not None else None
                     for key in ('status', 'coach_feedback', 'reviewed_by', 'reviewed_at', 'submitted_at')})
    document['ksbReview'] = {
        'status': 'pending', 'revision': revision, 'programme': catalogue['programme'],
        'sourceId': catalogue['sourceId'], 'requestedAt': requested_at, 'requestedBy': actor,
        'reason': 'Saved KSBs include codes outside the learner programme. Coach review required.',
        'originalCodes': deepcopy(codes), 'original': original,
    }
    return document


def corrected_fields(row, payload, catalogue, *, actor, reviewed_at):
    document = deepcopy(row.get('full_submission') or {})
    marker = document.get('ksbReview') or {}
    if row['status'] != 'accepted' or marker.get('status') != 'pending':
        raise KsbReviewError('This KSB review is no longer pending. Reload the submission.', 409)
    if payload.get('revision') != marker.get('revision') or payload.get('sourceId') != catalogue['sourceId']:
        raise KsbReviewError('The KSB review or programme changed. Reload before saving.', 409)
    codes = checked_codes(payload.get('ksbCodes'), catalogue, required=True)
    reason = str(payload.get('reason') or '').strip()
    if not reason or len(reason) > 4000:
        raise KsbReviewError('Explain the KSB correction in 1 to 4000 characters.')
    result = {'ksb_codes': codes}
    for column, key in KSB_FIELDS.items():
        if column != 'ksb_codes':
            # Never invent learner explanations, weights or confidence scores
            # for newly selected codes. Originals remain in the audit snapshot.
            values = row.get(column) or {}
            result[column] = {code: deepcopy(values[code]) for code in codes if code in values}
        document[key] = result[column]
    marker.update(status='completed', reviewedAt=reviewed_at, reviewedBy=actor,
                  correctionReason=reason, programme=catalogue['programme'], sourceId=catalogue['sourceId'])
    result['full_submission'] = document
    return result
