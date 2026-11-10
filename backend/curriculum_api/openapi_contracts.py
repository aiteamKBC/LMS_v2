"""Static request/response contract extraction for the curriculum OpenAPI document.

The curriculum views are plain Django functions that read ``json_body(request)``
and ``request.GET`` by hand, so there is no serializer to introspect. This
module reads the view's source (and the same-module helpers the parsed body is
handed to) and reports only what the code actually does:

* body fields: ``payload.get('x')`` / ``payload['x']`` / ``'x' in payload``;
* query parameters: ``request.GET.get('x')`` / ``request.GET['x']``;
* a field is *required* when it is subscripted (``payload['x']``) or when an
  ``if not ...payload.get('x')...`` branch returns an error;
* a type only when the code converts it (``parse_int`` -> integer, ``truthy``
  -> boolean, ``clean_str`` -> string, ``... or []`` -> array ...);
* response keys of ``JsonResponse({...})`` literals; status codes written in
  the source (``status=409``, ``json_error(..., 409)``);
* role checks (``require_role`` closures, ``teams_staff_required``) and
  external effects (Microsoft Graph / Teams, email).

Nothing is guessed: a field whose type the code never states has no ``type``,
and every result says how it was obtained.
"""
from __future__ import annotations

import ast
import functools
import inspect
import re
import textwrap

BODY_SOURCES = re.compile(r'json_body|json\.loads|request_json|_json_body|parse_json_body|load_json_body|read_json')
TYPE_BY_CALL = {
    'parse_int': {'type': 'integer'}, 'int': {'type': 'integer'}, 'parse_positive_int': {'type': 'integer'},
    'parse_float': {'type': 'number'}, 'float': {'type': 'number'}, 'Decimal': {'type': 'number'},
    'parse_decimal': {'type': 'number'}, 'parse_hours': {'type': 'number'},
    'clean_str': {'type': 'string'}, 'str': {'type': 'string'}, '_s': {'type': 'string'},
    'normalise': {'type': 'string'}, 'clean_email': {'type': 'string', 'format': 'email'},
    'truthy': {'type': 'boolean'}, 'bool': {'type': 'boolean'}, 'falsey': {'type': 'boolean'},
    'parse_bool': {'type': 'boolean'},
    'parse_date': {'type': 'string', 'format': 'date'}, 'parse_iso_date': {'type': 'string', 'format': 'date'},
    'parse_date_value': {'type': 'string', 'format': 'date'},
    'parse_datetime': {'type': 'string', 'format': 'date-time'},
    'list': {'type': 'array'}, 'dict': {'type': 'object'},
}
ERROR_CALLS = {'json_error', 'JsonResponse', 'error_response', 'bad_request', '_error', 'HttpResponseBadRequest'}
EXTERNAL_PATTERNS = (
    (re.compile(r'graph\.microsoft|microsoft_graph|graph_request|graph_client|_graph_|GraphError|online_meeting|onlineMeeting',
                re.I), 'Calls Microsoft Graph (Teams / calendar).'),
    (re.compile(r'send_mail|EmailMessage|send_email|sendMail|mail_service|notify_|send_notification|schedule_email',
                re.I), 'Can send email or notifications.'),
    (re.compile(r'upload_storage|default_storage\.save|blob|azure_storage', re.I), 'Writes to file storage.'),
)


@functools.lru_cache(maxsize=None)
def _module_tree(module_name):
    import importlib
    try:
        module = importlib.import_module(module_name)
        source = inspect.getsource(module)
    except Exception:
        return None, {}
    tree = ast.parse(source)
    functions = {node.name: node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    return tree, functions


def _function_node(func):
    tree, functions = _module_tree(getattr(func, '__module__', ''))
    node = functions.get(getattr(func, '__name__', ''))
    if node is not None:
        return node, functions
    try:
        parsed = ast.parse(textwrap.dedent(inspect.getsource(func)))
        node = next(n for n in parsed.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)))
        return node, functions
    except Exception:
        return None, functions


def _call_name(node):
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Name):
        return node.id
    return ''


