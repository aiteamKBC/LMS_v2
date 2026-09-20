"""Local text review with normal CSRF protection and learner ownership checks."""
import json
import logging
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_http_methods
from .local_ai_detector import check_text, DetectorBusy, DetectorUnavailable

logger = logging.getLogger(__name__)


@require_http_methods(['GET', 'POST'])
def assignment_ai_check(request):
    if request.method == 'GET':
        response = JsonResponse({'csrfToken': get_token(request)})
        response['Cache-Control'] = 'no-store'
        return response
    from login.permissions import learner_self_or_admin
    return learner_self_or_admin(body_field='learnerId')(_check)(request)


def _check(request):
    if len(request.body) > 150000:
        return JsonResponse({'error': 'The text is too long for a local check.'}, status=413)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict) or payload.get('learnerKind') not in ('commercial', 'apprenticeship'):
            raise ValueError('A valid learner and text are required.')
        response = JsonResponse(check_text(payload.get('text')))
        response['Cache-Control'] = 'no-store'
        return response
    except (ValueError, UnicodeError) as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except DetectorBusy as exc:
        response = JsonResponse({'error': str(exc)}, status=429)
        response['Retry-After'] = '5'
        return response
    except DetectorUnavailable as exc:
        return JsonResponse({'error': str(exc)}, status=503)
    except Exception:
        logger.error('Local assignment AI checker failed')
        return JsonResponse({'error': 'The local checker is unavailable. Your answer has not been changed.'}, status=503)
