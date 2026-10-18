"""Native form adapter for the maintained learner absence-report workflow.

The canonical handler still owns session eligibility, report persistence,
approval, recovery records and notifications. No meeting is changed here.
"""
import json

from django.http import JsonResponse, QueryDict
from django.utils.datastructures import MultiValueDict
from django.views.decorators.csrf import csrf_exempt

from . import mobile


FORM_FIELDS = frozenset({
    "sessionId", "sessionTitle", "sessionDate", "sessionTime", "reasonCategory",
    "otherReason", "explanation", "recoveryMethod", "targetOccurrenceId",
    "recordingDate", "recordingTime", "recordingDurationMinutes",
})
SCOPES = frozenset({"lectures", "meetings"})
_MISSING = object()


def _scope(value):
    if not isinstance(value, str) or value not in SCOPES:
        raise mobile.MobileError("Choose live sessions or coaching and reviews.")
    return value


def _canonical(request, scope, form=None):
    from .absence_reports import learner_absence_reports

    account, source, kind, _ = request.mobile_context
    path = f"/learner_api/absence-reports/{kind}/{source.pk}/"
    refusal = mobile.refusal_for(path, account, method=request.method)
    if refusal is not None:
        return refusal
    # The established view consumes form fields. Keep the existing signed-in
    # request and decorated ownership check; restore every temporary attribute.
    names = ("GET", "path", "path_info", "_post", "_files")
    original = {name: request.__dict__.get(name, _MISSING) for name in names}
    try:
        request.GET = QueryDict("scope=meetings" if scope == "meetings" else "")
        request.path = request.path_info = path
        if form is not None:
            post = QueryDict("", mutable=True)
            post.update(form)
            request.POST = post
            request._files = MultiValueDict()
        return learner_absence_reports(request, kind=kind, learner_id=source.pk)
    finally:
        for name, value in original.items():
            if value is _MISSING:
                request.__dict__.pop(name, None)
            else:
                request.__dict__[name] = value


@mobile.endpoint("GET")
def _read(request):
    if set(request.GET) - {"scope"} or len(request.GET.getlist("scope")) > 1:
        raise mobile.MobileError("The absence request contains unsupported query fields.")
    scope = _scope(request.GET.get("scope", "lectures"))
    response = _canonical(request, scope)
    if response.status_code != 200:
        return response
    try:
        payload = json.loads(response.content)
    except (ValueError, TypeError):
        raise mobile.MobileError("The LMS could not load your absence reports.", 502, "invalid_lms_response") from None
    if not isinstance(payload, dict):
        raise mobile.MobileError("The LMS could not load your absence reports.", 502, "invalid_lms_response")
    _, source, kind, _ = request.mobile_context
    return JsonResponse({**payload, "learner": {"id": str(source.pk), "kind": kind}})


@mobile.endpoint("POST")
def _submit(request):
    payload = mobile._only(mobile._body(request), FORM_FIELDS | {"scope"})
    if any(not isinstance(value, str) for value in payload.values()):
        raise mobile.MobileError("Absence form fields must be text values.")
    scope = _scope(payload.get("scope", "lectures"))
    form = {key: value for key, value in payload.items() if key in FORM_FIELDS}
    session_id = form.get("sessionId", "").strip()
    if not session_id:
        raise mobile.MobileError("Choose a session from your absence list.")
    if session_id.startswith("meeting:") != (scope == "meetings"):
        raise mobile.MobileError("The selected session does not match this absence list.")
    if form.get("recoveryMethod", "") not in {"", "recorded", "alternative"}:
        raise mobile.MobileError("Arrange a coach catch-up through the LMS.")
    # A paused profile can still report its own missed session. The canonical
    # workflow applies that policy; study-completion gates do not belong here.
    return _canonical(request, scope, form)


@csrf_exempt
def absence_reports(request):
    if request.method == "GET":
        return _read(request)
    if request.method == "POST":
        return _submit(request)
    return mobile._error("Method not allowed.", 405, "method_not_allowed")
