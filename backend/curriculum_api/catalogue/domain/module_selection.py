"""Select richer curriculum items and match module/group identity over plain values."""
import json
from collections import defaultdict

from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier as _default_matches_curriculum_identifier
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise


def curriculum_item_richness(item):
    if not isinstance(item, dict):
        return 0
    week_structure = item.get('weekStructure') or item.get('week_structure') or []
    components = item.get('components') or []
    nested_components = sum(
        len(week.get('components') or [])
        for week in week_structure
        if isinstance(week, dict)
    ) if isinstance(week_structure, list) else 0
    groups = item.get('groups') or []
    modules = item.get('modules') or []
    return (
        len(week_structure) * 1000 if isinstance(week_structure, list) else 0
    ) + nested_components * 100 + (
        len(components) * 50 if isinstance(components, list) else 0
    ) + (
        len(groups) * 25 if isinstance(groups, list) else 0
    ) + (
        len(modules) * 10 if isinstance(modules, list) else 0
    ) + len(json.dumps(item, default=str))


def unique_curriculum_items(
    items,
    identity_fields,
    *,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
):
    selected = {}
    order = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        key = next((clean_str(item.get(field)) for field in identity_fields if clean_str(item.get(field))), '')
        if not key:
            key = normalise(item.get('name') or item.get('title'))
        if not key:
            key = f'row:{len(order)}'
        if key not in selected:
            order.append(key)
            selected[key] = item
            continue
        current = selected[key]
        if curriculum_item_richness(item) >= curriculum_item_richness(current):
            selected[key] = {**current, **item}
    return [selected[key] for key in order]


def module_belongs_to_group(
    module,
    group,
    *,
    clean_str=_default_clean_str,
    matches_curriculum_identifier=_default_matches_curriculum_identifier,
    normalise=_default_normalise,
):
    module_group_id = clean_str(module.get('groupId') or module.get('group_id'))
    group_module_ids = {
        normalise(item)
        for item in (group.get('moduleIds') or group.get('module_ids') or [])
        if clean_str(item)
    }
    module_ids = [
        module.get('moduleCatalogueId'),
        module.get('module_catalogue_id'),
        module.get('catalogueId'),
        module.get('moduleId'),
        module.get('module_id'),
        module.get('structureId'),
        module.get('id'),
        module.get('sourceId'),
    ]
    if any(normalise(value) in group_module_ids for value in module_ids if clean_str(value)):
        return True
    return bool(module_group_id) and matches_curriculum_identifier(module_group_id, group.get('id'))


def structure_ksb_codes(payload, *, clean_str, unique):
    """Ordered codes present in the authored module/week/component mapping tree."""
    mappings = list(payload.get('moduleKsbMappings') or [])
    for week in payload.get('weekStructure') or []:
        mappings.extend(week.get('ksbMappings') or [])
        for component in week.get('components') or []:
            mappings.extend(component.get('ksbMappings') or [])
    return unique([clean_str(mapping.get('code')) for mapping in mappings if clean_str(mapping.get('code'))])


def _component_layout(item):
    """Which components, week by week, a candidate's JSON carries."""
    if isinstance(item.get('components'), list) and item.get('components'):
        # Top-level components are not built from the shared child rows.
        return None
    weeks = item.get('weekStructure') or item.get('week_structure') or []
    if not isinstance(weeks, list):
        return ()
    return tuple(
        tuple(
            str(component.get('id')) if isinstance(component, dict) else repr(component)
            for component in (week.get('components') or [])
        ) if isinstance(week, dict) else repr(week)
        for week in weeks
    )


def component_text_cancels(items, identity_fields, *, clean_str=_default_clean_str, normalise=_default_normalise):
    """Whether unique_curriculum_items() decides the same with or without text.

    Its richness is ``len(json.dumps(item))`` plus counts that do not involve
    text. Where every candidate sharing a key carries the very same components
    -- the same rows, built by the same code -- each component's text adds the
    same length to both sides of every comparison it makes, so blanking it
    changes no decision. Any key whose candidates carry different components,
    or components not built from the shared rows, makes this False, and the
    caller reads the text after all. Keys mirror unique_curriculum_items(); an
    item it gives a row key of its own is never compared.
    """
    layouts = defaultdict(set)
    for item in items or []:
        if not isinstance(item, dict):
            continue
        key = next((clean_str(item.get(field)) for field in identity_fields if clean_str(item.get(field))), '')
        if not key:
            key = normalise(item.get('name') or item.get('title'))
        if not key:
            continue
        layout = _component_layout(item)
        if layout is None:
            return False
        layouts[key].add(layout)
    return all(len(found) == 1 for found in layouts.values())
