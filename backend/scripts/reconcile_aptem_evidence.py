"""Preview/apply an explicitly selected learner's missing imported Aptem evidence.

No Django startup, external calls, journal edits, or existing progress rewrites.
Application requires the fingerprint returned by a read-only preview. Ambiguous
attendance dates are retained as source evidence without adding counted hours.
"""
import argparse
from collections import Counter
from datetime import datetime, time, timedelta
from decimal import Decimal
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo('Europe/London')
CONTAINER = 'fetch-aptem-evidences'


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def ids(value):
    return sorted({int(part) for part in value.split(',') if part.strip()})


def plan_evidence(evidence, journals, assignments, attendance, attendance_start_time=None):
    """Resolve exact evidence references first; never match attendance by title."""
    if evidence['evidence_status'] != 'Accepted':
        raise ValueError('Only reviewed Accepted evidence is supported by this repair.')
    seconds = Decimal(str(evidence['spent_time'])) * 60
    if seconds < 0 or seconds != seconds.to_integral_value():
        raise ValueError('Evidence duration must be nonnegative whole seconds.')
    if seconds and (evidence['hours_type'] != 'OffTheJobTraining'
                    or evidence['spent_time_type'] != 'PaidWorkingHours'):
        raise ValueError('Nonzero time requires verified paid OTJ evidence.')
    component = evidence['component_id']
    at = evidence.get('completed_date_override') or evidence.get('completed_date') or evidence.get('submission_date')
    if not isinstance(at, datetime) or at.tzinfo is None:
        raise ValueError('Evidence needs an explicit timezone-aware reporting date.')
    day = at.astimezone(UK).date()
    if component in assignments:
        kind = 'assignment'
        ref = f"asg:{component}:evidence:{evidence['evidence_id']}"
        matches = [j for j in journals if j.get('source_ref') == ref]
        if not matches:
            raise ValueError('Assignment has no exact journal reference; review before importing.')
    elif component in attendance:
        kind = 'attendance'
        matches = [j for j in journals if j['category'] == kind and j['activity_date'] == day]
        # Historical duplicates can have an active replacement. Never revive a
        # deleted row or silently select between multiple active records.
        active = [j for j in matches if j['deleted_at'] is None]
        if active:
            matches = active
    else:
        raise ValueError('Component type has not been explicitly verified.')
    # Aptem attendance timestamps are date-only values stored at 23:00 UTC.
    # When the module timetable is known, anchor the counted interval to the
    # real London session start instead of creating a midnight activity.
    if kind == 'attendance' and attendance_start_time is not None:
        at = datetime.combine(day, attendance_start_time, tzinfo=UK)
    if len(matches) > 1:
        raise ValueError('Multiple journal matches require review.')
    if matches and matches[0]['deleted_at'] is not None:
        raise ValueError('Matched journal row is deleted; historical deletion must be preserved.')
    match = matches[0] if matches else None
    if match:
        if match['category'] != kind:
            raise ValueError('Journal category conflicts with verified activity type.')
        if match.get('progress_id') is None:
            raise ValueError('Matched journal row has no progress link.')
        resolution = 'existing_journal'
        added = 0
    else:
        nearby = [j for j in journals if j['category'] == 'attendance'
                  and j['deleted_at'] is None and j.get('activity_date')
                  and abs((j['activity_date'] - day).days) <= 3]
        resolution = 'date_review_required' if nearby else 'new_attendance'
        added = 0 if nearby else int(seconds)
    # The source evidence always retains a complete interval, including when
    # it links to an existing journal progress row and therefore adds no hours.
    end_at = at + timedelta(seconds=int(seconds)) if kind == 'attendance' and seconds else None
    return {
        'evidence_id': evidence['evidence_id'], 'kind': kind,
        'resolution': resolution, 'source_seconds': int(seconds),
        'added_seconds': added, 'at': at, 'month': day.strftime('%Y-%m'),
        'end_at': end_at,
        'progress_id': match['progress_id'] if match else None,
        'journal_id': match['id'] if match else None,
        'journal_seconds': int(Decimal(str(match['actual_hours'])) * 3600) if match else None,
    }


