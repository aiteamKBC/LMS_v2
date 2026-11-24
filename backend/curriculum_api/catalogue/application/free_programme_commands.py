"""Free programme save, scoped deletion and course-to-group conversion orchestration.

Explicit capabilities preserve existing caller contracts during migration.
No views, settings or provider runtime is imported here.
"""


def delete_free_programme_data(
    programme_id,
    *,
    AUTHORING_WEEKS_TABLE,
    CURRICULUM_SCHEMA,
    FREE_COURSES_TABLE,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    LEGACY,
    adopted_courses,
    authoring_delete,
    clean_str,
    free_programme_delete,
    free_programme_fetch_all,
    free_programme_owned_ids,
    logger,
    require_mode,
    schema_compat,
):
    """Delete only the free-course data owned by `programme_id`.

    Fails safe: with no usable programme id nothing is deleted, rather than
    falling back to a global wipe.
    """
    require_mode(LEGACY)
    programme_id = clean_str(programme_id)
    if not programme_id:
        logger.warning('Refusing to delete free programme data without a programme id.')
        return set(), set()
    week_ids, course_ids = free_programme_owned_ids(programme_id)
    protected = set(adopted_courses())
    protected_weeks = {row['id'] for row in free_programme_fetch_all(FREE_PROGRAMME_MODULES_TABLE,
        columns=['id', 'course_id']) if row.get('course_id') in protected}
    week_ids -= protected_weeks
    course_ids -= protected
    if protected_weeks:
        placeholders = ', '.join(['%s'] * len(protected_weeks))
        free_programme_delete(FREE_PROGRAMME_COMPONENTS_TABLE,
            f'programme_id = %s and free_module_id not in ({placeholders})', [programme_id, *protected_weeks])
    else:
        free_programme_delete(FREE_PROGRAMME_COMPONENTS_TABLE, 'programme_id = %s', [programme_id])
    if week_ids:
        placeholders = ', '.join(['%s'] * len(week_ids))
        free_programme_delete(FREE_PROGRAMME_MODULES_TABLE, f'id in ({placeholders})', list(week_ids))
    if course_ids and 'free_course_id' in schema_compat.columns_of(CURRICULUM_SCHEMA, AUTHORING_WEEKS_TABLE):
        # Normalised schema: a free-course week references its course
        # (ON DELETE RESTRICT), so the weeks go before the course does.
        placeholders = ', '.join(['%s'] * len(course_ids))
        authoring_delete(AUTHORING_WEEKS_TABLE, f'free_course_id in ({placeholders})', list(course_ids))
    if course_ids:
        placeholders = ', '.join(['%s'] * len(course_ids))
        free_programme_delete(FREE_COURSES_TABLE, f'id in ({placeholders})', list(course_ids))
    return week_ids, course_ids


