"""Progress KSB regressions: no Django startup, database writes or network."""
import ast
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from learner_api.aptem_ksb_breakdown import build_progress_breakdown, read_breakdown, read_learner_breakdown


class ProgressKsbBreakdownTests(unittest.TestCase):
    def entry(self, id=1, **changes):
        return dict(dict(id=id, learner_id=315, ksb_code='K1', ksb_description='Knowledge',
                         component_title='Synthetic activity', activity_status='completed',
                         accepted=True, deleted_at=None, source_system='new_lms'), **changes)

    def test_distinct_codes_and_at_least_one_completed_accepted_row(self):
        first = self.entry()
        entries = [first, first, self.entry(2, activity_status='in_progress'),
                   self.entry(3, ksb_code='S1', accepted=False),
                   self.entry(4, ksb_code='S1', accepted=None),
                   self.entry(5, ksb_code='B1', activity_status='Completed'),
                   self.entry(6, ksb_code='B1', activity_status='passed'),
                   self.entry(7, ksb_code='K99', deleted_at='2026-01-01'),
                   self.entry(8, ksb_code='K98', learner_id=316)]
        result = build_progress_breakdown(315, entries)
        self.assertEqual((result['totalKsbs'], result['achievedKsbs'], result['remainingKsbs']), (3, 1, 2))
        self.assertEqual([r['code'] for r in result['rows']], ['K1', 'S1', 'B1'])
        self.assertEqual(result['rows'][0]['completed'], 1)
        self.assertEqual(len(result['rows'][0]['components']), 2)
        self.assertEqual(result['rows'][1]['status'], 'Not Achieved')

    def test_source_kind_programme_and_aptem_id_do_not_filter_coverage(self):
        entries = [self.entry(i, ksb_code=f'K{i}', source_system=source,
                             kind=kind, aptem_id=aptem_id, programme_id=None)
                   for i, (source, kind, aptem_id) in enumerate([
                       ('new_lms', 'component', None), ('old_lms', 'quiz', 4110),
                       ('journal', 'feed', 9999), ('aptem', 'attendance', None),
                       ('', 'live_session', 4110), (None, None, None)], 1)]
        result = build_progress_breakdown(315, entries)
        self.assertEqual((result['totalKsbs'], result['achievedKsbs'], result['remainingKsbs']), (6, 6, 0))
        self.assertEqual(result['source'], 'progress')

    def test_deleted_completed_row_cannot_achieve_an_active_pending_code(self):
        result = build_progress_breakdown(315, [self.entry(1, accepted=False),
            self.entry(2, deleted_at='2026-01-01')])
        self.assertEqual((result['totalKsbs'], result['achievedKsbs'], result['remainingKsbs']), (1, 0, 1))

    def test_no_progress_returns_zero_without_legacy_mapping_error(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.side_effect = [[(315,)], []]
        result = read_learner_breakdown(connection, 190)
        self.assertEqual((result['totalKsbs'], result['achievedKsbs'], result['remainingKsbs']), (0, 0, 0))
        self.assertEqual(result['rows'], [])

    def test_stored_codes_remain_distinct_without_normalization(self):
        entries = [self.entry(i, ksb_code=code) for i, code in enumerate(['K1', 'k1', ' K1 ', '', None])]
        result = build_progress_breakdown(315, entries)
        self.assertEqual(result['totalKsbs'], 4)
        self.assertEqual([r['code'] for r in result['rows']], ['K1', 'k1', ' K1 ', ''])

    def test_reader_uses_only_joined_progress_for_primary_learner_id(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [[(315,)], [
            (1, 315, 'Completed activity', 'completed', True, None, 'old_lms', 'K1', 'Knowledge'),
            (2, 315, 'Pending activity', 'in_progress', False, None, 'new_lms', 'S1', 'Skill')]]
        result = read_learner_breakdown(connection, 190)
        self.assertEqual((result['totalKsbs'], result['achievedKsbs'], result['remainingKsbs']), (2, 1, 1))
        calls = cursor.execute.call_args_list
        self.assertEqual(calls[0].args[1], [190])
        self.assertEqual(calls[1].args[1], [315])
        sql = calls[1].args[0]
        self.assertIn('k.progress_id=p.id', sql)
        self.assertEqual(sql.split('WHERE')[1].split('ORDER BY')[0].strip(),
                         'p.learner_id=%s AND p.deleted_at IS NULL')
        for call in calls:
            self.assertTrue(call.args[0].startswith('SELECT'))
            for forbidden in ['aptem_id', 'Aptem_users', 'aptem_component_ksbs', 'curriculum.', 'legacy_aptem_component']:
                self.assertNotIn(forbidden, call.args[0])

    def test_evidence_reader_matches_only_exact_code_and_returns_point_metadata(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            (1, 315, 'Unrelated title', 'passed', True, None, 'new_lms', 'B1', 'Behaviour',
             'reading', 'component', 'Synthetic module', '2026-10-01', None)]
        result = read_breakdown(connection, 315, code='B1')
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [315, 'B1'])
        self.assertIn('AND k.ksb_code=%s', sql)
        for fuzzy in ('ILIKE', 'LIKE', 'lower(', 'component_title='):
            self.assertNotIn(fuzzy, sql)
        row = result['rows'][0]
        self.assertEqual((row['pointsAchieved'], row['totalPoints'], row['progressPercent']), (1, 1, 100))
        self.assertEqual(row['components'][0]['type'], 'reading')
        self.assertEqual(row['components'][0]['module'], 'Synthetic module')
        self.assertTrue(row['components'][0]['accepted'])
        pending = build_progress_breakdown(315, [self.entry(2, accepted=False, submitted_at='2026-10-02')])['rows'][0]['components'][0]
        self.assertEqual(pending['date'], '2026-10-02')
        self.assertIsNone(pending['completedAt'])

    def test_diagnostic_entrypoint_takes_primary_id_without_aptem_lookup(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        self.assertEqual(read_breakdown(connection, 315)['totalKsbs'], 0)
        self.assertEqual(cursor.execute.call_args.args[1], [315])
        self.assertEqual(cursor.execute.call_count, 1)

    def test_missing_or_ambiguous_authorized_identity_is_still_rejected(self):
        for owners in [[], [(315,), (316,)]]:
            connection = MagicMock()
            connection.cursor.return_value.__enter__.return_value.fetchall.return_value = owners
            with self.assertRaisesRegex(ValueError, 'identity'):
                read_learner_breakdown(connection, 190)

    def test_metrics_view_reads_identity_from_authorized_source(self):
        # Execute the endpoint body without Django startup or a DB test runner.
        # Its existing authentication decorators remain untouched in production.
        tree = ast.parse(Path(__file__).with_name('dashboard_metrics.py').read_text())
        endpoint = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'learner_metrics')
        self.assertEqual([ast.unparse(item) for item in endpoint.decorator_list],
                         ['require_GET', "learner_self_or_staff(kwarg='pk')", 'journal_sources.learner_journal_view'])
        endpoint.decorator_list = []
        source = SimpleNamespace(pk=125, aptem_id=1055)
        model = MagicMock()
        model.DoesNotExist = type('DoesNotExist', (Exception,), {})
        model.all_learners.only.return_value.get.return_value = source
        connection = object()
        measurement = SimpleNamespace(stage=lambda *args: nullcontext())
        scope = dict(__package__='learner_api', SOURCE_MODELS={'apprenticeship': model},
                     JsonResponse=lambda payload, **kwargs: dict(payload),
                     measure_projection=lambda *args, **kwargs: nullcontext(measurement),
                     connections={'enrolment': connection})
        exec(compile(ast.Module(body=[endpoint], type_ignores=[]), 'endpoint', 'exec'), scope)
        request = SimpleNamespace(GET={'view': 'coach-ksb-breakdown', 'aptem_id': '1056'})
        with patch('learner_api.aptem_ksb_breakdown.read_learner_breakdown', return_value={'rows': []}) as reader:
            response = scope['learner_metrics'](request, 'apprenticeship', 125)
        reader.assert_called_once_with(connection, 125)
        model.all_learners.only.return_value.get.assert_called_once_with(pk=125)
        self.assertEqual(response['Cache-Control'], 'private, no-store')




if __name__ == '__main__':
    unittest.main()
