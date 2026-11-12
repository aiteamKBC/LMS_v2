"""Read, and correct, the LMS live-session register for the bulk attendance page.

Reads never match learners by name or email: a learner reaches a KBC id only
through the stable Aptem identity rule the coach dashboard uses
(Created_users.aptem_id, then the profile copy).

A saved correction also uses the existing staff correction ledger, so completion
can distinguish manual attendance from provider evidence after a Teams sync.
"""
import logging
from datetime import datetime, time, timedelta

from django.db import DatabaseError, connections, router, transaction
from django.utils import timezone

from learner_api.models import LearnerProfile

from .bulk_attendance_live_policy import build_live_records
from .models import LiveSession, LiveSessionLearnerAttendance, LiveSessionOccurrence, ModuleAuthoringModule
from .session_results_policy import instant

logger = logging.getLogger(__name__)

LIVE_REGISTER_WARNING = 'The live session register could not be read; showing KBC attendance only.'


def _local_date(value):
    moment = instant(value)
    return timezone.localtime(moment).date() if moment else None


def _lecture_titles(rows, occurrences, local_date):
    """{register row id: curriculum lecture title}, matched the way the learner workspace does."""
    from learner_api.attendance_lectures import _component_for
    from learner_api.dashboard_metrics import as_json

    module_ids = sorted({row['module_catalogue_id'] for row in rows if row.get('module_catalogue_id')})
    if not module_ids:
        return {}
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(
            '''SELECT c.module_catalogue_id, c.type, c.title, c.settings_json
               FROM curriculum.components c
               WHERE c.module_catalogue_id = ANY(%s) AND c.type = 'live_session'
                 AND c.status NOT IN ('inactive','archived')''',
            [module_ids],
        )
        components = [
            {'module_catalogue_id': module_id, 'type': kind, 'title': title,
             'settings': as_json(settings, {}) or {}}
            for module_id, kind, title, settings in cursor.fetchall()
        ]
    by_module = {}
    for component in components:
        by_module.setdefault(component['module_catalogue_id'], []).append(component)
    titles = {}
    for row in rows:
        occurrence = occurrences.get(row['occurrence_id'])
        session_date = local_date(occurrence['scheduled_start']) if occurrence else None
        if session_date is None:
            continue
        component = _component_for({
            'session_id': row['occurrence_id'], 'module_catalogue_id': row['module_catalogue_id'],
            'live_session_id': row['live_session_id'], 'session_date': session_date,
        }, by_module.get(row['module_catalogue_id'], []))
        title = str((component or {}).get('title') or '').strip()
        if title:
            titles[row['id']] = title
    return titles


def _candidate_profile_ids(kbc_ids):
    """Profiles that may resolve to one of ``kbc_ids``: a superset, never a guess.

    The Aptem rule reads Created_users.aptem_id first and the profile copy as
    the fallback, so a profile is a candidate when either copy names a requested
    id. read_live_register_records() still resolves every candidate through the
    same rule and keeps only the profiles that land on a requested id.
    """
    from django.db.models.functions import Trim

    from learner_api.models import EnrolmentUser

    numeric = [int(value) for value in kbc_ids]
    enrolment_ids = list(
        EnrolmentUser.all_learners
        .annotate(trimmed_aptem_id=Trim('aptem_id'))
        .filter(trimmed_aptem_id__in=list(kbc_ids))
        .values_list('pk', flat=True)
    )
    by_profile = set(LearnerProfile.objects.filter(aptem_id__in=numeric).values_list('id', flat=True))
    by_enrolment = set(
        LearnerProfile.objects.filter(enrolment_id__in=enrolment_ids).values_list('id', flat=True)
    ) if enrolment_ids else set()
    return by_profile | by_enrolment


