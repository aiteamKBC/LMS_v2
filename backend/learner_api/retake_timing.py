"""Read-only selection of persisted attempt timing; never changes audit evidence."""
import json
from math import isfinite
from datetime import datetime
from zoneinfo import ZoneInfo


def choice(value, *, activity=False):
    allowed = ('keep', 'new', 'correct', 'add', 'retry') if activity else ('keep', 'new')
    if value is not None and value not in allowed:
        raise ValueError('Choose whether to keep the current time or use the new attempt time.')
    return value


def combine_seconds(previous, current, mode):
    if mode == 'add':
        return previous + current
    if mode == 'retry':
        return max(previous, current)
    if mode == 'keep':
        return previous
    return current


def selected_attempt(rows, *, default='latest'):
    """Rows are chronological, eligible attempts with seconds/mode fields.

    Legacy keep/new selections can retain their saved date policy. Ordinary
    retries use the larger duration, including unlabelled native attempts.
    """
    selected, seconds = None, 0
    prefix = []
    for row in rows:
        if row.get('mode') in ('correct', 'add', 'retry'):
            break
        prefix.append(row)
    fallback = 'latest' if default == 'retry' and any(row.get('mode') in ('keep', 'new') for row in prefix) else default
    for row in rows:
        mode, current = row.get('mode') or fallback, row['seconds']
        if mode in ('correct', 'add', 'retry'):
            fallback = 'retry'
        if selected is None:
            selected, seconds = row, current
        elif mode == 'keep' or (mode == 'retry' and seconds >= current):
            continue
        else:
            seconds = combine_seconds(seconds, current, mode)
            selected = row
    return selected, seconds


def validate_activity_time(record, history, *, seconds_for, monthly_assignment=False):
    """Validate ordinary activity decisions against server-owned saved attempts."""
    mode = choice(record.get('retakeTimeChoice'), activity=True)
    reason = record.get('retakeTimeReason')
    if reason is not None and (not isinstance(reason, str) or len(reason) > 500):
        raise ValueError('Explain the time correction using up to 500 characters.')
    if monthly_assignment or record.get('kind') not in ('component', 'video', 'quiz'):
        if mode in ('correct', 'add', 'retry'):
            raise ValueError('This activity uses its own time-entry workflow.')
        return
    seconds = seconds_for(record)
    if seconds > 8 * 3600:
        raise ValueError('This time exceeds the 8-hour limit for one activity. Enter a shorter time and try again. Your answers are kept.')
    if mode not in ('correct', 'add', 'retry'):
        return
    if mode in ('correct', 'add') and seconds <= 0:
        raise ValueError('Enter a time greater than zero and try again. Your answers are kept.')
    if mode == 'correct' and (not isinstance(record.get('retakeTimeReason'), str)
            or not 3 <= len(record['retakeTimeReason'].strip()) <= 500):
        raise ValueError('Explain the time correction using 3 to 500 characters.')
    quiz = record.get('quizId')
    component = record.get('componentId')
    previous = [row for row in history if row.get('passed') is not False and (
        str(row.get('quizId')) == str(quiz) if quiz else
        row.get('componentId') == component and row.get('kind') in ('component', 'video'))]
    ordered = sorted(enumerate(previous), key=lambda item: attempt_order(item[1].get('submittedAt'), item[0]))
    _, before = selected_attempt([{'seconds': seconds_for(row), 'mode': row.get('retakeTimeChoice')}
                                  for _, row in ordered], default='retry')
    # The prior value is a concurrency guard, never a trusted source of hours.
    expected = record.get('retakePreviousSeconds')
    if expected is not None and (type(expected) not in (int, float) or not isfinite(expected) or abs(expected - before) > 1):
        raise ValueError('The saved activity time changed. Reload the activity and choose again. Your answers are kept.')
    total = combine_seconds(before, seconds, mode)
    if total > 8 * 3600:
        raise ValueError(f'Adding this time would make the activity total {total / 3600:g} hours, above the 8-hour limit. Enter a smaller additional time and try again. Your answers are kept.')
    record['countedSeconds'] = before if record.get('passed') is False else total


