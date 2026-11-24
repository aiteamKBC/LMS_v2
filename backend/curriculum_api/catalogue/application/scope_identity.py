"""Programme identity matching and deterministic module-delivery selection."""


from collections import Counter, defaultdict

from curriculum_api.catalogue.domain.delivery_identity import actual_cohort_identity as _default_actual_cohort_identity
from curriculum_api.catalogue.domain.delivery_identity import actual_group_identity as _default_actual_group_identity
from curriculum_api.catalogue.domain.hierarchy_values import curriculum_identifier_candidates as _default_curriculum_identifier_candidates
from curriculum_api.catalogue.domain.programme_identity import programme_identity as _default_programme_identity
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def module_matches_visible_programmes(module, programmes, *, normalise=_default_normalise):
    if not programmes:
        return True
    visible_keys = {
        normalise(value)
        for programme in programmes or []
        for value in (
            programme.get('id'),
            programme.get('sourceId'),
            programme.get('name'),
            programme.get('standard'),
        )
        if normalise(value)
    }
    module_keys = {
        normalise(value)
        for value in (
            (module or {}).get('programmeId'),
            (module or {}).get('programme_id'),
            (module or {}).get('programme'),
            (module or {}).get('programmeName'),
        )
        if normalise(value)
    }
    if not module_keys:
        return True
    return bool(visible_keys.intersection(module_keys))


def programme_identifier_looks_exact(identifier, *, clean_str=_default_clean_str):
    ident = clean_str(identifier).lower()
    return ident.startswith('prog-') or ident.startswith('program-prog-')


def module_matches_programme(
    programme,
    module,
    *,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    programme_identifier_looks_exact=programme_identifier_looks_exact,
):
    """Does this module belong to this programme?

    An explicit programme id settles it on its own. A module that names one
    programme by id must never be credited to a *different* programme just
    because it still carries that programme's name: a rename that did not reach
    the children leaves them holding the old name, and reusing a name is allowed,
    so counting on the name as well let one programme's card count another's
    modules. Rows whose ``programmeId`` holds a name rather than an id (older
    authoring payloads do) still fall through to the name comparison.
    """
    programme_candidates = {
        normalise(programme.get('id')),
        normalise(programme.get('sourceId')),
        normalise(programme.get('name')),
        normalise(programme.get('standard')),
    } - {''}
    module_programme_id = clean_str(module.get('programmeId'))
    if module_programme_id:
        if normalise(module_programme_id) in programme_candidates:
            return True
        if programme_identifier_looks_exact(module_programme_id):
            return False
    return normalise(module.get('programme')) in programme_candidates


def training_row_matches_programme_identifier(
    row,
    identifier,
    configs_by_id,
    *,
    curriculum_identifier_candidates=_default_curriculum_identifier_candidates,
    programme_identifier_looks_exact=programme_identifier_looks_exact,
    programme_identity=_default_programme_identity,
):
    identity = programme_identity(row, configs_by_id)
    expected = curriculum_identifier_candidates(identifier)
    source_candidates = curriculum_identifier_candidates(identity.get('sourceId'))
    if expected.intersection(source_candidates):
        return True
    if programme_identifier_looks_exact(identifier):
        return False
    return bool(expected.intersection(curriculum_identifier_candidates(identity.get('name'))))


def module_delivery_signature(module):
    return '|'.join([
        normalise(module.get('programme')),
        normalise(module.get('name') or module.get('title')),
        normalise(module.get('cohortId') or module.get('cohort_id') or module.get('cohort')),
        normalise(module.get('groupId') or module.get('group_id') or module.get('group')),
    ])


def training_row_delivery_signature(
    row,
    configs_by_id,
    *,
    actual_cohort_identity=_default_actual_cohort_identity,
    actual_group_identity=_default_actual_group_identity,
    clean_str=_default_clean_str,
    module_delivery_signature=module_delivery_signature,
    programme_identity=_default_programme_identity,
):
    if not clean_str(row.get('module_name')):
        return ''
    identity = programme_identity(row, configs_by_id)
    cohort = actual_cohort_identity(row, identity['name'])
    if not cohort:
        return ''
    group = actual_group_identity(row, cohort['id'])
    if not group:
        return ''
    return module_delivery_signature({
        'programme': identity['name'],
        'name': row.get('module_name') or '',
        'cohortId': cohort['id'],
        'cohort': cohort['name'],
        'groupId': group['id'],
        'group': group['name'],
    })


def authoring_row_delivery_signature(row, *, module_delivery_signature=module_delivery_signature):
    return module_delivery_signature({
        'programme': row.get('programme_name') or row.get('programme_id') or '',
        'name': row.get('title') or '',
        'cohortId': row.get('cohort_id') or '',
        'cohort': row.get('cohort_name') or '',
        'groupId': row.get('group_id') or '',
        'group': row.get('group_name') or '',
    })


def dedupe_authoring_module_rows(
    module_rows,
    mapping_rows=None,
    component_rows=None,
    week_rows=None,
    *,
    counts=None,
    authoring_row_delivery_signature=authoring_row_delivery_signature,
    clean_str=_default_clean_str,
    parse_int=_default_parse_int,
):
    if counts is None:
        mapping_counts = Counter(clean_str(row.get('module_catalogue_id')) for row in (mapping_rows or []))
        component_counts = Counter(clean_str(row.get('module_catalogue_id')) for row in (component_rows or []))
        week_counts = Counter(clean_str(row.get('module_catalogue_id')) for row in (week_rows or []))
    else:
        mapping_counts, component_counts, week_counts = counts
    selected = {}
    order = {}
    for index, row in enumerate(module_rows):
        module_id = clean_str(row.get('module_catalogue_id'))
        signature = authoring_row_delivery_signature(row) or f'id:{module_id}'
        order.setdefault(signature, index)
        score = (
            mapping_counts.get(module_id, 0),
            component_counts.get(module_id, 0),
            week_counts.get(module_id, 0),
            1 if clean_str(row.get('source_type')) == 'training_plan' and clean_str(row.get('source_id')) else 0,
            parse_int(row.get('quality_score'), 0),
        )
        current = selected.get(signature)
        if not current or score > current[0]:
            selected[signature] = (score, row)
    return [item[1] for _, item in sorted(selected.items(), key=lambda pair: order.get(pair[0], 0))]


def authoring_summary_delivery_signature(summary):
    return '|'.join([
        normalise(summary.get('programmeName')),
        normalise(summary.get('title')),
        normalise(summary.get('cohortId') or summary.get('cohort')),
        normalise(summary.get('groupId') or summary.get('group')),
    ])
