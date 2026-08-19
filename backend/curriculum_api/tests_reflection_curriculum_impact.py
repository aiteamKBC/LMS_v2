"""Reflection -> Progress -> Curriculum impact: the traceability contract.

A reflection is a write-up about a Progress activity. It reaches Curriculum
impact through ``learning_reflection_submissions.progress_entry_id`` and nothing
else — not the submission's ``learner_id`` (that is an enrolment *source* id, a
different id space), not an email, not a title.

Two things have to hold at once, and they pull in opposite directions:

1. the reflection and its ``actual_time_hours`` must *arrive*, attached to the
   same Progress activity whose expected OTJH the Component supplies;
2. the reflection's KSB declaration must *not* be added to achieved weight — the
   Component Progress snapshot (``learner_progress_ksbs``) is the canonical
   source, and counting both would credit one activity's KSBs twice.

These tests drive the aggregation seams (``learner_activity_trace``,
``learner_consumption_payload``) with scripted rows, so the contract is covered
without PostgreSQL. ``tests_ksb_achievement.py`` covers the reader that produces
those rows.
"""
from django.test import SimpleTestCase

from . import views


def progress_source_row(*, learner_id=18, progress_id=90, code='K1', weight=50,
                        weight_class='hard', counts=True, status='achieved',
                        expected_otjh=3, expected_source='learner_progress_entries'):
    """A row as ``learner_progress_ksb_consumption`` emits it."""
    return {
        'source': 'progress',
        'learnerId': learner_id,
        'progressId': progress_id,
        'kind': 'component',
        'componentId': 'COMP-20260816E2E',
        'componentTitle': 'E2E Integration Audit Component',
        'componentType': 'reading',
        'module': 'Module',
        'week': 'Week 1',
        'submittedAt': '2026-08-16T14:26:48.251390+00:00',
        'plannedOtjh': expected_otjh,
        'plannedOtjhSource': expected_source,
        'expectedOtjh': expected_otjh,
        'expectedOtjhSource': expected_source,
        'code': code,
        'weight': weight,
        'weightClass': weight_class,
        'passed': None,
        'achievementStatus': status,
        'countsTowardAchievement': counts,
    }


def reflection_source_row(*, learner_id=18, progress_entry_id=90, code='K1',
                          weight=50, actual_otjh=2.5, expected_otjh=3,
                          expected_source='learner_progress_entries',
                          declared=(('K1', 50), ('S2', 30), ('B1', 20))):
    """A row as ``reflection_submission_ksb_consumption`` emits it."""
    return {
        'source': 'learning_reflection_submissions',
        'learnerId': learner_id,
        'submissionId': 'e0aa44ee-89a4-4510-98b0-3484dd5c2aa2',
        'progressEntryId': progress_entry_id,
        'progressLinkStatus': 'linked',
        'learnerResolution': 'progress_lineage',
        'submissionLearnerId': '37',
        'componentId': 'COMP-20260816E2E',
        'componentTitle': 'E2E Integration Audit Component',
        'componentType': 'reading',
        'module': 'Module',
        'week': 'Week 1',
        'progressKind': 'component',
        'activityId': 'COMP-20260816E2E',
        'expectedOtjh': expected_otjh,
        'expectedOtjhSource': expected_source,
        'declaredPlannedOtjh': 3,
        'actualOtjh': actual_otjh,
        'actualOtjhSource': 'learning_reflection_submissions',
        'plannedOtjh': expected_otjh,
        'plannedOtjhSource': expected_source,
        'actualTimeHours': actual_otjh,
        'actualTimeHoursSource': 'learning_reflection_submissions',
        'status': 'accepted',
        'reflection': 'Controlled reflection text.',
        'submittedAt': '2026-08-16T14:26:50.077989+00:00',
        'dateCompleted': '2026-08-16',
        'qualityScore': 100,
        'declaredKsbs': [{'code': item[0], 'weight': item[1]} for item in declared],
        'code': code,
        'weight': weight,
        'achievementStatus': 'achieved',
        'countsTowardAchievement': False,
        'ksbRole': 'supplementary_evidence',
        'activityCountsTowardAchievement': True,
    }


CONTROLLED_PROGRESS = [
    progress_source_row(code='K1', weight=50, weight_class='hard'),
    progress_source_row(code='S2', weight=30, weight_class='soft'),
    progress_source_row(code='B1', weight=20, weight_class='possible'),
]
CONTROLLED_REFLECTION = [
    reflection_source_row(code='K1', weight=50),
    reflection_source_row(code='S2', weight=30),
    reflection_source_row(code='B1', weight=20),
]
CONTROLLED_EVIDENCE = {
    '90': [{
        'evidenceId': 'c572a94d-b68b-4c49-8ea1-c7c6700bfaac',
        'fileName': 'codex-e2e-c.pdf',
        'status': 'approved',
        'scanResult': 'clean',
        'sectionRef': 'COMP-20260816E2E',
        'componentId': 'COMP-20260816E2E',
        'contentType': 'application/pdf',
        'sizeBytes': 28,
        'uploadedAt': '2026-08-16T14:26:52.939109+00:00',
    }],
}