def metadata(record):
    value = record.get('source_payload') or {}
    value = json.loads(value) if isinstance(value, str) else value
    return value if isinstance(value, dict) else {}


def stamp(value):
    if not value:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    uk = ZoneInfo('Europe/London')
    return (value if value.tzinfo else value.replace(tzinfo=uk)).astimezone(uk)


def attempt_order(submitted_at, ident):
    """Order saved attempts by the real submission instant, then their stable ID."""
    ident = str(ident)
    submitted = stamp(submitted_at)
    return (submitted.astimezone(ZoneInfo('UTC')) if submitted else datetime.min.replace(tzinfo=ZoneInfo('UTC')),
            (0, int(ident)) if ident.isdigit() else (1, ident))


def native_key(record):
    # Match the existing native quiz identity; never cross learner ownership.
    if record.get('quiz_ref'):
        return record.get('learner_id'), str(record['quiz_ref'])
    if record.get('component_ref'):
        return record.get('learner_id'), 'component', str(record['component_ref'])
    return None


def native_choices(baseline, candidates):
    groups = {}
    for record in candidates:
        key = native_key(record)
        if key:
            groups.setdefault(key, []).append(record)
    replacements = {}
    for key, rows in groups.items():
        if any(row.get('component_type') == 'assignment' for row in rows):
            # Tutor-approved assignment hours remain authoritative.
            continue
        if not any(metadata(row).get('retakeTimeChoice') for row in rows):
            continue
        eligible = [row for row in sorted(rows, key=lambda item: attempt_order(item.get('submitted_at'), item['id']))
                    if row.get('accepted') is True and row.get('passed') is not False and row.get('actual_seconds') is not None]
        explicit = any(metadata(row).get('retakeTimeChoice') in ('keep', 'new', 'correct', 'add', 'retry') for row in eligible)
        if not explicit or not eligible:
            continue
        selected, seconds = selected_attempt([{**row, 'seconds': row['actual_seconds'],
            'mode': metadata(row).get('retakeTimeChoice')} for row in eligible],
            default='retry' if any(metadata(row).get('retakeTimeChoice') in ('correct', 'add', 'retry') for row in eligible) else 'latest')
        latest = eligible[-1]
        end = stamp(selected.get('declared_completed_at') or selected.get('reporting_ended_at')
                    or selected.get('submitted_at'))
        start = stamp(selected.get('started_at') or selected.get('reporting_started_at'))
        label = selected.get('reporting_timestamp_label') or ''
        if end:
            label = end.strftime('%H:%M:%S')
            if start and start.date() == end.date() and start.timestamp() < end.timestamp():
                label = f'{start:%H:%M:%S} - {end:%H:%M:%S}'
            else:
                start = None
        replacements[key] = {**latest, 'actual_seconds': seconds,
            'reporting_month': end.strftime('%Y-%m') if end else selected.get('reporting_month'),
            'reporting_started_at': start, 'reporting_ended_at': end,
            'reporting_timestamp_label': label, 'retake_timing_applied': True,
            'completion_reporting_date': end.date().isoformat() if end else None,
            'retake_superseded_ids': [str(row['id']) for row in rows if row['id'] != latest['id']]}
    return [row for row in baseline if native_key(row) not in replacements] + list(replacements.values())


def measured_choice(candidates, has_accepted_history=False):
    """Keep the currently selected successful local attempt across later retakes."""
    selected = None
    replace_history = False
    for row in sorted(candidates, key=lambda item: attempt_order(item['timing'].get('submittedAt'), item['id'])):
        mode = row['timing'].get('retakeTimeChoice')
        if mode in ('keep', 'new'):
            if mode == 'new':
                selected, replace_history = row, True
            elif selected is None and not has_accepted_history:
                selected = row
        else:
            selected = row
    return selected, replace_history
