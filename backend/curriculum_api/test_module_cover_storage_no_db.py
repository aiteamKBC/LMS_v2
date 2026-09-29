"""Module artwork is stored as a file and referenced by URL, never inlined.

No database, no Django, no transport: `stored_module_cover_image` is lifted out
of views.py on its own and asked what it puts in
``curriculum.modules.cover_image_url``, against a stubbed upload_storage.

The regression it guards: the builder's picker sends the chosen image as a
``data:image/...;base64,...`` URL, and that string used to go straight into the
column. Five modules doing it was 1.52 MB of a 1.79 MB
``/curriculum/modules/?compact=true`` response -- 83% of it -- because every
module list selects that column. The picture has to survive; what must not is
its presence in a list of 281 modules.
"""
import ast
import base64
import re
import types
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent

PNG = 'data:image/png;base64,' + base64.b64encode(b'not-really-a-png-but-bytes').decode()
JPEG = 'data:image/jpeg;base64,' + base64.b64encode(b'jpeg-bytes').decode()


class StubStorage:
    def __init__(self, fail=False):
        self.saved = []
        self.fail = fail

    def store(self, file_obj, relative_path, content_type=''):
        if self.fail:
            raise OSError('container unavailable')
        self.saved.append((relative_path, content_type, file_obj.read()))
        return relative_path


class ModuleCoverStorageTests(unittest.TestCase):
    def setUp(self):
        self.storage = StubStorage()
        self.v = types.ModuleType('curriculum_api.views')
        self.v.base64 = base64
        self.v.re = re
        self.v.datetime = datetime
        self.v.logger = types.SimpleNamespace(warning=lambda *a, **k: None, exception=lambda *a, **k: None)
        self.v.upload_storage = self.storage
        self.v.clean_str = lambda value: str(value if value is not None else '').strip()
        self.v.ContentFile = lambda raw: types.SimpleNamespace(read=lambda: raw)
        self.v.safe_upload_segment = lambda value, fallback: (str(value or '').strip() or fallback)
        # Read from views.py rather than restated, so a change to either the
        # path shape or the accepted image types is caught here.
        source = (ROOT / 'views.py').read_text(encoding='utf-8-sig')
        tree = ast.parse(source)
        constants = {
            'COMPONENT_UPLOAD_ROOT', 'MODULE_COVER_UPLOAD_SLOT',
            'MODULE_COVER_EXTENSIONS', 'MODULE_COVER_DATA_URI',
        }
        nodes = [
            node for node in tree.body
            if (isinstance(node, ast.FunctionDef) and node.name == 'stored_module_cover_image')
            or (
                isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id in constants for t in node.targets)
            )
        ]
        self.assertEqual(len(nodes), len(constants) + 1)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / 'views.py'), 'exec'), self.v.__dict__)
        self.store = self.v.stored_module_cover_image

    def test_an_inline_image_is_stored_and_replaced_by_a_served_url(self):
        result = self.store('MOD-1', PNG)
        self.assertFalse(result.startswith('data:'))
        self.assertTrue(result.startswith('/curriculum_api/curriculum/uploads/MOD-1/cover/'))
        self.assertTrue(result.endswith('.png'))
        # The column now holds a reference, not a picture.
        self.assertLess(len(result), 200)
        self.assertEqual(len(self.storage.saved), 1)
        relative_path, content_type, raw = self.storage.saved[0]
        self.assertTrue(relative_path.startswith('curriculum_component_uploads/MOD-1/cover/'))
        self.assertEqual(content_type, 'image/png')
        # The same bytes the picker sent, decoded once.
        self.assertEqual(raw, b'not-really-a-png-but-bytes')

    def test_the_stored_extension_follows_the_declared_image_type(self):
        self.assertTrue(self.store('MOD-2', JPEG).endswith('.jpg'))

    def test_a_pasted_url_is_left_exactly_as_it_arrived(self):
        pasted = 'https://example.invalid/artwork.png'
        self.assertEqual(self.store('MOD-3', pasted), pasted)
        self.assertEqual(self.storage.saved, [])

    def test_an_empty_value_still_means_remove_the_cover(self):
        self.assertEqual(self.store('MOD-4', ''), '')
        self.assertEqual(self.store('MOD-4', None), '')
        self.assertEqual(self.storage.saved, [])

    def test_two_saves_do_not_overwrite_each_other(self):
        first = self.store('MOD-5', PNG)
        second = self.store('MOD-5', JPEG)
        self.assertNotEqual(first, second)

    def test_a_module_id_with_path_characters_cannot_escape_its_folder(self):
        self.v.safe_upload_segment = lambda value, fallback: 'MOD-6'
        self.assertNotIn('..', self.store('../../etc/MOD-6', PNG))

    def test_storage_failing_keeps_the_image_rather_than_losing_it(self):
        """A module that will not save is worse than a cover in the column."""
        self.storage.fail = True
        self.assertEqual(self.store('MOD-7', PNG), PNG)

    def test_a_value_that_is_not_decodable_base64_is_not_silently_cleared(self):
        broken = 'data:image/png;base64,!!!!'
        self.assertEqual(self.store('MOD-8', broken), broken)
        self.assertEqual(self.storage.saved, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
