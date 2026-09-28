"""Read current LMS saves alongside consolidated records; never write or sync."""
from datetime import datetime
import json
from zoneinfo import ZoneInfo

from old_otjh.repository import query
from .active_users import completed_hours_value_from_progress
from .progress_rules import progress_counts_as_achieved


def instant(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value.astimezone(ZoneInfo('Europe/London')) if value else None


def project_current(records, markings):
    """Project unsynchronised direct saves using the existing time/pass rules.

    Imported/normalised seconds (including zero) and reporting segments remain
    authoritative. Planned duration is never substituted for recorded time.
    """
    result, native = [], {}
    retained = {source_reference(p) for p in records if p.get('source_system')}
    for original in records:
        p = dict(original)
        if (p.get('component_link_source') not in {'direct', 'quiz_ref'}
                or p.get('source_system') or p.get('actual_seconds') is not None
                or p.get('segments')):
            result.append(p)
            continue
        if p.get('kind') == 'activity_event' or not p.get('submitted_at'):
            continue
        if f"progress:{p['id']}" in retained:
            continue
        at = instant(p['submitted_at'])
        accepted = progress_counts_as_achieved(p.get('kind'), p.get('passed'))
        timing = {k: v for k, v in p.items() if k not in {'expected_otjh', 'expectedOtjh'}}
        seconds = completed_hours_value_from_progress([timing]) * 3600
        component = p.get('component_ref')
        marking = markings.get(str(component))
        if p.get('component_type') == 'assignment':
            accepted = bool(marking and marking.get('status') in {'accepted', 'partial'})
            if marking and marking.get('actual_time_hours') is not None:
                seconds = float(marking['actual_time_hours']) * 3600
        p.update(accepted=accepted, completed=accepted, actual_seconds=seconds,
                 reporting_month=at.strftime('%Y-%m'), reporting_started_at=at,
                 reporting_ended_at=at, activity_status='Completed' if accepted else 'Submitted')
        # Same component/quiz retries are one activity, not extra earned hours.
        key = ('quiz', p['quiz_ref']) if p.get('quiz_ref') else ('component', component) if component else ('entry', p['id'])
        previous = native.get(key)
        if previous is None or (accepted, seconds, str(at), str(p['id'])) > (
                previous['accepted'], previous['actual_seconds'], str(previous['reporting_ended_at']), str(previous['id'])):
            native[key] = p
    return result + list(native.values())


def source_reference(record):
    payload = record.get('source_payload') or {}
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload.get('original_source_ref')


def merge_attempts(records, attempts):
    """Use saved course attempts for completion, never manufacture their hours."""
    result = [dict(p) for p in records]
    for attempt in attempts:
        ref = f"la:{attempt['group_id']}:{attempt['activity_id']}"
        matches = []
        for p in result:
            linked = source_reference(p) == ref or any(
                link.get('source_system') == 'old_lms'
                and str(link.get('source_course_ref')) == str(attempt['group_id'])
                and link.get('source_activity_id') == f"material:{attempt['activity_id']}"
                for link in [*(p.get('sources') or []), *(p.get('historical_components') or [])])
            if linked:
                matches.append(p)
        if not matches:
            at = instant(attempt['submitted_at'])
            matches = [{'id': f"subject:{attempt['group_id']}:{attempt['activity_id']}",
                'component_title': attempt.get('title'), 'kind': 'quiz', 'accepted': False,
                'actual_seconds': None, 'ksbs': [], 'sources': [], 'segments': [],
                'source_payload': {'original_source_ref': ref},
                'reporting_month': at.strftime('%Y-%m'), 'reporting_started_at': at}]
            result.extend(matches)
        for p in matches:
            p['completed'] = bool(p.get('completed', p.get('accepted')) or attempt['completed'])
            if attempt.get('best_percent') is not None:
                maximum = p.get('total_score')
                old = float(p['achieved_score']) / float(maximum) * 100 if maximum and p.get('achieved_score') is not None else None
                p['achieved_score'] = max(float(attempt['best_percent']), old) if old is not None else float(attempt['best_percent'])
                p['total_score'] = 100
    return result


def merge_submissions(records, submissions):
    result = list(records)
    ids = {str(p['id']) for p in records}
    components = {str(p.get('component_ref')) for p in records if p.get('component_ref')}
    retained = {source_reference(p) for p in records}
    for s in submissions:
        if (s.get('imported') or f"reflection:{s['id']}" in retained
                or str(s.get('progress_entry_id')) in ids
                or (s.get('component_ref') and str(s['component_ref']) in components)):
            continue
        at = instant(s.get('submitted_at'))
        if at is None or s.get('status') == 'draft':
            continue
        accepted = s.get('status') in {'accepted', 'partial'}
        codes = s.get('ksb_codes') or []
        if isinstance(codes, str):
            codes = json.loads(codes)
        result.append({'id': f"reflection:{s['id']}", 'component_title': s.get('activity_title'),
            'component_ref': s.get('component_ref'), 'module_title': s.get('module_title'),
            'kind': s['activity_type'], 'accepted': accepted, 'completed': accepted,
            'actual_seconds': float(s['actual_time_hours']) * 3600 if s.get('actual_time_hours') is not None else None,
            'reporting_month': at.strftime('%Y-%m'), 'reporting_started_at': at,
            'activity_status': s.get('status'), 'ksbs': codes, 'sources': [], 'segments': [],
            'source_payload': {'original_source_ref': f"reflection:{s['id']}"}})
    return result


def current_records(owner, records):
    submissions = query('''SELECT id,component_ref,progress_entry_id,status,actual_time_hours,
        submitted_at,activity_type,activity_title,module_title,ksb_codes,
        full_submission->>'submissionOrigin' = 'imported_legacy' AS imported
        FROM "Learner".learning_reflection_submissions
        WHERE learner_id=%s AND learner_kind=%s AND activity_type IN ('assignment','extra_activity')
        ORDER BY submitted_at NULLS FIRST,id''', [str(owner['enrolment_id']), owner.get('learner_type')])
    markings = {str(s['component_ref']): s for s in submissions if s.get('component_ref')}
    projected = merge_submissions(project_current(records, markings), submissions)
    if not owner.get('aptem_id') or not query('SELECT to_regclass(%s) AS name',
            ['"Learner".subject_activity_attempts'])[0]['name']:
        return projected
    attempts = query('''SELECT group_id,activity_id,bool_or(completed) AS completed,
        max(score_percent) AS best_percent,max(submitted_at) AS submitted_at,
        max(definition->>'title') AS title
        FROM "Learner".subject_activity_attempts
        WHERE enrolment_id=%s AND aptem_id=%s AND submitted_at IS NOT NULL
        GROUP BY group_id,activity_id''', [owner['enrolment_id'], owner['aptem_id']])
    return merge_attempts(projected, attempts)
