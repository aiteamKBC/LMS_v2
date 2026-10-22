"""F01/F02 consistency boundaries with real bodies and explicit I/O doubles.

Run: python -B backend/learner_api/test_backend_consistency_no_db.py
No framework, database, environment-file access or external services.
Failure/stale characterizations identify blockers, not accepted behavior fixes.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import timedelta
import json
import logging
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

import test_module_roster_no_db as roster
import test_plan_reconciliation_no_db as reconciliation

support = roster.support
ROOT = roster.ROOT


def bulk_with_exit_failure(harness, method, ids, fail_on_exit=(), scope='module'):
    """Inject failure after the real writer returns, before synthetic commit."""
    definitions = support.definitions
    mirrors = {}
    attempts = []

    def load(path, names, namespace, *args, **kwargs):
        definitions(path, names, namespace, *args, **kwargs)
        if '_handle' not in names:
            return
        mirror = namespace['plans'].sync_learning_plan_mirror

        def tracked_mirror(source, **options):
            assert options == {'strict': True}
            mirror(source, **options)
            mirrors[source.pk] = deepcopy(source.learning_plan)

        namespace['plans'].sync_learning_plan_mirror = tracked_mirror

        @contextmanager
        def atomic(*, using):
            assert using == harness.directory.db
            saved = deepcopy((harness.directory.data, mirrors))
            index = len(attempts) + 1
            attempts.append(index)
            try:
                yield
                if index in fail_on_exit:
                    raise support.DatabaseError('synthetic transaction exit failure')
            except Exception:
                harness.directory.data = saved[0]
                mirrors.clear()
                mirrors.update(saved[1])
                raise

        namespace['transaction'] = NS(atomic=atomic)

    with patch.object(support, 'definitions', side_effect=load):
        response = harness.curriculum(method, ids, scope)
    return response, json.loads(response.content), mirrors, attempts


class BulkCommitReportingTests(unittest.TestCase):
    def test_failed_transaction_exit_is_not_counted_as_changed(self):
        for scope in ('module', 'cohort'):
            for method in ('POST', 'DELETE'):
                for failed in (1, 2):
                    with self.subTest(scope=scope, method=method, failed=failed):
                        plan = [] if method == 'POST' else [{'moduleId': 'A', 'assignmentMode': 'explicit'}]
                        rows = [roster.learner(i, deepcopy(plan)) for i in (1, 2, 3)]
                        h = roster.Harness(rows)
                        response, data, mirrors, attempts = bulk_with_exit_failure(h, method, [1, 2], {failed}, scope)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(data, {
                            'assignedCount': 1, 'changedCount': 1, 'moduleCount': 1,
                            'failedIds': [str(failed)],
                            'failureMessage': 'Unable to save learner assignments. Please try again.',
                        })
                        self.assertEqual(h.directory.data[failed], rows[failed - 1])
                        self.assertEqual(h.directory.data[3], rows[2])
                        self.assertEqual(set(mirrors), {3 - failed})
                        self.assertEqual(attempts, [1, 2])
                        self.assertEqual(h.calls.count(('invalidate',)), 1)

    def test_all_transaction_exits_failed_preserves_503_without_success_invalidation(self):
        rows = [roster.learner(1, []), roster.learner(2, [])]
        h = roster.Harness(rows)
        response, data, mirrors, _ = bulk_with_exit_failure(h, 'POST', [1, 2], {1, 2})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(data, {'error': 'Unable to save learner assignments. Please try again.'})
        self.assertEqual(h.directory.data, {r['id']: r for r in rows})
        self.assertEqual(mirrors, {})
        self.assertNotIn(('invalidate',), h.calls)

    def test_success_and_noop_preserve_existing_counts(self):
        h = roster.Harness([roster.learner(1, []), roster.learner(2, [{'moduleId': 'A', 'assignmentMode': 'explicit'}])])
        response, data, mirrors, _ = bulk_with_exit_failure(h, 'POST', [1, 2])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data, {'assignedCount': 2, 'changedCount': 1, 'moduleCount': 1,
                                'failedIds': [], 'failureMessage': ''})
        self.assertEqual(set(mirrors), {1})

    def test_denied_roles_do_not_enter_transaction_or_mirror(self):
        for role, status in ((None, 401), ('learner', 403), ('employer', 403)):
            h = roster.Harness([roster.learner(1, [])])
            h.role = role
            response, _, mirrors, attempts = bulk_with_exit_failure(h, 'POST', [1])
            self.assertEqual(response.status_code, status)
            self.assertEqual((mirrors, attempts, h.calls), ({}, [], []))


class MissingProfileStore(reconciliation.Store):
    def update(self, learning_plan):
        # QuerySet.update against no matching profile does not create a row.
        return 0

    def first(self):
        return None


class PlanHttpHarness:
    """HTTP body only; real authorization is exercised by existing gate suites."""
    def __init__(self):
        self.h = roster.Harness([roster.learner(7, deepcopy(reconciliation.PLAN)), roster.learner(8, [])])
        self.db = reconciliation.Store()
        self.db.sync(NS(pk=7, training_plan=None, learning_plan=deepcopy(reconciliation.PLAN)))
        self.h.directory.get = lambda pk: self.h.directory.filter(pk=pk).first()
        self.h.ns['EnrolmentUser'].DoesNotExist = type('DoesNotExist', (Exception,), {})
        self.h.ns.update(
            learner_self_or_staff=lambda **kwargs: lambda fn: fn,
            _all_modules=lambda: deepcopy(reconciliation.PLAN),
            learner_programme_modules=lambda source: [], learner_group_module_ids=lambda source: [],
            _serialize=lambda source: {'modules': deepcopy(source.learning_plan)},
            sync_learning_plan_mirror=lambda source: self.db.sync(source, strict=False),
        )
        support.definitions(ROOT / 'learning_plan.py', ['learning_plan'], self.h.ns)

    def request(self, modules):
        return self.h.ns['learning_plan'](NS(method='PATCH', body=json.dumps({'modules': modules}).encode()), pk=7)


class PlanHttpBoundaryTests(unittest.TestCase):
    def test_failure_before_source_save_keeps_source_and_mirror(self):
        h = PlanHttpHarness()
        before = deepcopy(h.h.directory.data), h.db.snapshot()
        h.h.directory.fail_save = 7
        response = h.request([])
        self.assertEqual((response.status_code, json.loads(response.content)),
                         (502, {'error': 'The database service is temporarily unavailable.'}))
        self.assertEqual((h.h.directory.data, h.db.snapshot()), before)
        self.assertNotIn(('advance', 7), h.h.calls)

    def test_mirror_failure_after_source_save_retains_legacy_success_BLOCKED(self):
        h = PlanHttpHarness()
        h.db.progress = [{'id': 911, 'plan_component_id': h.db.rows[2][0].pk}]
        before = h.db.snapshot()
        other = deepcopy(h.h.directory.data[8])
        with self.assertLogs('guarded', level='ERROR'):
            response = h.request([])
        self.assertEqual((response.status_code, json.loads(response.content)), (200, {'modules': []}))
        self.assertEqual(h.h.directory.data[7]['learning_plan'], [])
        self.assertEqual(h.db.snapshot(), before)
        self.assertEqual(h.h.directory.data[8], other)
        self.assertIn(('advance', 7), h.h.calls)

    def test_successful_empty_save_returns_zero_from_mirror_without_failure(self):
        h = PlanHttpHarness()
        response = h.request([])
        self.assertEqual((response.status_code, json.loads(response.content)), (200, {'modules': []}))
        self.assertEqual(h.h.directory.data[7]['learning_plan'], [])
        self.assertEqual(h.db.json, [])
        self.assertEqual(h.db.rows, [[], [], []])


class MirrorBoundaryTests(unittest.TestCase):
    def test_missing_profile_does_not_create_one_even_in_strict_mode(self):
        for strict in (False, True):
            db = MissingProfileStore()
            count = db.sync(NS(pk=7, training_plan=deepcopy(reconciliation.PLAN), learning_plan=None), strict=strict)
            self.assertEqual(count, 1)
            self.assertIsNone(db.json)
            self.assertEqual(db.rows, [[], [], []])
            self.assertEqual(db.writes, [])
            self.assertIn('Old title', db.legacy['modules'])

    def test_zero_is_not_a_failure_discriminator(self):
        for strict in (False, True):
            for source in (None, NS(pk=None), NS(pk=7, training_plan=[], learning_plan=None),
                           NS(pk=7, training_plan=None, learning_plan=None)):
                db = reconciliation.Store()
                self.assertEqual(db.sync(source, strict=strict), 0)
                self.assertEqual(db.rows, [[], [], []])

    def test_legacy_title_only_plan_fails_closed_without_fabricated_identity(self):
        db = reconciliation.Store()
        source = NS(pk=7, training_plan=None, learning_plan=None, modules='Legacy title')
        before = db.snapshot()
        with self.assertRaisesRegex(reconciliation.Failure, 'Ambiguous'):
            db.sync(source, strict=True)
        self.assertEqual(db.snapshot(), before)
        with self.assertLogs('guarded', level='ERROR'):
            self.assertEqual(db.sync(source, strict=False), 0)
        self.assertEqual(db.snapshot(), before)

    def test_progress_evidence_lineage_survives_rename_and_linked_removal_refusal(self):
        db = reconciliation.Store()
        source = NS(pk=7, training_plan=deepcopy(reconciliation.PLAN), learning_plan=None)
        db.sync(source)
        component_id = db.rows[2][0].pk
        db.progress = [{'id': 911, 'plan_component_id': component_id, 'deleted_at': 'historical'}]
        # Logical fixture links only; this is not a physical Evidence/FK manifest.
        evidence = {'file': {'progress_entry_id': 911, 'component_ref': 'C1', 'blob': 'synthetic-blob'}}
        before_evidence = deepcopy(evidence)
        source.training_plan[0]['moduleTitle'] = 'Renamed'
        db.sync(source)
        before = db.snapshot()
        source.training_plan = []
        with self.assertRaisesRegex(reconciliation.Failure, 'historical progress'):
            db.sync(source)
        self.assertEqual(db.snapshot(), before)
        progress = next(p for p in db.progress if p['id'] == evidence['file']['progress_entry_id'])
        component = next(c for c in db.rows[2] if c.pk == progress['plan_component_id'])
        self.assertEqual((component.pk, component.component_ref), (component_id, 'C1'))
        self.assertEqual(evidence, before_evidence)

    def test_stale_snapshot_still_overwrites_newer_json_graph_and_legacy_BLOCKED(self):
        db = reconciliation.Store()
        old = NS(pk=7, training_plan=deepcopy(reconciliation.PLAN), learning_plan=None)
        new = deepcopy(old)
        new.training_plan[0]['moduleTitle'] = 'New title'
        db.sync(new)
        newer = db.snapshot()
        db.sync(old)
        self.assertNotEqual(db.snapshot(), newer)
        self.assertEqual(db.json, old.training_plan)
        self.assertEqual(db.rows[0][0].module_title, 'Old title')
        self.assertIn('Old title', db.legacy['modules'])


class ActivationHarness:
    """Actual activation body, synthetic profile creation and helper failures."""
    def __init__(self, *, fail_graph=False, status='Active'):
        self.profiles, self.events = [], []
        self.source = NS(id=7, pk=7, username='Synthetic', learner_type='commercial',
                         programme_status=status, training_plan=deepcopy(reconciliation.PLAN),
                         learning_plan=None, free_courses=[])

        @contextmanager
        def atomic(using):
            assert using == 'enrolment'
            before = deepcopy(self.profiles)
            try:
                yield
            except Exception:
                self.profiles[:] = before
                raise

        def create(**values):
            self.events.append('create')
            row = NS(pk=19, refresh_from_db=lambda **kwargs: None, **values)
            self.profiles.append(row)
            return row

        def replace(profile, plan):
            self.events.append('graph')
            if fail_graph:
                raise reconciliation.Failure('synthetic graph failure')

        self.modules = {name: ModuleType(name) for name in (
            'learner_api', 'learner_api.apprenticeship_agreement',
            'learner_api.learner_dates', 'learner_api.coach_assignment',
            'learner_api.services', 'learner_api.services.contact_sync')}
        self.modules['learner_api.services.contact_sync'].verified_activation_profile = lambda source: (None, {})
        self.modules['learner_api.services.contact_sync'].sync_contacts_in_transaction = lambda *a, **k: None
        self.modules['learner_api.apprenticeship_agreement']._group_dates = lambda source: (None, None, None)
        self.modules['learner_api.learner_dates'].learner_date_values = lambda source: {}
        self.modules['learner_api.coach_assignment'].source_coach = lambda source: {}
        self.ns = dict(__package__='learner_api', _s=lambda v: str(v or '').strip(),
                       ACTIVE_STATUS='active', timedelta=timedelta, DatabaseError=reconciliation.Failure,
                       logger=logging.getLogger('activation-guarded'), transaction=NS(atomic=atomic),
                       mirrored_training_plan=reconciliation.codec_scope()['mirrored_training_plan'],
                       learner_profile_for_source=lambda *args: None,
                       hydrate_source_training_plan=lambda source: deepcopy(source.training_plan),
                       _resolve_linkable_programme_id=lambda *args, **kwargs: None,
                       _linkable_placement_ids=lambda *args: (None, None),
                       LearnerProfile=NS(objects=NS(create=create)), replace_training_plan=replace,
                       replace_free_courses=lambda *args: self.events.append('free'),
                       refresh_learner_ksb_snapshot=lambda *args, **kwargs: self.events.append('ksb'))
        reconciliation.load('active_users.py', ['sync_active_user'], self.ns)

    def run(self, *, strict=False):
        with patch.dict(sys.modules, self.modules):
            return self.ns['sync_active_user'](self.source, strict=strict)


class ActivationBoundaryTests(unittest.TestCase):
    def test_strict_activation_raises_after_rolling_back_profile(self):
        h = ActivationHarness(fail_graph=True)
        with self.assertLogs('activation-guarded', level='WARNING'), self.assertRaises(reconciliation.Failure):
            h.run(strict=True)
        self.assertEqual(h.profiles, [])

    def test_strict_non_active_success_retains_none_contract(self):
        h = ActivationHarness(status='Delivery')
        self.assertIsNone(h.run(strict=True))
        self.assertEqual(len(h.profiles), 1)

    def test_missing_profile_created_with_separate_id_and_source_link(self):
        h = ActivationHarness()
        result = h.run()
        self.assertEqual((result.pk, result.enrolment_id), (19, 7))
        self.assertEqual(result.learning_plan, h.source.training_plan)
        self.assertEqual(h.events, ['create', 'graph', 'free', 'ksb'])

    def test_graph_failure_returns_none_rolls_back_profile_not_preceding_source(self):
        h = ActivationHarness(fail_graph=True)
        before = deepcopy(h.source)
        with self.assertLogs('activation-guarded', level='WARNING'):
            self.assertIsNone(h.run())
        self.assertEqual(h.profiles, [])
        self.assertEqual(h.source, before)
        self.assertEqual(h.events, ['create', 'graph'])

    def test_non_active_profile_can_persist_while_returning_none(self):
        h = ActivationHarness(status='Delivery')
        self.assertIsNone(h.run())
        self.assertEqual(len(h.profiles), 1)
        self.assertEqual(h.events, ['create'])
        self.assertEqual(h.profiles[0].lifecycle_status, 'delivery')


if __name__ == '__main__':
    sys.addaudithook(reconciliation.guard)
    unittest.main(verbosity=2)
