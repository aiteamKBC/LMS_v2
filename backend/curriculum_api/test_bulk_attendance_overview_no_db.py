"""Bulk filter counts use canonical learner membership and isolated cache keys."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_patch
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import learner_assignment_counts_sql as legacy
from . import learner_status_counts as counts
from . import views
from .test_learner_status_counts_no_db import fact, lineage


class BulkOverviewTests(SimpleTestCase):
    def setUp(self):
        self.rows = {key: [] for key in ('training', 'modules', 'authoring_modules', 'ksb_profiles',
                                        'program_configs', 'holidays', 'tutors', 'coaches', 'tutor_modules')}
        self.enterContext(composition_fixture(views, 'get_cached_curriculum_rows', return_value=self.rows))
        self.enterContext(composition_fixture(views, 'get_required_curriculum_rows', return_value=self.rows))
        self.enterContext(composition_fixture(views, 'build_modules', side_effect=lambda *a, **kw: [
            {'id': 'delivery-1', 'moduleCatalogueId': 'M1', 'name': 'One'},
            {'id': 'delivery-2', 'moduleCatalogueId': 'M2', 'name': 'Two'},
        ]))
        self.enterContext(composition_fixture(views, 'build_programmes', return_value=[{'id': 'P1'}]))
        self.enterContext(composition_fixture(views, 'build_cohorts_and_groups', return_value=(
            [{'id': 'C1'}], [{'id': 'G1', 'sessions': 2}])))
        self.enterContext(composition_fixture(views, 'build_ksb_data', return_value=([], [])))
        self.enterContext(composition_fixture(views, 'enrich_modules_with_authoring', side_effect=lambda modules, **kw: modules))
        for name in ('cohort_authoring_detail_rows', 'group_authoring_detail_rows', 'build_staff_profiles'):
            self.enterContext(composition_fixture(views, name, return_value=[]))
        self.enterContext(composition_fixture(views, 'curriculum_sessions_from_rows', return_value=[{'id': 'lecture-1'}]))
        module = lineage(cohortId='C1', groupId='G1', moduleCatalogueId='M1')
        self.enterContext(composition_fixture(counts, 'placement_lineages', return_value={
            'M1': module, 'M2': {**module, 'moduleCatalogueId': 'M2', 'learnerRosterMode': 'manual'},
        }))
        self.enterContext(composition_fixture(views, 'programme_identity_candidates', return_value=['P1']))
        self.facts = self.enterContext(composition_fixture(counts, 'learner_facts', return_value=[
            fact(1), fact(2, explicit=True, modules=['M2']),
            fact(3, programme_id='P2', explicit=True, modules=['M1']),
            fact(4, programme_id='P2'),
        ]))
        self.legacy = self.enterContext(patch.object(legacy, 'bulk_assigned_learner_counts_sql',
                                                    side_effect=AssertionError('Created_users is unavailable')))

    def test_compact_and_full_builds_use_profile_placement_and_explicit_assignments(self):
        for compact in (True, False):
            with self.subTest(compact=compact):
                payload = views.build_curriculum_payload('all', compact=compact, learner_profiles=True)
                self.assertEqual([(m['id'], m['assignments']) for m in payload['modules']],
                                 [('delivery-1', 2), ('delivery-2', 1)])
                self.assertEqual(payload['programmes'], [{'id': 'P1'}])
                self.assertEqual(payload['cohorts'], [{'id': 'C1'}])
                self.assertEqual(payload['groups'][0]['id'], 'G1')
                self.assertEqual(payload['sessions'], [] if compact else [{'id': 'lecture-1'}])
        self.legacy.assert_not_called()

    def test_ordinary_curriculum_callers_keep_their_existing_count_source(self):
        self.legacy.side_effect = None
        self.legacy.return_value = {'M1': 9, 'M2': 8}
        payload = views.build_curriculum_payload('all', compact=True)
        self.assertEqual([m['assignments'] for m in payload['modules']], [9, 8])
        self.facts.assert_not_called()

    def test_profile_requests_cannot_reuse_or_refresh_the_legacy_shared_read_model(self):
        saved = {}
        def cache(key, factory, **options):
            if key not in saved or options.get('force'):
                saved[key] = factory()
            return saved[key]
        self.legacy.side_effect = None
        self.legacy.return_value = {'M1': 9, 'M2': 8}
        with self.settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=cache), \
             composition_patch('curriculum_api.read_model.get_curriculum_home', return_value=None) as shared, \
             composition_patch('curriculum_api.read_model.enqueue_curriculum_home_refresh') as refresh:
            factory = RequestFactory()
            old = views.curriculum_overview(factory.get('/overview/?visibility=all&compact=true'))
            self.assertEqual(json.loads(old.content)['modules'][0]['assignments'], 9)
            shared.reset_mock()
            refresh.reset_mock()
            for compact in ('true', 'false'):
                for _ in range(2):
                    response = views.curriculum_overview(factory.get(
                        f'/overview/?visibility=all&compact={compact}&learner_source=profiles'))
                    self.assertEqual(json.loads(response.content)['modules'][0]['assignments'], 2)
            shared.assert_not_called()
            refresh.assert_not_called()
        self.assertEqual(set(saved), {'overview-required:v2:all:compact', 'overview-required:v2:all:compact:learner-profiles',
                                      'overview-required:v2:all:full:learner-profiles',
                                      'rows-required:v2:compact', 'rows-required:v2:full'})

    def test_profile_read_errors_do_not_fall_back_to_created_users(self):
        from django.db import DatabaseError
        self.facts.side_effect = DatabaseError('synthetic read failure')
        with self.assertRaises(DatabaseError):
            views.build_curriculum_payload('all', compact=True, learner_profiles=True)
        self.legacy.assert_not_called()
