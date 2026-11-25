"""Existing tutor workspace input validation and JSON response; route guards are unchanged."""


def curriculum_tutor_workspace(request, *, clean_str, json_error, JsonResponse, tutor_workspace_payload):
    email = clean_str(request.GET.get('email'))
    name = clean_str(request.GET.get('name'))
    if not email and not name:
        return json_error('An email or a name is required.')
    return JsonResponse(tutor_workspace_payload(email, name))
