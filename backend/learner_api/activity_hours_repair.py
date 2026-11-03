"""Evidence-only repair planning. Pure functions: no database or app startup.

Existing zeroes, approvals, attempts, signed months and source snapshots are
protected. This fills missing ledger fields; it never estimates study time.
"""
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
from zoneinfo import ZoneInfo

UK = ZoneInfo('Europe/London')
MONTH = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')


def instant(value):
    if not value:
        return None
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return result.astimezone(UK) if result.tzinfo is not None else None
    except (ValueError, TypeError):
        return None


def approved_seconds(value):
    """Same decimal-hours / legacy clock units as saved reflection durations."""
    if value is None or isinstance(value, bool) or not str(value).strip():
        return None
    try:
        parts = str(value).strip().split(':')
        if len(parts) == 1:
            seconds = Decimal(parts[0]) * 3600
        elif len(parts) in (2, 3):
            seconds = Decimal(parts[-1])
            minutes = int(parts[-2])
            if not seconds.is_finite() or not 0 <= seconds < 60 or minutes < 0:
                return None
            if len(parts) == 3 and (minutes >= 60 or not parts[0].isdigit()):
                return None
            seconds += minutes * 60 + (int(parts[0]) * 3600 if len(parts) == 3 else 0)
        else:
            return None
        if not seconds.is_finite() or seconds <= 0 or seconds != seconds.to_integral_value():
            return None
        return int(seconds)
    except (InvalidOperation, ValueError, TypeError):
        return None


def saved_seconds(row):
    if row.get('component_type') == 'assignment':
        marking = row.get('marking') or {}
        if marking.get('status') not in {'accepted', 'partial'}:
            return None, 'assignment_not_approved'
        seconds = approved_seconds(marking.get('actual_time_hours'))
        return seconds, 'approved_assignment' if seconds is not None else 'duration_unavailable'
    if row.get('passed') is False or row.get('kind') == 'quiz' and row.get('passed') is not True:
        return None, 'activity_not_passed'
    source = str(row.get('time_tracking_source') or '').lower()
    # Imported/authored bounds do not establish measured time.
    if not source.startswith('signed_session_capped_'):
        return None, 'duration_unavailable'
    field = 'claimed_seconds' if source.endswith((':input', ':timer')) else 'verified_seconds'
    seconds = row.get(field)
    if isinstance(seconds, bool) or not isinstance(seconds, int) or seconds <= 0:
        return None, 'duration_unavailable'
    return seconds, 'saved_study_duration'


def month_evidence(row):
    entries = (row.get('marking') or {}).get('dated_entries')
    if row.get('component_type') == 'assignment' and entries:
        # Tutor-approved duration is authoritative even if the learner's
        # original daily claims differ. A single evidenced month needs no
        # invented split of that approved total across days or months.
        try:
            months = {date.fromisoformat(item['date']).strftime('%Y-%m') for item in entries}
        except (ValueError, TypeError, KeyError):
            return None, {}, 'invalid_assignment_dates'
        if len(months) != 1:
            return None, {}, 'assignment_spans_multiple_months'
        month = next(iter(months))
        completed = instant(row.get('declared_completed_at')) or instant(row.get('submitted_at'))
        if completed and month > completed.strftime('%Y-%m'):
            return None, {}, 'assignment_dates_after_completion'
        return month, {}, 'dated_assignment_month'
    sources = [s for s in row.get('sources', [])
               if s.get('learner_id') == row['learner_id'] and s.get('canonical_progress_id') == row['id']]
    exact = [s for s in sources if s.get('source_system') == row.get('source_system')
             and row.get('source_activity_id') and s.get('source_activity_id') == row['source_activity_id']
             and row.get('source_attempt_key') and s.get('source_attempt_key') == row['source_attempt_key']]
    sources = exact or sources
    months = {s['reporting_month'] for s in sources if MONTH.fullmatch(str(s.get('reporting_month') or ''))}
    if len(months) > 1:
        return None, {}, 'conflicting_source_months'
    if months:
        month = next(iter(months))
        dates = {}
        for field in ('reporting_started_at', 'reporting_ended_at'):
            choices = {at for s in sources if (at := instant(s.get(field))) and at.strftime('%Y-%m') == month}
            if len(choices) == 1:
                dates[field] = next(iter(choices))
        return month, dates, 'linked_source_month'
    completed = instant(row.get('declared_completed_at')) or instant(row.get('submitted_at'))
    if completed:
        return completed.strftime('%Y-%m'), {'reporting_ended_at': completed}, 'saved_completion_date'
    return None, {}, 'date_unavailable'


