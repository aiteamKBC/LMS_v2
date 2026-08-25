"""Scope-level achievement roll-ups: Programme -> Cohort -> Group -> Module.

The behaviour under test is the one the Curriculum workspace now depends on at
every level of the hierarchy:

* a scope's achievement is computed from the components *inside that scope*, so a
  cohort is never handed the whole programme's consumption;
* activity that cannot be attributed to a component counts only at programme
  level, where it is at least in the right place, and never below it;
* achieved OTJH credits the learner's own declared hours where a reflection
  exists and the component's expectation where the activity completed without
  one — reporting either alone under-counts;
* achieved KSB weight is capped per learner against the authored weight, so a
  percentage cannot exceed 100 while the uncapped sum stays visible.
"""

from unittest.mock import patch

from django.test import SimpleTestCase

from . import views


PROGRESS_COLUMNS = [
    'learner_id', 'progress_id', 'kind', 'component_ref', 'component_title',
    'component_type', 'quiz_ref', 'module_title', 'week_title', 'submitted_at',
    'reported_time', 'feedback', 'passed', 'progress_expected_otjh',
    'component_expected_otjh', 'resolved_component_title', 'ksb_code', 'weight',
    'weight_class',
]


def progress_row(*, learner_id=19, progress_id=100, component_ref='COMP-IN',
                 code='K1', weight=50, passed=True, expected_otjh=2):
    return (
        learner_id, progress_id, 'assignment', component_ref, 'Activity',
        'assignment', None, 'Module One', 'Week 1', None,
        '2 hours', 'Reflection text', passed, expected_otjh,
        expected_otjh, 'Activity', code, weight, 'hard',
    )


class FakeCursor:
    def __init__(self, columns, rows):
        self.description = [(name,) for name in columns]
        self._rows = list(rows)
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return list(self._rows)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


class FakeConnection:
    vendor = 'postgresql'

    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


class ProgressScopeFilterTests(SimpleTestCase):
    """``component_ids`` is what makes a cohort's number its own."""

    def _run(self, rows, component_ids=(), include_unattributed=True, restrict=None):
        restrict = (not include_unattributed) if restrict is None else restrict
        cursor = FakeCursor(PROGRESS_COLUMNS, rows)
        with patch.object(views, 'connection', FakeConnection(cursor)):
            with patch.object(views, 'learner_schema_table_exists', return_value=True):
                return views.learner_progress_ksb_consumption(
                    [19], ['K1'], list(component_ids), include_unattributed,
                    restrict_to_components=restrict,
                )

    def test_without_a_scope_every_activity_counts(self):
        totals, achieved, excluded = self._run([progress_row()])

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(achieved[0]['scopeStatus'], 'in_scope')
        self.assertEqual(excluded, [])

    def test_an_activity_outside_the_scope_is_reported_not_summed(self):
        totals, achieved, excluded = self._run(
            [progress_row(component_ref='COMP-ELSEWHERE')], component_ids=['COMP-IN'],
        )

        self.assertEqual(totals, {})
        self.assertEqual(achieved, [])
        self.assertEqual(len(excluded), 1)
        self.assertEqual(excluded[0]['scopeStatus'], 'out_of_scope')
        # It is real achievement, so the exclusion must not read as a failure.
        self.assertEqual(excluded[0]['achievementStatus'], 'achieved')
        self.assertFalse(excluded[0]['countsTowardAchievement'])

    def test_an_activity_inside_the_scope_still_counts(self):
        totals, achieved, _excluded = self._run(
            [progress_row(component_ref='COMP-IN')], component_ids=['COMP-IN'],
        )

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(achieved[0]['scopeStatus'], 'in_scope')

    def test_activity_with_no_component_counts_only_at_programme_level(self):
        """The widest scope may keep it; anything narrower would be a guess."""
        rows = [progress_row(component_ref='')]

        totals, achieved, _excluded = self._run(
            rows, component_ids=['COMP-IN'], include_unattributed=True,
        )
        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(achieved[0]['scopeStatus'], 'unattributed')

        totals, achieved, excluded = self._run(
            rows, component_ids=['COMP-IN'], include_unattributed=False,
        )
        self.assertEqual(totals, {})
        self.assertEqual(achieved, [])
        self.assertEqual(excluded[0]['scopeStatus'], 'unattributed')


    def test_a_scope_with_no_components_credits_nothing(self):
        """An empty component list means "nothing is here", not "no filter".

        Without this a cohort that has authored no components yet was credited
        with everything its learners did anywhere on the programme.
        """
        totals, achieved, excluded = self._run(
            [progress_row()], component_ids=[], include_unattributed=False,
        )

        self.assertEqual(totals, {})
        self.assertEqual(achieved, [])
        self.assertEqual(excluded[0]['scopeStatus'], 'out_of_scope')

    def test_a_programme_with_no_linked_modules_still_credits_its_learners(self):
        """The widest scope keeps the old behaviour: no filter to apply."""
        totals, achieved, _excluded = self._run(
            [progress_row()], component_ids=[], include_unattributed=True,
        )

        self.assertEqual(totals, {19: {'K1': 50.0}})
        self.assertEqual(achieved[0]['scopeStatus'], 'in_scope')


