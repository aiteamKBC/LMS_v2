"""Exercise the conversion/date/schedule pipeline with persistence doubles.

Load real functions by AST, as in test_free_course_convert_no_db, so these
regressions cannot initialise application databases or external services.
Endpoint decorators are outside this suite; authorization is unchanged.
"""
import ast
import calendar
import json
from contextlib import nullcontext
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from .test_free_course_convert_no_db import _clean_str, _parse_int

FUNCTIONS = (
    'parse_date', 'format_date', 'parse_json_value', 'shift_date_by_months', 'module_soft_start_date',
    'cohort_delivery_window', 'module_cohort_date_error', 'module_schedule_view',
    'build_free_course_week_structure', 'module_attachment_authoring_payload',
    'save_tree_group_modules', 'inject_free_course_into_group', 'curriculum_free_programme_convert',
)


class FreeCourseConversionDateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(__file__).with_name('views.py')
        tree = ast.parse(source.read_text(encoding='utf-8-sig'))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS]
        assert {node.name for node in nodes} == set(FUNCTIONS)
        for node in nodes:
            node.decorator_list = []
        cls.code = compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec')

    def setUp(self):
        self.source = [{'courseId': 'FREE-1', 'courseName': 'Source course', 'description': 'Keep description',
                        'coverImageUrl': 'https://example.invalid/cover.png', 'weekTitle': 'First', 'weekNumber': 1,
                        'components': [{'type': 'video', 'title': 'Video', 'expectedOtjh': 2,
                                        'settings': {'videoUrl': 'https://example.invalid/video.mp4', 'requiredProgressPercentage': 80}}]}]
        self.group = {'id': 'G1', 'group_id': 'G1', 'name': 'Group', 'cohort_id': 'C1', 'programmeId': 'P1',
                      'programme': 'Programme', 'weekDays': 'Thursday', 'startTime': '09:00', 'endTime': '11:00', 'tutor': 'Tutor'}
        self.cohort = {'id': 'C1', 'programmeId': 'P1', 'programme': 'Programme', 'name': 'Cohort',
                       'startDate': '2026-09-01', 'practicalEndDate': '2027-05-31', 'endDate': '2027-08-31'}
        self.write = Mock(side_effect=lambda ident, payload, **kwargs: deepcopy(payload))
        self.clashes = Mock(return_value=[])
        self.ns = {
            'calendar': calendar, 'date': date, 'datetime': datetime, 're': re, 'json': json,
            'clean_str': _clean_str, 'parse_int': _parse_int,
            'transaction': SimpleNamespace(atomic=nullcontext), 'versioning': SimpleNamespace(source=lambda _: nullcontext()),
            'get_free_programme_modules_payload': Mock(return_value=self.source),
            'resolve_group_row': Mock(return_value=self.group), 'resolve_cohort_row': Mock(return_value=self.cohort),
            'serialize_group_authoring_detail': lambda value: value, 'serialize_cohort_authoring_detail': lambda value: value,
            'curriculum_group_from_authoring_detail': lambda value: value, 'curriculum_cohort_from_authoring_detail': lambda value: value,
            'safe_authoring_module_rows': Mock(return_value=[{'module_catalogue_id': 'OTHER'}]),
            'contentful_catalogue_id_for_attachment': Mock(return_value=''),
            'unique_module_catalogue_id': Mock(return_value='MOD-NEW'), 'locked_attachment_structure': Mock(return_value=None),
            'attachment_week_structure': lambda item, *args, **kwargs: item['weekStructure'],
            'attachment_session_count': lambda item, weeks: len(weeks),
            'module_calendar_end_date': Mock(return_value='2026-10-07'),
            'merged_weekly_schedule': lambda *args: [], 'module_weekly_schedule': lambda *args: [],
            'session_overrides': lambda module: {},
            'is_blank_staff_assignment': lambda value: not value, 'staff_assignment_key': lambda value: value,
            'visible_notes': lambda value: value, 'attachment_week_count': lambda item, *args: len(item['weekStructure']),
            'default_completion_payload': lambda: {}, 'normalise_ksb_profile_source_value': lambda value: value,
            'module_schedule_assignment_changed': Mock(return_value=True), 'tutor_schedule_conflicts_created': self.clashes,
            'save_module_authoring_structure': self.write, 'unassign_authoring_modules_from_group': Mock(),
            'notify_staff_assignment_change': Mock(), 'repair_curriculum_parent_links': Mock(), 'invalidate_curriculum_cache': Mock(),
            '_scrub_free_course_learner_assignments': Mock(), '_delete_single_free_course_rows': Mock(),
            'json_body': lambda request: request.body,
            'JsonResponse': lambda data, status=200: SimpleNamespace(data=data, status_code=status),
            'json_error': lambda message, status=400: SimpleNamespace(data={'error': message}, status_code=status),
            'StaleModuleStructureWrite': type('StaleModuleStructureWrite', (Exception,), {}),
            'FreeCourseInUse': type('FreeCourseInUse', (Exception,), {}),
            'TutorScheduleConflictError': type('TutorScheduleConflictError', (Exception,), {}),
            'logger': Mock(),
        }
        exec(self.code, self.ns)

    def call(self, **changes):
        request = SimpleNamespace(method='POST', body={
            'courseId': 'FREE-1', 'groupId': 'G1', 'mode': 'clone',
            'startDate': '2026-10-01', 'endDate': '2026-12-15', **changes,
        })
        return self.ns['curriculum_free_programme_convert'](request, 'FREE-COURSES')

    def test_explicit_dates_reach_persistence_and_tutor_checks_without_changing_source(self):
        before = deepcopy((self.source, self.group, self.cohort))
        result = self.call()
        self.assertEqual(result.status_code, 201, result.data)
        ident, payload = self.write.call_args.args
        self.assertEqual(ident, 'MOD-NEW')
        self.assertEqual((payload['startDate'], payload['endDate']), ('2026-10-01', '2026-12-15'))
        self.assertEqual(payload['weekStructure'][0]['components'][0]['settings'], self.source[0]['components'][0]['settings'])
        schedule = self.clashes.call_args.args[1]
        self.assertEqual((schedule['start_date'], schedule['end_date']), ('2026-10-01', '2026-12-15'))
        self.assertEqual((schedule['group_id'], schedule['tutor_name']), ('G1', 'Tutor'))
        self.ns['module_calendar_end_date'].assert_not_called()
        self.ns['_scrub_free_course_learner_assignments'].assert_not_called()
        self.ns['_delete_single_free_course_rows'].assert_not_called()
        self.ns['unassign_authoring_modules_from_group'].assert_not_called()
        self.assertEqual((self.source, self.group, self.cohort), before)
        self.assertEqual(result.data['moduleCatalogueId'], 'MOD-NEW')

    def test_missing_empty_invalid_and_non_string_dates_are_refused_before_writes(self):
        for field in ('startDate', 'endDate'):
            for value in (None, '', ' ', '2026-02-30', '2026-13-01', '01/10/2026', '2026-10-01T12:00:00Z', 1, [], {}):
                with self.subTest(field=field, value=value):
                    response = self.call(**{field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn('valid module', response.data['error'])
        self.write.assert_not_called()
        self.ns['get_free_programme_modules_payload'].assert_not_called()

    def test_omitted_dates_cannot_fall_back_to_cohort_dates(self):
        request = SimpleNamespace(method='POST', body={'courseId': 'FREE-1', 'groupId': 'G1', 'mode': 'clone'})
        self.assertEqual(self.ns['curriculum_free_programme_convert'](request, 'FREE-COURSES').status_code, 400)
        self.write.assert_not_called()

    def test_reversed_dates_are_refused(self):
        self.assertEqual(self.call(startDate='2026-12-16').status_code, 400)
        self.write.assert_not_called()

    def test_same_day_is_allowed(self):
        self.assertEqual(self.call(endDate='2026-10-01').status_code, 201)

    def test_existing_soft_start_boundary_is_preserved(self):
        self.assertEqual(self.call(startDate='2026-08-01').status_code, 201)
        self.write.reset_mock()
        response = self.call(startDate='2026-07-31')
        self.assertEqual(response.status_code, 400)
        self.assertIn('more than one month', response.data['error'])
        self.write.assert_not_called()

    def test_practical_end_boundary_is_preserved(self):
        self.assertEqual(self.call(endDate='2027-05-31').status_code, 201)
        self.write.reset_mock()
        response = self.call(endDate='2027-06-01')
        self.assertEqual(response.status_code, 400)
        self.assertIn('cohort end date', response.data['error'])
        self.write.assert_not_called()

    def test_destination_errors_still_reject_without_writes(self):
        self.ns['resolve_group_row'].return_value = None
        self.assertEqual(self.call().status_code, 404)
        self.write.assert_not_called()

    def test_a_tutor_conflict_still_stops_the_selected_dates_from_being_saved(self):
        self.clashes.return_value = [{'moduleCatalogueId': 'OTHER'}]
        with self.assertRaises(self.ns['TutorScheduleConflictError']):
            self.ns['inject_free_course_into_group']('FREE-1', 'G1', start_date='2026-10-01', end_date='2026-12-15')
        self.write.assert_not_called()


if __name__ == '__main__':
    unittest.main()