def plan_row(row):
    if not row.get('identity_valid') or row.get('deleted_at') or row.get('accepted') is not True:
        return None, 'owner_or_acceptance'
    if row.get('transfer_active') or row.get('has_segments') or row.get('has_retake_choices'):
        return None, 'protected_history'
    metadata = row.get('source_payload')
    if metadata is not None and not isinstance(metadata, dict):
        return None, 'source_metadata_requires_review'
    if metadata and 'activity_hours_repairs' in metadata and not isinstance(metadata['activity_hours_repairs'], list):
        return None, 'source_metadata_requires_review'
    updates, evidence = {}, []
    if row.get('actual_seconds') is None:
        if row.get('source_system') != 'new_lms' or row.get('actual_basis'):
            return None, 'protected_duration_source'
        if row.get('other_credit'):
            return None, 'another_activity_credit'
        seconds, basis = saved_seconds(row)
        if seconds is None:
            return None, basis
        updates.update(actual_seconds=seconds, actual_basis='repair:' + basis)
        evidence.append(basis)
    elif row['actual_seconds'] <= 0:
        return None, 'preserve_recorded_zero'
    month = row.get('reporting_month')
    if not MONTH.fullmatch(str(month or '')):
        month, dates, basis = month_evidence(row)
        if month is None:
            return None, basis
        updates['reporting_month'] = month
        updates.update({key: value for key, value in dates.items() if row.get(key) is None})
        evidence.append(basis)
    if month in row.get('protected_months', []):
        return None, 'signed_locked_or_finalized_month'
    if not updates:
        return None, 'already_complete'
    return {'id': row['id'], 'learner_id': row['learner_id'], 'month': month,
            'before': {key: row.get(key) for key in updates}, 'after': updates,
            'seconds': updates.get('actual_seconds', row.get('actual_seconds')),
            'evidence': evidence, 'source_ids': sorted(s['id'] for s in row.get('sources', [])),
            'marking_id': (row.get('marking') or {}).get('id')}, None


def build_plan(rows):
    changes, skipped = [], Counter()
    # Multiple incomplete saves of the same activity need an explicit choice;
    # this repair does not silently choose an attempt or add their durations.
    def activity_key(row):
        return (row['learner_id'], 'quiz' if row.get('quiz_ref') else 'component',
                row.get('quiz_ref') or row.get('component_ref'))
    keys = Counter(activity_key(r)
                   for r in rows if r.get('actual_seconds') is None and (r.get('quiz_ref') or r.get('component_ref')))
    for row in rows:
        key = activity_key(row)
        if row.get('actual_seconds') is None and keys[key] > 1:
            skipped['multiple_incomplete_attempts'] += 1
            continue
        change, reason = plan_row(row)
        if change:
            changes.append(change)
        else:
            skipped[reason] += 1
    changes.sort(key=lambda item: item['id'])
    fingerprint = hashlib.sha256(json.dumps(changes, default=str, sort_keys=True).encode()).hexdigest()
    return {'changes': changes, 'skipped': dict(skipped), 'fingerprint': fingerprint}


def summary(plan):
    changes = plan['changes']
    months = {}
    for item in changes:
        values = months.setdefault(item['month'], {'activities': 0, 'assigned_hours': 0.0, 'restored_hours': 0.0})
        values['activities'] += 1
        values['assigned_hours'] += item['seconds'] / 3600
        if 'actual_seconds' in item['after']:
            values['restored_hours'] += item['seconds'] / 3600
    return {'activities': len(changes), 'learners': len({item['learner_id'] for item in changes}),
            'months': {month: {key: round(value, 4) for key, value in values.items()}
                       for month, values in sorted(months.items())},
            'skipped': plan['skipped'], 'fingerprint': plan['fingerprint']}
