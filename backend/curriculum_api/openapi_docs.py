"""Swagger UI for every endpoint under ``/curriculum_api/`` (local DEBUG only).

The curriculum views are plain Django function views (``@require_GET``,
``@csrf_exempt`` ...), which DRF-based schema generators cannot see. This module
walks the live URL resolver instead and builds an OpenAPI 3 document from it:

* path parameters come from the route converters (``<int:pk>`` -> integer);
* HTTP methods come from ``require_http_methods`` closures, a class view's
  handlers, or -- for views that branch on ``request.method`` -- the source;
* the summary/description come from the view's docstring.

Request fields, query parameters, status codes, access rules and external
effects come from openapi_contracts (static analysis of each view and its
helpers); GET response schemas come from openapi_observed_shapes.json (types
observed against the configured database, no values) where available. Each
operation states its completeness, so a partial contract is never shown as whole.

Building the document reads code only, never the database. Both endpoints return
404 unless ``DEBUG`` is on. "Try it out" sends the browser's own session cookie
plus the CSRF token, so the usual authentication and role checks still apply;
every write asks for confirmation in the page before it is sent.
"""
import inspect
import json
import re
from pathlib import Path

from django.conf import settings
from django.http import Http404, HttpResponse, JsonResponse
from django.urls import URLPattern, URLResolver, get_resolver
from django.views.decorators.http import require_GET

PREFIX = 'curriculum_api/'
HTTP_METHODS = ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
_CONVERTER_TYPES = {
    'int': {'type': 'integer'},
    'uuid': {'type': 'string', 'format': 'uuid'},
}
_ROUTE_PARAM = re.compile(r'<(?:(?P<conv>[^>:]+):)?(?P<name>\w+)>')
_REGEX_PARAM = re.compile(r'\(\?P<(?P<name>\w+)>[^)]*\)')
_SOURCE_METHOD = re.compile(r"""request\.method\s*(?:==|!=|in|not in)\s*[\(\[\{]?\s*(['"][A-Z]+['"](?:\s*,\s*['"][A-Z]+['"])*)""")
_DOCS_PATHS = {'curriculum_api/docs/', 'curriculum_api/docs/openapi.json'}


def _iter_patterns(patterns, prefix=''):
    for entry in patterns:
        if isinstance(entry, URLResolver):
            yield from _iter_patterns(entry.url_patterns, prefix + str(entry.pattern))
        elif isinstance(entry, URLPattern):
            yield prefix + str(entry.pattern), entry.callback


def _to_openapi_path(route):
    """Django route -> (OpenAPI path, [path parameters])."""
    params = []
    route = route.lstrip('^').rstrip('$').replace('\\Z', '')

    def from_route(match):
        schema = _CONVERTER_TYPES.get(match.group('conv') or 'str', {'type': 'string'})
        params.append({'name': match.group('name'), 'in': 'path', 'required': True, 'schema': dict(schema)})
        return '{%s}' % match.group('name')

    def from_regex(match):
        params.append({'name': match.group('name'), 'in': 'path', 'required': True, 'schema': {'type': 'string'}})
        return '{%s}' % match.group('name')

    route = _ROUTE_PARAM.sub(from_route, route)
    route = _REGEX_PARAM.sub(from_regex, route)
    route = route.replace('\\', '').replace('^', '')
    return '/' + route, params


def _unwrap_chain(view):
    seen = set()
    while view is not None and id(view) not in seen:
        seen.add(id(view))
        yield view
        view = getattr(view, '__wrapped__', None)


def _methods_from_closures(view):
    found = _methods_in(_unwrap_chain(view))
    if found:
        return found
    # A decorator that applies ``@wraps(view)`` over its own inner wrappers points
    # ``__wrapped__`` straight at the view, skipping the function that holds the
    # method list (``coach_api.migrated_template_views.management_endpoint``).
    # Only when the chain found nothing, follow the functions held in closures.
    return _methods_in(_closure_functions(view))


def _closure_functions(view, depth=6):
    pending, seen = [view], set()
    while pending and depth:
        depth -= 1
        nested = []
        for func in pending:
            if id(func) in seen:
                continue
            seen.add(id(func))
            yield func
            for cell in getattr(func, '__closure__', None) or ():
                try:
                    value = cell.cell_contents
                except ValueError:
                    continue
                if inspect.isfunction(value):
                    nested.append(value)
        pending = nested


def _methods_in(functions):
    for func in functions:
        for cell in getattr(func, '__closure__', None) or ():
            try:
                value = cell.cell_contents
            except ValueError:
                continue
            if isinstance(value, (list, tuple, set, frozenset)) and value and all(
                isinstance(item, str) and item.upper() in HTTP_METHODS + ('HEAD', 'OPTIONS') for item in value
            ):
                return [m.upper() for m in value if m.upper() in HTTP_METHODS]
            # A decorator taking one method, e.g. ``@staff_view('POST')``.
            if isinstance(value, str) and value in HTTP_METHODS:
                return [value]
    return []


