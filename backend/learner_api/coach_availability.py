"""Read-only coach free slots, combining Outlook working hours and LMS bookings."""
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import learner_self_or_staff, staff_only


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
    # Whose calendar to check depends on which meeting is being booked, and it
    # has to be the same mailbox the booking itself will use -- otherwise the
    # slots offered describe one person's day and the invitation lands in
    # another's.
    #
    # ``collegeDay`` is the first session, which ``learner_calendar_book``
    # creates on the *case owner's* mailbox: it happens before the learner is
    # Active and before any coach exists, so requiring a coach here would be
    # circular -- the learner cannot become Active until the session it gates
    # has happened. Everything else is a session within a running programme,
    # held with the assigned coach.
    college_day = request.GET.get('collegeDay') in ('1', 'true')
    if college_day:
        from .calendar import _case_owner_contact
        owner_email = (_case_owner_contact(learner)[0] or '').strip()
        if not owner_email:
            return JsonResponse(
                {'error': 'No case owner has been assigned to you yet. '
                          'Please contact your programme team.'},
                status=400,
            )
    else:
        profile = learner_profile_for_source(learner, pk, active_only=True)
        if not profile or not profile.coach_email:
            return JsonResponse({'error': 'No coach has been assigned to you yet.'}, status=400)
        owner_email = profile.coach_email.strip()
    try:
        day = date.fromisoformat(request.GET.get('date', ''))
        offset = int(request.GET.get('timezoneOffsetMinutes', '0'))
        if not -840 <= offset <= 840:
            raise ValueError()
    except ValueError:
        return JsonResponse({'error': 'Choose a valid date and timezone.'}, status=400)
    unconfirmed = ''
    try:
        free = free_slots(owner_email, day, offset)
    except AvailabilityUnavailable as exc:
        # A first session must stay bookable when Microsoft cannot be reached.
        #
        # For the MCM picker an outage is a hard stop: the learner already has
        # a programme and can try again later. The first session is the meeting
        # that *opens* the programme, so the same answer would leave a learner
        # shut out of everything for as long as Graph is unwell, with nothing
        # to do about it -- and the case owner's calendar not being linked at
        # all is not a temporary outage, it is a permanent one.
        #
        # So the college day is offered unchecked, and said to be unchecked.
        # The booking still goes through the same Graph call, which either
        # succeeds or returns its own warning; this only decides whether the
        # learner is allowed to try. Double-booking an hour is a smaller harm
        # than a learner who cannot start at all, and it is one a case owner
        # can see and move.
        if not college_day:
            return JsonResponse({'error': str(exc)}, status=503)
        free = college_day_hours()
        unconfirmed = str(exc)
    # ``collegeDay`` asks for the first-session shape: the college's own
    # 09:00-16:00 working day, on the hour, every hour reported with a flag.
    # Without it the answer stays the 15-minute grid of the coach's own hours,
    # which is what the MCM picker wants -- a learner rearranging a monthly
    # meeting around their job is well served by 10:15, and their coach's
    # working day is the one that meeting happens in.
    #
    # A first session is a different thing: it is the meeting that starts the
    # programme, held in Kent, and it is offered as a short list of hours the
    # college works so a learner picks a slot rather than composes a time.
    if college_day:
        slots = college_day_availability(free)
        payload = {
            'date': day.isoformat(),
            'slots': slots,
            'times': [slot['time'] for slot in slots if slot['available']],
            'durationMinutes': 60,
        }
        # Named so the form can say the hours are not confirmed. Not an
        # `error`: the learner can still book, and calling it an error would
        # tell them to stop when the one thing they must do is carry on.
        if unconfirmed:
            payload['unconfirmed'] = unconfirmed
    else:
        payload = {'date': day.isoformat(), 'times': free, 'durationMinutes': 60}
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    return response


#: The college's own working day, in UK wall clock. A first session may start
#: at 09:00 at the earliest and must finish by 17:00, so the last hour-long
#: slot starts at 16:00.
COLLEGE_DAY_START = time(9, 0)
COLLEGE_LAST_SLOT_START = time(16, 0)

#: Enrolment offers slots on the hour. ``free_slots`` walks a 15-minute grid,
#: which is right for a learner rearranging around their own day but reads as
#: noise on a form where somebody is picking a first meeting.
COLLEGE_SLOT_MINUTES = 60