class ScopeAuthoredPlanTests(SimpleTestCase):
    """A module belongs to one group, so a scope total is not a learner total."""

    MODULES = [
        {'module_catalogue_id': 'MOD-A1', 'group_name': 'A1'},
        {'module_catalogue_id': 'MOD-A2', 'group_name': 'A2'},
    ]
    COMPONENTS = [
        {'id': 'C1', 'module_catalogue_id': 'MOD-A1', 'expected_otjh': 3},
        {'id': 'C2', 'module_catalogue_id': 'MOD-A1', 'expected_otjh': 2},
        {'id': 'C3', 'module_catalogue_id': 'MOD-A2', 'expected_otjh': 5},
    ]
    COVERAGE = [{
        'code': 'K1',
        'raw_total_weight': 100,
        'mappings': [
            {'module_id': 'MOD-A1', 'group_name': 'A1', 'weight': 50},
            {'module_id': 'MOD-A2', 'group_name': 'A2', 'weight': 50},
        ],
    }]

    def test_otjh_and_weight_are_split_by_the_delivering_group(self):
        plan = views.scope_authored_plan(self.MODULES, self.COMPONENTS, self.COVERAGE)

        self.assertEqual(plan['scopeOtjh'], 10)
        self.assertEqual(plan['otjhByGroup']['a1'], 5)
        self.assertEqual(plan['otjhByGroup']['a2'], 5)
        self.assertEqual(plan['scopeKsbWeights']['K1'], 100)
        self.assertEqual(plan['ksbByGroup']['a1']['K1'], 50)
        self.assertEqual(plan['ksbByGroup']['a2']['K1'], 50)

    def test_a_learner_is_measured_against_their_own_group(self):
        plan = views.scope_authored_plan(self.MODULES, self.COMPONENTS, self.COVERAGE)
        learner_plan = views.learner_authored_plan(plan, {'group': 'A1'})

        self.assertEqual(learner_plan['basis'], 'group')
        self.assertEqual(learner_plan['otjh'], 5)
        self.assertEqual(learner_plan['ksbWeights'], {'K1': 50})

    def test_a_learner_with_no_matching_group_falls_back_to_the_scope(self):
        """Stated as `scope`, so the figure is never read as per-learner."""
        plan = views.scope_authored_plan(self.MODULES, self.COMPONENTS, self.COVERAGE)
        learner_plan = views.learner_authored_plan(plan, {'group': 'Nowhere'})

        self.assertEqual(learner_plan['basis'], 'scope')
        self.assertEqual(learner_plan['otjh'], 10)


