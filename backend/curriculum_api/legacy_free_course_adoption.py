"""Adopt the legacy catalogue without deleting source content or history.

Course writes commit before learner writes so both configured aliases can read
the new modules. Each learner's plan, history and removal of the old assignment
commit together. Stable IDs and source checks make an interrupted run resumable.
"""
import json
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, connections, transaction
from django.db.models import Max

from .legacy_free_course_migration import SOURCE_SYSTEM, adopted_id, completion_fields, course_payload


def adopted_courses():
    from . import views
    rows = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE,
        "source_type in ('free_course', 'module_authoring') and source_id is not null",
        columns=['module_catalogue_id', 'source_id'])
    result = {row['source_id']: row['module_catalogue_id'] for row in rows
              if row['module_catalogue_id'] == adopted_id('MOD', row['source_id'], row['source_id'])}
    # Includes newly authored courses and converted/archived records. They must
    # not also appear through the old self-enrolment/content API.
    if views.has_column(views.FREE_COURSES_TABLE, 'managed_by_builder'):
        result.update({row['id']: row['module_catalogue_id'] for row in views.free_programme_fetch_all(
            views.FREE_COURSES_TABLE, 'managed_by_builder = true', columns=['id', 'module_catalogue_id'])})
    return result


def select_courses(courses, include=None, exclude=None):
    """Narrow the catalogue to an explicit course list. Unknown ids stop the run."""
    known = {row['id'] for row in courses}
    include, exclude = set(include or ()), set(exclude or ())
    unknown = (include | exclude) - known
    if unknown:
        raise ValueError('Unknown free course id(s): ' + ', '.join(sorted(unknown)))
    if include & exclude:
        raise ValueError('A course cannot be both included and excluded: ' + ', '.join(sorted(include & exclude)))
    return [row for row in courses if (not include or row['id'] in include) and row['id'] not in exclude]


def canonical_assignments(course_ids):
    """{enrolment id: [course id, ...]} from ``"Learner".learner_free_courses``.

    That table, not ``Created_users.Free_courses``, is the learner-facing
    assignment source (see ``learner_api.models.LearnerFreeCourse``); on the
    normalized database the JSON column holds only a stale subset.
    """
    from learner_api.models import LearnerFreeCourse, LearnerProfile
    rows = list(LearnerFreeCourse.objects.filter(free_course_ref__in=course_ids)
                .order_by('learner_id', 'position', 'id').values('id', 'learner_id', 'position', 'free_course_ref'))
    owners = dict(LearnerProfile.objects.filter(pk__in={row['learner_id'] for row in rows})
                  .values_list('id', 'enrolment_id'))
    if any(owners.get(row['learner_id']) is None for row in rows):
        raise ValueError('A free-course assignment belongs to a learner with no enrolment link; adoption stopped.')
    by_owner = defaultdict(list)
    for row in rows:
        if row['free_course_ref'] not in by_owner[owners[row['learner_id']]]:
            by_owner[owners[row['learner_id']]].append(row['free_course_ref'])
    return rows, dict(by_owner)


