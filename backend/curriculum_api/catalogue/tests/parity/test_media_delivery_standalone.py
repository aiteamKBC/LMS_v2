"""Source fidelity and pure presentation orchestration; no Django or I/O."""
import ast
from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.application.presentation_reads import read_uploaded_presentation
from curriculum_api.catalogue.api.media_delivery import parse_byte_range

RAW = (ROOT / 'catalogue/tests/fixtures/legacy_snapshots/media_delivery_snapshot.json').read_bytes()
assert hashlib.sha256(RAW).hexdigest() == '98957690e559d54fc5af7402e045cf4d42566da22de86369c7a79f69c284cd6b'
SNAPSHOT = json.loads(RAW)


def definitions(text):
    return {n.name: n for n in ast.parse(text).body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}


class SourceContracts(unittest.TestCase):
    def test_renderer_bodies_are_exact_original_implementations(self):
        old = definitions(SNAPSHOT['pptx_source'])
        for name, owner in SNAPSHOT['pptx_owners'].items():
            if name not in old:
                continue
            with self.subTest(symbol=name):
                current = definitions((ROOT / ('catalogue/infrastructure/' + owner + '.py')).read_text(encoding='utf-8'))[name]
                expected = old[name]
                if name == 'render_root':
                    expected = definitions(ast.unparse(expected).replace(
                        'from curriculum_api.views import COMPONENT_UPLOAD_ROOT',
                        'from .upload_paths import COMPONENT_UPLOAD_ROOT'))[name]
                self.assertEqual(ast.dump(current), ast.dump(expected))

    def test_http_bodies_and_legacy_signatures_preserved(self):
        current = {n.name: n for n in current_entry_tree().body if isinstance(n, ast.FunctionDef)}
        owners = definitions((ROOT / 'catalogue/api/media_delivery.py').read_text(encoding='utf-8'))
        for name, entry in SNAPSHOT['views'].items():
            expected = definitions(entry['source'])[name]
            self.assertEqual(ast.dump(current[name].args), ast.dump(expected.args), name)
            self.assertEqual([ast.unparse(n) for n in current[name].decorator_list], entry['decorators'])
            if name != 'curriculum_presentation_slides':
                self.assertEqual(ast.dump(ast.Module(body=owners[name].body, type_ignores=[])),
                                 ast.dump(ast.Module(body=expected.body, type_ignores=[])), name)

    def test_new_dependencies_point_to_owners(self):
        paths = list((ROOT / 'catalogue/infrastructure').glob('presentation*.py'))
        paths += [ROOT / 'catalogue/application/presentation_reads.py', ROOT / 'catalogue/api/media_delivery.py']
        for path in paths:
            for node in ast.walk(_read_dependencies.source_tree(path)):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotEqual(node.module, 'curriculum_api.views')
                    self.assertNotEqual(node.module, 'learner_api.media_proxy')
                    self.assertFalse(any(a.name == 'views' for a in node.names))
                    if '/application/' in path.as_posix():
                        self.fail('Pure presentation orchestration needs no imported infrastructure')
        self.assertNotIn('django', sys.modules)

    def test_byte_ranges_match_the_original_for_edge_inputs(self):
        namespace = {}
        exec(compile(SNAPSHOT['views']['parse_byte_range']['source'], '<frozen range parser>', 'exec'), namespace)
        for total in (0, 1, 100, 2048):
            for header in (None, '', 'bytes=0-0', 'bytes=0-', 'bytes=-1', 'bytes=-0', 'bytes=9999-',
                           'bytes=10-2', 'bytes=0-99999', 'bytes=x-y', 'bytes=0-1,3-4', ' BYTES=1-2 '):
                self.assertEqual(parse_byte_range(header, total), namespace['parse_byte_range'](header, total))


class PresentationReadContracts(unittest.TestCase):
    def setUp(self):
        self.deck = {'slides': [], 'slideCount': 0}
        self.release = Mock()
        self.ports = dict(content_stamp=Mock(return_value='stamp'), cached_for_stamp=Mock(return_value=None),
                          local_copy=Mock(return_value=('copy.pptx', self.release)), source_exists=Mock(return_value=True),
                          cached_model=Mock(return_value=self.deck), render_model=Mock(return_value=self.deck),
                          UnsupportedDeck=ValueError)

    def read(self):
        return read_uploaded_presentation('upload.pptx', **self.ports)

    def test_stamped_cache_precedes_source_acquisition(self):
        self.ports['cached_for_stamp'].return_value = self.deck
        self.assertEqual(self.read(), (self.deck, None))
        self.ports['local_copy'].assert_not_called()

    def test_current_source_is_rendered_and_released(self):
        self.assertEqual(self.read(), (self.deck, None))
        self.ports['render_model'].assert_called_once_with('upload.pptx', 'copy.pptx', stamp='stamp')
        self.release.assert_called_once()
        self.ports['cached_model'].assert_not_called()

    def test_missing_source_is_marked_without_mutating_cached_model(self):
        self.ports['source_exists'].return_value = False
        self.assertEqual(self.read(), ({**self.deck, 'sourceMissing': True}, None))
        self.assertNotIn('sourceMissing', self.deck)
        self.ports['render_model'].assert_not_called()
        self.release.assert_not_called()  # Existing missing-copy contract.

    def test_missing_source_without_cache_remains_missing(self):
        self.ports['source_exists'].return_value = False
        self.ports['cached_model'].return_value = None
        self.assertEqual(self.read(), (None, None))

    def test_unreadable_current_source_never_serves_stale_slides(self):
        for message in ('cannot render', ''):
            with self.subTest(message=message):
                self.ports['render_model'].side_effect = ValueError(message)
                self.assertEqual(self.read(), (None, message))
                self.ports['cached_model'].assert_not_called()
        self.assertEqual(self.release.call_count, 2)

    def test_unexpected_failure_propagates_and_releases_copy(self):
        self.ports['render_model'].side_effect = OSError('read failed')
        with self.assertRaisesRegex(OSError, 'read failed'):
            self.read()
        self.release.assert_called_once()


if __name__ == '__main__':
    unittest.main()
