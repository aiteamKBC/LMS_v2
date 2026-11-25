"""Project programme schedules and apply validated occurrence decisions atomically."""
from __future__ import annotations

from curriculum_api.review_management.domain.recurrence import DEFAULT_PREVIEW_MONTHS
from curriculum_api.review_management.domain.recurrence import _ACTIONS
from curriculum_api.review_management.domain.recurrence import _MONTH_RE
from curriculum_api.review_management.infrastructure.schedule_rows import _fetch_active_clash_resolutions
from curriculum_api.review_management.infrastructure.schedule_rows import _fetch_active_overrides
from curriculum_api.review_management.domain.recurrence import _month_bounds
from curriculum_api.review_management.infrastructure.schedule_rows import _upsert_keep_all_resolution
from curriculum_api.review_management.domain.recurrence import add_calendar_months
from curriculum_api.review_management.domain.recurrence import clash_signature
from curriculum_api.catalogue.domain.values import clean_str
from datetime import date
from collections import defaultdict
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at
from curriculum_api.review_management.domain.recurrence import generate_occurrences
from curriculum_api.review_management.infrastructure.template_rows import get_review_template_rows
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.review_management.domain.recurrence import recurrence_label
from curriculum_api.review_management.infrastructure.schedule_rows import restore_occurrence
from curriculum_api.review_management.infrastructure.schedule_rows import skip_occurrence
from datetime import timedelta
from django.db import transaction


def _raw_occurrences_for_programme(programme_id, window_start, window_end):
    """Every enabled, non-deleted Review template's raw occurrences in the window.

    One query (the Review rows already carry recurrence + anchor); the
    date projection itself is pure in-memory arithmetic.
    """
    rows = get_review_template_rows('programme_id = %s and enabled = true', [programme_id])
    items = []
    for row in rows:
        anchor = parse_date(row.get('schedule_anchor_date')) or parse_date(row.get('created_at'))
        interval = parse_int(row.get('recurrence_interval'), 1)
        unit = row.get('recurrence_unit') or 'weeks'
        occurrence_limit = row.get('occurrence_count')
        for occ in generate_occurrences(anchor, interval, unit, window_start, window_end, occurrence_limit=occurrence_limit):
            items.append({
                'reviewId': row.get('id'),
                'reviewName': row.get('name') or '',
                'recurrenceLabel': recurrence_label(interval, unit),
                'occurrenceDate': occ,
            })
    return items, [row.get('id') for row in rows]


def build_programme_schedule(programme_id, *, months=DEFAULT_PREVIEW_MONTHS, today=None):
    """Raw + effective Review occurrence schedule for a Programme, grouped by month.

    Exactly three queries regardless of how many Reviews/occurrences/months
    are involved: the Review template rows, the active occurrence overrides
    for those Reviews, and the active clash resolutions for this Programme.
    """
    today = today or date.today()
    window_start = date(today.year, today.month, 1)
    window_end = add_calendar_months(window_start, months) - timedelta(days=1)

    raw_items, review_ids = _raw_occurrences_for_programme(programme_id, window_start, window_end)
    overrides_by_key = _fetch_active_overrides(review_ids)
    resolutions_by_key = _fetch_active_clash_resolutions(programme_id)

    by_month = defaultdict(list)
    for item in raw_items:
        by_month[item['occurrenceDate'].strftime('%Y-%m')].append(item)

    months_payload = []
    for month_key in sorted(by_month.keys()):
        items = sorted(by_month[month_key], key=lambda i: (i['occurrenceDate'], i['reviewId']))
        signature = clash_signature([(i['reviewId'], i['occurrenceDate'].isoformat()) for i in items])
        occurrence_payloads = []
        skipped_count = 0
        for item in items:
            date_iso = item['occurrenceDate'].isoformat()
            override = overrides_by_key.get((item['reviewId'], date_iso))
            status = 'skipped' if override else 'scheduled'
            if override:
                skipped_count += 1
            occurrence_payloads.append({
                'reviewId': item['reviewId'],
                'reviewName': item['reviewName'],
                'occurrenceDate': date_iso,
                'recurrenceLabel': item['recurrenceLabel'],
                'status': status,
                'skippedBy': override.get('updated_by') if override else None,
                'skippedAt': format_created_at(override.get('updated_at')) if override else None,
                'reason': (override.get('reason') or None) if override else None,
            })

        has_clash = len(items) >= 2
        if not has_clash:
            resolution_status = 'none'
        elif skipped_count > 0:
            resolution_status = 'resolved'
        elif (month_key, signature) in resolutions_by_key:
            resolution_status = 'kept_all'
        else:
            resolution_status = 'unresolved'

        months_payload.append({
            'month': month_key,
            'hasClash': has_clash,
            'resolutionStatus': resolution_status,
            'clashSignature': signature if has_clash else None,
            'occurrences': occurrence_payloads,
        })

    return {
        'programmeId': programme_id,
        'windowStart': window_start.isoformat(),
        'windowEnd': window_end.isoformat(),
        'monthsPreviewed': months,
        'months': months_payload,
    }