def save_free_programme_modules(
    programme_id,
    payload,
    *,
    AUTHORING_WEEKS_TABLE,
    CURRICULUM_SCHEMA,
    FREE_COURSES_TABLE,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    LEGACY,
    active_components_payload,
    adopted_courses,
    authoring_delete,
    authoring_upsert,
    clean_str,
    component_expected_otjh_minutes,
    delete_free_programme_data,
    free_programme_component_payload,
    free_programme_course_id,
    free_programme_module_id,
    free_programme_upsert,
    free_programme_week_payload,
    get_free_programme_modules_payload,
    invalidate_curriculum_cache,
    json_db_value,
    load_free_course_catalogue_store,
    otjh_hours_from_minutes,
    require_mode,
    schema_compat,
    stored_module_cover_image,
    transaction,
):
    require_mode(LEGACY)
    programme_id = clean_str(programme_id or payload.get('programmeId') or payload.get('programme_id'))
    if not programme_id:
        raise ValueError('programmeId is required.')
    programme_name = clean_str(payload.get('programmeName') or payload.get('programme_name') or payload.get('programme') or '')
    modules = payload.get('modules') or []
    if not isinstance(modules, list):
        modules = []

    protected = adopted_courses()
    if any(clean_str(module.get('courseId') or module.get('course_id')) in protected
           for module in modules if isinstance(module, dict)):
        raise ValueError('This free course is now edited in Module Builder. Reload the course catalogue.')

    catalogue_store = load_free_course_catalogue_store()
    if catalogue_store.applies():
        # New database: weeks carry their own text and learner records hold
        # RESTRICT keys, so the delete-and-reinsert below cannot run there.
        catalogue_store.save_catalogue(programme_id, modules)
        invalidate_curriculum_cache()
        return get_free_programme_modules_payload(programme_id)

    with transaction.atomic():
        # Scope the rewrite to this programme's own free courses/weeks. This
        # used to delete every row in both tables, destroying other
        # programmes' free-course data on every save.
        existing_free_week_ids_set, existing_free_course_ids_set = delete_free_programme_data(programme_id)
        existing_free_course_ids = [value for value in existing_free_course_ids_set if value]
        existing_free_week_ids = [value for value in existing_free_week_ids_set if value]
        authoring_delete_ids = [*existing_free_course_ids, *existing_free_week_ids]
        if authoring_delete_ids:
            placeholders = ', '.join(['%s'] * len(authoring_delete_ids))
            authoring_delete(
                AUTHORING_WEEKS_TABLE,
                f'module_catalogue_id in ({placeholders}) or id in ({placeholders})',
                [*authoring_delete_ids, *authoring_delete_ids],
            )
        used_course_ids = set(existing_free_course_ids)
        course_ids_by_key = {}
        course_groups = {}
        # Normalised schema only (PostgreSQL, real columns known): see below.
        weeks_belong_to_free_courses = 'free_course_id' in schema_compat.columns_of(CURRICULUM_SCHEMA, AUTHORING_WEEKS_TABLE)
        courses_written = set()
        # One stored object per distinct incoming cover, per save. A course's
        # weeks all carry the same picture, so without this the same bytes would
        # be uploaded once per week of the course.
        stored_cover_urls = {}
        for module_index, module in enumerate(modules):
            if not isinstance(module, dict):
                continue
            course_key = (
                clean_str(module.get('courseId') or module.get('course_id')),
                clean_str(module.get('courseName') or module.get('course_name') or module.get('title') or module.get('name')),
                clean_str(module.get('description') or ''),
                clean_str(module.get('coverImageUrl') or module.get('cover_image_url') or ''),
            )
            course_id = course_key[0]
            if not course_id:
                fallback_key = course_key[1:]
                if fallback_key not in course_ids_by_key:
                    course_ids_by_key[fallback_key] = free_programme_course_id(module, used_course_ids)
                    used_course_ids.add(course_ids_by_key[fallback_key])
                course_id = course_ids_by_key[fallback_key]
            elif course_id not in used_course_ids:
                used_course_ids.add(course_id)
            module_id = free_programme_module_id(programme_id, module, module_index)
            # The Free Courses picker reads the chosen file in the browser and
            # sends it as a `data:image/...;base64,...` URL. Writing that string
            # into `cover_image_url` puts up to 3 MB of base64 into a column that
            # both free-course tables carry and every free-course read selects --
            # the exact regression `stored_module_cover_image` was written to
            # stop for `curriculum.modules`, and the one
            # `backfill_free_course_cover_images` had to clean up here
            # afterwards. Cleaning history is pointless while the save path can
            # put it back, so the bytes go where every other authoring upload
            # goes (Azure when configured, local disk when not) and the column
            # keeps the same /curriculum_api/curriculum/uploads/ URL shape.
            #
            # `course_key` above deliberately still reads the raw incoming value:
            # it decides which weeks group into one course, and keying that on a
            # freshly stored URL would split a course whose weeks were saved
            # together.
            raw_cover = clean_str(module.get('coverImageUrl') or module.get('cover_image_url') or '')
            cover_cache_key = (course_id, raw_cover)
            if cover_cache_key not in stored_cover_urls:
                stored_cover_urls[cover_cache_key] = stored_module_cover_image(course_id, raw_cover)
            cover_image_url = stored_cover_urls[cover_cache_key]
            week_payload = free_programme_week_payload(course_id, module, module_index)
            week_id = week_payload['id']
            components = active_components_payload(module.get('components') if isinstance(module.get('components'), list) else [])
            total_otjh = otjh_hours_from_minutes(sum(
                component_expected_otjh_minutes(component)
                for component in components
                if isinstance(component, dict)
            ))
            group = course_groups.setdefault(course_id, {
                'course_name': module.get('courseName') or module.get('course_name') or module.get('title') or module.get('name') or f'Free course {len(course_groups) + 1}',
                'description': module.get('description') or '',
                'cover_image_url': cover_image_url,
                'display_order': len(course_groups),
                'week_count': 0,
                'component_count': 0,
                'total_otjh': 0,
                'week_builder_week_ids': [],
            })
            if weeks_belong_to_free_courses:
                # Normalised schema: the week points at its course
                # (weeks.free_course_id, FK) instead of carrying the course id
                # as its module, so the course row must exist first. Its
                # totals are completed after the loop, as before.
                if course_id not in courses_written:
                    free_programme_upsert(FREE_COURSES_TABLE, ['id'], {
                        'id': course_id,
                        **{key: value for key, value in group.items() if key != 'week_builder_week_ids'},
                    })
                    courses_written.add(course_id)
                week_payload = {**week_payload, 'free_course_id': course_id, 'module_catalogue_id': None}
            authoring_upsert(AUTHORING_WEEKS_TABLE, ['id'], week_payload)
            free_programme_upsert(FREE_PROGRAMME_MODULES_TABLE, ['id'], {
                'id': module_id,
                'course_id': course_id,
                'week_id': week_id,
                'course_name': module.get('courseName') or module.get('course_name') or module.get('title') or module.get('name') or f'Free course {module_index + 1}',
                'description': module.get('description') or '',
                'cover_image_url': cover_image_url,
                'week_number': week_payload['week_number'],
                'week_title': week_payload['title'],
                'display_order': module_index,
                'component_count': len(components),
                'total_otjh': total_otjh,
            })
            group['week_count'] += 1
            group['component_count'] += len(components)
            group['total_otjh'] += total_otjh
            if week_id:
                group['week_builder_week_ids'].append(week_id)
            for component_index, component in enumerate(components):
                if not isinstance(component, dict):
                    continue
                component_payload = free_programme_component_payload(component, component_index)
                if not component_payload:
                    continue
                free_programme_upsert(FREE_PROGRAMME_COMPONENTS_TABLE, ['id'], {
                    **component_payload,
                    'free_module_id': module_id,
                    'week_id': week_id,
                    'programme_id': programme_id,
                })
        for course_id, group in course_groups.items():
            group['week_builder_week_ids'] = json_db_value(group.get('week_builder_week_ids') or [])
            free_programme_upsert(FREE_COURSES_TABLE, ['id'], {
                'id': course_id,
                **group,
            })

    invalidate_curriculum_cache()
    return get_free_programme_modules_payload(programme_id)


