"""History filtering/error and revision-assembly parity, with every DB forbidden."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager, nullcontext
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import quality, versioning, views
from curriculum_api.reporting.tests import test_quality_assets_boundary_no_db as quality_checks
from system_audit import derived, writes

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'reporting/tests/fixtures/legacy_snapshots/revision_history_snapshot.json').read_text())
NOW = quality_checks.NOW


@contextmanager
def original_revision_policy():
    """Actual pre-batch function bodies, bound to the legacy runtime globals."""
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(versioning, name), Mock):
                continue
            ns = dict(vars(versioning))
            exec(compile(entry['source'], '<original-revision-policy>', 'exec'), ns)
            function = ns[name]
            restored = FunctionType(function.__code__, vars(versioning), name, function.__defaults__)
            restored.__kwdefaults__ = function.__kwdefaults__
            stack.enter_context(patch.object(versioning, name, restored))
        yield


class RevisionHistoryParity(SimpleTestCase):
    # Reuse the established actual-source oracle, not its test cases. This
    # retains return/error bytes, SQL parameter order and owner-invocation checks.
    setUp = quality_checks.QualityAssetParity.setUp
    compare = quality_checks.QualityAssetParity.compare
    owner_calls_verified = set()

    def test_history_filter_matrix_exact_query_parameters_and_result_projection(self):
        result = {'total': 2, 'page': 1, 'pages': 2, 'rows': [],
                  'action_counts': {'updated': 2}, 'entity_counts': {'module': 2},
                  'unreadable': ['synthetic', 'synthetic'],
                  'provenance_counts': {derived.PROVENANCE_REVISION: 2}, 'boundaries': {'module': NOW}}
        from curriculum_api.reporting.infrastructure import history_queries
        from curriculum_api.reporting.application import history_results
        with patch.object(derived, 'read_hybrid', return_value=result) as read, \
             patch.object(quality, 'revision_actors', return_value=[]) as actors, \
             patch.object(quality, 'transaction', SimpleNamespace(atomic=nullcontext)), \
             patch.object(writes, 'revision_workspace_clause', return_value=('entity_type = %s', ['module'])), \
             patch.object(history_queries, 'trail_query', wraps=history_queries.trail_query) as query_owner, \
             patch.object(history_results, 'trail_payload', wraps=history_results.trail_payload) as result_owner:
            for structured in (True, False):
                with patch.object(versioning, 'metadata_columns_available', return_value=structured):
                    for scope in ('module', 'programme', 'cohort', 'group', 'invalid', ''):
                        for filters in ('entity=module&action=updated&source=manual&actorType=user',
                                        'entity=unknown&action=unknown&source=unknown&actorType=unknown'):
                            request = self.requests.get('/?workspace=curriculum&days=invalid&limit=1&page=999&scope=' + scope + '&scopeId=S&search=%25quoted&actor=synthetic@example.test&' + filters)
                            self.compare('quality.revision_trail', request, watched=(read, actors))
                            self.assertIs(read.call_args.kwargs['recover'], False)
            self.assertEqual(query_owner.call_count, 24)
            self.assertEqual(result_owner.call_count, 24)

    def test_timeline_downstream_failures_preserve_propagation_and_empty_short_circuit(self):
        row = {'id': 1, 'entity_type': 'module', 'entity_id': 'M', 'revision_no': 1, 'title': 'Synthetic'}
        with patch.object(versioning, 'history_available', return_value=True), \
             composition_fixture(views, 'fetch_all') as read:
            for fail_at in ('versions', 'snapshot'):
                def reader(sql, params=None):
                    if (fail_at == 'versions' and 'select v.id' in sql) or (fail_at == 'snapshot' and 'select revision_no, snapshot' in sql):
                        raise ValueError('synthetic ' + fail_at + ' unavailable')
                    return [row]
                read.side_effect = reader
                self.compare('quality.curriculum_quality_record_history', self.requests.get('/?snapshot=1'), 'module', 'M', watched=(read,), error=True)
            read.side_effect = None
            read.return_value = []
            self.compare('quality.curriculum_quality_record_history', self.requests.get('/?snapshot=1'), 'module', 'missing', watched=(read,))
            self.assertEqual(read.call_count, 1)

    def test_versions_totals_failure_never_fabricates_zero_counts(self):
        row = {'entity_type': 'module', 'entity_id': 'M', 'revisions': 2}
        def reader(sql, params=None):
            if 'max(revision_no)' in sql:
                return [row]
            raise ValueError('synthetic totals unavailable')
        with patch.object(versioning, 'history_available', return_value=True), \
             composition_fixture(views, 'fetch_all', side_effect=reader) as read, \
             patch.object(quality, 'latest_revision_by_entity', return_value={('module', 'M'): {'title': 'Synthetic'}}), \
             patch.object(quality, 'named_version_counts', return_value={}):
            request = self.requests.get('/?entity_type=module&search=synthetic')
            with quality_checks.original_quality_assets():
                previous = quality.curriculum_quality_versions(request)
            self.assertEqual(previous.status_code, 200)
            self.assertEqual(json.loads(previous.content)['totalRevisions'], 0)
            read.reset_mock()
            current = quality.curriculum_quality_versions(request)
            self.assertEqual(current.status_code, 503)
            self.assertEqual(json.loads(current.content), {'error': 'Version history could not be read. Please retry.'})
            self.assertEqual(read.call_count, 2)

    def test_timeline_read_failure_does_not_claim_history_is_uninstalled(self):
        with patch.object(versioning, 'history_available', return_value=True), \
             composition_fixture(views, 'fetch_all', side_effect=ValueError('synthetic unreadable')) as read:
            request = self.requests.get('/')
            with quality_checks.original_quality_assets():
                previous = quality.curriculum_quality_record_history(request, 'module', 'M')
            self.assertFalse(json.loads(previous.content)['available'])
            read.reset_mock()
            current = quality.curriculum_quality_record_history(request, 'module', 'M')
            self.assertEqual(current.status_code, 503)
            self.assertEqual(json.loads(current.content), {'error': 'Record history could not be read. Please retry.'})
            self.assertEqual(read.call_count, 1)

    def test_unchanged_revision_assembler_uses_new_rules_without_policy_drift(self):
        item = {'entity_id': 'M', 'actor': {'email': 'synthetic@example.test', 'name': 'Synthetic'},
                'actor_type': 'user', 'snapshot': {'title': 'New', 'programme_id': 'P'},
                'deleted': False, 'reason': '', 'source': 'manual', 'metadata': {},
                'created_at': NOW, 'updated_at': NOW}
        previous = {'M': {'revision_no': 1, 'snapshot': {'title': 'Old', 'programme_id': 'P'}}}
        for structured in (False, True):
            with patch.object(versioning, 'metadata_columns_available', return_value=structured):
                for changes in ({}, {'deleted': True}, {'action_override': 'imported'},
                                {'created_at': None}, {'snapshot': {'title': 'Old', 'programme_id': 'P'}}):
                    data = {**item, **changes}
                    for before in ({}, previous):
                        with original_revision_policy():
                            expected = versioning.build_revision('module', data, before, {})
                        actual = versioning.build_revision('module', data, before, {})
                        self.assertEqual(actual, expected)
