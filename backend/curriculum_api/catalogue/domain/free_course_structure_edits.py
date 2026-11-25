"""One-item partial edits preserve all unmentioned content and ordering."""
from uuid import uuid4

_metadata = {'expectedRevision', 'collaboration'}
_week_fields = {'title', 'summary', 'learningOutcomes', 'ksbMappings'}
_component_fields = {
    'type', 'title', 'description', 'expectedOtjh', 'points', 'reflectionRequired',
    'reflectionQuestion', 'workplaceEvidenceRequired', 'tutorValidationRequired', 'settings', 'ksbMappings',
}


def _delta(stored, kind, item_id, payload, method):
    """Change exactly one item; keep the latest order and all unnamed fields."""
    weeks = stored.get('weekStructure') or []
    week_by_id = {week['id']: week for week in weeks}
    components = {c['id']: c for week in weeks for c in week.get('components') or []}
    fields = _component_fields if kind == 'component' else _week_fields
    allowed = fields | _metadata | ({'weekId'} if method == 'POST' and kind == 'component' else set())
    if set(payload) - allowed:
        raise ValueError('Unsupported fields: ' + ', '.join(sorted(set(payload) - allowed)))
    if method == 'DELETE' and set(payload) - _metadata:
        raise ValueError('A delete only accepts expectedRevision and collaboration metadata.')
    if 'settings' in payload and not isinstance(payload['settings'], dict):
        raise ValueError('settings must be an object; clear an individual setting explicitly.')
    if 'ksbMappings' in payload and not isinstance(payload['ksbMappings'], list):
        raise ValueError('ksbMappings must be a list.')
    delta = {'weekOrder': list(week_by_id),
             'componentOrder': {w['id']: [c['id'] for c in w.get('components') or []] for w in weeks},
             'weeks': {}, 'components': {}}
    table = components if kind == 'component' else week_by_id
    if method == 'POST':
        if not payload.get('title') or (kind == 'component' and not payload.get('type')):
            raise ValueError('A title and, for a component, a type are required.')
        item_id = ('COMP-' if kind == 'component' else 'WEEK-') + uuid4().hex.upper()
        if kind == 'component':
            week_id = payload.get('weekId')
            if week_id not in week_by_id:
                raise LookupError('Week not found in this free course.')
            delta['componentOrder'][week_id].append(item_id)
            current = {'id': item_id, 'weekId': week_id, 'settings': {}, 'ksbMappings': []}
        else:
            delta['weekOrder'].append(item_id)
            delta['componentOrder'][item_id] = []
            current = {'id': item_id, 'weekNumber': len(weeks) + 1}
    else:
        if item_id not in table:
            raise LookupError('Item not found in this free course.')
        current = table[item_id]
    if method == 'DELETE':
        if kind == 'component':
            for ids in delta['componentOrder'].values():
                if item_id in ids:
                    ids.remove(item_id)
        else:
            delta['weekOrder'].remove(item_id)
            del delta['componentOrder'][item_id]
    else:
        changed = {**current, **{key: value for key, value in payload.items() if key in fields}, 'id': item_id}
        if 'settings' in payload:
            changed['settings'] = {**(current.get('settings') or {}), **payload['settings']}
        if kind == 'week':
            changed.pop('components', None)
        delta['components' if kind == 'component' else 'weeks'][item_id] = changed
    body = {key: value for key, value in stored.items() if key not in {'weeks', 'weekStructure'}}
    body.update({key: value for key, value in payload.items() if key in _metadata})
    body.update(saveMode='partial', structureDelta=delta)
    return body, item_id
