"""Direct regression runner: stdlib only; no Django setup, DB or network."""
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
# The access module only needs ``read`` from session_results; stand it in.
session_results = types.ModuleType('curriculum_api.session_results')
session_results.read = Mock()
sys.modules['curriculum_api.session_results'] = session_results
from curriculum_api import linked_recording_access as access  # noqa: E402


def row(**values):
    return {'series_id': 'S', 'session_number': '', 'occurrence_id': '', 'extra_series_id': '', 'extra_meeting_url': '', **values}


class LinkedRecordingAccessTests(unittest.TestCase):
    def setUp(self):
        session_results.read.reset_mock(return_value=True, side_effect=True)

    def test_only_the_linked_sessions_of_the_series(self):
        session_results.read.return_value = [row(session_number='3'), row(session_number='5'), row(series_id='OTHER', session_number='9')]
        self.assertEqual(access.linked_session_numbers(['MOD-A'], 'S'), {3, 5})
        sql, params = session_results.read.call_args.args
        self.assertIn("recording_placeholder", sql)
        self.assertIn("r.deleted_at IS NULL", sql)
        self.assertIn("s.deleted_at IS NULL", sql)
        self.assertEqual(params, [['MOD-A'], 'S', 'S'])

    def test_no_link_grants_nothing_and_reads_nothing_without_modules(self):
        session_results.read.return_value = []
        self.assertEqual(access.linked_session_numbers(['MOD-A'], 'S'), set())
        session_results.read.reset_mock()
        self.assertEqual(access.linked_session_numbers([], 'S'), set())
        session_results.read.assert_not_called()

    def test_occurrence_identity_and_additional_meeting(self):
        session_results.read.side_effect = [
            [row(occurrence_id='OCC-7'), row(series_id='', extra_series_id='S', extra_meeting_url='https://teams.example/x')],
            [{'session_number': 7}],
        ]
        self.assertEqual(access.linked_session_numbers(['MOD-A'], 'S'), {1, 7})

    def test_artifacts_outside_the_linked_sessions_are_refused(self):
        session_results.read.return_value = [{'session_number': 4}]
        self.assertTrue(access.linked_artifact_allowed({'id': 'S', 'linked_session_numbers': {4}}, 'ART'))
        self.assertFalse(access.linked_artifact_allowed({'id': 'S', 'linked_session_numbers': {3}}, 'ART'))
        sql, params = session_results.read.call_args.args
        self.assertIn("a.artifact_type IN ('recording','transcript')", sql)
        self.assertEqual(params, ['ART', 'S'])
        session_results.read.return_value = []
        self.assertFalse(access.linked_artifact_allowed({'id': 'S', 'linked_session_numbers': {3}}, 'MISSING'))

    def test_own_series_keeps_its_existing_rules(self):
        session_results.read.reset_mock()
        self.assertTrue(access.linked_artifact_allowed({'id': 'S'}, 'ART'))
        session_results.read.assert_not_called()


if __name__ == '__main__':
    unittest.main()
