"""Answer-safe definition trees, required fields and immutable historical values."""
from __future__ import annotations

from curriculum_api.review_management.domain.template_rules import CONDITIONAL_FIELD_TYPE
from curriculum_api.review_management.domain.template_rules import DISPLAY_ONLY_FIELD_TYPES
from decimal import Decimal
from curriculum_api.review_management.domain.template_rules import MEETING_SUMMARY_SEMANTIC_KEY
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from datetime import date
from datetime import datetime
from copy import deepcopy


def json_safe(value):
    """The same structure with every value JSON can actually hold.

    The template payload carries live ``datetime``/``date`` objects (a row's
    createdAt/updatedAt), which the response encoder handles but a plain
    ``json.dumps`` into JSONB does not. Normalising on the way in also keeps
    the snapshot round-trippable: what is read back out of the column has the
    same shape as what was frozen into it.
    """
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _flatten_snapshot_fields(sections):
    """Every field in a definition_snapshot's sections tree, conditional
    children included -- unlike reviews.flatten_fields (which is a
    top-level-only convenience view), a saved answer/validation pass needs to
    see every field, at any nesting depth."""
    flat = []

    def _walk(fields):
        for field in fields or []:
            flat.append(field)
            _walk(field.get('yesFields'))
            _walk(field.get('noFields'))

    for section in sections or []:
        _walk(section.get('fields'))
    return flat


def semantic_review_fields(definition, semantic_key):
    """Fields carrying one stable semantic marker, at any nesting depth.

    ``definition`` may be either a frozen ``definition_snapshot`` or the
    serialized form definition built from it. Runtime consumers deliberately
    do not fall back to editable titles such as "Summary".
    """
    semantic_key = clean_str(semantic_key)
    if not semantic_key:
        return []
    return [
        field
        for field in _flatten_snapshot_fields((definition or {}).get('sections', []))
        if clean_str((field.get('configuration') or {}).get('semanticKey')) == semantic_key
    ]


def meeting_summary_field(definition):
    """Return the single explicitly mapped formal Review summary field.

    Multiple markers are ambiguous and therefore behave like no mapping.
    Template validation prevents new duplicates; this defensive rule keeps
    existing persisted definitions from being guessed at runtime.
    """
    fields = semantic_review_fields(definition, MEETING_SUMMARY_SEMANTIC_KEY)
    return fields[0] if len(fields) == 1 else None


def _field_index(sections):
    return {
        field.get('id'): field
        for field in _flatten_snapshot_fields(sections)
        if field.get('id')
    }


def _field_tree_has_answer(field, answered_field_ids):
    if field.get('id') in answered_field_ids:
        return True
    return any(
        _field_tree_has_answer(child, answered_field_ids)
        for branch in ('yesFields', 'noFields')
        for child in field.get(branch, []) or []
    )


def _retained_removed_field(field, *, live_field_ids, answered_field_ids):
    """Keep only answered legacy branches removed from the live template.

    This is the fail-safe half of the merge: deleting an unanswered question
    from Curriculum removes it from an editable Review, while deleting one
    that already owns an answer never makes that answer disappear from the
    form/PDF. Fields moved elsewhere in the live tree are not duplicated.
    """
    if field.get('id') in live_field_ids:
        return None
    retained = deepcopy(field)
    has_answer = field.get('id') in answered_field_ids
    for branch in ('yesFields', 'noFields'):
        children = [
            kept
            for child in field.get(branch, []) or []
            if (kept := _retained_removed_field(
                child,
                live_field_ids=live_field_ids,
                answered_field_ids=answered_field_ids,
            )) is not None
        ]
        if branch in retained or children:
            retained[branch] = children
        has_answer = has_answer or bool(children)
    return retained if has_answer else None


def _merge_answer_safe_fields(
    old_fields, live_fields, *, old_field_index, live_field_ids, answered_field_ids,
):
    merged = []
    for live_field in live_fields or []:
        field_id = live_field.get('id')
        old_field = old_field_index.get(field_id)
        if not old_field or not _field_tree_has_answer(old_field, answered_field_ids):
            merged.append(deepcopy(live_field))
            continue

        # An answer keeps the old field's data contract (type, required rule,
        # options and semantic configuration). Presentation text/order may
        # safely follow Curriculum, and new conditional children are merged in
        # without discarding answered legacy children.
        field = deepcopy(old_field)
        for key in ('title', 'displayOrder'):
            if key in live_field:
                field[key] = deepcopy(live_field[key])
        for branch in ('yesFields', 'noFields'):
            if branch in old_field or branch in live_field:
                field[branch] = _merge_answer_safe_fields(
                    old_field.get(branch, []),
                    live_field.get(branch, []),
                    old_field_index=old_field_index,
                    live_field_ids=live_field_ids,
                    answered_field_ids=answered_field_ids,
                )
        merged.append(field)

    for old_field in old_fields or []:
        retained = _retained_removed_field(
            old_field,
            live_field_ids=live_field_ids,
            answered_field_ids=answered_field_ids,
        )
        if retained is not None:
            merged.append(retained)
    return merged