def _innermost(view):
    last = view
    for func in _unwrap_chain(view):
        last = func
    return last


def _view_methods(view):
    view_class = getattr(view, 'view_class', None) or getattr(view, 'cls', None)
    if view_class is not None:
        found = [m for m in HTTP_METHODS if hasattr(view_class, m.lower())]
        return found or ['GET']
    found = _methods_from_closures(view)
    if found:
        return found
    try:
        source = inspect.getsource(_innermost(view))
    except (OSError, TypeError):
        source = ''
    # `request.method != 'POST'` / `not in (...)` is a guard: past it only those
    # methods remain, plus any handled by an `==` branch above it (a GET read
    # before the POST guard). Without a guard, an `==` branch's fall-through is
    # normally the GET read, so GET is implied.
    # A "guard" that hands every other method to another view
    # (`if request.method != 'POST': return v.other_view(request)`) is a
    # dispatcher, not a refusal, so it only counts as a branch.
    allowed, branched = set(), set()
    for match in _SOURCE_METHOD.finditer(source):
        methods = {m for m in re.findall(r'[A-Z]+', match.group(1)) if m in HTTP_METHODS}
        following = source[match.end():].split('\n', 2)[1:2]
        refuses = bool(following) and re.search(r'error|40[0-9]|NotAllowed|JsonResponse|Response\(', following[0])
        if re.search(r'!=|not in', match.group(0)) and refuses:
            allowed |= methods
        else:
            branched |= methods
    if allowed:
        found = allowed | branched
    elif branched:
        found = branched | {'GET'}
    else:
        found = {'GET'}
    return sorted(found, key=HTTP_METHODS.index)


def _tag_for(path):
    segments = [s for s in path[len('/' + PREFIX):].split('/') if s and not s.startswith('{')]
    # Most routes live under /curriculum_api/curriculum/<area>/; group by <area>.
    if len(segments) > 1 and segments[0] == 'curriculum':
        return segments[1]
    return segments[0] if segments else 'curriculum'


WRITE_METHODS = ('POST', 'PUT', 'PATCH', 'DELETE')
OBSERVED_SHAPES_FILE = Path(__file__).with_name('openapi_observed_shapes.json')
_ROLE_TEXT = {
    None: 'Any caller (no session required by the API gate).',
    frozenset({'admin', 'staff'}): 'Signed-in staff or admin.',
    frozenset({'admin', 'staff', 'learner'}): 'Signed-in staff, admin or learner.',
}
_STATUS_TEXT = {
    200: 'Success', 201: 'Created', 202: 'Accepted (work continues in the background)', 204: 'No content',
    304: 'Not modified (ETag matched)', 400: 'Invalid request (validation failed)', 401: 'Not signed in',
    403: 'Signed in without permission', 404: 'Not found', 405: 'Method not allowed',
    409: 'Conflict with the current state (e.g. a concurrent edit or a duplicate)', 410: 'Gone',
    412: 'Precondition failed (stale version)', 413: 'Payload too large', 415: 'Unsupported media type',
    422: 'Unprocessable request', 423: 'Locked', 429: 'Too many requests', 500: 'Server error',
    502: 'Upstream (e.g. Microsoft Graph) failed', 503: 'Service or schema unavailable', 504: 'Upstream timed out',
}
_ERROR_SCHEMA = {
    'type': 'object',
    'properties': {'error': {'type': 'string'}, 'code': {'type': 'string'}},
    'additionalProperties': True,
}


def _observed_shapes():
    try:
        return json.loads(OBSERVED_SHAPES_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'observed_at': None, 'operations': {}}


def _gate_roles(path):
    """Roles the API session gate admits for this path (None = ungated)."""
    try:
        from login.api_gate import rule_for
    except Exception:
        return 'unknown'
    concrete = re.sub(r'\{[^}]+\}', 'x', path)
    rule = rule_for(concrete)
    return None if rule is None else rule[1]


def _access_text(gate_roles, facts):
    lines = []
    if gate_roles == 'unknown':
        lines.append('API gate: could not be determined.')
    elif gate_roles is None:
        lines.append('API gate: ' + _ROLE_TEXT[None])
    else:
        lines.append('API gate: ' + _ROLE_TEXT.get(frozenset(gate_roles),
                                                   'roles ' + ', '.join(sorted(gate_roles)) + '.'))
    if facts['guards']:
        lines.append('View decorators: ' + '; '.join(facts['guards']) + '.')
    if facts['in_view_checks']:
        lines.append('In-view checks called: ' + ', '.join(f'`{name}()`' for name in facts['in_view_checks']) + '.')
    return ' '.join(lines)


