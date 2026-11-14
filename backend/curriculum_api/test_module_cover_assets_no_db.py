"""Manifest/planner/backup checks: no Django setup, database or network."""
import contextlib
import copy
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ROOT = BACKEND_ROOT.parent if (BACKEND_ROOT.parent / 'frontend').is_dir() else BACKEND_ROOT
spec = importlib.util.spec_from_file_location('cover_asset_tool', BACKEND_ROOT / 'scripts/apply_module_cover_assets.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class ModuleCoverAssetsTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.covers = tool.load_manifest()
        self.base = 'https://learning.example.invalid'
        self.empty = {cover['moduleId']: None for cover in self.covers}

    def test_manifest_is_scoped_to_thirty_unique_module_targets(self):
        self.assertEqual(len(self.covers), 30)
        self.assertEqual(len({cover['moduleId'] for cover in self.covers}), 30)

    def test_fresh_database_plan_is_scoped_and_does_not_mutate_its_input(self):
        self.empty['UNRELATED-MODULE'] = '/someone-elses-cover.png'
        before = copy.deepcopy(self.empty)
        plan = tool.plan_updates(self.covers, self.empty, self.base)
        self.assertEqual(len(plan['updates']), 30)
        self.assertEqual({row['moduleId'] for row in plan['updates']}, {cover['moduleId'] for cover in self.covers})
        self.assertTrue(all(row['url'].startswith(self.base + '/assets/module-covers/2026-11-13/') for row in plan['updates']))
        self.assertEqual(self.empty, before)

    def test_replaying_an_applied_manifest_plans_zero_writes(self):
        first = tool.plan_updates(self.covers, self.empty, self.base)
        existing = {row['moduleId']: row['url'] for row in first['updates']}
        repeated = tool.plan_updates(self.covers, existing, self.base)
        self.assertEqual(repeated['updates'], [])
        self.assertEqual(repeated['unchanged'], 30)

    def test_existing_custom_and_uploaded_covers_are_preserved_by_default(self):
        current = {mid: 'https://storage.example.invalid/existing-cover' for mid in self.empty}
        current[self.covers[0]['moduleId']] = ''
        plan = tool.plan_updates(self.covers, current, self.base)
        self.assertEqual([row['moduleId'] for row in plan['updates']], [self.covers[0]['moduleId']])
        self.assertEqual(plan['preserved'], 29)

    def test_replacement_requires_the_explicit_option(self):
        current = {mid: '/custom-cover.png' for mid in self.empty}
        self.assertEqual(tool.plan_updates(self.covers, current, self.base)['updates'], [])
        self.assertEqual(len(tool.plan_updates(self.covers, current, self.base, replace_existing=True)['updates']), 30)

    def test_missing_modules_fail_closed_unless_partial_environment_is_explicit(self):
        current = {self.covers[0]['moduleId']: None}
        with self.assertRaisesRegex(ValueError, '29 mapped modules'):
            tool.plan_updates(self.covers, current, self.base)
        partial = tool.plan_updates(self.covers, current, self.base, allow_missing=True)
        self.assertEqual(len(partial['missing']), 29)
        self.assertEqual(len(partial['updates']), 1)

    def test_private_or_invalid_base_urls_are_rejected_without_io(self):
        for base in ['javascript:alert(1)', '/assets', 'https://user:secret@example.invalid', 'https://example.invalid?sig=private', 'https://example.invalid#fragment']:
            with self.subTest(base=base), self.assertRaises(ValueError):
                tool.plan_updates(self.covers, self.empty, base)

    def test_invalid_manifest_identifiers_paths_and_checksums_are_rejected(self):
        original = json.loads(tool.MANIFEST.read_text(encoding='utf-8'))
        for field, value in [('moduleId', self.covers[0]['moduleId']), ('asset', 'assets/../../secret.webp'), ('sha256', 'wrong')]:
            changed = copy.deepcopy(original)
            changed['covers'][1][field] = value
            with tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / 'manifest.json'
                file.write_text(json.dumps(changed), encoding='utf-8')
                with self.assertRaises(ValueError):
                    tool.load_manifest(file)

    def test_private_backup_preserves_values_and_cannot_overwrite_or_enter_checkout(self):
        rows = {'M1': {'coverImageUrl': 'https://example.invalid/?sig=synthetic', 'fingerprint': 'before'}}
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'covers.json'
            tool.write_backup(file, rows)
            self.assertEqual(json.loads(file.read_text(encoding='utf-8'))['modules'], rows)
            with self.assertRaises(FileExistsError):
                tool.write_backup(file, rows)
        with self.assertRaises(ValueError):
            tool.write_backup(ROOT / 'output/cover-backup-must-not-be-created.json', rows)

    def test_apply_requires_backup_before_loading_database_code(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            tool.main(['--asset-base-url', self.base, '--expected-host', 'db.example.invalid', '--expected-database', 'example', '--apply'])
        self.assertEqual(error.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
