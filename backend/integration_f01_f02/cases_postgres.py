"""Acceptance assertions, including unresolved Plan Mirror failures. No skips."""
import copy
import threading
from unittest.mock import patch
from .cases_http import HttpCases
from .fixtures import plan, PNG
from .safety import Refused


def race(left, right):
    """Two real connections; bounded starts/joins, no replay of either writer."""
    from django.db import connections
    start = threading.Barrier(2, timeout=8)
    results, errors, pids = {}, [], []

    def worker(key, action):
        try:
            with connections['enrolment'].cursor() as cur:
                cur.execute('SELECT pg_backend_pid()')
                pids.append(cur.fetchone()[0])
            start.wait()
            results[key] = action()
        except BaseException as exc:
            errors.append(type(exc).__name__)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(key, action))
               for key, action in [('left', left), ('right', right)]]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(25)
    if any(thread.is_alive() for thread in threads):
        # A live writer invalidates cleanup safety; stop the whole process/run.
        from .bootstrap import quarantine
        quarantine()
        raise Refused('Worker still alive: preserve target; no retry or cleanup')
    if errors or len(set(pids)) != 2:
        raise AssertionError(f'Concurrency failed: {errors}; distinct connections={len(set(pids))}')
    return results


class PostgresCases(HttpCases):
    # Inherited HTTP cases intentionally run in the acceptance pass too.
    def test_actual_rollback_restores_source(self):
        from django.db import transaction
        learner = self.f.learner()
        before = learner.source.phone_number
        with self.assertRaisesRegex(ValueError, 'injected'):
            with transaction.atomic(using='enrolment'):
                learner.source.phone_number = 'synthetic-change'
                learner.source.save(using='enrolment', update_fields=['phone_number'])
                raise ValueError('injected')
        learner.source.refresh_from_db(using='enrolment')
        self.assertEqual(learner.source.phone_number, before)

    def test_linked_history_refusal_preserves_progress_ksb_and_evidence(self):
        from django.db import DatabaseError, connections
        from learner_api.active_users import replace_training_plan
        learner = self.f.learner()
        _, _, component = self.f.graph(learner)
        progress = self.f.history(learner, component)
        _, definition, _ = self.f.ksb(learner)
        evidence = self.f.evidence(learner, progress)

        def manifest():
            with connections['enrolment'].cursor() as cur:
                cur.execute('SELECT to_jsonb(p) FROM "Learner".learner_progress_entries p WHERE id=%s', [progress])
                first = cur.fetchone()
                cur.execute('SELECT to_jsonb(e) FROM "Learner".evidence_files e WHERE id=%s', [evidence])
                return first, cur.fetchone()
        before = manifest()
        with self.assertRaises(DatabaseError):
            replace_training_plan(learner.profile, [])
        self.assertEqual(manifest(), before)
        definition.refresh_from_db(using='enrolment')
        self.assertEqual(definition.code, 'K1')

    def test_ACCEPTANCE_stale_snapshot_must_not_overwrite_newer_plan(self):
        from learner_api.learning_plan import sync_learning_plan_mirror
        learner = self.f.learner(selection='manual')
        older = copy.deepcopy(learner.source)
        learner.source.learning_plan = plan(self.f.namespace, 'Newer authoritative title')
        learner.source.save(using='enrolment', update_fields=['learning_plan'])
        sync_learning_plan_mirror(learner.source, strict=True)
        sync_learning_plan_mirror(older, strict=True)
        learner.profile.refresh_from_db(using='enrolment')
        self.assertIn('Newer authoritative title', str(learner.profile.learning_plan),
                      'KNOWN BLOCKER: supplied stale snapshot still wins')

    def test_ACCEPTANCE_mirror_failure_must_not_report_success(self):
        from django.db import DatabaseError
        learner = self.f.learner()
        client = self.as_account(learner.account)
        # Real HTTP/source save; failure occurs within non-strict mirror's graph write.
        with patch('learner_api.active_users.replace_training_plan', side_effect=DatabaseError('synthetic mirror failure')):
            response = self.send(client, 'patch', f'/learner_api/learning-plan/{learner.source.pk}/', {'modules': []})
        self.assertGreaterEqual(response.status_code, 400,
                                'KNOWN BLOCKER: non-strict mirror failure reported success')

    def test_fresh_persisted_source_recovery_converges_without_replaying_http(self):
        from django.db import transaction
        from learner_api.models import EnrolmentUser
        from learner_api.learning_plan import sync_learning_plan_mirror
        learner = self.f.learner(selection='manual')
        with transaction.atomic(using='enrolment'):
            fresh = EnrolmentUser.all_learners.using('enrolment').select_for_update().get(pk=learner.source.pk)
            sync_learning_plan_mirror(fresh, strict=True)
        learner.profile.refresh_from_db(using='enrolment')
        self.assertIn(self.f.namespace+'-M', str(learner.profile.learning_plan))
        # This demonstrates a controlled operator sequence, not safe behavior of
        # the existing captured-object repair command or all competing writers.

    def test_source_lock_blocks_fresh_reader_until_commit(self):
        from django.db import connections, transaction
        from learner_api.models import EnrolmentUser
        learner = self.f.learner()
        locked, waiting, release = threading.Event(), threading.Event(), threading.Event()
        errors, seen = [], []

        def writer():
            try:
                with transaction.atomic(using='enrolment'):
                    row = EnrolmentUser.all_learners.using('enrolment').select_for_update().get(pk=learner.source.pk)
                    row.phone_number = 'new-synthetic-phone'
                    row.save(using='enrolment', update_fields=['phone_number'])
                    locked.set()
                    if not release.wait(8):
                        raise AssertionError('release timeout')
            except BaseException as exc:
                errors.append(type(exc).__name__)
            finally:
                connections.close_all()

        thread = threading.Thread(target=writer)
        thread.start()
        try:
            self.assertTrue(locked.wait(8))
            # Observe the source lock through a nonblocking competing lock.
            with self.assertRaises(Exception) as caught:
                with transaction.atomic(using='enrolment'):
                    EnrolmentUser.all_learners.using('enrolment').select_for_update(nowait=True).get(pk=learner.source.pk)
            from django.db import OperationalError
            self.assertIsInstance(caught.exception, OperationalError)
            waiting.set()
        finally:
            release.set()
            thread.join(20)
        if thread.is_alive():
            from .bootstrap import quarantine
            quarantine()
            raise Refused('Source writer remains alive; quarantine target')
        self.assertFalse(errors)
        with transaction.atomic(using='enrolment'):
            row = EnrolmentUser.all_learners.using('enrolment').select_for_update().get(pk=learner.source.pk)
            seen.append(row.phone_number)
        self.assertEqual(seen, ['new-synthetic-phone'])
        self.assertTrue(waiting.is_set())

    def test_concurrent_module_assignment_has_one_effective_identity(self):
        from django.urls import reverse
        from learner_api.models import EnrolmentUser
        module, learner = self.f.catalogue(), self.f.learner()
        _, staff = self.f.staff('curriculum')
        clients = [self.as_account(staff), self.as_account(staff)]
        path = reverse('curriculum-module-learner-assignments', kwargs={'identifier': module.pk})
        result = race(lambda: self.send(clients[0], 'post', path, {'learnerIds': [learner.source.pk]}),
                      lambda: self.send(clients[1], 'post', path, {'learnerIds': [learner.source.pk]}))
        self.assertEqual([result[key].status_code for key in ('left', 'right')], [200, 200])
        from learner_api.mappers import get_training_plan
        row = EnrolmentUser.all_learners.using('enrolment').get(pk=learner.source.pk)
        self.assertEqual([m['moduleId'] for m in get_training_plan(row)].count(module.pk), 1)

    def test_ACCEPTANCE_source_profile_lock_order_must_complete_without_deadlock(self):
        from django.db import transaction
        from learner_api.models import EnrolmentUser, LearnerProfile
        from learner_api.learning_plan import sync_learning_plan_mirror
        learner = self.f.learner(selection='manual')
        locks_acquired = threading.Barrier(2, timeout=8)

        def source_first():
            with transaction.atomic(using='enrolment'):
                source = EnrolmentUser.all_learners.using('enrolment').select_for_update().get(pk=learner.source.pk)
                locks_acquired.wait()
                sync_learning_plan_mirror(source, strict=True)

        def profile_first():
            with transaction.atomic(using='enrolment'):
                LearnerProfile.objects.using('enrolment').select_for_update().get(pk=learner.profile.pk)
                locks_acquired.wait()
                sync_learning_plan_mirror(learner.source, strict=True)

        # Current inverse acquisition paths can fail this acceptance assertion.
        # Bounded SQL lock timeouts prevent an unbounded hang; no retries.
        race(source_first, profile_first)

    def test_simultaneous_signatures_preserve_both_parties(self):
        from learner_api.services.training_plan_documents import sign_document
        learner = self.f.learner('apprenticeship')
        doc = self.f.document(learner)
        race(lambda: sign_document(learner.source, 'apprentice', PNG, self.f.namespace, 'Learner'),
             lambda: sign_document(learner.source, 'provider', PNG, self.f.namespace, 'Provider'))
        doc.refresh_from_db(using='enrolment')
        self.assertEqual(doc.apprentice_signature, PNG)
        self.assertEqual(doc.provider_signature, PNG)

    def test_concurrent_revocation_denies_subsequent_request(self):
        from django.utils import timezone
        from login.models import LoginSession
        learner = self.f.learner()
        client = self.as_account(learner.account)
        race(lambda: client.get('/login_api/me/'),
             lambda: LoginSession.objects.using('enrolment').filter(account=learner.account).update(revoked_at=timezone.now()))
        self.assertEqual(client.get('/login_api/me/').status_code, 401)
