"""Staff-only, bounded Entra directory lookup for Teams role pickers."""
import re
from urllib.parse import urlencode

from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import require_role


def directory_query(value):
    query = str(value or '').strip()
    if len(query) < 2:
        return None
    if len(query) > 80 or any(ord(char) < 32 for char in query):
        raise ValueError('Search using 2 to 80 characters.')
    literal = query.replace("'", "''")
    names = ('displayName', 'givenName', 'surname', 'mail', 'userPrincipalName')
    match = ' or '.join(f"startswith({name},'{literal}')" for name in names)
    return 'users?' + urlencode({
        '$select': 'id,displayName,mail,userPrincipalName,userType,accountEnabled',
        '$filter': f"accountEnabled eq true and userType eq 'Member' and ({match})", '$top': 12,
    })


def directory_people(data):
    if not isinstance(data, dict) or not isinstance(data.get('value'), list):
        raise RuntimeError('The directory response could not be read.')
    people, seen = [], set()
    for user in data['value'][:12]:
        if not isinstance(user, dict):
            continue
        if user.get('accountEnabled') is not True or user.get('userType') != 'Member':
            continue
        email = str(user.get('mail') or user.get('userPrincipalName') or '').strip()
        if not user.get('id') or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email) or email.lower() in seen:
            continue
        seen.add(email.lower())
        people.append({'id': user['id'], 'name': str(user.get('displayName') or email), 'email': email})
    return {'people': people, 'hasMore': bool(data.get('@odata.nextLink'))}


@require_role('admin', 'staff')
@require_GET
def search_teams_directory(request):
    from coach_api.views import microsoft_graph_request

    try:
        path = directory_query(request.GET.get('q'))
        result = directory_people(microsoft_graph_request('GET', path)) if path else {'people': [], 'hasMore': False}
        response = JsonResponse(result)
    except ValueError as exc:
        response = JsonResponse({'error': str(exc)}, status=400)
    except RuntimeError:
        response = JsonResponse({'error': 'Entra search is unavailable. Retry or enter a full email address.'}, status=502)
    response['Cache-Control'] = 'no-store, private'
    return response
