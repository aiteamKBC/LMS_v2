"""Real settings owner versus frozen source; stdlib only, no application startup."""
import ast
from copy import deepcopy
import importlib.util
import inspect
import json
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
OWNER = ROOT / 'domain/component_settings.py'
tree = _read_dependencies.source_tree(OWNER)
assert all(isinstance(n, ast.Import) and all(a.name == 'json' for a in n.names)
           for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom)))
spec = importlib.util.spec_from_file_location('standalone_component_settings', OWNER)
settings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(settings)
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/module_workspace_snapshot.json').read_text(encoding='utf-8'))
NAMES = ('component_settings_defaults', 'allowed_component_setting_keys', 'normalise_component_settings_payload')


def contract(defaults=None):
    """Bind the actual production functions to deterministic scalar JSON/type helpers."""
    context = {key: value for key, value in vars(settings).items() if key.isupper()}
    context.update(json=json, frontend_component_type=lambda value: str(value or '').replace('_', '-'),
                   as_json_value=lambda value, fallback: json.loads(value) if isinstance(value, str) else (value if value is not None else fallback))
    for name in NAMES:
        fn = getattr(settings, name)
        dependencies = [key for key, value in inspect.signature(fn).parameters.items()
                        if value.kind == inspect.Parameter.KEYWORD_ONLY]
        def bound(*args, _fn=fn, _deps=dependencies):
            return _fn(*args, **{key: context[key] for key in _deps})
        context[name] = bound
    if defaults is not None:
        context['component_settings_defaults'] = defaults
    return context


class ComponentSettingsParity(unittest.TestCase):
    def setUp(self):
        self.current = contract()
        self.previous = {key: value for key, value in self.current.items() if key not in NAMES}
        for name in NAMES:
            exec(compile(SNAPSHOT['functions'][name], '<original-settings>', 'exec'), self.previous)

    def compare(self, kind, payload):
        old = self.previous[NAMES[-1]](kind, deepcopy(payload))
        new = self.current[NAMES[-1]](kind, deepcopy(payload))
        self.assertEqual(new, old)
        return new

    def test_every_declared_schema_defaults_and_invalid_input_shapes(self):
        for kind in (*settings.COMPONENT_SETTINGS_SCHEMA, 'unknown', None):
            for value in (None, [], {}, {'version': '2.1'}):
                with self.subTest(kind=kind, value=value):
                    self.compare(kind, value)

    def test_explicit_empty_and_zero_override_retained_settings(self):
        self.assertEqual(self.compare('assignment', {'legacySettings': '{"version":"2.0","old":1}',
                                                    'version': '', 'old': 0})['version'], '')

    def test_assignment_podcast_reading_compatibility_preserves_authored_content(self):
        for kind, value in [('assignment', {'assignmentContent': 'Actual brief', 'uploadedFileUrl': '/file'}),
                            ('reading', {'readingSource': 'File', 'uploadedFileUrl': '/file'}),
                            ('podcast', {'podcastSource': 'Audio File', 'uploadedFileUrl': '/file'}),
                            ('podcast', {'podcastSource': 'External Link', 'podcastShortcode': 'retained'})]:
            self.compare(kind, value)

    def test_unknown_values_remain_quarantined_instead_of_faking_supported_content(self):
        value = self.compare('reading', {'unknown': 'data', 'nested': {'a': 1}, 'null': None})
        self.assertEqual(json.loads(value['legacySettings']), {'unknown': 'data'})
        self.assertNotIn('unknown', value)

    def test_input_and_schema_are_not_mutated(self):
        payload = {'assignmentContent': 'Brief', 'legacySettings': '{"unknown":2}'}
        before = deepcopy(payload), deepcopy(settings.COMPONENT_SETTINGS_SCHEMA)
        self.compare('assignment', payload)
        self.assertEqual(before, (payload, settings.COMPONENT_SETTINGS_SCHEMA))


if __name__ == '__main__':
    unittest.main()
