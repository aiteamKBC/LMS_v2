"""Curriculum impact must not credit KSBs to failed or unresolved activity.

The previous behaviour: ``learner_progress_ksb_consumption`` summed every
``learner_progress_ksbs`` row joined to a progress entry, with no reference to
whether the activity succeeded. It was safe only because no failed row happened
to carry Component lineage — the shape of the live data, not a rule. A graded
Component, or any write that records ``passed=false`` next to a valid
``component_ref``, would have credited its authored KSB weight in full.

These tests drive the two consumption readers with scripted rows, so the gate is
covered without needing PostgreSQL. The reader is where the rule has to hold:
the Curriculum impact endpoint, the Coach dashboard and the Learner page all
consume its output.
"""
from unittest.mock import patch

from django.test import SimpleTestCase

from . import views


class FakeCursor:
    """Minimal DB-API surface used by ``rows_as_dicts``."""

    def __init__(self, columns, rows):
        self.description = [(name,) for name in columns]
        self._rows = list(rows)
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConnection:
    vendor = 'postgresql'

    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self

    def __enter__(self):
        return self._cursor

    def __exit__(self, exc_type, exc, tb):
        return False


PROGRESS_COLUMNS = (
    'learner_id', 'progress_id', 'kind', 'component_ref', 'component_title',
    'component_type', 'quiz_ref', 'module_title', 'week_title', 'submitted_at',
    'reported_time', 'feedback', 'passed', 'progress_expected_otjh',
    'component_expected_otjh', 'resolved_component_title', 'ksb_code', 'weight',
    'weight_class',
)


def progress_row(*, learner_id=19, progress_id=1, kind='component',
                 component_ref='COMP-20260816E2E', passed=None, code='K1',
                 weight=50, weight_class='hard', progress_expected_otjh=3,
                 component_expected_otjh=3):
    return (
        learner_id, progress_id, kind, component_ref, 'E2E activity',
        'assignment', None, 'Module One', 'Week 1', None,
        '2.5 hours', 'Reflection text', passed, progress_expected_otjh,
        component_expected_otjh, 'E2E activity', code, weight, weight_class,
    )


class LearnerProgressKsbAchievementGateTests(SimpleTestCase):
    def _run(self, rows, codes=('K1', 'S2', 'B1')):
        cursor = FakeCursor(PROGRESS_COLUMNS, rows)
        with patch.object(views, 'connection', FakeConnection(cursor)):
            with patch.object(views, 'learner_schema_table_exists', return_value=True):
                return views.learner_progress_ksb_consumption([19], list(codes))

    def test_a_completed_component_is_credited_in_full(self):
        totals, achieved, excluded = self._run([progress_row()])

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual([row['code'] for row in achieved], ['K1'])
        self.assertEqual(achieved[0]['weightClass'], 'hard')
        self.assertTrue(achieved[0]['countsTowardAchievement'])
        self.assertEqual(achieved[0]['achievementStatus'], 'achieved')
        self.assertEqual(excluded, [])

    def test_a_failed_component_is_not_credited_despite_valid_lineage(self):
        """The controlled case from the hardening brief.

        Valid ``component_ref``, valid module/week lineage, a real authored KSB
        snapshot (K1, weight 50, hard) — and ``passed=false``.
        """
        totals, achieved, excluded = self._run([progress_row(passed=False)])

        self.assertEqual(totals, {})
        self.assertEqual(achieved, [])
        # Still reported, so the activity remains visible and the exclusion is
        # auditable rather than silent.
        self.assertEqual(len(excluded), 1)
        self.assertEqual(excluded[0]['componentId'], 'COMP-20260816E2E')
        self.assertEqual(excluded[0]['code'], 'K1')
        self.assertEqual(excluded[0]['weight'], 50)
        self.assertEqual(excluded[0]['achievementStatus'], 'failed')
        self.assertFalse(excluded[0]['countsTowardAchievement'])

    def test_an_unresolved_quiz_attempt_is_not_credited(self):
        totals, achieved, excluded = self._run([
            progress_row(kind='quiz', component_ref=None, passed=None),
        ])

        self.assertEqual(totals, {})
        self.assertEqual(achieved, [])
        self.assertEqual(excluded[0]['achievementStatus'], 'incomplete')

    def test_a_passed_quiz_is_credited(self):
        totals, _achieved, excluded = self._run([
            progress_row(kind='quiz', component_ref=None, passed=True),
        ])

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(excluded, [])

    def test_a_failed_attempt_does_not_suppress_a_later_successful_one(self):
        totals, achieved, excluded = self._run([
            progress_row(progress_id=1, passed=False),
            progress_row(progress_id=2, passed=None),
        ])

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(len(achieved), 1)
        self.assertEqual(len(excluded), 1)

    def test_weights_and_weight_classes_survive_the_gate(self):
        totals, achieved, _excluded = self._run([
            progress_row(progress_id=1, code='K1', weight=50, weight_class='hard'),
            progress_row(progress_id=2, code='S2', weight=30, weight_class='soft'),
            progress_row(progress_id=3, code='B1', weight=20, weight_class='possible'),
        ])

        self.assertEqual(totals, {19: {'K1': 50.0, 'S2': 30.0, 'B1': 20.0}})
        self.assertEqual(
            {row['code']: row['weightClass'] for row in achieved},
            {'K1': 'hard', 'S2': 'soft', 'B1': 'possible'},
        )

    def test_the_reader_selects_the_columns_the_rule_needs(self):
        cursor = FakeCursor(PROGRESS_COLUMNS, [progress_row()])
        with patch.object(views, 'connection', FakeConnection(cursor)):
            with patch.object(views, 'learner_schema_table_exists', return_value=True):
                views.learner_progress_ksb_consumption([19], ['K1'])

        sql = cursor.executed[0][0]
        self.assertIn('p.passed', sql)
        self.assertIn('p.kind', sql)

    def test_expected_otjh_names_the_source_it_actually_came_from(self):
        """The label used to say `curriculum_component` either way.

        Which of the two it is matters: the progress snapshot is what the
        learner was assigned, the component is what it says today.
        """
        _totals, achieved, _excluded = self._run([progress_row(progress_expected_otjh=3)])
        self.assertEqual(achieved[0]['expectedOtjh'], 3)
        self.assertEqual(achieved[0]['expectedOtjhSource'], 'learner_progress_entries')

        _totals, achieved, _excluded = self._run([
            progress_row(progress_expected_otjh=None, component_expected_otjh=4),
        ])
        self.assertEqual(achieved[0]['expectedOtjh'], 4)
        self.assertEqual(achieved[0]['expectedOtjhSource'], 'curriculum_component')

        _totals, achieved, _excluded = self._run([
            progress_row(progress_expected_otjh=None, component_expected_otjh=None),
        ])
        self.assertIsNone(achieved[0]['expectedOtjh'])
        self.assertEqual(achieved[0]['expectedOtjhSource'], 'not_returned')


