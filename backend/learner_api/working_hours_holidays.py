"""Read-only holiday source for activity completion declarations.

This does not synchronize feeds, alter curriculum schedules or restrict access.
"""
from django.db import DatabaseError, connection
from django.http import JsonResponse

from login.permissions import login_required


def working_hours_holiday_ranges():
    with connection.cursor() as cursor:
        cursor.execute('''
            SELECT holiday_date, holiday_date
              FROM curriculum.england_holidays
             WHERE division = %s
            UNION
            SELECT start_date, COALESCE(end_date, start_date)
              FROM curriculum.holidays
             WHERE is_archived IS NOT TRUE
               AND start_date IS NOT NULL
               AND COALESCE(end_date, start_date) >= start_date
            ORDER BY 1, 2
        ''', ['england-and-wales'])
        return [{'start': str(start), 'end': str(end)} for start, end in cursor.fetchall()]


def is_working_hours_holiday(day):
    key = day.isoformat()
    return any(row['start'] <= key <= row['end'] for row in working_hours_holiday_ranges())


@login_required
def working_hours_holidays(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    try:
        ranges = working_hours_holiday_ranges()
    except DatabaseError:
        return JsonResponse({'error': 'Could not load the working-hours holiday calendar. Please try again.'}, status=503)
    return JsonResponse({'holidays': ranges})
