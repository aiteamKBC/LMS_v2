"""Completion/month repairs exercised with production projection code and synthetic data."""
from argparse import Namespace
from copy import deepcopy
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

import finalize_confirmed_course_progress as repair
from learner_api.course_catalogue_display import catalogue_display_context


def fixture():
    course = {'id': 50, 'source_course_ref': '50', 'source_course_title': 'Synthetic course',
              'curriculum_module_ref': 'M'}
    owners = [dict(id=i, enrolment_id=i, programme_id=5, aptem_id=i) for i in (1, 2)]
    definitions = [dict(id=i, source_course_id=50, source_course_ref='50',
        source_course_title='Synthetic course', curriculum_module_ref='M',
        source_activity_id=f'material:{i}', source_activity_title=f'Synthetic activity {i}',
        source_activity_type='reading', source_position=i, source_section_ref='',
        source_section_title='March 2026' if i in (1, 2) else '', deleted_at=None,
        curriculum_component_ref=None,
        source_payload={'recovery_run_id': 7, 'live_catalogue_recovery': {'section_id': 0}})
        for i in (1, 2, 3, 4)]
    definitions = catalogue_display_context(definitions, [])
    records, sources = [], []
    for owner in (1, 2):
        records.append(dict(id=owner * 100, learner_id=owner, entry_order=1,
            deleted_at=None, accepted=True, actual_seconds=1800, activity_status='completed',
            source_system='journal', source_activity_id='material:1', component_ref='material:1',
            kind='reading', source_payload={}, reporting_month='2026-03',
            reporting_started_at=None, reporting_ended_at=None))
        sources.append(dict(id=owner * 100, learner_id=owner, source_system='old_lms',
            source_activity_id='material:1', source_course_ref='50', source_catalog_activity_id=1,
            canonical_progress_id=owner * 100, completed=True, deleted_at=None))
    # London has entered summer time: this completion belongs to April locally.
    at = datetime(2026, 3, 31, 23, 30, tzinfo=timezone.utc)
    records.append(dict(id=101, learner_id=1, entry_order=2, deleted_at=None, accepted=False,
        actual_seconds=None, activity_status='completed', source_system='old_lms',
        source_activity_id='material:3', component_ref='material:3', kind='reading',
        sync_run_id=7, submitted_at=at, reporting_month='', reporting_started_at=None,
        reporting_ended_at=None, source_payload={'live_completion_recovery': {'component': {
            'component_id': 3, 'completed': True, 'completed_at': at.isoformat()}}}))
    sources.append(dict(id=101, learner_id=1, source_system='old_lms', source_activity_id='material:3',
        source_course_ref='50', source_catalog_activity_id=3, canonical_progress_id=101,
        completed=True, deleted_at=None, accepted=False, actual_seconds=None,
        reporting_month='', reporting_started_at=None, reporting_ended_at=None,
        source_payload=deepcopy(records[-1]['source_payload'])))
    state = dict(course=course, owner=owners[0], owners=owners, definitions=definitions,
        progress=records, sources=sources, segments=[], journals=[], identities=[],
        memberships=[], export={}, snapshot={}, accepted_totals=[], last_order=2,
        source_routes=[{'id': i, 'source_course_ref': '50'} for i in (1, 3)],
        dependencies=[{'id': 4, 'source_links': 0, 'history_links': 0}])
    args = Namespace(course_id=50, aptem_id=1, recovery_run_id=7,
        confirm_material_ids=[2], date_material_ids=[3], rollback_material_ids=[4],
        confirmation_note='Owner confirmed the selected reading was completed.')
    return state, args


def stored_result(state, args, plan):
    """Exercise actual write construction in memory; no connection or SQL execution."""
    after = deepcopy(state)
    insertions = []

    def capture_insert(cur, table, row):
        plain = {k: getattr(v, 'obj', v) for k, v in row.items()}
        ident = 500 + len(insertions)
        insertions.append((table, plain))
        if table in ('learner_progress_entries', 'learner_activity_sources'):
            collection = 'progress' if table == 'learner_progress_entries' else 'sources'
            after[collection].append({**plain, 'id': ident, 'deleted_at': None})
            if collection == 'sources':
                after['source_routes'].append({'id': plain['source_catalog_activity_id'], 'source_course_ref': '50'})
        return ident

    class Cursor:
        rowcount = 1

        def execute(self, sql, params):
            if 'reporting_month=%s' in sql:
                collection = 'progress' if 'learner_progress_entries' in sql else 'sources'
                row = next(r for r in after[collection] if r['id'] == params[4])
                row.update(zip(repair.DATE_FIELDS, params[:3]))
                row['source_payload'].update(params[3].obj)
                self.rowcount = 1
            elif 'UPDATE curriculum.source_activities' in sql:
                for row in after['definitions']:
                    if row['id'] in params[1]:
                        row['deleted_at'] = 'archived'
                self.rowcount = len(params[1])
            else:
                raise AssertionError('Unexpected mutation')

    with patch.object(repair, 'insert', side_effect=capture_insert):
        repair.apply_plan(Cursor(), state, plan, args, 'synthetic-fingerprint')
    return after, insertions


