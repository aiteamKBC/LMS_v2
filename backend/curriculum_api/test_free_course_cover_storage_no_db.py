"""Free-course artwork is stored as a file and referenced by URL, never inlined.

The companion to ``test_module_cover_storage_no_db``, for the two tables that
regression reached next. ``stored_module_cover_image`` already had its own
behaviour pinned there; what is pinned here is that the free-course save path
actually *calls* it, because that is the half that was missing.

The history: the Free Courses picker reads the chosen file in the browser and
sends it as a ``data:image/...;base64,...`` URL. ``save_free_programme_modules``
wrote that string straight into ``cover_image_url`` on both
``curriculum.free_course_weeks`` and ``curriculum.free_courses``.
``backfill_free_course_cover_images`` was written to clean the rows up — but
cleaning history achieves nothing while the save path can put the base64 back on
the next save, which it could.

No database and no Django: ``save_free_programme_modules`` is one large
transaction that cannot be executed without one, but the regression is
structural — a raw payload value reaching a column — so it is read off the
syntax tree instead.
"""

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def save_function():
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == 'save_free_programme_modules':
            return node
    raise AssertionError('save_free_programme_modules is not defined in views.py')


class FreeCourseCoverStorageTests(unittest.TestCase):
    def setUp(self):
        self.save = save_function()

    def cover_column_writes(self):
        """Every value assigned to a ``cover_image_url`` key in the function."""
        writes = []
        for node in ast.walk(self.save):
            if isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if isinstance(key, ast.Constant) and key.value == 'cover_image_url':
                        writes.append(value)
        return writes

    def test_both_tables_take_their_cover_from_the_resolved_name(self):
        """free_course_weeks and free_courses, neither reading the payload."""
        writes = self.cover_column_writes()
        self.assertEqual(len(writes), 2)
        for value in writes:
            # A bare name, not `module.get('coverImageUrl') or ...`. If this
            # fails as an ast.BoolOp or ast.Call, the payload is going into the
            # column again and a 3 MB data: URI is back in both tables.
            self.assertIsInstance(value, ast.Name)
            self.assertEqual(value.id, 'cover_image_url')

    def test_the_cover_is_resolved_through_the_shared_storage_helper(self):
        calls = [
            node for node in ast.walk(self.save)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == 'stored_module_cover_image'
        ]
        self.assertEqual(len(calls), 1, 'the free-course save must store the cover exactly once')

    def test_the_payload_cover_is_read_only_twice(self):
        """Once for the grouping key, once to resolve it. Never for a column.

        The grouping key reading the raw value is deliberate: it decides which
        weeks belong to one course, and keying that on a freshly stored URL --
        which carries a new timestamp on every save -- would split a course whose
        weeks were saved together.
        """
        reads = [
            node for node in ast.walk(self.save)
            if isinstance(node, ast.Constant) and node.value == 'coverImageUrl'
        ]
        self.assertEqual(len(reads), 2)

    def test_the_same_picture_is_not_uploaded_once_per_week(self):
        """A course's weeks all carry its cover; the bytes go up once."""
        names = {
            node.id for node in ast.walk(self.save)
            if isinstance(node, ast.Name)
        }
        self.assertIn('stored_cover_urls', names)


if __name__ == '__main__':
    unittest.main(verbosity=2)
