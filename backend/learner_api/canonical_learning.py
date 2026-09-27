"""Scoped rollout of the consolidated learning record.

Source snapshots are lineage, not additional hours. Reads never sync, run AI,
repair data, or create records. The rollout is limited to verified identities.
"""
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo
import re

from old_otjh.repository import query
from old_otjh.service import ServiceError
from .monthly_log_sources import decoded, number, row

PILOT_IDENTITIES = {
    '271': (510, 3582, 'PROG-ME-L4'),
    '234': (536, 4691, 'PROG-20260907141619067932'),
}
UK = ZoneInfo('Europe/London')


def enabled(learner_id):
    return str(learner_id) in PILOT_IDENTITIES


def profile(learner_id):
    if not enabled(learner_id):
        return None
    profile_id, aptem_id, programme_id = PILOT_IDENTITIES[str(learner_id)]
    records = query('''SELECT id,enrolment_id,aptem_id,programme_id,full_name AS name,
        programme,coach_name,coach_email,email,start_date,end_date,learner_type
        FROM "Learner".learners WHERE id=%s AND enrolment_id=%s
          AND aptem_id=%s AND programme_id=%s''',
        [profile_id, int(learner_id), aptem_id, programme_id])
    if len(records) != 1:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return records[0]


def entries(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return []
    records = query('''SELECT to_jsonb(p) AS payload,
        coalesce((SELECT jsonb_agg(k.ksb_code ORDER BY k.position)
          FROM "Learner".learner_progress_ksbs k WHERE k.progress_id=p.id),'[]'::jsonb) AS ksbs
        FROM "Learner".learner_progress_entries p
        WHERE p.learner_id=%s AND p.enrolment_id=%s AND p.aptem_id=%s
          AND p.programme_id=%s AND p.deleted_at IS NULL
        ORDER BY p.reporting_month,p.reporting_started_at NULLS LAST,p.id''',
        [owner['id'], owner['enrolment_id'], owner['aptem_id'], owner['programme_id']])
    return [{**decoded(record['payload'], {}), 'ksbs': decoded(record['ksbs'], [])} for record in records]


def local_instant(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value.astimezone(UK) if value else None


def activity_rows(learner_id):
    if not enabled(learner_id):
        return []
    result = []
    for entry in entries(learner_id):
        source = decoded(entry.get('source_payload'), {})
        at = local_instant(entry.get('reporting_started_at') or entry.get('reporting_ended_at'))
        item = row(f"canonical:{entry['id']}", at, entry.get('component_title'),
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
    by_id = {item['progress_id']: item for item in result}
    documents = query('''SELECT id,progress_id,display_name,content_type
        FROM "Learner".learner_activity_documents
        WHERE learner_id=%s AND deleted_at IS NULL ORDER BY id''', [PILOT_IDENTITIES[str(learner_id)][0]])
    for document in documents:
        item = by_id.get(document['progress_id'])
        if item is not None:
            item['documents'].append({'id': document['id'], 'display_name': document['display_name'],
                'content_type': document['content_type'],
                'url': f"/learner_api/monthly-logs/{learner_id}/canonical-documents/{document['id']}/"})
    return result


def targets(learner_id):
    owner = profile(learner_id)
    return {record['report_month']: float(record['target_hours']) for record in query('''
        SELECT report_month,target_hours FROM "Learner".learner_monthly_targets
        WHERE learner_id=%s AND programme_id=%s''', [owner['id'], owner['programme_id']])}


def signatures(learner_id):
    owner = profile(learner_id)
    return query('''SELECT report_month,signer_role,signer_name,signed_at,snapshot_digest AS snapshot_hash,
        coalesce(signature_url,signature_data) AS url
        FROM "Learner".learner_monthly_signatures
        WHERE learner_id=%s AND review_confirmed IS TRUE ORDER BY signed_at DESC,id DESC''', [owner['id']])


def content(item):
    note = item.get('completion_note')
    return {'id': item['id'], 'parts': [{'id': item['id'], 'title': item['title'],
        'category': item['category'], 'url': None, 'quiz': None,
        'html': f'<p>{escape(note)}</p>' if note else '<p>No additional activity text was recorded.</p>'}]}


def metrics(learner_id):
    """Count final activity records once, using accepted evidence only for hours.

    KSB points retain the shared activity/code definition; they are not a claim
    that the learner has achieved the entire programme's KSB framework.
    """
    records = entries(learner_id)
    accepted = [item for item in records if item.get('accepted') is True]
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
    actual = round(sum(number(item.get('actual_seconds')) for item in accepted) / 3600, 4)
    monthly_targets = targets(learner_id)
    planned = round(sum(monthly_targets.values()), 4) if monthly_targets else None
    return {
        'migrated': True, 'aptem_planned_total': planned,
        'programme': {**ratio(len(accepted), len(records)), 'historicalCompleted': len(accepted)},
        'otjh': {'historical': actual, 'new': 0, 'actual': actual,
                 'completed_actual': actual, 'planned': planned},
        'ksb': {**ratio(sum(v[0] for v in codes.values()), sum(v[1] for v in codes.values())),
                'historicalCompleted': sum(v[0] for v in codes.values()),
                'codes': [{'code': code, **ratio(*counts)} for code, counts in sorted(codes.items())]},
        '_ksb_evidence_sources': [],
    }


def overlay_subjects(payload, records, summarize):
    """Use canonical progress, retaining owned course/material definitions.

    Match only explicit course/activity lineage or a unique source component
    placement. Titles, display order and numeric suffix guesses are not links.
    """
    placements = {}
    for item in payload['activities']:
        placements.setdefault(int(item['source_activity_id']), set()).add(int(item['group_id']))
    mapped = {}
    for record in records:
        source = decoded(record.get('source_payload'), {})
        match = re.fullmatch(r'la:(\d+):(\d+)', str(source.get('original_source_ref') or ''))
        key = (int(match[1]), int(match[2])) if match else None
        if key is None and record.get('source_system') == 'old_lms':
            component = source.get('component_id')
            if str(component or '').isdigit() and len(placements.get(int(component), ())) == 1:
                key = (next(iter(placements[int(component)])), int(component))
        if key:
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
                         str(r.get('reporting_ended_at') or r.get('reporting_started_at') or ''), r['id']))
            accepted = [r for r in matches if r.get('accepted') is True]
            recorded = [r for r in accepted if r.get('actual_seconds') is not None]
            at = local_instant(latest.get('reporting_started_at') or latest.get('reporting_ended_at'))
            item.update(completed=bool(accepted), historical_completed=bool(accepted),
                        actual=sum(number(r['actual_seconds']) for r in recorded) / 3600,
                        hours_mapped=bool(recorded), status=latest.get('activity_status'),
                        month=latest.get('reporting_month'), date=at.date().isoformat() if at else None,
                        date_source='consolidated_record', week_start=None, week_end=None)
            if latest.get('achieved_score') is not None:
                item.update(quiz_score=float(latest['achieved_score']),
                            quiz_maximum_score=float(latest['total_score']) if latest.get('total_score') is not None else None)
        items.append(item)
    result = {**payload, **summarize(items)}
    total = sum(number(r.get('actual_seconds')) for r in records if r.get('accepted') is True) / 3600
    result.update(recorded_otjh_total=round(total, 4), audit_lms_actual=round(total, 4),
                  audit_tp_planned=None, audit_ksb_evidenced=len({k for r in records if r.get('accepted') for k in r['ksbs']}),
                  direct_otjh_activities=[])
    return result
