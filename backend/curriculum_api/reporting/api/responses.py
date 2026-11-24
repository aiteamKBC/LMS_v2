"""Preserve reporting HTTP encoding, cache keys, expiry and response contracts."""
import sys


def programme_achievement_inputs(
    request,
    programme_id,
    *,
    ACHIEVEMENT_LEARNER_FIELDS,
    ACHIEVEMENT_PROGRESS_FIELDS,
    CURRICULUM_LEARNER_DATA_TTL_SECONDS,
    HttpResponse,
    _ACHIEVEMENT_LEARNER_IDS,
    achievement_inputs_fingerprint,
    cached_curriculum_value,
    clean_str,
    programme_achievement_inputs_uncached,
    request_bypasses_curriculum_cache,
):
    """programme_achievement_inputs_uncached(), cached per programme, learner status and source.

    Every Achievement page, filter and drawer used to rebuild the whole read --
    placements, the programme's ~27k components and their mappings, and every
    achieved progress row of every learner (~9 MB for the largest programme) --
    to show 25 rows. The request filters and the paging are applied afterwards
    by _achievement_projection, so one entry serves all of them.

    Kept fresh by the programme's cache generation (curriculum writes) and, past
    the learner-data ttl, by achievement_inputs_fingerprint (learner progress and
    placements). Process-local: the rows are cheap to keep but costly to pickle.
    """
    programme_id = clean_str(programme_id)
    learner_status = clean_str(request.GET.get('learnerStatus') or request.GET.get('status')).lower()
    source_type = clean_str(request.GET.get('source_type') or request.GET.get('sourceType')).lower()
    source_id = clean_str(request.GET.get('source_id') or request.GET.get('sourceId'))
    key = f'ksb-achievement-inputs-v1:{programme_id}:{learner_status}:{source_type}:{source_id}'

    def build():
        payload, error = programme_achievement_inputs_uncached(request, programme_id)
        if error is not None:
            return {'error': (error.content, error.status_code)}
        learners = payload.get('assignedLearners') or []
        _ACHIEVEMENT_LEARNER_IDS[key] = {
            str(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id'))
            for row in learners
            if str(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id')).isdigit()
        }
        return {
            'definitions': payload.get('coverage', {}).get('items') or [],
            'learners': [{field: row.get(field) for field in ACHIEVEMENT_LEARNER_FIELDS} for row in learners],
            'progress': [
                tuple(sys.intern(value) if isinstance(value, str) else value
                      for value in (raw.get(field) for field in ACHIEVEMENT_PROGRESS_FIELDS))
                for raw in (payload.get('consumptionSources') or {}).get('progress') or []
                if raw.get('countsTowardAchievement') and raw.get('scopeStatus') == 'in_scope'
            ],
        }

    entry = cached_curriculum_value(
        key, build,
        force=request_bypasses_curriculum_cache(request),
        ttl=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
        shared=False,
        scope=programme_id,
        fingerprint=lambda: achievement_inputs_fingerprint(programme_id, key),
    )
    if 'error' in entry:
        content, status = entry['error']
        return None, HttpResponse(content, status=status, content_type='application/json')
    return {
        'coverage': {'items': entry['definitions']},
        'assignedLearners': entry['learners'],
        'consumptionSources': {'progress': [
            {**dict(zip(ACHIEVEMENT_PROGRESS_FIELDS, values)), 'countsTowardAchievement': True, 'scopeStatus': 'in_scope'}
            for values in entry['progress']
        ]},
    }, None


def scope_learner_roster_entry(
    request,
    scope,
    identifier,
    *,
    _scope_learner_roster_payload_uncached,
    cached_curriculum_value,
    clean_str,
    encode_json_entry,
    normalise,
    truthy,
):
    """The encoded roster response, keyed by scope and every narrowing filter.

    The 30s TTL stays exactly as it was, deliberately. Placements are written
    by enrolment and the hours on each row by learner/hours code, and neither
    bumps the curriculum epoch, so the TTL is the only thing bounding how stale
    this can be. Caching the encoded form changes how a hit is served (no
    re-serialisation, 304 when unchanged), not when the data is re-read.
    """
    scope = clean_str(scope) or 'programme'
    identifier = clean_str(identifier)
    learner_status = clean_str(request.GET.get('learnerStatus') or request.GET.get('status')).lower()
    cohort = normalise(clean_str(request.GET.get('cohort')))
    group = normalise(clean_str(request.GET.get('group')))
    compact = '1' if truthy(request.GET.get('compact')) else '0'
    key = f'learner-roster-response:{scope}:{identifier}:{learner_status}:{cohort}:{group}:{compact}'
    return cached_curriculum_value(
        key,
        lambda: encode_json_entry(_scope_learner_roster_payload_uncached(request, scope, identifier)),
        ttl=30,
        scope=identifier if scope == 'programme' else None,
    )


def _coverage_response_uncached(
    request,
    scope='',
    identifier='',
    *,
    HttpResponse,
    JsonResponse,
    _coverage_payload_uncached,
):
    result = _coverage_payload_uncached(request, scope, identifier)
    return result if isinstance(result, HttpResponse) else JsonResponse(result)


def coverage_entry(
    request,
    scope='',
    identifier='',
    *,
    COVERAGE_PART_VIEWS,
    HttpResponse,
    _coverage_payload_uncached,
    _coverage_response_uncached,
    cached_curriculum_value,
    clean_str,
    component_source_inputs_fingerprint,
    coverage_part,
    curriculum_read_scope,
    encode_json_bytes,
    encode_json_entry,
    truthy,
):
    """The encoded coverage response for a scope, from the epoch-aware cache.

    Coverage is read-only and rebuilt from authoring rows, so caching it
    prevents simultaneous programme-page requests from each scanning the same
    modules, weeks, components and mappings. What is cached is the encoded
    response (http_cache): the JSON exactly as the view produced it, its gzip
    form and an ETag. An error response is cached with its status, as before.

    TTL: still 60s, deliberately. Most of what this reads is written only
    through curriculum handlers, which bump the shared epoch and retire the
    entry at once (modules, weeks, components, KSB mappings, programme configs,
    KSB profiles). The exception is the Skills England requirement list: it is
    read straight from standard_ksbs at build time, and that table changes by
    manual SQL import, which bumps nothing. The 60s expiry is what bounds how
    long coverage can lag such an import, so it stays until the import path
    invalidates the curriculum cache itself.
    """
    # Read exactly as _coverage_response_uncached() reads them, so a key can
    # never name a different source from the one its document was built for.
    source_type = clean_str(request.GET.get('source_type') or request.GET.get('sourceType')).lower()
    source_id = clean_str(request.GET.get('source_id') or request.GET.get('sourceId'))
    actual = '1' if truthy(request.GET.get('actual_mappings') or request.GET.get('actualMappings')) else '0'
    key = f'ksb-coverage-response:{scope or "all"}:{clean_str(identifier)}:{source_type}:{source_id}:{actual}'
    if scope == 'programme' and request.GET.get('view') == 'summary':
        key += ':summary-v1'

    def build():
        # One targeted read scope per build. Without it every helper below
        # re-read its parent table in full -- curriculum.modules, the training
        # rows, the programme configs, the KSB profiles -- once per caller, a
        # remote round trip each. Child reads stay on the targeted
        # ``module_catalogue_id in (...)`` query exactly as they were outside a
        # scope, so the rows are the same; only the repeats go.
        with curriculum_read_scope(targeted_child_reads=True):
            response = _coverage_response_uncached(request, scope, identifier)
        return encode_json_bytes(response.content, status=response.status_code)

    part = request.GET.get('view') if scope == 'programme' else ''
    if part in COVERAGE_PART_VIEWS:
        # One of the two halves (see COVERAGE_PART_VIEWS). Both are cut in one
        # build, straight from the document it holds, and cached together: the
        # heatmap's cells and each item's mapping list are the same placements
        # filed two ways, so one database read serves both pages. The full
        # document is neither serialised nor cached on the way -- for the
        # largest programme encoding it and cutting the halves back out of it
        # took ~1.2 s of a cold build; cutting them directly takes ~0.17 s.
        def build_parts():
            with curriculum_read_scope(targeted_child_reads=True):
                result = _coverage_payload_uncached(request, scope, identifier)
            if isinstance(result, HttpResponse):
                error = encode_json_bytes(result.content, status=result.status_code)
                return {name: error for name in COVERAGE_PART_VIEWS}
            # coverage_part replaces top-level keys only, so a shallow copy each
            # keeps one half's cut out of the other's.
            return {name: encode_json_entry(coverage_part(dict(result), name)) for name in COVERAGE_PART_VIEWS}

        # Past its 60s an entry is re-checked against the one input no epoch
        # covers (standard_ksbs / ksb_profiles, see the docstring) and kept when
        # it has not moved, instead of being rebuilt every minute.
        return cached_curriculum_value(
            f'{key}:parts-v4', build_parts, ttl=60, fingerprint=component_source_inputs_fingerprint,
        )[part]
    return cached_curriculum_value(key, build, ttl=60, fingerprint=component_source_inputs_fingerprint)


def coverage_response(request, scope='', identifier='', *, coverage_entry, plain_json_response):
    """Coverage as a plain, uncompressed response.

    For the in-process callers that parse the document (the KSB trace and the
    readiness check). The endpoints themselves use coverage_endpoint_response.
    """
    return plain_json_response(coverage_entry(request, scope, identifier))
