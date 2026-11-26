"""Assignment settings the learner API reads must be first-class schema keys.

    python manage.py test curriculum_api.test_assignment_settings_schema_no_db

A key the authoring schema does not declare is moved into ``legacySettings`` on
save, where learner_api.assignment_settings never looks for it.
"""
from __future__ import annotations

import json

from django.test import SimpleTestCase

from curriculum_api import views
from curriculum_api.management.commands.import_mba_curriculum import extra_materials_html
from curriculum_api.management.commands.move_legacy_assignment_links import move_legacy_links


class AssignmentSettingsSchemaTests(SimpleTestCase):
    def test_learner_title_and_monthly_flag_are_saved_where_the_learner_api_reads_them(self):
        saved = views.normalise_component_settings_payload(
            'assignment', {'learnerTitle': 'Month 2 coach led assignment', 'isMonthlyAssignment': True})
        self.assertEqual(saved['learnerTitle'], 'Month 2 coach led assignment')
        self.assertIs(saved['isMonthlyAssignment'], True)
        self.assertNotIn('legacySettings', saved)

    def test_an_assignment_saved_without_them_is_unflagged_and_untitled(self):
        saved = views.normalise_component_settings_payload('assignment', {'assignmentBrief': 'Question'})
        self.assertEqual(saved['learnerTitle'], '')
        self.assertIs(saved['isMonthlyAssignment'], False)

    def test_the_builder_accepts_them_and_the_moved_link_resources(self):
        legacy = extra_materials_html([], [{'open_url': 'https://www.example.test/reading'}])
        moved, count = move_legacy_links(views.normalise_component_settings_payload('assignment', {
            'assignmentBrief': 'Question', 'submissionInstructions': legacy,
            'learnerTitle': 'Month 2', 'isMonthlyAssignment': True}))
        self.assertEqual(count, 1)
        component = {'type': 'assignment', 'title': 'Assignment', 'expectedOtjh': 2, 'points': 0, 'settings': moved}
        self.assertEqual(views.validate_component_authoring_payload(component, 'component'), [])
        # Validation re-normalises the settings; the moved links and flags survive it.
        self.assertTrue(json.loads(component['settings']['assignmentTopics'])[0]['resources'][0]['link'])
        self.assertIs(component['settings']['isMonthlyAssignment'], True)