def _summary_for(method, doc, name):
    """The docstring line about this method, else its first line when that does
    not describe another method, else the function name in words."""
    lines = [line.strip() for line in (doc or '').splitlines() if line.strip()]
    for line in lines:
        if re.match(rf'^{method}\b', line):
            return line
    if lines and not re.match(r'^(GET|POST|PUT|PATCH|DELETE)\b', lines[0]):
        return lines[0]
    return f'{method} {name.replace("_", " ")}'


def build_curriculum_openapi():
    from .openapi_contracts import analyse_view, schema_from_fields

    observed = _observed_shapes()
    observed_ops = observed.get('operations', {})
    refused = set(observed.get('refused', []))
    paths = {}
    operation_ids = set()
    for route, view in _iter_patterns(get_resolver().url_patterns):
        if not route.lstrip('^').startswith(PREFIX) or route in _DOCS_PATHS:
            continue
        path, params = _to_openapi_path(route)
        target = _innermost(view)
        doc = inspect.getdoc(target) or ''
        summary = doc.split('\n', 1)[0].strip() or getattr(target, '__name__', 'view').replace('_', ' ')
        module = getattr(target, '__module__', '')
        name = getattr(target, '__name__', 'view')
        facts = analyse_view(view, target)
        gate_roles = _gate_roles(path)
        access = _access_text(gate_roles, facts)
        for method in _view_methods(view):
            if f'{method} {path}' in refused:
                continue  # the live view answered 405: the static inference was wrong
            operation_id = f'{method.lower()}_{name}'
            suffix = 2
            while operation_id in operation_ids:
                operation_id = f'{method.lower()}_{name}_{suffix}'
                suffix += 1
            operation_ids.add(operation_id)
            gaps = []
            summary = _summary_for(method, doc, name)
            effects = [text for text in facts['external'] if method in WRITE_METHODS or not text.startswith('Writes')]
            warnings = (['State-changing: writes to the configured curriculum database (real data).']
                        if method in WRITE_METHODS else []) + effects

            parameters = list(params)
            for query_name, field in sorted(facts['query'].items()):
                parameters.append({
                    'name': query_name, 'in': 'query', 'required': field['required'],
                    'schema': field['schema'] or {'type': 'string'},
                })

            observed_op = observed_ops.get(f'{method} {path}')
            if observed_op and observed_op.get('schema') is not None:
                # Stored already sanitised by shape_to_schema: types only, and
                # data-derived keys (ids, emails, names) collapsed into maps.
                success_schema = observed_op['schema']
                success_source = f'observed ({observed.get("observed_at")})'
            elif facts['response_keys']:
                success_schema = {'type': 'object', 'additionalProperties': True,
                                  'properties': {key: {} for key in facts['response_keys']}}
                success_source = 'static (top-level keys of JsonResponse literals; types not stated)'
                gaps.append('response field types')
            else:
                success_schema = {}
                success_source = 'not determined'
                gaps.append('response schema')
            responses = {'200': {
                'description': f'Success. Schema source: {success_source}.',
                'content': {'application/json': {'schema': success_schema}},
            }}
            statuses = set(facts['statuses']) | {401, 403}
            if params:
                statuses.add(404)
            for status in sorted(statuses):
                if status == 200:
                    continue
                entry = {'description': _STATUS_TEXT.get(status, 'See view')}
                if status >= 400:
                    entry['content'] = {'application/json': {'schema': _ERROR_SCHEMA}}
                responses[str(status)] = entry

            operation = {
                'tags': [_tag_for(path)],
                'summary': (('⚠️ ' if warnings else '') + summary)[:120],
                'operationId': operation_id,
                'parameters': parameters,
                'responses': responses,
                'security': [{'kbcSession': []}] if gate_roles is not None else [],
                'x-view': f'{module}.{name}',
                'x-access': access,
                'x-state-changing': method in WRITE_METHODS,
                'x-external-effects': effects,
                'x-schema-source': {'response': success_source},
            }
            if method in WRITE_METHODS:
                body_schema = schema_from_fields(facts['body'])
                if facts['body']:
                    body_source = 'static (fields the view and its helpers read)'
                    if any(not field['schema'] for field in facts['body'].values()):
                        gaps.append('some request field types')
                else:
                    body_source = 'not determined (no body fields found in the view)'
                    gaps.append('request body')
                operation['requestBody'] = {
                    'required': any(field['required'] for field in facts['body'].values()),
                    'description': f'Schema source: {body_source}.',
                    'content': {'application/json': {'schema': body_schema}},
                }
                operation['x-schema-source']['request'] = body_source
            if not facts['analysed']:
                gaps.append('source not analysable')
            operation['x-contract-completeness'] = 'complete' if not gaps else 'partial'
            operation['x-contract-gaps'] = gaps
            description = []
            if warnings:
                description.append('**Warnings:** ' + ' '.join(warnings))
            description.append('**Access:** ' + access)
            if doc:
                description.append(doc)
            if gaps:
                description.append('**Contract not fully determined:** ' + ', '.join(gaps) + '.')
            description.append(f'View: `{module}.{name}`')
            operation['description'] = '\n\n'.join(description)
            paths.setdefault(path, {})[method.lower()] = operation
    return {
        'openapi': '3.0.3',
        'info': {
            'title': 'KBC LMS - Curriculum API',
            'version': 'local',
            'description': (
                'Generated from the live URL configuration of /curriculum_api/. Request fields and query '
                "parameters are read from each view's code; GET response schemas come from responses observed "
                'against the configured database (types only) where available. Every operation carries '
                '`x-contract-completeness` and `x-contract-gaps`, so an incomplete contract is never presented '
                'as complete.\n\n'
                '**Calls run as the signed-in browser user against the database this server uses (real data).** '
                'Write operations (POST/PUT/PATCH/DELETE) are marked ⚠️ and ask for confirmation before they are '
                'sent; Teams endpoints can contact Microsoft and email real attendees.'
            ),
        },
        'servers': [{'url': '/'}],
        'components': {
            'securitySchemes': {
                'kbcSession': {
                    'type': 'apiKey', 'in': 'cookie', 'name': 'kbc_session',
                    'description': 'LMS session cookie set by signing in to the app. Writes also need the '
                                   'csrftoken cookie, which this page sends as X-CSRFToken.',
                },
            },
        },
        'paths': dict(sorted(paths.items())),
    }


