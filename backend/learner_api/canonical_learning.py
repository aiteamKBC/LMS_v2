"""Shared reads of the consolidated learning record.

Source snapshots are lineage, not additional hours. Reads never sync, run AI,
repair data, or create records. Route identities are verified before reading.
"""
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo
from collections import Counter
import re

from old_otjh.repository import query
from old_otjh.service import ServiceError
from .monthly_log_sources import decoded, number, row
from .current_learning import current_records, merge_attempts, merge_submissions, project_current

UK = ZoneInfo('Europe/London')


def enabled(learner_id):
    return profile(learner_id) is not None


def profile(learner_id):
    records = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        l.programme,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        u.id AS account_record_id,u."Email" AS account_email,u.aptem_id AS account_aptem_id
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.enrolment_id=%s''', [learner_id])
    if not records:
        return None
    if len(records) != 1:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    owner = records[0]
    email = str(owner.get('email') or '').strip().casefold()
    account_email = str(owner.get('account_email') or '').strip().casefold()
    aptem = str(owner.get('account_aptem_id') or '').strip().lstrip('0')
    if (owner.get('account_record_id') is None or not email or email != account_email
            or (aptem and aptem != str(owner.get('aptem_id') or '').lstrip('0'))):
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return owner


def profile_by_aptem(aptem_id):
    """For already-authorized Audit callers; never use an Aptem ID as a PK."""
    records = query('''SELECT id,enrolment_id,aptem_id,programme_id,full_name AS name,
        programme,coach_name,coach_email,email,start_date,end_date,learner_type
        FROM "Learner".learners WHERE aptem_id=%s''', [aptem_id])
    if len(records) != 1:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return records[0]


def entries(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return []
    return entries_for(owner)


def entries_for(owner):
    records = query('''SELECT to_jsonb(p) AS payload,
        coalesce((SELECT jsonb_agg(k.ksb_code ORDER BY k.position)
          FROM "Learner".learner_progress_ksbs k WHERE k.progress_id=p.id),'[]'::jsonb) AS ksbs,
        coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.segment_order,s.id)
          FROM "Learner".learner_activity_reporting_segments s
          WHERE s.progress_id=p.id AND s.learner_id=p.learner_id),'[]'::jsonb) AS segments,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
            'source_id',s.id,'source_system',s.source_system,'source_activity_id',s.source_activity_id,
            'source_course_ref',c.source_course_ref,'source_course_id',c.id,
            'course_title',c.source_course_title,'catalogue_id',a.id,
            'component_ref',coalesce(nullif(s.curriculum_component_ref,''),a.curriculum_component_ref),
            'module_ref',c.curriculum_module_ref,'group_ref',c.curriculum_group_ref,
            'source_activity_kind',a.source_activity_kind) ORDER BY s.id)
          FROM "Learner".learner_activity_sources s
          LEFT JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id AND a.deleted_at IS NULL
          LEFT JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
          WHERE s.canonical_progress_id=p.id AND s.learner_id=p.learner_id
            AND s.deleted_at IS NULL),'[]'::jsonb) AS sources,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
            'group_id',j.group_id,'activity_id',j.activity_id,'source_ref',j.source_ref) ORDER BY j.id)
          FROM "Learner".learner_journal_rows j
          JOIN "Learner".learner_activity_sources js ON js.id=j.source_id
            AND js.learner_id=p.learner_id AND js.canonical_progress_id=p.id AND js.deleted_at IS NULL
          WHERE j.progress_id=p.id AND j.canonical_learner_id=p.learner_id
            AND j.deleted_at IS NULL),'[]'::jsonb) AS journal_routes,
        coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id)
          FROM "Learner".learner_progress_historical_components link
          JOIN curriculum.historical_components h ON h.id=link.historical_component_ref
            AND h.deleted_at IS NULL AND h.historical_only=true
          WHERE link.progress_id=p.id),'[]'::jsonb) AS historical_components
        FROM "Learner".learner_progress_entries p
        WHERE p.learner_id=%s AND p.deleted_at IS NULL
        ORDER BY p.reporting_month,p.reporting_started_at NULLS LAST,p.id''',
        [owner['id']])
    result = current_records(owner, [{**decoded(record['payload'], {}), **{
        field: decoded(record.get(field), [])
        for field in ('ksbs', 'segments', 'sources', 'journal_routes', 'historical_components')}} for record in records])
    from learner_api import journal_sources
    if journal_sources.enabled():
        planned = journal_sources.planned_by_progress(owner['id'], query)
        for record in result:
            if record['id'] in planned:
                record['expected_otjh'] = planned[record['id']]
                record['journal_planned_hours'] = planned[record['id']]
    return result


def allocations(entry):
    """Segments replace the parent's allocation; source observations never add time."""
    segments = entry.get('segments') or []
    if not segments:
        return [entry]
    return [{**entry, **{key: segment.get(key) for key in (
        'actual_seconds', 'reporting_month', 'reporting_started_at', 'reporting_ended_at')},
        'segment_id': segment['id']} for segment in segments]


def recorded_seconds(entry):
    return sum(number(part.get('actual_seconds')) for part in allocations(entry))


def local_instant(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value.astimezone(UK) if value else None


def activity_rows(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return []
    return rows_for(owner)


def rows_for(owner, records=None):
    result = []
    for entry in (part for record in (entries_for(owner) if records is None else records) for part in allocations(record)):
        source = decoded(entry.get('source_payload'), {})
        at = local_instant(entry.get('reporting_started_at') or entry.get('reporting_ended_at'))
        ref = f"canonical:{entry['id']}"
        if entry.get('segment_id') is not None:
            ref += f":segment:{entry['segment_id']}"
        item = row(ref, at, entry.get('component_title'),
                   (entry.get('component_type') or entry.get('kind') or 'Learning').replace('_', ' ').title(),
                   hours=number(entry.get('actual_seconds')) / 3600,
                   planned=entry.get('expected_otjh') if entry.get('expected_otjh') is not None else source.get('planned_hours'),
                   note=source.get('completion_note') or entry.get('feedback'),
                   group=entry.get('module_title') or entry.get('group_title'), ksbs=entry['ksbs'])
        item.update(accepted=entry.get('accepted') is True,
                    reporting_month=entry.get('reporting_month'),
                    timestamp_label=entry.get('reporting_timestamp_label') or source.get('timestamp_label') or '',
                    actual_hours_recorded=entry.get('actual_seconds') is not None,
                    progress_id=entry['id'])
        result.append(item)
    by_id = {}
    for item in result:
        by_id.setdefault(item['progress_id'], []).append(item)
    documents = query('''SELECT id,progress_id,display_name,content_type
        FROM "Learner".learner_activity_documents
        WHERE learner_id=%s AND deleted_at IS NULL ORDER BY id''', [owner['id']])
    for document in documents:
        for item in by_id.get(document['progress_id'], []):
            item['documents'].append({'id': document['id'], 'display_name': document['display_name'],
                'content_type': document['content_type'],
                'url': f"/learner_api/monthly-logs/{owner['enrolment_id']}/canonical-documents/{document['id']}/" if owner.get('enrolment_id') else None})
    return result


def targets(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return {}
    from learner_api import journal_sources
    if journal_sources.enabled():
        return journal_sources.monthly_targets(owner['id'], query)
    return {record['report_month']: float(record['target_hours']) for record in query('''
        SELECT report_month,target_hours FROM "Learner".learner_monthly_targets
        WHERE learner_id=%s''', [owner['id']]) if record['target_hours'] is not None}


def signatures(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return []
    return query('''SELECT report_month,signer_role,signer_name,signed_at,snapshot_digest AS snapshot_hash,
        coalesce(signature_url,signature_data) AS url
        FROM "Learner".learner_monthly_signatures
        WHERE learner_id=%s AND review_confirmed IS TRUE ORDER BY signed_at DESC,id DESC''', [owner['id']])


def content_row(owner, month, row_id):
    """Resolve a preview without rebuilding signatures, targets or month totals."""
    records = entries_for(owner)
    item = next((r for r in rows_for(owner, records)
                 if r['id'] == row_id and str(r.get('reporting_month')) == month), None)
    if item is None:
        raise ServiceError('Activity not found.', 'not_found', 404)
    record = next(r for r in records if r['id'] == item['progress_id'])
    return item, record


def material_parts(item, owner, record=None):
    """Resolve owned canonical activity routes to available private Azure files."""
    from django.conf import settings
    from .material_storage import read_url

    if record is None:
        record = next((r for r in entries_for(owner)
                       if str(r['id']) == str(item.get('progress_id'))), None)
    if record is None:
        return []
    catalogue = query('''SELECT a.source_activity_id,a.source_activity_title,a.source_activity_type,
        a.source_section_title,a.source_position AS position,a.curriculum_component_ref,
        c.source_course_ref,c.source_course_title,c.curriculum_module_ref,
        m.id AS material_record_id,m.title AS material_title,m.backup_status,
        m.blob_container AS material_blob_container,m.blob_name AS material_blob_name,
        m.blob_content_type AS material_blob_content_type,
        m.source_metadata->>'azure_storage_account' AS material_blob_account
        FROM "Learner".learner_source_course_memberships membership
        JOIN curriculum.source_courses c ON c.id=membership.source_course_id
          AND c.deleted_at IS NULL AND c.source_system='old_lms'
        JOIN curriculum.source_activities a ON a.source_course_id=c.id
          AND a.deleted_at IS NULL AND a.source_system=c.source_system
          AND a.source_activity_kind='material'
        JOIN curriculum.source_materials m ON m.material_id=a.source_material_id
          AND m.source_system=a.source_system AND m.deleted_at IS NULL
        WHERE membership.learner_id=%s AND membership.deleted_at IS NULL
          AND c.source_course_ref ~ '^[0-9]+$'
        ORDER BY c.id,a.id''', [owner['id']])
    courses = list({r['source_course_ref']: {
        'source_course_ref': r['source_course_ref'], 'source_course_title': r['source_course_title']}
        for r in catalogue}.values())
    files = {(str(r['source_course_ref']), r['source_activity_id']): r for r in catalogue}
    sources = [r for r in record.get('sources') or []
               if r.get('source_system') == 'old_lms'
               and r.get('source_course_ref') and r.get('source_activity_id')]
    if sources:
        # Preserve the activity namespace: quiz:10 must never open material:10.
        keys = {(str(r['source_course_ref']), r['source_activity_id']) for r in sources}
    else:
        component_ids = {r.get('curriculum_component_ref') or r.get('component_ref')
                         for r in [record, *(record.get('sources') or [])]}
        component_ids.discard(None)
        component_ids.discard('')
        # journal:<id> is a source-row identity, not a curriculum component.
        component_ids = {value for value in component_ids if not str(value).startswith('journal:')}
        if component_ids:
            keys = {key for key, material in files.items()
                    if material.get('curriculum_component_ref') in component_ids}
        else:
            placements, _, _ = recorded_course_items(courses, catalogue, [record])
            keys = {(str(p['group_id']), f"{p['catalogue_kind']}:{p['source_activity_id']}")
                    for p in placements}
    # A preview opens only the clicked record's uniquely identified material.
    # Never substitute sibling resources, even when their titles match.
    if len(keys) != 1 or not keys.issubset(files):
        return []
    parts, seen = [], set()
    for key in keys:
        material = files.get(key)
        if material is None:
            continue
        ident = material['material_record_id']
        if ident in seen:
            continue
        seen.add(ident)
        part = {'id': ident, 'title': material['material_title'] or item['title'],
                'category': item['category'], 'content_type': material['material_blob_content_type'],
                'url': None, 'html': None, 'quiz': None}
        if (material['backup_status'] == 'available' and material['material_blob_container']
                and material['material_blob_name']):
            try:
                part['url'] = read_url(material, settings)
            except ValueError as error:
                raise ServiceError('Material storage is temporarily unavailable.', 'storage_unavailable', 503) from error
        else:
            part['html'] = '<p>This material is linked to the activity. Its Azure backup is not ready yet.</p>'
        from .source_material_content import material_quiz_definition
        payload_rows = query('SELECT payload FROM curriculum.source_materials WHERE id=%s AND deleted_at IS NULL', [ident])
        payload = decoded(payload_rows[0].get('payload') if payload_rows else None, {})
        reading = next((payload.get(key) for key in ('reading_text_body', 'text_body', 'html_body')
                        if isinstance(payload.get(key), str) and payload[key].strip()), None)
        if reading:
            part['html'] = reading
        definition = material_quiz_definition(payload)
        if definition:
            part['quiz'] = {'state': 'unavailable', 'attempt': None,
                            'answers_available': False, 'definition': definition}
        parts.append(part)
    return parts


def component_parts(item, owner, record):
    """Read authored local content through the learner's exact progress identity."""
    if record is None:
        return []
    quizzes = query('''SELECT DISTINCT q.id,q.title,q.short_description,q.show_correct_answer
        FROM "Learner".learner_progress_entries p
        JOIN curriculum.components c ON c.id=p.component_ref AND c.deleted_at IS NULL
        JOIN curriculum.quiz_component_links link ON link.component_id=c.id
        JOIN curriculum.quizzes q ON q.id=link.quiz_id
        WHERE p.id=%s AND p.learner_id=%s AND p.deleted_at IS NULL
          AND (nullif(p.quiz_ref,'') IS NULL OR q.id::text=p.quiz_ref)''',
        [record['id'], owner['id']])
    parts = []
    if len(quizzes) == 1:
        quiz = quizzes[0]
        questions = query('''SELECT q.id AS question_id,q.sort_order AS question_order,q.question_text,q.question_type,
            coalesce((SELECT jsonb_agg(jsonb_build_object('option_id',a.id,'option_text',a.answer_text)
                ORDER BY a.sort_order,a.id) FROM curriculum.quiz_answers a WHERE a.question_id=q.id),'[]'::jsonb) AS answer_options
            FROM curriculum.quiz_questions q WHERE q.quiz_id=%s AND coalesce(q.is_archived,false)=false
            ORDER BY q.sort_order,q.id''', [quiz['id']])
        for question in questions:
            options = decoded(question.get('answer_options') or [], None)
            if not isinstance(options, list) or any(not isinstance(option, dict) for option in options):
                raise ServiceError('Quiz answer options could not be read.', 'invalid_quiz_options', 503)
            question['answer_options'] = options
        if questions:
            answers = query('''SELECT a.question_ref,a.chosen_answer_ref,a.is_correct,
                coalesce((SELECT jsonb_agg(s.answer_ref) FROM "Learner".learner_quiz_chosen_answers s
                    WHERE s.quiz_answer_id=a.id),'[]'::jsonb) AS selected,
                coalesce((SELECT jsonb_agg(s.answer_ref) FROM "Learner".learner_quiz_correct_answers s
                    WHERE s.quiz_answer_id=a.id),'[]'::jsonb) AS correct
                FROM "Learner".learner_quiz_answers a
                JOIN "Learner".learner_progress_entries p ON p.id=a.progress_id
                WHERE p.id=%s AND p.learner_id=%s AND p.deleted_at IS NULL ORDER BY a.position''',
                [record['id'], owner['id']])
            answered = {str(a['question_ref']): a for a in answers}
            saved = []
            for question in questions:
                answer = answered.get(str(question['question_id']))
                if answer is None:
                    continue
                selected = {str(value) for value in decoded(answer.get('selected'), [])}
                if answer.get('chosen_answer_ref') is not None:
                    selected.add(str(answer['chosen_answer_ref']))
                correct = {str(value) for value in decoded(answer.get('correct'), [])} if quiz.get('show_correct_answer') else set()
                options = question['answer_options']
                saved.append({**question, 'is_correct': answer.get('is_correct'),
                    'learner_selected_answers': [a['option_text'] for a in options if str(a['option_id']) in selected],
                    'correct_answers': [a['option_text'] for a in options if str(a['option_id']) in correct],
                    'answer_options': [{'option_text': a['option_text'], 'is_selected': str(a['option_id']) in selected} for a in options]})
            attempt = None
            if saved:
                attempt = {'title': quiz['title'], 'status': 'passed' if record.get('passed') else 'submitted',
                    'score': record.get('achieved_score'), 'maximum_score': record.get('total_score'),
                    'attempt_number': record.get('attempt'),
                    'quiz_body': {'description': quiz.get('short_description'), 'questions': saved}}
            parts.append({'id': item['id'], 'title': quiz['title'], 'category': item['category'],
                          'url': None, 'html': None, 'quiz': {'state': 'attempted' if attempt else 'unavailable',
                          'attempt': attempt, 'answers_available': bool(attempt), 'definition': {
                              'description': quiz.get('short_description'), 'questions': questions}}})
    components = query('''SELECT c.description,c.settings_json FROM "Learner".learner_progress_entries p
        JOIN curriculum.components c ON c.id=p.component_ref AND c.deleted_at IS NULL
        WHERE p.id=%s AND p.learner_id=%s AND p.deleted_at IS NULL''', [record['id'], owner['id']])
    if components:
        component = components[0]
        settings = decoded(component.get('settings_json'), {})
        html = settings.get('readingContent') or settings.get('assignmentBrief')
        if html:
            parts.append({'id': -2, 'title': item['title'], 'category': item['category'],
                          'url': None, 'html': html, 'quiz': None})
    return parts


def source_quiz_parts(item, owner, record):
    """Resolve imported quiz definitions by stored quiz ID within an owned course."""
    if record is None:
        return []
    rows = query('''WITH routes AS (
        SELECT a.source_course_id,a.source_activity_id
        FROM "Learner".learner_activity_sources s
        JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id
          AND a.source_activity_kind='quiz' AND a.source_system='old_lms' AND a.deleted_at IS NULL
        WHERE s.canonical_progress_id=%s AND s.learner_id=%s AND s.deleted_at IS NULL
        UNION
        SELECT c.id,a.source_activity_id
        FROM "Learner".learner_journal_rows j
        JOIN "Learner".learner_activity_sources s ON s.id=j.source_id
          AND s.canonical_progress_id=j.progress_id AND s.learner_id=j.canonical_learner_id AND s.deleted_at IS NULL
        JOIN curriculum.source_courses c ON c.source_course_ref=j.group_id::text
          AND c.source_system='old_lms' AND c.deleted_at IS NULL
        JOIN curriculum.source_activities a ON a.source_course_id=c.id
          AND a.source_activity_id='quiz:'||j.activity_id::text AND a.source_activity_kind='quiz'
          AND a.source_system=c.source_system AND a.deleted_at IS NULL
        WHERE j.progress_id=%s AND j.canonical_learner_id=%s AND j.deleted_at IS NULL
          AND j.source_ref='la:'||j.group_id::text||':'||j.activity_id::text)
        SELECT DISTINCT m.id,m.payload
        FROM routes r
        JOIN "Learner".learner_source_course_memberships member ON member.source_course_id=r.source_course_id
          AND member.learner_id=%s AND member.deleted_at IS NULL
        JOIN curriculum.source_activities material ON material.source_course_id=r.source_course_id
          AND material.source_activity_kind='material' AND material.source_system='old_lms' AND material.deleted_at IS NULL
        JOIN curriculum.source_materials m ON m.material_id=material.source_material_id
          AND m.source_system=material.source_system AND m.deleted_at IS NULL
          AND 'quiz:'||(m.payload->>'quiz_id')=r.source_activity_id''',
        [record['id'], owner['id'], record['id'], owner['id'], owner['id']])
    if len(rows) != 1:
        return []
    from .source_material_content import material_quiz_definition
    definition = material_quiz_definition(rows[0]['payload'])
    if not definition:
        return []
    return [{'id': item['id'], 'title': item['title'], 'category': item['category'],
             'url': None, 'html': None, 'quiz': {'state': 'unavailable', 'attempt': None,
             'answers_available': False, 'definition': definition}}]


def content(item, owner=None, record=None):
    if owner is not None and record is None:
        record = next((r for r in entries_for(owner) if str(r['id']) == str(item.get('progress_id'))), None)
    parts = material_parts(item, owner, record) if owner is not None and record is not None else []
    if not parts and owner is not None and record is not None:
        parts = component_parts(item, owner, record)
    if not parts and owner is not None and record is not None:
        parts = source_quiz_parts(item, owner, record)
    note = item.get('completion_note')
    if parts:
        if note:
            parts.append({'id': -1, 'title': 'Activity notes', 'category': item['category'],
                          'url': None, 'quiz': None, 'html': f'<p>{escape(note)}</p>'})
        return {'id': item['id'], 'parts': parts}
    return {'id': item['id'], 'parts': [{'id': item['id'], 'title': item['title'],
        'category': item['category'], 'url': None, 'quiz': None,
        'html': f'<p>{escape(note)}</p>' if note else '<p>No material is directly linked to this activity.</p>'}]}


def source_subjects(learner_id, summarize):
    """Recorded learner activities, with full catalogue counts kept separate."""
    owner = profile(learner_id)
    if owner is None:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    courses = query('''SELECT DISTINCT c.id,c.source_course_ref,c.source_course_title,c.curriculum_module_ref
        FROM "Learner".learner_source_course_memberships m
        JOIN curriculum.source_courses c ON c.id=m.source_course_id AND c.deleted_at IS NULL
        WHERE m.learner_id=%s AND m.deleted_at IS NULL AND c.source_system='old_lms'
          AND c.source_course_ref ~ '^[0-9]+$'
        ORDER BY c.source_course_title,c.id''', [owner['id']])
    catalogue = query('''SELECT a.id,a.source_course_id,a.source_activity_id,a.source_activity_kind,
        a.source_activity_title,a.source_activity_type,a.source_section_title,a.curriculum_component_ref,
        c.source_course_ref,c.source_course_title,c.curriculum_module_ref,a.source_position AS position
        FROM curriculum.source_activities a
        JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
        WHERE a.source_course_id=ANY(%s) AND a.deleted_at IS NULL
          AND a.source_system='old_lms'
        ORDER BY c.id,a.source_position NULLS LAST,a.id''', [[c['id'] for c in courses]]) if courses else []
    records = entries_for(owner)
    items, subjects, links = recorded_course_items(courses, catalogue, records)
    result = {'source': 'canonical', 'source_status': 'historical',
        'progress_basis': 'recorded_activities',
        'learner_name': owner['name'], 'aptem_id': owner['aptem_id'],
        'subjects': subjects, **summarize(items)}
    total = round(sum(recorded_seconds(r) for r in records if r.get('accepted') is True) / 3600, 4)
    result.update(recorded_otjh_total=total, audit_lms_actual=total,
        audit_ksb_evidenced=len({k for r in records if r.get('accepted') for k in r['ksbs']}),
        direct_otjh_activities=[])
    result['activity_sources'] = {key: values[0] for key, values in links.items() if len(values) == 1}
    result['activity_source_issues'] = {key: 'ambiguous_lineage' for key, values in links.items() if len(values) != 1}
    result['module_count'] = len(subjects)
    result['unresolved_source_routes'] = sum(len(values) != 1 for values in links.values())
    monthly_targets = targets(learner_id)
    result['audit_tp_planned'] = sum(monthly_targets.values()) if monthly_targets else None
    return result


def recorded_course_items(courses, catalogue, records):
    """Allocate a final record once per course, using exact catalogue lineage.

    Historical/component guesses do not substitute for learner source links.
    A quiz and material sharing a numeric ID remain distinct activities.
    """
    definitions = {(str(d['source_course_ref']), d['source_activity_id']): d for d in catalogue}
    by_course = {str(c['source_course_ref']): [] for c in courses}
    links = {}
    for record in records:
        placements = {}
        for source in record.get('sources') or []:
            key = (str(source.get('source_course_ref')), source.get('source_activity_id'))
            if source.get('source_system') == 'old_lms' and key in definitions:
                placements.setdefault(key[0], definitions[key])
        # Imported journal rows and new attempts retain a typed course/material
        # reference in the consolidated payload. Explicit source links take
        # precedence, even when their course is outside this learner's catalogue.
        has_source_route = any(s.get('source_system') == 'old_lms'
            and s.get('source_course_ref') and s.get('source_activity_id')
            for s in record.get('sources') or [])
        if not has_source_route:
            journals = record.get('journal_routes') or []
            routes = set()
            if journals:
                for journal in journals:
                    group, activity = str(journal.get('group_id') or ''), str(journal.get('activity_id') or '')
                    ref = str(journal.get('source_ref') or '')
                    # The journal's la namespace identifies materials, not
                    # standalone quizzes or attendance with a coincident ID.
                    if group.isdigit() and activity.isdigit() and ref == f'la:{group}:{activity}':
                        routes.add((group, 'material:' + activity))
                    else:
                        routes.add(None)
                key = next(iter(routes)) if len(routes) == 1 else None
                if key is None and None not in routes and len({route[0] for route in routes}) == 1:
                    # A canonical record can merge multiple journal materials
                    # within one course. Retain its documented primary material
                    # and count the canonical hours once, not once per journal row.
                    ref = str(decoded(record.get('source_payload'), {}).get('original_source_ref') or '')
                    match = re.fullmatch(r'la:(\d+):(\d+)', ref)
                    primary = (match[1], 'material:' + match[2]) if match else None
                    key = primary if primary in routes else None
            else:
                ref = str(decoded(record.get('source_payload'), {}).get('original_source_ref') or '')
                match = re.fullmatch(r'la:(\d+):(\d+)', ref)
                key = (match[1], 'material:' + match[2]) if match else None
            if key in definitions:
                placements.setdefault(key[0], definitions[key])
        for course, definition in placements.items():
            kind, _, ident = definition['source_activity_id'].partition(':')
            numeric = ident.isdigit()
            at = local_instant(record.get('reporting_started_at') or record.get('reporting_ended_at'))
            accepted = record.get('accepted') is True
            item = {'activity_id': f"record:{course}:{record['id']}",
                'source_activity_id': int(ident) if numeric else 0, 'group_id': int(course),
                'group_name': definition['source_course_title'],
                'activity': record.get('component_title') or definition['source_activity_title'],
                'category': definition.get('source_activity_type') or kind,
                'catalogue_kind': kind, 'can_open_material': numeric and kind == 'material',
                'section_title': definition.get('source_section_title'),
                'position': definition.get('position') or 0,
                'date': at.date().isoformat() if at else None,
                'month': record.get('reporting_month'), 'date_source': 'consolidated_record',
                'completed': record.get('completed', accepted) is True, 'historical_completed': accepted,
                'actual': recorded_seconds(record) / 3600 if accepted else 0,
                'hours_mapped': accepted and any(p.get('actual_seconds') is not None for p in allocations(record)),
                'planned': record.get('journal_planned_hours', 0),
                'planned_hours_mapped': 'journal_planned_hours' in record, 'has_result': True,
                'status': record.get('activity_status'),
                'quiz_score': float(record['achieved_score']) if record.get('achieved_score') is not None else None,
                'quiz_maximum_score': float(record['total_score']) if record.get('total_score') is not None else None}
            by_course[course].append(item)
            component = definition.get('curriculum_component_ref')
            module = definition.get('curriculum_module_ref')
            if component and module and item['can_open_material']:
                link = {'module_id': module, 'group_id': int(course), 'activity_id': int(ident)}
                if link not in links.setdefault(component, []):
                    links[component].append(link)
    subjects, items = [], []
    for course in courses:
        ref = str(course['source_course_ref'])
        activity = by_course[ref]
        if not activity:
            continue
        subjects.append({'id': int(ref), 'name': course['source_course_title'],
            'module_id': course.get('curriculum_module_ref'),
            'catalogue_count': sum(str(d['source_course_ref']) == ref for d in catalogue),
            'accepted_hours': round(sum(a['actual'] for a in activity), 6)})
        items.extend(activity)
    return items, subjects, links


def metrics_from_records(records, monthly_targets):
    """Count final activity records once, using accepted evidence only for hours.

    KSB points retain the shared activity/code definition; they are not a claim
    that the learner has achieved the entire programme's KSB framework.
    """
    accepted = [item for item in records if item.get('accepted') is True]
    completed = [item for item in records if item.get('completed', item.get('accepted')) is True]
    def ratio(done, total):
        return {'completed': done, 'total': total,
                'percent': round(done / total * 100, 2) if total else None,
                'status': 'ready' if total else 'empty'}
    codes = {}
    for item in records:
        for code in set(item.get('ksbs') or []):
            counts = codes.setdefault(code, [0, 0])
            counts[0] += item.get('accepted') is True
            counts[1] += 1
    actual = round(sum(recorded_seconds(item) for item in accepted) / 3600, 4)
    from learner_api import journal_sources
    planned = round(sum(monthly_targets.values()), 4) if monthly_targets or journal_sources.enabled() else None
    return {
        'migrated': True, 'aptem_planned_total': planned,
        'programme': {**ratio(len(completed), len(records)), 'historicalCompleted': len(accepted)},
        'otjh': {'historical': actual, 'new': 0, 'actual': actual,
                 'completed_actual': actual, 'planned': planned},
        'ksb': {**ratio(sum(v[0] for v in codes.values()), sum(v[1] for v in codes.values())),
                'historicalCompleted': sum(v[0] for v in codes.values()),
                'codes': [{'code': code, **ratio(*counts)} for code, counts in sorted(codes.items())]},
        '_ksb_evidence_sources': [],
    }


def metrics(learner_id):
    """Return the canonical Learner Dashboard metric contract for one learner."""
    return metrics_from_records(entries(learner_id), targets(learner_id))


def metrics_bulk(aptem_by_enrolment):
    """Return the Learner Dashboard metric contract for many Aptem identities.

    This is the batched equivalent of ``metrics``: it uses the same record
    projection and the same calculator, while loading each source table once.
    Callers provide ``{enrolment_id: aptem_id}``; canonical learners are
    resolved only by the stable Aptem bridge and results retain enrolment keys.
    """
    aptem_by_enrolment = {
        int(enrolment_id): int(str(aptem_id).strip())
        for enrolment_id, aptem_id in (aptem_by_enrolment or {}).items()
        if enrolment_id and str(aptem_id or '').strip().isdigit() and int(str(aptem_id).strip()) > 0
    }
    if not aptem_by_enrolment:
        return {}
    aptem_ids = sorted(set(aptem_by_enrolment.values()))
    owners = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.learner_type
        FROM "Learner".learners l
        WHERE l.aptem_id=ANY(%s)''', [aptem_ids])
    counts = Counter(int(owner['aptem_id']) for owner in owners)
    enrolment_by_aptem = {aptem_id: enrolment_id for enrolment_id, aptem_id in aptem_by_enrolment.items()}
    owners = [owner for owner in owners if counts[int(owner['aptem_id'])] == 1]
    if not owners:
        return {}
    canonical_ids = [owner['id'] for owner in owners]
    # Keep each result set bounded: some long-running migrated learners have
    # thousands of progress rows, and one giant caseload result can exceed the
    # database statement timeout even though the SQL is a single bulk read.
    # This remains batched (never one query per learner).
    base = []
    for offset in range(0, len(canonical_ids), 5):
        batch = canonical_ids[offset:offset + 5]
        base.extend(query('''SELECT p.learner_id,jsonb_build_object(
                'id',p.id,'accepted',p.accepted,'kind',p.kind,
                'component_link_source',p.component_link_source,'source_system',p.source_system,
                'actual_seconds',p.actual_seconds,'submitted_at',p.submitted_at,
                'component_ref',p.component_ref,'component_type',p.component_type,
                'passed',p.passed,'quiz_ref',p.quiz_ref,'achieved_score',p.achieved_score,
                'total_score',p.total_score,'reporting_started_at',p.reporting_started_at,
                'reporting_ended_at',p.reporting_ended_at,'reporting_month',p.reporting_month,
                'activity_status',p.activity_status,'source_payload',p.source_payload,
                'claimed_seconds',p.claimed_seconds,'verified_seconds',p.verified_seconds,
                'reported_time',p.reported_time,'expected_otjh',p.expected_otjh
            ) AS payload
            FROM "Learner".learner_progress_entries p
            WHERE p.learner_id=ANY(%s) AND p.deleted_at IS NULL
            ORDER BY p.learner_id,p.reporting_month,p.reporting_started_at NULLS LAST,p.id''', [batch]))
    progress_ids = [decoded(record['payload'], {})['id'] for record in base]
    ksb_rows = query('''SELECT progress_id,ksb_code FROM "Learner".learner_progress_ksbs
        WHERE progress_id=ANY(%s) ORDER BY progress_id,position''', [progress_ids])
    segment_rows = query('''SELECT progress_id,to_jsonb(s) AS payload
        FROM "Learner".learner_activity_reporting_segments s
        WHERE progress_id=ANY(%s) AND learner_id=ANY(%s)
        ORDER BY progress_id,segment_order,id''', [progress_ids, canonical_ids])
    source_rows = query('''SELECT s.canonical_progress_id AS progress_id,jsonb_build_object(
            'source_id',s.id,'source_system',s.source_system,
            'source_activity_id',s.source_activity_id,'source_course_ref',s.source_course_ref
        ) AS payload
        FROM "Learner".learner_activity_sources s
        WHERE s.canonical_progress_id=ANY(%s) AND s.learner_id=ANY(%s) AND s.deleted_at IS NULL
        ORDER BY s.canonical_progress_id,s.id''', [progress_ids, canonical_ids])
    historical_rows = query('''SELECT link.progress_id,to_jsonb(h) AS payload
        FROM "Learner".learner_progress_historical_components link
        JOIN curriculum.historical_components h ON h.id=link.historical_component_ref
          AND h.deleted_at IS NULL AND h.historical_only=true
        WHERE link.progress_id=ANY(%s) ORDER BY link.progress_id,h.id''', [progress_ids])
    related = {progress_id: {'ksbs': [], 'segments': [], 'sources': [], 'historical_components': []}
               for progress_id in progress_ids}
    for item in ksb_rows:
        related[item['progress_id']]['ksbs'].append(item['ksb_code'])
    for field, rows in (('segments', segment_rows), ('sources', source_rows),
                        ('historical_components', historical_rows)):
        for item in rows:
            related[item['progress_id']][field].append(decoded(item['payload'], {}))
    records_by_learner = {int(owner['id']): [] for owner in owners}
    for record in base:
        payload = decoded(record['payload'], {})
        records_by_learner[int(record['learner_id'])].append({**payload, **related[payload['id']]})
    submissions = query('''SELECT learner_id,id,component_ref,progress_entry_id,status,actual_time_hours,
        submitted_at,activity_type,activity_title,module_title,ksb_codes,
        full_submission->>'submissionOrigin' = 'imported_legacy' AS imported
        FROM "Learner".learning_reflection_submissions
        WHERE learner_id=ANY(%s) AND activity_type IN ('assignment','extra_activity')
        ORDER BY learner_id,submitted_at NULLS FIRST,id''', [[str(value) for value in aptem_by_enrolment]])
    submissions_by_enrolment = {}
    for item in submissions:
        submissions_by_enrolment.setdefault(str(item['learner_id']), []).append(item)
    attempts_by_enrolment = {}
    relation = query('SELECT to_regclass(%s) AS name', ['"Learner".subject_activity_attempts'])
    if relation and relation[0].get('name'):
        attempts = query('''SELECT enrolment_id,group_id,activity_id,bool_or(completed) AS completed,
            max(score_percent) AS best_percent,max(submitted_at) AS submitted_at,
            max(definition->>'title') AS title
            FROM "Learner".subject_activity_attempts
            WHERE enrolment_id=ANY(%s) AND submitted_at IS NOT NULL
            GROUP BY enrolment_id,group_id,activity_id''', [list(aptem_by_enrolment)])
        for item in attempts:
            attempts_by_enrolment.setdefault(int(item['enrolment_id']), []).append(item)
    target_rows = query('''SELECT learner_id,report_month,target_hours
        FROM "Learner".learner_monthly_targets WHERE learner_id=ANY(%s)''', [canonical_ids])
    targets_by_learner = {}
    for item in target_rows:
        if item.get('target_hours') is not None:
            targets_by_learner.setdefault(int(item['learner_id']), {})[item['report_month']] = float(item['target_hours'])
    result = {}
    for owner in owners:
        enrolment_id = enrolment_by_aptem[int(owner['aptem_id'])]
        records = records_by_learner[int(owner['id'])]
        learner_submissions = submissions_by_enrolment.get(str(enrolment_id), [])
        markings = {str(item['component_ref']): item for item in learner_submissions if item.get('component_ref')}
        records = merge_submissions(project_current(records, markings), learner_submissions)
        if owner.get('aptem_id'):
            records = merge_attempts(records, attempts_by_enrolment.get(enrolment_id, []))
        result[enrolment_id] = metrics_from_records(records, targets_by_learner.get(int(owner['id']), {}))
    return result


