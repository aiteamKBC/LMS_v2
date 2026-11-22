"""Request-only date parsing reuse keeps placement and review flags independent."""
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from django.test import SimpleTestCase

from . import subject_dates as dates


class CatalogueScheduleReuseTests(SimpleTestCase):
    def test_cached_and_uncached_dates_match_for_legacy_and_builder_inputs(self):
        cases = [
            ('Group 2 - 20/02/26',), ('8/9/2026',), ('Session 10/31/26',),
            ('٣١/١٠/٢٠٢٦',), ('20 November 2026',), ('Nov 20, 2026',),
            ('Lesson', None, None, 'Introduction', 'builder_section_title'),
            ('Lesson', None, None, '1 Nov 2026', 'builder_section_title'),
            ('Lesson', '2026-11-01'), ('Lesson', None, '2026-11-01'),
            ('Lesson', date(2026, 11, 1)),
            ('Lesson', datetime(2026, 11, 1, tzinfo=timezone.utc)),
            ('Reading 20 Nov',), ('1/2/2026 and 2/3/2026',),
            (None,), ({'legacy': 'title'},), (True,), (1,),
        ]
        def schedule(values):
            title, stored, original, section, source = (*values, *([None] * (5-len(values))))
            return dates.activity_schedule(title, stored, original, section_title=section,
                section_source=source or 'section_title')
        expected = [schedule(values) for values in cases]
        with dates.schedule_read_scope():
            for _ in range(2):
                self.assertEqual([schedule(values) for values in cases], expected)

    def test_shared_heading_is_parsed_once_without_sharing_mutable_results(self):
        with patch.object(dates, '_activity_schedule', wraps=dates._activity_schedule) as parse:
            with dates.schedule_read_scope():
                first = dates.activity_schedule('1 Nov 2026')
                first.update(date='wrong', date_needs_review=True)
                second = dates.activity_schedule('1 Nov 2026')
                self.assertEqual(parse.call_count, 1)
                self.assertEqual(second['date'], '2026-11-01')
                self.assertFalse(second['date_needs_review'])
            dates.activity_schedule('1 Nov 2026')
            with dates.schedule_read_scope():
                dates.activity_schedule('1 Nov 2026')
            self.assertEqual(parse.call_count, 3)

    def test_recursive_section_reuse_preserves_source_labels_and_scope_cleanup(self):
        with patch.object(dates, '_activity_schedule', wraps=dates._activity_schedule) as parse:
            with self.assertRaisesRegex(ValueError, 'synthetic'):
                with dates.schedule_read_scope():
                    first = dates.activity_schedule('First reading', section_title='1 Nov 2026')
                    second = dates.activity_schedule('Second reading', section_title='1 Nov 2026',
                        section_source='builder_section_title')
                    self.assertEqual(first['date_source'], 'section_title')
                    self.assertEqual(second['date_source'], 'builder_section_title')
                    self.assertEqual(parse.call_count, 3)
                    raise ValueError('synthetic')
            self.assertIsNone(dates._schedule_reader.get())

    def test_equal_instants_keep_their_original_local_date(self):
        utc = datetime(2026, 10, 31, 23, tzinfo=timezone.utc)
        local = utc.astimezone(timezone(timedelta(hours=2)))
        self.assertEqual(utc, local)
        with dates.schedule_read_scope():
            self.assertEqual(dates.activity_schedule('Reading', utc)['date'], '2026-10-31')
            self.assertEqual(dates.activity_schedule('Reading', local)['date'], '2026-11-01')
