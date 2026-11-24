"""Display labels and ordered live-child lists derived from plain placement facts.

No IO, staff creation or lookup cache. The existing rules retain authoritative
IDs, row-coach compatibility, status filtering and stable ordering.
"""
from .archive_policy import is_inactive

NAME_FIELDS = {
    'modules': ('programme_name', 'cohort_name', 'group_name', 'tutor_name', 'tutor_email', 'coach_name'),
    'groups': ('programme_name', 'cohort_name', 'coach_name', 'coach_names'),
    'cohorts': ('programme_name',),
}


LIST_FIELDS = {
    'groups': ('module_ids', 'module_names'),
    'cohorts': ('group_ids', 'module_names'),
    'tutors': ('assigned_module_ids',),
    'coaches': ('assigned_group_ids',),
}


EMPTY_FIELDS = {
    'tutors': ('job_title', 'notes'),
    'coaches': ('job_title', 'notes', 'phone'),
}


ROW_FIELDS = {
    table: (*NAME_FIELDS.get(table, ()), *LIST_FIELDS.get(table, ()), *EMPTY_FIELDS.get(table, ()))
    for table in {*NAME_FIELDS, *LIST_FIELDS, *EMPTY_FIELDS}
}


COACH_SEPARATOR = ', '


def _text(value):
    return str(value or '').strip()


def _names(table, row, data):
    programme = data['programmes'].get(_text(row.get('programme_id'))) or {}
    cohort = data['cohorts'].get(_text(row.get('cohort_id'))) or {}
    if table == 'cohorts':
        return {'programme_name': programme.get('name', '')}
    if table == 'groups':
        coaches = _group_coach_names(data, row.get('group_id'), row.get('coach_id'))
        return {'programme_name': programme.get('name', ''), 'cohort_name': cohort.get('name', ''),
                'coach_name': COACH_SEPARATOR.join(coaches), 'coach_names': coaches}
    group = data['groups'].get(_text(row.get('group_id'))) or {}
    tutor = data['tutors'].get(_text(row.get('tutor_id'))) or {}
    # A module's coaches are its group's coaches.
    coaches = _group_coach_names(data, row.get('group_id'))
    return {
        'programme_name': programme.get('name', ''), 'cohort_name': cohort.get('name', ''),
        'group_name': group.get('name', ''), 'tutor_name': tutor.get('name', ''),
        'tutor_email': tutor.get('email', ''), 'coach_name': COACH_SEPARATOR.join(coaches),
    }


def _group_coach_names(data, group_id, row_coach_id=None):
    """Names of a group's coaches; ``row_coach_id`` is a row that still stores one."""
    group = data['groups'].get(_text(group_id)) or {}
    coach_ids = list(group.get('coach_ids') or ())
    if not coach_ids:
        single = _text(row_coach_id) or _text(group.get('coach_id'))
        coach_ids = [single] if single else []
    names = []
    for coach_id in coach_ids:
        name = _text((data['coaches'].get(coach_id) or {}).get('name'))
        if name:
            names.append(name)
    return names


def _index(data):
    """Live children per parent, built once per lookups snapshot."""
    index = data.get('_index')
    if index is not None:
        return index
    index = {'modules_by_group': {}, 'modules_by_cohort': {}, 'modules_by_tutor': {},
             'groups_by_cohort': {}, 'groups_by_coach': {}}
    modules = sorted(
        ((key, value) for key, value in data['modules'].items() if not is_inactive(value.get('status'))),
        key=lambda item: (item[1].get('title') or '', item[0]),
    )
    for module_id, module in modules:
        entry = (module_id, module.get('title') or '')
        for parent, bucket in ((module.get('group_id'), 'modules_by_group'),
                               (module.get('cohort_id'), 'modules_by_cohort'),
                               (module.get('tutor_id'), 'modules_by_tutor')):
            if parent:
                index[bucket].setdefault(parent, []).append(entry)
    groups = sorted(
        ((key, value) for key, value in data['groups'].items() if not is_inactive(value.get('status'))),
        key=lambda item: (item[1].get('name') or '', item[0]),
    )
    for group_id, group in groups:
        if group.get('cohort_id'):
            index['groups_by_cohort'].setdefault(group['cohort_id'], []).append(group_id)
        for coach_id in group.get('coach_ids') or ([group['coach_id']] if group.get('coach_id') else []):
            index['groups_by_coach'].setdefault(coach_id, []).append(group_id)
    data['_index'] = index
    return index


def _lists(table, row, data):
    index = _index(data)
    if table == 'groups':
        owned = index['modules_by_group'].get(_text(row.get('group_id')), [])
        return {'module_ids': [key for key, _ in owned], 'module_names': [title for _, title in owned]}
    if table == 'cohorts':
        cohort_id = _text(row.get('cohort_id'))
        return {'group_ids': list(index['groups_by_cohort'].get(cohort_id, [])),
                'module_names': [title for _, title in index['modules_by_cohort'].get(cohort_id, [])]}
    if table == 'tutors':
        return {'assigned_module_ids': sorted(key for key, _ in index['modules_by_tutor'].get(_text(row.get('id')), []))}
    if table == 'coaches':
        return {'assigned_group_ids': sorted(index['groups_by_coach'].get(_text(row.get('id')), []))}
    return {}