def read_state(cur, aptem_id, evidence_ids):
    owners = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id FROM "Learner".learners WHERE aptem_id=%s', [aptem_id]).fetchall()
    if len(owners) != 1:
        raise ValueError('Expected one canonical learner.')
    owner = owners[0]
    evidence = cur.execute('''SELECT evidence_id,learner_id,component_id,component_name,
        evidence_kind,evidence_name,evidence_status,spent_time,hours_type,spent_time_type,
        completed_date_override,completed_date,submission_date,source_fetched_at,source_synced_at,
        file_blob,note_blob,report_blob,note_content,evidence_raw,ksb_codes
        FROM fetching_evidence.evidence_items
        WHERE learner_id=%s AND evidence_id=ANY(%s) ORDER BY evidence_id''', [aptem_id, evidence_ids]).fetchall()
    if [e['evidence_id'] for e in evidence] != evidence_ids:
        raise ValueError('Selected evidence does not all belong to this learner.')
    journals = cur.execute('SELECT * FROM "Learner".learner_journal_rows WHERE canonical_learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    progress = cur.execute('SELECT * FROM "Learner".learner_progress_entries WHERE learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    sources = cur.execute('SELECT * FROM "Learner".learner_activity_sources WHERE learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    documents = cur.execute('SELECT * FROM "Learner".learner_activity_documents WHERE learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    segments = cur.execute('SELECT * FROM "Learner".learner_activity_reporting_segments WHERE learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    return dict(owner=owner, evidence=evidence, journals=journals, progress=progress,
                sources=sources, documents=documents, segments=segments)


def make_plan(state, assignments, attendance, attendance_start_time=None):
    if assignments & attendance:
        raise ValueError('Component types must be disjoint.')
    plans = []
    progress = {p['id']: p for p in state['progress'] if p['deleted_at'] is None}
    for e in state['evidence']:
        if e.get('ksb_codes') is not None and not isinstance(e['ksb_codes'], list):
            raise ValueError('Evidence KSB metadata must be a list.')
        existing = [s for s in state['sources'] if s['source_system'] == 'aptem'
                    and (s['source_activity_id'] == f"evidence:{e['evidence_id']}"
                         or str(s['source_payload'].get('Id')) == str(e['evidence_id']))]
        if existing:
            if len(existing) != 1 or existing[0]['deleted_at'] is not None:
                raise ValueError('Existing duplicate/deleted source requires review.')
            present = {'evidence_id': e['evidence_id'], 'resolution': 'already_present', 'added_seconds': 0}
            if (existing[0].get('canonical_progress_id') is None
                    and existing[0]['source_payload'].get('reconciliation', {}).get('resolution') == 'date_review_required'):
                present['review_required'] = True
            plans.append(present)
            continue
        p = plan_evidence(e, state['journals'], assignments, attendance, attendance_start_time)
        if p['progress_id'] is not None and p['progress_id'] not in progress:
            raise ValueError('Journal progress owner/deletion mismatch.')
        if p['resolution'] == 'new_attendance':
            # A non-journal source can already represent this component/date.
            for source in state['sources']:
                source_at = source.get('reporting_started_at')
                if (source['deleted_at'] is None
                        and str(source['source_payload'].get('ComponentId')) == str(e['component_id'])
                        and source_at and source_at.astimezone(UK).date() == p['at'].astimezone(UK).date()):
                    raise ValueError('Non-journal activity already covers this date; review overlap.')
                source_end = source.get('reporting_ended_at')
                if (source['deleted_at'] is None and source_at and source_end
                        and max(source_at, p['at']) < min(source_end, p['end_at'])):
                    raise ValueError('Non-journal activity overlaps this attendance window; review overlap.')
        plans.append(p)
    return plans


def summary(state, plans):
    segments = {}
    for s in state['segments']:
        segments[s['progress_id']] = segments.get(s['progress_id'], 0) + s['actual_seconds']
    before = sum(segments.get(p['id'], p['actual_seconds'] or 0)
                 for p in state['progress'] if p['deleted_at'] is None and p['accepted'])
    added = sum(p['added_seconds'] for p in plans)
    return {'resolutions': dict(Counter(p['resolution'] for p in plans)),
            'source_minutes': str(sum(Decimal(str(e['spent_time'])) for e in state['evidence'])),
            'accepted_seconds_before': before, 'added_seconds': added,
            'accepted_seconds_after': before + added,
            'journal_hours_preserved': str(sum(j['actual_hours'] for j in state['journals']
                                              if j['deleted_at'] is None and j['accepted'])),
            'journal_hour_disagreements_preserved': sum(p.get('journal_seconds') is not None
                and p['journal_seconds'] != p['source_seconds'] for p in plans),
            'review_evidence_ids': [p['evidence_id'] for p in plans
                                    if p['resolution'] == 'date_review_required' or p.get('review_required')]}


def insert(cur, table, values):
    # Table and column names are exclusively supplied by this module.
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, values)),
        sql.SQL(',').join(sql.Placeholder() for _ in values))
    return cur.execute(statement, list(values.values())).fetchone()['id']