def _is_request_get(node):
    """``request.GET`` (or ``request.query_params``)."""
    return (isinstance(node, ast.Attribute) and node.attr in {'GET', 'query_params'}
            and isinstance(node.value, ast.Name) and node.value.id == 'request')


def _key_of(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


class _Collector(ast.NodeVisitor):
    def __init__(self, body_names):
        self.body_names = set(body_names)
        self.body = {}      # name -> {'required': bool, 'schema': {}}
        self.query = {}
        self.helper_calls = []  # (callee name, param index or keyword, )
        self.parents = {}
        self.aliases = {}       # local name -> body field it was read from

    def _field(self, store, name):
        return store.setdefault(name, {'required': False, 'schema': {}})

    def _type_from_context(self, node):
        parent = self.parents.get(node)
        # x.get('k') or [] / or {}
        if isinstance(parent, ast.BoolOp) and isinstance(parent.op, ast.Or) and len(parent.values) > 1:
            tail = parent.values[-1]
            if isinstance(tail, ast.List):
                return {'type': 'array'}
            if isinstance(tail, ast.Dict):
                return {'type': 'object'}
            parent = self.parents.get(parent)
        if isinstance(parent, ast.Call):
            name = _call_name(parent)
            if name in TYPE_BY_CALL:
                return dict(TYPE_BY_CALL[name])
        return {}

    def visit(self, node):
        for child in ast.iter_child_nodes(node):
            self.parents[child] = node
        return super().visit(node)

    def visit_Assign(self, node):
        # name = payload.get('k') [or default]  -> later conversions of `name` type 'k'
        value = node.value
        if isinstance(value, ast.BoolOp) and value.values:
            value = value.values[0]
        if (isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) and value.func.attr == 'get'
                and isinstance(value.func.value, ast.Name) and value.func.value.id in self.body_names
                and value.args and _key_of(value.args[0]) is not None):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.aliases[target.id] = _key_of(value.args[0])
        self.generic_visit(node)

    def visit_Call(self, node):
        func = node.func
        # parse_int(name) where name = payload.get('k')
        call_name = _call_name(node)
        if call_name in TYPE_BY_CALL and node.args and isinstance(node.args[0], ast.Name):
            key = self.aliases.get(node.args[0].id)
            if key is not None:
                field = self._field(self.body, key)
                field['schema'] = field['schema'] or dict(TYPE_BY_CALL[call_name])
        # payload.get('x') / request.GET.get('x')
        if isinstance(func, ast.Attribute) and func.attr in {'get', 'getlist', 'pop'} and node.args:
            key = _key_of(node.args[0])
            owner = func.value
            if key is not None:
                if isinstance(owner, ast.Name) and owner.id in self.body_names:
                    field = self._field(self.body, key)
                    field['schema'] = field['schema'] or self._type_from_context(node)
                elif _is_request_get(owner):
                    field = self._field(self.query, key)
                    if func.attr == 'getlist':
                        field['schema'] = {'type': 'array', 'items': {'type': 'string'}}
                    else:
                        field['schema'] = field['schema'] or self._type_from_context(node) or {'type': 'string'}
        # helper(payload, ...) -- follow into same-module functions
        for index, arg in enumerate(node.args):
            if isinstance(arg, ast.Name) and arg.id in self.body_names:
                self.helper_calls.append((_call_name(node), index, None))
        for keyword in node.keywords:
            if isinstance(keyword.value, ast.Name) and keyword.value.id in self.body_names and keyword.arg:
                self.helper_calls.append((_call_name(node), None, keyword.arg))
        self.generic_visit(node)

    def visit_Subscript(self, node):
        key = _key_of(node.slice)
        if key is not None and isinstance(node.ctx, ast.Load):
            if isinstance(node.value, ast.Name) and node.value.id in self.body_names:
                field = self._field(self.body, key)
                field['required'] = True
                field['schema'] = field['schema'] or self._type_from_context(node)
            elif _is_request_get(node.value):
                field = self._field(self.query, key)
                field['required'] = True
                field['schema'] = field['schema'] or {'type': 'string'}
        self.generic_visit(node)

    def visit_Compare(self, node):
        # 'x' in payload
        if (len(node.ops) == 1 and isinstance(node.ops[0], (ast.In, ast.NotIn))
                and isinstance(node.comparators[0], ast.Name) and node.comparators[0].id in self.body_names):
            key = _key_of(node.left)
            if key is not None:
                self._field(self.body, key)
        self.generic_visit(node)

    def visit_If(self, node):
        # if not payload.get('x'): return json_error(...)  -> required
        test = node.test
        negated = isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not)
        returns_error = any(
            isinstance(stmt, ast.Return) and _call_name(stmt.value) in ERROR_CALLS for stmt in node.body
        ) or any(isinstance(stmt, ast.Raise) for stmt in node.body)
        if negated and returns_error:
            for inner in ast.walk(test.operand):
                if (isinstance(inner, ast.Call) and isinstance(inner.func, ast.Attribute) and inner.func.attr == 'get'
                        and isinstance(inner.func.value, ast.Name) and inner.func.value.id in self.body_names
                        and inner.args and _key_of(inner.args[0]) is not None):
                    self._field(self.body, _key_of(inner.args[0]))['required'] = True
        self.generic_visit(node)


