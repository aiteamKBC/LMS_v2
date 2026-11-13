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


def adoption_snapshot():
    from . import views
    from learner_api.models import EnrolmentUser, LearnerFreeCourseProgress, LearnerProfile
    courses = views.free_programme_fetch_all(views.FREE_COURSES_TABLE, order_sql='display_order, id')
    # Builder-native records have no legacy adoption to replay. Previously
    # adopted records stay available for resuming learner/history migration.
    courses = [row for row in courses if not row.get('managed_by_builder') or
               row.get('module_catalogue_id') == adopted_id('MOD', row['id'], row['id'])]
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
    selected_ids = []
    for row in EnrolmentUser.all_learners.values('id', 'free_courses'):
        assignments = row['free_courses'] if isinstance(row['free_courses'], list) else []
        if any(isinstance(item, dict) and item.get('freeCourseId') in course_ids for item in assignments):
            selected_ids.append(row['id'])
    # The detailed plans are large. Only the selected learners belong in this
    # restore point; loading every learner's plan needlessly times out remotely.
    learners = list(EnrolmentUser.all_learners.filter(pk__in=selected_ids).values(
        'id', 'free_courses', 'learning_plan', 'training_plan'))
    progress = list(LearnerFreeCourseProgress.objects.filter(free_course_ref__in=course_ids).values())
    from learner_api.free_course_records import profile_progress_enabled
    if progress and profile_progress_enabled():
        enrolments = dict(LearnerProfile.objects.filter(pk__in={row['learner_id'] for row in progress})
                          .values_list('pk', 'enrolment_id'))
        for row in progress:
            if not enrolments.get(row['learner_id']):
                raise ValueError('Historical free-course progress has no linked enrolment identity.')
            row['learner_id'] = enrolments[row['learner_id']]
    owner_ids = {row['id'] for row in learners} | {row['learner_id'] for row in progress}
    profiles = list(LearnerProfile.objects.filter(enrolment_id__in=owner_ids).values('id', 'enrolment_id', 'learning_plan'))
    profiles_by_owner = defaultdict(list)
    for profile in profiles:
        profiles_by_owner[profile['enrolment_id']].append(profile['id'])
    if any(len(profiles_by_owner[row['learner_id']]) != 1 for row in progress):
        raise ValueError('Historical completions require exactly one profile per enrolment identity.')
    content = {component['settings']['legacyFreeComponentId']: (payload, week, component)
               for payload in payloads for week in payload['weekStructure'] for component in week['components']}
    for history in progress:
        if history['component_ref'] not in content:
            raise ValueError('Historical completion references unavailable legacy content; adoption stopped.')
        payload, week, component = content[history['component_ref']]
        completion_fields(history, profile_id=profiles_by_owner[history['learner_id']][0],
                          module=payload, week=week, component=component)
    return {'courses': courses, 'weeks': weeks, 'components': components, 'payloads': payloads,
            'learners': learners, 'profiles': profiles, 'progress': progress}


def snapshot_counts(snapshot):
    return {'courses': len(snapshot['payloads']),
            'weeks': sum(len(p['weekStructure']) for p in snapshot['payloads']),
            'components': sum(len(w['components']) for p in snapshot['payloads'] for w in p['weekStructure']),
            'assignedLearners': len(snapshot['learners']), 'historicalCompletions': len(snapshot['progress'])}


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
    from learner_api.models import EnrolmentUser, LearnerProfile, LearnerProgressEntry, LearnerFreeCourseProgress
    from . import learner_assignments as assignments
    from . import views
    alias = EnrolmentUser.all_learners.db
    mapping = {p['sourceId']: p for p in snapshot['payloads']}
    content = {c['settings']['legacyFreeComponentId']: (p, w, c)
               for p in snapshot['payloads'] for w in p['weekStructure'] for c in w['components']}
    owner_ids = sorted({row['id'] for row in snapshot['learners']} | {row['learner_id'] for row in snapshot['progress']})
    catalogue = {entry['moduleId']: entry for entry in assignments.plans._all_modules()}
    changed, imported = 0, 0
    for owner_id in owner_ids:
        with transaction.atomic(using=alias):
            learner = EnrolmentUser.all_learners.select_for_update().get(pk=owner_id)
            profiles = list(LearnerProfile.objects.select_for_update().filter(enrolment_id=owner_id))
            from learner_api.free_course_records import progress_owner
            history = list(LearnerFreeCourseProgress.objects.filter(
                learner_id=progress_owner(learner), free_course_ref__in=mapping).values())
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
                entry = LearnerProgressEntry.objects.create(entry_order=order + 1, **fields)
                with connections[alias].cursor() as cursor:
                    cursor.execute('''UPDATE "Learner".learner_progress_entries SET
                        source_system=%s, activity_status=%s, accepted=%s, actual_seconds=%s,
                        actual_basis=%s, source_payload=%s::jsonb WHERE id=%s AND learner_id=%s''',
                        [ledger['source_system'], ledger['activity_status'], ledger['accepted'], ledger['actual_seconds'],
                         ledger['actual_basis'], json.dumps(ledger['source_payload']), entry.pk, profiles[0].pk])
                imported += 1
            old = learner.free_courses if isinstance(learner.free_courses, list) else []
            selected = [item for item in old if isinstance(item, dict) and item.get('freeCourseId') in mapping]
            if selected:
                target_ids = list(dict.fromkeys(mapping[item['freeCourseId']]['catalogueId'] for item in selected))
                if set(target_ids) - catalogue.keys():
                    raise ValueError('An adopted course is unavailable for assignment.')
                learner.free_courses = [item for item in old if item not in selected]
                learner.save(update_fields=['free_courses'])
                target = {'scope': 'module', 'moduleIds': target_ids}
                if not assignments._assign(learner, target, catalogue, {}):
                    assignments.plans.sync_learning_plan_mirror(learner, strict=True)
                changed += 1
    views.invalidate_curriculum_cache()
    return {'learnersUpdated': changed, 'completionsImported': imported}
