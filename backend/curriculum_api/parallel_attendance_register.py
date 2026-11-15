"""Save unambiguous alternative-group attendance in the learner register."""
from collections import defaultdict

from django.db import connections, router, transaction
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from learner_api.alternative_recovery import equivalent_alternatives_by_occurrence
from learner_api.models import LearnerProfile
from .attendance_membership import assigned_module_ids_by_profile
from .models import LiveSession, LiveSessionAttendance, LiveSessionLearnerAttendance, LiveSessionOccurrence, ModuleAuthoringModule
from .session_results_policy import instant


def choose_originals(candidates, assignments, attended_module):
    """Return a single assigned equivalent occurrence, or no match when ambiguous."""
    assigned = set(map(str, assignments))
    if str(attended_module) in assigned:
        return []
    matches = {(str(row['id']), str(row['moduleCatalogueId'])) for row in candidates
               if str(row.get('moduleCatalogueId') or '') in assigned}
    return list(matches) if len(matches) == 1 else []


def saved_parallel_links(register_rows, *, database=None):
    """Read saved provenance for display and avoid counting its guest twice."""
    profile_ids = {row['learner_profile_id'] for row in register_rows}
    if not profile_ids:
        return {}, {}
    database = database or router.db_for_read(LiveSessionLearnerAttendance) or 'default'
    linked = list(LiveSessionLearnerAttendance.objects.using(database).filter(
        learner_profile_id__in=profile_ids, parallel_source_occurrence_id__isnull=False,
    ).exclude(attendance_basis='staff', attendance_status='absent').values('learner_profile_id', 'occurrence_id', 'module_catalogue_id',
             'parallel_source_occurrence_id', 'parallel_source_module_id'))
    module_ids = {row['parallel_source_module_id'] for row in linked}
    # A module names its group by group_id; the name is the group's own.
    group_by_module = dict(ModuleAuthoringModule.objects.using(database).filter(
        module_catalogue_id__in=module_ids,
    ).exclude(status='inactive').exclude(group_id__isnull=True).values_list('module_catalogue_id', 'group_id'))
    group_names = {}
    if group_by_module:
        with connections[database].cursor() as cursor:
            cursor.execute('SELECT group_id, group_name FROM curriculum.groups WHERE group_id = ANY(%s)',
                           [sorted(set(group_by_module.values()))])
            group_names = dict(cursor.fetchall())
    names = {module_id: group_names.get(group_id) for module_id, group_id in group_by_module.items()}
    dates = dict(LiveSessionOccurrence.objects.using(database).filter(
        id__in={row['occurrence_id'] for row in linked}).values_list('id', 'scheduled_start'))
    originals, guests = {}, {}
    for row in linked:
        original = (row['learner_profile_id'], str(row['occurrence_id']), str(row['module_catalogue_id']))
        guest = (row['learner_profile_id'], str(row['parallel_source_occurrence_id']),
                 str(row['parallel_source_module_id']))
        originals[original] = {'recoveryOccurrenceId': guest[1],
                               'recoveryGroup': names.get(row['parallel_source_module_id']) or ''}
        start = instant(dates.get(row['occurrence_id']))
        guests[guest] = {'makeupForOccurrenceId': original[1], 'countsAsSession': False,
                         **({'makeupForDate': timezone.localtime(start).date().isoformat()} if start else {})}
    return originals, guests


def revoke_parallel_credit(row, *, database):
    """Restore independent evidence when a guest decision is withdrawn."""
    if row.attendance_basis != 'staff':
        if row.qr_attendance_id is not None:
            row.attendance_status = 'present'
            row.attendance_basis = 'teams_qr' if row.teams_attendance_status == 'present' else 'qr'
        elif row.teams_attendance_status in {'present', 'absent'}:
            row.attendance_status = row.teams_attendance_status
            row.attendance_basis = 'teams'
        elif row.parallel_created:
            # This row existed only to hold the revoked credit; it had no
            # independent attendance decision. FK failures roll back the edit.
            row.delete(using=database)
            return
        else:
            row.attendance_status = row.parallel_previous_status
            row.attendance_basis = row.parallel_previous_basis
    row.parallel_source_occurrence_id = None
    row.parallel_source_module_id = None
    row.parallel_previous_status = None
    row.parallel_previous_basis = None
    row.parallel_created = False
    row.updated_at = timezone.now()
    row.save(using=database, update_fields=['attendance_status', 'attendance_basis', 'parallel_source_occurrence_id',
        'parallel_source_module_id', 'parallel_previous_status', 'parallel_previous_basis', 'parallel_created', 'updated_at'])


