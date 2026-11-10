"""Display reviewed old-LMS content links without changing historical learning facts.

The import-source marker is written only by the scoped recovery operation. It
grants access to one original material through an owned historical progress
record, not membership of the material's entire course.
"""
import re
from urllib.parse import urlsplit

from old_otjh.repository import query
from .monthly_log_sources import decoded
from .source_material_content import hydrate_material, material_quiz_definition


def reference(record):
    if record.get('source_system') != 'old_lms' or record.get('component_type') != 'old_lms_recovered':
        return None
    match = re.fullmatch(r'old_lms:actual:(reading_quiz|media):([1-9]\d*):(\d{4}-\d{2})',
                         str(record.get('source_activity_id') or ''))
    payload = decoded(record.get('source_payload'), {})
    old = payload.get('old_schema') if isinstance(payload, dict) else None
    if not match or not isinstance(old, dict):
        return None
    kind = 'video' if match[1] == 'media' else 'reading_quiz'
    if (record.get('kind') != kind or old.get('kind') != kind
            or str(old.get('ref')) != match[2] or old.get('month') != match[3]):
        return None
    return int(match[2])


def linked_materials(owner, records, *, content=False):
    expected = {str(record['id']): reference(record) for record in records
                if str(record.get('id', '')).isdigit() and reference(record) is not None}
    if not expected:
        return {}
    columns = '''m.payload AS material_payload,
        s.source_payload->'recovered_content'->'material_snapshot' AS recovered_snapshot,
        m.content_type AS material_content_type,
        m.video_iframe_url AS material_video_url,m.reading_iframe_url AS material_reading_url,
        m.audio_iframe_url AS material_audio_url,m.source_url AS material_source_url,
        m.backup_status AS material_backup_status,m.blob_container AS material_blob_container,
        m.blob_name AS material_blob_name,m.blob_content_type AS material_blob_content_type,
        m.source_metadata->>'azure_storage_account' AS material_blob_account,''' if content else ''
    rows = query(f'''SELECT DISTINCT p.id AS progress_id,m.id AS material_record_id,m.material_id,
        {columns} m.title AS material_title
        FROM "Learner".learner_progress_entries p
        JOIN "Learner".learner_activity_sources s ON s.canonical_progress_id=p.id
          AND s.learner_id=p.learner_id AND s.source_system='old_lms' AND s.deleted_at IS NULL
          AND s.source_activity_id=p.source_activity_id
          AND s.source_payload->'old_schema'=p.source_payload->'old_schema'
        JOIN curriculum.source_materials m ON m.source_system='old_lms' AND m.deleted_at IS NULL
          AND m.material_id::text=p.source_payload->'old_schema'->>'ref'
          AND m.material_id::text=s.source_payload->'recovered_content'->>'material_id'
        WHERE p.learner_id=%s AND p.id=ANY(%s) AND p.deleted_at IS NULL
          AND p.source_system='old_lms' AND p.component_type='old_lms_recovered'
          AND s.source_payload->'recovered_content'->>'version'='1'
          AND s.source_payload->'recovered_content'->>'basis'='verified-old-schema-reference'
          AND s.source_payload->'recovered_content'->>'original_source_ref'=p.source_activity_id''',
        [owner['id'], [int(ident) for ident in expected]])
    by_id = {}
    ambiguous = set()
    for row in rows:
        ident = str(row['progress_id'])
        if expected.get(ident) != row['material_id']:
            continue
        if ident in by_id:
            ambiguous.add(ident)
        by_id[ident] = row
    return {ident: row for ident, row in by_id.items() if ident not in ambiguous}


def titles(owner, records):
    return {ident: row['material_title'] for ident, row in linked_materials(owner, records).items()
            if isinstance(row['material_title'], str) and row['material_title'].strip()}


def safe_url(value):
    if not isinstance(value, str) or any(ord(char) < 32 for char in value):
        return None
    value = value.strip()
    try:
        parsed = urlsplit(value)
        if parsed.scheme in {'https', 'http'} and parsed.hostname and not parsed.username and not parsed.password:
            return value
    except ValueError:
        pass
    return None


