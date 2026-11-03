"""KSB-only correction through the owned, attributed marking endpoint."""
import json

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.utils import timezone

from learner_api.reflection_ksbs import (
    KsbReviewError, corrected_fields, programme_catalogue, review_summary,
)


def detail_context(item):
    if item.get('ksbReview', {}).get('status') == 'pending':
        catalogue = programme_catalogue(item['learnerKind'], item['learnerId'])
        item['ksbReview'].update(catalogue)
    return item


def save_review(request, submission_id, allowed_learner_ids, payload):
    if not allowed_learner_ids:
        return JsonResponse({'detail': 'Submission not found.'}, status=404)
    try:
        with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
            cursor.execute('''SELECT learner_kind,learner_id,status,ksb_codes,ksb_weights,ksb_explanations,
                confidence_before,confidence_after,full_submission
                FROM "Learner".learning_reflection_submissions
                WHERE id=%s AND learner_id=ANY(%s) FOR UPDATE''', [str(submission_id), allowed_learner_ids])
            value = cursor.fetchone()
            if not value:
                return JsonResponse({'detail': 'Submission not found.'}, status=404)
            row = dict(zip([column[0] for column in cursor.description], value))
            catalogue = programme_catalogue(row['learner_kind'], row['learner_id'])
            actor = getattr(request, 'coach_view_as_admin', None) if getattr(request, 'coach_view_as', False) else getattr(request, 'login_account', None)
            actor_name = str(getattr(actor, 'username', '') or getattr(actor, 'email', '') or request.coach_email)
            if getattr(request, 'coach_view_as', False):
                actor_name += f' (for {request.coach_email})'
            fields = corrected_fields(row, payload, catalogue, actor=actor_name, reviewed_at=timezone.now().isoformat())
            columns = list(fields)
            cursor.execute('UPDATE "Learner".learning_reflection_submissions SET '
                + ', '.join(f'{column}=%s::jsonb' for column in columns)
                + ' WHERE id=%s AND learner_id=ANY(%s)',
                [*(json.dumps(fields[column]) for column in columns), str(submission_id), allowed_learner_ids])
    except KsbReviewError as exc:
        return JsonResponse({'detail': str(exc)}, status=exc.status)
    except DatabaseError:
        return JsonResponse({'detail': 'The KSB correction could not be saved. Please retry.'}, status=503)
    return JsonResponse({'id': str(submission_id), 'status': row['status'],
                         'ksbReview': review_summary(fields['full_submission'])})
