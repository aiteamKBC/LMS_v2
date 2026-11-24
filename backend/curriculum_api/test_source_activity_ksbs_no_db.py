"""Source selection, exact version selection and maintenance boundary regressions."""
from types import SimpleNamespace
import json
from unittest.mock import MagicMock, patch

from django.core.management.base import CommandError
from django.test import RequestFactory
from unittest import TestCase

from curriculum_api import ksb_mapping_placement as mappings
from curriculum_api.source_activity_ksbs import relation
from curriculum_api.management.commands.add_source_activity_ksb import Command
from learner_api import journal_sources
from manual_audit_api import plan_pickers


class SourceKsbTests(TestCase):
    def test_roles_share_activity_source_without_changing_historical_overrides_or_hours(self):
        names = ('activity_ksbs',)
        coach = [journal_sources.table(name) for name in names]
        with journal_sources.learner_journal_reads():
            self.assertEqual(coach, [journal_sources.table(name) for name in names])
        self.assertIn('source_activity_ksbs_normalized', coach[0])
        self.assertIn('standard_ksbs', coach[0])
        self.assertEqual(journal_sources.table('learner_journal_row_ksbs'),
                         'structured_manual_activities.learner_journal_row_ksbs')
        self.assertEqual(journal_sources.table('manual_learner_activities'),
                         'structured_manual_activities.manual_learner_activities')

    def test_retained_coach_sql_uses_same_canonical_ksbs(self):
        query = 'SELECT k.ksbs FROM structured_manual_activities.activity_ksbs k'
        coach = journal_sources.retained_journal_sql(query)
        with journal_sources.learner_journal_reads():
            self.assertEqual(coach, journal_sources.retained_journal_sql(query))
        self.assertNotIn('structured_manual_activities.activity_ksbs', coach)

    def test_scope_accepts_only_trusted_column_syntax(self):
        with self.assertRaises(ValueError):
            relation('1; DELETE FROM anything')

    def test_command_does_not_open_database_without_explicit_apply(self):
        with patch('curriculum_api.management.commands.add_source_activity_ksb.connections') as connections:
            with self.assertRaises(CommandError):
                Command().handle(apply=False)
            connections.__getitem__.assert_not_called()

    def test_metrics_authentication_and_ownership_run_before_cache(self):
        from learner_api.dashboard_metrics import learner_metrics
        from learner_api import response_cache
        for kind in ('commercial','apprenticeship'):
            for account, status in ((None,401),
                    (SimpleNamespace(role='learner',subject_type='learner',subject_id=99),404)):
                request = RequestFactory().get(f'/learner_api/dashboard/{kind}/7/metrics/')
                with patch('login.permissions._auth_gate_enabled',return_value=True), \
                     patch('login.permissions.authenticate_request',return_value=account), \
                     patch.object(response_cache.cache,'get') as cached:
                    self.assertEqual(learner_metrics(request,kind=kind,pk=7).status_code,status)
                    cached.assert_not_called()

    def test_explicit_source_requires_exact_version_and_never_falls_back(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        with patch.object(mappings.connection, 'cursor') as factory, patch.object(mappings, '_table', side_effect=lambda n: n):
            factory.return_value.__enter__.return_value = cursor
            self.assertIsNone(mappings.standard_ksb_id_for(ksb_code='K1', source_id='st0612-v9-9'))
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertEqual(cursor.execute.call_args.args[1], ['ST0612', '9.9', 'K1'])
        self.assertNotIn('order by', cursor.execute.call_args.args[0].lower())

    def test_versionless_explicit_source_is_rejected(self):
        cursor = MagicMock()
        with patch.object(mappings.connection, 'cursor') as factory:
            factory.return_value.__enter__.return_value = cursor
            self.assertIsNone(mappings.standard_ksb_id_for(ksb_code='K1', source_id='st0612'))
        cursor.execute.assert_not_called()

    def test_programme_fallback_keeps_its_pinned_version(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ('standard:st0612-v1-0',)
        cursor.fetchall.return_value = [(81,)]
        with patch.object(mappings.connection, 'cursor') as factory, patch.object(mappings, '_table', side_effect=lambda n: n):
            factory.return_value.__enter__.return_value = cursor
            self.assertEqual(mappings.standard_ksb_id_for(ksb_code='B8', programme_id='P1'), 81)
        self.assertEqual(cursor.execute.call_args.args[1], ['ST0612', '1.0', 'B8'])

    def test_bare_historical_id_does_not_resolve_globally(self):
        cursor = MagicMock()
        with patch.object(mappings.connection, 'cursor') as factory:
            factory.return_value.__enter__.return_value = cursor
            self.assertIsNone(mappings.standard_ksb_id_for(ksb_id='K1'))
        cursor.execute.assert_not_called()

    def test_picker_refuses_ambiguous_title_without_choosing_latest(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('Example',)], [('ST0612','1.0'),('ST0612','2.0')]]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(plan_pickers, 'connections', {plan_pickers.CONN: connection}):
            response = plan_pickers.picker_ksbs(SimpleNamespace(method='GET',GET={'standard':'Example'}))
        self.assertEqual(response.status_code,409)
        self.assertEqual(cursor.execute.call_count,2)

    def test_picker_exact_version_returns_definition_identity(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('Example',)], [('K1','knowledge','Canonical',8,'ST0612','1.0')]]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(plan_pickers, 'connections', {plan_pickers.CONN: connection}):
            response = plan_pickers.picker_ksbs(SimpleNamespace(method='GET',GET={
                'standardRef':'ST0612','standardVersion':'1.0'}))
        self.assertEqual(response.status_code,200)
        item = json.loads(response.content)['ksbs']['K'][0]
        self.assertEqual((item['standardKsbId'],item['standardVersion']),(8,'1.0'))
        self.assertEqual(cursor.execute.call_args.args[1][2:5],['ST0612','ST0612','1.0'])