REFLECTION_COLUMNS = (
    'progress_entry_id', 'ksb_weights', 'id', 'learner_id', 'activity_id',
    'activity_title', 'planned_otjh', 'actual_time_hours', 'status',
    'component_ref', 'progress_learner_id', 'progress_kind', 'progress_passed',
    'progress_component_ref', 'progress_component_title',
    'progress_component_type', 'progress_module_title', 'progress_week_title',
    'progress_expected_otjh', 'progress_submitted_at',
    'component_expected_otjh', 'component_title',
)

REFLECTION_TABLE_COLUMNS = {
    'progress_entry_id', 'ksb_weights', 'id', 'learner_id', 'activity_id',
    'activity_title', 'planned_otjh', 'actual_time_hours', 'status',
    'component_ref', 'submitted_at',
}


def reflection_row(*, weights='{"K1": 50}', progress_entry_id=90,
                   progress_learner_id=19, progress_kind='component',
                   progress_passed=None, submission_learner_id='37',
                   progress_expected_otjh=3, actual_time_hours='2.5'):
    return (
        progress_entry_id, weights, 'SUB-1', submission_learner_id,
        'COMP-20260816E2E', 'E2E activity', '3', actual_time_hours,
        'submitted_for_tutor_review', 'COMP-20260816E2E', progress_learner_id,
        progress_kind, progress_passed, 'COMP-20260816E2E', 'E2E activity',
        'reading', 'Module One', 'Week 1', progress_expected_otjh, None, 3,
        'E2E activity',
    )