def content_payload(material):
    """Use a reviewed original schema only for missing content of the same quiz."""
    payload = dict(decoded(material.get('material_payload'), {}) or {})
    snapshot = decoded(material.get('recovered_snapshot'), {})
    if (not isinstance(snapshot, dict) or snapshot.get('version') != 1
            or snapshot.get('source') != 'old-lms-material-schema'
            or snapshot.get('material_id') != material['material_id']):
        return payload
    quiz = payload.get('quiz') if isinstance(payload.get('quiz'), dict) else {}
    quiz_id = quiz.get('quiz_id') or payload.get('quiz_id')
    if not snapshot.get('quiz_id') or (quiz_id and str(quiz_id) != str(snapshot['quiz_id'])):
        return payload
    if not material_quiz_definition(payload):
        payload['quiz_questions'] = snapshot.get('quiz_questions') or []
        payload['quiz_body'] = payload.get('quiz_body') or snapshot.get('quiz_body') or ''
    if not any(payload.get(key) for key in ('reading_text_body', 'text_body', 'html_body')):
        payload['reading_text_body'] = snapshot.get('reading_text_body') or ''
    return payload


def saved_question_html(owner, material_id):
    """Recover question text from one owned, unambiguous group/attempt only.

    This is content review: no scores, grading keys or reconstructed answers
    become a new attempt. Multiple groups require explicit historical routing.
    """
    rows = query('''SELECT DISTINCT history.group_id,history.quiz_answers,
            history.quiz_score,history.quiz_maximum_score,history.quiz_attempt_number
        FROM "Learner".learner_external_identities identity
        JOIN "Last_audit".activity_results history
          ON history.learner_id::text=identity.source_learner_id AND history.activity_id=%s
        WHERE identity.learner_id=%s AND identity.source_system='old_lms'
          AND identity.deleted_at IS NULL
        ORDER BY history.quiz_score DESC NULLS LAST,history.quiz_attempt_number DESC NULLS LAST''',
        [material_id, owner['id']])
    if not rows or any(row.get('group_id') is None for row in rows) or len({row['group_id'] for row in rows}) != 1:
        return None
    # Retain one source attempt; never combine questions from different attempts.
    rows.sort(key=lambda row: (
        float(row.get('quiz_score') or 0) / float(row.get('quiz_maximum_score') or 1),
        int(row.get('quiz_attempt_number') or 0)), reverse=True)
    for row in rows:
        answers = decoded(row.get('quiz_answers'), [])
        if not isinstance(answers, list):
            continue
        bodies = [answer.get('question_body') or answer.get('question_text') for answer in answers
                  if isinstance(answer, dict)]
        bodies = [body for body in bodies if isinstance(body, str) and body.strip()]
        if bodies:
            # The shared HTML viewer sanitizes this authored HTML in a sandbox.
            return '<h2>Original questions from the saved activity</h2><ol>' + ''.join(
                '<li>' + body + '</li>' for body in bodies) + '</ol>'
    return None


def material_parts(item, owner, record):
    material = linked_materials(owner, [record], content=True).get(str(record.get('id')))
    if material is None:
        return []
    material = {**material, 'material_payload': content_payload(material)}
    hydrated = hydrate_material(dict(material))
    definition = material_quiz_definition(material['material_payload'])
    reading = hydrated.get('reading_text_body') or None
    description = hydrated.get('quiz_body')
    if isinstance(description, str) and description.strip():
        if definition:
            definition = {**definition, 'description': description}
        else:
            reading = (reading or '') + '<h2>Original quiz description</h2>' + description
            reading += '<p>The original quiz questions are not currently available.</p>'
    if not definition and record.get('kind') == 'reading_quiz':
        saved_questions = saved_question_html(owner, material['material_id'])
        if saved_questions:
            reading = (hydrated.get('reading_text_body') or '') + (description or '') + saved_questions
    url = next((safe_url(hydrated.get(key)) for key in ('video_iframe_url', 'audio_url', 'reading_iframe_url')
                if safe_url(hydrated.get(key))), None)
    content_type = None
    if hydrated.get('_material_blob_ready'):
        from django.conf import settings
        from .material_storage import read_url
        from old_otjh.service import ServiceError
        try:
            url = read_url(material, settings)
        except ValueError as error:
            raise ServiceError('Material storage is temporarily unavailable.', 'storage_unavailable', 503) from error
        content_type = material.get('material_blob_content_type')
    part = {'id': material['material_record_id'], 'title': material['material_title'] or item['title'],
            'category': item['category'], 'content_type': content_type, 'url': url, 'html': reading,
            'quiz': {'state': 'unavailable', 'attempt': None, 'answers_available': False, 'definition': definition}
                    if definition else None}
    if not url and not reading and not definition:
        part['html'] = '<p>The original activity is identified, but its content is not currently available.</p>'
    return [part]
