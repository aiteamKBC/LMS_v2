"""Point display metadata is tested with mocked readers, never a live database."""
import json
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from . import learner_detail, weekly_learning
from .point_structure import point_projection
from .tests_weekly_learning import FakeCursor
from curriculum_api.views import normalise_component_settings_payload


class PointProjectionTests(SimpleTestCase):
    def test_real_native_saves_keep_point_grouping_and_existing_authored_scalars(self):
        for component_type in ('reading', 'podcast', 'video', 'quiz', 'live-session'):
            for metadata in ({'pointNumber': 3}, {'legacySettings': {'pointNumber': 3}},
                             {'legacySettings': '{"pointNumber":3}'}):
                with self.subTest(component_type=component_type, metadata=metadata):
                    original = {'unknownFalse': False, 'unknownZero': 0, 'unknownIds': ['keep'],
                                'teamsOccurrenceId': 'OCC-UNCHANGED', 'teamsSessionNumber': 4,
                                'sessionDateTimeUtc': '2026-10-29T09:00:00Z', **metadata}
                    first = normalise_component_settings_payload(component_type, original)
                    second = normalise_component_settings_payload(component_type, first)
                    self.assertEqual(first, second)
                    self.assertEqual(point_projection(second), {'pointNumber': 3})
                    flattened = {**json.loads(second.get('legacySettings', '{}')), **second}
                    for key, value in original.items():
                        if key not in ('pointNumber', 'legacySettings'):
                            self.assertEqual(flattened[key], value)

    def test_only_positive_authored_integer_is_exposed(self):
        for value in (None, True, False, 0, -1, 1.5, '1', [], {}, 9007199254740992):
            self.assertEqual(point_projection({'pointNumber': value}), {})
        self.assertEqual(point_projection({'pointNumber': 3}), {'pointNumber': 3})
        self.assertEqual(point_projection({'legacySettings': {'pointNumber': 2}}), {'pointNumber': 2})
        self.assertEqual(point_projection({'legacySettings': '{"pointNumber": 2}'}), {'pointNumber': 2})

    def test_native_legacy_string_and_compact_fallback_keep_strict_types(self):
        for container in ('legacySettings', '_pointLegacySettings'):
            for value in ({'pointNumber': 3}, '{"pointNumber":3}', json.dumps('{"pointNumber":3}')):
                with self.subTest(container=container, value=value):
                    self.assertEqual(point_projection({container: value}), {'pointNumber': 3})
            for invalid in ('1', True, 1.5, -1, 0, 9007199254740992):
                self.assertEqual(point_projection({container: json.dumps({'pointNumber': invalid})}), {})
            for invalid in ('{bad', '[]', 'null', 'true', json.dumps(json.dumps('{"pointNumber":3}'))):
                self.assertEqual(point_projection({container: invalid}), {})
        self.assertEqual(point_projection({'pointNumber': '1', 'legacySettings': '{"pointNumber":2}'}), {})
        self.assertEqual(point_projection({'pointNumber': 4, 'legacySettings': '{"pointNumber":2}'}), {'pointNumber': 4})

    def test_compact_legacy_fallback_never_exposes_internal_or_unknown_data(self):
        class Cursor(FakeCursor):
            def execute(self, sql, params=None):
                super().execute(sql, params)
                if 'FROM curriculum.components WHERE' in sql:
                    self.rows = [('R1', 'W1', 'M1', 'reading', 'Read', '', json.dumps({
                        'pointNumber': None,
                        '_pointLegacySettings': json.dumps({'pointNumber': 2, 'privateExtra': 'not-public'})}),
                        None, 1, None, False, None, False, 1.5)]
        for options in ({'compact': True}, {'compact': True, 'week_ids': ['W1']},
                        {'compact': True, 'compact_content': True}, {'identities_only': True}):
            connection = MagicMock()
            connection.cursor.return_value = Cursor()
            with patch.object(learner_detail, 'connections', {'enrolment': connection}):
                _, _, components = learner_detail._resolve_from_master(
                    [], [], [], assigned_modules=[{'moduleId': 'M1'}], **options)
            self.assertEqual(components[0]['pointNumber'], 2)
            self.assertNotIn('privateExtra', json.dumps(components))
            self.assertNotIn('_pointLegacySettings', json.dumps(components))

    def test_full_compact_identity_and_weekly_keep_ids_and_point_metadata(self):
        class Cursor(FakeCursor):
            def execute(self, sql, params=None):
                super().execute(sql, params)
                if 'FROM curriculum.components WHERE' in sql:
                    self.rows = [('R1', 'W1', 'M1', 'reading', 'Read', '', json.dumps({
                        'pointNumber': 2, 'readingContent': '<p>Case</p>'}), None, 1, None, False, None, False, 1.5)]
        for options in ({}, {'compact': True}, {'compact': True, 'week_ids': ['W1']},
                        {'compact': True, 'compact_content': True}, {'identities_only': True}):
            with self.subTest(options=options):
                cursor = Cursor()
                connection = MagicMock()
                connection.cursor.return_value = cursor
                with patch.object(learner_detail, 'connections', {'enrolment': connection}):
                    modules, weeks, components = learner_detail._resolve_from_master(
                        [], [], [], assigned_modules=[{'moduleId': 'M1'}], **options)
                self.assertEqual(modules, ['Marketing'])
                self.assertEqual([row['weekId'] for row in weeks], ['W1'])
                self.assertEqual([row['componentId'] for row in components], ['R1'])
                self.assertEqual(components[0]['pointNumber'], 2)
                self.assertEqual(weekly_learning._weekly_component(components[0])['pointNumber'], 2)
                selects = [sql for sql in cursor.statements if 'FROM curriculum.components WHERE' in sql]
                self.assertTrue(all("'pointNumber'" in sql for sql in selects))
                self.assertFalse(any(sql.lstrip().upper().startswith(('UPDATE ', 'INSERT ', 'DELETE ')) for sql in cursor.statements))

    def test_untagged_weekly_component_does_not_gain_a_group(self):
        row = weekly_learning._weekly_component({'componentId': 'OLD', 'type': 'reading'})
        self.assertEqual(row['componentId'], 'OLD')
        self.assertNotIn('pointNumber', row)
