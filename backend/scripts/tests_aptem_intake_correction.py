"""Pure Python tests: no database connections or migrations."""

import copy
import unittest
from datetime import date

from prepare_aptem_intake_correction import intake_start, imported_cohort_id, make_plan, month_before


def fixture():
    snapshot = {'programmes': [{'programme_id': 'P1', 'name': 'Programme One'}],
                'cohorts': [], 'groups': [], 'source': [], 'learners': [], 'enrolments': [], 'modules': []}
    for index, month in enumerate((2, 3, 6, 7, 9, 10), 1):
        start = date(2026, month, 1)
        cid = imported_cohort_id('P1', start)
        gid = f'APTEM-GROUP-{index}'
        name = start.strftime('%b %Y')
        email = f'learner{index}@example.com'
        literal_group = ' Group A – Friday '
        snapshot['cohorts'].append({'cohort_id': cid, 'cohort_name': name, 'start_date': str(start),
                                    'programme_id': 'P1', 'source_type': 'aptem_import', 'deleted_at': None})
        snapshot['groups'].append({'group_id': gid, 'group_name': literal_group, 'cohort_id': cid,
                                   'deleted_at': None, 'module_ids': [], 'module_names': []})
        snapshot['source'].append({'Email': email, 'Start-Date': str(month_before(str(start))), 'Group': literal_group})
        snapshot['learners'].append({'id': index, 'email': email.upper(), 'programme': 'Programme One',
                                     'cohort': name, 'cohort_id': cid, 'group_id': gid, 'group_name': literal_group})
        snapshot['enrolments'].append({'id': index + 100, 'Email': ' ' + email + ' ', 'Programme': 'Programme One',
                                       'Cohort': name, 'Group': literal_group})
    snapshot['groups'][-1].update(module_ids=['MODULE-1'], module_names=['Existing authored module'])
    snapshot['modules'].append({'module_catalogue_id': 'MODULE-1', 'cohort_id': snapshot['cohorts'][-1]['cohort_id'],
                                'cohort_name': 'Oct 2026', 'group_id': 'APTEM-GROUP-6', 'group_name': literal_group})
    return snapshot


class IntakeTests(unittest.TestCase):
    def test_all_twelve_months_including_intake_months(self):
        expected = [(2026, 2), (2026, 2), (2026, 6), (2026, 6), (2026, 6), (2026, 6),
                    (2026, 10), (2026, 10), (2026, 10), (2026, 10), (2027, 2), (2027, 2)]
        for month, (year, intake_month) in enumerate(expected, 1):
            with self.subTest(month=month):
                self.assertEqual(intake_start(date(2026, month, 15)), date(year, intake_month, 1))

    def test_leap_day_and_year_boundary(self):
        self.assertEqual(intake_start('2024-02-29'), date(2024, 2, 1))
        self.assertEqual(intake_start('2025-12-31'), date(2026, 2, 1))

    def test_merge_and_preserve_authored_group(self):
        snapshot = fixture()
        plan = make_plan(snapshot)
        self.assertEqual(len(plan['cohorts']), 3)
        self.assertEqual(len(plan['groups']), 3)
        self.assertEqual(len(plan['archived_cohorts']), 3)
        self.assertEqual(len(plan['archived_groups']), 3)
        self.assertEqual(plan['group_map']['APTEM-GROUP-5'], 'APTEM-GROUP-6')
        self.assertEqual(plan['module_updates'], [])
        self.assertEqual(plan['eligible_enrolment_count'], 6)
        self.assertEqual(plan['eligible_learner_count'], 6)
        self.assertTrue(all(g['group_name'] == ' Group A – Friday ' for g in plan['groups']))
        self.assertEqual(len(plan['learner_updates']), 3)
        self.assertEqual(len(plan['enrolment_updates']), 3)

    def test_content_moves_with_group_when_its_cohort_changes(self):
        snapshot = fixture()
        snapshot['groups'][-1].update(module_ids=[], module_names=[])
        snapshot['groups'][-2].update(module_ids=['MODULE-1'], module_names=['Existing authored module'])
        snapshot['modules'][0].update(group_id='APTEM-GROUP-5', cohort_id=snapshot['cohorts'][-2]['cohort_id'], cohort_name='Sep 2026')
        plan = make_plan(snapshot)
        self.assertEqual(plan['group_map']['APTEM-GROUP-6'], 'APTEM-GROUP-5')
        self.assertEqual(len(plan['module_updates']), 1)
        self.assertEqual(plan['module_updates'][0]['cohort_name'], 'Oct 2026')
        self.assertEqual(plan['module_updates'][0]['group_id'], 'APTEM-GROUP-5')

    def test_programme_scope_separates_identical_group_names(self):
        snapshot = fixture()
        extra = copy.deepcopy(snapshot)
        snapshot['programmes'].append({'programme_id': 'P2', 'name': 'Programme Two'})
        for c, g in zip(extra['cohorts'], extra['groups']):
            c.update(programme_id='P2', cohort_id=imported_cohort_id('P2', c['start_date']))
            g.update(cohort_id=c['cohort_id'], group_id=g['group_id'] + '-P2', module_ids=[], module_names=[])
        snapshot['cohorts'].extend(extra['cohorts'])
        snapshot['groups'].extend(extra['groups'])
        plan = make_plan(snapshot)
        self.assertEqual(len(plan['cohorts']), 6)
        self.assertEqual(len(plan['groups']), 6)

    def test_duplicate_email_stops_planning(self):
        snapshot = fixture()
        snapshot['enrolments'].append({**snapshot['enrolments'][0], 'id': 999})
        with self.assertRaisesRegex(AssertionError, 'Ambiguous enrolment'):
            make_plan(snapshot)

    def test_conflicting_delivery_details_stop_merge(self):
        snapshot = fixture()
        snapshot['groups'][0]['session_week_day'] = 'Monday'
        snapshot['groups'][1]['session_week_day'] = 'Friday'
        with self.assertRaisesRegex(AssertionError, 'Conflicting session_week_day'):
            make_plan(snapshot)

    def test_changed_source_date_or_group_stops_correction(self):
        for field, value in [('Start-Date', '2026-07-01'), ('Group', 'Another group')]:
            snapshot = fixture()
            snapshot['source'][0][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError):
                make_plan(snapshot)


if __name__ == '__main__':
    unittest.main()
