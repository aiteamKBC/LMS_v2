"""Metadata refresh protections with synthetic state; no DB or HTTP access."""
from copy import deepcopy
import io
import json
import unittest
from unittest.mock import Mock, patch

import refresh_legacy_course_schedule as refresh


class ScheduleRefreshTests(unittest.TestCase):
    def setUp(self):
        for target in ('psycopg.connect', 'urllib.request.OpenerDirector.open'):
            guard = patch(target, side_effect=AssertionError('External access forbidden'))
            guard.start()
            self.addCleanup(guard.stop)
        self.state = {'course': {'source_course_ref': '50'}, 'memberships': [{'learner_id': 1}, {'learner_id': 2}],
            'ledger': {'progress': {'count': 2, 'fingerprint': 'unchanged'}},
            'catalogue': [{'id': 1, 'source_activity_id': 'material:10', 'source_section_ref': '',
                'source_section_title': '', 'source_payload': {'quiz_id': 20, 'retained': {'evidence': True}}}]}
        self.schedule = {'material:10': {'source_section_ref': '5', 'source_section_title': 'Lecture 12/8/26',
                                        'created_at_utc': '2026-08-23T08:22:49+00:00'}}

    def applied(self, plan):
        after = deepcopy(self.state)
        for change in plan:
            row = next(r for r in after['catalogue'] if r['id'] == change['id'])
            row.update(change['fields'])
            row['source_payload'].update(created_at_utc=change['created_at_utc'], course_schedule_recovery={
                'run_id': 7, 'course_id': '50', 'basis': 'linked-course-live-source-metadata', 'previous': change['previous']})
        return after

    def test_refresh_keeps_catalogue_links_evidence_memberships_and_ledger(self):
        original = deepcopy(self.state)
        plan = refresh.make_plan(self.state, self.schedule)
        after = self.applied(plan)
        refresh.verify(self.state, after, plan, 7)
        self.assertEqual(after['catalogue'][0]['source_payload']['quiz_id'], 20)
        self.assertEqual(after['catalogue'][0]['source_payload']['retained'], {'evidence': True})
        self.assertEqual(refresh.make_plan(after, self.schedule), [])
        self.assertEqual(self.state, original)

    def test_missing_source_component_cannot_remove_or_retype_an_activity(self):
        self.schedule['quiz:10'] = self.schedule.pop('material:10')
        with self.assertRaisesRegex(ValueError, 'absent from the owned source course'):
            refresh.make_plan(self.state, self.schedule)

    def test_missing_source_upload_date_does_not_clear_a_retained_date(self):
        self.state['catalogue'][0]['source_payload']['created_at_utc'] = '2026-08-23T08:22:49Z'
        self.schedule['material:10']['created_at_utc'] = None
        self.assertEqual(refresh.make_plan(self.state, self.schedule)[0]['created_at_utc'], '2026-08-23T08:22:49Z')

    def test_verification_rejects_other_learner_changes_or_unrelated_payload_edits(self):
        plan = refresh.make_plan(self.state, self.schedule)
        after = self.applied(plan)
        after['ledger']['progress']['fingerprint'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'learner records changed'):
            refresh.verify(self.state, after, plan, 7)
        after = self.applied(plan)
        after['catalogue'][0]['source_payload']['retained']['evidence'] = False
        with self.assertRaisesRegex(ValueError, 'beyond the approved schedule fields'):
            refresh.verify(self.state, after, plan, 7)

    def test_source_fetch_retains_only_owned_date_metadata_and_normalizes_timezone(self):
        response = io.BytesIO(json.dumps([{'user_id': 3, 'course_id': 50, 'timezone': '+00:00',
            'materials': [{'component_id': 10, 'created_at': '2026-08-23 08:22:49',
                'section_id': 5, 'section_title': 'Lecture 12/8/26', 'completed': False}], 'quizzes': []}]).encode())
        response.headers = {}
        opener = Mock()
        opener.open.return_value = response
        with patch.object(refresh, 'env_values', return_value={'KBC_LMS_API_KEY': 'synthetic-test-key'}), \
                patch.object(refresh.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(refresh.fetch_schedule(3, 50), self.schedule)
        request = opener.open.call_args.args[0]
        self.assertIn('user_id=3&course_id=50&include_answers=false&include_other_modules=false', request.full_url)


if __name__ == '__main__':
    unittest.main()