class ScopeOtjhSummaryTests(SimpleTestCase):
    MODULES = [{'module_catalogue_id': 'MOD-A1', 'group_name': 'A1'}]
    COMPONENTS = [
        {'id': 'C1', 'module_catalogue_id': 'MOD-A1', 'expected_otjh': 3},
        {'id': 'C2', 'module_catalogue_id': 'MOD-A1', 'expected_otjh': 2},
    ]
    LEARNERS = [
        {'id': 19, 'name': 'Amelia Hart', 'email': 'a@example.com', 'cohort': 'C1', 'group': 'A1'},
        {'id': 20, 'name': 'Ben Carter', 'email': 'b@example.com', 'cohort': 'C1', 'group': 'A1'},
    ]

    def _plan(self):
        return views.scope_authored_plan(self.MODULES, self.COMPONENTS, [])

    def _summary(self, activities):
        plan = self._plan()
        learner_plans = views.learner_plans_for_scope(plan, self.LEARNERS)
        return views.scope_otjh_summary(plan, learner_plans, self.LEARNERS, activities)

    def test_planned_otjh_is_the_group_component_total_per_learner(self):
        summary = self._summary([])

        self.assertEqual(summary['authoredTotal'], 5)
        self.assertEqual(summary['plannedPerLearner'], 5)
        self.assertEqual(summary['plannedTotal'], 10)
        self.assertEqual(summary['achievedTotal'], 0)
        self.assertEqual(summary['progressPercentage'], 0)

    def test_declared_hours_are_credited_when_a_reflection_exists(self):
        summary = self._summary([{
            'learnerId': 19, 'countsTowardAchievement': True, 'scopeStatus': 'in_scope',
            'expectedOtjh': 3, 'actualOtjh': 4,
        }])

        self.assertEqual(summary['declaredTotal'], 4)
        self.assertEqual(summary['achievedTotal'], 4)
        self.assertEqual(summary['creditedFromExpectedTotal'], 0)

    def test_expected_hours_are_credited_when_no_reflection_declared_them(self):
        """A quiz that carries no reflection still delivered its hours."""
        summary = self._summary([{
            'learnerId': 19, 'countsTowardAchievement': True, 'scopeStatus': 'in_scope',
            'expectedOtjh': 3, 'actualOtjh': None,
        }])

        self.assertEqual(summary['declaredTotal'], 0)
        self.assertEqual(summary['achievedTotal'], 3)
        self.assertEqual(summary['creditedFromExpectedTotal'], 3)

    def test_failed_and_out_of_scope_activity_contributes_no_hours(self):
        summary = self._summary([
            {'learnerId': 19, 'countsTowardAchievement': False, 'scopeStatus': 'in_scope',
             'expectedOtjh': 3, 'actualOtjh': 3},
            {'learnerId': 19, 'countsTowardAchievement': True, 'scopeStatus': 'out_of_scope',
             'expectedOtjh': 3, 'actualOtjh': 3},
        ])

        self.assertEqual(summary['achievedTotal'], 0)
        self.assertEqual(summary['completedActivityCount'], 0)

    def test_every_assigned_learner_gets_a_row_even_with_no_activity(self):
        summary = self._summary([])

        self.assertEqual([row['learnerId'] for row in summary['learners']], [19, 20])
        self.assertEqual(summary['learners'][0]['plannedOtjh'], 5)
        self.assertEqual(summary['learners'][0]['plannedBasis'], 'group')
        self.assertEqual(summary['learners'][0]['achievedOtjh'], 0)

    def test_progress_percentage_cannot_exceed_one_hundred(self):
        summary = self._summary([{
            'learnerId': 19, 'countsTowardAchievement': True, 'scopeStatus': 'in_scope',
            'expectedOtjh': 3, 'actualOtjh': 500,
        }])

        self.assertEqual(summary['achievedTotal'], 500)
        self.assertEqual(summary['progressPercentage'], 100)

    def test_two_groups_do_not_inflate_a_learners_denominator(self):
        """The bug this replaced: a cohort's own total read as one learner's."""
        modules = [
            {'module_catalogue_id': 'MOD-A1', 'group_name': 'A1'},
            {'module_catalogue_id': 'MOD-A2', 'group_name': 'A2'},
        ]
        components = [
            {'id': 'C1', 'module_catalogue_id': 'MOD-A1', 'expected_otjh': 5},
            {'id': 'C2', 'module_catalogue_id': 'MOD-A2', 'expected_otjh': 5},
        ]
        learners = [
            {'id': 19, 'group': 'A1'},
            {'id': 20, 'group': 'A2'},
        ]
        plan = views.scope_authored_plan(modules, components, [])
        learner_plans = views.learner_plans_for_scope(plan, learners)
        summary = views.scope_otjh_summary(plan, learner_plans, learners, [{
            'learnerId': 19, 'countsTowardAchievement': True, 'scopeStatus': 'in_scope',
            'expectedOtjh': 5, 'actualOtjh': 5,
        }])

        self.assertEqual(summary['authoredTotal'], 10)
        # Each learner is assigned 5h, not the cohort's 10h.
        self.assertEqual(summary['plannedTotal'], 10)
        self.assertEqual(summary['learners'][0]['plannedOtjh'], 5)
        self.assertEqual(summary['learners'][0]['progressPercentage'], 100)


