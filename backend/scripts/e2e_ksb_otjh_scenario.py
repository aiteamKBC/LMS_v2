"""End-to-end scenario: curriculum authors -> learner consumes -> curriculum reports.

Runs against the live Neon database inside ONE transaction that is always rolled
back, so nothing is committed. The point is to exercise the real write paths
(curriculum authoring views, the learner progress writer) and the real read path
(scope_learner_ksb_impact_payload) against the real schema, and to check that the
numbers a curriculum lead sees at programme / cohort / group / module / week are
exactly what was authored and consumed.

Everything runs on the 'default' connection: learner_api models are routed to the
'enrolment' alias, which is the same physical Neon database, so the alias is
pointed at the same connection object for the duration of the run. Without that,
the learner writes would sit in a second uncommitted transaction the curriculum
reads could not see.
"""
import json
import os
import sys
from datetime import date
from pathlib import Path

import django

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
for line in (BACKEND / '.env').read_text(encoding='utf-8', errors='ignore').splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import connections, transaction  # noqa: E402
from django.test import RequestFactory  # noqa: E402

# One connection for both aliases, so the whole scenario is one transaction.
setattr(connections._connections, 'enrolment', connections['default'])
assert connections['enrolment'] is connections['default']

from curriculum_api import views  # noqa: E402
from learner_api import components as learner_components  # noqa: E402
from learner_api import videos as learner_videos  # noqa: E402
from learner_api.active_users import save_progress_record, sync_active_user  # noqa: E402
from learner_api.models import (  # noqa: E402
    EnrolmentUser,
    LearnerProgressEntry,
    LearnerProgressKsb,
)

rf = RequestFactory()
STANDARD = 'standard:st0845-v1-1'
TAG = 'E2E-KSB-SCENARIO'
failures = []
checks = 0


class Rollback(Exception):
    """Raised at the end so the transaction never commits."""


def post(view, path, body, **kwargs):
    request = rf.post(path, data=json.dumps(body), content_type='application/json')
    response = view(request, **kwargs)
    payload = json.loads(response.content.decode('utf-8'))
    if response.status_code >= 400:
        raise AssertionError(f'{path} -> {response.status_code}: {payload}')
    return payload


class LearnerAccount:
    """What a resolved learner session presents to the permission gates.

    The progress endpoints are `@learner_self_only`, so they must be called as
    the learner. `authenticate_request` returns `request.login_account` when it
    is already set, which is how the middleware hands the resolved session down
    — so setting it here authenticates as this learner rather than bypassing
    the gate.
    """

    role = 'learner'
    subject_type = 'learner'

    def __init__(self, subject_id):
        self.subject_id = subject_id


def learner_post(view, path, component_id, learner_id, body=None):
    request = rf.post(
        f'{path}?kind=apprenticeship&learnerId={learner_id}',
        data=json.dumps(body or {}),
        content_type='application/json',
    )
    request.login_account = LearnerAccount(learner_id)
    request.login_session = None
    response = view(request, component_id)
    payload = json.loads(response.content.decode('utf-8'))
    if response.status_code >= 400:
        raise AssertionError(f'{path} -> {response.status_code}: {payload}')
    return payload


def check(label, actual, expected):
    global checks
    checks += 1
    ok = actual == expected
    if not ok:
        failures.append(f'{label}: expected {expected!r}, got {actual!r}')
    print(f'   {"PASS" if ok else "FAIL"}  {label}: {actual!r}' + ('' if ok else f'  (expected {expected!r})'))


def num(value):
    return round(float(value or 0), 2)


def component(kind, title, otjh, points, mappings):
    return {
        'type': kind,
        'title': title,
        'description': '',
        'expectedOtjh': otjh,
        'points': points,
        'reflectionRequired': False,
        'workplaceEvidenceRequired': False,
        'tutorValidationRequired': False,
        'ksbMappings': [
            {
                'code': code,
                'weight': weight,
                'type': 'main',
                'weightClass': 'hard',
                'sourceType': 'standard',
                'sourceId': 'st0845-v1-1',
            }
            for code, weight in mappings
        ],
        'settings': {'version': '0.1', 'contentStatus': 'Draft'},
    }


