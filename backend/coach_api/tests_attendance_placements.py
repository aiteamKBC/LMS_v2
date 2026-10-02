from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api.views import apply_curriculum_attendance_placements


class CurriculumAttendancePlacementTests(SimpleTestCase):
    def setUp(self):
        self.row = SimpleNamespace(
            id=7, cohort_id=None, aptem_id=None,
            _caseload_source=SimpleNamespace(aptem_id=None),
        )
        self.learner = {
            'id': '7', 'programmeId': None, 'programmeName': 'Programme',
            'cohortName': 'Cohort', 'groupId': None,
            'groupName': 'Wednesday', 'group': 'Wednesday',
            'email': 'learner@example.com', 'enrollmentStatus': 'active',
        }
        self.group = {
            'group_id': 'G1', 'group_name': 'Wednesday',
            'programme_id': 'P1', 'programme_name': 'Programme',
            'cohort_id': 'C1', 'cohort_name': 'Cohort', 'status': 'active',
        }

    def apply(self, groups):
        with patch('coach_api.views.authoring_fetch_all', return_value=groups) as fetch:
            apply_curriculum_attendance_placements([self.learner], [self.row])
        return fetch

    def test_non_aptem_learner_gets_stable_curriculum_placement(self):
        fetch = self.apply([self.group])
        self.assertEqual(self.learner['groupId'], 'G1')
        self.assertEqual(self.learner['programmeId'], 'P1')
        self.assertEqual(self.learner['email'], 'learner@example.com')
        self.assertEqual(self.learner['enrollmentStatus'], 'active')
        self.assertFalse(fetch.call_args.kwargs['ensure_tables'])
        self.assertIsNone(self.row.cohort_id)

    def test_aptem_source_and_profile_learners_keep_existing_placement(self):
        for source_id, profile_id in [(12, None), (None, 12), (12, 13)]:
            with self.subTest(source_id=source_id, profile_id=profile_id):
                self.row._caseload_source.aptem_id = source_id
                self.row.aptem_id = profile_id
                before = deepcopy(self.learner)
                self.apply([self.group]).assert_not_called()
                self.assertEqual(self.learner, before)

    def test_matching_names_in_other_programmes_and_cohorts_are_excluded(self):
        self.apply([
            {**self.group, 'programme_name': 'Other', 'group_id': 'G2'},
            {**self.group, 'cohort_name': 'Other', 'group_id': 'G3'},
            self.group,
        ])
        self.assertEqual(self.learner['groupId'], 'G1')

    def test_ambiguous_names_are_not_guessed(self):
        self.apply([self.group, {**self.group, 'group_id': 'G2'}])
        self.assertIsNone(self.learner['groupId'])

    def test_explicit_ids_do_not_fall_back_to_names(self):
        self.learner['groupId'] = 'G2'
        self.learner['programmeId'] = 'P2'
        before = deepcopy(self.learner)
        self.apply([self.group])
        self.assertEqual(self.learner, before)

    def test_explicit_group_id_recovers_renamed_group(self):
        self.learner['groupId'] = 'G1'
        self.apply([{**self.group, 'group_name': 'Renamed'}])
        self.assertEqual(self.learner['groupName'], 'Renamed')

    def test_archived_groups_are_not_resolved(self):
        self.apply([{**self.group, 'status': 'archived'}])
        self.assertIsNone(self.learner['groupId'])

    def test_payload_outside_caseload_is_not_enriched(self):
        self.row.id = 8
        self.apply([self.group])
        self.assertIsNone(self.learner['groupId'])