def apply_plan(cur, state, plans, fingerprint):
    if all(p['resolution'] == 'already_present' for p in plans):
        return None
    owner = state['owner']
    report = summary(state, plans)
    run = insert(cur, 'activity_sync_runs', {
        'run_key': 'scoped-aptem-evidence:' + fingerprint,
        'run_kind': 'scoped-aptem-evidence-reconciliation', 'status': 'running', 'dry_run': False,
        'source_counts': Jsonb({'aptem_id': owner['aptem_id'], 'selected_evidence': len(plans)}),
        'result_counts': Jsonb(report),
    })
    by_evidence = {e['evidence_id']: e for e in state['evidence']}
    by_progress = {p['id']: p for p in state['progress']}
    next_order = max((p['entry_order'] for p in state['progress']), default=0)
    documents_added = 0
    documents_reused = 0
    for plan in plans:
        if plan['resolution'] == 'already_present':
            continue
        e = by_evidence[plan['evidence_id']]
        raw = dict(e['evidence_raw'] or {})
        if str(raw.get('Id')) != str(e['evidence_id']) or str(raw.get('LearnerId')) != str(owner['aptem_id']):
            raise ValueError('Raw evidence identity mismatch.')
        if (str(raw.get('ComponentId')) != str(e['component_id'])
                or Decimal(str(raw.get('SpentTime'))) != Decimal(str(e['spent_time']))
                or raw.get('LatestStatus') != e['evidence_status']):
            raise ValueError('Raw evidence component, time or status mismatch.')
        raw['reconciliation'] = {'resolution': plan['resolution'], 'journal_row_id': plan['journal_id'],
                                 'source_table': 'fetching_evidence.evidence_items'}
        raw['component_name'] = e['component_name']
        if e['note_content']:
            raw['note_content'] = e['note_content']
        source_ref = f"evidence:{e['evidence_id']}"
        progress_id = plan['progress_id']
        key = (by_progress[progress_id]['canonical_activity_key'] if progress_id is not None else
               f"aptem:{owner['aptem_id']}:{source_ref}")
        if plan['resolution'] == 'new_attendance':
            next_order += 1
            progress_id = insert(cur, 'learner_progress_entries', {
                'learner_id': owner['id'], 'entry_order': next_order, 'kind': plan['kind'],
                'component_ref': source_ref, 'component_title': e['component_name'] or e['evidence_name'],
                'component_type': plan['kind'], 'enrolment_id': owner['enrolment_id'],
                'programme_id': owner['programme_id'], 'aptem_id': owner['aptem_id'],
                'source_system': 'aptem', 'source_activity_id': source_ref,
                'canonical_activity_key': key, 'activity_status': 'Accepted', 'accepted': True,
                'actual_seconds': plan['added_seconds'], 'actual_basis': 'aptem:accepted-evidence-spent-minutes',
                'reporting_started_at': plan['at'], 'reporting_ended_at': plan['end_at'],
                'reporting_month': plan['month'], 'source_payload': Jsonb(raw), 'sync_run_id': run,
            })
        insert(cur, 'learner_activity_sources', {
            'learner_id': owner['id'], 'enrolment_id': owner['enrolment_id'],
            'programme_id': owner['programme_id'], 'aptem_id': owner['aptem_id'],
            'source_system': 'aptem', 'source_activity_id': source_ref,
            'canonical_activity_key': key, 'activity_type': plan['kind'],
            'title': e['component_name'] or e['evidence_name'], 'activity_status': 'Accepted',
            'completed': True, 'accepted': True, 'actual_seconds': plan['source_seconds'],
            'actual_basis': 'aptem:accepted-evidence-spent-minutes',
            'source_started_at': plan['at'], 'source_ended_at': plan['end_at'],
            'reporting_started_at': plan['at'], 'reporting_ended_at': plan['end_at'],
            'reporting_month': plan['month'], 'source_payload': Jsonb(raw),
            'ksb_codes': Jsonb(e['ksb_codes'] or []),
            'source_updated_at': raw.get('UpdatedDate'), 'sync_run_id': run,
            'canonical_progress_id': progress_id,
            'source_fingerprint': digest(e),
        })
        if progress_id is not None and e['file_blob']:
            existing = [d for d in state['documents'] if d['progress_id'] == progress_id
                        and d['container'] == CONTAINER and d['blob_name'] == e['file_blob']
                        and d['deleted_at'] is None]
            if existing:
                documents_reused += 1
                continue
            doc_key = source_ref + ':file'
            if cur.execute('SELECT 1 FROM "Learner".learner_activity_documents WHERE source_system=%s AND source_document_id=%s', ['aptem', doc_key]).fetchone():
                raise ValueError('Document source identity already exists; review ownership.')
            insert(cur, 'learner_activity_documents', {
                'learner_id': owner['id'], 'progress_id': progress_id, 'source_system': 'aptem',
                'source_document_id': doc_key, 'container': CONTAINER, 'blob_name': e['file_blob'],
                'display_name': e['evidence_name'],
                'content_type': mimetypes.guess_type(e['evidence_name'])[0] or 'application/octet-stream',
                'uploaded_at': e['submission_date'],
            })
            documents_added += 1
    report.update(documents_added=documents_added, documents_reused=documents_reused)
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status=%s,
        finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [
        'completed_with_issues' if report['review_evidence_ids'] else 'completed', Jsonb(report), run])
    return run


