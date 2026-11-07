"""Attendance-only baselines are scoped to an owned, uniquely credited card."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .activity_time_history import attendance_baseline


class AttendanceTimeHistoryTests(SimpleTestCase):
    def test_first_live_reflection_submits_for_both_learner_types(self):
        # Keep the reported endpoint failure in the automatically discovered
        # *_no_db CI modules, even when database suites are unavailable.
        from .tests_selected_activity_time import SelectedActivityTimeTests

        endpoint = SelectedActivityTimeTests()
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), patch(
                'learner_api.activity_time_history.attendance_baseline', return_value=7200
            ):
                response, save, _ = endpoint.submit(kind=kind, component_type='live_session',
                    selected=1800, decision='add', previous=7200)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(json.loads(response.content)['record']['countedSeconds'], 9000)
                save.assert_called_once()

    def baseline(self, *, history=(), credits=None, record=None, source=None, learner=None):
        record = record or {'kind': 'component', 'componentType': 'live_session',
                            'componentId': 'C1', 'retakeTimeChoice': 'add'}
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ('M1',)
        credits = [{'componentId': 'C1', 'hours': 2}] if credits is None else credits
        with patch('learner_api.activity_time_history.connections', {'enrolment': connection}), \
             patch('learner_api.live_session_progress.read_live_credits', return_value=credits) as read:
            seconds = attendance_baseline(record, history, source=source, learner=learner)
        return seconds, cursor, read

    def test_first_reflection_reads_the_owned_whole_module(self):
        source = SimpleNamespace(id=19)
        seconds, cursor, read = self.baseline(source=source)
        self.assertEqual(seconds, 7200)
        self.assertEqual(cursor.execute.call_args.args[1], ['C1'])
        read.assert_called_once_with(source, module_ids=['M1'])

    def test_absence_ambiguity_and_other_components_do_not_create_credit(self):
        for credits in ([], [{'componentId': 'C2', 'hours': 2}],
                        [{'componentId': 'C1', 'hours': 2}] * 2):
            with self.subTest(credits=credits):
                self.assertEqual(self.baseline(source=SimpleNamespace(id=19), credits=credits)[0], 0)

    def test_existing_native_attempts_and_other_activity_types_do_not_read_attendance(self):
        for record, history in (
            ({'kind': 'video'}, []),
            ({'kind': 'component', 'componentType': 'reading'}, []),
            ({'kind': 'component', 'componentType': 'live_session', 'componentId': 'C1'}, []),
            ({'kind': 'component', 'componentType': 'live_session', 'componentId': 'C1',
              'retakeTimeChoice': 'add'}, [{'kind': 'component', 'componentId': 'C1'}]),
        ):
            seconds, cursor, read = self.baseline(record=record, history=history)
            self.assertEqual(seconds, 0)
            cursor.execute.assert_not_called()
            read.assert_not_called()

    def test_locked_save_resolves_the_same_enrolment_for_each_learner_type(self):
        for kind, model in (('commercial', 'CommercialUser'), ('apprenticeship', 'EnrolmentUser')):
            source = SimpleNamespace(id=19)
            with self.subTest(kind=kind), patch(f'learner_api.models.{model}.objects.get', return_value=source) as get:
                seconds, _, read = self.baseline(learner=SimpleNamespace(learner_type=kind, enrolment_id=19))
                self.assertEqual(seconds, 7200)
                get.assert_called_once_with(pk=19)
                read.assert_called_once_with(source, module_ids=['M1'])
