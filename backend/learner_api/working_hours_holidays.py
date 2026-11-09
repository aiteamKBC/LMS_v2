"""Read-only holiday source for activity completion declarations.

This does not synchronize feeds, alter curriculum schedules or restrict access.

With ``?componentId=`` the answer is scoped to the holidays that actually apply
to that component's cohort, resolved through ``working_rules`` from the same
canonical calendar and cohort mappings Curriculum owns. A closure authored
against another programme therefore never reaches this learner. A caller with
no component or quiz has no cohort context and receives an empty calendar
rather than the global Curriculum calendar.
"""
from django.db import DatabaseError
from django.http import JsonResponse

from login.permissions import login_required

from .working_rules import learner_holiday_details


def working_hours_holiday_ranges(component_id=None, quiz_id=None):
    """Working-hours holidays for the named activity's cohort.

    No activity means no cohort context, so the safe answer is an empty
    calendar rather than every holiday known to Curriculum.
    """
    if not (str(component_id or '').strip() or str(quiz_id or '').strip()):
        return []
    return component_holiday_ranges(component_id, quiz_id=quiz_id)


def component_holiday_ranges(component_id, quiz_id=None):
    """One closed day per range, each named, for this activity's cohort.

    A day is emitted per closed date rather than per holiday period so the
    completion dialog can name the holiday on whichever day the learner picks
    without re-deriving the period arithmetic in the browser.
    """
    details = learner_holiday_details(component_id, quiz_id=quiz_id)
    return [
        {
            'start': day.isoformat(),
            'end': day.isoformat(),
            'label': next(
                (str((item or {}).get('label') or '').strip()
                 for item in rows if str((item or {}).get('label') or '').strip()),
                '',
            ),
        }
        for day, rows in sorted(details.items())
    ]


def is_working_hours_holiday(day, *, component_id=None, quiz_id=None):
    key = day.isoformat()
    return any(
        row['start'] <= key <= row['end']
        for row in working_hours_holiday_ranges(component_id, quiz_id)
    )


@login_required
def working_hours_holidays(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    component_id = (request.GET.get('componentId') or '').strip()
    quiz_id = (request.GET.get('quizId') or '').strip()
    try:
        ranges = working_hours_holiday_ranges(component_id, quiz_id or None)
    except DatabaseError:
        return JsonResponse({'error': 'Could not load the working-hours holiday calendar. Please try again.'}, status=503)
    return JsonResponse({'holidays': ranges})
