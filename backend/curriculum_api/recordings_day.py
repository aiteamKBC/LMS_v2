"""Staff-only read of assigned learners and evidence for one dated lecture."""
from datetime import date as calendar_date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import require_role
from . import session_results
from .attendance_identity import staff_roles
from .recordings_day_policy import day_results, day_key


@require_GET
@require_role('admin', 'staff')
def lecture_day_results(request, series_id, session_number):
    module_id = str(request.GET.get('moduleId') or '').strip()
    occurrence_id = str(request.GET.get('occurrenceId') or '').strip()
    date = str(request.GET.get('date') or '').strip()
    zone = str(request.GET.get('timeZone') or '').strip()
    try:
        calendar_date.fromisoformat(date)
        ZoneInfo(zone)
        if not module_id or not occurrence_id:
            raise ValueError()
    except (ValueError, ZoneInfoNotFoundError):
        return JsonResponse({'error': 'A valid module, occurrence, date and time zone are required.'}, status=400)
    try:
        series = session_results.read('SELECT * FROM curriculum.live_sessions WHERE id=%s', [series_id])
        results = session_results.result_rows(series[0], session_number=session_number, identity=True,
                    module_catalogue_id=module_id) if series else []
        session = next((s for s in results if str(s['id']) == occurrence_id), None)
        if not session or day_key(session['startsAt'], zone) != date:
            return JsonResponse({'error': 'This module lecture was not found on the requested day.'}, status=404)
        known_staff = staff_roles(series[0], session_results.module_tutor_emails(module_id))
        participants = session.setdefault('identityCheck', {}).setdefault('participants', [])
        present_staff = {p.get('expectedEmail') for p in participants if p.get('kind') == 'staff'}
        participants.extend({'kind': 'staff', 'expectedEmail': email, 'name': email, 'roles': roles, 'accounts': []}
                            for email, roles in known_staff.items() if email not in present_staff)
        records = session_results.read('SELECT * FROM curriculum.live_session_attendance WHERE occurrence_id=%s', [occurrence_id])
        for row in records:
            row['raw_data'] = session_results.json_value(row.get('raw_data'), {})
            row['intervals'] = session_results.json_value(row.get('intervals'), [])
        files = session_results.read('SELECT id,created_datetime,end_datetime FROM curriculum.live_session_artifacts WHERE occurrence_id=%s', [occurrence_id])
        return JsonResponse(day_results(session, records, files, date, zone))
    except DatabaseError:
        return session_results.unavailable()