def inject_free_course_into_group(
    course_id,
    group_id,
    *,
    free_programme_id='FREE-COURSES',
    mode='clone',
    start_date=None,
    end_date=None,
    _delete_single_free_course_rows,
    _scrub_free_course_learner_assignments,
    build_free_course_week_structure,
    clean_str,
    curriculum_cohort_from_authoring_detail,
    curriculum_group_from_authoring_detail,
    get_free_programme_modules_payload,
    invalidate_curriculum_cache,
    parse_date,
    re,
    repair_curriculum_parent_links,
    resolve_cohort_row,
    resolve_group_row,
    save_tree_group_modules,
    serialize_cohort_authoring_detail,
    serialize_group_authoring_detail,
    transaction,
    versioning,
):
    """Inject one free course as a new module into an EXISTING programme group.

    The course's weeks/components become a module appended to the group the
    caller selected (``preserve_missing=True`` keeps the group's other modules).
    Component ``settings`` are copied verbatim so a linked quiz/media survive;
    KSB mappings start empty and hours carry the free component's value — the
    author finishes those in the Module Builder. ``mode='move'`` additionally
    deletes the source free course (its own rows only) and scrubs the
    now-dangling learner assignments — everything inside one transaction, so any
    failure rolls the whole injection back.
    """
    course_id = clean_str(course_id)
    if not course_id:
        raise ValueError('A free course id is required.')
    group_id = clean_str(group_id)
    if not group_id:
        raise ValueError('A target group is required.')
    mode = clean_str(mode).lower() or 'clone'
    if mode not in {'clone', 'move'}:
        raise ValueError('mode must be "clone" or "move".')
    dates = {}
    for field, label, value in (('startDate', 'start', start_date), ('endDate', 'end', end_date)):
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) or not parse_date(value):
            raise ValueError(f'Choose a valid module {label} date (YYYY-MM-DD).')
        dates[field] = value
    if dates['endDate'] < dates['startDate']:
        raise ValueError('The module end date must be on or after its start date.')

    source_rows = [
        row for row in get_free_programme_modules_payload(clean_str(free_programme_id) or 'FREE-COURSES')
        if clean_str(row.get('courseId')) == course_id
    ]
    if not source_rows:
        raise LookupError('Free course not found.')
    header = source_rows[0]
    course_title = clean_str(header.get('courseName')) or 'Untitled course'

    module_payload = {
        **dates,
        'moduleName': course_title,
        'title': course_title,
        # module_attachment_authoring_payload reads the description from `notes`
        # and the cover from `coverImage`.
        'notes': clean_str(header.get('description')),
        'coverImage': clean_str(header.get('coverImageUrl')),
        'weekStructure': build_free_course_week_structure(source_rows),
    }

    with transaction.atomic(), versioning.source('free-course-convert'):
        group_row = resolve_group_row(group_id)
        if not group_row:
            raise LookupError('Target group not found.')
        cohort_row = resolve_cohort_row(clean_str(group_row.get('cohort_id')))
        if not cohort_row:
            raise LookupError('The selected group has no cohort.')
        group = curriculum_group_from_authoring_detail(serialize_group_authoring_detail(group_row))
        cohort = curriculum_cohort_from_authoring_detail(serialize_cohort_authoring_detail(cohort_row))
        # preserve_missing keeps every other module already in the group — this is
        # an append, not a replace of the group's module set.
        saved_modules, _removed = save_tree_group_modules(group, cohort, [module_payload], preserve_missing=True)
        saved_module = saved_modules[0] if saved_modules else {}
        module_catalogue_id = clean_str(saved_module.get('catalogueId') or saved_module.get('moduleCatalogueId'))
        programme_id = clean_str(saved_module.get('programmeId'))

        if mode == 'move':
            # Assignments first: on the new database they reference the course
            # (RESTRICT), so the course cannot go while they remain.
            _scrub_free_course_learner_assignments(course_id)
            _delete_single_free_course_rows(course_id)

        if programme_id:
            repair_curriculum_parent_links(programme_id)
        invalidate_curriculum_cache()

    return {
        'mode': mode,
        'programmeId': programme_id,
        'programmeName': clean_str(saved_module.get('programmeName')),
        'cohortId': clean_str(saved_module.get('cohortId') or group_row.get('cohort_id')),
        'groupId': group_id,
        'moduleCatalogueId': module_catalogue_id,
    }


