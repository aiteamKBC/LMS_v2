import json

from django.http import JsonResponse


def json_body(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def json_error(message, status=400, **extra):
    payload = {'error': message}
    payload.update(extra)
    return JsonResponse(payload, status=status)


def require_fields(payload, fields):
    return [field for field in fields if payload.get(field) in (None, '')]
