"""Learner-scoped, read-only sources for the Training Plan dashboard."""
from collections import defaultdict
from datetime import datetime, timezone
import logging
import math
import time

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from login.permissions import learner_self_or_staff
from old_otjh.coach_booking import booking_url
from .learner_detail import SOURCE_MODELS
from .models import LearnerProfile
from .coach_assignment import current_coach, source_coach
from .student_activity import CURRENT_SUBJECTS_SQL, _builder_subject_metadata
from .subject_content import as_list, clean_text, safe_url
from .training_plan_contract import read_contract, contract_extract_metadata, selected_contract

log = logging.getLogger(__name__)


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def rows(cursor):
    return [dict(zip([field[0] for field in cursor.description], row)) for row in cursor.fetchall()]


def instant(value):
    # Curriculum stores UTC in timestamp-without-time-zone columns.
    if not value:
        return None
    if isinstance(value, datetime) and value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def plan_session(row):
    start = row['scheduled_start'] or row['start_datetime']
    end = row['scheduled_end']
    minutes = (end - start).total_seconds() / 60 if end and end > start else row['duration_minutes']
    return {'id': row['occurrence_id'] or row['session_id'], 'moduleId': row['module_id'],
            'title': clean_text(row['module_title']) or 'Live session', 'start': instant(start),
            'end': instant(end), 'minutes': minutes,
            'joinUrl': safe_url(row['join_url'] or row['series_join_url']) or None,
            'status': row['status'] or row['series_status'] or 'scheduled', 'attended': row['attended']}


def plan_module(row):
    text_fields = ('title', 'description', 'tutor_name', 'coach_name', 'programme_name',
                   'cohort_name', 'group_name', 'session_week_day', 'session_start_time', 'session_end_time')
    return {'id': row['id'], **{key: clean_text(row.get(key)) for key in text_fields},
            **{key: row[key].isoformat() if row.get(key) else None for key in ('start_date', 'end_date')},
            **{key: number(row.get(key)) for key in ('total_otjh', 'weeks_number', 'sessions_number')},
            'learning_outcomes': []}


def attach_curriculum_slots(module_rows, by_id, week_counts):
    """Give every learner module the curriculum slot spine the Builder shows.

    This is a READ of the curriculum scheduler, not a second one. The holidays
    come from ``cohort_selected_holidays_by_cohort`` -- the same resolution the
    Module Builder, the Teams series and the tutor conflict check use, with the
    cohort's own ``excluded_holiday_ids`` deny-list already applied upstream --
    and the spine comes from ``module_session_plan_for_count``, which is the
    single door onto ``build_module_session_plan``. Nothing about holidays or
    Reading Weeks is decided here, so the learner cannot be shown a timeline the
    curriculum does not itself hold.

    ``slots`` is what makes a holiday visible to a learner at all: a closed
    delivery slot delivers no session, so a learner reading only session dates
    sees an unexplained gap. Reading Weeks must come from this spine and never
    be inferred from gaps between session dates -- a gap is also what a term
    break, an unauthored week or a module that simply does not deliver that week
    looks like.

    Holidays are resolved once for every cohort on the page rather than per
    module, because every module of a cohort shares that cohort's holidays.
    """
    from curriculum_api.views import (
        cohort_selected_holidays_by_cohort, module_session_plan_for_count,
        module_stored_session_count,
    )

    try:
        holidays = cohort_selected_holidays_by_cohort(
            [row.get('cohort_id') for row in module_rows]
        )
    except Exception:
        log.warning('Could not resolve cohort holidays for the training plan.', exc_info=True)
        holidays = {}

    for row in module_rows:
        module = by_id.get(row['id'])
        if module is None:
            continue
        week_count = week_counts.get(row['id'], 0)
        try:
            plan = module_session_plan_for_count(
                row,
                module_stored_session_count(row, week_count),
                holidays=holidays.get(str(row.get('cohort_id') or ''), []),
            )
        except Exception:
            log.warning('Could not plan curriculum slots for module %s.', row['id'], exc_info=True)
            plan = {}
        module['curriculumSlots'] = plan.get('slots') or []
        # The effective delivery end is the scheduler's own -- the last
        # DELIVERED session, holiday shifts included. Deliberately separate from
        # the stored `end_date` the module row carries, which a human may have
        # typed and which no longer describes the run once a closure moves it.
        module['effectiveEndDate'] = plan.get('finalEndDate') or ''
        module['originalEndDate'] = plan.get('originalEndDate') or ''


def assigned_group_coach(source, modules):
    """A different cohort's assigned module must not supply this learner's coach."""
    placement = [clean_text(getattr(source, key, '')).casefold() for key in ('programme', 'cohort', 'group')]
    if not all(placement):
        return ''
    coaches = {clean_text(module.get('coach_name')) for module in modules
               if [clean_text(module.get(key)).casefold() for key in ('programme_name', 'cohort_name', 'group_name')] == placement}
    coaches.discard('')
    return next(iter(coaches)) if len(coaches) == 1 else ''


