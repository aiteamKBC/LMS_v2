"""Read-only projection of saved parallel-group make-up attendance for Bulk.

The raw register remains editable by occurrence.  A guest delivery can cover
one missed required lecture, but must not become a second required lecture.
"""
from collections import defaultdict

from django.db import router
from django.utils import timezone

from learner_api.alternative_recovery import completed_alternatives_by_occurrence
from learner_api.attendance_assignments import assigned_module_ids
from learner_api.models import EnrolmentUser, LearnerProfile

from .models import LiveSessionLearnerAttendance, LiveSessionOccurrence
from .session_results_policy import instant


def resolve_parallel_links(originals, alternatives, targets, assignments, dates):
    """Project one guest record onto at most one missed required occurrence."""
    targets_by_profile = defaultdict(dict)
    for row in targets:
        targets_by_profile[row['learner_profile_id']][str(row['occurrence_id'])] = row['attendance_status']
    owners = defaultdict(set)
    status_by_original = {}
    for row in originals:
        profile_id = row['learner_profile_id']
        original = str(row['occurrence_id'])
        status_by_original[(profile_id, original)] = row['attendance_status']
        for item in alternatives.get(original, []):
            target = str(item['id'])
            if (target in targets_by_profile[profile_id]
                    and profile_id in assignments
                    and str(row.get('module_catalogue_id') or '') in assignments[profile_id]
                    and item.get('moduleCatalogueId')
                    and str(item['moduleCatalogueId']) not in assignments[profile_id]):
                owners[(profile_id, target)].add(original)
    guests = {key: next(iter(originals)) for key, originals in owners.items() if len(originals) == 1}
    covered = {}
    guest_details = {}
    for (profile_id, target), original in sorted(guests.items()):
        if original not in dates:
            continue
        guest_details[(profile_id, target)] = {'makeupForOccurrenceId': original,
                                                'makeupForDate': dates[original],
                                                'countsAsSession': False}
        if (targets_by_profile[profile_id][target] == 'present'
                and status_by_original[(profile_id, original)] == 'absent'):
            covered.setdefault((profile_id, original), {'effectiveAttendance': 'present',
                                                        'recoveryOccurrenceId': target})
    return covered, guest_details


def parallel_recovery_links(register_rows, *, complete=False, database=None):
    """Return (covered originals, guest targets) keyed by profile and occurrence.

    Match through the curriculum's existing same-cohort, same-session-number
    alternative rule.  Only an unambiguous guest occurrence, outside the
    learner's assigned plan, can cover one original.  Saved presence is the
    evidence; a report or matching title alone does not grant credit.
    """
    profile_ids = {row['learner_profile_id'] for row in register_rows}
    if not profile_ids:
        return {}, {}
    database = database or router.db_for_read(LiveSessionLearnerAttendance) or 'default'
    originals = (register_rows if complete else list(
        LiveSessionLearnerAttendance.objects.using(database)
        .filter(learner_profile_id__in=profile_ids)
        .values('learner_profile_id', 'occurrence_id', 'module_catalogue_id', 'attendance_status')
    ))
    if not originals:
        return {}, {}
    original_ids = {str(row['occurrence_id']) for row in originals}
    alternatives = completed_alternatives_by_occurrence(original_ids)
    options = {
        str(item['id'])
        for original in original_ids for item in alternatives.get(original, [])
    }
    if not options:
        return {}, {}
    targets = list(
        LiveSessionLearnerAttendance.objects.using(database)
        .filter(learner_profile_id__in=profile_ids, occurrence_id__in=options)
        .values('learner_profile_id', 'occurrence_id', 'attendance_status')
    )
    target_ids_by_profile = defaultdict(set)
    for row in targets:
        target_ids_by_profile[row['learner_profile_id']].add(str(row['occurrence_id']))
    possible_profiles = {
        row['learner_profile_id'] for row in originals
        if any(str(item['id']) in target_ids_by_profile[row['learner_profile_id']]
               for item in alternatives.get(str(row['occurrence_id']), []))
    }
    if not possible_profiles:
        return {}, {}
    profile_database = router.db_for_read(LearnerProfile) or 'default'
    profiles = list(LearnerProfile.objects.using(profile_database)
                    .filter(id__in=possible_profiles).only('id', 'enrolment_id'))
    enrolment_ids = {profile.enrolment_id for profile in profiles if profile.enrolment_id is not None}
    sources = {source.pk: source for source in EnrolmentUser.all_learners
               .filter(pk__in=enrolment_ids)
               .only('id', 'programme', 'group', 'training_plan', 'learning_plan')}
    assignments = {
        profile.id: set(map(str, assigned_module_ids(sources[profile.enrolment_id])))
        for profile in profiles if profile.enrolment_id in sources
    }
    dates = {
        str(row['id']): timezone.localtime(instant(row['scheduled_start'])).date().isoformat()
        for row in LiveSessionOccurrence.objects.using(database)
        .filter(id__in=original_ids)
        .values('id', 'scheduled_start')
        if row['scheduled_start']
    }
    return resolve_parallel_links(originals, alternatives, targets, assignments, dates)
