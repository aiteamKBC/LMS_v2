"""Resolve exact identities before unambiguous titles and hydrate selected structures."""
import re
from collections import defaultdict

def resolve_module_structures(
    requested_modules,
    *,
    CANONICAL_MODULE_ID_PATTERN,
    cached_curriculum_value,
    clean_str,
    get_authoring_structure_payloads,
    logger,
    module_authoring_row_is_archived,
    normalise,
    read_resolution_candidates,
    structure_payloads_cache_key,
    unique,
):
    requested_values = []
    for item in requested_modules:
        if isinstance(item, dict):
            item_identifiers = item.get('identifiers') if isinstance(item.get('identifiers'), list) else []
            requested_values.extend([
                item.get('identifier'),
                item.get('catalogueId'),
                item.get('moduleCatalogueId'),
                item.get('moduleId'),
                item.get('structureId'),
                item.get('sourceId'),
                *item_identifiers,
            ])
        else:
            requested_values.append(item)
    requested_values = unique([clean_str(value) for value in requested_values if clean_str(value)])
    if not requested_values:
        return []

    module_rows = read_resolution_candidates(requested_values)
    # The resolver serves operational screens. Archived rows remain physically
    # stored for the archive view, but they must resolve as unavailable here.
    module_rows = [row for row in module_rows if not module_authoring_row_is_archived(row)]
    modules_by_id = {clean_str(row.get('module_catalogue_id')): row for row in module_rows}
    exact_summary_index = {}
    title_summary_index = defaultdict(list)
    for row in module_rows:
        catalogue_id = clean_str(row.get('module_catalogue_id'))
        if not catalogue_id:
            continue
        for value in [
            catalogue_id,
            row.get('source_id'),
        ]:
            key = clean_str(value)
            if key:
                exact_summary_index[key] = catalogue_id
        title_key = normalise(row.get('title'))
        if title_key:
            title_summary_index[title_key].append(catalogue_id)

    def display_component_count(module_payload):
        count = 0
        for week in module_payload.get('weekStructure') or []:
            for component in week.get('components') or []:
                description = clean_str(component.get('description'))
                if re.search(r'placeholder lesson derived from the existing (module catalogue|delivery module)', description, re.I):
                    continue
                count += 1
        return count

    requests = []
    candidate_ids_by_request = {}
    exact_candidate_ids_by_request = {}
    title_candidate_ids_by_request = {}
    for index, item in enumerate(requested_modules):
        if isinstance(item, dict):
            request_id = clean_str(item.get('requestId') or item.get('id') or index)
            item_identifiers = item.get('identifiers') if isinstance(item.get('identifiers'), list) else []
            identifier = clean_str(
                item.get('identifier')
                or item.get('catalogueId')
                or item.get('moduleCatalogueId')
                or item.get('moduleId')
                or item.get('structureId')
                or item.get('sourceId')
            )
            identifiers = [identifier, *[clean_str(value) for value in item_identifiers]]
        else:
            request_id = str(index)
            identifier = clean_str(item)
            identifiers = [identifier]

        # Identifier matches and title matches are kept apart on purpose. An id is
        # an assertion about which module was linked; a title is a guess. Merging
        # them into one pool let a generic name ("Module") outrank the real match
        # via the component-count tie-break below, so a group could silently be
        # served another programme's content.
        exact_candidate_ids = []
        title_candidate_ids = []
        for candidate in unique([value for value in identifiers if clean_str(value)]):
            cleaned_candidate = clean_str(candidate)
            if cleaned_candidate in modules_by_id or CANONICAL_MODULE_ID_PATTERN.match(cleaned_candidate):
                exact_candidate_ids.append(cleaned_candidate)
            summary_id = exact_summary_index.get(cleaned_candidate)
            if summary_id:
                exact_candidate_ids.append(summary_id)
            title_candidate_ids.extend(title_summary_index.get(normalise(candidate), []))
        requests.append({'requestId': request_id, 'identifier': identifier})
        exact_candidate_ids = unique([value for value in exact_candidate_ids if clean_str(value)])
        title_candidate_ids = unique([
            value for value in title_candidate_ids
            if clean_str(value) and value not in exact_candidate_ids
        ])
        exact_candidate_ids_by_request[request_id] = exact_candidate_ids
        title_candidate_ids_by_request[request_id] = title_candidate_ids
        candidate_ids_by_request[request_id] = unique([*exact_candidate_ids, *title_candidate_ids])

    structure_ids = unique([
        candidate_id
        for candidate_ids in candidate_ids_by_request.values()
        for candidate_id in candidate_ids
    ])
    # One dict of options drives both the key and the call, so the cached entry can
    # never describe a different shape from the one that was actually built.
    structure_options = {
        'include_staff': False,
        'include_quality': False,
        'include_extra': False,
    }
    structure_payloads = cached_curriculum_value(
        structure_payloads_cache_key(structure_ids, **structure_options),
        lambda: get_authoring_structure_payloads(structure_ids, **structure_options),
    )

    def resolved_payloads(candidate_ids):
        payloads = {}
        for candidate_id in candidate_ids:
            payload = structure_payloads.get(candidate_id)
            if payload:
                payloads[candidate_id] = payload
        return payloads

    results = []
    for request_item in requests:
        request_id = request_item['requestId']
        identifier = request_item['identifier']
        exact_candidates = resolved_payloads(exact_candidate_ids_by_request.get(request_id, []))
        title_candidates = resolved_payloads(title_candidate_ids_by_request.get(request_id, []))
        ambiguous_titles = []
        if exact_candidates:
            # An id matched: title guesses are irrelevant, however many there are.
            module_payload = max(exact_candidates.values(), key=display_component_count)
        elif len(title_candidates) == 1:
            module_payload = next(iter(title_candidates.values()))
        elif title_candidates:
            # Several distinct modules share this title and nothing identifies which
            # one was linked. Picking the heaviest would be a coin flip with wrong
            # content as one outcome, so report the ambiguity instead of guessing.
            module_payload = None
            ambiguous_titles = sorted(
                clean_str(payload.get('catalogueId')) or candidate_id
                for candidate_id, payload in title_candidates.items()
            )
            logger.warning(
                'Module structure resolve: %s title matches for identifier %r, refusing to guess (candidates=%s).',
                len(title_candidates),
                identifier,
                ambiguous_titles,
            )
        else:
            module_payload = None
        if module_payload:
            component_count = display_component_count(module_payload)
            results.append({
                'requestId': request_id,
                'identifier': identifier,
                'catalogueId': module_payload.get('catalogueId') or '',
                'found': True,
                'componentCount': component_count,
                'hasComponents': component_count > 0,
                'module': module_payload,
            })
        elif ambiguous_titles:
            # Not 'missing': the content exists, it just cannot be attributed. The
            # caller must surface this for a human to resolve by relinking the
            # module, never treat it as an empty module.
            results.append({
                'requestId': request_id,
                'identifier': identifier,
                'catalogueId': '',
                'found': False,
                'missing': False,
                'ambiguous': True,
                'ambiguousCatalogueIds': ambiguous_titles,
                'componentCount': 0,
                'hasComponents': False,
                'message': (
                    f'{len(ambiguous_titles)} modules in Module Builder share this title. '
                    'Relink this module to the one you want.'
                ),
            })
        else:
            results.append({
                'requestId': request_id,
                'identifier': identifier,
                'catalogueId': '',
                'found': False,
                'missing': True,
                'componentCount': 0,
                'hasComponents': False,
                'message': 'Module is not available in Module Builder.',
            })

    return results