def find_contract(cursor, aptem_id):
    cursor.execute('''SELECT c.id,c.azure_path,c.training_plan_planned_hours,
        c.document_name AS original_name,
        coalesce(nullif(a.display_name,''),c.document_name) AS document_name,
        c.date,c.fetched_at,c.fully_signed_date,c.raw AS extraction_metadata
        FROM fetching_evidence.aptem_cv_contracts_probe c
        LEFT JOIN "Audit".contract_document_archive a ON a.contract_id=c.id
        WHERE c.learner_id=%s
          AND lower(coalesce(nullif(a.display_name,''),c.document_name)) ~ 'training[[:space:]_-]*plan'
          AND a.archived_at IS NULL AND a.deleted_at IS NULL
        ORDER BY coalesce(c.fully_signed_date,c.date) DESC NULLS LAST,c.id DESC''', [aptem_id])
    return selected_contract(rows(cursor))


def contract_plan(source, contract):
    months, status = {}, 'not-available'
    if contract and contract['azure_path']:
        try:
            version = f"{contract['fetched_at']}:{int(time.time() // 1800)}"
            extracted = read_contract(contract['azure_path'], contract['training_plan_planned_hours'], version,
                                      contract_extract_metadata(contract.get('extraction_metadata')))
            if extracted:
                months = {key: {**value, 'label': '', 'source': 'contract'} for key, value in extracted.items()}
                status = 'ready'
            else:
                status = 'unverified'
        except Exception:
            log.warning('Training-plan contract could not be read for enrolment %s', source.pk)
            status = 'unavailable'
    return {'months': months, 'contractStatus': status}


