"""The free-course cover backfill decodes and deduplicates correctly.

No database, no storage: the command's two pure pieces -- reading a ``data:``
URI, and grouping rows by the picture rather than by the row -- are exercised on
their own.

The regression this guards: the two free-course tables hold the SAME pictures. A
course's cover is copied onto each of its weeks, and two courses were given the
same file, so ten production rows carried four images between them (three, as it
turned out -- one pair was byte-identical). Uploading per row would have stored
each picture three or four times and left the rows pointing at different objects
for the same image.
"""
import base64
import unittest

from curriculum_api.management.commands import backfill_free_course_cover_images as backfill


PNG = b'\x89PNG\r\n\x1a\n' + b'pretend-png-bytes' * 4
JPEG = b'\xff\xd8\xff\xe0' + b'pretend-jpeg-bytes' * 3


def data_uri(content_type, raw):
    return f'data:{content_type};base64,' + base64.b64encode(raw).decode()


class DecodeTests(unittest.TestCase):
    def setUp(self):
        self.command = backfill.Command()

    def test_reads_a_png_data_uri(self):
        content_type, raw, payload = self.command.decode(data_uri('image/png', PNG))
        self.assertEqual(content_type, 'image/png')
        self.assertEqual(raw, PNG)
        self.assertEqual(base64.b64decode(payload), PNG)

    def test_content_type_is_lowercased(self):
        content_type, _, _ = self.command.decode(data_uri('image/PNG', PNG))
        self.assertEqual(content_type, 'image/png')

    def test_tolerates_whitespace_inside_the_payload(self):
        encoded = base64.b64encode(PNG).decode()
        spaced = f'data:image/png;base64,{encoded[:8]}\n  {encoded[8:]}'
        _, raw, _ = self.command.decode(spaced)
        self.assertEqual(raw, PNG)

    def test_a_storage_url_is_not_a_data_uri(self):
        self.assertIsNone(self.command.decode('/curriculum_api/curriculum/uploads/x/cover.png'))

    def test_an_empty_value_decodes_to_nothing(self):
        self.assertIsNone(self.command.decode(''))
        self.assertIsNone(self.command.decode(None))

    def test_a_non_image_data_uri_is_refused(self):
        self.assertIsNone(self.command.decode('data:application/pdf;base64,' + base64.b64encode(PNG).decode()))

    def test_undecodable_base64_is_refused_rather_than_guessed(self):
        self.assertIsNone(self.command.decode('data:image/png;base64,not-valid-base64!!'))

    def test_a_data_uri_carrying_no_bytes_is_refused(self):
        self.assertIsNone(self.command.decode('data:image/png;base64,'))


class DeduplicationTests(unittest.TestCase):
    """Grouping by content digest, as handle() does before uploading."""

    def setUp(self):
        self.command = backfill.Command()

    def group(self, values):
        import hashlib
        by_digest = {}
        for table, identifier, value in values:
            decoded = self.command.decode(value)
            if not decoded:
                continue
            content_type, raw, _ = decoded
            digest = hashlib.sha256(raw).hexdigest()
            by_digest.setdefault(digest, {'content_type': content_type, 'rows': []})
            by_digest[digest]['rows'].append((table, identifier))
        return by_digest

    def test_the_same_image_in_both_tables_is_one_group(self):
        grouped = self.group([
            ('curriculum.free_courses', 'COURSE-1', data_uri('image/png', PNG)),
            ('curriculum.free_course_weeks', 'WEEK-1', data_uri('image/png', PNG)),
            ('curriculum.free_course_weeks', 'WEEK-2', data_uri('image/png', PNG)),
        ])
        self.assertEqual(len(grouped), 1)
        self.assertEqual(len(next(iter(grouped.values()))['rows']), 3)

    def test_the_same_image_under_two_different_courses_is_still_one_group(self):
        # Exactly the production case: two unrelated courses given the same file.
        grouped = self.group([
            ('curriculum.free_courses', 'COURSE-1', data_uri('image/jpeg', JPEG)),
            ('curriculum.free_courses', 'COURSE-2', data_uri('image/jpeg', JPEG)),
        ])
        self.assertEqual(len(grouped), 1)

    def test_different_images_stay_apart(self):
        grouped = self.group([
            ('curriculum.free_courses', 'COURSE-1', data_uri('image/png', PNG)),
            ('curriculum.free_courses', 'COURSE-2', data_uri('image/jpeg', JPEG)),
        ])
        self.assertEqual(len(grouped), 2)

    def test_an_undecodable_row_joins_no_group(self):
        grouped = self.group([
            ('curriculum.free_courses', 'COURSE-1', data_uri('image/png', PNG)),
            ('curriculum.free_courses', 'COURSE-2', 'data:image/png;base64,!!!'),
        ])
        self.assertEqual(len(grouped), 1)


class RollbackTests(unittest.TestCase):
    def setUp(self):
        self.command = backfill.Command()

    def test_a_standard_data_uri_rebuilds_exactly_from_its_bytes(self):
        # What `rollback_is_exact_from_object` records: the original column value
        # is a pure function of the stored object, so no copy has to be kept.
        original = data_uri('image/png', PNG)
        content_type, raw, payload = self.command.decode(original)
        self.assertEqual(base64.b64encode(raw).decode(), payload)
        self.assertEqual(f'data:{content_type};base64,' + base64.b64encode(raw).decode(), original)

    def test_a_whitespace_padded_uri_is_flagged_as_not_exactly_rebuildable(self):
        encoded = base64.b64encode(PNG).decode()
        spaced = f'data:image/png;base64,{encoded[:8]}\n{encoded[8:]}'
        _, raw, payload = self.command.decode(spaced)
        # Re-encoding gives the canonical form, not what the column held -- so the
        # command saves the original beside the manifest instead of relying on it.
        self.assertNotEqual(spaced, f'data:image/png;base64,{payload}')
        self.assertEqual(base64.b64encode(raw).decode(), payload)


class TargetTests(unittest.TestCase):
    def test_only_the_two_free_course_tables_are_touched(self):
        # curriculum.modules has no inline rows left and its own command; this one
        # must never reach for it.
        self.assertEqual(
            [table for table, _ in backfill.TABLES],
            ['curriculum.free_courses', 'curriculum.free_course_weeks'],
        )

    def test_every_target_is_keyed_on_id(self):
        self.assertTrue(all(key == 'id' for _, key in backfill.TABLES))


if __name__ == '__main__':
    unittest.main()