def impact(scope, identifier):
    payload, error = views.scope_learner_ksb_impact_payload(
        rf.get('/x', {'learnerStatus': 'all'}), scope, identifier,
    )
    if error is not None:
        raise AssertionError(f'{scope} {identifier}: {error.content!r}')
    return payload


def ksb_row(payload, code):
    for row in payload['ksbAchievement']['rows']:
        if row['code'] == code:
            return row
    raise AssertionError(f'{code} missing from the KSB rows')


def learner_row(payload, name):
    for row in payload['otjhAchievement']['learners']:
        if row['learnerName'] == name:
            return row
    raise AssertionError(f'{name} is not on the roster')


def family(payload, letter):
    for entry in payload['ksbAchievement']['byType']:
        if entry['letter'] == letter:
            return entry
    raise AssertionError(f'no {letter} family')


BASELINE_SQL = {
    'programmes': 'select count(*) from curriculum.programmes',
    'cohorts': 'select count(*) from curriculum.cohorts',
    'groups': 'select count(*) from curriculum.groups',
    'modules': 'select count(*) from curriculum.modules',
    'components': 'select count(*) from curriculum.components',
    'ksb_mappings': 'select count(*) from curriculum.ksb_mappings',
    'created_users': 'select count(*) from enrolment."Created_users"',
    'learners': 'select count(*) from "Learner".learners',
    'progress_entries': 'select count(*) from "Learner".learner_progress_entries',
    'progress_ksbs': 'select count(*) from "Learner".learner_progress_ksbs',
}


def counts():
    out = {}
    with connections['default'].cursor() as cursor:
        for name, sql in BASELINE_SQL.items():
            cursor.execute(sql)
            out[name] = cursor.fetchone()[0]
    return out


before = counts()
print('Row counts before:', before)
print()

