import json

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from login.permissions import require_role
from .models import QuizDefaults
from .policy import load_defaults, validate_general, validate_grades


@require_role('admin', 'staff')
@require_http_methods(['GET', 'PUT'])
@csrf_protect
@ensure_csrf_cookie
def quiz_defaults(request):
    try:
        if request.method == 'GET':
            return JsonResponse({**load_defaults(), 'csrfToken': get_token(request)})
        payload = json.loads(request.body)
        if not isinstance(payload, dict) or set(payload) != {'general', 'grades', 'revision'}:
            raise ValueError('Provide general settings, grades and the loaded revision.')
        general, grades = validate_general(payload['general']), validate_grades(payload['grades'])
        with transaction.atomic():
            row = QuizDefaults.objects.select_for_update().get(pk=1)
            if type(payload['revision']) is not int or payload['revision'] != row.revision:
                return JsonResponse({'error': 'Quiz defaults changed. Reload them before saving your changes.',
                                     'code': 'quiz_defaults_conflict'}, status=409)
            row.general, row.grades, row.revision = general, grades, row.revision + 1
            row.save(update_fields=['general', 'grades', 'revision', 'updated_at'])
        return JsonResponse({'general': general, 'grades': grades, 'revision': row.revision,
                             'csrfToken': get_token(request)})
    except (ValueError, UnicodeDecodeError) as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except (DatabaseError, QuizDefaults.DoesNotExist):
        return JsonResponse({'error': 'Could not load or save quiz defaults. Please retry.'}, status=503)
