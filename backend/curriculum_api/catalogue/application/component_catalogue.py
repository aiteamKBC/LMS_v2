"""Component and reuse-library query orchestration through explicit read contracts."""
from collections import defaultdict

from curriculum_api.catalogue.application.component_projection import component_rows_for_programme_page as _default_component_rows_for_programme_page
from curriculum_api.catalogue.application.component_projection import component_rows_without_content as _default_component_rows_without_content
from curriculum_api.catalogue.application.component_projection import component_week_label as _default_component_week_label
from curriculum_api.catalogue.application.component_projection import sort_rows_by_updated_at_desc as _default_sort_rows_by_updated_at_desc
from curriculum_api.catalogue.domain.component_summary import js_round as _default_js_round
from curriculum_api.catalogue.domain.content_validation import frontend_component_type as _default_frontend_component_type
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def component_builder_rows(
    module_catalogue_ids=None,
    omit_content=False,
    programme_view=False,
    *,
    COMPONENT_CONTENT_SETTING_KEYS,
    COMPONENT_DB_OMITTED_KEYS_COLUMN,
    COMPONENT_DERIVED_SETTING_KEYS,
    COMPONENT_SETTINGS_OMITTED_FLAG,
    PROGRAMME_PAGE_SETTING_KEYS,
    PROGRAMME_VIEW_EXCLUDED_COLUMNS,
    PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS,
    _component_builder_rows,
    clean_str=_default_clean_str,
    component_rows_for_programme_page=_default_component_rows_for_programme_page,
    component_rows_without_content=_default_component_rows_without_content,
    live_component_rows_without_content,
):
    """The component builder rows, whole; or with ``omit_content``, exactly as
    component_rows_without_content() would project them, with the long text
    stripped in the database where it can be (live_component_rows_without_content).

    ``programme_view`` is the programme page's projection
    (component_rows_for_programme_page); it implies ``omit_content``.
    """
    catalogue_ids = [clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)]
    omit_content = omit_content or programme_view
    keep_keys = (PROGRAMME_PAGE_SETTING_KEYS + COMPONENT_DERIVED_SETTING_KEYS) if programme_view else None
    stripped_rows = (
        live_component_rows_without_content(
            catalogue_ids, keep_keys=keep_keys,
            exclude_columns=PROGRAMME_VIEW_EXCLUDED_COLUMNS if programme_view else (),
        )
        if omit_content else None
    )
    if stripped_rows is None:
        rows = _component_builder_rows(catalogue_ids)
        if programme_view:
            return component_rows_for_programme_page(rows)
        return component_rows_without_content(rows) if omit_content else rows
    db_omitted_by_id = {
        str(row.get('id')): list(row.pop(COMPONENT_DB_OMITTED_KEYS_COLUMN, None) or [])
        for row in stripped_rows
    }
    if programme_view:
        # The columns left out above (the description, the reflection question)
        # and the mappings' KSB text are missing from every row, so every row
        # is marked partial: the KSB preview then loads the full row, and a
        # save built from one is refused (partial_read_errors).
        already_omitted = {
            row_id: keys or list(PROGRAMME_VIEW_EXCLUDED_COLUMNS)
            for row_id, keys in db_omitted_by_id.items()
        }
        return component_rows_for_programme_page(
            _component_builder_rows(
                catalogue_ids, stripped_rows, mapping_exclude_columns=PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS,
            ),
            already_omitted=already_omitted,
        )
    projected = []
    for row in _component_builder_rows(catalogue_ids, stripped_rows):
        db_omitted = db_omitted_by_id.get(str(row.get('id'))) or []
        # Anything the database could not strip (a settings document stored
        # as a JSON string) is still taken out here, so the result never
        # depends on which path removed the text.
        row = component_rows_without_content([row])[0]
        omitted = [
            key for key in COMPONENT_CONTENT_SETTING_KEYS
            if key in db_omitted or key in (row.get(COMPONENT_SETTINGS_OMITTED_FLAG) or [])
        ]
        if omitted:
            row = {**row, COMPONENT_SETTINGS_OMITTED_FLAG: omitted}
        projected.append(row)
    return projected


