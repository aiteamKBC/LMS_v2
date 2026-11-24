"""Programme read projection; legacy adapters supply explicit existing capabilities.

HTTP, cache lifetime, authorization and writes remain in the outer adapters.
"""
from datetime import datetime, timezone

_DETAIL_KEYS = ('attentionRecords', 'programmeDetails')


def _clean(value):
    return str(value if value is not None else '').strip()


def _key(value):
    # Match Home's former JS trim().toLowerCase(), not the curriculum identifier
    # normaliser, which also removes punctuation and spaces.
    return _clean(value).lower()


def _missing(value):
    return _key(value) in {'', 'unassigned', 'not assigned', 'tbc'}


def _zero(value):
    try:
        return float(value or 0) == 0
    except (TypeError, ValueError):
        return False


def _date_value(value):
    try:
        parsed = datetime.fromisoformat(_clean(value).replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc).timestamp() if parsed.tzinfo is None else parsed.timestamp()
    except (ValueError, OverflowError):
        return 0


def project_home_summary(overview, programmes):
    """Preserve Home's existing counting, matching, ordering and link identities.

    Only five module cards and six programme cards leave the server. No source
    rows, learner counts, KSB definitions or authoring content are exposed.
    """
    return summary_only(project_home(overview, programmes))


def summary_only(projection):
    return {key: value for key, value in projection.items() if key not in _DETAIL_KEYS}


def project_home(overview, programmes):
    """The summary plus the affected records each modal lists, built in one pass.

    The records stay in the server cache; Home reads them per issue or per
    programme only when a modal opens.
    """
    modules = overview.get('modules') or []
    cohorts = overview.get('cohorts') or []
    groups = overview.get('groups') or []

    def needs_source(programme):
        return _zero(programme.get('ksbTotal')) and not _clean(programme.get('ksbProfileSourceId'))

    counts = {
        'programme-ksb-source': sum(needs_source(programme) for programme in programmes),
        'module-mapping': sum(_zero(module.get('ksbCount')) for module in modules),
        'group-coach': sum(_missing(group.get('coach')) for group in groups),
        'module-tutor': sum(_missing(module.get('tutor')) for module in modules),
    }

    def _module_id(module):
        return _clean(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('id') or module.get('sourceId') or module.get('name'))

    def _context(row):
        # 'Unassigned' is the overview's placeholder for no programme, not a name.
        programme = _clean(row.get('programme') or row.get('programmeName'))
        return {
            'programme': '' if _missing(programme) else programme,
            'cohort': _clean(row.get('cohort') or row.get('cohortName')),
            'group': _clean(row.get('group') or row.get('groupName')),
        }

    def _module_rec(m):
        return {'id': _module_id(m), 'name': _clean(m.get('name')), **_context(m)}

    def _group_rec(g):
        return {
            'id': _clean(g.get('id') or g.get('sourceId') or g.get('groupId') or g.get('name')),
            **_context(g),
            'name': _clean(g.get('name') or g.get('groupName')),
            'group': '',
        }

    attention_records = {
        'programme-ksb-source': [
            {'id': _clean(p.get('sourceId') or p.get('id') or p.get('name')), 'name': _clean(p.get('name')),
             'programme': '', 'cohort': '', 'group': ''}
            for p in programmes if needs_source(p)
        ],
        'module-mapping': [_module_rec(m) for m in modules if _zero(m.get('ksbCount'))],
        'group-coach': [_group_rec(g) for g in groups if _missing(g.get('coach'))],
        'module-tutor': [_module_rec(m) for m in modules if _missing(m.get('tutor'))],
    }

    focus = []
    programme_details = {}
    for programme in programmes:
        keys = {_key(programme.get(field)) for field in ('id', 'sourceId', 'name')} - {''}

        def belongs(row):
            return _key(row.get('programmeId')) in keys or _key(row.get('programme')) in keys

        programme_modules = [module for module in modules if belongs(module)]
        programme_cohorts = [cohort for cohort in cohorts if belongs(cohort)]
        cohort_ids = {_key(cohort.get('id')) for cohort in programme_cohorts}
        programme_groups = [group for group in groups if belongs(group) or _key(group.get('cohortId')) in cohort_ids]
        issues = []
        if needs_source(programme):
            issues.append('No KSB source')
        if not programme_modules:
            issues.append('No modules')
        if not programme_cohorts:
            issues.append('No delivery setup')
        mapping_gaps = sum(_zero(module.get('ksbCount')) for module in programme_modules)
        tutor_gaps = sum(_missing(module.get('tutor')) for module in programme_modules)
        coach_gaps = sum(_missing(group.get('coach')) for group in programme_groups)
        if mapping_gaps:
            issues.append(f'{mapping_gaps} mapping {"gap" if mapping_gaps == 1 else "gaps"}')
        if tutor_gaps:
            issues.append(f'{tutor_gaps} without tutor')
        if coach_gaps:
            issues.append(f'{coach_gaps} without coach')
        if issues:
            programme_id = _clean(programme.get('sourceId') or programme.get('id') or programme.get('name'))
            focus.append({
                'programme': {'id': programme_id, 'name': programme.get('name') or ''},
                'issues': issues,
                'issueCount': len(issues),
            })
            # Same membership as the counts above, so each section lists exactly
            # the records its card counted.
            sections = [
                {'key': 'programme-ksb-source', 'count': int(needs_source(programme)), 'records': []},
                {'key': 'no-modules', 'count': int(not programme_modules), 'records': []},
                {'key': 'no-delivery', 'count': int(not programme_cohorts), 'records': []},
                {'key': 'module-mapping', 'count': mapping_gaps,
                 'records': [_module_rec(m) for m in programme_modules if _zero(m.get('ksbCount'))]},
                {'key': 'module-tutor', 'count': tutor_gaps,
                 'records': [_module_rec(m) for m in programme_modules if _missing(m.get('tutor'))]},
                {'key': 'group-coach', 'count': coach_gaps,
                 'records': [_group_rec(g) for g in programme_groups if _missing(g.get('coach'))]},
            ]
            programme_details[programme_id] = {
                'programme': {'id': programme_id, 'name': programme.get('name') or ''},
                'sections': [section for section in sections if section['count']],
            }
    focus.sort(key=lambda item: -item['issueCount'])
    focus = focus[:6]
    shown = {item['programme']['id'] for item in focus}
    # The database has no draft/published state (a module is active or
    # archived), so Continue working is simply the most recently edited modules.
    recent = sorted(modules, key=lambda module: -_date_value(module.get('lastUpdated')))[:5]
    return {
        'stats': {
            'programmes': len(programmes),
            'activeCohorts': sum(_key(cohort.get('status')) == 'active' for cohort in cohorts),
            'groups': len(groups),
            'openIssues': sum(counts.values()),
        },
        'attentionCounts': counts,
        'continueModules': [{
            'id': _clean(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('id') or module.get('sourceId') or module.get('name')),
            'name': module.get('name') or '',
            'programme': module.get('programme') or '',
            'weeks': module.get('weeks') or 0,
            'lastUpdated': _clean(module.get('lastUpdated')),
        } for module in recent],
        'programmeFocus': focus,
        'attentionRecords': attention_records,
        'programmeDetails': {key: value for key, value in programme_details.items() if key in shown},
    }


