"""Canonical notification regression cases; run with the isolated PostgreSQL runner.

The previous notification suite is retained here with canonical fixtures. The
only changed expectations are retained history and explicit schema provisioning.
"""
import os
import importlib
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from contextlib import ExitStack
from unittest.mock import patch
from django.db import connection, connections, IntegrityError, transaction
from django.test import TestCase, RequestFactory
from curriculum_api import views, tutor_notifications


def fixture_schema():
    return '''CREATE SCHEMA curriculum;
        CREATE TABLE curriculum.tutors(id varchar(128) PRIMARY KEY,name text,email text);
        CREATE TABLE curriculum.modules(module_catalogue_id varchar(128) PRIMARY KEY,
            tutor_id varchar(128) REFERENCES curriculum.tutors(id) ON DELETE RESTRICT,
            title text,programme_name text,cohort_id text,group_id text,
            sessions_number integer,start_date date,end_date date,status text DEFAULT 'active');
        CREATE TABLE curriculum.cohorts(cohort_id text PRIMARY KEY,cohort_name text,start_date date,end_date date);
        CREATE TABLE curriculum.groups(group_id text PRIMARY KEY,group_name text,coach_name text,
            session_week_day text,session_start_time text,session_end_time text);
        CREATE TABLE curriculum.weeks(id text PRIMARY KEY,module_catalogue_id text,status text DEFAULT 'active');
        CREATE TABLE curriculum.components(id text PRIMARY KEY,week_id text,expected_otjh numeric,status text DEFAULT 'active');'''


