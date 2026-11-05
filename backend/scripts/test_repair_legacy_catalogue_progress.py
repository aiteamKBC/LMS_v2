"""End-to-end pure plan regressions; no DB, startup, or network."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import test_deduplicate_legacy_catalogue as fixtures
import repair_legacy_catalogue_progress as workflow


class ProgressWorkflowTests(fixtures.CatalogueCleanupTests):
    def setUp(self):
        super().setUp()
        self.state['owner'].update(enrolment_id=2)
        self.state['memberships'][0].update(source_learner_id='12', enrolment_id=2)
        self.source = {'21': {'accounts': [12], 'title': 'Synthetic',
            'facts': {'material:91': {'completed': True, 'post_type': 'stm-lessons',
                       'material_type': 'text', 'section_id': 1, 'title': 'Lesson'}},
            'evidence': {'material:91': {'timezone': '+00:00'}}}}

    def test_missing_verified_completion_adds_no_accepted_hours(self):
        before = deepcopy(self.state)
        plan, counts = workflow.plan_owner(self.state, self.source, self.courses,
                                           self.defs, self.duplicates, self.scope)
        self.assertEqual(counts['completions_added'], 1)
        self.assertEqual(plan['after']['21'], {'total': 1, 'completed': 1, 'hours': 0})
        self.assertEqual(self.state, before)

    def test_new_lineage_row_can_carry_completion_without_updating_a_fake_id(self):
        self.record(10, 'quiz:91', 6, 0)
        self.state['progress'][0]['activity_status'] = 'not_started'
        self.state['sources'][0].update(completed=False, activity_status='not_started')
        plan, counts = workflow.plan_owner(self.state, self.source, self.courses,
                                           self.defs, self.duplicates, self.scope)
        self.assertEqual(plan['completion']['update'], [])
        self.assertEqual(plan['completion']['add'], [])
        self.assertEqual(counts['lineage_completions_recovered'], 1)
        self.assertTrue(plan['lineage'][0]['completed'])
        self.assertEqual(plan['after']['21']['completed'], 1)
        self.assertEqual(plan['after']['21']['hours'], 0)


if __name__ == '__main__':
    unittest.main()
