"""Pure, read-only projection of one module occurrence onto one calendar day."""
from copy import deepcopy
from zoneinfo import ZoneInfo
from .session_results_policy import instant, session_roster, evidence_seconds


def day_key(value, zone):
    parsed = instant(value)
    return parsed.astimezone(ZoneInfo(zone)).date().isoformat() if parsed else ''


def day_results(session, records, files, date, zone):
    assigned = {p['email'].strip().casefold(): p for p in session.get('attendance', [])
                if p.get('expected') and p.get('email')}
    participants = (session.get('identityCheck') or {}).get('participants', [])
    staff = {p.get('expectedEmail', '').casefold(): p for p in participants if p.get('kind') == 'staff'}
    # Assignment is authoritative, including learners given a meeting presenter role.
    staff = {email: person for email, person in staff.items() if email not in assigned}
    sources = {}
    for person in participants:
        email = person.get('expectedEmail', '').casefold()
        if person.get('kind') == 'learner' and email in assigned:
            for account in person.get('accounts', []):
                if account.get('status') in {'matched', 'different-account'}:
                    for source in account.get('sourceRecordIds', []):
                        sources[str(source)] = email
    staff_sources = {str(source): email for email, person in staff.items() for account in person.get('accounts', []) for source in account.get('sourceRecordIds', [])}
    selected, reports, ambiguous = [], {}, False
    for source in records:
        row = deepcopy(source)
        raw = row.get('raw_data') or {}
        start, end = raw.get('attendanceReportStart'), raw.get('attendanceReportEnd')
        # Report identity/date is required. Never borrow undated or other-day evidence.
        if day_key(start, zone) != date:
            continue
        if len(raw.get('sourceAttendanceReportIds') or []) > 1:
            ambiguous = True
            continue
        report = str(raw.get('attendanceReportId') or start)
        reports[report] = (instant(start), instant(end))
        row['_report'] = report
        visits = []
        for visit in row.get('intervals') or []:
            joined, left = instant(visit.get('joinDateTime')), instant(visit.get('leaveDateTime'))
            report_start, report_end = instant(start), instant(end)
            if joined and left and report_start and report_end:
                joined, left = max(joined, report_start), min(left, report_end)
                if left > joined:
                    visits.append({'joinDateTime': joined.isoformat(), 'leaveDateTime': left.isoformat()})
        if row.get('intervals') and not visits:
            ambiguous = True
            continue
        row['intervals'] = visits
        selected.append(row)
    complete = not ambiguous and bool(reports) and all(start and end and end >= start for start, end in reports.values()) and session.get('reportReady', False)
    learner_records = []
    for row in selected:
        email = sources.get(str(row.get('id')), str(row.get('email') or '').strip().casefold())
        if email in assigned:
            learner_records.append({**row, 'email': email})
        elif not email and str(row.get('role') or '').casefold() not in {'organizer', 'co-organizer', 'presenter'}:
            # Unresolved identities make missing learner evidence uncertain, not absent.
            learner_records.append({**row, 'email': ''})
    roster = [p for p in session_roster(set(assigned), learner_records, complete=complete) if p['expected']]
    for person in roster:
        person['name'] = assigned[person['email']].get('name') or person['email']
    staff_rows = []
    for email, person in staff.items():
        observed = [r for r in selected if staff_sources.get(str(r.get('id')), str(r.get('email') or '').strip().casefold()) == email]
        seconds = evidence_seconds(observed)
        staff_rows.append({'name': person.get('name') or email, 'email': email,
                           'roles': person.get('roles', []), 'seconds': seconds,
                           'status': 'joined' if seconds > 0 else 'unconfirmed'})
    allowed_files = {f['id']: f for f in session.get('artifacts', [])}
    artifacts = []
    for file in files:
        if file['id'] in allowed_files and day_key(file.get('created_datetime'), zone) == date:
            artifacts.append({**allowed_files[file['id']], 'createdAt': file.get('created_datetime'), 'endsAt': file.get('end_datetime')})
    return {'date': date, 'timeZone': zone, 'reportReady': bool(complete), 'reportCount': len(reports),
            'attendance': roster, 'staff': staff_rows, 'artifacts': artifacts,
            'unplacedFileCount': len(allowed_files) - len(artifacts)}
