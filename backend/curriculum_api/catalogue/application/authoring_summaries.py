"""Assemble full, compact and counts-only authoring catalogue summaries.

Read and projection capabilities are explicit. Pricing access is read-only;
no database connection, writer, provider or legacy view is imported here.
"""

from curriculum_api.catalogue.domain.component_types import normalise_component_type as _default_normalise_component_type
from curriculum_api.catalogue.domain.content_validation import frontend_component_type as _default_frontend_component_type
from curriculum_api.catalogue.domain.content_values import component_coach_validation as _default_component_coach_validation
from curriculum_api.catalogue.domain.content_values import otjh_hours_from_minutes as _default_otjh_hours_from_minutes
from curriculum_api.catalogue.domain.content_values import otjh_rounded_minutes as _default_otjh_rounded_minutes
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at as _default_format_created_at
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.catalogue.domain.values import unique as _default_unique
from curriculum_api.weekly_schedule import module_week_boundary_mode


def authoring_catalogue_summaries(
    include_programme_deleted=False,
    include_content=True,
    *,
    list_only=False,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
    GROUPS_TABLE,
    GROUP_ROWS_ORDER,
    WEEK_INDEX_COLUMNS,
    active_component_rows,
    active_mapping_rows,
    active_week_rows,
    authoring_fetch_all,
    authoring_module_content_counts,
    authoring_rows_by_id,
    clean_str=_default_clean_str,
    component_builder_settings,
    component_coach_validation=_default_component_coach_validation,
    component_reflection_question,
    database_vendor,
    format_created_at=_default_format_created_at,
    format_date=_default_format_date,
    free_course_price_payload,
    frontend_component_type=_default_frontend_component_type,
    grouped_catalogue_content_rows,
    live_authoring_rows_sql,
    logger,
    lookup_free_course_prices,
    module_delivery_week_count,
    module_stored_week_count,
    module_week_starts_on,
    module_weekly_schedule,
    normalise_component_type=_default_normalise_component_type,
    normalise_ksb_profile_source_value,
    otjh_hours_from_minutes=_default_otjh_hours_from_minutes,
    otjh_rounded_minutes=_default_otjh_rounded_minutes,
    parse_int=_default_parse_int,
    parse_json_value=_default_parse_json_value,
    prefetch_authoring_reads,
    programme_deleted_row,
    unique=_default_unique,
):
    """Per-module authoring summaries, keyed by module catalogue id.

    ``include_content=False`` is for a caller that only counts modules. It skips
    the two heaviest reads in the curriculum -- every component and every KSB
    mapping, ~28 MB between them on a remote database -- and fills in only the
    two content figures best_authoring_summary() ranks candidates by,
    ``lessonCount`` and ``ksbCount``, from grouped reads. Everything else
    content-derived (week components, quiz count, OTJH, session names, KSB codes,
    and ``deliveryWeeks``, which reads the week components) is left empty or
    unresolved, so such a summary must never stand in for a full one.
    """
    content_counts = None
    try:
        # The module, week and group reads in one round trip; each still runs as
        # written (the group read is the one authoring_rows_by_id() makes below
        # inside a read scope, shared with the training rows).
        prefetch_authoring_reads([
            ((AUTHORING_MODULES_TABLE,), {'order_sql': 'updated_at desc, title'}),
            ((AUTHORING_WEEKS_TABLE,), {'columns': WEEK_INDEX_COLUMNS}),
            ((GROUPS_TABLE,), {'order_sql': GROUP_ROWS_ORDER}),
        ])
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, title')
        week_rows = active_week_rows(authoring_fetch_all(AUTHORING_WEEKS_TABLE, columns=WEEK_INDEX_COLUMNS))
        if include_content and list_only and database_vendor() == 'postgresql':
            component_rows, mapping_rows = grouped_catalogue_content_rows()
        elif include_content:
            # Narrow deliberately. This builds per-module summaries and week outlines
            # and never reads settings_json (24 MB across this table) or ksb_mappings
            # - the summary sets 'ksbMappings': [] outright. With select * this one
            # call dominated every non-compact overview request.
            #
            # Soft-deleted rows are dropped by the query as well as by
            # active_component_rows(): they are about a third of the table and were
            # crossing the network only to be thrown away here.
            where_sql, params = live_authoring_rows_sql(AUTHORING_COMPONENTS_TABLE)
            component_rows = active_component_rows(authoring_fetch_all(
                AUTHORING_COMPONENTS_TABLE, where_sql, params,
                columns=(
                    ('id', 'module_catalogue_id', 'week_id', 'type', 'title', 'expected_otjh',
                     'status')
                    if list_only else CATALOGUE_SUMMARY_COMPONENT_COLUMNS
                ),
            ))
            mapping_rows = active_mapping_rows(authoring_fetch_all(
                AUTHORING_KSB_MAPPINGS_TABLE,
                **({'columns': ('module_catalogue_id', 'ksb_code', 'status')} if list_only else {}),
            ))
        else:
            component_rows, mapping_rows = [], []
            content_counts = authoring_module_content_counts()
    except Exception:
        logger.exception('Unable to read module authoring catalogue rows.')
        return {}

    group_ids = unique([clean_str(row.get('group_id')) for row in module_rows])
    group_rows_by_id = {}
    if group_ids:
        # Keyed by the primary key, so where the rows come from cannot change
        # what this holds; inside a read scope it is the groups read the
        # list builders share (the training rows read it too).
        group_rows_by_id = {
            clean_str(row.get('group_id')): row
            for row in authoring_rows_by_id(GROUPS_TABLE, 'group_id', group_ids, GROUP_ROWS_ORDER)
        }
    if not include_programme_deleted:
        module_rows = [
            row for row in module_rows
            if not (
                programme_deleted_row(row)
                or programme_deleted_row(group_rows_by_id.get(clean_str(row.get('group_id')), {}))
            )
        ]

    summaries = {}
    module_rows_by_catalogue_id = {}
    free_course_prices = lookup_free_course_prices(module_rows)
    for row in module_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        module_rows_by_catalogue_id[catalogue_id] = row
        group_row = group_rows_by_id.get(clean_str(row.get('group_id')), {})
        group_coach_name = clean_str(group_row.get('coach_name'))
        is_programme_deleted = programme_deleted_row(row) or programme_deleted_row(group_row)
        summaries[catalogue_id] = {
            'catalogueId': catalogue_id,
            'title': row.get('title') or f'Module {catalogue_id}',
            'programmeId': row.get('programme_id') or '',
            'programmeName': row.get('programme_name') or 'Unassigned programme',
            'cohortId': row.get('cohort_id') or '',
            'cohort': row.get('cohort_name') or '',
            'groupId': row.get('group_id') or '',
            'group': row.get('group_name') or '',
            'learnerRosterMode': clean_str(row.get('learner_roster_mode') or 'inherited').lower() or 'inherited',
            'teamsSharedSourceModuleId': clean_str(row.get('teams_shared_source_module_id')),
            'ksbRemapReport': parse_json_value(row.get('ksb_remap_report'), {}) or None,
            'description': row.get('description') or '',
            'coverImage': row.get('cover_image_url') or '',
            'status': row.get('status') or 'draft',
            'sourceType': row.get('source_type') or '',
            'isFreeCourse': row.get('source_type') == 'free_course',
            **free_course_price_payload(row, free_course_prices),
            'sourceId': row.get('source_id') or '',
            'ksbProfileSourceId': normalise_ksb_profile_source_value(row.get('ksb_profile_source_id') or ''),
            'tutor': row.get('tutor_name') or '',
            'coach': group_coach_name,
            'sessionsNumber': parse_int(row.get('sessions_number'), 0),
            'weeklySchedule': module_weekly_schedule(row),
            'scheduleMode': row.get('schedule_mode') or 'group',
            'weekStartsOn': module_week_starts_on(row),
            'weekBoundaryMode': module_week_boundary_mode(row),
            'sessionHolidays': parse_json_value(row.get('session_holidays'), []),
        'calendarPolicy': parse_json_value(row.get('calendar_policy'), None),
            'weekDays': row.get('session_week_day') or '',
            'startTime': row.get('session_start_time') or '',
            'endTime': row.get('session_end_time') or '',
            'startDate': format_date(row.get('start_date')),
            'endDate': format_date(row.get('end_date')),
            'qualityScore': parse_int(row.get('quality_score'), 0),
            'isProgrammeDeleted': is_programme_deleted,
            'lastUpdated': format_date(row.get('updated_at')),
            'createdAt': format_created_at(row.get('created_at')),
            # Seeded at zero because the week loop below counts up as it appends,
            # and uses the running total as the week-number/display-order fallback.
            # The stored count is applied once, after the loop -- seeding it here
            # made the list serve `weeks_number` PLUS the authored week rows, so a
            # 14-week module read back as 28 in the catalogue and in the drawer.
            'weeks': 0,
            'weeksNumber': 0,
            'weekStructure': [],
            'ksbCount': 0,
            'lessonCount': 0,
            'quizCount': 0,
            'totalOtjh': 0,
            'totalOtjhMinutes': 0,
            'sessionNames': [],
            'ksbCodes': set(),
        }

    for row in sorted(week_rows, key=lambda item: (
        parse_int(item.get('display_order'), 9999),
        parse_int(item.get('week_number'), 9999),
        clean_str(item.get('id')),
    )):
        catalogue_id = str(row.get('module_catalogue_id'))
        if catalogue_id in summaries:
            summaries[catalogue_id]['weeks'] += 1
            summaries[catalogue_id]['weekStructure'].append({
                'id': clean_str(row.get('id')),
                'weekNumber': parse_int(row.get('week_number'), summaries[catalogue_id]['weeks']),
                'title': row.get('title') or '',
                'displayOrder': parse_int(row.get('display_order'), summaries[catalogue_id]['weeks'] - 1),
            })

    for row in component_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        summary = summaries.get(catalogue_id)
        if not summary:
            continue
        component_id = clean_str(row.get('id'))
        week_id = clean_str(row.get('week_id'))
        component_type = normalise_component_type(row.get('type'))
        row_count = parse_int(row.get('row_count'), 1) if list_only else 1
        summary['lessonCount'] += row_count
        summary['totalOtjhMinutes'] += otjh_rounded_minutes(row.get('expected_otjh')) * row_count
        summary['totalOtjh'] = otjh_hours_from_minutes(summary['totalOtjhMinutes'])
        if component_type == 'quiz':
            summary['quizCount'] += row_count
        if component_type == 'live_session':
            summary['sessionNames'].extend([row.get('title') or ''] * row_count)
        if list_only:
            # Delivery-week detection needs only the live-session count per
            # week. Do not construct every discarded component's edit payload.
            if component_type == 'live_session':
                for week in summary['weekStructure']:
                    if clean_str(week.get('id')) == week_id:
                        week.setdefault('components', []).extend({'type': 'live-session'} for _ in range(row_count))
                        break
            continue
        for week in summary['weekStructure']:
            if clean_str(week.get('id')) != week_id:
                continue
            week.setdefault('components', []).append({
                'id': component_id,
                'moduleCatalogueId': catalogue_id,
                'moduleId': catalogue_id,
                'weekId': week_id,
                'type': frontend_component_type(row.get('type')),
                'title': row.get('title') or '',
                'description': row.get('description') or '',
                'expectedOtjh': float(row.get('expected_otjh') or 0),
                'points': parse_int(row.get('points'), 0),
                'reflectionRequired': bool(row.get('reflection_required')),
                'reflectionQuestion': component_reflection_question(row),
                'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
                'tutorValidationRequired': bool(row.get('tutor_validation_required')),
                'coachValidationRequired': component_coach_validation(row),
                'ksbMappings': [],
                'settings': component_builder_settings(row),
            })
            break

    for row in mapping_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        summary = summaries.get(catalogue_id)
        code = clean_str(row.get('ksb_code'))
        if summary and code:
            summary['ksbCodes'].add(code)

    for catalogue_id, summary in summaries.items():
        summary['ksbCount'] = len(summary['ksbCodes'])
        summary['ksbCodes'] = sorted(summary['ksbCodes'])
        # The authored week count the module actually holds, resolved the same way
        # the structure endpoint resolves it: live week rows win, and modules with
        # no week rows fall back to a sessions-derived estimate. The two reads have
        # to agree -- the catalogue card and the placement drawer read this one,
        # the Module Builder rail reads the other.
        authored_week_count = module_stored_week_count(
            module_rows_by_catalogue_id.get(catalogue_id, {}),
            len(summary.get('weekStructure') or []),
        )
        summary['weeks'] = authored_week_count
        summary['weeksNumber'] = authored_week_count
        summary['deliveryWeeks'] = module_delivery_week_count(module_rows_by_catalogue_id.get(catalogue_id, {}), summary['weekStructure'])

    if content_counts is not None:
        lesson_counts, ksb_counts = content_counts
        for catalogue_id, summary in summaries.items():
            summary['lessonCount'] = lesson_counts.get(catalogue_id, 0)
            summary['ksbCount'] = ksb_counts.get(catalogue_id, 0)

    # The tutor is already on the module row. The coach belongs to the group, so
    # it is read from the group rather than from the person: staff carry no
    # assignment of their own for this to disagree with.
    try:
        coach_by_group = {
            clean_str(row.get('group_id')): clean_str(row.get('coach_name'))
            # GROUP_ROWS_ORDER: the order the other whole-table group readers
            # use, so this shares their memoised read instead of a second one.
            for row in authoring_fetch_all(GROUPS_TABLE, order_sql=GROUP_ROWS_ORDER)
            if clean_str(row.get('group_id'))
        }
        for summary in summaries.values():
            coach_name = coach_by_group.get(clean_str(summary.get('groupId')), '')
            if coach_name and not summary.get('coach'):
                summary['coach'] = coach_name
    except Exception:
        logger.debug('Unable to enrich authoring summaries with the group coach.', exc_info=True)

    return summaries