class ScopeKsbAchievementTests(SimpleTestCase):
    COVERAGE = [
        {
            'code': 'K1', 'title': 'Know one', 'ksb_type': 'knowledge', 'raw_total_weight': 50,
            'mappings': [{'module_id': 'MOD-A1', 'group_name': 'A1', 'weight': 50}],
        },
        {
            'code': 'S2', 'title': 'Skill two', 'ksb_type': 'skill', 'raw_total_weight': 20,
            'mappings': [{'module_id': 'MOD-A1', 'group_name': 'A1', 'weight': 20}],
        },
    ]
    MODULES = [{'module_catalogue_id': 'MOD-A1', 'group_name': 'A1'}]

    def _run(self, consumption, learners, coverage=None):
        coverage = self.COVERAGE if coverage is None else coverage
        plan = views.scope_authored_plan(self.MODULES, [], coverage)
        learner_plans = views.learner_plans_for_scope(plan, learners)
        return views.scope_ksb_achievement(coverage, consumption, learners, plan, learner_plans)

    @staticmethod
    def _learner(learner_id, group='A1', **codes):
        return {
            'learnerId': learner_id,
            'group': group,
            'consumedWeightTotal': sum(value[0] for value in codes.values()),
            'ksbs': [
                {
                    'code': code,
                    'consumedWeight': value[0],
                    'cappedConsumedWeight': value[1],
                    'declaredReflectionWeight': 0,
                    'status': value[2],
                }
                for code, value in codes.items()
            ],
        }

    def test_expected_weight_is_the_learners_own_group_weight_summed(self):
        learners = [{'id': 19, 'group': 'A1'}, {'id': 20, 'group': 'A1'}, {'id': 21, 'group': 'A1'}]
        result = self._run([], learners)

        self.assertEqual(result['plannedWeightTotal'], 70)
        self.assertEqual(result['expectedWeightTotal'], 210)
        self.assertEqual(result['progressPercentage'], 0)
        self.assertEqual(result['notStartedCount'], 2)

    def test_achieved_weight_is_capped_per_learner_but_reported_uncapped(self):
        learners = [{'id': 19, 'group': 'A1'}]
        result = self._run([self._learner(19, K1=(80, 50, 'complete'))], learners)
        row = next(item for item in result['rows'] if item['code'] == 'K1')

        self.assertEqual(row['achievedWeightTotal'], 80)
        self.assertEqual(row['cappedAchievedWeightTotal'], 50)
        self.assertEqual(row['expectedWeightTotal'], 50)
        self.assertEqual(row['achievementPercentage'], 100)
        self.assertEqual(row['status'], 'complete')

    def test_a_ksb_only_some_learners_reached_reads_as_in_progress(self):
        learners = [{'id': 19, 'group': 'A1'}, {'id': 20, 'group': 'A1'}]
        result = self._run([
            self._learner(19, K1=(50, 50, 'complete')),
            self._learner(20, K1=(0, 0, 'not_started')),
        ], learners)
        row = next(item for item in result['rows'] if item['code'] == 'K1')

        self.assertEqual(row['learnersAchievedCount'], 1)
        self.assertEqual(row['learnersCompleteCount'], 1)
        self.assertEqual(row['status'], 'in_progress')
        self.assertEqual(row['expectedWeightTotal'], 100)
        self.assertEqual(row['achievementPercentage'], 50)

    def test_a_ksb_taught_in_only_one_group_is_judged_against_that_group(self):
        """A KSB one group teaches must not read as the whole cohort failing it."""
        coverage = [{
            'code': 'K1', 'raw_total_weight': 50,
            'mappings': [{'module_id': 'MOD-A1', 'group_name': 'A1', 'weight': 50}],
        }]
        learners = [{'id': 19, 'group': 'A1'}, {'id': 20, 'group': 'A2'}]
        result = self._run([self._learner(19, K1=(50, 50, 'complete'))], learners, coverage)
        row = next(item for item in result['rows'] if item['code'] == 'K1')

        self.assertEqual(row['learnerCount'], 1)
        self.assertEqual(row['expectedWeightTotal'], 50)
        self.assertEqual(row['status'], 'complete')

    def test_a_required_but_unmapped_ksb_is_unmapped_not_unplanned(self):
        """Two different facts: a coverage gap, and a code outside the profile."""
        coverage = [{'code': 'K9', 'raw_total_weight': 0, 'mappings': []}]
        result = self._run([], [{'id': 19, 'group': 'A1'}], coverage)
        row = next(item for item in result['rows'] if item['code'] == 'K9')

        self.assertEqual(row['status'], 'unmapped')
        self.assertEqual(result['unmappedCount'], 1)
        self.assertEqual(result['unplannedCount'], 0)
        self.assertEqual(result['requiredCount'], 1)

    def test_a_consumed_code_the_scope_never_planned_is_reported_as_unplanned(self):
        learners = [{'id': 19, 'group': 'A1'}]
        result = self._run([self._learner(19, B7=(10, 10, 'complete'))], learners)
        row = next(item for item in result['rows'] if item['code'] == 'B7')

        self.assertEqual(row['plannedWeight'], 0)
        self.assertEqual(row['status'], 'unplanned')
        self.assertEqual(result['unplannedCount'], 1)
        # No planned weight means no denominator, not a free 100%.
        self.assertEqual(row['achievementPercentage'], 0)

    def test_rows_are_ordered_knowledge_then_skills_then_behaviours(self):
        coverage = [
            {'code': 'B1', 'raw_total_weight': 5, 'mappings': []},
            {'code': 'S2', 'raw_total_weight': 5, 'mappings': []},
            {'code': 'K10', 'raw_total_weight': 5, 'mappings': []},
            {'code': 'K2', 'raw_total_weight': 5, 'mappings': []},
        ]
        result = self._run([], [{'id': 19, 'group': 'A1'}], coverage)

        self.assertEqual([row['code'] for row in result['rows']], ['K2', 'K10', 'S2', 'B1'])


