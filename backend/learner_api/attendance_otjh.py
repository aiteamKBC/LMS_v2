"""Current OTJ allocations from the resolved register, without changing history.

One completed, present occurrence earns 150 minutes per learner. Saved recording
time remains authoritative when there is no presence. Signed/locked months are
excluded from recalculation. All reads are bounded across an entire caseload.
"""
from collections import defaultdict

from django.utils import timezone

from .live_session_policy import LIVE_SESSION_CREDIT_SECONDS
from .monthly_log_attendance import SOURCE, UK, instant, metadata, represented
from .monthly_log_sources import number, row


def protected_months(profile_ids, read, table=None):
    ids = list(dict.fromkeys(profile_ids))
    if not ids:
        return {}
    slots = ','.join(['%s'] * len(ids))
    original_read = read
    if table is not None:
        def read(sql, params):
            for name in ('learner_monthly_signatures', 'learner_monthly_locks', 'learners',
                         'manual_month_finalization_events', 'monthly_audit_signoffs'):
                sql = sql.replace(f'"Learner".{name}', table(name))
            return original_read(sql, params)
    rows = read(f'''SELECT learner_id,report_month,signature_data
        FROM "Learner".learner_monthly_signatures
        WHERE learner_id IN ({slots}) AND review_confirmed IS TRUE
        ORDER BY signed_at,id''', ids)
    result = defaultdict(dict)
    for item in rows:
        result[int(item['learner_id'])].setdefault(item['report_month'], metadata(item.get('signature_data')))
    locks = read(f'''SELECT learner_id,report_month FROM "Learner".learner_monthly_locks
        WHERE learner_id IN ({slots}) AND locked_at IS NOT NULL AND unlocked_at IS NULL
        UNION
        SELECT l.id AS learner_id,e.report_month FROM "Learner".learners l
        JOIN "Learner".manual_month_finalization_events e ON e.aptem_id=l.aptem_id
        WHERE l.id IN ({slots}) AND e.event_type='finalized'
          AND NOT EXISTS(SELECT 1 FROM "Learner".manual_month_finalization_events newer
            WHERE newer.aptem_id=e.aptem_id AND newer.report_month=e.report_month AND newer.id>e.id)
        UNION
        SELECT l.id AS learner_id,s.report_month FROM "Learner".learners l
        JOIN "Learner".monthly_audit_signoffs s ON s.learner_id=CAST(l.aptem_id AS text)
        WHERE l.id IN ({slots}) AND s.review_confirmed IS TRUE''', ids * 3)
    for item in locks:
        result[int(item['learner_id'])].setdefault(item['report_month'], {})
    return dict(result)


