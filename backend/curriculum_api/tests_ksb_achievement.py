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
    'reported_time', 'feedback', 'passed', 'programme_ref', 'cohort_ref',
    'group_ref', 'module_ref', 'week_ref', 'progress_expected_otjh',
    'component_expected_otjh', 'resolved_component_title', 'ksb_code', 'weight',
    'weight_class',
)


def progress_row(*, learner_id=19, progress_id=1, kind='component',
                 component_ref='COMP-20260816E2E', passed=None, code='K1',
                 weight=50, weight_class='hard', progress_expected_otjh=3,
                 component_expected_otjh=3, programme_ref='PROG-1',
                 cohort_ref='COHORT-1', group_ref='GROUP-1',
                 module_ref='MOD-1', week_ref='WEEK-1'):
    return (
        learner_id, progress_id, kind, component_ref, 'E2E activity',
        'assignment', None, 'Module One', 'Week 1', None,
        '2.5 hours', 'Reflection text', passed, programme_ref, cohort_ref,
        group_ref, module_ref, week_ref, progress_expected_otjh,
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


class LearnerProgressOtjhVisibilityTests(SimpleTestCase):
    """A completed component must be visible whether or not it has KSBs.

    The reader joined ``learner_progress_ksbs`` with an inner join, so an
    activity with no KSB snapshot produced no row at all — and every scope's
    achieved OTJH is summed from these rows. A programme whose components carry
    no KSB mappings yet reported zero hours achieved while its learners had
    completed the lot. The LEFT join is what makes the hours independent of the
    mappings; these pin it.
    """

    def _run(self, rows, codes=('K1', 'S2', 'B1'), **kwargs):
        cursor = FakeCursor(PROGRESS_COLUMNS, rows)
        with patch.object(views, 'connection', FakeConnection(cursor)):
            with patch.object(views, 'learner_schema_table_exists', return_value=True):
                return views.learner_progress_ksb_consumption([19], list(codes), **kwargs)

    def test_an_activity_with_no_ksb_snapshot_still_reports_its_hours(self):
        totals, achieved, excluded = self._run([
            progress_row(code=None, weight=None, weight_class=None),
        ])

        self.assertEqual(totals, {})
        self.assertEqual(len(achieved), 1)
        self.assertEqual(achieved[0]['code'], '')
        self.assertEqual(achieved[0]['weight'], 0)
        self.assertEqual(achieved[0]['expectedOtjh'], 3)
        self.assertTrue(achieved[0]['countsTowardAchievement'])
        self.assertEqual(excluded, [])

    def test_the_reader_left_joins_the_ksb_snapshot(self):
        cursor = FakeCursor(PROGRESS_COLUMNS, [progress_row()])
        with patch.object(views, 'connection', FakeConnection(cursor)):
            with patch.object(views, 'learner_schema_table_exists', return_value=True):
                views.learner_progress_ksb_consumption([19], ['K1'])

        sql = cursor.executed[0][0]
        self.assertIn('left join "Learner"."learner_progress_ksbs"', sql)

    def test_a_code_this_scope_never_authored_keeps_the_activity(self):
        """Filtering a KSB out must not take the activity's hours with it."""
        totals, achieved, _excluded = self._run([progress_row(code='K9')], codes=('K1',))

        self.assertEqual(totals, {})
        self.assertEqual([row['code'] for row in achieved], [''])
        self.assertEqual(achieved[0]['expectedOtjh'], 3)

    def test_a_deleted_component_is_still_credited_to_the_scope_it_ran_in(self):
        """The component is gone from the scope; the learner's work is not.

        ``component_ids`` is the scope's *live* content, so a module deleted
        after a learner completed it drops out of it. The progress row still
        carries the programme it was stamped with, which is what places it.
        """
        totals, achieved, _excluded = self._run(
            [progress_row(component_ref='COMP-DELETED', programme_ref='PROG-1')],
            component_ids=['COMP-STILL-THERE'],
            restrict_to_components=True,
            scope='programme',
            scope_identifier='PROG-1',
        )

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(achieved[0]['scopeStatus'], 'in_scope')
        self.assertEqual(achieved[0]['scopeBasis'], 'lineage')

    def test_a_component_from_another_programme_is_still_out_of_scope(self):
        _totals, achieved, excluded = self._run(
            [progress_row(component_ref='COMP-ELSEWHERE', programme_ref='PROG-2')],
            component_ids=['COMP-STILL-THERE'],
            restrict_to_components=True,
            scope='programme',
            scope_identifier='PROG-1',
        )

        self.assertEqual(achieved, [])
        self.assertEqual(excluded[0]['scopeStatus'], 'out_of_scope')

    def test_the_same_component_completed_twice_is_credited_once(self):
        totals, achieved, excluded = self._run([
            progress_row(progress_id=1),
            progress_row(progress_id=2),
        ])

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(len(achieved), 1)
        # Kept as history rather than dropped, so the repeat is inspectable.
        self.assertEqual(len(excluded), 1)
        self.assertEqual(excluded[0]['exclusionReason'], 'repeat_completion')
        self.assertFalse(excluded[0]['countsTowardAchievement'])


class KsbAchievementByTypeTests(SimpleTestCase):
    """Knowledge / Skills / Behaviours, each with its own achieved and missing."""

    @staticmethod
    def _row(code, ksb_type, status, learners_achieved=0, expected=10, capped=0):
        return {
            'code': code,
            'ksbType': ksb_type,
            'status': status,
            'learnersAchievedCount': learners_achieved,
            'plannedWeight': expected,
            'expectedWeightTotal': expected,
            'achievedWeightTotal': capped,
            'cappedAchievedWeightTotal': capped,
        }

    def test_each_family_counts_its_own_achieved_and_missing(self):
        by_type = {
            family['letter']: family
            for family in views.ksb_achievement_by_type([
                self._row('K1', 'knowledge', 'in_progress', learners_achieved=2, capped=5),
                self._row('K2', 'knowledge', 'not_started'),
                self._row('S1', 'Skills', 'complete', learners_achieved=3, capped=10),
                self._row('B1', 'Behaviours', 'unmapped', expected=0),
            ])
        }

        self.assertEqual(by_type['K']['startedCount'], 1)
        self.assertEqual(by_type['K']['missingCount'], 1)
        self.assertEqual(by_type['K']['progressPercentage'], 25.0)
        self.assertEqual(by_type['S']['completeCount'], 1)
        self.assertEqual(by_type['S']['missingCount'], 0)
        # Taught nowhere is a missing KSB too, and separately countable.
        self.assertEqual(by_type['B']['missingCount'], 1)
        self.assertEqual(by_type['B']['unmappedCount'], 1)

    def test_the_family_comes_from_the_code_when_the_type_is_missing(self):
        by_type = {
            family['letter']: family
            for family in views.ksb_achievement_by_type([
                self._row('S4', '', 'in_progress', learners_achieved=1, capped=10),
            ])
        }

        self.assertEqual(by_type['S']['ksbCount'], 1)
        self.assertEqual(by_type['K']['ksbCount'], 0)

    def test_an_unplanned_ksb_is_not_counted_as_one_of_the_scopes_gaps(self):
        by_type = {
            family['letter']: family
            for family in views.ksb_achievement_by_type([
                self._row('K5', 'knowledge', 'unplanned', learners_achieved=1, expected=0, capped=20),
            ])
        }

        self.assertEqual(by_type['K']['unplannedCount'], 1)
        self.assertEqual(by_type['K']['requiredCount'], 0)
        self.assertEqual(by_type['K']['missingCount'], 0)
