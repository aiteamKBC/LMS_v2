"""Live/frozen definition selection and form/signing read results."""
from __future__ import annotations

from curriculum_api.review_management.domain.template_rules import CONDITIONAL_FIELD_TYPE
from curriculum_api.review_management.domain.instance_rules import EDITABLE_DEFINITION_STATUSES
from curriculum_api.review_management.infrastructure.relations import REVIEW_FIELDS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_ANSWERS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_SIGNATURES_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_SECTIONS_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_TEMPLATES_TABLE
from curriculum_api.review_management.domain.classification import REVIEW_TYPE_CODE_PROGRESS_REVIEW
from curriculum_api.review_management.domain.instance_rules import SIGNATURE_ROLES
from curriculum_api.review_management.infrastructure.instance_rows import _fetch_rows_in
from curriculum_api.review_management.domain.instance_definitions import _flatten_snapshot_fields
from curriculum_api.review_management.infrastructure.instance_rows import _rows_by_instance
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.review_management.application.template_queries import assemble_review_sections
from copy import deepcopy
from collections import defaultdict
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance_answers
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance_signatures
from curriculum_api.review_management.infrastructure.template_rows import get_review_template_row
from curriculum_api.review_management.domain.instance_definitions import json_safe
from curriculum_api.review_management.infrastructure.instance_rows import latest_review_instance_manual_override
from curriculum_api.review_management.domain.instance_definitions import merge_editable_definition_sections
from curriculum_api.review_management.application.instance_progress import progress_review_rag_history
from curriculum_api.review_management.domain.instance_rules import required_signature_roles
from curriculum_api.review_management.domain.instance_definitions import review_instance_progress_snapshot
from curriculum_api.review_management.application.template_queries import review_template_detail_payload
from curriculum_api.review_management.infrastructure.type_rows import review_type_index


def build_definition_snapshot(template_row):
    return json_safe(review_template_detail_payload(template_row))


def review_instance_signing_definitions(instance_rows):
    """{instance id: the signing-relevant slice of review_instance_form_definition}.

    Lists that show many Reviews only need who must sign, who has, and what the
    Review is called -- not answers, overrides, RAG history or PDF state. The
    full definition costs about eight queries per instance; this costs a fixed
    handful for any number of instances. The values it does return are computed
    exactly as review_instance_form_definition computes them.
    """
    instance_rows = [row for row in instance_rows if row.get('id')]
    if not instance_rows:
        return {}
    instance_ids = [row.get('id') for row in instance_rows]
    answers = _rows_by_instance(REVIEW_INSTANCE_ANSWERS_TABLE, instance_ids, 'field_id')
    signatures = _rows_by_instance(REVIEW_INSTANCE_SIGNATURES_TABLE, instance_ids, 'role')
    templates = {
        row.get('id'): row
        for row in _fetch_rows_in(
            REVIEW_TEMPLATES_TABLE, 'id', [row.get('review_template_id') for row in instance_rows],
        )
    }
    type_index = review_type_index()

    # Only an editable Review nobody has signed follows the live, non-deleted
    # form (see effective_review_definition_snapshot), so only those templates'
    # current sections are read -- for all of them in two queries, not two each.
    def follows_live_form(instance_row):
        template = templates.get(instance_row.get('review_template_id'))
        return (
            instance_row.get('status') in EDITABLE_DEFINITION_STATUSES
            and not any(row.get('signed_at') for row in signatures.get(instance_row.get('id'), {}).values())
            and template is not None and not template.get('deleted_at')
        )

    live_template_ids = [row.get('review_template_id') for row in instance_rows if follows_live_form(row)]
    section_rows, field_rows = defaultdict(list), defaultdict(list)
    for row in _fetch_rows_in(REVIEW_SECTIONS_TABLE, 'review_id', live_template_ids,
                              where='deleted_at is null', order_by='display_order asc'):
        section_rows[row.get('review_id')].append(row)
    for row in _fetch_rows_in(REVIEW_FIELDS_TABLE, 'review_id', live_template_ids,
                              order_by='display_order asc'):
        field_rows[row.get('review_id')].append(row)
    live_snapshots = {
        template_id: json_safe(review_template_detail_payload(
            templates[template_id],
            assemble_review_sections(
                template_id, section_rows=section_rows[template_id], field_rows=field_rows[template_id],
            ),
            type_index=type_index,
        ))
        for template_id in dict.fromkeys(live_template_ids)
    }

    definitions = {}
    for instance_row in instance_rows:
        instance_id = instance_row.get('id')
        answers_by_field = answers.get(instance_id, {})
        signatures_by_role = signatures.get(instance_id, {})
        stored_snapshot = as_json_value(instance_row.get('definition_snapshot'), {})
        live_template = templates.get(instance_row.get('review_template_id'))
        snapshot = effective_review_definition_snapshot(
            instance_row,
            snapshot=stored_snapshot,
            live_snapshot=live_snapshots.get(instance_row.get('review_template_id'), {}),
            answers_by_field=answers_by_field,
            signatures_by_role=signatures_by_role,
        )
        type_row = type_index.get((live_template or {}).get('review_type_id')) if live_template else None
        definitions[instance_id] = {
            'template': {
                'name': (live_template or {}).get('name') or stored_snapshot.get('name') or '',
                'reviewTypeCode': snapshot.get('reviewTypeCode') or (type_row or {}).get('code'),
                'visibleTo': snapshot.get('visibleTo', {}),
            },
            'sections': snapshot.get('sections', []),
            'signatures': _signature_payload(snapshot, signatures_by_role),
        }
    return definitions