class LearnerConsumptionExpectedWeightTests(SimpleTestCase):
    """The per-learner denominator follows the learner's own group."""

    COVERAGE = [
        {'code': 'K1', 'raw_total_weight': 100},
        {'code': 'S2', 'raw_total_weight': 40},
    ]
    LEARNERS = [{'id': 19, 'name': 'A', 'group': 'A1'}]

    def test_without_a_per_learner_plan_the_scope_total_stands_in(self):
        rows = views.learner_consumption_payload(self.LEARNERS, self.COVERAGE, {}, {})

        self.assertEqual(rows[0]['expectedWeightTotal'], 140)

    def test_a_per_learner_plan_replaces_the_scope_total(self):
        rows = views.learner_consumption_payload(
            self.LEARNERS, self.COVERAGE, {}, {},
            expected_by_learner={19: {'K1': 50, 'S2': 20}},
        )

        self.assertEqual(rows[0]['expectedWeightTotal'], 70)
        self.assertEqual(
            {row['code']: row['expectedWeight'] for row in rows[0]['ksbs']},
            {'K1': 50, 'S2': 20},
        )


class LearnerPlanFallbackTests(SimpleTestCase):
    """Two situations that look identical one learner at a time."""

    MODULES = [{'module_catalogue_id': 'MOD-A1', 'group_name': 'A1'}]
    COMPONENTS = [{'id': 'C1', 'module_catalogue_id': 'MOD-A1', 'expected_otjh': 5}]

    def _plan(self):
        return views.scope_authored_plan(self.MODULES, self.COMPONENTS, [])

    def test_a_learner_outside_every_delivering_group_has_nothing_planned(self):
        """Some placements match, so a non-match is a real answer, not a gap."""
        learners = [{'id': 19, 'group': 'A1'}, {'id': 20, 'group': 'A2'}]
        plans = views.learner_plans_for_scope(self._plan(), learners)

        self.assertEqual(plans[19]['basis'], 'group')
        self.assertEqual(plans[19]['otjh'], 5)
        self.assertEqual(plans[20]['basis'], 'none')
        self.assertEqual(plans[20]['otjh'], 0)

    def test_when_no_placement_matches_the_scope_stands_in_and_says_so(self):
        """A label mismatch is not an empty curriculum."""
        learners = [{'id': 19, 'group': 'Group One'}, {'id': 20, 'group': 'Group Two'}]
        plans = views.learner_plans_for_scope(self._plan(), learners)

        self.assertEqual({row['basis'] for row in plans.values()}, {'scope'})
        self.assertEqual(plans[19]['otjh'], 5)

    def test_a_scope_with_no_group_labels_measures_everyone_against_it(self):
        modules = [{'module_catalogue_id': 'MOD-X', 'group_name': ''}]
        plan = views.scope_authored_plan(modules, [
            {'id': 'C1', 'module_catalogue_id': 'MOD-X', 'expected_otjh': 4},
        ], [])
        plans = views.learner_plans_for_scope(plan, [{'id': 19, 'group': ''}])

        self.assertEqual(plans[19]['basis'], 'scope')
        self.assertEqual(plans[19]['otjh'], 4)