def validate_clash_resolution_payload(programme_id, payload):
    """Returns (month, cleaned_items, errors).

    Every submitted (reviewId, occurrenceDate) pair must be a RAW occurrence
    this Programme's Reviews actually produce for that month -- this is what
    keeps the decision scoped to the correct Programme and rejects stale or
    fabricated dates rather than trusting the client.
    """
    errors = {}
    month = clean_str(payload.get('month'))
    if not _MONTH_RE.match(month):
        errors['month'] = 'A valid month (YYYY-MM) is required.'
        return month, [], errors

    month_start, _ = _month_bounds(month)
    raw_items, _ = _raw_occurrences_for_programme(programme_id, month_start, _month_bounds(month)[1])
    raw_keys = {(i['reviewId'], i['occurrenceDate'].isoformat()) for i in raw_items}

    items = payload.get('occurrences')
    if not isinstance(items, list) or not items:
        errors['occurrences'] = 'Select at least one review occurrence.'
        return month, [], errors

    cleaned_items = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            item = {}
        path = f'occurrences[{index}]'
        review_id = clean_str(item.get('reviewId'))
        occurrence_date = clean_str(item.get('occurrenceDate'))
        action = clean_str(item.get('action')).lower()

        if (review_id, occurrence_date) not in raw_keys:
            errors[path] = 'This review occurrence is not currently scheduled for this Programme in this month.'
            continue
        if action not in _ACTIONS:
            errors[f'{path}.action'] = 'action must be "skip" or "keep".'
            continue
        cleaned_items.append({
            'review_id': review_id,
            'occurrence_date': occurrence_date,
            'action': action,
            'reason': clean_str(item.get('reason')),
        })

    return month, cleaned_items, errors


def resolve_clash_decision(programme_id, month, items, *, actor='staff', invalidate_curriculum_cache):
    """Applies a set of skip/keep decisions, then -- if every raw occurrence
    in the month is still effective (nothing was skipped) -- persists an
    explicit "keep all" acknowledgement so the month stops reading as an
    unresolved clash. Returns the recomputed single-month schedule payload."""
    with transaction.atomic():
        for item in items:
            if item['action'] == 'skip':
                skip_occurrence(item['review_id'], item['occurrence_date'], programme_id, actor=actor, reason=item['reason'])
            else:
                restore_occurrence(item['review_id'], item['occurrence_date'], actor=actor)

        month_start, _ = _month_bounds(month)
        result = build_programme_schedule(programme_id, months=1, today=month_start)
        month_payload = result['months'][0] if result['months'] else None

        if month_payload and month_payload['hasClash'] and month_payload['resolutionStatus'] == 'unresolved':
            _upsert_keep_all_resolution(programme_id, month, month_payload['clashSignature'], actor=actor)
            result = build_programme_schedule(programme_id, months=1, today=month_start)
            month_payload = result['months'][0]

    invalidate_curriculum_cache()
    return month_payload or {'month': month, 'hasClash': False, 'resolutionStatus': 'none', 'clashSignature': None, 'occurrences': []}