def college_day_hours():
    """Every hour a first session may start, in UK wall clock."""
    return [
        f"{hour:02d}:00"
        for hour in range(COLLEGE_DAY_START.hour, COLLEGE_LAST_SLOT_START.hour + 1)
    ]


def within_college_hours(slots):
    """Keep only the free slots that fall inside the college's own working day.

    ``free_slots`` answers "when is this mailbox free", and it decides that
    against the *owner's* Outlook working hours, in the owner's own timezone --
    then emits the time in the caller's zone. For a case owner whose mailbox is
    set to another country (``working_zone`` maps several) those are different
    days: a Cairo 09:00-17:00 becomes 07:00-15:00 in the UK, and a 6:00 AM slot
    appears on a form for a Kent college.

    That is not merely untidy, it books the wrong hour. The first session is
    created at UK wall clock (``first_session.UK``), so a slot shown as 6:00 AM
    books 06:00 in Kent -- a time the case owner is not, in fact, working. The
    college's day is therefore applied here as well, and on the hour, because
    that is the day the meeting actually happens in.

    Applied in this endpoint rather than inside ``free_slots``: the learner
    calendar and the MCM picker share that function and legitimately want the
    owner's own hours on a 15-minute grid.
    """
    kept = []
    for slot in slots:
        try:
            at = time.fromisoformat(slot)
        except ValueError:
            continue
        if at.minute or at.second:
            continue
        if COLLEGE_DAY_START <= at <= COLLEGE_LAST_SLOT_START:
            kept.append(slot)
    return kept


def college_day_availability(free):
    """The whole college day, each hour marked free or not.

    The form lists every hour rather than only the free ones, so staff can see
    the shape of the case owner's day -- "10am is taken" is more useful than
    10am silently missing, which reads as the college not working then.

    A taken hour is still reported, but flagged: the caller renders it
    unselectable. Only ``available`` decides that, never the label, so an hour
    that cannot be booked can never be picked by mistake.
    """
    free_hours = set(within_college_hours(free))
    return [
        {"time": hour, "available": hour in free_hours}
        for hour in college_day_hours()
    ]


@require_GET
@staff_only()
def case_owner_available_slots(request):
    """Free slots for a named case owner, for a learner who does not exist yet.

    ``coach_available_slots`` above resolves the coach from the learner's own
    profile, which the enrolment form cannot do: at that point there is no
    learner row and no profile -- only the case owner picked in the form. The
    slot maths is identical, so only the way the mailbox is found differs.

    Staff-only rather than ``learner_self_or_staff``: there is no learner to be
    "self" here, and a coach's calendar free/busy is not public. The name comes
    from the same picker that fills the learner's case owner, and is resolved
    through ``case_owner_coach`` -- the very function the booking itself uses --
    so the slots shown are the mailbox the meeting will actually be created on.
    """
    from .coach_assignment import case_owner_coach

    owner = (request.GET.get('caseOwner') or '').strip()
    if not owner:
        return JsonResponse({'error': 'Choose a case owner first.'}, status=400)
    # An ambiguous or unknown name resolves to an empty email rather than
    # somebody else's address; without a mailbox there is nothing to check.
    owner_email = (case_owner_coach(owner).get('coach_email') or '').strip()
    if not owner_email:
        return JsonResponse(
            {'error': 'That case owner has no email address on their staff record, '
                      'so their calendar cannot be checked.'},
            status=400,
        )
    try:
        day = date.fromisoformat(request.GET.get('date', ''))
        offset = int(request.GET.get('timezoneOffsetMinutes', '0'))
        if not -840 <= offset <= 840:
            raise ValueError()
    except ValueError:
        return JsonResponse({'error': 'Choose a valid date and timezone.'}, status=400)
    # An outage is a hard stop here, unlike the learner's own first-session
    # picker: this form is being filled in by staff, who can chase an unlinked
    # calendar or simply come back -- and who would otherwise be booking a real
    # meeting into hours nobody has checked.
    try:
        free = free_slots(owner_email, day, offset)
    except AvailabilityUnavailable as exc:
        return JsonResponse({'error': str(exc)}, status=503)
    # ``slots`` is the whole college day with each hour flagged; ``times`` stays
    # the bookable subset, so anything reading the older shape still only ever
    # sees hours that can actually be booked.
    slots = college_day_availability(free)
    response = JsonResponse({
        'date': day.isoformat(),
        'slots': slots,
        'times': [slot['time'] for slot in slots if slot['available']],
        'durationMinutes': 60,
    })
    response['Cache-Control'] = 'private, no-store'
    return response