def _body_names(node):
    names = set()
    for inner in ast.walk(node):
        if isinstance(inner, ast.Assign) and isinstance(inner.value, (ast.Call, ast.BoolOp)):
            text = ast.unparse(inner.value)
            if BODY_SOURCES.search(text) and 'request' in text:
                for target in inner.targets:
                    if isinstance(target, ast.Name):
                        names.add(target.id)
    return names


def _collect(node, functions, body_names, depth, seen, merged_body, merged_query):
    collector = _Collector(body_names)
    collector.visit(node)
    for store, merged in ((collector.body, merged_body), (collector.query, merged_query)):
        for name, field in store.items():
            current = merged.setdefault(name, {'required': False, 'schema': {}})
            current['required'] = current['required'] or field['required']
            current['schema'] = current['schema'] or field['schema']
    if depth <= 0:
        return
    for callee, index, keyword in collector.helper_calls:
        helper = functions.get(callee)
        if helper is None or callee in seen:
            continue
        params = [arg.arg for arg in helper.args.args]
        param = keyword if keyword else (params[index] if index is not None and index < len(params) else None)
        if not param:
            continue
        seen.add(callee)
        _collect(helper, functions, {param}, depth - 1, seen, merged_body, {})


def _response_keys(node):
    keys = set()
    for inner in ast.walk(node):
        if isinstance(inner, ast.Call) and _call_name(inner) in {'JsonResponse', 'json_response', 'etag_json_response'} and inner.args:
            first = inner.args[0]
            if isinstance(first, ast.Dict):
                for key in first.keys:
                    if isinstance(key, ast.Constant) and isinstance(key.value, str):
                        keys.add(key.value)
    return sorted(keys)


_STATUS = re.compile(r'status\s*=\s*([1-5][0-9]{2})|\b(?:json_error|_error)\([^\n]*?,\s*([1-5][0-9]{2})\s*[,)]|status_code\s*=\s*([1-5][0-9]{2})')
_PERMISSION_CALL = re.compile(r'\b(require_[a-z_]+|[a-z_]*_permission[a-z_]*|can_[a-z_]+|[a-z_]*forbidden[a-z_]*|[a-z_]*_access_error|staff_[a-z_]*required|[a-z_]*editor_required)\(')