def _signature_payload(snapshot, signatures_by_role):
    required_roles = set(required_signature_roles(snapshot.get('signatures', {})))
    return {
        role: {
            'required': role in required_roles,
            'signed': bool(signatures_by_role.get(role, {}).get('signed_at')),
            'signedBy': signatures_by_role.get(role, {}).get('signed_by'),
            'signedName': signatures_by_role.get(role, {}).get('signed_name'),
            'signedAt': format_created_at(signatures_by_role.get(role, {}).get('signed_at')),
            # Return the recorded mark as well as the sign-off metadata.
            # Old sign-offs may contain a non-image acknowledgement; clients
            # must only render supported image data URIs, never infer a mark.
            'signature': (
                signatures_by_role.get(role, {}).get('signature') or None
                if signatures_by_role.get(role, {}).get('signed_at') else None
            ),
        }
        for role in SIGNATURE_ROLES
    }


def effective_review_definition_snapshot(
    instance_row, *, snapshot=None, live_snapshot=None,
    answers_by_field=None, signatures_by_role=None,
):
    """Resolve the section tree an instance may safely present right now.

    Passive callers receive the effective snapshot in memory. They never
    write it. Draft-save/completion persist the same value while holding the
    Review Instance lock, closing the race with signature/completion.
    """
    snapshot = deepcopy(
        as_json_value(instance_row.get('definition_snapshot'), {})
        if snapshot is None else snapshot
    )
    if instance_row.get('status') not in EDITABLE_DEFINITION_STATUSES:
        return snapshot

    instance_id = instance_row.get('id')
    answers_by_field = (
        get_review_instance_answers(instance_id)
        if answers_by_field is None else answers_by_field
    )
    signatures_by_role = (
        get_review_instance_signatures(instance_id)
        if signatures_by_role is None else signatures_by_role
    )
    if any(row.get('signed_at') for row in signatures_by_role.values()):
        return snapshot

    if live_snapshot is None:
        live_template = get_review_template_row(instance_row.get('review_template_id'))
        if not live_template:
            return snapshot
        live_snapshot = build_definition_snapshot(live_template)
    if not live_snapshot:
        return snapshot

    snapshot['sections'] = merge_editable_definition_sections(
        snapshot.get('sections', []),
        live_snapshot.get('sections', []),
        answers_by_field.keys(),
    )
    snapshot['fieldCount'] = len(_flatten_snapshot_fields(snapshot['sections']))
    return snapshot