class TutorAssignmentNotificationTests(TestCase):
    def setUp(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('lms.notification_test',true)")
            if cursor.fetchone()[0] != 'isolated':
                raise RuntimeError('Use scripts/test_tutor_notifications_postgres.py; synthetic fixture database required.')
        self.patches = ExitStack()
        self.addCleanup(self.patches.close)
        self.patches.enter_context(patch.object(views, 'safe_authoring_module_rows',
            side_effect=lambda: views.fetch_all('SELECT * FROM curriculum.modules')))
        self.patches.enter_context(patch.object(views, 'authoring_fetch_all',
            side_effect=lambda table: views.fetch_all(f'SELECT * FROM {views.table_name(table)}')))
        # No independent staff directory may be consulted for notifications.
        self.patches.enter_context(patch.object(views, 'get_staff_profile_rows',
            side_effect=AssertionError('Notification identity must come from curriculum.tutors')))
        views.reset_schema_ready_flags()
        tutor_notifications.provision_notification_table()

    def seed_tutor(self, name='Amira Hassan', email='amira@example.com', tutor_id='T1'):
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO curriculum.tutors(id,name,email) VALUES (%s,%s,%s) '
                'ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email', [tutor_id,name,email])
        return {'id':tutor_id,'name':name,'email':email}

    def seed_delivery(self, module_id='MOD-ALPHA', title='Data Handling', tutor_id=None):
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.cohorts(cohort_id,cohort_name,start_date,end_date) VALUES ('COH-1','September 2026','2026-09-01','2027-06-30') ON CONFLICT DO NOTHING")
            cursor.execute("INSERT INTO curriculum.groups(group_id,group_name,coach_name,session_week_day,session_start_time,session_end_time) VALUES ('GRP-1','Group A','Sam Coach','Tuesday','09:00','12:00') ON CONFLICT DO NOTHING")
            cursor.execute('''INSERT INTO curriculum.modules(module_catalogue_id,title,tutor_id,
                programme_name,cohort_id,group_id,sessions_number,start_date,end_date)
                VALUES (%s,%s,%s,'Data Analyst L4','COH-1','GRP-1',8,'2026-09-08','2026-11-03')
                ON CONFLICT(module_catalogue_id) DO UPDATE SET tutor_id=excluded.tutor_id''', [module_id,title,tutor_id])
            cursor.execute('INSERT INTO curriculum.weeks(id,module_catalogue_id) VALUES (%s,%s) ON CONFLICT DO NOTHING', [module_id,module_id])
            cursor.execute('INSERT INTO curriculum.components(id,week_id,expected_otjh) VALUES (%s,%s,24) ON CONFLICT DO NOTHING', [module_id,module_id])

    def update_modules(self, table, where, params, payload):
        with connection.cursor() as cursor:
            cursor.execute('UPDATE curriculum.modules SET '+','.join(f'{key}=%s' for key in payload)+' WHERE '+where, [*payload.values(),*params])

    def sent_mail(self):
        return patch.object(tutor_notifications.email_azure,'send_mail',return_value=(True,None))

    def test_name_and_email_changes_preserve_history_and_use_current_recipient(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        before = tutor_notifications.ledger_rows()[0]
        self.seed_tutor('Renamed Tutor', 'new@example.com')
        self.assertEqual(tutor_notifications.ledger_rows()[0], before)
        self.assertEqual(tutor_notifications.tutor_email_status(['MOD-ALPHA'], 'T1')['emailed'], 1)
        with self.sent_mail() as send:
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        self.assertEqual(send.call_args.kwargs['to'], 'new@example.com')
        after = tutor_notifications.ledger_rows()[0]
        self.assertEqual(after['id'], before['id'])
        self.assertEqual(after['created_at'], before['created_at'])
        self.assertEqual(after['attempts'], 2)

    def test_same_display_name_is_not_the_same_identity(self):
        self.seed_tutor()
        self.seed_tutor(email='second@example.com', tutor_id='T2')
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        self.assertEqual(tutor_notifications.tutor_email_status(['MOD-ALPHA'], 'T2')['emailed'], 0)
        self.update_modules('modules', 'module_catalogue_id=%s', ['MOD-ALPHA'], {'tutor_id':'T2'})
        self.assertIsNone(tutor_notifications.module_tutor_status('MOD-ALPHA')['lastSent'])
        with self.sent_mail() as send:
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        self.assertEqual(send.call_args.kwargs['to'], 'second@example.com')
        self.assertEqual(len(tutor_notifications.ledger_rows()), 2)

    def test_transport_exception_is_a_recorded_failed_attempt(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with patch.object(tutor_notifications.email_azure,'send_mail',side_effect=RuntimeError('synthetic')):
            self.assertEqual(tutor_notifications.send_tutor_email(['MOD-ALPHA'])[1], 502)
        row = tutor_notifications.ledger_rows()[0]
        self.assertEqual((row['status'],row['attempts']), ('failed',1))

    def test_fk_restrict_and_missing_references(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        for sql in ("DELETE FROM curriculum.modules WHERE module_catalogue_id='MOD-ALPHA'",
                    "DELETE FROM curriculum.tutors WHERE id='T1'",
                    "INSERT INTO curriculum.tutor_module_notifications(tutor_id,module_catalogue_id) VALUES ('missing','MOD-ALPHA')",
                    "INSERT INTO curriculum.tutor_module_notifications(tutor_id,module_catalogue_id) VALUES ('T1','missing')",
                    "INSERT INTO curriculum.tutor_module_notifications(tutor_id,module_catalogue_id) VALUES ('T1','MOD-ALPHA')"):
            with self.assertRaises(IntegrityError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(sql)
        self.assertEqual(len(tutor_notifications.ledger_rows()),1)
        self.assertEqual(views.permanent_delete_reference_blockers('module','MOD-ALPHA')['tutorNotifications'],1)

    def test_status_endpoints_roles_and_canonical_contract(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        factory = RequestFactory()
        for role, expected in [('staff',200),('admin',200),('learner',403),('tutor',403),('coach',403),('employer',403)]:
            with patch('login.permissions.authenticate_request',return_value=SimpleNamespace(role=role)):
                response = tutor_notifications.modules_tutor_email(factory.get('/',{'moduleIds':'MOD-ALPHA','tutorId':'T1'}))
                self.assertEqual(response.status_code,expected)
        with patch('login.permissions.authenticate_request',return_value=SimpleNamespace(role='staff')):
            response = tutor_notifications.modules_tutor_email(factory.get('/',{'moduleIds':'MOD-ALPHA','tutor':'Amira Hassan'}))
            self.assertEqual(response.status_code,400)
            response = tutor_notifications.modules_tutor_email(factory.get('/',{'moduleIds':'MOD-ALPHA','tutorId':'missing'}))
            self.assertEqual(response.status_code,404)
            response = tutor_notifications.modules_tutor_email(factory.get('/',{'moduleIds':'MOD-ALPHA','options':'1'}))
            self.assertEqual(json.loads(response.content)['assignments'],[{'moduleId':'MOD-ALPHA','tutorId':'T1'}])

    def test_former_tutor_remains_restrict_protected_by_notification_history(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        self.update_modules('modules','module_catalogue_id=%s',['MOD-ALPHA'],{'tutor_id':None})
        before = tutor_notifications.ledger_rows()
        with self.assertRaises(IntegrityError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("DELETE FROM curriculum.tutors WHERE id='T1'")
        self.assertEqual(tutor_notifications.ledger_rows(), before)

    def test_programme_delete_cannot_wipe_notification_history_to_bypass_restrict(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        before = tutor_notifications.ledger_rows()
        attempted = []

        def delete(table, where, params):
            attempted.append(table)
            self.assertNotEqual(table,'tutor_module_notifications')
            with connection.cursor() as cursor:
                cursor.execute(f'DELETE FROM {views.table_name(table)} WHERE {where} RETURNING *',params)
                return cursor.fetchall()

        plan = {'candidates':['PROG-1'],'childIds':{'moduleIds':['MOD-ALPHA']}}
        # Only the retained notification/module relationship is in this fixture.
        # Exercise the real orchestration and FK, not unrelated content cleanup.
        with patch.object(views,'table_exists',side_effect=lambda table: table in {'modules','tutor_module_notifications'}), \
                patch.object(views,'delete_rows',side_effect=delete), \
                patch.object(views,'refuse_if_programme_owns_content'), \
                patch.object(views,'unhook_programme_reusables'), \
                self.assertRaises(IntegrityError), transaction.atomic():
            views.permanently_delete_programme_structure(plan)
        self.assertEqual(attempted,['modules'])
        self.assertEqual(tutor_notifications.ledger_rows(),before)
        self.assertIsNotNone(tutor_notifications.module_tutor_status('MOD-ALPHA'))

    def test_normalized_migration_is_read_only_and_preserves_entire_rows(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        before = tutor_notifications.ledger_rows()
        migration = importlib.import_module('curriculum_api.migrations.0100_normalized_tutor_notifications')
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as queries:
            migration.forwards(None,SimpleNamespace(connection=connection))
        self.assertTrue(all(q['sql'].lstrip().upper().startswith('SELECT') for q in queries))
        self.assertEqual(tutor_notifications.ledger_rows(),before)

    def test_historical_migration_then_forward_schema_on_clean_database(self):
        with connection.cursor() as cursor:
            cursor.execute('DROP TABLE curriculum.tutor_module_notifications')
        editor = SimpleNamespace(connection=connection)
        importlib.import_module('curriculum_api.migrations.0049_tutor_module_notifications').apply_schema(None,editor)
        importlib.import_module('curriculum_api.migrations.0100_normalized_tutor_notifications').forwards(None,editor)
        tutor_notifications.ensure_notification_table()
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            self.assertEqual(tutor_notifications.send_tutor_email(['MOD-ALPHA'])[1],200)

    def test_invalid_legacy_migration_refuses_without_deleting_history(self):
        with connection.cursor() as cursor:
            cursor.execute('DROP TABLE curriculum.tutor_module_notifications')
        editor = SimpleNamespace(connection=connection)
        importlib.import_module('curriculum_api.migrations.0049_tutor_module_notifications').apply_schema(None,editor)
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.tutor_module_notifications(id,tutor_id,module_catalogue_id) VALUES ('legacy','missing','missing')")
        before = tutor_notifications.ledger_rows()
        with self.assertRaises(RuntimeError):
            importlib.import_module('curriculum_api.migrations.0100_normalized_tutor_notifications').forwards(None,editor)
        self.assertEqual(tutor_notifications.ledger_rows(),before)

    def test_valid_legacy_rows_keep_status_counts_and_timestamps(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with connection.cursor() as cursor:
            cursor.execute('DROP TABLE curriculum.tutor_module_notifications')
        editor = SimpleNamespace(connection=connection)
        importlib.import_module('curriculum_api.migrations.0049_tutor_module_notifications').apply_schema(None,editor)
        with connection.cursor() as cursor:
            cursor.execute("""INSERT INTO curriculum.tutor_module_notifications
                (id,tutor_id,module_catalogue_id,status,attempts,detail,created_at,updated_at)
                VALUES ('old|composite','T1','MOD-ALPHA','failed',7,'synthetic history',
                        '2025-01-02 10:00','2025-04-05 11:00')""")
        before = tutor_notifications.ledger_rows()[0]
        importlib.import_module('curriculum_api.migrations.0100_normalized_tutor_notifications').forwards(None,editor)
        after = tutor_notifications.ledger_rows()[0]
        for column in ('tutor_id','module_catalogue_id','status','attempts','detail','created_at','updated_at'):
            self.assertEqual(after[column],before[column])
        self.assertNotEqual(str(after['id']),before['id'])

    def test_bootstrap_and_seed_never_overwrite_existing_history(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        before = tutor_notifications.ledger_rows()
        tutor_notifications.provision_notification_table()
        tutor_notifications.seed_existing_assignments()
        self.assertEqual(tutor_notifications.ledger_rows(),before)

    # -- tests -------------------------------------------------------------

    def test_assignment_mail_carries_the_full_delivery_context(self):
        """The mail has to answer "what, for whom, when" without opening the LMS."""
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')

        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()

        send.assert_called_once()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs['to'], 'amira@example.com')
        self.assertIn('Data Handling', kwargs['subject'])

        body = kwargs['text_body']
        self.assertIn('Data Handling', body)
        self.assertIn('MOD-ALPHA', body)
        self.assertIn('Data Analyst L4', body)
        self.assertIn('September 2026', body)
        self.assertIn('Group A', body)
        # Schedule falls back to the group when the module row carries none.
        self.assertIn('Tuesday 09:00-12:00', body)
        self.assertIn('2026-09-08 to 2026-11-03', body)
        self.assertRegex(body, r'Sessions:\s+8')
        self.assertRegex(body, r'OTJ hours:\s+24 hours')
        self.assertIn('Sam Coach', body)
        self.assertIn('Data Handling', kwargs['html_body'])

    def test_the_same_assignment_is_not_mailed_twice(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')

        with self.sent_mail():
            tutor_notifications.dispatch_assignment_notifications()
        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()

        send.assert_not_called()

    def test_several_modules_saved_together_produce_one_mail(self):
        """A wizard save that attaches three modules is one assignment, not three."""
        self.seed_tutor()
        self.seed_delivery(module_id='MOD-A', title='Module A', tutor_id='T1')
        self.seed_delivery(module_id='MOD-B', title='Module B', tutor_id='T1')
        self.seed_delivery(module_id='MOD-C', title='Module C', tutor_id='T1')

        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()

        send.assert_called_once()
        body = send.call_args.kwargs['text_body']
        self.assertIn('Module A', body)
        self.assertIn('Module B', body)
        self.assertIn('Module C', body)
        self.assertIn('3 modules', send.call_args.kwargs['subject'])

    def test_a_tutor_with_no_email_is_skipped_and_stays_notifiable(self):
        """No address is not a delivered notification — record nothing, retry later."""
        self.seed_tutor(email='')
        self.seed_delivery(tutor_id='T1')

        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()
        send.assert_not_called()
        self.assertEqual(tutor_notifications.ledger_rows(), [])

        self.seed_tutor(email='amira@example.com')
        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()
        send.assert_called_once()

    def test_reassignment_after_removal_preserves_notification_history(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.dispatch_assignment_notifications()

        self.update_modules(
            views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-ALPHA'],
            {'tutor_id': None},
        )
        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()
        send.assert_not_called()
        self.assertEqual(len(tutor_notifications.ledger_rows()), 1)

        self.update_modules(
            views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-ALPHA'],
            {'tutor_id': 'T1'},
        )
        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()
        send.assert_not_called()

    def test_a_failed_send_is_retried_then_given_up_on(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')

        failing = patch.object(
            tutor_notifications.email_azure, 'send_mail', return_value=(False, 'graph 503')
        )
        for _ in range(tutor_notifications.MAX_SEND_ATTEMPTS):
            with failing as send:
                tutor_notifications.dispatch_assignment_notifications()
                send.assert_called_once()

        with failing as send:
            tutor_notifications.dispatch_assignment_notifications()
        send.assert_not_called()

    def test_a_deleted_module_is_not_mailed_and_retains_its_ledger_row(self):
        """A module removed from the programme is not a teaching assignment."""
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.dispatch_assignment_notifications()

        self.update_modules(
            views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-ALPHA'],
            {'status': 'inactive'},
        )
        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()
        send.assert_not_called()
        self.assertEqual(len(tutor_notifications.ledger_rows()), 1)

    def test_assignments_predating_the_ledger_are_seeded_rather_than_mailed(self):
        """First deployment must not mail every tutor their whole back catalogue."""
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with connection.cursor() as cursor:
            cursor.execute(
                'drop table if exists '
                + views.table_name(tutor_notifications.NOTIFICATION_TABLE)
            )
        views.reset_schema_ready_flags()
        tutor_notifications.provision_notification_table()

        with self.sent_mail() as send:
            tutor_notifications.dispatch_assignment_notifications()

        send.assert_not_called()
        rows = tutor_notifications.ledger_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['status'], 'seeded')

    def test_assigning_a_tutor_no_longer_mails_them(self):
        """Assignment emails are sent from the module workspace, never on save.

        save_tree_group_modules and every other assignment path still reach
        notify_staff_assignment_change; it now schedules nothing.
        """
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')

        with self.sent_mail() as send:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                views.notify_staff_assignment_change()
        send.assert_not_called()
        self.assertEqual(callbacks, [])
        self.assertEqual(tutor_notifications.ledger_rows(), [])

    def test_staff_email_the_tutor_of_one_module_on_request(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        self.assertEqual(tutor_notifications.module_tutor_status('MOD-ALPHA'), {
            'moduleId': 'MOD-ALPHA', 'tutor': {'name': 'Amira Hassan', 'hasEmail': True}, 'lastSent': None,
        })

        with self.sent_mail() as send:
            payload, status = tutor_notifications.send_module_tutor_email('MOD-ALPHA')
        self.assertEqual((status, payload['sent'], payload['tutor']), (200, True, 'Amira Hassan'))
        send.assert_called_once()
        self.assertEqual(send.call_args.kwargs['to'], 'amira@example.com')
        self.assertIn('Data Handling', send.call_args.kwargs['text_body'])
        self.assertEqual(tutor_notifications.module_tutor_status('MOD-ALPHA')['lastSent']['status'], 'sent')

        # Sending again is allowed (the button asks first) and still one row.
        with self.sent_mail() as send:
            tutor_notifications.send_module_tutor_email('MOD-ALPHA')
        send.assert_called_once()
        self.assertEqual(len(tutor_notifications.ledger_rows()), 1)

    def test_several_deliveries_of_one_module_are_one_email(self):
        """A drawer save that attaches three groups is one decision, not three.

        The tutor is put on one delivery per group in a single save, and
        `email_azure.tutor_assignment_message` has always taken a list for
        exactly this. Three mails in the same second would describe the same
        assignment three times.
        """
        self.seed_tutor()
        self.seed_delivery(module_id='MOD-ALPHA', title='Data Handling', tutor_id='T1')
        self.seed_delivery(module_id='MOD-BETA', title='Statistics', tutor_id='T1')

        with self.sent_mail() as send:
            payload, status = tutor_notifications.send_tutor_email(['MOD-ALPHA', 'MOD-BETA'])

        self.assertEqual((status, payload['sent'], payload['modules']), (200, True, 2))
        send.assert_called_once()
        body = send.call_args.kwargs['text_body']
        self.assertIn('Data Handling', body)
        self.assertIn('Statistics', body)
        # One mail, but each module keeps its own ledger row so the workspace can
        # still say when that module last went out.
        self.assertEqual(len(tutor_notifications.ledger_rows()), 2)
        for module_id in ('MOD-ALPHA', 'MOD-BETA'):
            self.assertEqual(tutor_notifications.module_tutor_status(module_id)['lastSent']['status'], 'sent')

    def test_the_same_delivery_named_twice_is_still_one_entry(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail() as send:
            payload, status = tutor_notifications.send_tutor_email(['MOD-ALPHA', 'MOD-ALPHA', ''])
        self.assertEqual((status, payload['modules']), (200, 1))
        send.assert_called_once()
        self.assertEqual(len(tutor_notifications.ledger_rows()), 1)

    def test_modules_with_different_tutors_are_refused_not_split(self):
        """Who the one mail is addressed to has to be unambiguous."""
        self.seed_tutor()
        self.seed_tutor('Ben Carter', 'ben@example.com', tutor_id='T2')
        self.seed_delivery(module_id='MOD-ALPHA', title='Data Handling', tutor_id='T1')
        self.seed_delivery(module_id='MOD-BETA', title='Statistics', tutor_id='T2')

        with self.sent_mail() as send:
            payload, status = tutor_notifications.send_tutor_email(['MOD-ALPHA', 'MOD-BETA'])
        self.assertEqual(status, 409)
        self.assertIn('same tutor', payload['error'])
        send.assert_not_called()
        self.assertEqual(tutor_notifications.ledger_rows(), [])

    def test_naming_no_module_sends_nothing(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail() as send:
            payload, status = tutor_notifications.send_tutor_email([])
        self.assertEqual(status, 400)
        send.assert_not_called()

    def test_the_tick_reads_its_state_from_the_ledger_not_from_the_drawer(self):
        """Nothing sent yet reads as unchecked; a send makes it checked."""
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')

        before = tutor_notifications.tutor_email_status(['MOD-ALPHA'], 'T1')
        self.assertEqual((before['total'], before['emailed'], before['lastSentAt']), (1, 0, None))
        self.assertEqual(before['tutor'], {'name': 'Amira Hassan', 'hasEmail': True})

        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])

        after = tutor_notifications.tutor_email_status(['MOD-ALPHA'], 'T1')
        self.assertEqual((after['total'], after['emailed']), (1, 1))
        self.assertTrue(after['lastSentAt'])
        self.assertTrue(after['deliveries'][0]['emailed'])

    def test_a_failed_send_does_not_count_as_emailed(self):
        """The ledger records the attempt; the tutor still heard nothing."""
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with patch.object(tutor_notifications.email_azure, 'send_mail', return_value=(False, 'graph 503')):
            _payload, status = tutor_notifications.send_tutor_email(['MOD-ALPHA'])
        self.assertEqual(status, 502)

        state = tutor_notifications.tutor_email_status(['MOD-ALPHA'], 'T1')
        self.assertEqual(state['emailed'], 0)
        self.assertIsNone(state['lastSentAt'])
        # The attempt is visible, but it is not a notification.
        self.assertEqual(state['deliveries'][0]['lastSent']['status'], 'failed')

    def test_the_previous_tutor_emailed_state_never_carries_over(self):
        self.seed_tutor()
        self.seed_tutor('Ben Carter', 'ben@example.com', tutor_id='T2')
        self.seed_delivery(tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])

        self.assertEqual(tutor_notifications.tutor_email_status(['MOD-ALPHA'], 'T1')['emailed'], 1)
        # The drawer asking about the tutor somebody just picked, before it is
        # saved onto the module. Amira's record is hers and says nothing here.
        handed_over = tutor_notifications.tutor_email_status(['MOD-ALPHA'], 'T2')
        self.assertEqual((handed_over['emailed'], handed_over['lastSentAt']), (0, None))
        self.assertEqual(handed_over['tutor'], {'name': 'Ben Carter', 'hasEmail': True})

    def test_a_partly_notified_module_reports_the_mix(self):
        """Two deliveries, one told: neither "emailed" nor "not emailed"."""
        self.seed_tutor()
        self.seed_delivery(module_id='MOD-ALPHA', title='Data Handling', tutor_id='T1')
        self.seed_delivery(module_id='MOD-BETA', title='Statistics', tutor_id='T1')
        with self.sent_mail():
            tutor_notifications.send_tutor_email(['MOD-ALPHA'])

        mixed = tutor_notifications.tutor_email_status(['MOD-ALPHA', 'MOD-BETA'], 'T1')
        self.assertEqual((mixed['total'], mixed['emailed']), (2, 1))
        self.assertEqual(
            {d['moduleId']: d['emailed'] for d in mixed['deliveries']},
            {'MOD-ALPHA': True, 'MOD-BETA': False},
        )

        # Finishing the job covers both in one message, and the mix resolves.
        with self.sent_mail() as send:
            tutor_notifications.send_tutor_email(['MOD-ALPHA', 'MOD-BETA'])
        send.assert_called_once()
        done = tutor_notifications.tutor_email_status(['MOD-ALPHA', 'MOD-BETA'], 'T1')
        self.assertEqual((done['total'], done['emailed']), (2, 2))

    def test_a_manual_send_explains_why_it_cannot_go(self):
        self.seed_delivery(tutor_id=None)
        with self.sent_mail() as send:
            payload, status = tutor_notifications.send_module_tutor_email('MOD-ALPHA')
            self.assertEqual(status, 409)
            self.assertIn('Assign a tutor', payload['error'])
            self.seed_tutor(email='')
            self.seed_delivery(tutor_id='T1')
            payload, status = tutor_notifications.send_module_tutor_email('MOD-ALPHA')
            self.assertEqual(status, 409)
            self.assertIn('no email address', payload['error'])
            self.assertEqual(tutor_notifications.send_module_tutor_email('MOD-MISSING')[1], 404)
        send.assert_not_called()

    def test_a_failed_manual_send_is_reported_and_recorded(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        with patch.object(tutor_notifications.email_azure, 'send_mail', return_value=(False, 'mailbox unavailable')):
            payload, status = tutor_notifications.send_module_tutor_email('MOD-ALPHA')
        self.assertEqual((status, payload['code']), (502, 'send_failed'))
        self.assertEqual(tutor_notifications.module_tutor_status('MOD-ALPHA')['lastSent']['status'], 'failed')

    def test_nothing_is_sent_while_the_transaction_is_still_open(self):
        """A save that rolls back must not have told anybody it happened."""
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')

        with self.sent_mail() as send:
            with self.captureOnCommitCallbacks(execute=False):
                views.notify_staff_assignment_change()
            send.assert_not_called()

    def test_the_feature_can_be_switched_off(self):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')

        with patch.dict(os.environ, {'TUTOR_ASSIGNMENT_EMAILS': 'false'}):
            with self.sent_mail() as send:
                tutor_notifications.dispatch_assignment_notifications()
        send.assert_not_called()




class NotificationConcurrencyTests(unittest.TestCase):
    setUp = TutorAssignmentNotificationTests.setUp
    seed_tutor = TutorAssignmentNotificationTests.seed_tutor
    seed_delivery = TutorAssignmentNotificationTests.seed_delivery
    sent_mail = TutorAssignmentNotificationTests.sent_mail

    def tearDown(self):
        # The runner verifies a newly created disposable cluster before importing
        # this suite; setUp also checks its connection marker before any writes.
        with connection.cursor() as cursor:
            for table in ('tutor_module_notifications','components','weeks','modules','tutors','groups','cohorts'):
                cursor.execute(f'DELETE FROM curriculum.{table}')

    def concurrent(self, manual):
        self.seed_tutor()
        self.seed_delivery(tutor_id='T1')
        self.seed_delivery(module_id='MOD-BETA',tutor_id='T1')
        barrier = Barrier(4)
        def worker(index):
            try:
                barrier.wait(timeout=10)
                if manual:
                    ids = ['MOD-ALPHA','MOD-BETA'] if index % 2 else ['MOD-BETA','MOD-ALPHA']
                    return tutor_notifications.send_tutor_email(ids)[1]
                return tutor_notifications._dispatch()
            finally:
                connections.close_all()
        with self.sent_mail() as send, ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(worker,range(4)))
        self.assertEqual(send.call_count,4 if manual else 1)
        if manual:
            self.assertEqual(results,[200]*4)
        rows = tutor_notifications.ledger_rows()
        self.assertEqual(len(rows),2)
        self.assertEqual({row['attempts'] for row in rows},{4 if manual else 1})
        self.assertEqual({row['status'] for row in rows},{'sent'})
        self.assertEqual(len({row['id'] for row in rows}),2)

    def test_concurrent_manual_resends_keep_every_attempt(self):
        self.concurrent(True)

    def test_concurrent_reconcile_claims_each_pair_once(self):
        self.concurrent(False)