class ConfirmedCourseProgressTests(unittest.TestCase):
    def setUp(self):
        for target in ('psycopg.connect', 'urllib.request.OpenerDirector.open'):
            guard = patch(target, side_effect=AssertionError('External access forbidden'))
            guard.start()
            self.addCleanup(guard.stop)
        self.state, self.args = fixture()

    def test_confirmation_is_owned_and_does_not_fabricate_hours_dates_or_source_proof(self):
        original = deepcopy(self.state)
        plan = repair.make_plan(self.state, self.args)
        after, insertions = stored_result(self.state, self.args, plan)
        actual = repair.verify(self.state, after, plan)
        self.assertEqual(len(repair.completion_set(actual[1])), 3)
        self.assertEqual(len(repair.completion_set(actual[2])), 1)
        self.assertEqual([actual[i]['accepted_hours'] for i in (1, 2)], [0.5, 0.5])
        confirmed = next(row for table, row in insertions if table == 'learner_progress_entries')
        self.assertEqual(confirmed['source_system'], 'staff_confirmation')
        self.assertFalse(confirmed['accepted'])
        self.assertIsNone(confirmed['actual_seconds'])
        for field in ('started_at', 'submitted_at', 'reporting_started_at', 'achieved_score'):
            self.assertNotIn(field, confirmed)
        proof = confirmed['source_payload']['owner_completion_confirmation']
        self.assertFalse(proof['completion_timestamp_known'])
        self.assertFalse(proof['actual_study_time_verified'])
        self.assertEqual(self.state, original)

    def test_saved_reporting_month_respects_london_without_inventing_a_course_date(self):
        plan = repair.make_plan(self.state, self.args)
        self.assertEqual(plan['dates'][0]['fields']['reporting_month'], '2026-04')
        # My Learning now uses curriculum/original-upload dates, not the ledger
        # month. This fixture deliberately has neither for material:3.
        self.assertEqual(repair.monthly(plan['after'][1]), {
            '2026-03': {'completed': 2, 'total': 2}, 'undated': {'completed': 1, 'total': 1}})
        after, _ = stored_result(self.state, self.args, plan)
        again = repair.make_plan(after, self.args)
        self.assertEqual([again[k] for k in ('archive', 'dates', 'confirm')], [[], [], []])

    def test_rejects_month_repair_for_accepted_timed_or_conflicting_records(self):
        for changes in ({'accepted': True}, {'actual_seconds': 30}, {'reporting_month': '2026-02'},
                        {'sync_run_id': 8}, {'learner_id': 2}, {'submitted_at': None}):
            with self.subTest(changes=changes):
                state = deepcopy(self.state)
                state['progress'][-1].update(changes)
                with self.assertRaises(ValueError):
                    repair.make_plan(state, self.args)

    def test_rollback_refuses_native_references_prior_runs_or_any_source_history(self):
        for field, value in (('source_links', 1), ('history_links', 1)):
            with self.subTest(field=field):
                state = deepcopy(self.state)
                state['dependencies'][0][field] = value
                with self.assertRaisesRegex(ValueError, 'unused unsectioned'):
                    repair.make_plan(state, self.args)
        for changes in ({'curriculum_component_ref': 'NATIVE'}, {'source_payload': {'recovery_run_id': 6}},
                        {'source_payload': {'recovery_run_id': 7, 'live_catalogue_recovery': {'section_id': 2}}}):
            with self.subTest(changes=changes):
                state = deepcopy(self.state)
                state['definitions'][-1].update(changes)
                with self.assertRaisesRegex(ValueError, 'unused unsectioned'):
                    repair.make_plan(state, self.args)

    def test_rollback_refuses_another_learners_journal_result(self):
        self.state['progress'][1]['source_payload'] = {'original_source_ref': 'la:50:4'}
        self.state['sources'] = [s for s in self.state['sources'] if s['learner_id'] != 2]
        with self.assertRaisesRegex(ValueError, 'existing learner evidence'):
            repair.make_plan(self.state, self.args)

    def test_verification_rejects_source_evidence_rewrite_and_unrelated_additions(self):
        plan = repair.make_plan(self.state, self.args)
        after, _ = stored_result(self.state, self.args, plan)
        after['progress'][-2]['source_payload']['live_completion_recovery']['component']['completed'] = False
        with self.assertRaisesRegex(ValueError, 'Original source evidence changed'):
            repair.verify(self.state, after, plan)
        after, _ = stored_result(self.state, self.args, plan)
        after['journals'].append({'id': 99})
        with self.assertRaisesRegex(ValueError, 'Unexpected record additions'):
            repair.verify(self.state, after, plan)


if __name__ == '__main__':
    unittest.main()