def reconcile_parallel_attendance(occurrence_ids, *, database=None):
    """Apply saved QR or verified raw Teams evidence for the specified deliveries.

    Called within the source write transaction. No Graph calls or fabricated
    Teams durations; absent or ambiguous identities never create attendance.
    """
    database = database or router.db_for_write(LiveSessionLearnerAttendance) or 'default'
    ids = {str(value) for value in occurrence_ids if value}
    if not ids:
        return 0
    occurrences = {str(row['id']): row for row in LiveSessionOccurrence.objects.using(database)
                   .filter(id__in=ids).values('id', 'live_session_id', 'attendance_report_id', 'status')}
    if not occurrences:
        return 0
    alternatives = equivalent_alternatives_by_occurrence(occurrences, database=database)
    guest_sessions = dict(LiveSession.objects.using(database).filter(
        id__in={row['live_session_id'] for row in occurrences.values()}).values_list('id', 'module_catalogue_id'))
    guest_rows = list(LiveSessionLearnerAttendance.objects.using(database).filter(
        occurrence_id__in=occurrences).values('learner_profile_id', 'occurrence_id',
                                             'module_catalogue_id', 'attendance_status', 'attendance_basis',
                                             'qr_attendance_id', 'teams_attendance_status', 'attendance_report_id'))
    raw = list(LiveSessionAttendance.objects.using(database).filter(
        occurrence_id__in=[key for key, row in occurrences.items() if row.get('attendance_report_id')],
        total_attendance_seconds__gt=180).values('occurrence_id', 'email'))
    emails = {str(row.get('email') or '').strip().lower() for row in raw if row.get('email')}
    email_profiles = defaultdict(list)
    if emails:
        for profile in (LearnerProfile.objects.using(database).annotate(email_fold=Lower(Trim('email')))
                        .filter(email_fold__in=emails).only('id', 'email')):
            email_profiles[str(profile.email or '').strip().lower()].append(profile.id)
    # A saved guest decision wins over raw Teams evidence for the same module.
    evidence = {(row['learner_profile_id'], str(row['occurrence_id']), str(row['module_catalogue_id'])):
                ('present' if row['attendance_status'] == 'present'
                 and (row['qr_attendance_id'] is not None or
                      (row['teams_attendance_status'] == 'present' and row['attendance_report_id']))
                 else 'absent') for row in guest_rows}
    for row in raw:
        ids_for_email = email_profiles[str(row.get('email') or '').strip().lower()]
        occurrence_id = str(row['occurrence_id'])
        module_id = guest_sessions.get(occurrences[occurrence_id]['live_session_id'])
        if len(ids_for_email) == 1 and module_id:
            evidence.setdefault((ids_for_email[0], occurrence_id, str(module_id)), 'present')
    for key in evidence:
        if str(occurrences[key[1]].get('status') or '').strip().lower() in {
                'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}:
            evidence[key] = 'absent'
    from coach_api.models import CoachAttendanceSourceAdjustment
    linked = list(LiveSessionLearnerAttendance.objects.using(database).filter(
        parallel_source_occurrence_id__in=occurrences).values(
            'id', 'learner_profile_id', 'parallel_source_occurrence_id', 'parallel_source_module_id'))
    source_ids = {value for profile_id, occurrence_id, module_id in evidence
                  for value in (occurrence_id, f'{occurrence_id}:{module_id}')}
    source_ids.update(value for row in linked for value in (str(row['parallel_source_occurrence_id']),
        f"{row['parallel_source_occurrence_id']}:{row['parallel_source_module_id']}"))
    decisions = {(row['learner_id'], str(row['source_id'])) for row in
                 CoachAttendanceSourceAdjustment.objects.using(database).filter(
                     source='microsoft-teams', source_id__in=source_ids).values('learner_id', 'source_id', 'status', 'is_deleted')
                 if row['is_deleted'] or row['status'] == 'absent'}
    for key in list(evidence):
        profile_id, occurrence_id, module_id = key
        if (profile_id, occurrence_id) in decisions or (profile_id, f'{occurrence_id}:{module_id}') in decisions:
            evidence[key] = 'absent'
    present_evidence = [key for key, value in evidence.items() if value == 'present']
    with transaction.atomic(using=database):
        for link in linked:
            guest = (link['learner_profile_id'], str(link['parallel_source_occurrence_id']),
                     str(link['parallel_source_module_id']))
            if evidence.get(guest) == 'present':
                continue
            LearnerProfile.objects.using(database).select_for_update().get(id=guest[0])
            row = LiveSessionLearnerAttendance.objects.using(database).select_for_update().filter(
                id=link['id'], parallel_source_occurrence_id=guest[1], parallel_source_module_id=guest[2]).first()
            if row:
                revoke_parallel_credit(row, database=database)
    evidence = present_evidence
    if not evidence:
        return 0
    profiles = {p.id: p for p in LearnerProfile.objects.using(database)
                .filter(id__in={key[0] for key in evidence}).only('id', 'enrolment_id', 'email', 'full_name')}
    # Module membership from the normalized plan records (the roster's rule),
    # never the legacy Created_users Learning_plan/Training_plan. Only the
    # modules choose_originals compares: each attended guest module and the
    # modules of its equivalent originals.
    compared_modules = {str(guest_module) for _, _, guest_module in evidence}
    compared_modules.update(str(item.get('moduleCatalogueId') or '')
                            for _, guest_id, _ in evidence for item in alternatives.get(guest_id, []))
    compared_modules.discard('')
    assignments = assigned_module_ids_by_profile(set(profiles), compared_modules)
    original_ids = {str(item['id']) for values in alternatives.values() for item in values}
    originals = {str(row['id']): row for row in LiveSessionOccurrence.objects.using(database)
                 .filter(id__in=original_ids).values('id', 'live_session_id')}
    changed = 0
    with transaction.atomic(using=database):
        for profile_id, guest_id, guest_module in sorted(evidence):
            profile = profiles.get(profile_id)
            if profile is None:
                continue
            choices = choose_originals(alternatives.get(guest_id, []), assignments.get(profile_id, set()), guest_module)
            if not choices:
                continue
            original_id, original_module = choices[0]
            original = originals.get(original_id)
            if not original:
                continue
            # Serialize sources for this learner, including when the target row
            # does not exist yet. The unique index enforces no reused evidence.
            LearnerProfile.objects.using(database).select_for_update().get(id=profile_id)
            if LiveSessionLearnerAttendance.objects.using(database).filter(
                    learner_profile_id=profile_id, parallel_source_occurrence_id=guest_id
                    ).exclude(occurrence_id=original_id, module_catalogue_id=original_module).exists():
                continue
            decisions = CoachAttendanceSourceAdjustment.objects.using(database).filter(
                learner_id=profile_id, source='microsoft-teams',
                source_id__in=[original_id, f'{original_id}:{original_module}'])
            if any(row['is_deleted'] or row['status'] for row in decisions.values('is_deleted', 'status')):
                continue
            row = LiveSessionLearnerAttendance.objects.using(database).select_for_update().filter(
                learner_profile_id=profile_id, occurrence_id=original_id, module_catalogue_id=original_module).first()
            if row and (row.attendance_basis == 'staff' or
                        (row.parallel_source_occurrence_id and row.parallel_source_occurrence_id != guest_id)):
                continue
            now = timezone.now()
            if row:
                if not row.parallel_source_occurrence_id:
                    row.parallel_previous_status = row.attendance_status
                    row.parallel_previous_basis = row.attendance_basis
                row.parallel_source_occurrence_id = guest_id
                row.parallel_source_module_id = guest_module
                if row.attendance_status != 'present':
                    row.attendance_status = 'present'
                    row.attendance_basis = 'parallel'
                row.updated_at = now
                row.save(using=database, update_fields=['parallel_source_occurrence_id', 'parallel_source_module_id',
                                                        'parallel_previous_status', 'parallel_previous_basis',
                                                        'attendance_status', 'attendance_basis', 'updated_at'])
            else:
                LiveSessionLearnerAttendance.objects.using(database).create(
                    occurrence_id=original_id, live_session_id=original['live_session_id'],
                    module_catalogue_id=original_module, learner_profile_id=profile_id,
                    learner_email=profile.email or '', learner_name=profile.full_name or '',
                    attendance_status='present', attendance_basis='parallel',
                    attendance_source_occurrence_id=original_id, parallel_source_occurrence_id=guest_id,
                    parallel_source_module_id=guest_module, parallel_created=True, calculated_at=now)
            changed += 1
    return changed