def _roles_from_decorators(view):
    roles, guards = set(), []
    seen = set()
    current = view
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        qualname = getattr(current, '__qualname__', '')
        if 'teams_staff_required' in qualname:
            guards.append('teams_staff_required (admin or staff)')
            roles |= {'admin', 'staff'}
        # functools.wraps copies the view's own name onto the wrapper, so the
        # gate is recognised by its code object instead.
        code_name = getattr(getattr(current, '__code__', None), 'co_qualname', '')
        if '_learner_progress_gate' in code_name:
            # login.permissions.learner_self_only / _or_staff / _or_admin:
            # the learner who owns the record, plus staff or admin when allowed.
            names = getattr(getattr(current, '__code__', None), 'co_freevars', ())
            cells = dict(zip(names, getattr(current, '__closure__', None) or ()))
            flag = lambda name: bool(name in cells and cells[name].cell_contents)  # noqa: E731
            if flag('allow_staff'):
                guards.append('learner_self_or_staff (the owning learner, or staff/admin)')
                roles |= {'learner', 'staff', 'admin'}
            elif flag('allow_admin'):
                guards.append('learner_self_or_admin (the owning learner, or an admin)')
                roles |= {'learner', 'admin'}
            else:
                guards.append('learner_self_only (the owning learner only)')
                roles |= {'learner'}
        if 'require_role' in qualname:
            for cell in getattr(current, '__closure__', None) or ():
                try:
                    value = cell.cell_contents
                except ValueError:
                    continue
                if isinstance(value, (frozenset, set, tuple)) and value and all(isinstance(v, str) for v in value):
                    if set(value) <= {'admin', 'staff', 'employer', 'learner'}:
                        roles |= set(value)
                        guards.append('require_role(' + ', '.join(sorted(value)) + ')')
        current = getattr(current, '__wrapped__', None)
    return roles, guards


def analyse_view(view, innermost):
    """Contract facts for one view callable. Never raises."""
    result = {'body': {}, 'query': {}, 'response_keys': [], 'statuses': [], 'roles': set(), 'guards': [],
              'in_view_checks': [], 'external': [], 'analysed': False}
    try:
        source = inspect.getsource(innermost)
    except (OSError, TypeError):
        source = ''
    node, functions = _function_node(innermost)
    if node is not None:
        body_names = _body_names(node) or set()
        _collect(node, functions, body_names, 2, {getattr(innermost, '__name__', '')}, result['body'], result['query'])
        result['response_keys'] = _response_keys(node)
        result['analysed'] = True
    result['statuses'] = sorted({int(next(g for g in match.groups() if g)) for match in _STATUS.finditer(source)})
    roles, guards = _roles_from_decorators(view)
    result['roles'], result['guards'] = roles, guards
    result['in_view_checks'] = sorted(set(_PERMISSION_CALL.findall(source)))[:8]
    module = getattr(innermost, '__module__', '')
    for pattern, message in EXTERNAL_PATTERNS:
        if pattern.search(source) or (message.startswith('Calls Microsoft') and '.teams_' in f'.{module.rsplit(".", 1)[-1]}'):
            result['external'].append(message)
    return result


def schema_from_fields(fields):
    """OpenAPI object schema from collected fields (only what the code states)."""
    properties, required = {}, []
    for name in sorted(fields):
        field = fields[name]
        schema = dict(field['schema'])
        if not schema:
            schema['description'] = 'Read by the view; type not stated in code.'
        properties[name] = schema
        if field['required']:
            required.append(name)
    schema = {'type': 'object', 'properties': properties, 'additionalProperties': True}
    if required:
        schema['required'] = required
    return schema


_FIELD_NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')


def shape_to_schema(shape):
    """Observed response shape (types only) -> JSON schema.

    Objects whose keys are not field-like (ids, emails, names) become maps
    (``additionalProperties``) so no data-derived key is ever published.
    """
    if isinstance(shape, dict):
        if not shape:
            return {'type': 'object'}
        if all(_FIELD_NAME.match(str(key)) and not re.search(r'\d{3,}', str(key)) for key in shape):
            return {'type': 'object', 'properties': {key: shape_to_schema(value) for key, value in shape.items()}}
        first = next(iter(shape.values()))
        return {'type': 'object', 'additionalProperties': shape_to_schema(first)}
    if isinstance(shape, list):
        return {'type': 'array', 'items': shape_to_schema(shape[0]) if shape else {}}
    return {
        'str': {'type': 'string'}, 'int': {'type': 'integer'}, 'float': {'type': 'number'},
        'bool': {'type': 'boolean'}, 'NoneType': {'nullable': True}, '…': {},
    }.get(shape, {})