class ReflectionProgressResolutionTests(SimpleTestCase):
    """A reflection reaches a Curriculum learner only through its progress row.

    ``learning_reflection_submissions.learner_id`` holds the enrolment *source*
    id while these learners are ``"Learner"."learners"`` profile ids. Comparing
    the two matched nothing, so reflections never appeared in Curriculum impact.
    The resolution is now ``progress_entry_id`` -> the progress row's own
    ``learner_id``.
    """

    LEARNERS = [{'id': 19, 'sourceId': 19, 'sourceKind': 'learner', 'email': 'learner@example.com'}]

    def _run(self, rows, *, columns=None, component_ids=('COMP-20260816E2E',)):
        available = set(columns) if columns is not None else set(REFLECTION_TABLE_COLUMNS)
        cursor = FakeCursor(REFLECTION_COLUMNS, rows)
        with patch.object(views, 'connection', FakeConnection(cursor)):
            with patch.object(views, 'learner_schema_table_exists', return_value=True):
                with patch.object(views, 'learner_schema_columns', return_value=available):
                    return (
                        *views.reflection_submission_ksb_consumption(
                            self.LEARNERS, ['K1'], list(component_ids),
                        ),
                        cursor,
                    )

    def test_the_learner_comes_from_the_progress_row_not_the_submission(self):
        _declared, rows, _excluded, _unlinked, _cursor = self._run([reflection_row()])

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['learnerId'], 19)
        self.assertEqual(rows[0]['progressEntryId'], 90)
        self.assertEqual(rows[0]['learnerResolution'], 'progress_lineage')
        # The enrolment source id is reported, never used to resolve.
        self.assertEqual(rows[0]['submissionLearnerId'], '37')

    def test_the_query_filters_on_the_progress_row_learner(self):
        _declared, _rows, _excluded, _unlinked, cursor = self._run([reflection_row()])

        sql, params = cursor.executed[0]
        self.assertIn('pe.learner_id::text = any(%s)', sql)
        self.assertIn('pe.id = r."progress_entry_id"', sql)
        self.assertIn(['19'], params)
        # None of the forbidden identity heuristics.
        self.assertNotIn('lower(btrim', sql)
        self.assertNotIn('email', sql.lower())
        self.assertNotIn('r."learner_id"::text = any', sql)

    def test_a_reflection_never_contributes_achieved_ksb_weight(self):
        """The Component Progress snapshot is the canonical achievement source.

        The declaration is reported so it is auditable, with the role it plays
        stated on the row, but it is not a second helping of the same activity.
        """
        declared, rows, _excluded, _unlinked, _cursor = self._run([reflection_row()])

        self.assertEqual(declared, {19: {'K1': 50}})
        self.assertFalse(rows[0]['countsTowardAchievement'])
        self.assertEqual(rows[0]['ksbRole'], 'supplementary_evidence')

    def test_expected_and_actual_otjh_stay_separate_fields(self):
        _declared, rows, _excluded, _unlinked, _cursor = self._run([reflection_row()])

        self.assertEqual(rows[0]['expectedOtjh'], 3)
        self.assertEqual(rows[0]['expectedOtjhSource'], 'learner_progress_entries')
        self.assertEqual(rows[0]['actualOtjh'], 2.5)
        self.assertEqual(rows[0]['actualOtjhSource'], 'learning_reflection_submissions')

    def test_expected_otjh_prefers_the_progress_snapshot_over_the_declaration(self):
        _declared, rows, _excluded, _unlinked, _cursor = self._run(
            [reflection_row(progress_expected_otjh=None)],
        )

        # Falls through to the component, not to the learner's own `planned_otjh`.
        self.assertEqual(rows[0]['expectedOtjh'], 3)
        self.assertEqual(rows[0]['expectedOtjhSource'], 'curriculum_component')
        self.assertEqual(rows[0]['declaredPlannedOtjh'], 3)

    def test_a_reflection_on_failed_activity_is_excluded(self):
        """A reflection cannot launder a failed attempt into achievement.

        It is linked by ``progress_entry_id``, so the same completion rule
        decides it — no second model.
        """
        declared, rows, excluded, _unlinked, _cursor = self._run(
            [reflection_row(progress_passed=False)],
        )

        self.assertEqual(declared, {})
        self.assertEqual(rows, [])
        self.assertEqual(len(excluded), 1)
        self.assertEqual(excluded[0]['achievementStatus'], 'failed')
        self.assertEqual(excluded[0]['activityId'], 'COMP-20260816E2E')

    def test_a_reflection_with_no_progress_link_is_reported_not_attributed(self):
        declared, rows, excluded, unlinked, _cursor = self._run([
            reflection_row(progress_entry_id=None, progress_learner_id=None, progress_kind=None),
        ])

        self.assertEqual(declared, {})
        self.assertEqual(rows, [])
        self.assertEqual(excluded, [])
        self.assertEqual(len(unlinked), 1)
        self.assertIsNone(unlinked[0]['learnerId'])
        self.assertEqual(unlinked[0]['progressLinkStatus'], 'unlinked')
        self.assertEqual(unlinked[0]['learnerResolution'], 'unresolved')
        self.assertEqual(unlinked[0]['achievementStatus'], 'unlinked')

    def test_a_progress_row_belonging_to_another_learner_is_not_attributed(self):
        """The ambiguity the old identity match created, pinned shut.

        The submission's `learner_id` is one of ours; the progress row it points
        at belongs to somebody else. It must not be credited to our learner.
        """
        declared, rows, _excluded, unlinked, _cursor = self._run([
            reflection_row(progress_learner_id=999, submission_learner_id='19'),
        ])

        self.assertEqual(declared, {})
        self.assertEqual(rows, [])
        self.assertEqual(len(unlinked), 1)

    def test_a_reflection_with_no_declared_ksbs_still_reports_its_hours(self):
        _declared, rows, _excluded, _unlinked, _cursor = self._run(
            [reflection_row(weights='{}')],
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['code'], '')
        self.assertEqual(rows[0]['actualOtjh'], 2.5)

    def test_no_progress_link_column_means_nothing_is_reported(self):
        """Without the deterministic key there is no sound resolution.

        Reporting nothing beats reporting a guess.
        """
        declared, rows, excluded, unlinked, _cursor = self._run(
            [reflection_row()],
            columns={'ksb_weights', 'id', 'learner_id', 'activity_id'},
        )

        self.assertEqual((declared, rows, excluded, unlinked), ({}, [], [], []))