def adoption_snapshot(include=None, exclude=None):
    from . import views
    from learner_api.models import EnrolmentUser, LearnerFreeCourseProgress, LearnerProfile
    courses = views.free_programme_fetch_all(views.FREE_COURSES_TABLE, order_sql='display_order, id')
    # Builder-native records have no legacy adoption to replay. Previously
    # adopted records stay available for resuming learner/history migration.
    courses = [row for row in courses if not row.get('managed_by_builder') or
               row.get('module_catalogue_id') == adopted_id('MOD', row['id'], row['id'])]
    courses = select_courses(courses, include, exclude)
    weeks = views.free_programme_fetch_all(views.FREE_PROGRAMME_MODULES_TABLE, order_sql='display_order, week_number, id')
    components = views.free_programme_fetch_all(views.FREE_PROGRAMME_COMPONENTS_TABLE,
        'programme_id = %s', ['FREE-COURSES'], 'display_order, id')
    by_week = defaultdict(list)
    for component in views.active_component_rows(components):
        by_week[component['free_module_id']].append(component)
    by_course = defaultdict(list)
    course_by_id = {course['id']: course for course in courses}
    for week in views.active_week_rows(weeks):
        if week['course_id'] not in course_by_id:
            continue
        by_course[week['course_id']].append(views.free_programme_module_response(
            week, by_week[week['id']], course_by_id.get(week['course_id'])))
    payloads = [course_payload(course, by_course[course['id']], preserve_live=True) for course in courses]
    errors = [error for payload in payloads for error in views.validate_module_authoring_payload(deepcopy(payload))]
    if errors:
        raise ValueError('Legacy content validation failed: ' + json.dumps(Counter(error['message'] for error in errors)))
    course_ids = set(course_by_id)
    assignment_rows, assignments_by_owner = canonical_assignments(course_ids)
    selected_ids = set(assignments_by_owner)
    for row in EnrolmentUser.all_learners.values('id', 'free_courses'):
        assignments = row['free_courses'] if isinstance(row['free_courses'], list) else []
        if any(isinstance(item, dict) and item.get('freeCourseId') in course_ids for item in assignments):
            selected_ids.add(row['id'])
    # The detailed plans are large. Only the selected learners belong in this
    # restore point; loading every learner's plan needlessly times out remotely.
    learners = list(EnrolmentUser.all_learners.filter(pk__in=selected_ids).values(
        'id', 'free_courses', 'learning_plan', 'training_plan'))
    progress = list(LearnerFreeCourseProgress.objects.filter(free_course_ref__in=course_ids).values())
    # Assignments are keyed by enrolment id; completion history by learner
    # profile id (its learner_id references Learner.learners). The enrolment is
    # the owner, reached from each history row through its own profile.
    owner_by_profile = history_owners(progress)
    owner_ids = {row['id'] for row in learners} | set(owner_by_profile.values())
    profiles = list(LearnerProfile.objects.filter(enrolment_id__in=owner_ids).values('id', 'enrolment_id'))
    profiles_by_owner = defaultdict(list)
    for profile in profiles:
        profiles_by_owner[profile['enrolment_id']].append(profile['id'])
    if any(len(profiles_by_owner[owner_by_profile[row['learner_id']]]) != 1 for row in progress):
        raise ValueError('Historical completions require exactly one profile per enrolment identity.')
    content = {component['settings']['legacyFreeComponentId']: (payload, week, component)
               for payload in payloads for week in payload['weekStructure'] for component in week['components']}
    for history in progress:
        if history['component_ref'] not in content:
            raise ValueError('Historical completion references unavailable legacy content; adoption stopped.')
        payload, week, component = content[history['component_ref']]
        completion_fields(history, profile_id=history['learner_id'],
                          module=payload, week=week, component=component)
    return {'courses': courses, 'weeks': weeks, 'components': components, 'payloads': payloads,
            'learners': learners, 'profiles': profiles, 'progress': progress,
            'assignmentRows': assignment_rows,
            'assignmentsByOwner': {str(owner): ids for owner, ids in assignments_by_owner.items()}}


def history_owners(progress):
    """{profile id: enrolment id} for every completion-history row.

    A row whose learner_id is not a known profile, or whose profile has no
    enrolment link, stops adoption: its owner is never guessed.
    """
    from learner_api.models import LearnerProfile
    profile_ids = {row['learner_id'] for row in progress}
    owners = dict(LearnerProfile.objects.filter(pk__in=profile_ids).values_list('id', 'enrolment_id'))
    if set(owners) != profile_ids or any(owner is None for owner in owners.values()):
        raise ValueError('Historical completion learner is not a linked learner profile; adoption stopped.')
    return owners


def snapshot_counts(snapshot):
    return {'courses': len(snapshot['payloads']),
            'weeks': sum(len(p['weekStructure']) for p in snapshot['payloads']),
            'components': sum(len(w['components']) for p in snapshot['payloads'] for w in p['weekStructure']),
            'assignedLearners': len(snapshot['learners']), 'historicalCompletions': len(snapshot['progress']),
            'assignments': len(snapshot.get('assignmentRows') or []),
            'courseIds': [p['sourceId'] for p in snapshot['payloads']]}


def save_backup(snapshot, path):
    # Exclusive creation: a retry cannot replace the pre-adoption restore point.
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(snapshot, stream, cls=DjangoJSONEncoder)


def adopt_course(payload):
    from . import views
    course_id, module_id = payload['sourceId'], payload['catalogueId']
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM curriculum.free_courses WHERE id=%s FOR UPDATE', [course_id])
            if not cursor.fetchone():
                raise ValueError('Legacy course disappeared during adoption.')
        existing = views.authoring_module_exists(module_id)
        if existing:
            if existing.get('source_type') not in {'free_course', 'module_authoring'} or existing.get('source_id') != course_id:
                raise ValueError('Adoption identity is already owned by a different module.')
            return False  # Never replay old content over an edit in Module Builder.
        live_ids = {component['id'] for week in payload['weekStructure'] for component in week['components']
                    if views.stored_component_type(component.get('type')) == 'live_session'}
        views.save_module_authoring_structure(module_id, deepcopy(payload), repair_links=False,
                                              build_result=False, _legacy_live_ids=live_ids)
    return True