def review_instance_form_definition(instance_row):
    """The hierarchical {instance, template, sections[].fields[].answer} shape
    a dynamic form renderer consumes. Sections/fields/signature-and-visibility
    rules come from the effective definition_snapshot policy above; terminal
    Reviews remain frozen while editable Reviews follow safe Curriculum form
    updates. The display title/status/target date are read live."""
    stored_snapshot = as_json_value(instance_row.get('definition_snapshot'), {})
    live_template = get_review_template_row(instance_row.get('review_template_id'), include_deleted=True)
    live_name = (live_template or {}).get('name') or stored_snapshot.get('name') or ''
    type_row = next((row for row in review_type_index().values()
                     if row.get('id') == (live_template or {}).get('review_type_id')), None)

    answers_by_field = get_review_instance_answers(instance_row.get('id'))
    signatures_by_role = get_review_instance_signatures(instance_row.get('id'))
    snapshot = effective_review_definition_snapshot(
        instance_row,
        snapshot=stored_snapshot,
        answers_by_field=answers_by_field,
        signatures_by_role=signatures_by_role,
    )

    def _attach_answers(fields):
        decorated = []
        for field in fields or []:
            field = dict(field)
            saved = answers_by_field.get(field.get('id'))
            field['answer'] = as_json_value(saved.get('answer'), None) if saved else None
            field['answeredBy'] = saved.get('answered_by') if saved else None
            field['answeredAt'] = format_created_at(saved.get('answered_at')) if saved else None
            if field.get('fieldType') == CONDITIONAL_FIELD_TYPE:
                field['yesFields'] = _attach_answers(field.get('yesFields'))
                field['noFields'] = _attach_answers(field.get('noFields'))
            decorated.append(field)
        return decorated

    sections = [
        {**section, 'fields': _attach_answers(section.get('fields'))}
        for section in snapshot.get('sections', [])
    ]

    result = {
        'instance': {
            'id': instance_row.get('id'),
            'reviewTemplateId': instance_row.get('review_template_id'),
            'learnerId': instance_row.get('learner_id'),
            'programmeId': instance_row.get('programme_id'),
            'occurrenceNumber': instance_row.get('occurrence_number'),
            'targetDate': format_date(instance_row.get('target_date')),
            'status': instance_row.get('status'),
            'startedAt': format_created_at(instance_row.get('started_at')),
            'completedAt': format_created_at(instance_row.get('completed_at')),
        },
        'template': {
            'id': instance_row.get('review_template_id'),
            'name': live_name,
            # Classification is part of the frozen definition. Only legacy
            # snapshots that predate Review Types fall back to the live row;
            # the display title above deliberately remains live.
            'reviewTypeId': snapshot.get('reviewTypeId') or (live_template or {}).get('review_type_id'),
            'reviewTypeCode': snapshot.get('reviewTypeCode') or (type_row or {}).get('code'),
            'reviewTypeName': snapshot.get('reviewTypeName') or (type_row or {}).get('name'),
            'signatures': snapshot.get('signatures', {}),
            'visibleTo': snapshot.get('visibleTo', {}),
            'recurrence': snapshot.get('recurrence', {}),
            'notifications': snapshot.get('notifications', {}),
            'allowEditingPriorDays': snapshot.get('allowEditingPriorDays', 0),
        },
        'sections': sections,
        'signatures': _signature_payload(snapshot, signatures_by_role),
        # None for the overwhelming majority of instances -- only ever set
        # for one that was moved to in-progress by an authorised manual
        # override rather than real Teams attendance (Phase 5).
        'manualOverride': _serialize_manual_override(latest_review_instance_manual_override(instance_row.get('id'))),
        # What a coach last calculated for THIS instance, exactly as it was
        # stored -- never recomputed while reading, so an instance that was
        # never calculated reads as None and a signed one keeps its figures.
        'progressSnapshot': review_instance_progress_snapshot(instance_row),
    }
    if result['template']['reviewTypeCode'] == REVIEW_TYPE_CODE_PROGRESS_REVIEW:
        # Only this Review Type presents a RAG history, and only from the
        # learner's own completed Progress Reviews -- each row showing the RAG
        # that review itself recorded, never the learner's current coach_rag.
        result['ragHistory'] = progress_review_rag_history(instance_row.get('learner_id'))
    from ..domain.pdf_policy import pdf_availability
    result['pdf'] = pdf_availability(result)
    return result


def _serialize_manual_override(row):
    if not row:
        return None
    return {
        'reasonCode': row.get('reason_code'),
        'note': row.get('note') or '',
        'changedBy': row.get('changed_by'),
        'changedAt': format_created_at(row.get('changed_at')),
        'manualStartedAt': format_created_at(row.get('manual_started_at')),
    }