def overlay_subjects(payload, records, summarize):
    """Use canonical progress, retaining owned course/material definitions.

    Match explicit namespaced course/activity lineage or a verified Curriculum
    component. Titles and unscoped numeric IDs are not links.
    """
    component_placements = {}
    for item in payload['activities']:
        if item.get('curriculum_component_ref'):
            component_placements.setdefault(item['curriculum_component_ref'], set()).add(
                (int(item['group_id']), int(item['source_activity_id'])))
    mapped = {}
    for record in records:
        keys = set()
        component = record.get('curriculum_component_ref') or record.get('component_ref')
        candidates = component_placements.get(component, set())
        if len(candidates) == 1:
            keys.update(candidates)
        for link in [*(record.get('sources') or []), *(record.get('historical_components') or [])]:
            course = str(link.get('source_course_ref') or '')
            activity = re.fullmatch(r'material:(\d+)', str(link.get('source_activity_id') or ''))
            if link.get('source_system') == 'old_lms' and course.isdigit() and activity:
                keys.add((int(course), int(activity[1])))
            component = link.get('component_ref') or link.get('curriculum_component_ref')
            candidates = component_placements.get(component, set())
            if len(candidates) == 1:
                keys.update(candidates)
        source = decoded(record.get('source_payload'), {})
        match = re.fullmatch(r'la:(\d+):(\d+)', str(source.get('original_source_ref') or ''))
        key = (int(match[1]), int(match[2])) if match else None
        if not keys and key:
            keys.add(key)
        for key in keys:
            mapped.setdefault(key, []).append(record)
    items = []
    for original in payload['activities']:
        item = dict(original)
        matches = mapped.get((int(item['group_id']), int(item['source_activity_id'])), [])
        # Definitions remain available for learning, but imported results must
        # not override the final consolidated status/hours for this rollout.
        item.update(completed=False, historical_completed=False, has_result=bool(matches),
                    actual=0, hours_mapped=False, quiz_score=None, quiz_maximum_score=None,
                    best_score_percent=None, status='Not started')
        if matches:
            latest = max(matches, key=lambda r: (r.get('reporting_month') or '',
                         str(r.get('reporting_ended_at') or r.get('reporting_started_at') or ''), str(r['id'])))
            accepted = [r for r in matches if r.get('accepted') is True]
            recorded = [r for r in accepted if any(part.get('actual_seconds') is not None for part in allocations(r))]
            at = local_instant(latest.get('reporting_started_at') or latest.get('reporting_ended_at'))
            item.update(completed=any(r.get('completed', r.get('accepted')) is True for r in matches), historical_completed=bool(accepted),
                        actual=sum(recorded_seconds(r) for r in recorded) / 3600,
                        hours_mapped=bool(recorded), status=latest.get('activity_status'),
                        month=latest.get('reporting_month'), date=at.date().isoformat() if at else None,
                        date_source='consolidated_record', week_start=None, week_end=None)
            if item['completed']:
                item['status'] = 'Completed'
            if latest.get('achieved_score') is not None:
                item.update(quiz_score=float(latest['achieved_score']),
                            quiz_maximum_score=float(latest['total_score']) if latest.get('total_score') is not None else None)
        items.append(item)
    result = {**payload, **summarize(items)}
    total = sum(recorded_seconds(r) for r in records if r.get('accepted') is True) / 3600
    result.update(recorded_otjh_total=round(total, 4), audit_lms_actual=round(total, 4),
                  audit_tp_planned=None, audit_ksb_evidenced=len({k for r in records if r.get('accepted') for k in r['ksbs']}),
                  direct_otjh_activities=[])
    return result
