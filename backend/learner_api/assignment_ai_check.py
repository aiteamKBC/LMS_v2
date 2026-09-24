"""AI-writing review with normal CSRF protection and learner ownership checks."""
import json
import logging
from django.conf import settings
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_http_methods
from . import local_ai_detector, openai_ai_detector
from .local_ai_detector import DetectorBusy, DetectorUnavailable

logger = logging.getLogger(__name__)


@require_http_methods(['GET', 'POST'])
def assignment_ai_check(request):
    if request.method == 'GET':
        response = JsonResponse({'csrfToken': get_token(request)})
        response['Cache-Control'] = 'no-store'
        return response
    from login.permissions import learner_self_or_admin
    return learner_self_or_admin(body_field='learnerId')(_check)(request)


def _run_check(text):
    if getattr(settings, 'AI_CHECK_PROVIDER', 'openai') == 'local':
        return local_ai_detector.check_text(text)
    if not settings.OPENAI_API_KEY:
        raise DetectorUnavailable('The AI writing check is not configured.')
    from .reflection_ai import _openai_client
    client = _openai_client()
    if client is None:
        raise DetectorUnavailable('The AI writing check is unavailable on the server.')
    return openai_ai_detector.check_text(text, client=client, model=settings.OPENAI_REFLECTION_MODEL)


def _check(request):
    if len(request.body) > 150000:
        return JsonResponse({'error': 'The text is too long for an AI writing check.'}, status=413)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict) or payload.get('learnerKind') not in ('commercial', 'apprenticeship'):
            raise ValueError('A valid learner and text are required.')
        response = JsonResponse(_run_check(payload.get('text')))
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
    except Exception as exc:
        # Log the failure type only; never the learner's text.
        logger.error('Assignment AI writing check failed: %s', type(exc).__name__)
        return JsonResponse({'error': 'The AI writing check is unavailable right now. Your answer has not been changed.'}, status=503)
