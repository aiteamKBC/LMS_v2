"""Module completion, advanced metadata, KSB mapping and quality projections."""

from curriculum_api.catalogue.domain.component_types import normalise_component_type as _default_normalise_component_type
from curriculum_api.catalogue.domain.content_values import normalise_ksb_weight as _default_normalise_ksb_weight
from curriculum_api.catalogue.domain.content_values import normalise_ksb_weight_class as _default_normalise_ksb_weight_class
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def default_completion_payload():
    return {
        'quizzesCompletedRequired': False,
        'checkpointsCompletedRequired': False,
        'averageScoreRequiredEnabled': False,
        'averageScoreRequired': 70,
        'totalScoreRequiredEnabled': False,
        'totalScoreRequired': 100,
        'additionalNotes': '',
    }


def completion_response(
    row,
    *,
    default_completion_payload=default_completion_payload,
    parse_int=_default_parse_int,
):
    if not row:
        return default_completion_payload()
    return {
        'quizzesCompletedRequired': bool(row.get('quizzes_completed_required')),
        'checkpointsCompletedRequired': bool(row.get('checkpoints_completed_required')),
        'averageScoreRequiredEnabled': bool(row.get('average_score_required_enabled')),
        'averageScoreRequired': parse_int(row.get('average_score_required'), 70),
        'totalScoreRequiredEnabled': bool(row.get('total_score_required_enabled')),
        'totalScoreRequired': parse_int(row.get('total_score_required'), 100),
        'additionalNotes': row.get('additional_notes') or '',
    }


def advanced_response(row, *, as_json_value=_default_as_json_value):
    if not row:
        return {
            'background': '',
            'epaRequirements': [],
            'qualificationOutcomes': [],
            'advancedDetails': {
                'intent': '',
                'learnerBenefit': '',
                'employerBenefit': '',
                'sequencePurpose': '',
            },
        }
    return {
        'background': row.get('background') or '',
        'epaRequirements': as_json_value(row.get('epa_requirements'), []),
        'qualificationOutcomes': as_json_value(row.get('professional_qualification_outcomes'), []),
        'advancedDetails': {
            'intent': row.get('intent') or '',
            'learnerBenefit': row.get('learner_benefit') or '',
            'employerBenefit': row.get('employer_benefit') or '',
            'sequencePurpose': row.get('sequence_purpose') or '',
        },
    }


def mapping_response(
    row,
    *,
    legacy_weight_class_from_classification,
    normalise_ksb_classification,
    normalise_ksb_weight=_default_normalise_ksb_weight,
    normalise_ksb_weight_class=_default_normalise_ksb_weight_class,
):
    classification = normalise_ksb_classification(row.get('classification'))
    # weight_class is the canonical delivery weighting and is REQUIRED by
    # validate_ksb_mapping_payload. Emitting it here is what lets a stored
    # structure survive a read/write round trip: the module PATCH and the
    # metadata-only reattachment both re-submit what this serializer returned,
    # so dropping the field made the server reject its own valid data.
    weight_class = normalise_ksb_weight_class(
        row.get('weight_class'),
        legacy_weight_class_from_classification(classification),
    )
    return {
        'id': str(row.get('id')),
        'ksbId': str(row.get('ksb_id') or row.get('ksb_code') or ''),
        'code': row.get('ksb_code') or '',
        'description': row.get('ksb_description') or '',
        'sourceType': row.get('source_type') or '',
        'sourceId': row.get('source_id') or '',
        'type': classification,
        'classification': classification,
        'weight': normalise_ksb_weight(row.get('weight')),
        'weightClass': weight_class,
        'weight_class': weight_class,
    }


def module_authoring_quality_check(
    module_payload,
    *,
    SUPPORTED_CLASSIFICATIONS,
    clean_str=_default_clean_str,
    normalise_component_type=_default_normalise_component_type,
    normalise_ksb_classification,
    normalise_ksb_weight=_default_normalise_ksb_weight,
):
    weeks = module_payload.get('weekStructure') or []
    components = [component for week in weeks for component in (week.get('components') or [])]
    live_sessions = [component for component in components if normalise_component_type(component.get('type')) == 'live_session']
    criteria = module_payload.get('completionCriteria') or {}
    all_mappings = []
    all_mappings.extend(module_payload.get('moduleKsbMappings') or [])
    for week in weeks:
        all_mappings.extend(week.get('ksbMappings') or [])
        for component in week.get('components') or []:
            all_mappings.extend(component.get('ksbMappings') or [])
    criteria_configured = any([
        criteria.get('quizzesCompletedRequired'),
        criteria.get('checkpointsCompletedRequired'),
        criteria.get('averageScoreRequiredEnabled'),
        criteria.get('totalScoreRequiredEnabled'),
        clean_str(criteria.get('additionalNotes')),
    ])
    checklist = [
        {'label': 'weeks defined', 'passed': len(weeks) > 0},
        {'label': 'each week has title', 'passed': all(clean_str(week.get('title')) for week in weeks)},
        {'label': 'each week has at least one component', 'passed': all(len(week.get('components') or []) > 0 for week in weeks)},
        {'label': 'components have OTJH greater than 0', 'passed': bool(components) and all(float(component.get('expectedOtjh') or 0) > 0 for component in components)},
        {'label': 'components have KSB mapping', 'passed': bool(components) and all(len(component.get('ksbMappings') or []) > 0 for component in components)},
        {'label': 'live sessions have recording placeholder where expected', 'passed': all('recordingExpected' in (component.get('settings') or {}) for component in live_sessions)},
        {'label': 'completion criteria configured', 'passed': criteria_configured},
        {'label': 'KSB mappings classified correctly', 'passed': all(normalise_ksb_classification(mapping.get('type') or mapping.get('classification')) in SUPPORTED_CLASSIFICATIONS for mapping in all_mappings)},
        {'label': 'KSB mappings have weights', 'passed': all(normalise_ksb_weight(mapping.get('weight')) > 0 for mapping in all_mappings)},
    ]
    passed = len([item for item in checklist if item['passed']])
    score = round((passed / len(checklist)) * 100) if checklist else 0
    return checklist, score
