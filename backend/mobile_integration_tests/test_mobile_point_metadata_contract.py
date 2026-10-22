"""Read-only mobile metadata regressions using the maintained facade harness."""
import copy
import json
import unittest
from unittest.mock import MagicMock, patch

from test_mobile_contract import mobile


class PointMetadataCompatibilityTests(unittest.TestCase):
    def metadata(self, *, point=None, legacy=None, direct=None, raw=False,
                 module_id='M1', week_id='W1'):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [('C1', week_id, 7, None, point, None, None,
            False, legacy, None, json.dumps(direct) if raw else direct, module_id, 9, 8)]
        connection = MagicMock()
        connection.cursor.return_value = cursor
        components = [{'componentId': 'C1', 'moduleId': 'M1', 'weekId': 'W1',
                       'audioUrl': 'https://example.invalid/source.mp3'}]
        before = copy.deepcopy(components)
        with patch.object(mobile, 'connections', {'enrolment': connection}):
            result = mobile._presentation_metadata(components)
        self.assertEqual(components, before)
        sql = cursor.execute.call_args.args[0]
        self.assertTrue(sql.lstrip().startswith('SELECT '))
        self.assertIn("'pointNumber', c.settings_json->'pointNumber'", sql)
        return result

    def test_top_level_json_number_survives_raw_and_native_driver_objects(self):
        for raw in (False, True):
            result = self.metadata(point='3', direct={'pointNumber': 3}, raw=raw)['C1']
            self.assertEqual(result['pointNumber'], 3)
            self.assertEqual(result['displayOrder'], 7)
            self.assertEqual(result['weekNumber'], 9)
            self.assertEqual(result['weekDisplayOrder'], 8)
            self.assertNotIn('teachingWeek', result)

    def test_native_legacy_object_string_and_raw_double_encoding_survive(self):
        authored = {'pointNumber': 2, 'unknown': {'answerKey': 'never expose'}, 'optional': True}
        for legacy in (authored, json.dumps(authored), json.dumps(json.dumps(authored))):
            before = copy.deepcopy(legacy)
            item = self.metadata(legacy=legacy, direct={'pointNumber': None}, raw=True)['C1']
            self.assertEqual(item['pointNumber'], 2)
            self.assertTrue(item['learningRoute']['optional'])
            self.assertNotIn('unknown', item)
            self.assertNotIn('answerKey', json.dumps(item))
            self.assertEqual(legacy, before)

    def test_authored_strings_and_invalid_numbers_never_become_groups(self):
        for invalid in ('1', True, False, 0, -1, 1.5, 9007199254740992, [], {}):
            for raw in (False, True):
                item = self.metadata(point='1', legacy={'pointNumber': 2},
                                     direct={'pointNumber': invalid}, raw=raw)['C1']
                self.assertNotIn('pointNumber', item)
            for legacy in ({'pointNumber': invalid}, json.dumps({'pointNumber': invalid}),
                           json.dumps(json.dumps({'pointNumber': invalid}))):
                self.assertNotIn('pointNumber', self.metadata(legacy=legacy)['C1'])

    def test_malformed_and_over_encoded_legacy_remain_untagged(self):
        for value in ('{bad', '[]', 'null', 'true', '3', [], True, 3,
                      json.dumps(json.dumps(json.dumps({'pointNumber': 2})))):
            self.assertNotIn('pointNumber', self.metadata(legacy=value)['C1'])

    def test_top_level_wins_and_cross_module_or_week_rows_stay_excluded(self):
        item = self.metadata(legacy={'pointNumber': 2}, direct={'pointNumber': 4})['C1']
        self.assertEqual(item['pointNumber'], 4)
        self.assertEqual(self.metadata(direct={'pointNumber': 4}, module_id='OTHER'), {})
        self.assertEqual(self.metadata(direct={'pointNumber': 4}, week_id='OTHER'), {})

    def test_native_authoring_string_roundtrip_preserves_route_and_reading_ids(self):
        legacy = {'pointNumber': 5, 'required': False, 'optional': True, 'required_route_minutes': 0}
        direct = {'pointNumber': None, 'teachingWeek': None,
                  'sourceReadingComponentIds': ['READ-1', 'READ-2']}
        item = self.metadata(legacy=json.dumps(json.dumps(legacy)), direct=direct, raw=True)['C1']
        self.assertEqual(item['pointNumber'], 5)
        self.assertEqual(item['sourceReadingComponentIds'], ['READ-1', 'READ-2'])
        self.assertEqual(item['learningRoute'], {'source': 'canonical_settings',
            'required': False, 'optional': True, 'requiredRouteMinutes': 0})


if __name__ == '__main__':
    unittest.main()
