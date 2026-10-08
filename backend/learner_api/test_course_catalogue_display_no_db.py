"""Source placement and recovery regressions without app startup or a database."""
import copy
import unittest

from learner_api.course_catalogue_display import catalogue_display_context, read_export_placements
from learner_api import test_course_catalogue_no_db as fixtures
from learner_api.test_canonical_learning_no_db import adapter
from unittest.mock import Mock


class CourseDisplayTests(unittest.TestCase):
    def setUp(self):
        self.scope = adapter(Mock())
        self.courses = [{'source_course_ref': '50', 'source_course_title': 'Course'}]
        self.definitions = [fixtures.CourseCatalogueTests.definition('50', ref)
                            for ref in ('material:10', 'quiz:10', 'material:20', 'material:30')]

    @staticmethod
    def placement(ident, title, order=1, kind='lesson', course=50):
        return {'course_id': course, 'component_id': ident, 'component_kind': kind,
                'section_id': str(order), 'section_order': str(order), 'section_title': title}

    def project(self, exports, records=()):
        definitions = catalogue_display_context(self.definitions, exports)
        return self.scope['recorded_course_items'](self.courses, definitions, records, include_catalogue=True)[0]

    def test_undated_components_recover_exact_source_month_and_london_week(self):
        items = self.project([self.placement(10, 'Lecture 17\\4\\26')])
        self.assertEqual(items[0]['date'], '2026-04-17')
        self.assertEqual(items[0]['month'], '2026-04')
        self.assertEqual(items[0]['week_start'], '2026-04-13')
        self.assertEqual(items[0]['section_title'], 'Lecture 17\\4\\26')
        self.assertEqual(items[1]['month'], 'undated')  # quiz:10 is distinct
        self.assertTrue(items[1]['date_needs_review'])

    def test_month_heading_does_not_invent_a_day(self):
        item = self.project([self.placement(10, 'March 2026')])[0]
        self.assertEqual(item['month'], '2026-03')
        self.assertIsNone(item['date'])
        self.assertIsNone(item['week_start'])

    def test_section_reference_places_components_missing_from_the_export_material_list(self):
        self.definitions[1]['source_section_ref'] = '2'
        item = self.project([self.placement(None, 'April 2026', 2)])[1]
        self.assertEqual(item['month'], '2026-04')
        self.assertIsNone(item['date'])
        self.assertEqual(item['section_title'], 'April 2026')
        self.assertFalse(item['completed'])

    def test_section_reference_is_scoped_to_the_owned_course(self):
        self.definitions[1]['source_section_ref'] = '2'
        item = self.project([self.placement(None, 'April 2026', 2, course=99)])[1]
        self.assertEqual(item['month'], 'undated')
        self.assertTrue(item['date_needs_review'])

    def test_conflicting_component_and_section_references_need_review(self):
        self.definitions[0]['source_section_ref'] = '2'
        item = self.project([self.placement(10, 'March 2026', 1),
                             self.placement(None, 'April 2026', 2)])[0]
        self.assertEqual(item['month'], 'undated')
        self.assertTrue(item['date_needs_review'])

    def test_verified_quiz_parent_supplies_placement_even_before_the_parent_in_source_order(self):
        parent, quiz = self.definitions[:2]
        parent.update(source_payload={'quiz_id': 10}, material_available=False)
        quiz['source_payload'] = {'activity_id': 10}
        self.definitions[:2] = [quiz, parent]
        before = copy.deepcopy(self.definitions)
        item = self.project([self.placement(10, 'Lecture 17/4/26')])[0]
        self.assertEqual((item['month'], item['date']), ('2026-04', '2026-04-17'))
        self.assertEqual(item['section_title'], 'Lecture 17/4/26')
        self.assertNotIn('source_material_activity_id', item)  # Placement does not invent content.
        self.assertEqual(self.definitions, before)

    def test_parent_does_not_overwrite_a_quizs_own_date_or_conflicting_sections(self):
        self.definitions[0]['source_payload'] = {'quiz_id': 10}
        self.definitions[1]['source_payload'] = {'activity_id': 10}
        exports = [self.placement(10, 'March 2026'), self.placement(10, 'April 2026', 2, kind='quiz')]
        self.assertEqual(self.project(exports)[1]['month'], '2026-04')
        exports.append(self.placement(10, 'May 2026', 3, kind='quiz'))
        item = self.project(exports)[1]
        self.assertEqual(item['month'], 'undated')
        self.assertTrue(item['date_needs_review'])

    def test_ambiguous_parent_date_and_unconfirmed_parent_links_remain_for_review(self):
        self.definitions[0]['source_payload'] = {'quiz_id': 10}
        self.definitions[1]['source_payload'] = {'activity_id': 10}
        item = self.project([self.placement(10, 'March 2026'), self.placement(10, 'April 2026', 2)])[1]
        self.assertEqual(item['month'], 'undated')
        self.assertTrue(item['date_needs_review'])
        self.definitions[0]['source_payload'] = {'quiz_id': 99}
        self.assertEqual(self.project([self.placement(10, 'March 2026')])[1]['month'], 'undated')

    def test_pre_month_section_and_its_confirmed_quiz_are_introduction(self):
        self.definitions[0].update(source_section_ref='1', source_payload={'quiz_id': 10})
        self.definitions[1]['source_payload'] = {'activity_id': 10}
        items = self.project([self.placement(None, 'Welcome resources', 1),
                              self.placement(20, 'March 2026', 2)])
        self.assertEqual([item['date_source'] for item in items[:2]], ['introduction', 'introduction'])

    def test_explicit_source_introduction_and_month_headings_work_without_export_members(self):
        for title, month, source in [('Introduction', 'undated', 'introduction'),
                                     ('March - 2026', '2026-03', 'section_month')]:
            with self.subTest(title=title):
                self.definitions[0]['source_section_title'] = title
                item = self.project([])[0]
                self.assertEqual((item['month'], item['date_source']), (month, source))
                self.assertIsNone(item['date'])

    def test_only_sections_before_first_dated_section_become_introduction(self):
        exports = [self.placement(10, 'Welcome resources', 1),
                   self.placement(20, 'March 2026', 2),
                   self.placement(30, 'Unscheduled follow-up', 3)]
        before = copy.deepcopy(exports)
        items = self.project(exports)
        self.assertEqual(items[0]['date_source'], 'introduction')
        self.assertEqual(items[2]['month'], '2026-03')
        self.assertEqual(items[3]['month'], 'undated')
        self.assertEqual(exports, before)

    def test_no_dated_section_or_ambiguous_order_does_not_guess_introduction(self):
        for exports in ([self.placement(10, 'Welcome', 1)],
                        [self.placement(10, 'Welcome', 1), self.placement(20, 'March 2026', 1)]):
            self.assertEqual(self.project(exports)[0]['date_source'], 'undated')

    def test_conflicting_placements_remain_for_review(self):
        item = self.project([self.placement(10, 'March 2026', 1),
                             self.placement(10, 'April 2026', 2)])[0]
        self.assertEqual(item['month'], 'undated')
        self.assertTrue(item['date_needs_review'])

    def test_foreign_course_and_unknown_component_kind_do_not_supply_dates(self):
        item = self.project([self.placement(10, 'March 2026', course=99),
                             self.placement(10, 'April 2026', kind='unknown')])[0]
        self.assertEqual(item['month'], 'undated')

    def test_existing_reporting_dates_progress_scores_and_hours_are_preserved(self):
        record = fixtures.CourseCatalogueTests.record(reporting_month='2026-06',
            reporting_started_at='2026-06-03T10:00:00Z', achieved_score=8, total_score=10)
        before = copy.deepcopy(record)
        item = self.project([self.placement(10, 'March 2026')], [record])[0]
        self.assertEqual((item['month'], item['date']), ('2026-06', '2026-06-03'))
        self.assertEqual((item['actual'], item['quiz_score'], item['completed']), (1, 8, True))
        self.assertEqual(record, before)

    def test_intro_display_does_not_rewrite_historical_record(self):
        record = fixtures.CourseCatalogueTests.record(reporting_month='2026-06',
            reporting_started_at='2026-06-03T10:00:00Z')
        before = copy.deepcopy(record)
        item = self.project([self.placement(10, 'Welcome', 1),
                             self.placement(20, 'March 2026', 2)], [record])[0]
        self.assertEqual(item['date_source'], 'introduction')
        self.assertEqual(item['actual'], 1)
        self.assertEqual(record, before)

    def test_source_link_requires_exact_parent_and_inverse_quiz_link(self):
        parent, quiz = self.definitions[:2]
        parent.update(source_payload={'quiz_id': 10}, material_available=True)
        quiz['source_payload'] = {'activity_id': 10, 'quiz_id': 10}
        item = self.project([])[1]
        self.assertEqual(item['source_material_activity_id'], 'catalogue:50:material:10')
        self.assertFalse(item['can_open_material'])
        self.assertFalse(item['completed'])
        parent['source_payload']['quiz_id'] = 99
        self.assertNotIn('source_material_activity_id', self.project([])[1])
        parent['source_payload']['quiz_id'] = 10
        parent['material_available'] = False
        self.assertNotIn('source_material_activity_id', self.project([])[1])
        parent['source_course_ref'] = '60'
        parent['material_available'] = True
        self.assertNotIn('source_material_activity_id', self.project([])[0])

    def test_export_read_is_scoped_and_contains_no_material_content(self):
        query = Mock(return_value=[])
        read_export_placements(query, self.courses)
        sql, params = query.call_args.args
        self.assertEqual(params, [[50]])
        self.assertIn('course_id=ANY(%s)', sql)
        self.assertNotIn('content_html', sql)
        self.assertNotIn('quiz_definition', sql)


if __name__ == '__main__':
    unittest.main()
