"""Exercise recording-source save/readback without Django, a DB or network."""
import ast
import json
import unittest
from pathlib import Path


class RecordingSettingsSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8'))
        constants = {'LEGACY_SETTING_KEYS', 'RECORDING_SOURCE_SETTING_KEYS', 'LIVE_SESSION_TRACKING_SETTING_KEYS'}
        names = {'allowed_component_setting_keys', 'normalise_component_settings_payload'}
        nodes = [node for node in tree.body
                 if (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                     and target.id in constants for target in node.targets))
                 or (isinstance(node, ast.FunctionDef) and node.name in names)]
        context = {'json': json, 'frontend_component_type': lambda value: value.replace('_', '-'),
                   'component_settings_defaults': lambda kind: {},
                   'as_json_value': lambda value, default: json.loads(value) if isinstance(value, str) else value or default}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'recording-schema', 'exec'), context)
        cls.normalise = staticmethod(context['normalise_component_settings_payload'])

    def test_recording_routes_survive_normal_saves_and_recover_legacy_settings(self):
        source = {'recordingDate': '2026-10-28', 'recordingSeriesId': 'SERIES', 'recordingSessionNumber': 3}
        for kind in ('live-session', 'video', 'recording-placeholder'):
            with self.subTest(kind=kind):
                restored = self.normalise(kind, {'legacySettings': json.dumps(source)})
                saved = self.normalise(kind, json.loads(json.dumps(restored)))
                self.assertEqual({key: saved.get(key) for key in source}, source)
                self.assertNotIn('legacySettings', saved)

    def test_explicit_clear_is_not_replaced_by_the_retained_date(self):
        saved = self.normalise('live-session', {
            'recordingDate': '', 'legacySettings': json.dumps({'recordingDate': '2026-10-28'})})
        self.assertEqual(saved['recordingDate'], '')

    def test_unrelated_settings_are_still_quarantined(self):
        saved = self.normalise('live-session', {'recordingDat': '2026-10-28'})
        self.assertNotIn('recordingDat', saved)
        self.assertEqual(json.loads(saved['legacySettings']), {'recordingDat': '2026-10-28'})


if __name__ == '__main__':
    unittest.main()
