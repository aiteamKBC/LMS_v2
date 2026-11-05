"""Schedule recovery regressions with synthetic input and no external access."""
from copy import deepcopy
import unittest
from unittest.mock import patch

import reconcile_legacy_activity_dates as dates
import reconcile_legacy_learning as r
from learner_api.course_catalogue_display import catalogue_display_context


class DateRecoveryTests(unittest.TestCase):
    def setUp(self):
        for target in ('psycopg.connect', 'urllib.request.OpenerDirector.open'):
            guard = patch(target, side_effect=AssertionError('External access forbidden'))
            guard.start()
            self.addCleanup(guard.stop)
        self.row = {'id': 1, 'source_course_id': 10, 'source_course_ref': '50',
            'source_activity_id': 'material:91', 'source_activity_title': 'Lesson',
            'source_section_ref': '4', 'source_section_title': 'Data to Decisions',
            'source_payload': {'quiz_id': 12}, '_row_hash': 'original'}
        self.fact = {'created_at_utc': '2026-03-14T09:33:13+00:00',
                     'source_section_ref': '4', 'source_section_title': 'Data to Decisions'}
        self.evidence = {('50', 'material:91'): [self.fact]}

    def test_four_restored_components_inherit_their_verified_original_month(self):
        rows = [{**deepcopy(self.row), 'id': i, 'source_activity_id': f'material:{90+i}'} for i in range(1, 5)]
        evidence = {('50', row['source_activity_id']): [self.fact] for row in rows}
        before = deepcopy(rows)
        plan = dates.make_plan(rows, [], evidence)
        self.assertEqual(len(plan), 4)
        self.assertEqual({p['schedule']['month'] for p in plan}, {'2026-03'})
        self.assertEqual(rows, before)
        for row in rows:
            row['source_payload']['created_at_utc'] = self.fact['created_at_utc']
        self.assertEqual(dates.make_plan(rows, [], evidence), [])

    def test_exact_course_and_component_type_are_required(self):
        for key in [('51', 'material:91'), ('50', 'quiz:91')]:
            self.assertEqual(dates.make_plan([self.row], [], {key: [self.fact]}), [])

    def test_conflicting_original_dates_are_not_guessed(self):
        self.evidence[('50', 'material:91')].append({**self.fact, 'created_at_utc': '2026-04-14T09:33:13+00:00'})
        self.assertEqual(dates.make_plan([self.row], [], self.evidence), [])

    def test_confirmed_source_lecture_precedes_original_upload(self):
        self.row['source_section_title'] = ''
        self.evidence[('50', 'material:91')][0]['source_section_title'] = 'Lecture 9/7/2026'
        plan = dates.make_plan([self.row], [], self.evidence)
        self.assertEqual(plan[0]['schedule']['month'], '2026-07')

    def test_existing_lecture_and_introduction_placements_are_preserved(self):
        for title in ('Lecture 9/7/2026', 'Introduction'):
            self.row['source_section_title'] = title
            self.assertEqual(dates.make_plan([self.row], [], self.evidence), [])

    def test_no_completion_or_import_date_substitutes_for_original_upload(self):
        self.row['source_payload'] = {'completed_at': '2026-10-01', 'first_seen_at': '2026-10-02'}
        self.assertEqual(dates.make_plan([self.row], [], {}), [])

    def test_unresolved_export_sections_can_use_verified_original_upload(self):
        exports = [{'course_id': '50', 'component_id': '91', 'component_kind': 'lesson',
                    'section_id': str(i), 'section_order': str(i), 'section_title': title}
                   for i, title in enumerate(('March 2026', 'April 2026'), 1)]
        plan = dates.make_plan([self.row], exports, self.evidence)
        self.assertEqual(plan[0]['schedule']['date'], '2026-03-14')
        self.assertEqual(plan[0]['schedule']['date_source'], 'original_created_at')

    def test_source_timezone_is_converted_before_london_month_grouping(self):
        for value in ('2026-03-31 23:30:00', '2026-03-31T23:30:00Z'):
            upload = r.original_upload_metadata({'created_at': value}, '+00:00')
            self.row['source_payload'].update(upload)
            result = catalogue_display_context([self.row], [])[0]
            self.assertEqual(result['_display_schedule']['month'], '2026-04')
        for value, zone in [('0000-00-00', '+00:00'), ('2026-02-30', '+00:00'), ('2026-03-31 23:30:00', None)]:
            self.assertEqual(r.original_upload_metadata({'created_at': value}, zone), {})

    def test_shared_source_accounts_require_consistent_upload_evidence(self):
        source = {'50': {'timezone': '+00:00', 'facts': {'material:91': {'created_at': '2026-03-14 09:33:13'}}}}
        evidence = dates.schedule_evidence({1: source, 2: deepcopy(source)})
        self.assertEqual(len(evidence[('50', 'material:91')]), 1)


if __name__ == '__main__':
    unittest.main()
