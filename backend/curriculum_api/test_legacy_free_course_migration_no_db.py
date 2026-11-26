"""Adoption mapping tests: no Django startup, database or external services."""
import ast
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import unittest

from curriculum_api.legacy_free_course_migration import completion_fields, course_payload


class LegacyFreeCourseMigrationTests(unittest.TestCase):
    def setUp(self):
        self.course = {'id': 'FREECOURSE-A', 'course_name': 'Independent study', 'description': 'Course notes'}
        self.weeks = [{
            'id': 'FREEWEEK-A', 'courseId': self.course['id'], 'weekNumber': 1,
            'weekTitle': 'Study', 'displayOrder': 0, 'components': [{
                'id': 'FREECOMP-A', 'type': 'reading', 'title': 'Introduction',
                'expectedOtjh': 1.5, 'reflectionRequired': True,
                'tutorValidationRequired': False, 'points': 4,
                'settings': {'readingContent': '<p>Study</p>', 'reflectionPrompt': 'What did you learn?',
                             'attachments': [{'url': '/example.pdf'}], 'manualUnlock': True},
            }],
        }]

    def test_retry_reuses_identities_and_preserves_content_without_mutating_source(self):
        before = deepcopy(self.weeks)
        first = course_payload(self.course, self.weeks)
        second = course_payload(self.course, self.weeks)
        self.assertEqual(first, second)
        self.assertEqual(self.weeks, before)
        component = first['weekStructure'][0]['components'][0]
        for field in ('expectedOtjh', 'reflectionRequired', 'tutorValidationRequired', 'points'):
            self.assertEqual(component[field], before[0]['components'][0][field])
        for field, value in before[0]['components'][0]['settings'].items():
            self.assertEqual(component['settings'][field], value)
        self.assertEqual(component['reflectionQuestion'], 'What did you learn?')
        self.assertFalse(any(key in first for key in ('programmeId', 'cohortId', 'groupId')))

    def test_same_name_is_not_identity_and_components_cannot_cross_courses(self):
        first = course_payload(self.course, self.weeks)
        other_course = {**self.course, 'id': 'FREECOURSE-B'}
        other_weeks = deepcopy(self.weeks)
        other_weeks[0]['courseId'] = other_course['id']
        second = course_payload(other_course, other_weeks)
        self.assertNotEqual(first['catalogueId'], second['catalogueId'])
        self.assertNotEqual(first['weekStructure'][0]['components'][0]['id'],
                            second['weekStructure'][0]['components'][0]['id'])
        with self.assertRaisesRegex(ValueError, 'another free course'):
            course_payload(other_course, self.weeks)

    def test_reordering_keeps_component_identity_and_week_numbers(self):
        second_week = deepcopy(self.weeks[0])
        second_week.update(id='FREEWEEK-B', weekNumber=4, displayOrder=2)
        second_week['components'][0]['id'] = 'FREECOMP-B'
        weeks = [second_week, *self.weeks]
        payload = course_payload(self.course, weeks)
        self.assertEqual([week['weekNumber'] for week in payload['weekStructure']], [1, 4])
        self.assertEqual(payload, course_payload(self.course, list(reversed(weeks))))

    def test_unresolved_live_content_and_duplicate_ids_stop_adoption(self):
        for live_type in ('live-session', 'Live Session', 'live_session'):
            with self.subTest(type=live_type):
                weeks = deepcopy(self.weeks)
                weeks[0]['components'][0]['type'] = live_type
                with self.assertRaisesRegex(ValueError, 'Resolve legacy live-session'):
                    course_payload(self.course, weeks)
        self.weeks[0]['components'] *= 2
        with self.assertRaisesRegex(ValueError, 'Duplicate source component'):
            course_payload(self.course, self.weeks)

    def test_authorized_adoption_keeps_existing_live_content_and_meeting_identity(self):
        self.weeks[0]['components'][0].update(type='live-session', settings={
            'teamsLiveSessionId': 'LIVE-EXISTING', 'teamsMeetingUrl': 'https://example.test/meeting',
            'teamsOccurrenceId': 'OCC-EXISTING', 'sessionDate': '2026-09-12',
        })
        payload = course_payload(self.course, self.weeks, preserve_live=True)
        live = payload['weekStructure'][0]['components'][0]
        self.assertEqual(live['type'], 'live-session')
        for key, value in self.weeks[0]['components'][0]['settings'].items():
            self.assertEqual(live['settings'][key], value)

    def test_uploaded_video_keeps_its_file_and_uses_the_uploaded_video_editor(self):
        url = '/curriculum_api/curriculum/uploads/legacy-course/lesson.mp4'
        self.weeks[0]['components'][0].update(type='video', settings={
            'sourceType': 'External Link', 'videoUrl': url, 'uploadedFileUrl': url})
        payload = course_payload(self.course, self.weeks)
        settings = payload['weekStructure'][0]['components'][0]['settings']
        self.assertEqual(settings['videoUrl'], url)
        self.assertEqual(settings['uploadedFileUrl'], url)
        self.assertEqual(settings['sourceType'], 'HTML (MP4)')
        self.assertEqual(settings['provider'], 'Upload file')

    def historical_fields(self, **changes):
        payload = course_payload(self.course, self.weeks)
        week = payload['weekStructure'][0]
        history = {'id': 5, 'component_ref': 'FREECOMP-A', 'free_course_ref': self.course['id'],
                   'completed_at': datetime(2026, 9, 12, 10, tzinfo=timezone.utc), **changes}
        return completion_fields(history, profile_id=42, module=payload, week=week, component=week['components'][0])

    def test_history_remains_completed_without_hours_or_invented_grades(self):
        fields, ledger = self.historical_fields()
        self.assertEqual(fields['submitted_at'], datetime(2026, 9, 12, 10, tzinfo=timezone.utc))
        self.assertEqual(ledger['actual_seconds'], 0)
        self.assertFalse(ledger['accepted'])
        self.assertFalse(any(key in fields for key in ('passed', 'grade', 'claimed_seconds', 'verified_seconds')))
        # Exercise the authoritative completion and time-fallback rules without
        # importing application startup/database code.
        namespace = {}
        for filename, function in (('canonical_learning.py', 'counts_as_completed'),
                                   ('current_learning.py', 'is_unsynchronised_direct_save')):
            tree = ast.parse((Path(__file__).parents[1] / 'learner_api' / filename).read_text(encoding='utf-8'))
            definition = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == function)
            exec(compile(ast.Module(body=[definition], type_ignores=[]), filename, 'exec'), namespace)
        record = {**fields, **ledger}
        self.assertTrue(namespace['counts_as_completed'](record, include_source_evidence=False))
        self.assertFalse(namespace['is_unsynchronised_direct_save'](record))

    def test_history_cannot_be_applied_to_another_course_or_component(self):
        for change in ({'free_course_ref': 'FREECOURSE-OTHER'}, {'component_ref': 'FREECOMP-OTHER'}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'does not belong'):
                self.historical_fields(**change)


if __name__ == '__main__':
    unittest.main()
