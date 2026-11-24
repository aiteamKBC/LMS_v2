"""Exercise recording-source save/readback without Django, a DB or network."""
import ast
import json
import unittest
from pathlib import Path


class RecordingSettingsSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location('settings_parity_support', Path(__file__).parent / 'catalogue/tests/parity/test_component_settings_standalone.py')
        support = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(support)
        cls.normalise = staticmethod(support.contract(defaults=lambda kind: {})['normalise_component_settings_payload'])

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
