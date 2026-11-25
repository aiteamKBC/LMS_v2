"""Build framework and KSB catalogue payloads from supplied profile and module facts."""


from collections import Counter, defaultdict

from curriculum_api.catalogue.domain.hierarchy_values import infer_level as _default_infer_level
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.catalogue.domain.values import slugify as _default_slugify


def build_ksb_data(
    ksb_profiles,
    modules,
    training_rows,
    *,
    summary_only=False,
    clean_str=_default_clean_str,
    codes_from_session_ksb,
    format_date=_default_format_date,
    infer_level=_default_infer_level,
    ksb_profile_context_ids,
    ksb_profile_source_id,
    ksb_type_label,
    normalise_ksb_code,
    normalise_ksb_type,
    parse_int=_default_parse_int,
    parse_json_value=_default_parse_json_value,
    slugify=_default_slugify,
):
    module_names_by_code = defaultdict(set)
    for module in modules:
        for code in module.get('ksbCodes', []):
            module_names_by_code[code].add(module['name'])

    for row in training_rows:
        for code in codes_from_session_ksb(row.get('session_ksb_json')):
            if row.get('module_name'):
                module_names_by_code[code].add(row.get('module_name'))

    frameworks = []
    sets = []
    for profile in ksb_profiles:
        framework_id = ksb_profile_source_id(profile)
        if not framework_id:
            raise ValueError('KSB profile has no stored identity; a read cannot create one.')
        knowledge = parse_json_value(profile.get('knowledge_codes'), [])
        skills = parse_json_value(profile.get('skill_codes'), [])
        behaviours = parse_json_value(profile.get('behaviour_codes'), [])
        items = parse_json_value(profile.get('ksb_items'), [])
        if not isinstance(items, list):
            items = []

        normalised_items = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            type_code = normalise_ksb_type(item.get('type'))
            raw_code = normalise_ksb_code(item.get('code') or item.get('full_code'), type_code)
            if not raw_code:
                continue
            parent_code = normalise_ksb_code(item.get('parentCode') or item.get('parent_code'), type_code)
            full_code = f'{type_code}{raw_code}'
            normalised_items.append({
                **item,
                'type': type_code,
                'code': raw_code,
                'parentCode': parent_code,
                'fullCode': full_code,
                'displayOrder': parse_int(item.get('displayOrder') or item.get('display_order'), index + 1),
            })

        entries = []
        for item in ([] if summary_only else normalised_items):
            code = item['fullCode']
            raw_code = item['code']
            mapped_modules = sorted(module_names_by_code.get(code, []) or module_names_by_code.get(raw_code, []))
            mapped = bool(mapped_modules)
            entries.append({
                'id': item.get('id') or f'{profile.get("id")}-{slugify(code)}',
                'code': code,
                'rawCode': raw_code,
                'fullCode': code,
                'parentCode': f'{item["type"]}{item["parentCode"]}' if item.get('parentCode') else '',
                'parentId': item.get('parentId') or item.get('parent_id'),
                'displayOrder': item.get('displayOrder') or 0,
                'title': item.get('title') or item.get('description') or code,
                'description': item.get('description') or '',
                'type': ksb_type_label(item.get('type')),
                'standard': profile.get('name') or '',
                'activities': [
                    {'activityType': 'Live Session', 'weight': 20 if mapped else 0},
                    {'activityType': 'Workshop', 'weight': 20 if mapped else 0},
                    {'activityType': 'Self-study', 'weight': 10 if mapped else 0},
                    {'activityType': 'Assignment', 'weight': 20 if mapped else 0},
                    {'activityType': 'Quiz', 'weight': 10 if mapped else 0},
                    {'activityType': 'OTJH', 'weight': 10 if mapped else 0},
                    {'activityType': 'Collaboration', 'weight': 5 if mapped else 0},
                    {'activityType': 'Review', 'weight': 5 if mapped else 0},
                ],
                'modules': mapped_modules or ['Not mapped yet'],
                'assessmentMethod': 'Curriculum plan',
                'mappedBy': profile.get('created_by') or '',
                'status': 'mapped' if mapped else 'unmapped',
                'lastUpdated': format_date(profile.get('updated_at')),
            })

        total = len(normalised_items) or len(knowledge) + len(skills) + len(behaviours)
        knowledge_count = sum(1 for item in normalised_items if item.get('type') == 'K') or len(knowledge)
        skill_count = sum(1 for item in normalised_items if item.get('type') == 'S') or len(skills)
        behaviour_count = sum(1 for item in normalised_items if item.get('type') == 'B') or len(behaviours)
        mapped_count = sum(1 for entry in entries if entry['status'] == 'mapped')
        programme_ids = ksb_profile_context_ids(profile, 'programme_ids')
        primary_programme_id = programme_ids[0] if programme_ids else ''
        display_name = profile.get('name') or 'KSB Framework'
        frameworks.append({
            'id': framework_id,
            'profileId': profile.get('id'),
            'ksbProfileId': framework_id,
            'standardSourceId': clean_str(profile.get('standard_source_id')),
            'programmeId': primary_programme_id,
            'programmeIds': programme_ids,
            'cohortIds': [],
            'groupIds': [],
            'moduleCatalogueIds': [],
            'name': display_name,
            'standard': profile.get('name') or '',
            'programmeName': display_name,
            'notes': profile.get('description') or '',
            'ifateRef': display_name,
            'level': parse_int(infer_level(display_name).replace('L', ''), 0),
            'totalKsbs': total,
            'knowledgeCount': knowledge_count,
            'skillCount': skill_count,
            'behaviourCount': behaviour_count,
            'modulesCount': len(set().union(*(module_names_by_code.get(entry['code'], set()) for entry in entries))) if entries else 0,
            'mapped': mapped_count,
            'status': 'published' if profile.get('is_active') else 'archived',
            'lastModified': format_date(profile.get('updated_at')),
            'modifiedBy': profile.get('created_by') or '',
            'version': '1.0',
            'programmes': programme_ids,
        })
        sets.append({
            'frameworkId': framework_id,
            'profileId': profile.get('id'),
            'ksbProfileId': framework_id,
            'standardSourceId': clean_str(profile.get('standard_source_id')),
            'programmeId': primary_programme_id,
            'programmeIds': programme_ids,
            'cohortIds': [],
            'groupIds': [],
            'moduleCatalogueIds': [],
            'programmeName': display_name,
            'standard': profile.get('name') or '',
            'notes': profile.get('description') or '',
            'status': 'published' if profile.get('is_active') else 'archived',
            **({
                'ksbCount': len(normalised_items),
                'knowledgeCount': sum(item['type'] == 'K' for item in normalised_items),
                'skillCount': sum(item['type'] == 'S' for item in normalised_items),
                'behaviourCount': sum(item['type'] == 'B' for item in normalised_items),
            } if summary_only else {'ksbs': entries}),
        })
    return frameworks, sets
