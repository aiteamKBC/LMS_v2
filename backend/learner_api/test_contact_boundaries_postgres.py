"""Opt-in actual Django models/signals/HTTP on one disposable Neon child.

No project settings/env files, migrations, live mail/Graph/storage or real
workers. Contact refresh scopes are renamed to unique synthetic model keys;
the receivers, ORM, transactions and publication SQL themselves are real.
"""
import sys
from pathlib import Path
sys.path[0] = str(Path(__file__).resolve().parent.parent)
import ast
import copy
import ctypes
from ctypes import wintypes
import json
import os
import threading
import types
import unittest
from unittest.mock import patch

from learner_api import test_identity_reconciliation_postgres as base
from learner_api import test_contact_backfill_postgres as previous
from learner_api.services import contact_sync as sync

BRANCH = 'br-summer-bread-abwk6vcj'


def configure(envelope):
    from django.conf import settings
    from django.db.backends.signals import connection_created
    def verify_connection(sender, connection, **kwargs):
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
            if cursor.fetchone() != ('neondb', BRANCH):
                raise RuntimeError('Unapproved Django connection')
        def no_schema_change(execute, sql, params, many, context):
            import re
            if re.search(r'\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b', sql, re.I):
                raise RuntimeError('Schema operations prohibited in integration validation')
            return execute(sql, params, many, context)
        connection.execute_wrappers.append(no_schema_change)
    connection_created.connect(verify_connection, weak=False)
    original = settings.configure
    source = ast.parse((Path(__file__).resolve().parent.parent / 'config/settings.py').read_text(encoding='utf-8'))
    apps = next(ast.literal_eval(n.value) for n in source.body if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == 'INSTALLED_APPS' for t in n.targets))
    def isolated(self, **kwargs):
        kwargs['DATABASES']['default'].setdefault('OPTIONS', {})['options'] = '-c statement_timeout=20000 -c lock_timeout=5000'
        kwargs.update(INSTALLED_APPS=apps, ROOT_URLCONF='f01_contact_test_urls',
                      ALLOWED_HOSTS=['testserver'], MIDDLEWARE=[
                          'django.contrib.sessions.middleware.SessionMiddleware',
                          'django.middleware.csrf.CsrfViewMiddleware',
                          'django.contrib.auth.middleware.AuthenticationMiddleware',
                          'login.middleware.LoginSessionMiddleware',
                          'login.api_gate.ApiSessionGateMiddleware',
                          'curriculum_api.versioning.ActorMiddleware'],
                      DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'],
                      READ_MODEL_OUTBOX_ENABLED=True, USE_TZ=True, TIME_ZONE='Europe/London',
                      CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
        kwargs['DATABASES']['enrolment'] = copy.deepcopy(kwargs['DATABASES']['default'])
        original(**kwargs)
    base.BRANCH = BRANCH
    os.environ['LEARNER_API_REQUIRE_AUTH'] = '1'
    os.environ['ENROLMENT_API_REQUIRE_AUTH'] = '1'
    # The actual Curriculum AppConfig explicitly suppresses warming for test.
    with patch.object(type(settings), 'configure', isolated), patch.object(sys, 'argv', [__file__, 'test']):
        base.psycopg, base.CONFIG = base.bootstrap(envelope)
    from learner_api.services import identity_reconciliation
    base.service = identity_reconciliation
    from django.urls import path
    from learner_api import views, first_login_details, learner_import
    from enrolment_api.views import commercial_board
    urls = types.ModuleType('f01_contact_test_urls')
    urls.urlpatterns = [
        path('learner_api/enrolment-users/<int:pk>/', views.enrolment_user_detail),
        path('learner_api/enrolment-users/<int:pk>/finish/', views.enrolment_user_finish),
        path('learner_api/commercial-users/<int:pk>/', views.commercial_user_detail),
        path('learner_api/first-login-details/<int:pk>/', first_login_details.first_login_details),
        path('learner_api/enrolment-users/import/', learner_import.import_students),
        path('enrolment_api/commercial-users/<int:pk>/board/', commercial_board),
    ]
    sys.modules[urls.__name__] = urls


class BoundaryTests(previous.ContactTests):
    def activation(self, source, *, operation=None, **patches):
        from contextlib import ExitStack
        from learner_api.active_users import sync_active_user
        with ExitStack() as stack:
            stack.enter_context(patch('learner_api.apprenticeship_agreement._group_dates', return_value=(None, None, None)))
            stack.enter_context(patch('learner_api.active_users._resolve_linkable_programme_id', return_value=None))
            stack.enter_context(patch('learner_api.active_users._linkable_placement_ids', return_value=(None, None)))
            # Isolate curriculum catalogue/KSB work; profile ORM/signals and
            # identity/contact/outbox transactions remain actual production code.
            stack.enter_context(patch('learner_api.active_users.hydrate_source_training_plan', return_value=[]))
            stack.enter_context(patch('learner_api.active_users.refresh_learner_ksb_snapshot'))
            for name, value in patches.items():
                stack.enter_context(patch('learner_api.active_users.' + name, side_effect=value))
            return (operation or sync_active_user)(source)

    def ready_source(self, kind='apprenticeship'):
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Programme_status"=%s,"Learner_type"=%s WHERE id=%s',
                         ['Ready to enrol' if kind == 'apprenticeship' else 'Delivery', kind, self.source_id])
            conn.execute('UPDATE "Learner".learners SET learner_type=%s WHERE id=%s', [kind, self.profile_id])
        return self.source()

    def progress(self, source, *, strict=False):
        from datetime import date
        from learner_api.learner_progression import advance_learner
        with patch('learner_api.learner_progression._programme_start_date', return_value=date(2020, 1, 1)), \
                patch('learner_api.learner_progression._has_assigned_learning_plan', return_value=True), \
                patch('learner_api.learner_progression._has_platform_invitation', return_value=True):
            return self.activation(source, operation=lambda row: advance_learner(row, strict=strict))

    def test_recovery_failed_activation_rolls_status_back_and_normal_retry_succeeds(self):
        from django.db import DatabaseError
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                source = self.ready_source(kind)
                status, before, events = source.programme_status, self.row(), self.events()
                with patch.object(sync, 'publish_contact_refresh', side_effect=DatabaseError('synthetic outage')):
                    self.assertIsNone(self.progress(source))
                self.assertEqual(self.source().programme_status, status)
                self.assertEqual(source.programme_status, status)
                self.assertEqual(self.row(), before)
                self.assertEqual(self.events(), events)
                self.assertEqual(self.progress(source, strict=True), 'Active')
                self.assertEqual(self.source().programme_status, 'Active')
                self.assertEqual(self.row()['programme_status'], 'Active')

    def test_recovery_http_explicit_active_failure_rolls_back_other_fields(self):
        from django.db import DatabaseError
        source = self.ready_source()
        before = self.row()
        client = self.client('admin')
        with patch('learner_api.active_users.sync_active_user', return_value=None):
            response = client.patch(f'/learner_api/enrolment-users/{self.source_id}/',
                data='{"programmeStatus":"Active","phone":"07700900176"}', content_type='application/json')
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.source().programme_status, source.programme_status)
        self.assertEqual(self.source().phone_number, source.phone_number)
        self.assertEqual(self.row(), before)

    def test_recovery_non_active_status_failure_is_not_confused_with_successful_none(self):
        from django.db import DatabaseError
        source = self.ready_source()
        before = self.row()
        client = self.client('admin')
        with patch.object(sync, 'publish_contact_refresh', side_effect=DatabaseError('synthetic outage')):
            response = client.patch(f'/learner_api/enrolment-users/{self.source_id}/',
                data='{"programmeStatus":"Withdrawn"}', content_type='application/json')
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.source().programme_status, source.programme_status)
        self.assertEqual(self.row(), before)

    def test_recovery_busy_source_leaves_eligible_status_for_later_retry(self):
        source = self.ready_source()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('SELECT id FROM enrolment."Created_users" WHERE id=%s FOR UPDATE', [self.source_id])
            self.assertIsNone(self.progress(source))
        self.assertEqual(self.source().programme_status, 'Ready to enrol')
        self.assertEqual(self.progress(source), 'Active')

    def test_recovery_stale_candidate_cannot_undo_withdrawal(self):
        source = self.ready_source()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Programme_status"=%s WHERE id=%s', ['Withdrawn', self.source_id])
        before = self.row()
        self.assertIsNone(self.progress(source))
        self.assertEqual(self.source().programme_status, 'Withdrawn')
        self.assertEqual(self.row(), before)

    def test_recovery_two_concurrent_progressions_do_not_duplicate_activation(self):
        from contextlib import ExitStack
        from datetime import date
        from django.db import connections
        from learner_api.learner_progression import advance_learner
        from learner_api.models import LearnerProfile
        source = self.ready_source()
        start = threading.Barrier(2, timeout=10)
        outcomes, errors = [], []
        def action():
            try:
                candidate = self.source()
                start.wait()
                outcomes.append(advance_learner(candidate))
            except Exception as exc:
                errors.append(type(exc).__name__)
            finally:
                connections.close_all()
        def concurrently(_):
            threads = [threading.Thread(target=action) for _ in range(2)]
            for thread in threads: thread.start()
            for thread in threads: thread.join(30)
            self.worker_alive = any(thread.is_alive() for thread in threads)
            self.assertFalse(self.worker_alive, 'Preserve target; cleanup unsafe with a live worker')
        with patch('learner_api.learner_progression._programme_start_date', return_value=date(2020, 1, 1)):
            self.activation(source, operation=concurrently)
        self.assertEqual(errors, [])
        self.assertEqual(outcomes.count('Active'), 1)
        self.assertEqual(outcomes.count(None), 1)
        self.assertEqual(LearnerProfile.objects.filter(enrolment_id=self.source_id).count(), 1)
        self.assertEqual(self.source().programme_status, 'Active')

    def test_recovery_onboarding_unknown_completion_returns_retryable_error(self):
        source = self.ready_source()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Programme_status"=%s WHERE id=%s', ['Fresh user', self.source_id])
        with patch('learner_api.first_login_details._completion', return_value=(False, None)):
            response = self.client().get(f'/learner_api/first-login-details/{self.source_id}/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.source().programme_status, 'Fresh user')

    def test_recovery_finish_failure_retains_eligibility(self):
        from datetime import date
        source = self.ready_source()
        client = self.client('admin')
        from django.middleware.csrf import _get_new_csrf_string
        token = _get_new_csrf_string()
        client.cookies['csrftoken'] = token
        with patch('learner_api.learner_progression._programme_start_date', return_value=date(2020, 1, 1)), \
                patch('learner_api.active_users.sync_active_user', return_value=None):
            response = client.post(f'/learner_api/enrolment-users/{self.source_id}/finish/',
                                   HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.source().programme_status, source.programme_status)

    def test_recovery_security_projection_rejects_duplicate_source_email(self):
        from types import SimpleNamespace
        from login.identity import account_payload
        from login.learner_enrolment import AmbiguousLearnerRecord, existing_learner_record, can_add_learner_record
        from login.permissions import staff_owns_learner
        duplicate_id = 1_000_000_000 + base.uuid4().int % 900_000_000
        duplicate_uuid = base.uuid4()
        try:
            try:
                with base.psycopg.connect(**base.CONFIG) as conn:
                    conn.execute('INSERT INTO enrolment."Created_users" (id,uuid,"Username","Email","Learner_type") '
                        'OVERRIDING SYSTEM VALUE VALUES (%s,%s,%s,%s,%s)',
                        [duplicate_id, duplicate_uuid, 'Synthetic duplicate', self.email, 'commercial'])
            except base.psycopg.errors.UniqueViolation as exc:
                # Do not weaken a physical identity constraint to manufacture
                # ambiguity. The application refusal is also covered by unit tests.
                self.assertEqual(exc.diag.constraint_name, 'created_users_email_uniq')
                self.assertEqual(existing_learner_record(self.email).pk, self.source_id)
                with base.psycopg.connect(**base.CONFIG) as conn:
                    count = conn.execute('SELECT count(*) FROM enrolment."Created_users" WHERE id=%s AND uuid=%s',
                                         [duplicate_id, duplicate_uuid]).fetchone()[0]
                self.assertEqual(count, 0)
                return
            with self.assertRaises(AmbiguousLearnerRecord):
                existing_learner_record(self.email)
            account = SimpleNamespace(id=7, subject_type='staff', subject_id=17, role='staff',
                email=self.email, display_name='Synthetic', has_password=True, last_login_at=None)
            result = account_payload(account, subject=SimpleNamespace(position='Tutor', access='coach', access_extra=''))
            self.assertNotIn('learnerRecordId', result)
            self.assertEqual(result['role'], 'staff')
            self.assertFalse(staff_owns_learner(account, self.source_id))
            self.assertIn('review', can_add_learner_record(account))
        finally:
            with base.psycopg.connect(**base.CONFIG) as conn:
                conn.execute('DELETE FROM enrolment."Created_users" WHERE id=%s AND uuid=%s', [duplicate_id, duplicate_uuid])

    def test_activation_fresh_contacts_preserve_plan_and_identity(self):
        source = self.source()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Phone_number"=%s WHERE id=%s', ['07700900199', self.source_id])
        source.programme_status = 'Active'
        from django.db.models.signals import post_save
        from learner_api.models import LearnerProfile
        seen = []
        def observe(sender, instance, **kwargs):
            if instance.pk == self.profile_id:
                seen.append(instance.phone_number)
        post_save.connect(observe, sender=LearnerProfile, weak=False)
        try:
            result = self.activation(source)
        finally:
            post_save.disconnect(observe, sender=LearnerProfile)
        self.assertIsNotNone(result)
        self.assertEqual(result.pk, self.profile_id)
        self.assertEqual(result.phone_number, '07700900199')
        self.assertEqual(self.row()['phone_number'], '07700900199')
        self.assertEqual(str(result.uuid), str(self.uid))
        self.assertEqual(seen, ['07700900199'])
        self.assertTrue(self.events())

    def test_activation_refuses_legacy_link_and_conflicts_without_healing(self):
        source = self.source(); source.programme_status = 'Active'
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET enrolment_id=NULL WHERE id=%s', [self.profile_id])
        before = self.row()
        self.assertIsNone(self.activation(source))
        self.assertEqual(self.row(), before)
        self.assertEqual(self.events(), [])

    def test_activation_publication_failure_rolls_back_all_profile_changes(self):
        from django.db import DatabaseError
        source = self.source(); source.programme_status = 'Active'
        before = self.row()
        with patch.object(sync, 'publish_contact_refresh', side_effect=DatabaseError('synthetic outage')):
            self.assertIsNone(self.activation(source))
        self.assertEqual(self.row(), before)
        self.assertEqual(self.events(), [])

    def test_activation_busy_source_refused_without_waiting_or_mutation(self):
        source = self.source(); source.programme_status = 'Active'
        before = self.row()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('SELECT id FROM enrolment."Created_users" WHERE id=%s FOR UPDATE', [self.source_id])
            self.assertIsNone(self.activation(source))
        self.assertEqual(self.row(), before)

    def test_activation_legacy_apply_commands_refuse_before_database_work(self):
        from django.core.management import call_command
        from django.core.management.base import CommandError
        from io import StringIO
        for command in ('import_audit_learners', 'merge_duplicate_enrolments'):
            with self.assertRaises(CommandError):
                call_command(command, apply=True, stdout=StringIO())
        self.assertEqual(self.events(), [])

    def test_activation_worker_preflight_lease_recovery_and_dead_reporting(self):
        from io import StringIO
        from datetime import timedelta
        from django.core.management import call_command
        from django.utils import timezone
        from read_models import worker
        from read_models.models import ReadModelEvent
        from read_models.outbox import enqueue_read_model_event
        output = StringIO()
        call_command('process_read_model_events', check_contact_config=True, stdout=output)
        self.assertIn('contact_store=verified registry=verified', output.getvalue())
        key = self.prefix + 'lease-recovery'
        enqueue_read_model_event(event_type='test', model_key=key, scope_type='test', scope_id='one')
        event = ReadModelEvent.objects.get(model_key=key)
        ReadModelEvent.objects.filter(pk=event.pk).update(status='processing', locked_at=timezone.now()-timedelta(hours=1), locked_by='expired', attempts=7)
        claimed = worker.claim_events(limit=1, worker_id='recovered', model_key=key)
        self.assertEqual(len(claimed), 1)
        worker._mark_failure(claimed, RuntimeError('private'), using='default')
        event.refresh_from_db()
        self.assertEqual((event.status, event.attempts, event.last_error), ('dead', 8, 'RuntimeError'))
        self.assertEqual(worker.claim_events(limit=1, worker_id='later', model_key=key), [])

    def test_activation_cache_outage_keeps_durable_invalid_marker(self):
        from django.db import transaction
        from read_models.repository import contact_revision
        source = self.source(); source.phone_number = '07700900198'
        with patch.object(sync, 'invalidate_contact_caches', side_effect=ConnectionError('synthetic cache outage')):
            sync.save_verified_contact_fields(source, {'phone_number': source.phone_number})
        self.assertEqual(self.row()['phone_number'], '07700900198')
        self.assertTrue(contact_revision(self.prefix + 'learner.home', 'learner', f'commercial:{self.source_id}'))
        self.assertTrue(self.events())

    def test_creation_activation_keeps_existing_creation_with_stable_uuid(self):
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('DELETE FROM "Learner".learners WHERE id=%s AND uuid=%s', [self.profile_id, self.uid])
        source = self.source(); source.programme_status = 'Active'
        result = self.activation(source)
        # Track any synthetic creation even if a later assertion fails.
        from learner_api.models import LearnerProfile
        created = LearnerProfile.objects.filter(enrolment_id=self.source_id).first()
        if created is not None:
            self.profile_id = created.pk
        self.assertIsNotNone(result)
        self.assertNotEqual(result.pk, self.source_id)
        self.assertEqual((result.uuid, result.enrolment_id), (self.uid, self.source_id))
        self.assertEqual((result.full_name, result.phone_number), ('Fresh source', '123'))

    def test_creation_missing_uuid_refuses_and_disabled_worker_is_reported(self):
        from django.test import override_settings
        from django.core.management import call_command
        from django.core.management.base import CommandError
        from io import StringIO
        source = self.source(); source.uuid = None; source.programme_status = 'Active'
        before = self.row()
        self.assertIsNone(self.activation(source))
        self.assertEqual(self.row(), before)
        with override_settings(READ_MODEL_OUTBOX_ENABLED=False), self.assertRaises(CommandError):
            call_command('process_read_model_events', check_contact_config=True, stdout=StringIO())

    def test_creation_busy_profile_refuses_inverse_lock_path(self):
        source = self.source(); source.programme_status = 'Active'
        before = self.row()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [self.profile_id])
            self.assertIsNone(self.activation(source))
        self.assertEqual(self.row(), before)
        self.assertEqual(self.events(), [])

    def row(self):
        value = super().row()
        return json.loads(value) if isinstance(value, str) else value

    def events(self):
        return [(key, status, json.loads(payload) if isinstance(payload, str) else payload)
                for key, status, payload in super().events()]

    # Inherited 12 tests exercise the same final implementation with real apps.
    def setUp(self):
        super().setUp()
        publish = sync._publish_contact_scopes
        def scoped_publish(cursor, scopes, **kwargs):
            return publish(cursor, [(key if key.startswith(self.prefix) else self.prefix + key, kind, scope)
                                    for key, kind, scope in scopes], **kwargs)
        p = patch.object(sync, '_publish_contact_scopes', side_effect=scoped_publish)
        p.start(); self.addCleanup(p.stop)
        from read_models.outbox import enqueue_read_model_event
        def scoped(**kwargs):
            kwargs['model_key'] = self.prefix + kwargs['model_key']
            return enqueue_read_model_event(**kwargs)
        for module in ('learner_api.read_model', 'coach_api.read_model', 'old_otjh.read_model'):
            p = patch(module + '.enqueue_read_model_event', side_effect=scoped)
            p.start(); self.addCleanup(p.stop)
        self.account_ids = []
        self.staff_ids = []
        self.imported_sources = []

    def cleanup(self):
        if getattr(self, 'worker_alive', False):
            raise RuntimeError('Live worker: synthetic target must be preserved for inspection')
        from django.db import connections
        from curriculum_api.versioning import discard_pending
        discard_pending()
        connections.close_all()
        with base.psycopg.connect(**base.CONFIG) as conn:
            for sid in getattr(self, 'imported_sources', []):
                conn.execute('DELETE FROM login."Login_accounts" WHERE "Subject_type"=\'learner\' AND "Subject_id"=%s', [sid])
                conn.execute('DELETE FROM enrolment."Created_users" WHERE id=%s AND "Email"=%s', [sid, 'import-' + self.email])
            for aid in getattr(self, 'account_ids', []):
                conn.execute('DELETE FROM login."Login_sessions" WHERE "Account_id"=%s', [aid])
                conn.execute('DELETE FROM login."Login_accounts" WHERE id=%s', [aid])
            for sid in getattr(self, 'staff_ids', []):
                conn.execute('DELETE FROM enrolment."Staff_users" WHERE id=%s', [sid])
            # Only audit artifacts generated by this fixture, never inherited history.
            ids = [str(self.source_id), str(self.profile_id), *map(str, getattr(self, 'staff_ids', [])),
                   *map(str, getattr(self, 'imported_sources', []))]
            conn.execute('DELETE FROM curriculum.record_versions WHERE entity_id=ANY(%s) '
                         'AND entity_type IN (\'learner_record\',\'learner_profile\',\'staff_record\')', [ids])
            conn.execute('DELETE FROM curriculum.record_revisions WHERE entity_id=ANY(%s) '
                         'AND entity_type IN (\'learner_record\',\'learner_profile\',\'staff_record\')', [ids])
            conn.execute('DELETE FROM public.platform_read_models WHERE model_key=\'coach.dashboard\' AND scope_id=%s', [self.email])
        from coach_api.models import CoachDashboardSnapshot
        CoachDashboardSnapshot.objects.filter(owner_email=self.email).delete()
        super().cleanup()

    def client(self, role='learner'):
        from django.test import Client
        from login.models import LoginAccount
        from login.sessions import issue_session, COOKIE_NAME
        aid = 6_000_000_000_000 + base.uuid4().int % 1_000_000_000
        subject_id = self.source_id
        with base.psycopg.connect(**base.CONFIG) as conn:
            if role == 'admin':
                subject_id = 1_900_000_000 + base.uuid4().int % 100_000_000
                conn.execute('''INSERT INTO enrolment."Staff_users" (id,uuid,"Username","Email","Position","Access")
                    OVERRIDING SYSTEM VALUE VALUES (%s,%s,%s,%s,'Admin','super-admin')''',
                    [subject_id, base.uuid4(), 'Synthetic admin ' + self.uid.hex, 'staff-' + self.email])
                self.staff_ids.append(subject_id)
            conn.execute('''INSERT INTO login."Login_accounts"
                (id,"Subject_type","Subject_id","Email","Display_name","Role") OVERRIDING SYSTEM VALUE
                VALUES (%s,%s,%s,%s,'Synthetic account',%s)''',
                [aid, 'staff' if role == 'admin' else 'learner', subject_id, role + '-' + self.email, role])
        self.account_ids.append(aid)
        token, _, _ = issue_session(LoginAccount.objects.get(pk=aid))
        client = Client(enforce_csrf_checks=True)
        client.cookies[COOKIE_NAME] = token
        return client

    def source(self):
        from learner_api.models import EnrolmentUser
        return EnrolmentUser.all_learners.get(pk=self.source_id)

    def test_http_learner_mixed_contact_edit_and_ownership(self):
        c = self.client()
        response = c.patch(f'/learner_api/enrolment-users/{self.source_id}/',
                           data=json.dumps({'phone': '07700900123', 'dob': '2000-01-01', 'title': 'Ms'}), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(self.source().phone_number, '07700900123')
        self.assertEqual(self.row()['phone_number'], '07700900123')
        self.assertEqual(str(self.source().date_of_birth), '2000-01-01')
        self.assertNotEqual(self.source().title, 'Ms')  # forbidden field remains excluded
        denied = c.patch(f'/learner_api/enrolment-users/{self.source_id + 1}/',
                         data='{"phone":"07700900999"}', content_type='application/json')
        self.assertEqual(denied.status_code, 404)
        self.assertTrue(any(e[2].get('reason') == 'enrolment' for e in self.events()))

    def test_http_admin_and_profile_write_through(self):
        c = self.client('admin')
        response = c.patch(f'/learner_api/enrolment-users/{self.source_id}/',
                           data='{"phone":"07700900124","title":"Ms"}', content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content[:300])
        response = c.patch(f'/learner_api/commercial-users/{self.profile_id}/',
                           data='{"username":"Updated synthetic","phone":"07700900125"}', content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual((self.source().username, self.source().phone_number), ('Updated synthetic', '07700900125'))
        self.assertEqual(self.row()['full_name'], 'Updated synthetic')

    def test_http_conflict_rolls_back_mixed_fields(self):
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET email=%s WHERE id=%s', ['other-' + self.email, self.profile_id])
        before = self.source()
        response = self.client().patch(f'/learner_api/enrolment-users/{self.source_id}/',
                                       data='{"phone":"07700900126","dob":"2000-01-01"}', content_type='application/json')
        self.assertEqual(response.status_code, 502)
        self.assertEqual((self.source().phone_number, self.source().date_of_birth), (before.phone_number, before.date_of_birth))
        self.assertEqual(self.events(), [])

    def test_http_first_login_csrf_commit_and_retry(self):
        from learner_api.tests_first_login_details import VALID
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Programme_status"=\'Fresh user\', "Learner_type"=\'apprenticeship\' WHERE id=%s', [self.source_id])
            conn.execute('UPDATE "Learner".learners SET learner_type=\'apprenticeship\' WHERE id=%s', [self.profile_id])
        c = self.client()
        url = f'/learner_api/first-login-details/{self.source_id}/'
        self.assertEqual(c.post(url, data=json.dumps(VALID), content_type='application/json').status_code, 403)
        get = c.get(url)
        self.assertEqual(get.status_code, 200)
        token = c.cookies['csrftoken'].value
        response = c.post(url, data=json.dumps(VALID), content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(self.row()['phone_number'], VALID['phone'])
        count = len(self.events())
        retry = c.post(url, data=json.dumps(VALID), content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(len(self.events()), count)

    def test_shared_cache_rejects_build_crossing_contact_commit(self):
        from django.db import connections, transaction
        from read_models.repository import contact_revision, put_read_model, invalidate_contact_projection
        key = self.prefix + 'freshness'
        old = contact_revision(key, 'test', 'one')
        with transaction.atomic(using='enrolment'):
            with connections['enrolment'].cursor() as cur:
                invalidate_contact_projection(cur, key, 'test', 'one')
        self.assertIsNone(put_read_model(key, 'test', 'one', {'phone': 'old'}, schema_version=1,
                                        ttl_seconds=30, expected_contact_revision=old))
        current = contact_revision(key, 'test', 'one')
        self.assertIsNotNone(put_read_model(key, 'test', 'one', {'phone': 'new'}, schema_version=1,
                                           ttl_seconds=30, expected_contact_revision=current))

    def test_http_commercial_board_contact_sync(self):
        response = self.client().patch(f'/enrolment_api/commercial-users/{self.source_id}/board/',
                                       data='{"phone":"07700900127"}', content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(self.row()['phone_number'], '07700900127')

    def test_http_unlinked_profile_stays_profile_only(self):
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET enrolment_id=NULL WHERE id=%s', [self.profile_id])
        before = self.source().phone_number
        response = self.client('admin').patch(f'/learner_api/commercial-users/{self.profile_id}/',
                                              data='{"phone":"07700900128"}', content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertIsNone(self.row()['enrolment_id'])
        self.assertEqual(self.source().phone_number, before)
        self.assertEqual(self.row()['phone_number'], '07700900128')

    def test_http_revoked_session_cannot_edit(self):
        from login.models import LoginSession
        from django.utils import timezone
        c = self.client()
        LoginSession.objects.filter(account_id=self.account_ids[-1]).update(revoked_at=timezone.now())
        before = self.row()
        response = c.patch(f'/learner_api/enrolment-users/{self.source_id}/',
                           data='{"phone":"07700900129"}', content_type='application/json')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.row(), before)

    def test_http_bulk_import_creates_only_unlinked_source(self):
        from io import BytesIO
        from openpyxl import Workbook
        from django.core.files.uploadedfile import SimpleUploadedFile
        from learner_api.models import EnrolmentUser, LearnerProfile
        book = Workbook(); sheet = book.active; sheet.title = 'Students'
        sheet.append(['First name', 'Surname', 'Email', 'Mobile', 'Case owner', 'First session date'])
        sheet.append(['Synthetic', 'Imported', 'import-' + self.email, '07700900130',
                      'Synthetic admin ' + self.uid.hex, '2027-02-04'])
        data = BytesIO(); book.save(data); book.close()
        def upload():
            return SimpleUploadedFile('contacts.xlsx', data.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        c = self.client('admin')
        preview = c.post('/learner_api/enrolment-users/import/', {'file': upload(), 'dryRun': 'true'}, HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        self.assertEqual(preview.status_code, 200, preview.content[:300])
        response = c.post('/learner_api/enrolment-users/import/', {'file': upload(), 'dryRun': 'false'}, HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        rows = list(EnrolmentUser.all_learners.filter(email='import-' + self.email))
        self.imported_sources.extend(row.pk for row in rows)
        self.assertEqual(response.status_code, 201, response.content[:300])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].phone_number, '07700900130')
        self.assertFalse(LearnerProfile.objects.filter(enrolment_id=rows[0].pk).exists())
        repeated = c.post('/learner_api/enrolment-users/import/', {'file': upload(), 'dryRun': 'false'}, HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        self.assertEqual(repeated.status_code, 400)

    def test_legacy_coach_publication_and_redis_cannot_cross_contact_change(self):
        from django.db import DatabaseError
        from django.core.cache import cache
        from coach_api.services.dashboard.service import CoachDashboardService
        from coach_api import dashboard_cache
        from coach_api.models import CoachDashboardSnapshot
        from read_models.repository import invalidate_contact_projection
        def invalidate():
            with base.psycopg.connect(**base.CONFIG) as conn:
                with conn.cursor() as cursor:
                    invalidate_contact_projection(cursor, 'coach.dashboard', 'coach', self.email)
        service = CoachDashboardService(self.email)
        def stale(_self):
            invalidate()
            return {'learners': [], 'contactTest': 'stale'}
        with patch.object(CoachDashboardService, 'build_live', stale):
            with self.assertRaises(DatabaseError):
                service.refresh()
        self.assertFalse(CoachDashboardSnapshot.objects.filter(owner_email=self.email).exists())
        cache.set(dashboard_cache.coach_dashboard_cache_key(self.email), {'contactTest': 'stale'})
        self.assertIsNone(dashboard_cache.get_cached_coach_dashboard(self.email))
        with patch.object(CoachDashboardService, 'build_live', return_value={'learners': [], 'contactTest': 'current'}):
            self.assertEqual(service.refresh()['contactTest'], 'current')
        self.assertEqual(service.build()['contactTest'], 'current')

    def test_worker_does_not_steal_renewed_lease_or_complete_unclaimed(self):
        from read_models import worker
        from read_models.models import ReadModelEvent
        from read_models.outbox import enqueue_read_model_event
        key = self.prefix + 'lease'
        enqueue_read_model_event(event_type='test', model_key=key, scope_type='test', scope_id='one')
        first = worker.claim_events(limit=1, worker_id='first', model_key=key)
        ReadModelEvent.objects.filter(pk=first[0].pk).update(locked_by='second')
        worker._mark_failure(first, RuntimeError('synthetic private message'), using='default')
        self.assertEqual(ReadModelEvent.objects.get(pk=first[0].pk).locked_by, 'second')

    def test_extra_commit_callbacks_discarded_on_rollback(self):
        from django.db import transaction
        before = self.row()
        with self.assertRaises(RuntimeError):
            with transaction.atomic(using='enrolment'):
                user = self.source(); user.phone_number = '07700900132'
                sync.save_verified_contact_fields(user, {'phone_number': user.phone_number})
                self.invalidate.assert_not_called()
                raise RuntimeError('synthetic rollback')
        self.invalidate.assert_not_called()
        self.assertEqual(self.row(), before)
        self.assertEqual(self.events(), [])
        with transaction.atomic(using='enrolment'):
            user = self.source(); user.phone_number = '07700900133'
            sync.save_verified_contact_fields(user, {'phone_number': user.phone_number})
            self.invalidate.assert_not_called()
        self.invalidate.assert_called_once()
        self.assertEqual(self.row()['phone_number'], '07700900133')

    def test_extra_worker_command_status_failure_and_lost_lease(self):
        from io import StringIO
        from django.core.management import call_command
        from django.core.management.base import CommandError
        from read_models import worker
        from read_models.models import ReadModelEvent
        from read_models.registry import ReadModelSpec, register
        from read_models.outbox import enqueue_read_model_event
        key = self.prefix + 'command'
        def fail(scope):
            raise RuntimeError('synthetic private value')
        from unittest.mock import Mock
        builder = Mock(side_effect=fail)
        register(ReadModelSpec(model_key=key, scope_type='test', schema_version=1, ttl_seconds=30, builder=builder))
        enqueue_read_model_event(event_type='test', model_key=key, scope_type='test', scope_id='one')
        with patch.object(worker, 'purge_processed_events'):
            with self.assertRaises(CommandError):
                call_command('process_read_model_events', model=key, stdout=StringIO())
        event = ReadModelEvent.objects.get(model_key=key)
        self.assertEqual((event.status, event.last_error), ('retry', 'RuntimeError'))
        output = StringIO()
        call_command('process_read_model_events', model=key, status=True, stdout=output)
        self.assertIn('status=retry count=1', output.getvalue())
        self.assertNotIn('synthetic private value', output.getvalue())
        from django.utils import timezone
        ReadModelEvent.objects.filter(pk=event.pk).update(available_at=timezone.now())
        def stolen(scope):
            ReadModelEvent.objects.filter(pk=event.pk).update(locked_by='replacement')
            return {'ok': True}
        builder.side_effect = stolen
        with patch.object(worker, 'purge_processed_events'):
            result = worker.process_once(model_key=key, worker_id='original')
        self.assertEqual((result['completed'], result['failed']), (0, 1))
        self.assertEqual(ReadModelEvent.objects.get(pk=event.pk).locked_by, 'replacement')


if __name__ == '__main__':
    try:
        if sys.stdin.isatty() and os.name == 'nt':
            import msvcrt
            handle = msvcrt.get_osfhandle(sys.stdin.fileno()); mode = wintypes.DWORD()
            if not ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)) or not ctypes.windll.kernel32.SetConsoleMode(handle, mode.value & ~4):
                raise RuntimeError('Private stdin unavailable')
        print('READY_FOR_PRIVATE_STDIN', flush=True)
        def guard(event, args):
            if event in {'subprocess.Popen', 'os.system'}:
                raise RuntimeError('External process forbidden')
            if event == 'open' and Path(str(args[0])).name.startswith('.env'):
                raise RuntimeError('Environment-file reads forbidden')
        sys.addaudithook(guard)
        import requests, smtplib
        requests.sessions.Session.request = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('External HTTP forbidden'))
        smtplib.SMTP = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('External mail forbidden'))
        envelope = json.loads(sys.stdin.readline())
        configure(envelope)
        # Schema metadata only, on the already verified disposable child. This
        # is destination evidence, not permission to migrate or use these tables.
        with base.psycopg.connect(**base.CONFIG, options='-c default_transaction_read_only=on') as conn:
            destinations = conn.execute("SELECT table_name,column_name,data_type FROM information_schema.columns "
                "WHERE table_schema='Learner' AND (table_name='learners' OR table_name ~* "
                "'(auth|session|account|onboard|signature|permission|role|security)') "
                "ORDER BY table_name,ordinal_position").fetchall()
        print(json.dumps({'learner_destination_columns': destinations}), flush=True)
        before = base.fingerprint()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(BoundaryTests)
        if envelope.get('focus') == 'http':
            suite = unittest.TestSuite(test for test in suite if test._testMethodName.startswith('test_http_'))
        elif envelope.get('focus') == 'bulk':
            suite = unittest.TestSuite([BoundaryTests('test_http_bulk_import_creates_only_unlinked_source')])
        elif envelope.get('focus') == 'supplement':
            suite = unittest.TestSuite(test for test in suite if test._testMethodName.startswith('test_extra_'))
            suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(base.ReconciliationPostgresTests))
        elif envelope.get('focus') == 'activation':
            suite = unittest.TestSuite(test for test in suite if test._testMethodName.startswith(('test_activation_', 'test_creation_')))
        elif envelope.get('focus') == 'recovery':
            suite = unittest.TestSuite(test for test in suite if test._testMethodName.startswith('test_recovery_'))
        elif envelope.get('focus') == 'creation':
            suite = unittest.TestSuite(test for test in suite if test._testMethodName.startswith('test_creation_'))
        result = unittest.TextTestRunner(verbosity=2, failfast=True).run(suite)
        intact = before == base.fingerprint()
        print(json.dumps(dict(tests=result.testsRun, failures=len(result.failures), errors=len(result.errors), inherited_unchanged=intact)), flush=True)
        sys.exit(0 if intact and result.wasSuccessful() else 1)
    except Exception as exc:
        import traceback
        print(json.dumps(dict(status='FAIL', error_type=type(exc).__name__,
                             locations=[(Path(f.filename).name, f.name, f.lineno) for f in traceback.extract_tb(exc.__traceback__)[-5:]])), flush=True)
        sys.exit(2)