class ScopePlacementLineageTests(SimpleTestCase):
    """A module borrows the roster of the group that delivers it."""

    MODULE = {
        'module_catalogue_id': 'MOD-1',
        'title': 'Module One',
        'programme_id': 'PROG-1',
        'programme_name': 'Digital Marketer',
        'cohort_id': 'COH-1',
        'cohort_name': 'September 2025',
        'group_id': 'GRP-1',
        'group_name': 'A1',
    }

    def test_a_module_resolves_to_its_group(self):
        with patch.object(views, 'resolve_authoring_catalogue_id', return_value='MOD-1'):
            with patch.object(views, 'authoring_fetch_all', return_value=[self.MODULE]):
                lineage = views.scope_placement_lineage('module', 'MOD-1')

        self.assertTrue(lineage['found'])
        self.assertEqual(lineage['groupName'], 'A1')
        self.assertEqual(lineage['cohortName'], 'September 2025')
        self.assertEqual(lineage['programmeId'], 'PROG-1')
        self.assertEqual(lineage['placementBasis'], 'group')

    def test_a_module_with_no_group_falls_back_to_its_cohort(self):
        module = {**self.MODULE, 'group_id': '', 'group_name': ''}
        with patch.object(views, 'resolve_authoring_catalogue_id', return_value='MOD-1'):
            with patch.object(views, 'authoring_fetch_all', return_value=[module]):
                lineage = views.scope_placement_lineage('module', 'MOD-1')

        self.assertEqual(lineage['placementBasis'], 'cohort')

    def test_a_group_resolves_from_the_groups_table(self):
        row = {
            'group_id': 'GRP-1', 'group_name': 'A1',
            'cohort_id': 'COH-1', 'cohort_name': 'September 2025',
            'programme_id': 'PROG-1', 'programme_name': 'Digital Marketer',
        }
        with patch.object(views, 'resolve_group_row', return_value=row):
            lineage = views.scope_placement_lineage('group', 'GRP-1')

        self.assertTrue(lineage['found'])
        self.assertEqual(lineage['placementBasis'], 'group')
        self.assertEqual(lineage['groupName'], 'A1')

    def test_an_unknown_scope_record_is_reported_as_not_found(self):
        with patch.object(views, 'resolve_cohort_row', return_value=None):
            lineage = views.scope_placement_lineage('cohort', 'nope')

        self.assertFalse(lineage['found'])
        self.assertEqual(lineage['programmeId'], '')


class ScopedRosterTests(SimpleTestCase):
    ROSTER = [
        {'id': 1, 'name': 'A', 'cohort': 'September 2025', 'group': 'A1'},
        {'id': 2, 'name': 'B', 'cohort': 'September 2025', 'group': 'A2'},
        {'id': 3, 'name': 'C', 'cohort': 'January 2026', 'group': 'B1'},
    ]

    def _run(self, lineage):
        with patch.object(views, 'assigned_learners_for_programme', return_value=self.ROSTER):
            return views.assigned_learners_for_scope('', '', lineage=lineage)

    def test_a_cohort_gets_only_its_own_learners(self):
        learners = self._run({
            'programmeId': 'PROG-1', 'cohortName': 'September 2025', 'groupName': '',
        })

        self.assertEqual([row['id'] for row in learners], [1, 2])

    def test_a_group_gets_only_its_own_learners(self):
        learners = self._run({
            'programmeId': 'PROG-1', 'cohortName': 'September 2025', 'groupName': 'A1',
        })

        self.assertEqual([row['id'] for row in learners], [1])

    def test_matching_ignores_case_and_spacing_because_placements_are_labels(self):
        learners = self._run({
            'programmeId': 'PROG-1', 'cohortName': ' september  2025 ', 'groupName': 'a1',
        })

        self.assertEqual([row['id'] for row in learners], [1])

    def test_a_scope_with_no_programme_returns_nothing_rather_than_everything(self):
        learners = self._run({'programmeId': '', 'programmeName': '', 'cohortName': 'x'})

        self.assertEqual(learners, [])