def _delete_single_free_course_rows(
    course_id,
    *,
    AUTHORING_WEEKS_TABLE,
    FREE_COURSES_TABLE,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    authoring_delete,
    clean_str,
    free_programme_delete,
    free_programme_fetch_all,
    load_free_course_catalogue_store,
):
    """Delete ONE free course's own rows + its authoring-week mirror.

    Scoped by course_id / free_module_id, so it removes only this course and
    never the rest of the FREE-COURSES catalogue (the programme-wide
    ``delete_free_programme_data`` would). Mirrors the authoring-week cleanup the
    free-course save performs (``save_free_programme_modules``).
    """
    course_id = clean_str(course_id)
    if not course_id:
        return
    catalogue_store = load_free_course_catalogue_store()
    if catalogue_store.applies():
        # New database: no curriculum.weeks mirror, RESTRICT keys throughout.
        catalogue_store.delete_course(course_id)
        return
    week_rows = free_programme_fetch_all(
        FREE_PROGRAMME_MODULES_TABLE, 'course_id = %s', [course_id], columns=['id', 'week_id'],
    )
    free_week_ids = [clean_str(row.get('id')) for row in week_rows if clean_str(row.get('id'))]
    # The authoring_weeks mirror is keyed on both the free week row id and the
    # authoring week_id it was written under, plus the course id — same predicate
    # save_free_programme_modules deletes by, scoped to this one course.
    mirror_ids = set(free_week_ids)
    for row in week_rows:
        if clean_str(row.get('week_id')):
            mirror_ids.add(clean_str(row.get('week_id')))
    mirror_ids.add(course_id)
    if free_week_ids:
        placeholders = ', '.join(['%s'] * len(free_week_ids))
        free_programme_delete(FREE_PROGRAMME_COMPONENTS_TABLE, f'free_module_id in ({placeholders})', free_week_ids)
    mirror_list = [value for value in mirror_ids if value]
    if mirror_list:
        placeholders = ', '.join(['%s'] * len(mirror_list))
        authoring_delete(
            AUTHORING_WEEKS_TABLE,
            f'module_catalogue_id in ({placeholders}) or id in ({placeholders})',
            [*mirror_list, *mirror_list],
        )
    free_programme_delete(FREE_PROGRAMME_MODULES_TABLE, 'course_id = %s', [course_id])
    free_programme_delete(FREE_COURSES_TABLE, 'id = %s', [course_id])


