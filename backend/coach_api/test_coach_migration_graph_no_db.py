"""Source-only acceptance for the two Coach migration histories."""
from django.conf import settings
from django.db.migrations.autodetector import MigrationAutodetector
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.questioner import NonInteractiveMigrationQuestioner
from django.test import SimpleTestCase, override_settings


ANCESTOR = ('coach_api', '0026_migrated_review_revisions')
CURRENT = [('coach_api', name) for name in (
    '0027_personal_support_template', '0028_legacy_template_hours_defaults')]
HISTORICAL = [('coach_api', name) for name in (
    '0027_coaching_quality_suggestion', '0028_coaching_recording_job',
    '0029_coaching_calendar_index', '0030_coaching_completion_reminders')]
MERGE = ('coach_api', '0031_merge_coaching_features')
CLAIM = ('coach_api', '0032_aptem_actual_session_claim_integrity')
OWNER = ('coach_api', '0033_aptem_imported_meeting_ownership')


class CoachMigrationGraphTests(SimpleTestCase):
    def loader(self):
        # The offline SQLite runner suppresses Coach migrations for execution.
        # Load their source graph only; no connection or migration is opened.
        modules = {key: value for key, value in settings.MIGRATION_MODULES.items()
                   if key != 'coach_api'}
        with override_settings(MIGRATION_MODULES=modules):
            return MigrationLoader(None)

    def test_one_merge_leaf_preserves_both_original_lineages(self):
        loader = self.loader()
        self.assertEqual(loader.graph.leaf_nodes('coach_api'), [OWNER])
        self.assertNotIn('coach_api', loader.detect_conflicts())
        self.assertEqual(loader.disk_migrations[OWNER].dependencies, [CLAIM])
        self.assertEqual(loader.disk_migrations[CLAIM].dependencies, [MERGE])
        self.assertEqual(set(loader.disk_migrations[MERGE].dependencies), {CURRENT[-1], HISTORICAL[-1]})
        self.assertEqual(loader.disk_migrations[MERGE].operations, [])
        self.assertEqual(loader.disk_migrations[CURRENT[0]].dependencies, [ANCESTOR])
        self.assertEqual(loader.disk_migrations[HISTORICAL[0]].dependencies, [ANCESTOR])

    def test_both_legal_orders_produce_the_same_project_state(self):
        loader = self.loader()
        expected = loader.project_state(nodes=[OWNER])
        for label, order in (('current-first', [*CURRENT, *HISTORICAL, MERGE]),
                             ('historical-first', [*HISTORICAL, *CURRENT, MERGE])):
            with self.subTest(order=label):
                state = loader.project_state(nodes=[ANCESTOR])
                for key in order:
                    state = loader.disk_migrations[key].mutate_state(state)
                state = loader.disk_migrations[CLAIM].mutate_state(state)
                state = loader.disk_migrations[OWNER].mutate_state(state)
                delta = MigrationAutodetector(state, expected,
                    NonInteractiveMigrationQuestioner(specified_apps={'coach_api'})).changes(
                        graph=loader.graph, trim_to_apps={'coach_api'})
                self.assertNotIn('coach_api', delta)
                self.assertEqual(state.models[('coach_api', 'coachingrecordingjob')].options['db_table'],
                                 'Coach"."coaching_recording_job')
                self.assertEqual(state.models[('coach_api', 'coachingcalendarindex')].options['db_table'],
                                 'Coach"."coaching_calendar_index')
                self.assertEqual(state.models[('coach_api', 'coachcalendarevent')].options['db_table'],
                                 'Coach"."coach_calendar_event')

    def test_each_applied_lineage_plans_only_the_missing_sibling(self):
        loader = self.loader()
        ancestor_nodes = set(loader.graph.forwards_plan(ANCESTOR))
        full = [key for key in loader.graph.forwards_plan(OWNER) if key[0] == 'coach_api']
        for label, applied, expected in (
                ('current-applied', CURRENT, [*HISTORICAL, MERGE, CLAIM, OWNER]),
                ('historical-applied', HISTORICAL, [*CURRENT, MERGE, CLAIM, OWNER])):
            with self.subTest(path=label):
                pending = [key for key in full if key not in ancestor_nodes and key not in applied]
                self.assertEqual(set(pending), set(expected))
                self.assertEqual(len(pending), len(set(pending)))
