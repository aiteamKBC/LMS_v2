"""KSB reference HTTP contracts; outer adapters retain routes and decorators."""

def curriculum_standards(request, *, CURRICULUM_SCHEMA, build_skills_england_standards, cached_curriculum_value, reference_json_response):
    # Reference data: identical for every user and changed only by a standards
    # import, so it revalidates cheaply via ETag. Four curriculum pages fetch this
    # on mount, and each repeat visit now costs a 304 instead of the full list.
    standards = cached_curriculum_value('skills-england-standards', build_skills_england_standards)
    return reference_json_response(request, {
        'schema': CURRICULUM_SCHEMA,
        'sourceTable': 'ksb_standard_definitions',
        'count': len(standards),
        'results': standards,
    })


def curriculum_standard_detail(request, identifier, *, CURRICULUM_SCHEMA, find_skills_england_standard, json_error, reference_json_response):
    standard = find_skills_england_standard(identifier)
    if not standard:
        return json_error('Skills England standard not found.', status=404)
    return reference_json_response(request, {
        'schema': CURRICULUM_SCHEMA,
        'sourceTable': 'ksb_standard_definitions',
        **standard,
    })


def curriculum_ksb_frameworks(request, *, curriculum_collection_response, get_cached_payload):
    return curriculum_collection_response(get_cached_payload(request, compact=True), 'ksbFrameworks')


def curriculum_ksb_framework_collection(request, *, curriculum_ksb_frameworks, json_error):
    if request.method == 'GET':
        return curriculum_ksb_frameworks(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    # The curriculum database keeps no KSB frameworks (curriculum.ksb_profiles
    # was removed); a programme takes its KSBs from its apprenticeship standard.
    return json_error('KSB frameworks cannot be created: the current curriculum database keeps no KSB frameworks. '
                      'A programme takes its KSBs from its apprenticeship standard.',
                      status=409, code='ksb_frameworks_not_available')


def curriculum_ksb_framework_detail(request, identifier, *, json_error):
    if request.method not in {'GET', 'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    # No KSB frameworks are stored (see curriculum_ksb_framework_collection):
    # a read finds nothing and a change is refused plainly.
    if request.method != 'GET':
        return json_error('KSB frameworks cannot be changed: the current curriculum database keeps no KSB frameworks. '
                          'A programme takes its KSBs from its apprenticeship standard.',
                          status=409, code='ksb_frameworks_not_available')
    return json_error('KSB framework not found.', status=404)


def curriculum_ksb_set_definitions(request, identifier, *, json_error):
    # A KSB set was one stored KSB profile; none are stored any more
    # (curriculum.ksb_profiles was removed), so every set id is unknown.
    return json_error('KSB profile not found.', status=404)


def curriculum_ksb_sets(request, *, CURRICULUM_SCHEMA, curriculum_collection_response):
    # Every KSB set was one stored KSB profile, and curriculum keeps none any more
    # (curriculum.ksb_profiles was removed). Kept so older screens get an empty list.
    return curriculum_collection_response({'schema': CURRICULUM_SCHEMA}, 'ksbSets', [])
