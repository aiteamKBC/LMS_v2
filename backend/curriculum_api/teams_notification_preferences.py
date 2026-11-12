"""Explicit LMS email choice, independent from Microsoft calendar updates."""
import json


def lms_email_requested(request):
    """An omitted, invalid or truthy string preference never opts into email."""
    try:
        body = json.loads(request.body or b'{}') if request is not None else {}
    except (AttributeError, TypeError, ValueError):
        return False
    return isinstance(body, dict) and body.get('sendLmsEmails') is True