def database_url():
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / '.env').read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = (values.get('ENROLMENT_DATABASE_URL') or values.get('Database_url')
           or values.get('DATABASEURL') or values.get('DATABASE_URL'))
    if not url:
        raise ValueError('No configured enrolment database.')
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--evidence-ids', type=ids, required=True)
    parser.add_argument('--assignment-components', type=ids, required=True)
    parser.add_argument('--attendance-components', type=ids, required=True)
    parser.add_argument('--attendance-start-time', type=lambda value: datetime.strptime(value, '%H:%M').time())
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-database')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if not args.evidence_ids:
        parser.error('An explicit nonempty evidence selection is required.')
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error('Apply requires the reviewed database name and preview fingerprint.')
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as connection:
        connection.read_only = not args.apply
        with connection.cursor() as cur:
            cur.execute('SET LOCAL statement_timeout=20000')
            cur.execute('SET LOCAL lock_timeout=5000')
            database = cur.execute('SELECT current_database() AS name').fetchone()['name']
            if args.apply:
                if database != args.expected_database:
                    raise ValueError('Database differs from reviewed preview.')
                owner = cur.execute('SELECT id FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [args.aptem_id]).fetchall()
                if len(owner) != 1:
                    raise ValueError('Expected one canonical learner.')
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),%s::integer)", [owner[0]['id']])
                for table, field, value in [('learner_journal_rows', 'canonical_learner_id', owner[0]['id']),
                                             ('learner_progress_entries', 'learner_id', owner[0]['id']),
                                             ('learner_activity_sources', 'learner_id', owner[0]['id']),
                                             ('learner_activity_documents', 'learner_id', owner[0]['id'])]:
                    from psycopg import sql
                    cur.execute(sql.SQL('SELECT id FROM "Learner".{} WHERE {}=%s FOR UPDATE').format(
                        sql.Identifier(table), sql.Identifier(field)), [value])
                cur.execute('SELECT evidence_id FROM fetching_evidence.evidence_items WHERE learner_id=%s AND evidence_id=ANY(%s) FOR SHARE', [args.aptem_id, args.evidence_ids])
            state = read_state(cur, args.aptem_id, args.evidence_ids)
            plans = make_plan(state, set(args.assignment_components), set(args.attendance_components),
                              args.attendance_start_time)
            fingerprint = digest({'state': state, 'plans': plans})
            output = {'database': database, 'fingerprint': fingerprint, **summary(state, plans)}
            if args.apply:
                if fingerprint != args.expected_fingerprint:
                    raise ValueError('Data changed since preview; preview again before applying.')
                run_id = apply_plan(cur, state, plans, fingerprint)
                after = read_state(cur, args.aptem_id, args.evidence_ids)
                # Existing sources, documents, journal values and progress must
                # remain byte-for-byte identical, including deleted records.
                for name in ('journals', 'progress', 'sources', 'documents', 'segments'):
                    previous = {r['id']: r for r in state[name]}
                    retained = {r['id']: r for r in after[name] if r['id'] in previous}
                    if digest(previous) != digest(retained):
                        raise ValueError('An existing record changed; rolling back.')
                if summary(after, [])['accepted_seconds_before'] != output['accepted_seconds_after']:
                    raise ValueError('Hours verification failed; rolling back.')
                remaining = make_plan(after, set(args.assignment_components), set(args.attendance_components),
                                      args.attendance_start_time)
                if any(p['resolution'] != 'already_present' for p in remaining):
                    raise ValueError('Evidence coverage verification failed; rolling back.')
                output.update(applied=True, run_id=run_id, verification='passed')
        # Print success only after the transaction has committed successfully.
    print(json.dumps(output, default=str))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, psycopg.Error) as error:
        # Database exception text can include private source payloads or DSNs.
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else type(error).__name__}))
        sys.exit(1)