def read_bulk(owners, read, *, now=None):
    owners = {int(o['id']): o for o in owners}
    if not owners:
        return {}
    now = now or timezone.now()
    ids = list(owners)
    slots = ','.join(['%s'] * len(ids))
    frozen = protected_months(ids, read)
    result = {ident: {'protected': frozen.get(ident, {}), 'lectures': [], 'frozen_rows': []} for ident in ids}
    for ident, months in frozen.items():
        for month, capture in months.items():
            result[ident]['frozen_rows'].extend(dict(item) for item in capture.get('rows') or []
                if isinstance(item, dict) and item.get('source_system') == SOURCE
                and item.get('reporting_month') == month)
    lectures = read(f'''SELECT r.learner_profile_id,r.occurrence_id,r.module_catalogue_id,r.session_date,
        o.live_session_id,o.session_number,o.scheduled_start,o.scheduled_end,s.module_title
        FROM curriculum.live_session_learner_attendance r
        JOIN curriculum.live_session_occurrences o ON o.id=r.occurrence_id AND o.live_session_id=r.live_session_id
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        WHERE r.learner_profile_id IN ({slots}) AND r.attendance_status='present'
          AND lower(coalesce(o.status,'')) NOT IN ('cancelled','canceled','deleted','failed','superseded')
          AND lower(coalesce(s.status,'')) NOT IN ('cancelled','canceled','deleted','failed','superseded')
        ORDER BY r.learner_profile_id,o.scheduled_start,r.occurrence_id,r.module_catalogue_id''', ids)
    candidates = defaultdict(list)
    for lecture in lectures:
        ident = int(lecture['learner_profile_id'])
        start, end = instant(lecture['scheduled_start']), instant(lecture['scheduled_end'])
        if start is None or end is None or end <= start or end > now:
            continue
        day = str(lecture['session_date'] or start.astimezone(UK).date())
        if day[:7] in frozen.get(ident, {}):
            continue
        candidates[ident].append({**lecture, 'session_date': day, 'start': start, 'end': end})
    if not candidates:
        return result
    ids = list(candidates)
    slots = ','.join(['%s'] * len(ids))
    records = read(f'''SELECT p.id,p.learner_id,p.source_payload,p.time_tracking_session_ref,p.module_ref,
        p.component_ref,p.curriculum_component_ref,p.actual_seconds,p.accepted,p.actual_basis,p.reporting_month,
        p.submitted_at,p.declared_completed_at,p.source_system,p.component_link_source,p.kind,
        a.source_key AS kbc_attendance_key,c.settings_json,c.type AS activity_type
        FROM "Learner".learner_progress_entries p
        JOIN "Learner".learners l ON l.id=p.learner_id
        LEFT JOIN "Learner".source_lms_attendance a ON a.aptem_id=l.aptem_id
          AND substr(p.source_payload->>'original_source_ref',1,4)='att:'
          AND a.source_key=substr(p.source_payload->>'original_source_ref',5)
        LEFT JOIN curriculum.components c ON c.id=coalesce(nullif(p.curriculum_component_ref,''),p.component_ref)
        WHERE p.learner_id IN ({slots}) AND p.deleted_at IS NULL
          AND (replace(lower(coalesce(c.type,p.component_type,p.kind,'')),'-','_')
                 IN ('live_session','attendance','lecture','recording_placeholder')
            OR p.time_tracking_session_ref LIKE 'teams:%%'
            OR CAST(p.source_payload AS text) LIKE '%%attendance%%'
            OR CAST(p.source_payload AS text) LIKE '%%att:%%'
            OR CAST(p.source_payload AS text) LIKE '%%teams:%%')
        ORDER BY p.id''', ids)
    records_by_owner = defaultdict(list)
    for record in records:
        records_by_owner[int(record['learner_id'])].append(record)
    modules = sorted({str(item['module_catalogue_id']) for items in candidates.values() for item in items})
    slots = ','.join(['%s'] * len(modules))
    components = read(f'''SELECT id,module_catalogue_id,settings_json FROM curriculum.components
        WHERE module_catalogue_id IN ({slots})
          AND replace(lower(type),'-','_') IN ('live_session','attendance','lecture')''', modules)
    for ident, items in candidates.items():
        occurrences = defaultdict(list)
        kbc = defaultdict(set)
        for item in items:
            occurrences[str(item['occurrence_id'])].append(item)
            kbc[item['session_date'], item['module_title']].add(str(item['occurrence_id']))
        for matches in occurrences.values():
            for item in matches:
                item['unique_kbc_match'] = len(kbc[item['session_date'], item['module_title']]) == 1
            linked = [component for component in components if any(represented(item, [{
                'settings_json': component['settings_json'], 'module_ref': component['module_catalogue_id']}]) for item in matches)]
            linked_modules = {str(component['id']): str(component['module_catalogue_id']) for component in linked}
            def belongs(record):
                if any(represented(item, [record]) for item in matches):
                    return True
                settings = metadata(record.get('settings_json'))
                parent = str(settings.get('linkedLiveSessionComponentId') or '')
                module = str(record.get('module_ref') or '')
                return (record.get('activity_type') == 'recording_placeholder' and parent in linked_modules
                        and linked_modules[parent] == module
                        and str(settings.get('linkedLiveSessionModuleId') or module) == module)
            saved = [record for record in records_by_owner[ident] if belongs(record)]
            lecture = matches[0]
            result[ident]['lectures'].append({**lecture, 'records': saved,
                'component_ids': sorted({str(component['id']) for component in linked})})
    return result


