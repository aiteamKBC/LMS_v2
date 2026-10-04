"""Regression checks for manual-roster modules staying out of group presets."""
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import views
from learner_api import learning_plan as plans


class ManualRosterModeTests(SimpleTestCase):
    def test_catalogue_payload_defaults_existing_rows_to_inherited(self):
        payload = plans._module_payload({'module_catalogue_id': 'MOD-1', 'title': 'Existing'})
        self.assertEqual(payload['learnerRosterMode'], 'inherited')

    def test_manual_modules_are_filtered_without_removing_them_from_group_data(self):
        with patch.object(
            plans,
            '_group_preset_rows',
            return_value=[{'module_ids': ['MOD-INHERITED', 'MOD-MANUAL']}],
        ), patch.object(plans, '_manual_roster_module_ids', return_value={'MOD-MANUAL'}):
            self.assertEqual(plans._group_module_ids('Programme', 'Group'), ['MOD-INHERITED'])

    def test_manual_assignment_can_still_be_explicitly_represented(self):
        payload = plans._module_payload({
            'module_catalogue_id': 'MOD-MANUAL',
            'title': 'Copied module',
            'learner_roster_mode': 'manual',
        })
        self.assertEqual(payload['learnerRosterMode'], 'manual')

    @patch.object(views.connection, 'vendor', 'postgresql')
    @patch('curriculum_api.learner_assignments.module_assignment_roster')
    @patch.object(views, 'assigned_learners_for_programme')
    def test_manual_module_progress_roster_does_not_seed_group_learners(
        self, assigned_for_programme, module_roster,
    ):
        module_roster.return_value = [{'id': 42, 'name': 'Explicit learner'}]
        lineage = {
            'moduleCatalogueId': 'MOD-MANUAL',
            'programmeId': 'PROGRAMME',
            'programmeName': 'Programme',
            'cohortId': 'COHORT',
            'cohortName': 'Cohort',
            'groupId': 'GROUP',
            'groupName': 'Group',
            'learnerRosterMode': 'manual',
        }

        result = views.assigned_learners_for_scope('module', 'MOD-MANUAL', lineage=lineage)

        self.assertEqual(result, [{'id': 42, 'name': 'Explicit learner'}])
        module_roster.assert_called_once_with('MOD-MANUAL', [], '')
        assigned_for_programme.assert_not_called()
