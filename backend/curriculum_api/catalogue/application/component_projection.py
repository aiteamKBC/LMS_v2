"""Component response fields, labels, ordering and partial-read projections."""

from curriculum_api.catalogue.domain.content_validation import display_component_type as _default_display_component_type
from curriculum_api.catalogue.domain.content_values import component_coach_validation as _default_component_coach_validation
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_CONTENT_SETTING_KEYS as _default_COMPONENT_CONTENT_SETTING_KEYS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_SETTINGS_OMITTED_FLAG as _default_COMPONENT_SETTINGS_OMITTED_FLAG
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_PAGE_DROPPED_FIELDS as _default_PROGRAMME_PAGE_DROPPED_FIELDS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_PAGE_SETTING_KEYS as _default_PROGRAMME_PAGE_SETTING_KEYS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_VIEW_OMITTED_MARKER as _default_PROGRAMME_VIEW_OMITTED_MARKER
from curriculum_api.catalogue.domain.values import bool_payload as _default_bool_payload
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def component_week_label(row, *, parse_int=_default_parse_int):
    week_number = parse_int(row.get('week_number'), 0)
    return f'Week {week_number}' if week_number else (row.get('title') or '')


def component_builder_response(
    row,
    module_by_id=None,
    week_by_id=None,
    mappings_by_component=None,
    *,
    archived_at,
    bool_payload=_default_bool_payload,
    component_builder_settings,
    component_coach_validation=_default_component_coach_validation,
    component_ksb_mapping_api_item,
    component_ksb_mappings_from_row,
    component_reflection_question,
    component_week_label=component_week_label,
    display_component_type=_default_display_component_type,
    format_date=_default_format_date,
    parse_int=_default_parse_int,
    programme_deleted_row,
):
    module_by_id = module_by_id or {}
    week_by_id = week_by_id or {}
    mappings_by_component = mappings_by_component or {}
    component_id = str(row.get('id'))
    module = module_by_id.get(str(row.get('module_catalogue_id')), {})
    week = week_by_id.get(str(row.get('week_id')), {})
    settings = component_builder_settings(row)
    duration = parse_int(settings.get('durationMinutes'), 0) or round(float(row.get('expected_otjh') or 0) * 60)
    expected_otjh = float(row.get('expected_otjh') or 0)
    mapping_rows = mappings_by_component.get(component_id, [])
    ksb_mappings = [component_ksb_mapping_api_item(mapping) for mapping in component_ksb_mappings_from_row(row, mapping_rows)]
    ksb_refs = [mapping.get('code') for mapping in ksb_mappings if mapping.get('code')]
    return {
        'id': component_id,
        'moduleCatalogueId': str(row.get('module_catalogue_id') or ''),
        'moduleId': str(row.get('module_catalogue_id') or ''),
        'weekId': str(row.get('week_id') or ''),
        'title': row.get('title') or '',
        'description': row.get('description') or '',
        'type': settings.get('displayType') or display_component_type(row.get('type')),
        'displayOrder': parse_int(row.get('display_order'), 0),
        'module': module.get('title') or '',
        'programme': module.get('programme_name') or 'Unassigned programme',
        'week': component_week_label(week),
        'weekTitle': week.get('title') or component_week_label(week),
        'duration': duration,
        'expectedOtjh': expected_otjh,
        'reflectionRequired': bool(row.get('reflection_required')),
        'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool(row.get('tutor_validation_required')),
        'expectedOtjh': float(row.get('expected_otjh') or 0),
        'points': parse_int(row.get('points'), 0),
        'isDeleted': programme_deleted_row(row),
        'deletedAt': archived_at(row),
        'deletedViaParent': row.get('deleted_via_parent') or '',
        'reflectionRequired': bool_payload(row.get('reflection_required')),
        'reflectionQuestion': component_reflection_question(row, settings),
        'workplaceEvidenceRequired': bool_payload(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool_payload(row.get('tutor_validation_required')),
        'coachValidationRequired': component_coach_validation(row),
        'ksbRefs': ksb_refs,
        'ksbMappings': ksb_mappings,
        'status': settings.get('componentBuilderStatus') or 'draft',
        'lastEdited': format_date(row.get('updated_at')),
        'contentSections': parse_int(settings.get('contentSections'), 0),
        'quizQuestions': parse_int(settings.get('quizQuestions'), 0) or None,
        'hasResources': bool_payload(settings.get('hasResources')),
        'settings': settings,
    }


def sort_rows_by_updated_at_desc(rows):
    """Reproduce ``order by updated_at desc`` on rows already sorted by the
    remaining ``order by`` terms.

    Two details make this equal to the database rather than merely similar.
    Postgres sorts ``desc`` as NULLS FIRST, so a row that has never been
    stamped leads; the key below puts ``None`` in its own group that ranks
    above every real timestamp. And ``sorted`` is stable, so rows sharing an
    ``updated_at`` keep the ``display_order, id`` order they arrived in --
    which is exactly what the trailing sort terms did.
    """
    return sorted(
        rows,
        key=lambda row: (1, None) if row.get('updated_at') is None else (0, row.get('updated_at')),
        reverse=True,
    )


def component_rows_without_content(
    rows,
    *,
    COMPONENT_CONTENT_SETTING_KEYS=_default_COMPONENT_CONTENT_SETTING_KEYS,
    COMPONENT_SETTINGS_OMITTED_FLAG=_default_COMPONENT_SETTINGS_OMITTED_FLAG,
):
    """Component rows with the authored long text taken out of ``settings``.

    A row that lost anything says which keys in ``settingsOmitted``, so its
    settings are never mistaken for the whole of them; a row without that key
    is complete. Empty values stay where they are (nothing to save, and no
    reason to make a reader fetch the row again). Copies rather than edits:
    the rows may be a cached list other responses share.
    """
    projected = []
    for row in rows:
        settings = row.get('settings')
        omitted = [
            key for key in COMPONENT_CONTENT_SETTING_KEYS
            if isinstance(settings, dict) and settings.get(key) not in (None, '', [], {})
        ]
        if not omitted:
            projected.append(row)
            continue
        projected.append({
            **row,
            'settings': {key: value for key, value in settings.items() if key not in omitted},
            COMPONENT_SETTINGS_OMITTED_FLAG: omitted,
        })
    return projected


def component_rows_for_programme_page(
    rows,
    already_omitted=None,
    *,
    COMPONENT_SETTINGS_OMITTED_FLAG=_default_COMPONENT_SETTINGS_OMITTED_FLAG,
    PROGRAMME_PAGE_DROPPED_FIELDS=_default_PROGRAMME_PAGE_DROPPED_FIELDS,
    PROGRAMME_PAGE_SETTING_KEYS=_default_PROGRAMME_PAGE_SETTING_KEYS,
    PROGRAMME_VIEW_OMITTED_MARKER=_default_PROGRAMME_VIEW_OMITTED_MARKER,
):
    """Component rows reduced to what the programme page reads.

    ``settings`` keeps only PROGRAMME_PAGE_SETTING_KEYS (empty values too: the
    page tests some of them for presence). A row that lost anything -- here, or
    in the database (``already_omitted``), or already marked -- carries
    ``settingsOmitted: ['*']`` (PROGRAMME_VIEW_OMITTED_MARKER) and loses the
    PROGRAMME_PAGE_DROPPED_FIELDS too. Copies rather than edits: the rows may
    be a cached list.
    """
    keep = set(PROGRAMME_PAGE_SETTING_KEYS)
    already_omitted = already_omitted or {}
    projected = []
    for row in rows:
        settings = row.get('settings')
        settings = settings if isinstance(settings, dict) else {}
        kept = {key: value for key, value in settings.items() if key in keep}
        trimmed_here = len(kept) != len(settings)
        if not (trimmed_here or row.get(COMPONENT_SETTINGS_OMITTED_FLAG)
                or already_omitted.get(str(row.get('id')))):
            projected.append(row)
            continue
        trimmed = {key: value for key, value in row.items() if key not in PROGRAMME_PAGE_DROPPED_FIELDS}
        trimmed['settings'] = kept
        trimmed[COMPONENT_SETTINGS_OMITTED_FLAG] = [PROGRAMME_VIEW_OMITTED_MARKER]
        projected.append(trimmed)
    return projected
