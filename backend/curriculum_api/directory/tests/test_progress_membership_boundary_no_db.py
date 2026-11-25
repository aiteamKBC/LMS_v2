"""Frozen-source parity for progress, normalized roster reads and count callers."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import importlib
import json
from pathlib import Path
from types import FunctionType, ModuleType, SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import path
from learner_api import journal_sources
from learner_api.learning_plans.domain import membership_policy
from curriculum_api import learner_assignments as assignments, learner_directory_details as details
from curriculum_api import learner_status_counts as counts, module_plan_rows as plans, views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'directory/tests/fixtures/legacy_snapshots/progress_membership_snapshot.json').read_text(encoding='utf-8'))
MODULES = {'learner_assignments.py': assignments, 'learner_directory_details.py': details,
           'learner_status_counts.py': counts, 'module_plan_rows.py': plans}


@contextmanager
def original_progress_membership(*, http=False):
    with ExitStack() as stack:
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            module = MODULES[filename]
            if isinstance(getattr(module, name), Mock):
                continue
            namespace = dict(vars(module))
            exec(compile(entry['source'], '<pre-progress-membership>', 'exec'), namespace)
            function = namespace[name]
            restored = FunctionType(function.__code__, vars(module), name, function.__defaults__)
            restored.__kwdefaults__ = function.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = eval(decorator, vars(module))(restored)
            stack.enter_context(patch.object(module, name, restored))
        if http:
            urls = ModuleType('original_progress_membership_urls')
            urls.urlpatterns = [
                path('curriculum/learner-directory/progress/', details.progress),
                path('modules/<str:identifier>/learners/', assignments.module_learner_assignments),
            ]
            stack.enter_context(override_settings(ROOT_URLCONF=urls))
        yield


def profile(key, refs, **overrides):
    return SimpleNamespace(pk=key, enrolment_id=100 + key, full_name=f'Synthetic {key}', email='',
        programme='', programme_status='', cohort='', cohort_id='', group_name='', group_id='',
        lifecycle_status='active', coach_name='', coach_email='', progress_variance=None,
        otjh_status='', plan_modules=SimpleNamespace(all=lambda: [SimpleNamespace(module_ref=r) for r in refs]),
        **overrides)


class ProgressMembershipParity(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        # Compare cache headers at the same instant, including Expires.
        self.enterContext(patch('django.utils.cache.time.time', return_value=1805706000.0))
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        def authenticate(request):
            request.login_account = SimpleNamespace(role='staff')
            return request.login_account
        self.auth = self.enterContext(patch('login.permissions.authenticate_request', side_effect=authenticate))

    def compare(self, filename, name, *args, **kwargs):
        with original_progress_membership():
            expected = getattr(MODULES[filename], name)(*deepcopy(args), **deepcopy(kwargs))
        owner = importlib.import_module(SNAPSHOT[filename + ':' + name]['owner'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(MODULES[filename], name)(*deepcopy(args), **deepcopy(kwargs))
        called.assert_called_once()
        if hasattr(actual, 'content'):
            self.assertEqual((actual.status_code, actual.content, dict(actual.items())),
                             (expected.status_code, expected.content, dict(expected.items())))
        else:
            self.assertEqual(actual, expected)
        return actual

    def roster_model(self, profiles):
        model = self.enterContext(patch.object(assignments, 'LearnerProfile'))
        queryset = model.objects.select_related.return_value.filter.return_value.prefetch_related.return_value.distinct.return_value
        queryset.__iter__.side_effect = lambda: iter(profiles)
        queryset.filter.return_value = queryset
        return model, queryset

    def test_normalized_roster_blank_refs_explicit_sibling_and_direct_members(self):
        profiles = [profile(1, [None, '']), profile(2, ['S']), profile(3, ['M', 'M']), profile(4, ['M'])]
        self.roster_model(profiles)
        placed = [{'id': 1, 'name': 'Inherited'}, {'id': 2, 'name': 'Sibling'}, {'id': 3, 'name': 'Placement wins'}]
        result = self.compare('learner_assignments.py', 'module_assignment_roster', 'M', placed)
        self.assertEqual({r['id'] for r in result}, {1, 3, 4})
        self.assertEqual(next(r for r in result if r['id'] == 3)['name'], 'Placement wins')
        self.assertEqual(next(r for r in result if r['id'] == 4)['enrolmentId'], 104)

    def test_excluded_profiles_never_evaluate_display_properties(self):
        excluded = SimpleNamespace(pk=1, plan_modules=SimpleNamespace(all=lambda: [SimpleNamespace(module_ref='S')]))
        self.roster_model([excluded])
        self.assertEqual(self.compare('learner_assignments.py', 'module_assignment_roster', 'M', [{'id': 1}]), [])

    def test_lazy_direct_projections_keep_each_profile_and_missing_bridge(self):
        a, b = profile(1, ['M']), profile(2, ['M'])
        a.enrolment_id, b.enrolment_id = 0, None
        self.roster_model([a, b])
        result = self.compare('learner_assignments.py', 'module_assignment_roster', 'M', [])
        self.assertEqual([(r['id'], r['enrolmentId']) for r in result], [(1, 0), (2, None)])

    def test_lifecycle_query_and_duplicate_placement_keep_existing_semantics(self):
        model, query = self.roster_model([])
        placed = [{'id': 1, 'name': 'old'}, {'id': '1', 'name': 'last'}]
        result = self.compare('learner_assignments.py', 'module_assignment_roster', 'M', placed, ' Active ')
        self.assertEqual(result, [placed[-1]])
        self.assertEqual(query.filter.call_args_list[0], query.filter.call_args_list[1])
        self.assertEqual(query.filter.call_args.kwargs, {'lifecycle_status__iexact': ' Active '})
        self.assertEqual(model.objects.select_related.call_args_list[0], model.objects.select_related.call_args_list[1])

    def test_plan_count_sql_is_exact_and_keeps_enrolment_keys(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(901, 2), (0, 1)]
        with composition_fixture(views, 'connection', connection):
            self.assertEqual(self.compare('learner_assignments.py', '_plan_row_counts'), {'901': 2, '0': 1})
        self.assertEqual(cursor.execute.call_args_list[0], cursor.execute.call_args_list[1])

    def test_plan_read_guards_keep_alias_and_none_short_circuit(self):
        learner = SimpleNamespace(pk=91, _state=SimpleNamespace(db='enrolment'))
        with patch.object(plans, 'LearnerProfile') as profiles, patch.object(plans, 'LearnerTrainingPlanModule') as modules:
            profiles.objects.using.return_value.only.return_value.filter.return_value.first.return_value = SimpleNamespace(pk=7)
            modules.objects.filter.return_value.exists.return_value = True
            self.compare('module_plan_rows.py', 'profile_for', learner)
            profiles.objects.using.assert_called_with('enrolment')
            for name, args in (('has_plan_rows', (None,)), ('has_module_row', (None, 'M'))):
                modules.reset_mock(); self.assertFalse(self.compare('module_plan_rows.py', name, *args)); modules.objects.filter.assert_not_called()
            self.assertTrue(self.compare('module_plan_rows.py', 'has_module_row', SimpleNamespace(pk=7), 'M'))

    def test_lineage_reads_preserve_sql_columns_aliases_and_missing(self):
        columns = ['module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'learner_roster_mode']
        with composition_fixture(views, 'column_names', return_value=columns), \
             composition_fixture(views, 'authoring_fetch_all', return_value=[{'module_catalogue_id': 'M', 'programme_id': ' P ', 'learner_roster_mode': 'MANUAL'}]) as reader, \
             composition_fixture(views, 'scope_placement_lineage', return_value={'found': False}) as resolve:
            result = self.compare('learner_status_counts.py', 'placement_lineages', 'module', ['M', 'missing'])
            self.assertEqual(result['M']['learnerRosterMode'], 'manual')
            self.assertEqual(reader.call_args_list[0], reader.call_args_list[1])
            self.assertFalse(reader.call_args.kwargs['ensure_tables'])
            self.assertEqual(resolve.call_args_list[0], resolve.call_args_list[1])
            reader.reset_mock()
            self.compare('learner_status_counts.py', 'placement_lineages', 'programme', ['P'])
            reader.assert_not_called()

    def test_lineage_missing_key_column_fails_without_provisioning(self):
        with composition_fixture(views, 'column_names', return_value=[]), composition_fixture(views, 'authoring_fetch_all') as read:
            for old in (True, False):
                with (original_progress_membership() if old else ExitStack()), self.assertRaises(DatabaseError):
                    counts.placement_lineages('module', ['M'])
            read.assert_not_called()

    def test_shared_policy_status_deduplication_and_batch_bridge_truthiness(self):
        lineage = {'found': True, 'programmeId': 'P', 'moduleCatalogueId': 'M'}
        facts = [dict(id=i, programme_id='P', enrolment_id=bridge, status='On_Hold') for i, bridge in enumerate((None, 0, '', False, 101, '101', '0'))]
        facts.append(dict(facts[-1], id=0, status='active'))
        self.compare('learner_status_counts.py', 'members_for_lineages', {'M': lineage, 'lost': {'found': False}}, facts, {})
        result = self.compare('learner_status_counts.py', 'counts_for_lineages', {'M': lineage}, facts, {})
        self.assertEqual(result['M']['total'], 7)
        with composition_fixture(counts, 'placement_lineages', return_value={'M': lineage, 'lost': {'found': False}}), \
             composition_fixture(counts, 'learner_facts', return_value=facts), composition_fixture(views, 'programme_identity_candidates', return_value=[]):
            self.assertEqual(self.compare('learner_status_counts.py', 'module_member_enrolment_ids_by_module', [' M ', 'M', 'lost']), {'M': {'101', '0'}, 'lost': set()})
            self.compare('learner_status_counts.py', 'status_counts', 'module', ['M', 'lost'])

    def test_both_count_and_batch_paths_invoke_the_single_domain_policy(self):
        lineage = {'found': True, 'programmeId': 'P', 'moduleCatalogueId': 'M'}
        with patch.object(membership_policy, 'members_for_lineages', wraps=membership_policy.members_for_lineages) as policy, \
             composition_fixture(counts, 'placement_lineages', return_value={'M': lineage}), \
             composition_fixture(counts, 'learner_facts', return_value=[]), composition_fixture(views, 'programme_identity_candidates', return_value=[]):
            counts.status_counts('module', ['M'])
            counts.module_member_enrolment_ids_by_module(['M'])
            self.assertEqual(policy.call_count, 2)

    def progress_setup(self, rows=None):
        rows = rows if rows is not None else [{'id': '7', 'enrolmentId': 91}]
        target = self.enterContext(patch.object(details, 'target_rows', return_value=rows))
        model = self.enterContext(patch('learner_api.models.EnrolmentUser'))
        source = SimpleNamespace(pk=91)
        model.all_learners.only.return_value.filter.return_value = [source]
        placements = self.enterContext(patch('learner_api.placement_links.with_placements', side_effect=lambda records: records))
        modules = self.enterContext(composition_fixture(views, 'authoring_scope_module_rows', return_value=[{'module_catalogue_id': 'M'}]))
        self.enterContext(patch.object(details.timezone, 'now', return_value=datetime(2028, 7, 1, 23, 30, tzinfo=timezone.utc)))
        return target, model, source, placements, modules

    def request(self, **extra):
        return self.factory.get('/', {'scope': 'module', 'id': 'M', 'learnerIds': '7', **extra})

    def test_progress_bounded_sources_partial_failure_and_uk_date(self):
        _, model, source, placements, _ = self.progress_setup([{'id': '7', 'enrolmentId': 91}, {'id': '8', 'enrolmentId': 0}, {'id': '9', 'enrolmentId': None}])
        with patch.object(details, 'learner_progress', return_value={'available': {'total': 1}}) as read:
            result = json.loads(self.compare('learner_directory_details.py', 'progress', self.request(learnerIds='7,8,9,7')).content)
        self.assertEqual(set(result['learners']), {'7', '8', '9'})
        self.assertIn('error', result['learners']['8'])
        self.assertEqual(read.call_args_list[0], read.call_args_list[1])
        read.assert_called_with(source, '7', {'M'}, '2028-07-02')
        self.assertEqual(model.all_learners.only.return_value.filter.call_args.kwargs, {'pk__in': [91]})
        self.assertEqual(placements.call_count, 2)

    def test_progress_invalid_missing_and_changed_scope_stop_before_source_reads(self):
        target, model, _, _, modules = self.progress_setup()
        for query in ({'learnerIds': '8'}, {'learnerIds': '1,2,3,4,5,6'}, {'learnerIds': ' 7'}, {'learnerIds': 'abc'}, {'id': ''}):
            self.compare('learner_directory_details.py', 'progress', self.request(**query))
        target.return_value = None
        self.assertEqual(self.compare('learner_directory_details.py', 'progress', self.request()).status_code, 404)
        model.all_learners.only.assert_not_called(); modules.assert_not_called()

    def test_progress_journal_perspective_is_active_during_reads_and_restored(self):
        self.progress_setup()
        seen = []
        def read(*args):
            seen.append(journal_sources.enabled())
            return {'available': {}}
        with patch.object(details, 'learner_progress', side_effect=read):
            for extra, enabled in (({}, True), ({'viewAsCoach': '1'}, False), ({'perspective': 'coach'}, False)):
                seen.clear()
                with journal_sources.learner_journal_reads():
                    self.compare('learner_directory_details.py', 'progress', self.request(**extra))
                    self.assertTrue(journal_sources.enabled())
                self.assertEqual(seen, [enabled, enabled])
                self.assertFalse(journal_sources.enabled())

    def test_progress_errors_preserve_per_profile_versus_whole_request_mapping(self):
        target, _, _, _, _ = self.progress_setup()
        with patch.object(details, 'learner_progress', side_effect=DatabaseError('private')):
            response = self.compare('learner_directory_details.py', 'progress', self.request())
            self.assertEqual(response.status_code, 200)
            self.assertNotIn(b'private', response.content)
        target.side_effect = DatabaseError('private')
        self.assertEqual(self.compare('learner_directory_details.py', 'progress', self.request()).status_code, 503)

    def test_progress_unexpected_errors_propagate_and_reset_journal(self):
        self.progress_setup()
        with patch.object(details, 'learner_progress', side_effect=RuntimeError('synthetic')):
            for old in (True, False):
                with (original_progress_membership() if old else ExitStack()), self.assertRaisesRegex(RuntimeError, 'synthetic'):
                    details.progress(self.request())
                self.assertFalse(journal_sources.enabled())