def _debug_only():
    if not settings.DEBUG:
        raise Http404()


@require_GET
def curriculum_openapi_json(request):
    _debug_only()
    return JsonResponse(build_curriculum_openapi(), json_dumps_params={'indent': 2})


_SWAGGER_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Curriculum API</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css">
  <style>
    body { margin: 0; background: #fff; }
    .kbc-banner { font: 14px/1.45 system-ui, sans-serif; padding: 10px 16px; background: #fff4e5;
                  border-bottom: 1px solid #f0c27b; color: #5c3b00; }
  </style>
</head>
<body>
  <div class="kbc-banner" role="note">
    <strong>Real data.</strong> Requests run as you, against the database this server is configured for.
    Write operations (marked &#9888;&#65039;) ask for confirmation before they are sent; Teams operations can
    contact Microsoft and email real attendees.
  </div>
  <div id="swagger-ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
  <script>
    function readCookie(name) {
      var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : '';
    }
    var READ_METHODS = { GET: 1, HEAD: 1, OPTIONS: 1 };
    function operationFor(method, url) {
      try {
        var spec = window.ui.specSelectors.specJson().toJS();
        var path = new URL(url, window.location.origin).pathname;
        var lower = method.toLowerCase();
        var paths = spec.paths || {};
        var actual = path.split('/');
        for (var template in paths) {
          var parts = template.split('/');
          if (parts.length !== actual.length || !paths[template][lower]) { continue; }
          var same = true;
          for (var i = 0; i < parts.length; i++) {
            if (parts[i].charAt(0) !== '{' && parts[i] !== actual[i]) { same = false; break; }
          }
          if (same) { return paths[template][lower]; }
        }
      } catch (e) { /* fall through: confirm without details */ }
      return null;
    }
    function confirmWrite(req) {
      var op = operationFor(req.method, req.url);
      var effects = (op && op['x-external-effects']) || [];
      var lines = [
        'Send ' + req.method + ' ' + new URL(req.url, window.location.origin).pathname + ' ?',
        '',
        'This changes real data in the database this server is configured for.'
      ].concat(effects.length ? ['', 'Also:'].concat(effects.map(function (e) { return '- ' + e; })) : []);
      return window.confirm(lines.join('\\n'));
    }
    window.ui = SwaggerUIBundle({
      url: 'openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      requestInterceptor: function (req) {
        var method = String(req.method || 'GET').toUpperCase();
        if (!READ_METHODS[method] && !confirmWrite(req)) {
          return Promise.reject(new Error('Cancelled: the write was not sent.'));
        }
        req.credentials = 'same-origin';
        req.headers['X-Requested-With'] = 'XMLHttpRequest';
        var token = readCookie('csrftoken');
        if (token) { req.headers['X-CSRFToken'] = token; }
        return req;
      }
    });
  </script>
</body>
</html>
"""


@require_GET
def curriculum_swagger_ui(request):
    _debug_only()
    return HttpResponse(_SWAGGER_HTML)