class ReflectionProgressTraceTests(SimpleTestCase):
    """The controlled activity: expected OTJH 3, actual 2.5, K1/S2/B1 50/30/20."""

    def trace(self, progress=None, reflections=None, excluded_progress=(),
              excluded_reflections=(), evidence=None):
        return views.learner_activity_trace(
            CONTROLLED_PROGRESS if progress is None else progress,
            list(excluded_progress),
            CONTROLLED_REFLECTION if reflections is None else reflections,
            list(excluded_reflections),
            CONTROLLED_EVIDENCE if evidence is None else evidence,
        )

    def test_one_activity_carries_progress_component_reflection_and_evidence(self):
        activities = self.trace()

        self.assertEqual(len(activities), 1)
        activity = activities[0]
        self.assertEqual(activity['progressId'], 90)
        self.assertEqual(activity['learnerId'], 18)
        self.assertEqual(activity['componentId'], 'COMP-20260816E2E')
        self.assertEqual(activity['progressStatus'], 'achieved')
        self.assertTrue(activity['countsTowardAchievement'])
        self.assertEqual(activity['reflection']['submissionId'], 'e0aa44ee-89a4-4510-98b0-3484dd5c2aa2')
        self.assertEqual(activity['evidenceCount'], 1)
        self.assertEqual(activity['evidence'][0]['fileName'], 'codex-e2e-c.pdf')

    def test_the_reflection_resolves_to_the_progress_row_it_belongs_to(self):
        activity = self.trace()[0]

        self.assertEqual(activity['reflection']['progressLinkStatus'], 'linked')
        self.assertEqual(activity['reflection']['learnerResolution'], 'progress_lineage')
        # The enrolment source id is carried for audit, never used to resolve.
        self.assertEqual(activity['reflection']['submissionLearnerId'], '37')

    def test_expected_otjh_is_three_and_actual_otjh_is_two_point_five(self):
        """The required pair, on one activity, from two named sources."""
        activity = self.trace()[0]

        self.assertEqual(activity['expectedOtjh'], 3)
        self.assertEqual(activity['expectedOtjhSource'], 'learner_progress_entries')
        self.assertEqual(activity['actualOtjh'], 2.5)
        self.assertEqual(activity['actualOtjhSource'], 'learning_reflection_submissions')
        # Two fields, never collapsed into one.
        self.assertNotEqual(activity['expectedOtjh'], activity['actualOtjh'])

    def test_the_ksb_snapshot_is_the_canonical_achievement_source(self):
        activity = self.trace()[0]

        self.assertEqual(
            {item['code']: (item['weight'], item['weightClass']) for item in activity['ksbSnapshot']},
            {'K1': (50, 'hard'), 'S2': (30, 'soft'), 'B1': (20, 'possible')},
        )
        self.assertEqual(activity['achievedKsbWeightTotal'], 100)

    def test_the_reflection_declaration_is_kept_in_its_own_list(self):
        activity = self.trace()[0]

        self.assertEqual(
            {item['code']: item['weight'] for item in activity['declaredReflectionKsbs']},
            {'K1': 50, 'S2': 30, 'B1': 20},
        )
        self.assertEqual(activity['declaredReflectionKsbWeightTotal'], 100)
        # Same numbers, different list. Summing the two lists is the bug.
        self.assertEqual(activity['achievedKsbWeightTotal'], 100)
        for item in activity['declaredReflectionKsbs']:
            self.assertFalse(item['countsTowardAchievement'])
        self.assertFalse(activity['reflection']['countsTowardAchievement'])

    def test_a_reflection_with_no_progress_link_creates_no_activity(self):
        activities = self.trace(reflections=[
            reflection_source_row(progress_entry_id=None, learner_id=None),
        ])

        self.assertEqual(len(activities), 1)
        self.assertIsNone(activities[0]['reflection'])
        self.assertIsNone(activities[0]['actualOtjh'])

    def test_a_failed_activity_keeps_its_reflection_but_not_its_weight(self):
        """The §1 achievement rule, still holding with reflections resolving."""
        activities = self.trace(
            progress=[],
            reflections=[],
            excluded_progress=[
                progress_source_row(code='K1', weight=50, counts=False, status='failed'),
            ],
            excluded_reflections=[
                reflection_source_row(code='K1', weight=50),
            ],
        )

        activity = activities[0]
        self.assertEqual(activity['progressStatus'], 'failed')
        self.assertFalse(activity['countsTowardAchievement'])
        self.assertEqual(activity['achievedKsbWeightTotal'], 0)
        # Still visible, with its hours, so the exclusion is auditable.
        self.assertEqual(activity['actualOtjh'], 2.5)
        self.assertEqual(activity['evidenceCount'], 1)

    def test_activities_from_different_learners_stay_separate(self):
        activities = self.trace(
            progress=CONTROLLED_PROGRESS + [
                progress_source_row(learner_id=19, progress_id=91, code='K1'),
            ],
        )

        self.assertEqual(
            {(entry['learnerId'], entry['progressId']) for entry in activities},
            {(18, 90), (19, 91)},
        )


