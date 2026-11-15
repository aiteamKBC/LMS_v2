"""Staff-only holiday reference data and explicit import/sync actions."""
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from login.permissions import require_role

from . import country_calendars as calendars
from .calendar_policy import COUNTRIES


@require_role('admin', 'staff')
@require_http_methods(['GET', 'POST'])
def country_calendars(request):
    from . import views as v
    if request.method == 'GET':
        return JsonResponse(dict(countries=[dict(code=code, label=label, weekendDays=list(days))
                        for code, label, days in COUNTRIES],
                        calendars=[calendars.cache_status(row) for row in calendars.saved_calendars()]))
    payload = v.json_body(request)
    if not isinstance(payload, dict):
        return v.json_error('Invalid JSON body.')
    try:
        country = str(payload.get('country', '')).upper()
        start = v.parse_date(payload.get('startDate'))
        end = v.parse_date(payload.get('endDate')) or start
        if not start or not end or end < start or end.year - start.year > 6:
            return v.json_error('Choose a delivery period of at most seven calendar years.')
        if country == 'GB':
            rows = [v.serialize_holiday_row(row) for row in v.get_holiday_rows()]
        else:
            for year in range(start.year, end.year + 1):
                calendars.ensure_calendar(country, year)
            rows = calendars.holidays_for_period(country, start, end)
        return JsonResponse(dict(holidays=[row for row in rows if row['startDate'] <= end.isoformat()
                            and (row.get('endDate') or row['startDate']) >= start.isoformat()]))
    except (ValueError, TypeError) as exc:
        return v.json_error(str(exc), status=503 if isinstance(exc, calendars.CalendarUnavailable) else 400)


@require_role('admin', 'staff')
@require_http_methods(['POST'])
def sync_country_calendars(request):
    from . import england_holidays
    from . import views as v
    payload = v.json_body(request)
    if not isinstance(payload, dict):
        return v.json_error('Invalid JSON body.')
    country = str(payload.get('country', '')).upper()
    if country and country != 'GB':
        saved = None
        try:
            year = int(payload.get('year', 0))
            # This action updates saved calendars, never imports unused countries.
            saved = next((row for row in calendars.saved_calendars() if row['country'] == country and int(row['year']) == year), None)
            if saved is None:
                return v.json_error('This country/year has not been imported.', status=404)
            row = calendars.ensure_calendar(country, year, force=True)
            return JsonResponse({'calendar': {**calendars.cache_status(row), 'status': 'ok'}})
        except (ValueError, TypeError) as exc:
            if isinstance(exc, calendars.CalendarUnavailable) and saved:
                return JsonResponse({'calendar': calendars.record_sync_failure(saved, exc)}, status=207)
            return v.json_error(str(exc), status=503 if isinstance(exc, calendars.CalendarUnavailable) else 400)
    england = england_holidays.run_sync(source='manual', apply=True)
    england_holidays.reset_auto_sync_state()
    results = calendars.sync_saved() if not country else []
    success = england.get('status') == 'ok' and all(row['status'] == 'ok' for row in results)
    return JsonResponse(dict(success=success, england=england, calendars=results), status=200 if success else 207)
