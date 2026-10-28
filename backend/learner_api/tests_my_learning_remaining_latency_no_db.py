"""Read budgets and canonical parity for the remaining measured latency work."""
from copy import deepcopy
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase
from . import teams_attendance as teams, learner_detail, canonical_learning as canonical
from .current_learning import is_unsynchronised_direct_save


class RemainingLatencyTests(SimpleTestCase):
    def test_reviewed_alias_and_identity_link_reads_are_one_select(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('alias','M1','alias@example.test','learner@example.test'),
                                       ('link','O1','A1','learner@example.test')]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(teams, 'connections', {'enrolment':connection}):
            aliases, links = teams._attendance_review_rows('enrolment', ['M1'], ['O1'])
        self.assertEqual(aliases, [('M1','alias@example.test','learner@example.test')])
        self.assertEqual(links, [('O1','A1','learner@example.test')])
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertEqual(cursor.execute.call_args.args[1], [['M1'], ['O1']])
        self.assertIn('UNION ALL', cursor.execute.call_args.args[0])

    def test_missing_optional_review_table_preserves_independent_fallbacks(self):
        error = DatabaseError('synthetic missing table')
        error.sqlstate = '42P01'
        cursor = MagicMock()
        cursor.execute.side_effect = error
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(teams, 'connections', {'enrolment':connection}), \
             patch.object(teams, '_attendance_alias_rows', return_value=[('M1','a','b')]) as aliases, \
             patch.object(teams, '_attendance_identity_link_rows', return_value=[]) as links:
            self.assertEqual(teams._attendance_review_rows('enrolment',['M1'],['O1']), ([('M1','a','b')],[]))
        aliases.assert_called_once_with('enrolment',['M1'])
        links.assert_called_once_with('enrolment',['O1'])

    def test_transport_and_permission_errors_do_not_become_empty_evidence(self):
        cursor = MagicMock()
        cursor.execute.side_effect = DatabaseError('synthetic failure')
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(teams, 'connections', {'enrolment':connection}), \
             patch.object(teams, '_attendance_alias_rows') as fallback:
            with self.assertRaises(DatabaseError):
                teams._attendance_review_rows('enrolment',['M1'],['O1'])
        fallback.assert_not_called()

    def native(self, batched, duplicate=False, cached=None):
        component = ('C1','W1','M1','quiz','Final test','',{'linkedQuizId':10},None,0,None,False,None,False)
        cursor = MagicMock()
        metadata = ('C1',10,10,'Final test',5,20,'minutes')
        if batched:
            cursor.fetchall.side_effect = [[component], [metadata, metadata] if duplicate else [metadata]] + (
                [[('C1',10)], [(10,'Final test',5,20,'minutes')]] if duplicate else [])
        else:
            cursor.fetchall.side_effect = [[component], [('C1',10)], [(10,'Final test',5,20,'minutes')]]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        resolved = {'module_titles':{'M1':'Module'}, 'weeks':[('W1','M1','Week 1',1,0)]}
        if cached is not None:
            resolved['quiz_meta'] = cached
        with patch.object(learner_detail,'connections',{'enrolment':connection}):
            _, _, components = learner_detail._resolve_from_master([],[],[],assigned_modules=[{'moduleId':'M1'}],
                identities_only=True,catalogue_facts=batched,live_session_ids=False,resolved_metadata=resolved,strict=True)
        return components, cursor

    def test_native_quiz_links_and_metadata_use_two_selects_instead_of_three(self):
        before, old = self.native(False)
        after, new = self.native(True)
        self.assertEqual(old.execute.call_count, 3)
        self.assertEqual(new.execute.call_count, 2)
        for key in ('componentId','isQuiz','quizMeta','moduleId','weekId'):
            self.assertEqual(before[0][key], after[0][key])
        self.assertEqual(after[0]['quizMeta']['questions'], 5)

    def test_joined_quiz_read_retains_already_resolved_request_metadata(self):
        cached = {10:{'quizId':10,'title':'Request-local title','questions':99,'duration':20,'timeUnit':'minutes'}}
        actual, _ = self.native(True, cached=cached)
        self.assertEqual(actual[0]['quizMeta'], cached[10])

    def test_duplicate_quiz_links_keep_original_reader_and_metadata(self):
        expected, _ = self.native(False)
        actual, cursor = self.native(True, duplicate=True)
        self.assertEqual(actual[0]['quizMeta'], expected[0]['quizMeta'])
        self.assertEqual(cursor.execute.call_count, 4)  # Probe plus unchanged fallback.
        self.assertIn('SELECT link.component_id, link.quiz_id', cursor.execute.call_args_list[2].args[0])

    def test_segment_presence_preserves_direct_save_and_accepted_hour_rules(self):
        for accepted in (False, True):
            for seconds in (None, 0, 3600):
                for count in (0, 1, 100):
                    row = {'id':1, 'kind':'component', 'component_ref':'C1','component_type':'reading',
                        'time_tracking_source':'direct', 'source_system':'', 'accepted':accepted,
                        'actual_seconds':seconds,'segments':[{'id':i} for i in range(count)]}
                    projected = {**deepcopy(row), 'segments':[{}] if count else []}
                    self.assertEqual(is_unsynchronised_direct_save(row), is_unsynchronised_direct_save(projected))
                    self.assertEqual(canonical.counts_as_actual(row), canonical.counts_as_actual(projected))
                    self.assertEqual(canonical.recorded_seconds(row), canonical.recorded_seconds(projected))

    def test_only_catalogue_collapses_segment_ids_and_keeps_learner_scope(self):
        with patch.object(canonical,'query',return_value=[]) as query, \
             patch.object(canonical,'current_records',return_value=[]), \
             patch.object(canonical,'_ksb_not_excluded',return_value='TRUE'):
            canonical.entries_for({'id':9},catalogue_summary=True)
            catalogue, catalogue_params = query.call_args.args
            canonical.entries_for({'id':9},training_summary=True)
            other, other_params = query.call_args.args
        self.assertIn("'[{}]'::jsonb AS payload", catalogue)
        self.assertNotIn('jsonb_agg(jsonb_build_object(\'id\',s.id)',catalogue)
        self.assertIn('p.learner_id=s.learner_id',catalogue)
        self.assertIn('progress.learner_id=%s',catalogue)
        self.assertEqual(catalogue_params,[9,9,9,9])
        self.assertEqual(other_params,[9])
        self.assertNotIn('WHERE j.canonical_learner_id=%s',other)
        self.assertIn("jsonb_agg(jsonb_build_object('id',s.id)",other)

    def test_shared_result_read_is_scoped_to_relevant_occurrences(self):
        from curriculum_api import session_results
        with patch.object(session_results,'read',return_value=[]) as read:
            self.assertEqual(session_results.result_rows({'id':'S1'},attendance_only=True,
                occurrence_ids=['O2','O1','O1']), [])
        read.assert_called_once_with('SELECT * FROM curriculum.live_session_occurrences WHERE live_session_id=%s AND id=ANY(%s) ORDER BY session_number,id', ['S1',['O1','O2']])
