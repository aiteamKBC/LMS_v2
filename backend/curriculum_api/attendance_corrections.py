"""Staff attendance corrections, scoped to a currently assigned module delivery.

Only the per-learner correction ledger is written. Teams evidence, recovery
requests and meeting scheduling are never changed here.
"""
import hashlib
import json

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from login.permissions import require_role
from coach_api.models import CoachAttendanceSourceAdjustment
from learner_api.models import LearnerProfile
from learner_api.attendance_assignments import module_roster, assigned_module_ids
from learner_api.attendance_lectures import read_native_occurrences, _aware
from learner_api.learner_detail import SOURCE_MODELS
from .models import LiveSession, LiveSessionOccurrence, ModuleAuthoringModule


class CorrectionError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def correction_state(adjustment):
    status = adjustment.status if adjustment and not adjustment.is_deleted else None
    state = None if adjustment is None else {
        'id': adjustment.pk, 'status': adjustment.status, 'deleted': adjustment.is_deleted,
        'updated': str(adjustment.updated_at),
    }
    return {'manualStatus': status or None,
            'version': hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()}


def session_context(series_id, number, module_id, *, lock=False):
    series = LiveSession.objects.using('enrolment').filter(pk=series_id).first()
    query = LiveSessionOccurrence.objects.using('enrolment').filter(live_session_id=series_id, session_number=number)
    occurrences = list((query.select_for_update() if lock else query)[:2])
    invalid = {'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}
    if not series or len(occurrences) != 1 or series.status in invalid or occurrences[0].status in invalid:
        raise CorrectionError('Session is unavailable. Refresh saved results.', 404)
    occurrence = occurrences[0]
    module_id = module_id or series.module_catalogue_id
    module = ModuleAuthoringModule.objects.using('enrolment').filter(
        pk=module_id, deleted_at__isnull=True, is_programme_deleted=False).first()
    if module is None:
        raise CorrectionError('Module is unavailable.', 404)
    if module_id != series.module_catalogue_id:
        from .session_results import replaced_module_register_rows
        rows = replaced_module_register_rows(module_id, [occurrence.id])
        if not any(str(row.get('source_occurrence_id')) == occurrence.id for row in rows):
            raise CorrectionError('This session does not belong to the selected module.', 404)
    source_id = occurrence.id if module_id == series.module_catalogue_id else f'{occurrence.id}:{module_id}'
    return module_id, occurrence, source_id, module_roster(module_id)


def states_for(source_id, roster):
    profiles = {row['learner_profile_id'] for row in roster if row.get('learner_profile_id')}
    saved = {row.learner_id: row for row in CoachAttendanceSourceAdjustment.objects.filter(
        learner_id__in=profiles, source='microsoft-teams', source_id=source_id)}
    return [{'learnerProfileId': row['learner_profile_id'], 'email': row['learner_email'],
             **correction_state(saved.get(row['learner_profile_id']))}
            for row in roster if row.get('learner_profile_id')]


def save_correction(module_id, occurrence, source_id, roster, payload, actor):
    action = payload.get('action')
    if action not in {'present', 'absent', 'reset'}:
        raise CorrectionError('Choose present, absent or reset.')
    try:
        profile_id = int(payload.get('learnerProfileId'))
    except (ValueError, TypeError):
        raise CorrectionError('Choose a learner assigned to this module.')
    if profile_id not in {row.get('learner_profile_id') for row in roster}:
        raise CorrectionError('Learner is not assigned to this module.', 403)
    if _aware(occurrence.scheduled_end) > timezone.now():
        raise CorrectionError('Attendance can only be corrected after the session ends.', 409)
    # Lock the learner too: first-time corrections have no ledger row to lock.
    profile = LearnerProfile.objects.select_for_update().get(pk=profile_id)
    source = SOURCE_MODELS['commercial'].all_learners.filter(pk=profile.enrolment_id).first()
    if source is None or module_id not in assigned_module_ids(source):
        raise CorrectionError('Learner source is unavailable.', 409)
    native = read_native_occurrences(source, module_ids=[module_id])
    if not any(str(row['session_id']) == source_id for row in native):
        raise CorrectionError('Session assignment changed. Refresh saved results.', 409)
    lookup = dict(learner_id=profile_id, source='microsoft-teams', source_id=source_id)
    saved = CoachAttendanceSourceAdjustment.objects.select_for_update().filter(**lookup).first()
    desired = '' if action == 'reset' else action
    same = ((saved is None and action == 'reset') or
            (saved is not None and not saved.is_deleted and saved.status == desired))
    if payload.get('version') != correction_state(saved)['version'] and not same:
        raise CorrectionError('Attendance changed in another window. Refresh before editing.', 409)
    if not same:
        saved, _ = CoachAttendanceSourceAdjustment.objects.update_or_create(**lookup, defaults={
            'status': desired, 'is_deleted': False, 'owner_email': actor, 'updated_by': actor})
    return {'learnerProfileId': profile_id, **correction_state(saved)}


@require_role('admin', 'staff')
@csrf_protect
@require_http_methods(['GET', 'POST'])
def session_attendance_correction(request, series_id, session_number):
    try:
        payload = request.GET if request.method == 'GET' else json.loads(request.body)
        if not hasattr(payload, 'get'):
            raise CorrectionError('Invalid attendance correction.')
        module_id = str(payload.get('moduleId') or '').strip()
        if request.method == 'POST' and any(request.GET.get(key) or payload.get(key) for key in ('viewAsCoach', 'view_as_coach')):
            raise CorrectionError('Attendance changes are unavailable in read-only view-as mode.', 403)
        with transaction.atomic(using='enrolment'), transaction.atomic():
            module_id, occurrence, source_id, roster = session_context(series_id, session_number, module_id, lock=request.method == 'POST')
            if request.method == 'GET':
                return JsonResponse({'corrections': states_for(source_id, roster),
                                     'editable': _aware(occurrence.scheduled_end) <= timezone.now()})
            actor = str(getattr(request.login_account, 'email', '') or '').strip()
            if not actor:
                raise CorrectionError('A staff account identity is required.', 403)
            result = save_correction(module_id, occurrence, source_id, roster, payload, actor)
        from coach_api.attendance_context import clear_context_cache
        clear_context_cache()
        return JsonResponse(result)
    except (ValueError, TypeError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid attendance correction.'}, status=400)
    except CorrectionError as error:
        return JsonResponse({'error': error.message}, status=error.status)
    except LearnerProfile.DoesNotExist:
        return JsonResponse({'error': 'Learner is no longer available. Refresh saved results.'}, status=409)
    except DatabaseError:
        return JsonResponse({'error': 'Attendance correction could not be saved. Refresh and retry.'}, status=503)