try:
    with transaction.atomic(using='default'):
        # ─────────────────────────────────────────────────────────────────
        print('STEP 1  Curriculum authors the programme')
        programme = post(
            views.curriculum_programme_collection, '/curriculum/programmes/',
            {
                'name': f'{TAG} Programme',
                'level': '6',
                'ksbProfileSourceId': STANDARD,
                'requiredOtjh': 20,
                'owner': TAG,
            },
        )['programme']
        programme_id = programme['sourceId']
        print(f'   programme {programme_id}')

        # ─────────────────────────────────────────────────────────────────
        print('STEP 2  ... a cohort under it')
        cohort = post(
            views.curriculum_cohort_collection, '/curriculum/cohorts/',
            {
                'name': f'{TAG} Cohort',
                'programme': f'{TAG} Programme',
                'programmeId': programme_id,
                'startDate': str(date(2026, 9, 1)),
                'durationMonths': 12,
            },
        )
        cohort_id = cohort.get('cohort', cohort).get('sourceId') or cohort.get('cohort', cohort).get('id')
        print(f'   cohort {cohort_id}')

        # ─────────────────────────────────────────────────────────────────
        print('STEP 3  ... two delivery groups, so the per-group denominator is testable')
        group_a = post(
            views.curriculum_cohort_group_collection, '/curriculum/cohorts/x/groups/',
            {'name': f'{TAG} Group A'}, cohort_id=cohort_id,
        )
        group_b = post(
            views.curriculum_cohort_group_collection, '/curriculum/cohorts/x/groups/',
            {'name': f'{TAG} Group B'}, cohort_id=cohort_id,
        )
        group_a_id = (group_a.get('group') or group_a).get('sourceId') or (group_a.get('group') or group_a).get('id')
        group_b_id = (group_b.get('group') or group_b).get('sourceId') or (group_b.get('group') or group_b).get('id')
        print(f'   group A {group_a_id} / group B {group_b_id}')

        # ─────────────────────────────────────────────────────────────────
        print('STEP 4  ... a module for each group: weeks, components, OTJH and KSB weights')
        module_a = post(
            views.curriculum_module_collection, '/curriculum/modules/',
            {
                'moduleType': 'authoring',
                'title': f'{TAG} Module A',
                'programmeId': programme_id,
                'programmeName': f'{TAG} Programme',
                'cohortId': cohort_id,
                'cohortName': f'{TAG} Cohort',
                'groupId': group_a_id,
                'groupName': f'{TAG} Group A',
                'ksbProfileSourceId': STANDARD,
                'weekStructure': [
                    {
                        'weekNumber': 1,
                        'title': 'Week 1',
                        'components': [
                            component('video', 'E2E Video 1', 2.0, 10, [('K1', 60), ('K2', 40)]),
                            component('reading', 'E2E Reading 1', 3.0, 10, [('K1', 40), ('S1', 50)]),
                        ],
                    },
                    {
                        'weekNumber': 2,
                        'title': 'Week 2',
                        'components': [
                            component('powerpoint', 'E2E Slides 1', 1.5, 10, [('S1', 50), ('B1', 100)]),
                            component('quiz', 'E2E Quiz 1', 1.0, 10, [('K2', 60)]),
                        ],
                    },
                ],
            },
        )
        module_a_id = module_a['moduleCatalogueId']
        post(
            views.curriculum_module_collection, '/curriculum/modules/',
            {
                'moduleType': 'authoring',
                'title': f'{TAG} Module B',
                'programmeId': programme_id,
                'programmeName': f'{TAG} Programme',
                'cohortId': cohort_id,
                'cohortName': f'{TAG} Cohort',
                'groupId': group_b_id,
                'groupName': f'{TAG} Group B',
                'ksbProfileSourceId': STANDARD,
                'weekStructure': [
                    {
                        'weekNumber': 1,
                        'title': 'Week 1',
                        'components': [
                            component('reading', 'E2E Reading B1', 4.0, 10, [('S2', 100)]),
                        ],
                    },
                ],
            },
        )

        structure = views.get_authoring_structure_payload(module_a_id)
        weeks = structure['weekStructure']
        by_title = {
            comp['title']: comp
            for week in weeks for comp in week['components']
        }
        week_one_id = weeks[0]['id']
        video_id = by_title['E2E Video 1']['id']
        reading_id = by_title['E2E Reading 1']['id']
        slides_id = by_title['E2E Slides 1']['id']
        quiz_id = by_title['E2E Quiz 1']['id']
        print(f'   module A {module_a_id}: {len(weeks)} weeks, {len(by_title)} components')
        check('module A authored OTJH', num(sum(c['expectedOtjh'] for c in by_title.values())), 7.5)
        check('video 1 KSB mappings persisted',
              sorted((m.get('ksb_code') or m.get('code') or m.get('ksbCode'), num(m['weight']))
                     for m in by_title['E2E Video 1']['ksbMappings']),
              [('K1', 60.0), ('K2', 40.0)])

        # ─────────────────────────────────────────────────────────────────
        print('STEP 5  Enrolment creates two learners and places them in the groups')
        learner_a_source = EnrolmentUser.objects.create(
            username='E2E Learner A', email='e2e-learner-a@example.invalid',
            programme=f'{TAG} Programme', cohort=f'{TAG} Cohort',
            group=f'{TAG} Group A', programme_status='Active', learner_type='apprenticeship',
        )
        learner_b_source = EnrolmentUser.objects.create(
            username='E2E Learner B', email='e2e-learner-b@example.invalid',
            programme=f'{TAG} Programme', cohort=f'{TAG} Cohort',
            group=f'{TAG} Group B', programme_status='Active', learner_type='apprenticeship',
        )
        profile_a = sync_active_user(learner_a_source)
        profile_b = sync_active_user(learner_b_source)
        print(f'   learner A #{profile_a.pk} in Group A, learner B #{profile_b.pk} in Group B')

        roster = impact('programme', programme_id)
        check('programme roster size', roster['assignedLearnerCount'], 2)
        check('learner A placed in', learner_row(roster, 'E2E Learner A')['group'], f'{TAG} Group A')
        check('learner B placed in', learner_row(roster, 'E2E Learner B')['group'], f'{TAG} Group B')

        # ─────────────────────────────────────────────────────────────────
        print('STEP 6  Learner A consumes the video and the reading (not the slides or quiz)')
        learner_post(learner_videos.submit_video_progress, f'/videos/{video_id}/complete/',
                     video_id, learner_a_source.id, {'week': 'Week 1', 'module': f'{TAG} Module A'})
        learner_post(learner_components.submit_component_progress, f'/components/{reading_id}/complete/',
                     reading_id, learner_a_source.id, {'week': 'Week 1', 'module': f'{TAG} Module A'})

        entries = LearnerProgressEntry.objects.filter(learner=profile_a).order_by('entry_order')
        check('progress entries written', entries.count(), 2)
        check('lineage stamped on the row',
              [entries[0].programme_ref, entries[0].cohort_ref, entries[0].group_ref],
              [programme_id, cohort_id, group_a_id])
        check('expected OTJH carried onto the progress row', num(entries[0].expected_otjh), 2.0)
        check('KSB snapshot written from the authored mappings',
              sorted(LearnerProgressKsb.objects
                     .filter(progress__learner=profile_a)
                     .values_list('ksb_code', flat=True)),
              ['K1', 'K1', 'K2', 'S1'])

        # ─────────────────────────────────────────────────────────────────
        print('STEP 7  Programme scope: what the curriculum team sees')
        payload = impact('programme', programme_id)
        otjh = payload['otjhAchievement']
        ksb = payload['ksbAchievement']
        check('OTJH achieved across the programme', num(otjh['achievedTotal']), 5.0)
        check('OTJH planned (Group A 7.5 + Group B 4.0)', num(otjh['plannedTotal']), 11.5)
        check('authored OTJH for the whole programme', num(otjh['authoredTotal']), 11.5)
        check('completed activities counted', otjh['completedActivityCount'], 2)
        check('learner A achieved', num(learner_row(payload, 'E2E Learner A')['achievedOtjh']), 5.0)
        check('learner A measured against Group A only', num(learner_row(payload, 'E2E Learner A')['plannedOtjh']), 7.5)
        check('learner B achieved nothing yet', num(learner_row(payload, 'E2E Learner B')['achievedOtjh']), 0.0)
        check('learner B measured against Group B only', num(learner_row(payload, 'E2E Learner B')['plannedOtjh']), 4.0)

        check('K1 fully earned', (num(ksb_row(payload, 'K1')['achievedWeightTotal']),
                                 num(ksb_row(payload, 'K1')['expectedWeightTotal'])), (100.0, 100.0))
        check('K1 status', ksb_row(payload, 'K1')['status'], 'complete')
        check('K2 part earned', (num(ksb_row(payload, 'K2')['achievedWeightTotal']),
                                num(ksb_row(payload, 'K2')['expectedWeightTotal'])), (40.0, 100.0))
        check('S1 part earned', (num(ksb_row(payload, 'S1')['achievedWeightTotal']),
                                num(ksb_row(payload, 'S1')['expectedWeightTotal'])), (50.0, 100.0))
        check('B1 authored but untouched', (num(ksb_row(payload, 'B1')['achievedWeightTotal']),
                                            ksb_row(payload, 'B1')['status']), (0.0, 'not_started'))
        check('S2 belongs to Group B only', (num(ksb_row(payload, 'S2')['plannedWeight']),
                                            num(ksb_row(payload, 'S2')['expectedWeightTotal'])), (100.0, 100.0))
        check('total achieved weight', num(ksb['achievedWeightTotal']), 190.0)
        check('total expected weight', num(ksb['expectedWeightTotal']), 500.0)

        print('   K / S / B families')
        check('Knowledge started', family(payload, 'K')['startedCount'], 2)
        check('Knowledge missing', family(payload, 'K')['missingCount'], family(payload, 'K')['requiredCount'] - 2)
        check('Knowledge weight', (num(family(payload, 'K')['cappedAchievedWeightTotal']),
                                   num(family(payload, 'K')['expectedWeightTotal'])), (140.0, 200.0))
        check('Skills started', family(payload, 'S')['startedCount'], 1)
        check('Skills weight', (num(family(payload, 'S')['cappedAchievedWeightTotal']),
                                num(family(payload, 'S')['expectedWeightTotal'])), (50.0, 200.0))
        check('Behaviours started', family(payload, 'B')['startedCount'], 0)
        check('every KSB is in exactly one family',
              sum(f['ksbCount'] for f in ksb['byType']), ksb['ksbCount'])
        check('missing = not started, across families',
              sum(f['missingCount'] for f in ksb['byType']), ksb['missingCount'])

        # ─────────────────────────────────────────────────────────────────
        print('STEP 8  Cohort scope')
        cohort_payload = impact('cohort', cohort_id)
        check('cohort OTJH achieved', num(cohort_payload['otjhAchievement']['achievedTotal']), 5.0)
        check('cohort learners', cohort_payload['assignedLearnerCount'], 2)
        check('cohort groups delivering', cohort_payload['structure']['groupCount'], 2)

        # ─────────────────────────────────────────────────────────────────
        print('STEP 9  Group scope: each group answers for itself')
        a_payload = impact('group', group_a_id)
        b_payload = impact('group', group_b_id)
        check('Group A learners', a_payload['assignedLearnerCount'], 1)
        check('Group A OTJH', (num(a_payload['otjhAchievement']['achievedTotal']),
                               num(a_payload['otjhAchievement']['plannedTotal'])), (5.0, 7.5))
        check('Group A weight', (num(a_payload['ksbAchievement']['achievedWeightTotal']),
                                 num(a_payload['ksbAchievement']['expectedWeightTotal'])), (190.0, 400.0))
        check('Group A never sees S2', num(ksb_row(a_payload, 'S2')['plannedWeight']), 0.0)
        check('Group B learners', b_payload['assignedLearnerCount'], 1)
        check('Group B OTJH', (num(b_payload['otjhAchievement']['achievedTotal']),
                               num(b_payload['otjhAchievement']['plannedTotal'])), (0.0, 4.0))
        check('Group B owns S2', num(ksb_row(b_payload, 'S2')['expectedWeightTotal']), 100.0)
        check('Group B never sees K1', num(ksb_row(b_payload, 'K1')['plannedWeight']), 0.0)

        # ─────────────────────────────────────────────────────────────────
        print('STEP 10 Module and week scope')
        module_payload = impact('module', module_a_id)
        check('module A OTJH', (num(module_payload['otjhAchievement']['achievedTotal']),
                                num(module_payload['otjhAchievement']['plannedTotal'])), (5.0, 7.5))
        week_payload = impact('week', week_one_id)
        check('week 1 OTJH (video + reading only)',
              num(week_payload['otjhAchievement']['achievedTotal']), 5.0)
        check('week 1 planned', num(week_payload['otjhAchievement']['plannedTotal']), 5.0)
        check('week 1 does not claim B1', num(ksb_row(week_payload, 'B1')['plannedWeight']), 0.0)

        # ─────────────────────────────────────────────────────────────────
        print('STEP 11 Learner A watches the same video again: credited once')
        learner_post(learner_videos.submit_video_progress, f'/videos/{video_id}/complete/',
                     video_id, learner_a_source.id, {'week': 'Week 1', 'module': f'{TAG} Module A'})
        repeat = impact('programme', programme_id)
        check('OTJH unchanged after the repeat', num(repeat['otjhAchievement']['achievedTotal']), 5.0)
        check('K1 weight unchanged after the repeat', num(ksb_row(repeat, 'K1')['achievedWeightTotal']), 100.0)
        check('the repeat is still reported as activity', repeat['learnerActivityCount'], 3)
        check('and marked as a repeat',
              [a['exclusionReason'] for a in repeat['learnerActivities'] if a['exclusionReason']],
              ['repeat_completion'])

        # ─────────────────────────────────────────────────────────────────
        print('STEP 12 A failed graded attempt on the quiz component earns nothing')
        save_progress_record(
            profile_a,
            {
                'kind': 'quiz', 'componentId': quiz_id, 'componentType': 'quiz',
                'attempt': 1, 'passed': False, 'grade': 20, 'achieved_score': 1,
                'submittedAt': '2026-09-10T10:00:00+00:00',
            },
            {'kind': 'quiz', 'action': 'Completed quiz', 'title': 'E2E Quiz 1'},
        )
        failed = impact('programme', programme_id)
        check('OTJH unchanged by the failed attempt', num(failed['otjhAchievement']['achievedTotal']), 5.0)
        check('K2 unchanged by the failed attempt', num(ksb_row(failed, 'K2')['achievedWeightTotal']), 40.0)
        check('the failed attempt is visible as history',
              [a['progressStatus'] for a in failed['learnerActivities'] if a['componentId'] == quiz_id],
              ['failed'])

        # ─────────────────────────────────────────────────────────────────
        print('STEP 13 Learner A finishes the slides: B1 appears, S1 completes')
        learner_post(learner_components.submit_component_progress, f'/components/{slides_id}/complete/',
                     slides_id, learner_a_source.id, {'week': 'Week 2', 'module': f'{TAG} Module A'})
        done = impact('programme', programme_id)
        check('OTJH after the slides', num(done['otjhAchievement']['achievedTotal']), 6.5)
        check('S1 now complete', (num(ksb_row(done, 'S1')['achievedWeightTotal']),
                                  ksb_row(done, 'S1')['status']), (100.0, 'complete'))
        check('B1 now earned', num(ksb_row(done, 'B1')['achievedWeightTotal']), 100.0)
        check('Behaviours family started', family(done, 'B')['startedCount'], 1)
        check('Skills weight after the slides', num(family(done, 'S')['cappedAchievedWeightTotal']), 100.0)

        print()
        print('SUMMARY  what the Achievement KSBs tab would show for this programme')
        print(f'   learners assigned      {done["assignedLearnerCount"]}')
        print(f'   OTJH achieved/planned  {num(done["otjhAchievement"]["achievedTotal"])} / '
              f'{num(done["otjhAchievement"]["plannedTotal"])}')
        print(f'   KSB weight earned      {num(done["ksbAchievement"]["cappedAchievedWeightTotal"])} / '
              f'{num(done["ksbAchievement"]["expectedWeightTotal"])}')
        print(f'   KSBs started/total     {done["ksbAchievement"]["startedCount"]}/'
              f'{done["ksbAchievement"]["ksbCount"]}   missing {done["ksbAchievement"]["missingCount"]}')
        for entry in done['ksbAchievement']['byType']:
            print(f'   {entry["letter"]} {entry["label"]:<12} started {entry["startedCount"]:>2}/'
                  f'{entry["requiredCount"]:<3} missing {entry["missingCount"]:>2}  '
                  f'weight {num(entry["cappedAchievedWeightTotal"])}/{num(entry["expectedWeightTotal"])}')
        for row in done['otjhAchievement']['learners']:
            print(f'   {row["learnerName"]:<16} {row["cohort"]} / {row["group"]:<20} '
                  f'OTJH {num(row["achievedOtjh"])}/{num(row["plannedOtjh"])}  '
                  f'activities {row["completedActivityCount"]}')

        raise Rollback()
except Rollback:
    print()
    print('Transaction rolled back.')

after = counts()
print('Row counts after: ', after)
drift = {name: (before[name], after[name]) for name in before if before[name] != after[name]}
print('Drift:', drift or 'none - nothing was committed')

print()
print(f'{checks - len(failures)}/{checks} checks passed')
for failure in failures:
    print(f'  FAIL {failure}')
sys.exit(1 if failures or drift else 0)