def authoring_summary_catalogue_item(
    summary,
    *,
    COURSE_PRICING_FIELDS,
    programme_deleted_row,
    teams_delivery_metadata_from_weeks
):
    catalogue_id = summary['catalogueId']
    return {
        'id': f'authoring-module-{catalogue_id}',
        'moduleId': catalogue_id,
        'moduleCatalogueId': catalogue_id,
        'structureId': catalogue_id,
        'sourceId': catalogue_id,
        'catalogueId': catalogue_id,
        'name': summary['title'],
        'programmeId': summary.get('programmeId') or '',
        'programme': summary['programmeName'],
        'cohortId': summary.get('cohortId') or '',
        'cohort': summary.get('cohort') or '',
        'groupId': summary.get('groupId') or '',
        'group': summary.get('group') or '',
        'weeks': summary['weeks'],
        'totalOtjh': summary['totalOtjh'],
        'declaredTotalOtjh': summary['totalOtjh'],
        'ksbCount': summary['ksbCount'],
        'lessons': summary['lessonCount'],
        'quizzes': summary['quizCount'],
        'assignments': 0,
        'status': summary['status'],
        'authoringStatus': summary['status'],
        'sourceType': summary.get('sourceType') or 'authoring',
        'isFreeCourse': summary.get('isFreeCourse', False),
        **{key: summary.get(key) for key in COURSE_PRICING_FIELDS},
        'ksbProfileSourceId': summary.get('ksbProfileSourceId') or '',
        'deliveryStatus': summary.get('deliveryStatus') or 'unknown',
        'author': '',
        'lastUpdated': summary['lastUpdated'],
        'createdAt': summary.get('createdAt') or '',
        'color': '#6941c6',
        'coverImage': summary.get('coverImage') or '',
        'notes': summary['description'],
        'startDate': summary['startDate'],
        'endDate': summary['endDate'],
        'sessionsNumber': summary['sessionsNumber'],
        'weeklySchedule': summary.get('weeklySchedule') or [],
        'scheduleMode': summary.get('scheduleMode') or 'group',
        'weekStartsOn': summary.get('weekStartsOn'),
        'weekBoundaryMode': summary.get('weekBoundaryMode'),
        'calendarPolicy': summary.get('calendarPolicy'),
        'sessionHolidays': summary.get('sessionHolidays') or [],
        'deliveryWeeks': summary.get('deliveryWeeks'),
        'weekDays': summary.get('weekDays') or '',
        'startTime': summary.get('startTime') or '',
        'endTime': summary.get('endTime') or '',
        'weekStructure': summary.get('weekStructure') or [],
        'sessionNames': summary['sessionNames'],
        'ksbCodes': summary['ksbCodes'],
        'qualityScore': summary['qualityScore'],
        'isProgrammeDeleted': programme_deleted_row(summary),
        'tutor': summary.get('tutor') or '',
        'coach': summary.get('coach') or '',
        'deliveryMetadata': {
            'cohortId': summary.get('cohortId') or '',
            'cohort': summary.get('cohort') or '',
            'groupId': summary.get('groupId') or '',
            'group': summary.get('group') or '',
            'tutor': summary.get('tutor') or '',
            'coach': summary.get('coach') or '',
            **teams_delivery_metadata_from_weeks(summary.get('weekStructure') or []),
        },
    }