def read_dashboard(source, section=None):
    try:
        aptem_id = int(str(source.aptem_id or '').strip())
    except (ValueError, TypeError):
        aptem_id = None
    email = str(source.email or '').strip().casefold()
    actual, modules, sessions = [], [], []
    historical = None
    contract = None
    profile = LearnerProfile.objects.filter(enrolment_id=source.pk).first() if section != 'contract' else None
    with connections['enrolment'].cursor() as cur:
        if aptem_id:
            cur.execute('''SELECT l.learner_email,l.coach_name,l.coach_email
                FROM "Last_audit".learners l
                WHERE l.aptem_id=%s''', [aptem_id])
            candidates = rows(cur)
            if len(candidates) > 1 or (candidates and (not email or email != str(candidates[0]['learner_email'] or '').strip().casefold())):
                raise LookupError('The training plan is not linked to this learner.')
            historical = candidates[0] if candidates else None
            if section != 'overview':
                contract = find_contract(cur, aptem_id)
        if section == 'contract':
            return contract_plan(source, contract)
        if aptem_id:
            cur.execute('''SELECT month,group_id,sum(actual_hours) AS hours,count(*) AS activity_count
                FROM structured_manual_activities.manual_learner_activities
                WHERE aptem_id=%s AND accepted IS TRUE AND deleted_at IS NULL
                GROUP BY month,group_id ORDER BY month,group_id''', [aptem_id])
            actual = [{'month': row['month'], 'groupId': str(row['group_id']) if row['group_id'] is not None else None,
                       'hours': number(row['hours']) or 0, 'count': row['activity_count']} for row in rows(cur)]
        cur.execute(CURRENT_SUBJECTS_SQL, [source.pk])
        refs = [f'current:{row[0]}' for row in cur.fetchall()]
        if aptem_id and historical:
            cur.execute('''SELECT gl.group_id FROM "Last_audit".group_learners gl
                JOIN "Last_audit".learners l ON l.learner_id=gl.learner_id WHERE l.aptem_id=%s''', [aptem_id])
            refs.extend(f'legacy:{row[0]}' for row in cur.fetchall())
        _, links = _builder_subject_metadata(cur, refs)
        ids = sorted({item['id'] for item in links.values()})
        if ids:
            # cohort_id is read so the curriculum scheduler can resolve this
            # module's cohort holidays -- including the ones a delivery team
            # unticked. It is not published to the learner.
            cur.execute('''SELECT m.module_catalogue_id AS id,m.title,m.description,m.start_date,m.end_date,m.tutor_name,
                coalesce(nullif(btrim(g.coach_name),''),m.coach_name) AS coach_name,
                m.programme_name,m.cohort_name,m.group_name,m.total_otjh,m.weeks_number,m.sessions_number,
                m.cohort_id,
                coalesce(nullif(m.session_week_day,''),g.session_week_day) AS session_week_day,
                coalesce(nullif(m.session_start_time,''),g.session_start_time) AS session_start_time,
                coalesce(nullif(m.session_end_time,''),g.session_end_time) AS session_end_time
                FROM curriculum.modules m LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
                WHERE m.module_catalogue_id=ANY(%s) ORDER BY m.title''', [ids])
            module_rows = rows(cur)
            modules = [plan_module(row) for row in module_rows]
            by_id = {module['id']: module for module in modules}
            week_counts = defaultdict(int)
            cur.execute('''SELECT module_catalogue_id,learning_outcomes FROM curriculum.weeks
                WHERE module_catalogue_id=ANY(%s) AND (deleted_at IS NULL OR deleted_via_parent IS NOT NULL)
                ORDER BY display_order,week_number,id''', [ids])
            for row in rows(cur):
                week_counts[row['module_catalogue_id']] += 1
                module = by_id.get(row['module_catalogue_id'])
                if module is not None:
                    for outcome in as_list(row['learning_outcomes']):
                        text = clean_text(outcome) if isinstance(outcome, str) else ''
                        if text and text not in module['learning_outcomes']:
                            module['learning_outcomes'].append(text)
            attach_curriculum_slots(module_rows, by_id, week_counts)
            cur.execute('''SELECT s.id AS session_id,s.module_catalogue_id AS module_id,s.module_title,
                s.start_datetime,s.duration_minutes,s.join_url AS series_join_url,s.repeat_pattern,s.status AS series_status,
                o.id AS occurrence_id,o.scheduled_start,o.scheduled_end,o.join_url,o.status,
                CASE WHEN o.attendance_report_id IS NULL OR o.attendance_report_id='' THEN NULL
                     ELSE EXISTS(SELECT 1 FROM curriculum.live_session_attendance a
                         WHERE a.occurrence_id=o.id AND lower(btrim(a.email))=%s AND a.total_attendance_seconds>0) END AS attended
                FROM curriculum.live_sessions s LEFT JOIN curriculum.live_session_occurrences o ON o.live_session_id=s.id
                WHERE s.module_catalogue_id=ANY(%s) AND lower(s.status) NOT IN ('cancelled','deleted','failed','superseded')
                  AND (o.id IS NULL OR lower(o.status) NOT IN ('cancelled','deleted','failed','superseded'))
                ORDER BY coalesce(o.scheduled_start,s.start_datetime)''', [email, ids])
            for row in rows(cur):
                # Recurring dates come from actual occurrences; never manufacture them.
                if not row['occurrence_id'] and row['repeat_pattern'] not in ('none', '', None):
                    continue
                start = row['scheduled_start'] or row['start_datetime']
                if not start:
                    continue
                sessions.append(plan_session(row))
    # The overview must never wait for an Azure PDF download. Older clients
    # still receive the complete response when no section was requested.
    contract_data = ({'months': {}, 'contractStatus': 'loading'} if section == 'overview'
                     else contract_plan(source, contract))
    contact = current_coach(source, profile, historical)
    coach_name, coach_email = contact['coach_name'], contact['coach_email']
    if not coach_name and not coach_email and source_coach(source) is None:
        coach_name = assigned_group_coach(source, modules)
    from .calendar import coaching_events_for_learner
    # Use the same active programme cycle as the calendar booking destination.
    active_profile = profile if profile and profile.lifecycle_status == 'active' else None
    events = coaching_events_for_learner(source, active_profile)
    event_fields = ('id', 'eventKey', 'title', 'source', 'sequence', 'status', 'date', 'targetDate',
                    'scheduledDate', 'scheduledTime', 'durationMinutes', 'coachName', 'invited')
    reviews = [{**{key: event.get(key) for key in event_fields},
                'meetingLink': safe_url(event.get('meetingLink')) or None} for event in events
               if event.get('source') in ('mcr', 'progress-review', 'student-support')]
    return {**contract_data, 'actual': actual, 'actualAvailable': bool(aptem_id), 'modules': modules, 'moduleLinks': links,
            'sessions': sessions, 'reviews': reviews,
            'coach': {'name': coach_name, 'bookingUrl': booking_url(coach_email)},
            'generatedAt': datetime.now(timezone.utc).isoformat()}


@require_GET
@learner_self_or_staff(kwarg='pk')
def training_plan_dashboard(request, kind, pk):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    try:
        source = model.all_learners.get(pk=pk)
        section = request.GET.get('section')
        if section not in (None, 'overview', 'contract'):
            return JsonResponse({'error': 'Invalid training plan section.'}, status=400)
        payload = read_dashboard(source, section=section)
    except model.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except LookupError as error:
        return JsonResponse({'error': str(error)}, status=404)
    except DatabaseError:
        log.exception('Could not read training-plan dashboard')
        return JsonResponse({'error': 'Could not load your training plan. Please try again.'}, status=503)
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    return response
