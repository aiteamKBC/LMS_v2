"""Read-only coach free slots, combining Outlook working hours and LMS bookings."""
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import learner_self_or_staff


class AvailabilityUnavailable(Exception):
    pass


def working_zone(name):
    aliases = {'GMT Standard Time': 'Europe/London', 'Egypt Standard Time': 'Africa/Cairo',
               'UTC': 'UTC', 'Eastern Standard Time': 'America/New_York',
               'Pacific Standard Time': 'America/Los_Angeles', 'W. Europe Standard Time': 'Europe/Berlin'}
    try:
        return ZoneInfo(aliases.get(name, name))
    except Exception as exc:
        raise AvailabilityUnavailable('The coach calendar timezone could not be read.') from exc


def free_slots(owner_email, day, offset, *, exclude_event_key=''):
    from coach_api.views import microsoft_graph_request
    from coach_api.models import CoachCalendarEvent
    from .booking_calendar import booking_date_restriction
    if booking_date_restriction(day):
        return []
    # JavaScript getTimezoneOffset is UTC minus the displayed local time.
    local_zone = timezone(timedelta(minutes=-offset))
    start = datetime.combine(day, time.min, local_zone).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    try:
        result = microsoft_graph_request('POST', f'users/{quote(owner_email, safe="")}/calendar/getSchedule', payload={
            'schedules': [owner_email], 'startTime': {'dateTime': start.isoformat(), 'timeZone': 'UTC'},
            'endTime': {'dateTime': end.isoformat(), 'timeZone': 'UTC'}, 'availabilityViewInterval': 15})
        schedules = result.get('value') or []
        schedule = next((s for s in schedules if str(s.get('scheduleId', '')).lower() == owner_email.lower()), None)
        if not schedule or schedule.get('error'):
            raise ValueError('Missing schedule')
        hours = schedule['workingHours']
        zone = working_zone(hours['timeZone']['name'])
        work_start = time.fromisoformat(hours['startTime'])
        work_end = time.fromisoformat(hours['endTime'])
        days = {d.lower() for d in hours['daysOfWeek']}
        view = schedule['availabilityView']
        if len(view) < 96:
            raise ValueError('Incomplete availability')
    except Exception as exc:
        raise AvailabilityUnavailable('Could not check the coach calendar. Please retry before booking.') from exc
    busy = []
    records = CoachCalendarEvent.objects.filter(owner_email__iexact=owner_email,
        scheduled_date__range=(day - timedelta(days=1), day + timedelta(days=1)),
        scheduled_time__isnull=False).exclude(status__in=['cancelled', 'not-scheduled', 'failed'])
    if exclude_event_key:
        records = records.exclude(event_key=exclude_event_key)
    # Existing coach bookings use the timetable's UK wall-clock convention.
    for record in records:
        at = datetime.combine(record.scheduled_date, record.scheduled_time, ZoneInfo('Europe/London'))
        busy.append((at, at + timedelta(minutes=record.duration_minutes or 60)))
    now = datetime.now(timezone.utc)
    slots = []
    for index in range(93):
        at = start + timedelta(minutes=15 * index)
        until = at + timedelta(minutes=60)
        local = at.astimezone(zone)
        finish = until.astimezone(zone)
        if at <= now or any(v != '0' for v in view[index:index + 4]):
            continue
        if local.strftime('%A').lower() not in days or local.date() != finish.date():
            continue
        if local.time() < work_start or finish.time() > work_end:
            continue
        if any(at < b and until > a for a, b in busy):
            continue
        slots.append(at.astimezone(local_zone).strftime('%H:%M'))
    return slots


@require_GET
@learner_self_or_staff(kwarg="pk")
def coach_available_slots(request, kind, pk):
    from .learner_detail import SOURCE_MODELS
    from .identity import learner_profile_for_source
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Unknown learner kind.'}, status=404)
    learner = model.all_learners.filter(pk=pk).first()
    if learner is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    # Two different failures, kept apart. A learner who has not been released
    # into delivery yet has no active profile at all, and telling them their
    # coach is missing sends them chasing an assignment that is already there:
    # the coach sits on the enrolment row, which this endpoint never reads.
    # learner_calendar_book draws the same distinction -- keep the wording.
    profile = learner_profile_for_source(learner, pk, active_only=True)
    if profile is None:
        return JsonResponse({'error': 'Only Active learners can book coach sessions.'}, status=400)
    if not profile.coach_email:
        return JsonResponse({'error': 'No coach has been assigned to you yet.'}, status=400)
    try:
        day = date.fromisoformat(request.GET.get('date', ''))
        offset = int(request.GET.get('timezoneOffsetMinutes', '0'))
        if not -840 <= offset <= 840:
            raise ValueError()
    except ValueError:
        return JsonResponse({'error': 'Choose a valid date and timezone.'}, status=400)
    try:
        slots = free_slots(profile.coach_email.strip(), day, offset)
    except AvailabilityUnavailable as exc:
        return JsonResponse({'error': str(exc)}, status=503)
    response = JsonResponse({'date': day.isoformat(), 'times': slots, 'durationMinutes': 60})
    response['Cache-Control'] = 'private, no-store'
    return response