def _component_builder_rows(
    catalogue_ids,
    component_rows=None,
    mapping_exclude_columns=None,
    *,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    active_component_rows,
    active_mapping_rows,
    active_week_rows,
    authoring_fetch_all,
    component_builder_response,
    ensure_module_authoring_tables,
    live_component_rows_paged,
    mappings_with_inferred_sources,
    sort_rows_by_updated_at_desc=_default_sort_rows_by_updated_at_desc,
):
    ensure_module_authoring_tables()
    where_sql = ''
    params = []
    if catalogue_ids:
        where_sql = f'module_catalogue_id in ({", ".join(["%s"] * len(catalogue_ids))})'
        params = catalogue_ids
    # Read in the same order as get_authoring_structure_payloads() and re-sort
    # here. order_sql is part of the read memo key, so asking for a second sort
    # of the identical rows made the programme detail build fetch every
    # component for the programme twice -- ~28 s of a 64 s build. Ordering the
    # list is this reader's own concern, not the database's.
    # Paged and live-only on the database side; see live_component_rows_paged.
    # Same arguments as the structure reader, so a detail build shares the read.
    if component_rows is None:
        component_rows = live_component_rows_paged(catalogue_ids or None, 'display_order, id')
    component_rows = active_component_rows(component_rows)
    component_rows = sort_rows_by_updated_at_desc(component_rows)
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, where_sql, params) if catalogue_ids else authoring_fetch_all(AUTHORING_MODULES_TABLE)
    week_rows = active_week_rows(authoring_fetch_all(AUTHORING_WEEKS_TABLE, where_sql, params) if catalogue_ids else authoring_fetch_all(AUTHORING_WEEKS_TABLE))
    mapping_rows = active_mapping_rows(
        authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, where_sql, params, exclude_columns=mapping_exclude_columns)
        if catalogue_ids else authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, exclude_columns=mapping_exclude_columns)
    )
    mapping_rows = mappings_with_inferred_sources(mapping_rows, module_rows)
    module_by_id = {str(row.get('module_catalogue_id')): row for row in module_rows}
    week_by_id = {str(row.get('id')): row for row in week_rows}
    mappings_by_component = defaultdict(list)
    for row in mapping_rows:
        if row.get('component_id'):
            mappings_by_component[str(row.get('component_id'))].append(row)
    return [
        component_builder_response(row, module_by_id, week_by_id, mappings_by_component)
        for row in component_rows
    ]


def component_summary_rows(
    module_catalogue_ids,
    *,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COMPONENT_SUMMARY_MODULE_COLUMNS,
    COMPONENT_SUMMARY_WEEK_COLUMNS,
    active_week_rows,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    component_summary_ksb_codes,
    component_summary_source_rows,
    component_week_label=_default_component_week_label,
    ensure_module_authoring_tables,
    js_round=_default_js_round,
    parse_int=_default_parse_int,
):
    """Programme-page component figures, one row per module/week/programme bucket.

    Every figure the programme Overview derives from its component list -- how
    many components, how many published, the Expected OTJH, which weeks hold
    any -- without sending the ~17k components of the largest programme to
    the browser to be counted there. Each row carries the fields the page
    matches and buckets a component by (moduleCatalogueId/moduleId, module,
    programme, weekId, week, weekTitle), with the same values
    component_builder_response() gives every component in it, plus:

    ``count``          components in the bucket;
    ``publishedCount`` of those, the ones whose builder status is 'published';
    ``otjhMinutes``    sum over them of ``max(0, Math.round(expectedOtjh * 60))``,
                       the per-component minute rounding the page applies;
    ``displayOrder`` / ``title``  of the bucket's first component in the order
                       the page sorts a week by, so a week's fallback title can
                       be taken from the same component.
    """
    catalogue_ids = sorted({clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)})
    if not catalogue_ids:
        return []
    ensure_module_authoring_tables()
    where_sql = f'module_catalogue_id in ({", ".join(["%s"] * len(catalogue_ids))})'
    component_rows = component_summary_source_rows(catalogue_ids)
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, where_sql, catalogue_ids, columns=list(COMPONENT_SUMMARY_MODULE_COLUMNS))
    week_rows = active_week_rows(authoring_fetch_all(AUTHORING_WEEKS_TABLE, where_sql, catalogue_ids, columns=list(COMPONENT_SUMMARY_WEEK_COLUMNS)))
    module_by_id = {str(row.get('module_catalogue_id')): row for row in module_rows}
    week_by_id = {str(row.get('id')): row for row in week_rows}
    buckets = {}
    for row in component_rows:
        module = module_by_id.get(str(row.get('module_catalogue_id')), {})
        week = week_by_id.get(str(row.get('week_id')), {})
        catalogue_id = str(row.get('module_catalogue_id') or '')
        key = (
            catalogue_id,
            str(row.get('week_id') or ''),
            component_week_label(week),
            week.get('title') or component_week_label(week),
            module.get('title') or '',
            module.get('programme_name') or 'Unassigned programme',
        )
        bucket = buckets.get(key)
        if bucket is None:
            bucket = buckets[key] = {
                'moduleCatalogueId': key[0], 'moduleId': key[0], 'weekId': key[1],
                'week': key[2], 'weekTitle': key[3], 'module': key[4], 'programme': key[5],
                'count': 0, 'publishedCount': 0, 'otjhMinutes': 0,
                'displayOrder': None, 'title': '',
            }
        count = int(row.get('_count') or 0)
        bucket['count'] += count
        bucket['publishedCount'] += int(row.get('_published') or 0)
        bucket['otjhMinutes'] += count * max(0, js_round(float(row.get('expected_otjh') or 0) * 60))
        order = parse_int(row.get('display_order'), 0)
        title = row.get('title') or ''
        if bucket['displayOrder'] is None or (order, title) < (bucket['displayOrder'], bucket['title']):
            bucket['displayOrder'] = order
            bucket['title'] = title
    # ``ksbCodes``: the distinct KSB codes mapped to the bucket's components, so
    # a module's KSB count needs no component list. Absent (not empty) when the
    # mappings cannot be read this way; the page then reads the full list.
    ksb_codes = component_summary_ksb_codes(catalogue_ids)
    if ksb_codes is not None:
        for bucket in buckets.values():
            bucket['ksbCodes'] = sorted(ksb_codes.get((bucket['moduleCatalogueId'], bucket['weekId']), ()))
    return list(buckets.values())


