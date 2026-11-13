"""Presentation projections only: all database readers are mocked."""
import json
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from . import learner_detail, weekly_learning
from .tests_weekly_learning import FakeCursor


class SessionPresentationTests(SimpleTestCase):
    def test_all_read_projections_keep_both_ids_and_the_explicit_local_link(self):
        class Cursor(FakeCursor):
            def execute(self, sql, params=None):
                super().execute(sql, params)
                if 'FROM curriculum.components WHERE' in sql:
                    self.rows = [
                        ('LS', 'W1', 'M1', 'live-session', 'Session', '', json.dumps({
                            'teamsLiveSessionId': 'SERIES', 'teamsSessionNumber': 1,
                            'sessionDate': '2026-11-12'}), None, 1, None, False, None, False, 2.5),
                        ('REC', 'W1', 'M1', 'recording-placeholder', 'Recording', '', json.dumps({
                            'linkedLiveSessionComponentId': 'LS'}), None, 2, None, True, 'Reflection', True, 0),
                    ]
        for options in ({}, {'compact': True}, {'compact': True, 'week_ids': ['W1']},
                        {'compact': True, 'compact_content': True}, {'identities_only': True}):
            with self.subTest(options=options):
                connection = MagicMock()
                cursor = Cursor()
                connection.cursor.return_value = cursor
                with patch.object(learner_detail, 'connections', {'enrolment': connection}), \
                     patch.dict('os.environ', {'LEARNER_MERGE_LINKED_RECORDINGS': 'false'}):
                    _, _, rows = learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}], **options)
                self.assertEqual([row['componentId'] for row in rows], ['LS', 'REC'])
                self.assertEqual(rows[1]['linkedSessionComponentId'], 'LS')
                self.assertEqual(weekly_learning._weekly_component(rows[1])['linkedSessionComponentId'], 'LS')
                self.assertNotIn('linkedSessionComponentId', rows[0])
                self.assertFalse(any(sql.lstrip().upper().startswith(('UPDATE ', 'INSERT ', 'DELETE ')) for sql in cursor.statements))