def read_live_register_records(kbc_id=None, kbc_ids=None):
    """Live register rows as KBC-shaped records keyed by KBC id.

    ``kbc_ids`` scopes the read to those learners (the register's visible
    page); None reads every learner, as before.
    """
    requested = {str(value) for value in kbc_ids} if kbc_ids is not None else None
    register = LiveSessionLearnerAttendance.objects.all()
    if requested is not None:
        if not requested:
            return {}
        register = register.filter(learner_profile_id__in=_candidate_profile_ids(requested))
    rows = list(register.values(
        'id', 'occurrence_id', 'live_session_id', 'module_catalogue_id',
        'learner_profile_id', 'attendance_status',
    ))
    if not rows:
        return {}
    occurrences = {
        item['id']: item
        for item in LiveSessionOccurrence.objects
        .filter(id__in={row['occurrence_id'] for row in rows})
        .values('id', 'scheduled_start', 'session_number')
    }
    titles = dict(
        LiveSession.objects
        .filter(id__in={row['live_session_id'] for row in rows})
        .values_list('id', 'module_title')
    )
    module_titles = dict(ModuleAuthoringModule.objects.filter(
        module_catalogue_id__in={row['module_catalogue_id'] for row in rows}
    ).values_list('module_catalogue_id', 'title'))
    for row in rows:
        row['module_title'] = module_titles.get(row['module_catalogue_id'])
    from coach_api.views import resolve_effective_aptem_ids

    # Only the identity columns: the full profile rows take tens of seconds.
    profiles = (
        LearnerProfile.objects
        .filter(id__in={row['learner_profile_id'] for row in rows})
        .only('id', 'enrolment_id', 'aptem_id')
    )
    aptem_by_profile, _conflicts = resolve_effective_aptem_ids(profiles)
    kbc_id_by_profile = {profile_id: str(aptem_id) for profile_id, aptem_id in aptem_by_profile.items()}
    if requested is not None:
        # A candidate whose effective Aptem id is another learner's is not ours.
        kbc_id_by_profile = {
            profile_id: value for profile_id, value in kbc_id_by_profile.items() if value in requested
        }

    from .bulk_attendance_live_recovery import parallel_recovery_links
    covered, guests = parallel_recovery_links(
        [row for row in rows if row['learner_profile_id'] in kbc_id_by_profile
         and (kbc_id is None or kbc_id_by_profile[row['learner_profile_id']] == kbc_id)],
        complete=True,
    )

    lecture_titles = {}
    if kbc_id is not None:
        # One learner's details: worth matching each lecture to its curriculum title.
        own = [row for row in rows if kbc_id_by_profile.get(row['learner_profile_id']) == kbc_id]
        try:
            lecture_titles = _lecture_titles(own, occurrences, _local_date)
        except DatabaseError as exc:
            logger.warning('Could not read live lecture titles for bulk attendance: %s', exc)

    records = build_live_records(
        rows, occurrences, titles, kbc_id_by_profile,
        _local_date, timezone.localdate(), kbc_id, lecture_titles,
    )
    by_key = {f"live:{row['id']}": row for row in rows}
    for learner_records in records.values():
        for record in learner_records:
            row = by_key[record['recordKey']]
            key = (row['learner_profile_id'], str(row['occurrence_id']))
            record.update(covered.get(key, {}))
            record.update(guests.get(key, {}))
    return records


def read_live_register_or_warning(kbc_id=None, kbc_ids=None):
    try:
        return read_live_register_records(kbc_id, kbc_ids=kbc_ids), None
    except DatabaseError:
        return {}, LIVE_REGISTER_WARNING


def read_live_day_learner_ids(session_date):
    """Read only saved register membership within the business calendar day."""
    zone = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(session_date, time.min), zone)
    end = timezone.make_aware(datetime.combine(session_date + timedelta(days=1), time.min), zone)
    occurrence_ids = LiveSessionOccurrence.objects.filter(
        scheduled_start__gte=start, scheduled_start__lt=end,
    ).values_list('id', flat=True)
    profile_ids = list(LiveSessionLearnerAttendance.objects.filter(
        occurrence_id__in=occurrence_ids,
    ).values_list('learner_profile_id', flat=True).distinct())
    profiles = list(LearnerProfile.objects.filter(id__in=profile_ids).only('id', 'enrolment_id', 'aptem_id'))
    if not profiles:
        return set()
    from coach_api.views import resolve_effective_aptem_ids
    identities, _conflicts = resolve_effective_aptem_ids(profiles)
    return {str(identity) for identity in identities.values() if identity is not None}


def save_live_attendance(changes, *, actor=''):
    """Apply {register row id: status}; returns the ids that were updated.

    Every id must exist, otherwise nothing is written.
    """
    from coach_api.models import CoachAttendanceSourceAdjustment

    ids = list(changes)
    database = router.db_for_write(LiveSessionLearnerAttendance)
    with transaction.atomic(using=database):
        rows = list(
            LiveSessionLearnerAttendance.objects.select_for_update()
                .filter(id__in=ids).values('id', 'learner_profile_id', 'occurrence_id', 'live_session_id', 'module_catalogue_id')
        )
        missing = sorted(set(ids) - {row['id'] for row in rows})
        if missing:
            raise LookupError(missing)
        now = timezone.now()
        for row_id, status in changes.items():
            LiveSessionLearnerAttendance.objects.filter(id=row_id).update(
                attendance_status=status, updated_at=now,
            )
        owners = dict(LiveSession.objects.using(database).filter(
            id__in={row['live_session_id'] for row in rows}).values_list('id', 'module_catalogue_id'))
        for row in rows:
            source_id = row['occurrence_id'] if owners.get(row['live_session_id']) == row['module_catalogue_id'] else f"{row['occurrence_id']}:{row['module_catalogue_id']}"
            CoachAttendanceSourceAdjustment.objects.using(database).update_or_create(
                learner_profile_id=row['learner_profile_id'], source='microsoft-teams', source_id=source_id,
                defaults={'status': changes[row['id']], 'is_deleted': False,
                          'owner_email': actor, 'updated_by': actor},
            )
    return sorted(ids)