def library_component_rows(
    *,
    search='',
    types=None,
    programme_ids=None,
    origins=None,
    ids=None,
    page=1,
    page_size=None,
    detail=False,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    clean_str=_default_clean_str,
    component_builder_response,
    component_week_label=_default_component_week_label,
    frontend_component_type=_default_frontend_component_type,
    library_component_origin,
    read_library_component_page,
    rows_for_ids,
):
    """Components available for reuse, across every programme ever authored.

    Deliberately does NOT go through ``active_component_rows``: archived and
    detached content is the point of this read, and that filter is exactly what
    removes it.

    Every filter and the page window are pushed into SQL, and the list omits
    ``settings_json``. That is not a micro-optimisation. ``curriculum.components``
    holds ~18k rows and 39 MB, 24 MB of it ``settings_json``, and the database is
    remote: reading the table in full measured ~90 s against ~190 ms for a
    narrow, limited read.

    ``detail=True`` returns the heavy authoring fields (``settings``,
    ``ksbMappings``) and is meant to be called with ``ids``, for the handful of
    components actually being copied.
    """
    component_rows = read_library_component_page(
        search=search, types=types, programme_ids=programme_ids, origins=origins,
        ids=ids, page=page, page_size=page_size, detail=detail,
    )
    if not component_rows:
        return []

    # Look up only the parents this page refers to. A detached component's module
    # row may be long gone and an archived one's module is archived too, so these
    # cannot go through the active-only helpers.
    module_by_id = {
        str(row.get('module_catalogue_id')): row
        for row in rows_for_ids(
            AUTHORING_MODULES_TABLE, 'module_catalogue_id',
            {clean_str(row.get('module_catalogue_id')) for row in component_rows},
        )
    }
    week_by_id = {
        str(row.get('id')): row
        for row in rows_for_ids(
            AUTHORING_WEEKS_TABLE, 'id',
            {clean_str(row.get('week_id')) for row in component_rows},
        )
    }
    mappings_by_component = defaultdict(list)
    if detail:
        for row in rows_for_ids(
            AUTHORING_KSB_MAPPINGS_TABLE, 'component_id',
            {clean_str(row.get('id')) for row in component_rows},
        ):
            mappings_by_component[str(row.get('component_id'))].append(row)

    results = []
    for row in component_rows:
        module = module_by_id.get(str(row.get('module_catalogue_id')), {})
        week = week_by_id.get(str(row.get('week_id')), {})
        # Missing parents have no invented title or week label.
        module_title = clean_str(module.get('title')) if module else ''
        week_label = component_week_label(week) if week else ''
        module_id = clean_str(row.get('module_catalogue_id'))
        payload = component_builder_response(row, module_by_id, week_by_id, mappings_by_component)
        payload.update({
            'origin': library_component_origin(row),
            # component_builder_response puts a human label in `type`
            # ("Self-study"), which cannot be copied into a new component.
            # The authoring type is the hyphenated machine value.
            'componentType': frontend_component_type(row.get('type')),
            'originModuleCatalogueId': module_id,
            'originModuleTitle': module_title,
            'originWeekId': clean_str(row.get('week_id')),
            'originWeekLabel': week_label,
            'detachedAt': None,
            'copiedFromId': clean_str(row.get('copied_from_id')),
            'module': module_title,
            'week': week_label,
            'weekTitle': clean_str(week.get('title')) if week else week_label,
        })
        results.append(payload)
    return results