class ReflectionDoesNotDoubleCountTests(SimpleTestCase):
    """Achieved weight has exactly one source, whatever the reflection declares."""

    COVERAGE = [
        {'code': 'K1', 'raw_total_weight': 50},
        {'code': 'S2', 'raw_total_weight': 30},
        {'code': 'B1', 'raw_total_weight': 20},
    ]
    LEARNERS = [{'id': 18, 'name': 'Codex E2E Learner', 'email': 'e2e@example.com'}]

    def payload(self, progress_totals, declared_totals):
        return views.learner_consumption_payload(
            self.LEARNERS, self.COVERAGE, progress_totals, declared_totals,
        )[0]

    def test_declared_reflection_weight_is_not_added_to_consumed_weight(self):
        """The controlled case: both sources say K1 50, S2 30, B1 20.

        Achieved must stay 100, not become 200.
        """
        totals = {18: {'K1': 50, 'S2': 30, 'B1': 20}}
        learner = self.payload(totals, dict(totals))

        self.assertEqual(learner['consumedWeightTotal'], 100)
        self.assertEqual(learner['consumedWeightSource'], 'learner_progress_ksbs')
        self.assertEqual(learner['declaredReflectionWeightTotal'], 100)
        self.assertEqual(
            {row['code']: (row['consumedWeight'], row['declaredReflectionWeight'])
             for row in learner['ksbs']},
            {'K1': (50, 50), 'S2': (30, 30), 'B1': (20, 20)},
        )

    def test_progress_percentage_ignores_the_declaration(self):
        totals = {18: {'K1': 50, 'S2': 30, 'B1': 20}}
        with_declaration = self.payload(totals, dict(totals))
        without = self.payload(totals, {})

        self.assertEqual(with_declaration['progressPercentage'], without['progressPercentage'])
        self.assertEqual(with_declaration['consumedWeightTotal'], without['consumedWeightTotal'])

    def test_a_declaration_alone_achieves_nothing(self):
        learner = self.payload({}, {18: {'K1': 50}})

        self.assertEqual(learner['consumedWeightTotal'], 0)
        self.assertEqual(learner['declaredReflectionWeightTotal'], 50)
        self.assertEqual(
            {row['code']: row['status'] for row in learner['ksbs']},
            {'K1': 'not_started', 'S2': 'not_started', 'B1': 'not_started'},
        )


class ReflectionOtjhAttributionTests(SimpleTestCase):
    """Reflection OTJH is reported as its own fields, not over the canonical ones."""

    def test_reflection_otjh_is_attached_without_replacing_programme_hours(self):
        learners = [{'id': 18, 'completedHours': 9, 'plannedHours': 26.5}]
        views.apply_reflection_otjh_to_learners(learners, CONTROLLED_REFLECTION)

        # The programme-wide figures are untouched: a single reflection is a
        # subtotal, and substituting it under-reports every other activity.
        self.assertEqual(learners[0]['completedHours'], 9)
        self.assertEqual(learners[0]['plannedHours'], 26.5)
        self.assertEqual(learners[0]['reflectionActualOtjh'], 2.5)
        self.assertEqual(learners[0]['reflectionExpectedOtjh'], 3)
        self.assertEqual(learners[0]['reflectionCount'], 1)

    def test_one_submission_counts_once_across_its_ksb_rows(self):
        """Three rows, one submission: 2.5 hours, not 7.5."""
        learners = [{'id': 18, 'completedHours': 0, 'plannedHours': 0}]
        views.apply_reflection_otjh_to_learners(learners, CONTROLLED_REFLECTION)

        self.assertEqual(learners[0]['reflectionActualOtjh'], 2.5)
        self.assertEqual(learners[0]['reflectionExpectedOtjh'], 3)

    def test_a_missing_canonical_figure_is_filled_from_the_reflection(self):
        learners = [{'id': 18, 'completedHours': 0, 'plannedHours': 0}]
        views.apply_reflection_otjh_to_learners(learners, CONTROLLED_REFLECTION)

        self.assertEqual(learners[0]['completedHours'], 2.5)
        self.assertEqual(learners[0]['plannedHours'], 3)

    def test_a_learner_with_no_reflection_reports_no_reflection_otjh(self):
        learners = [{'id': 4, 'completedHours': 4, 'plannedHours': 52}]
        views.apply_reflection_otjh_to_learners(learners, CONTROLLED_REFLECTION)

        self.assertIsNone(learners[0]['reflectionActualOtjh'])
        self.assertEqual(learners[0]['reflectionCount'], 0)
        self.assertEqual(learners[0]['completedHours'], 4)