def merge_editable_definition_sections(old_sections, live_sections, answered_field_ids):
    """Return the live form tree without losing any already-answered field.

    With no answer rows the result is exactly the current Curriculum section
    tree. Once answers exist, new/unanswered fields follow Curriculum while
    answered fields keep their old structural contract. Removed answered
    fields/sections remain visible; removed unanswered ones do not.
    """
    answered_field_ids = set(answered_field_ids or ())
    if not answered_field_ids:
        return deepcopy(live_sections or [])

    old_sections = old_sections or []
    live_sections = live_sections or []
    old_sections_by_id = {
        section.get('id'): section for section in old_sections if section.get('id')
    }
    old_field_index = _field_index(old_sections)
    live_field_ids = set(_field_index(live_sections))
    live_section_ids = {section.get('id') for section in live_sections if section.get('id')}
    merged = []

    for live_section in live_sections:
        old_section = old_sections_by_id.get(live_section.get('id'))
        old_section_has_answer = bool(old_section) and any(
            _field_tree_has_answer(field, answered_field_ids)
            for field in old_section.get('fields', []) or []
        )
        section = deepcopy(old_section if old_section_has_answer else live_section)
        if old_section_has_answer:
            for key in ('title', 'estimatedMinutes', 'displayOrder'):
                if key in live_section:
                    section[key] = deepcopy(live_section[key])
        section['fields'] = _merge_answer_safe_fields(
            old_section.get('fields', []) if old_section else [],
            live_section.get('fields', []),
            old_field_index=old_field_index,
            live_field_ids=live_field_ids,
            answered_field_ids=answered_field_ids,
        )
        merged.append(section)

    for old_section in old_sections:
        if old_section.get('id') in live_section_ids:
            continue
        retained_fields = [
            retained
            for field in old_section.get('fields', []) or []
            if (retained := _retained_removed_field(
                field,
                live_field_ids=live_field_ids,
                answered_field_ids=answered_field_ids,
            )) is not None
        ]
        if retained_fields:
            section = deepcopy(old_section)
            section['fields'] = retained_fields
            merged.append(section)
    return merged


def _visible_required_unanswered_fields(sections, answers_by_field):
    """Visible (per the boolean_case_block condition its parent answered)
    required fields with no answer yet -- a hidden conditional field can
    never block completion, whatever it was answered before being hidden."""
    missing = []

    def _walk(fields, visible=True):
        for field in fields or []:
            field_visible = visible
            if field.get('fieldType') in DISPLAY_ONLY_FIELD_TYPES:
                pass
            elif field_visible and field.get('required'):
                saved = answers_by_field.get(field.get('id'))
                answer = as_json_value(saved.get('answer'), None) if saved else None
                if answer in (None, '', []):
                    missing.append(field.get('id'))

            if field.get('fieldType') == CONDITIONAL_FIELD_TYPE:
                saved = answers_by_field.get(field.get('id'))
                answer = as_json_value(saved.get('answer'), None) if saved else None
                _walk(field.get('yesFields'), visible=field_visible and answer == 'yes')
                _walk(field.get('noFields'), visible=field_visible and answer == 'no')

    _walk(sections and [f for s in sections for f in s.get('fields', [])])
    return missing


def writable_field_ids_for_role(sections, role):
    """Field ids in this frozen definition whose configuration opts a
    non-advisor ``role`` ('participant' or 'employer') into answering them.

    The advisor (coach) is never checked against this list -- coach_api's
    answer endpoint always allows every field. This is only for the Learner
    and Employer surfaces, which share the same ReviewFormRenderer but must
    stay read-only outside whatever the Curriculum template opted them into.
    """
    return {
        field.get('id')
        for field in _flatten_snapshot_fields(sections)
        if role in ((field.get('configuration') or {}).get('respondentRoles') or [])
    }


PROGRESS_SNAPSHOT_COLUMN = 'progress_snapshot'


LEGACY_PROGRESS_SNAPSHOT_SCHEMA_VERSION = 1


LEGACY_PROGRESS_SNAPSHOT_FORMULA_VERSION = 'legacy_unversioned'


RAG_SEMANTIC_KEY = 'rag_status'


def review_instance_progress_snapshot(instance_row):
    """What was frozen the last time a coach pressed Calculate, or None.

    Never recalculated on read: an instance with no snapshot reads as None so
    the caller can say "not calculated yet", rather than quietly substituting
    the learner's current figures into a historical review.
    """
    snapshot = as_json_value(instance_row.get(PROGRESS_SNAPSHOT_COLUMN), None)
    if not isinstance(snapshot, dict):
        return snapshot
    # Interpret old stored JSON explicitly without rewriting it or pretending it
    # used the current formula. Existing UI/PDF readers ignore these additive
    # fields and continue to render the frozen values unchanged.
    return {
        **snapshot,
        'schemaVersion': snapshot.get('schemaVersion', LEGACY_PROGRESS_SNAPSHOT_SCHEMA_VERSION),
        'formulaVersion': snapshot.get('formulaVersion', LEGACY_PROGRESS_SNAPSHOT_FORMULA_VERSION),
    }


def _rag_field_ids(snapshot):
    return [
        field.get('id')
        for field in _flatten_snapshot_fields(snapshot.get('sections', []))
        if (field.get('configuration') or {}).get('semanticKey') == RAG_SEMANTIC_KEY
    ]
