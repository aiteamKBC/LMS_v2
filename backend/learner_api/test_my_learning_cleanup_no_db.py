"""Execute production projections with synthetic facts; no Django startup or DB."""
import ast
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class MyLearningScheduleTests(unittest.TestCase):
    def test_combined_schedule_omits_unused_readers_and_batches_session_counts(self):
        path = Path(__file__).with_name('training_plan_dashboard.py')
        node = next(n for n in ast.parse(path.read_text(encoding='utf-8')).body
                    if isinstance(n, ast.FunctionDef) and n.name == 'read_dashboard')
        cursor = Mock()
        connection = Mock()
        connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
        connection.cursor.return_value.__exit__ = Mock(return_value=False)
        forbidden = Mock(side_effect=AssertionError('Unrelated projection was read'))
        canonical = SimpleNamespace(targets_for=forbidden, entries_for=Mock(return_value=[]))
        module = {'id': 'M1', 'title': 'One', 'educational_session_count': 0,
                  'description': 'unused', 'learning_outcomes': []}
        scope = dict(__package__='learner_api', defaultdict=defaultdict,
            datetime=datetime, timezone=timezone, canonical_learning=canonical, date_only=lambda v: v,
            LearnerProfile=SimpleNamespace(objects=forbidden), connections={'enrolment': connection},
            plan_module_ids=Mock(return_value=(['M1'], {})),
            rows=Mock(side_effect=[[{'id': 'M1'}], [dict(id='W1', module_catalogue_id='M1',
                week_number=1, title='Teaching', learning_outcomes=[], live_session_count=2,
                holiday_note_enabled=False, holiday_note='')]]),
            plan_module=Mock(return_value=module), clean_text=str, as_list=lambda v: v,
            is_educational_live_session_week=lambda title: True,
            visible_child_sql=lambda alias: f'{alias}.deleted_at IS NULL',
            visible_week_sql=lambda alias: f'{alias}.deleted_at IS NULL',
            attach_curriculum_slots=Mock(), plan_sessions=Mock(return_value=[{'id': 'S1'}]),
            _canonical_module_progress=Mock(return_value={'M1': {'hours': {'actual': 1}}}),
            _canonical_actual_rows=forbidden, current_coach=forbidden, plan_reviews=forbidden)
        hours = ModuleType('learner_api.weekly_hours')
        hours.module_activity_hours = forbidden
        live = ModuleType('learner_api.live_session_progress')
        live.read_live_credits = Mock(return_value=[])
        live.supplement_module_hours = Mock(side_effect=lambda progress, *args: progress)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), scope)
        with patch.dict(sys.modules, {'learner_api.weekly_hours': hours, 'learner_api.live_session_progress': live}):
            result = scope['read_dashboard'](SimpleNamespace(pk=1, email='synthetic@example.test',
                _canonical_profile={'id': 2}), section='my-learning')
        self.assertEqual(set(result), {'modules', 'moduleLinks', 'sessions', 'moduleProgress', 'generatedAt'})
        self.assertEqual(result['modules'][0]['educational_session_count'], 2)
        self.assertNotIn('description', result['modules'][0])
        self.assertEqual(result['moduleProgress']['M1']['hours']['actual'], 1)
        self.assertEqual(cursor.execute.call_count, 2)
        sql, params = cursor.execute.call_args.args
        self.assertIn('GROUP BY c.module_catalogue_id,c.week_id', sql)
        self.assertEqual(params, [['M1'], ['M1']])
        canonical.entries_for.assert_called_once_with({'id': 2}, lineage_only=True)
        forbidden.assert_not_called()


class MyLearningCatalogueTests(unittest.TestCase):
    def test_cover_read_is_scoped_and_never_aggregates_attempts(self):
        path = Path(__file__).with_name('subject_store.py')
        node = next(n for n in ast.parse(path.read_text(encoding='utf-8')).body
                    if isinstance(n, ast.FunctionDef) and n.name == 'covers_for')
        cursor = Mock()
        cursor.fetchall.return_value = [('legacy:5', 'cover.png')]
        connection = Mock()
        connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
        connection.cursor.return_value.__exit__ = Mock(return_value=False)
        scope = dict(connections={'enrolment': connection}, ALIAS='enrolment',
                     COVERS='covers', ready=Mock(return_value=True))
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), scope)
        self.assertEqual(scope['covers_for']([]), {})
        connection.cursor.assert_not_called()
        self.assertEqual(scope['covers_for'](['legacy:5', 'legacy:5']), {'legacy:5': 'cover.png'})
        cursor.execute.assert_called_once_with(
            'SELECT subject_ref,storage_path FROM covers WHERE subject_ref=ANY(%s)', [['legacy:5']])

    def test_optional_ledger_is_not_calculated_and_reuses_verified_owner(self):
        from backend.learner_api.test_canonical_learning_no_db import adapter
        query = Mock(return_value=[])
        scope = adapter(query)
        owner = {'id': 2, 'name': 'Synthetic learner', 'aptem_id': 3,
                 'programme_planned_hours': 12}
        scope['profile'] = Mock(side_effect=AssertionError('Owner resolved twice'))
        scope['otjh_activities'] = Mock(return_value=[{'id': 'record:1'}])
        from learner_api.journal_sources import learner_journal_reads
        with learner_journal_reads():
            compact = scope['source_subjects'](1, lambda items: {'activities': items},
                owner=owner, records=[], include_ledger=False)
            scope['otjh_activities'].assert_not_called()
            full = scope['source_subjects'](1, lambda items: {'activities': items}, owner=owner, records=[])
        self.assertEqual(compact['audit_tp_planned'], 12)
        self.assertNotIn('canonical_otjh_activities', compact)
        self.assertEqual(full.pop('canonical_otjh_activities'), [{'id': 'record:1'}])
        self.assertEqual(compact, full)
        scope['profile'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