def convert_module_to_free_course(
    module_catalogue_id,
    *,
    free_programme_id='FREE-COURSES',
    mode='clone',
    MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE,
    _free_module_response_to_input,
    build_module_free_course_weeks,
    clean_str,
    delete_module_authoring_structure,
    get_authoring_structure_payload,
    get_free_programme_modules_payload,
    invalidate_curriculum_cache,
    module_future_teams_sessions,
    save_free_programme_modules,
    transaction,
    unique_timestamp_prefixed_id,
    versioning,
):
    """Copy one programme module into a NEW free course (appended to the existing
    catalogue). ``mode='move'`` additionally archives the source module. Whole
    body is one transaction so a failure rolls the copy and the archive back
    together.
    """
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id:
        raise ValueError('A module id is required.')
    mode = clean_str(mode).lower() or 'clone'
    if mode not in {'clone', 'move'}:
        raise ValueError('mode must be "clone" or "move".')

    structure = get_authoring_structure_payload(module_catalogue_id)
    if not structure:
        raise LookupError('Module not found.')
    course_title = clean_str(structure.get('title')) or 'Untitled course'
    if mode == 'move' and module_future_teams_sessions(module_catalogue_id):
        # Moving archives the source module, and an archive never leaves a
        # running Teams calendar behind it (see module_teams_calendar_block_response).
        raise ValueError(MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE)

    free_programme_id = clean_str(free_programme_id) or 'FREE-COURSES'
    with transaction.atomic(), versioning.source('module-to-free-course'):
        existing_modules = get_free_programme_modules_payload(free_programme_id)
        existing_ids = {clean_str(row.get('courseId')) for row in existing_modules if clean_str(row.get('courseId'))}
        course_id = unique_timestamp_prefixed_id('FREECOURSE', existing_ids)
        new_weeks = build_module_free_course_weeks(structure, course_id)
        if not new_weeks:
            raise ValueError('This module has no weeks to convert.')
        modules_input = [_free_module_response_to_input(row) for row in existing_modules] + new_weeks
        saved = save_free_programme_modules(free_programme_id, {'programmeName': 'Free Courses', 'modules': modules_input})

        if mode == 'move':
            delete_module_authoring_structure(module_catalogue_id)

        invalidate_curriculum_cache()

    return {
        'mode': mode,
        'freeCourseId': course_id,
        'courseName': course_title,
        'moduleCatalogueId': module_catalogue_id,
        'modules': saved,
    }