def adopt_learners(snapshot):
    from learner_api.models import (
        EnrolmentUser, LearnerFreeCourse, LearnerProfile, LearnerProgressEntry, LearnerFreeCourseProgress,
    )
    from learner_api.active_users import current_component_fk
    from . import learner_assignments as assignments
    from . import views
    alias = EnrolmentUser.all_learners.db
    mapping = {p['sourceId']: p for p in snapshot['payloads']}
    content = {c['settings']['legacyFreeComponentId']: (p, w, c)
               for p in snapshot['payloads'] for w in p['weekStructure'] for c in w['components']}
    assignments_by_owner = {int(owner): ids for owner, ids in (snapshot.get('assignmentsByOwner') or {}).items()}
    owner_ids = sorted({row['id'] for row in snapshot['learners']} | set(assignments_by_owner)
                       | set(history_owners(snapshot['progress']).values()))
    # The modules adopted just before this call must be in the catalogue read.
    views.invalidate_curriculum_cache()
    catalogue = {entry['moduleId']: entry for entry in assignments.plans._all_modules()}
    changed, imported, moved_rows = 0, 0, 0
    for owner_id in owner_ids:
        with transaction.atomic(using=alias):
            learner = EnrolmentUser.all_learners.select_for_update().get(pk=owner_id)
            profiles = list(LearnerProfile.objects.select_for_update().filter(enrolment_id=owner_id))
            history = list(LearnerFreeCourseProgress.objects.filter(
                learner_id__in=[profile.pk for profile in profiles], free_course_ref__in=mapping).values())
            if history and len(profiles) != 1:
                raise ValueError('Historical learner identity changed during adoption.')
            for completion in history:
                payload, week, component = content[completion['component_ref']]
                existing = LearnerProgressEntry.objects.filter(learner=profiles[0],
                    component_ref=component['id'], component_link_source=SOURCE_SYSTEM).first()
                if existing:
                    continue
                fields, ledger = completion_fields(completion, profile_id=profiles[0].pk,
                    module=payload, week=week, component=component)
                order = LearnerProgressEntry.objects.filter(learner=profiles[0]).aggregate(value=Max('entry_order'))['value'] or 0
                fields['curriculum_component_fk'] = current_component_fk(connections[alias], fields['component_ref'])
                entry = LearnerProgressEntry.objects.create(entry_order=order + 1, **fields)
                with connections[alias].cursor() as cursor:
                    cursor.execute('''UPDATE "Learner".learner_progress_entries SET
                        source_system=%s, activity_status=%s, accepted=%s, actual_seconds=%s,
                        actual_basis=%s, source_payload=%s::jsonb WHERE id=%s AND learner_id=%s''',
                        [ledger['source_system'], ledger['activity_status'], ledger['accepted'], ledger['actual_seconds'],
                         ledger['actual_basis'], json.dumps(ledger['source_payload']), entry.pk, profiles[0].pk])
                from learner_api.progress_cache import bump_learners
                bump_learners([profiles[0].pk], using=alias)
                imported += 1
            old = learner.free_courses if isinstance(learner.free_courses, list) else []
            selected = [item for item in old if isinstance(item, dict) and item.get('freeCourseId') in mapping]
            course_ids = list(dict.fromkeys([*assignments_by_owner.get(owner_id, []),
                                             *(item['freeCourseId'] for item in selected)]))
            if course_ids:
                target_ids = list(dict.fromkeys(mapping[course_id]['catalogueId'] for course_id in course_ids))
                if set(target_ids) - catalogue.keys():
                    raise ValueError('An adopted course is unavailable for assignment.')
                # One module at a time through the drawer's own assignment, which
                # adds just that module's plan rows and never rebuilds the rest.
                # Already-assigned modules are skipped, so a rerun adds nothing.
                cache = {}
                for module_id in target_ids:
                    cache.pop('_moduleMembers', None)
                    cache.pop('_assignmentModules', None)
                    assignments._assign(learner, {'scope': 'module', 'id': module_id, 'moduleIds': [module_id]},
                                        catalogue, cache)
                # The module assignment is committed in this same transaction, so
                # the learner-facing free-course rows can go: leaving them would
                # show the course twice in My Learning. Only the adopted courses.
                if selected:
                    learner.free_courses = [item for item in old if item not in selected]
                    learner.save(update_fields=['free_courses'])
                profile_ids = list(LearnerProfile.objects.filter(enrolment_id=owner_id).values_list('id', flat=True))
                deleted, _ = LearnerFreeCourse.objects.using(alias).filter(
                    learner_id__in=profile_ids, free_course_ref__in=course_ids).delete()
                moved_rows += deleted
                changed += 1
    views.invalidate_curriculum_cache()
    return {'learnersUpdated': changed, 'completionsImported': imported, 'assignmentRowsMoved': moved_rows}