def projection(records, facts, *, preserved_record_ids=()):
    """Replace a live allocation once; keep saved records and captures immutable."""
    from .canonical_learning import allocations
    # Only top-level projection fields change; evidence bodies remain shared,
    # immutable inputs rather than being copied for every dashboard request.
    result = [dict(record) for record in records]
    protected = facts.get('protected', {})
    preserved = set(map(str, preserved_record_ids))
    by_id = {str(record['id']): record for record in result}
    for lecture in facts.get('lectures', []):
        matches = [by_id[str(record['id'])] for record in lecture['records'] if str(record['id']) in by_id]
        # A saved allocation in a protected month cannot be moved or replaced,
        # even when the occurrence's own date belongs to an open month.
        if any(record.get('reporting_month') in protected or any(part.get('reporting_month') in protected for part in allocations(record))
               for record in [*matches, *lecture['records']]):
            continue
        occurrence = str(lecture['occurrence_id'])
        existing_credit = by_id.get(f'attendance:{occurrence}')
        if existing_credit is not None and existing_credit not in matches:
            matches.insert(0, existing_credit)
        if preserved.intersection(str(record['id']) for record in [*matches, *lecture['records']]):
            # Transfer snapshots retain their original hours. This occurrence
            # is already represented there; only unrelated new attendance adds credit.
            continue
        start, end = lecture['start'], lecture['end']
        local_start, local_end = start.astimezone(UK), end.astimezone(UK)
        label = f'{local_start:%H:%M:%S} - {local_end:%H:%M:%S}'
        primary = matches[0] if matches else None
        if primary is None:
            component = next(iter(lecture['component_ids']), '')
            primary = {'id': f'attendance:{occurrence}', 'learner_id': lecture['learner_profile_id'],
                'kind': 'attendance', 'component_type': 'live_session', 'component_ref': component,
                'module_ref': lecture['module_catalogue_id'], 'module_title': lecture['module_title'],
                'component_title': f"{lecture['module_title'] or 'Live session'} — Session {lecture['session_number']}",
                'source_system': SOURCE, 'ksbs': [], 'sources': [], 'segments': [], 'hours_only': True,
                'expected_otjh': 0, 'source_payload': {'original_source_ref': f'attendance:{occurrence}'}}
            result.append(primary)
            display = row(f'attendance:{occurrence}', local_start, primary['component_title'], 'Attendance',
                hours=LIVE_SESSION_CREDIT_SECONDS / 3600, planned=(end - start).total_seconds() / 3600,
                group=lecture['module_title'],
                note='Present in the learner attendance register. Fixed live lecture credit: 2h 30m.')
            display.update(source_system=SOURCE, reporting_month=lecture['session_date'][:7],
                activity_date=lecture['session_date'], actual_hours_recorded=True,
                actual_status_label='Accepted', timestamp_label=label)
            primary['attendance_row'] = display
        for record in matches:
            record.update(actual_seconds=0, attendance_occurrence_id=occurrence)
        # Attendance supplies hours/completion, not approved KSB evidence.
        # Keep the evidence and its denominator, alongside its original verdict.
        primary.setdefault('ksb_evidence_accepted', primary.get('accepted') is True)
        primary.update(actual_seconds=LIVE_SESSION_CREDIT_SECONDS, accepted=True, completed=True,
            actual_basis='live_attendance_credit', attendance_occurrence_id=occurrence,
            reporting_month=lecture['session_date'][:7], reporting_started_at=start, reporting_ended_at=end,
            reporting_timestamp_label=label, completion_reporting_date=lecture['session_date'],
            submitted_at=end, declared_completed_at=end)
    existing = {str(record['id']) for record in result}
    for item in facts.get('frozen_rows', []):
        if item['source_ref'] in existing:
            continue
        result.append({'id': item['source_ref'], 'kind': 'attendance', 'component_type': 'live_session',
            'actual_seconds': number(item['actual_hours']) * 3600, 'accepted': item['accepted'],
            'completed': True, 'hours_only': True, 'ksbs': [], 'sources': [], 'segments': [],
            'reporting_month': item['reporting_month'], 'attendance_row': dict(item), 'source_system': SOURCE})
    return result


def apply(owner, records, read, *, preserved_record_ids=()):
    # Explicit entry-ID reads are handled by the caller. Transfer snapshots
    # protect only their own allocations, alongside signed/locked months.
    return projection(records, read_bulk([owner], read)[int(owner['id'])],
                      preserved_record_ids=preserved_record_ids)


def additional_rows(records, attendance):
    """Older display supplements must not re-add an allocation from the ledger."""
    represented = {str(item.get('source_ref') or item.get('id') or '') for item in records}
    represented.update(f"attendance:{item['attendance_occurrence_id']}" for item in records if item.get('attendance_occurrence_id'))
    return [item for item in attendance if not item.get('source_ref') or item['source_ref'] not in represented]


def aggregate_delta(facts, pending):
    """Adjust a SQL total without loading unrelated progress or counting it twice."""
    from .canonical_learning import recorded_seconds
    saved = {str(record['id']): record for lecture in facts['lectures'] for record in lecture['records']}
    for record in pending:
        if str(record['id']) in saved:
            saved[str(record['id'])] = record
    before = sum(recorded_seconds(record) for record in saved.values() if record.get('accepted') is True)
    after = sum(recorded_seconds(record) for record in projection(saved.values(), facts) if record.get('accepted') is True)
    return after - before


def monthly_deltas(facts, pending):
    from .canonical_learning import allocations, recorded_seconds
    saved = {str(record['id']): record for lecture in facts['lectures'] for record in lecture['records']}
    for record in pending:
        if str(record['id']) in saved:
            saved[str(record['id'])] = record
    result = defaultdict(lambda: {'hours': 0, 'submitted': 0, 'activities': 0})
    for sign, records in ((-1, saved.values()), (1, projection(saved.values(), facts))):
        for record in records:
            for part in allocations(record):
                month = part.get('reporting_month')
                if part.get('accepted') is True:
                    result[month]['hours'] += sign * recorded_seconds(part) / 3600
                else:
                    result[month]['submitted'] += sign * recorded_seconds(part) / 3600
                # Move an existing allocation's count with its reporting date;
                # a newly projected register allocation adds exactly one row.
                result[month]['activities'] += sign
    return dict(result)
