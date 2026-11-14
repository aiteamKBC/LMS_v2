"""Login session and learner subject cache cases, for run_content_cache_postgres_tests.py.

    python curriculum_api/run_content_cache_postgres_tests.py --connection-file <json> \\
        --data-directory <dir> --cases login.postgres_phase2_cases

Not a test_*.py module: it creates tables and must never be discovered by a
normal test run. The runner has already proved the database is an empty local
PostgreSQL. The cache is one LocMemCache standing in for Valkey; two
"processes" are two readers of it with no shared in-process state.
"""
import json
import pickle
import unittest
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.db import connection, connections
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from config import cache_versions
from learner_api import subject_cache
from learner_api.models import (CommercialUser, EnrolmentUser, LearnerProfile, LearnerProgressEntry,
                                LearnerProgressKsb, LearnerTrainingPlanComponent, LearnerTrainingPlanModule,
                                LearnerTrainingPlanWeek)
from learner_api.student_activity import CURRENT_SUBJECTS_SQL
from login import session_cache, sessions
from login.models import LoginAccount, LoginSession
from login.security import hash_token


_CREATED = []


def create_tables():
    if _CREATED:
        return
    _CREATED.append(True)
    with connection.cursor() as cur:
        cur.execute('CREATE SCHEMA login; CREATE SCHEMA enrolment; CREATE SCHEMA "Learner"; CREATE SCHEMA curriculum;')
        cur.execute('CREATE TABLE curriculum.modules (module_catalogue_id text PRIMARY KEY, title text, '
                    'deleted_at timestamptz, deleted_via_parent text)')
    with connection.schema_editor() as editor:
        for model in (LoginAccount, LoginSession, EnrolmentUser, LearnerProfile, LearnerTrainingPlanModule,
                      LearnerTrainingPlanWeek, LearnerTrainingPlanComponent, LearnerProgressEntry, LearnerProgressKsb):
            editor.create_model(model)
    with connection.cursor() as cur:
        # Present on the real table, not on the model; the subject statements read it.
        cur.execute('ALTER TABLE "Learner".learner_training_plan_modules ADD COLUMN curriculum_module_id text')
        # Ledger columns the progress statements read; added by schema commands, not on the model.
        for column, kind in (('activity_status', 'text'), ('accepted', 'boolean'), ('source_system', 'text'),
                             ('reporting_ended_at', 'timestamptz'), ('curriculum_component_ref', 'text'),
                             ('component_type', 'text'), ('module_title', 'text'), ('submitted_at', 'timestamptz'),
                             ('component_ref', 'text'), ('passed', 'boolean'), ('deleted_at', 'timestamptz')):
            cur.execute(f'ALTER TABLE "Learner".learner_progress_entries ADD COLUMN IF NOT EXISTS {column} {kind}')


def truncate(*tables):
    # Not ORM deletes: their cascade walks tables this minimal schema lacks.
    with connection.cursor() as cur:
        cur.execute('TRUNCATE ' + ', '.join(tables) + ' CASCADE')


@contextmanager
def queries():
    with CaptureQueriesContext(connections['default']) as default, \
            CaptureQueriesContext(connections['enrolment']) as enrolment:
        captured = []
        yield captured
    captured.extend(q['sql'] for q in [*default.captured_queries, *enrolment.captured_queries])


def other_process():
    """Forget everything this process remembers; Valkey (the cache) stays."""
    session_cache.reset_for_tests()


def valkey_down():
    return patch.object(cache_versions, 'strict', side_effect=cache_versions.Unavailable('down'))


class SessionCacheCases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        create_tables()

    def setUp(self):
        cache.clear()
        cache_versions.reset_for_tests()
        session_cache.reset_for_tests()
        truncate('login."Login_sessions"', 'login."Login_accounts"')
        self.account = LoginAccount.objects.create(
            email='learner@example.invalid', role='learner', subject_type='learner', subject_id=1, is_active=True,
            password_hash='pbkdf2_sha256$1$salt$hash')
        self.token, self.session, _ = sessions.issue_session(self.account)

    def resolve(self):
        with queries() as sql:
            session = sessions.resolve_session(self.token)
        return session, sql

    def warm(self):
        session, sql = self.resolve()
        self.assertIsNotNone(session)
        other_process()
        return session

    def test_a_hit_reads_no_database_and_matches_the_row(self):
        from_db = self.warm()
        cached, sql = self.resolve()
        self.assertEqual(sql, [])
        for field in LoginSession._meta.concrete_fields:
            self.assertEqual(getattr(cached, field.attname), getattr(from_db, field.attname), field.name)
        for field in LoginAccount._meta.concrete_fields:
            if field.attname != 'password_hash':
                self.assertEqual(getattr(cached.account, field.attname), getattr(from_db.account, field.attname))
        self.assertIn('password_hash', cached.account.get_deferred_fields())

    def test_secrets_are_not_in_keys_or_values(self):
        self.warm()
        token_hash = hash_token(self.token)
        for key, blob in cache._cache.items():
            text = key + repr(pickle.loads(blob))
            self.assertNotIn(self.token, text)
            self.assertNotIn(token_hash, text)
            self.assertNotIn('pbkdf2_sha256', text)

    def assert_rejected_everywhere(self):
        other_process()
        session, sql = self.resolve()
        self.assertIsNone(session)
        self.assertTrue(sql, 'a rejection must come from the database, not the cache')

    def test_logout_is_immediate_in_another_process(self):
        self.warm()
        sessions.revoke_session(LoginSession.objects.get(pk=self.session.pk))
        self.assert_rejected_everywhere()

    def test_revoke_all_on_password_change(self):
        self.warm()
        self.account.password_hash = 'pbkdf2_sha256$1$salt$new'
        self.account.save(update_fields=['password_hash'])
        sessions.revoke_all_for_account(self.account)
        self.assert_rejected_everywhere()

    def test_bulk_revocation_through_the_related_manager(self):
        self.warm()
        # platform_admin.py: account.sessions.filter(...).update(revoked_at=...)
        self.account.sessions.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        self.assert_rejected_everywhere()

    def test_account_disabled_by_save_and_by_bulk_update(self):
        self.warm()
        self.account.is_active = False
        self.account.save(update_fields=['is_active'])
        self.assert_rejected_everywhere()
        LoginAccount.objects.filter(pk=self.account.pk).update(is_active=True)
        self.warm()
        LoginAccount.objects.filter(pk=self.account.pk).update(is_active=False)
        self.assert_rejected_everywhere()

    def test_role_change_shows_on_the_next_request(self):
        self.warm()
        LoginAccount.objects.filter(pk=self.account.pk).update(role='staff')
        other_process()
        session, sql = self.resolve()
        self.assertEqual(session.account.role, 'staff')
        self.assertTrue(sql)

    def test_account_delete(self):
        self.warm()
        LoginSession.objects.filter(account=self.account).delete()
        self.account.delete()
        self.assert_rejected_everywhere()

    def test_expiry_while_cached_is_enforced_without_the_database_row_changing(self):
        self.warm()
        later = self.session.expires_at + timedelta(seconds=1)
        with patch.object(sessions.timezone, 'now', return_value=later):
            session, _sql = self.resolve()
        self.assertIsNone(session)

    def test_renewal_retires_the_entry(self):
        self.warm()
        stale = timezone.now() - timedelta(seconds=sessions._LAST_SEEN_REFRESH_SECONDS + 5)
        LoginSession.objects.filter(pk=self.session.pk).update(last_seen_at=stale)
        other_process()
        session, _ = self.resolve()
        before = session.expires_at
        renewed = sessions.touch_session(session)
        self.assertIsNotNone(renewed)
        other_process()
        session, sql = self.resolve()
        self.assertTrue(sql)
        self.assertGreaterEqual(session.expires_at, before)

    def test_unknown_revoked_and_expired_tokens_are_never_cached(self):
        before = set(cache._cache)
        for token in ('not-a-real-token',):
            self.assertIsNone(sessions.resolve_session(token))
        LoginSession.objects.filter(pk=self.session.pk).update(revoked_at=timezone.now())
        self.assertIsNone(sessions.resolve_session(self.token))
        added = {key for key in set(cache._cache) - before if 'login-sess:' in key}
        self.assertEqual(added, set())

    def test_a_missing_version_key_is_a_miss(self):
        self.warm()
        cache.delete(cache_versions.version_key(session_cache.NAMESPACE, self.account.pk))
        session, sql = self.resolve()
        self.assertIsNotNone(session)
        self.assertTrue(sql, 'the entry must not be used without its version key')

    def test_versions_never_repeat_across_a_reset(self):
        self.warm()
        key = cache_versions.version_key(session_cache.NAMESPACE, self.account.pk)
        seen = {cache.get(key)}
        for _ in range(2):
            cache.delete(key)  # Valkey restart / failover / eviction of the key
            cache_versions.current(session_cache.NAMESPACE, self.account.pk)
            seen.add(cache.get(key))
            session_cache.bump_account(self.account.pk)
            seen.add(cache.get(key))
        self.assertEqual(len(seen), 5)
        # The entry built before the resets is not used.
        other_process()
        _, sql = self.resolve()
        self.assertTrue(sql)

    def test_a_revocation_between_the_two_reads_is_not_stored(self):
        token_hash = hash_token(self.token)
        first = LoginSession.objects.select_related('account').get(pk=self.session.pk)

        def reread():
            LoginSession.objects.filter(pk=self.session.pk).update(revoked_at=timezone.now())
            return LoginSession.objects.select_related('account').filter(
                token_hash=token_hash, revoked_at__isnull=True).first()
        self.assertIsNone(session_cache.remember(token_hash, first, reread))
        self.assertIsNone(cache.get(session_cache.entry_key(token_hash)))

    def test_valkey_down_answers_from_the_database(self):
        expected = sessions.resolve_session(self.token)
        with valkey_down():
            other_process()
            session, sql = self.resolve()
            self.assertTrue(sql)
            self.assertEqual(session.pk, expected.pk)
            sessions.revoke_session(LoginSession.objects.get(pk=self.session.pk))
            self.assertEqual(cache_versions.pending_count(), 1)
            self.assertIsNone(sessions.resolve_session(self.token))
        # Back up: the lost invalidation is applied before the cache is used.
        session, sql = self.resolve()
        self.assertIsNone(session)
        self.assertEqual(cache_versions.pending_count(), 0)


class SubjectCacheCases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        create_tables()
        with connection.cursor() as cur:
            cur.execute("INSERT INTO curriculum.modules VALUES ('MOD-1','One',NULL,NULL),('MOD-2','Two',NULL,NULL),"
                        "('MOD-3','Three',NULL,NULL)")

    def setUp(self):
        cache.clear()
        cache_versions.reset_for_tests()
        truncate('"Learner".learner_training_plan_components', '"Learner".learner_training_plan_weeks',
                 '"Learner".learner_training_plan_modules', '"Learner".learners', 'enrolment."Created_users"')
        self.first = EnrolmentUser.all_learners.create(
            learner_type='apprenticeship', email='a@example.invalid', training_plan=[{'moduleId': 'MOD-1'}])
        self.second = EnrolmentUser.all_learners.create(
            learner_type='commercial', email='b@example.invalid', training_plan=[{'moduleId': 'MOD-2'}])

    def rows(self, learner):
        with queries() as sql, connections['enrolment'].cursor() as cur:
            rows = subject_cache.subject_rows(cur, CURRENT_SUBJECTS_SQL, learner.pk)
        with connections['enrolment'].cursor() as cur:
            cur.execute(CURRENT_SUBJECTS_SQL, [learner.pk])
            truth = cur.fetchall()
        self.assertEqual(sorted(rows), sorted(truth))
        return sorted(rows), [q for q in sql if 'Created_users' in q]

    def assert_changed_after(self, learner, write):
        self.rows(learner)
        _, sql = self.rows(learner)
        self.assertEqual(sql, [], 'second read must be cached')
        write()
        rows, sql = self.rows(learner)
        self.assertTrue(sql, 'a write must retire the cached rows')
        return rows

    def test_hit_matches_and_learners_are_isolated(self):
        self.assertEqual(self.rows(self.first)[0], [('MOD-1', 'One')])
        self.assertEqual(self.rows(self.second)[0], [('MOD-2', 'Two')])
        self.assertEqual(self.rows(self.first), ([('MOD-1', 'One')], []))

    def test_plan_save_bulk_update_and_proxy_save(self):
        def save():
            self.first.training_plan = [{'moduleId': 'MOD-3'}]
            self.first.save()
        self.assertEqual(self.assert_changed_after(self.first, save), [('MOD-3', 'Three')])
        rows = self.assert_changed_after(self.first, lambda: EnrolmentUser.all_learners.filter(
            pk=self.first.pk).update(training_plan=[{'moduleId': 'MOD-2'}]))
        self.assertEqual(rows, [('MOD-2', 'Two')])

        def proxy_save():
            learner = CommercialUser.objects.get(pk=self.second.pk)
            learner.training_plan = [{'moduleId': 'MOD-1'}]
            learner.save()
        self.assertEqual(self.assert_changed_after(self.second, proxy_save), [('MOD-1', 'One')])

    def test_mirror_rebuild_and_profile_relink(self):
        EnrolmentUser.all_learners.filter(pk=self.first.pk).update(training_plan=None)
        profile = LearnerProfile.objects.create(enrolment_id=self.first.pk, email='a@example.invalid')
        rows = self.assert_changed_after(self.first, lambda: LearnerTrainingPlanModule.objects.bulk_create(
            [LearnerTrainingPlanModule(learner=profile, position=1, curriculum_module_id='MOD-3')]))
        self.assertEqual(rows, [('MOD-3', 'Three')])
        rows = self.assert_changed_after(self.first, lambda: LearnerTrainingPlanModule.objects.filter(
            learner=profile).delete())
        self.assertEqual(rows, [])

        LearnerTrainingPlanModule.objects.create(learner=profile, position=1, curriculum_module_id='MOD-2')
        EnrolmentUser.all_learners.filter(pk=self.second.pk).update(training_plan=None)
        self.rows(self.first)
        self.rows(self.second)

        def relink():
            profile.enrolment_id = self.second.pk
            profile.save()
        # Both the learner losing the mirror and the one gaining it are retired.
        self.assertEqual(self.assert_changed_after(self.first, relink), [])
        self.assertEqual(self.rows(self.second)[0], [('MOD-2', 'Two')])

    def test_curriculum_write_retires_titles(self):
        from curriculum_api import views

        def rename():
            with connection.cursor() as cur:
                cur.execute("UPDATE curriculum.modules SET title='Renamed' WHERE module_catalogue_id='MOD-1'")
            views.invalidate_curriculum_cache()
            views._SHARED_EPOCH_STATE['checked_at'] = 0.0
        self.assertEqual(self.assert_changed_after(self.first, rename), [('MOD-1', 'Renamed')])
        with connection.cursor() as cur:
            cur.execute("UPDATE curriculum.modules SET title='One' WHERE module_catalogue_id='MOD-1'")

    def test_missing_version_key_and_valkey_down(self):
        self.rows(self.first)
        cache.delete(cache_versions.version_key(subject_cache.NAMESPACE, self.first.pk))
        _, sql = self.rows(self.first)
        self.assertTrue(sql)
        with valkey_down():
            rows, sql = self.rows(self.first)
        self.assertEqual(rows, [('MOD-1', 'One')])
        self.assertTrue(sql)


class ProgressCacheCases(unittest.TestCase):
    """learner_api.progress_cache through its four readers."""

    @classmethod
    def setUpClass(cls):
        create_tables()

    def setUp(self):
        cache.clear()
        cache_versions.reset_for_tests()
        truncate('"Learner".learner_progress_ksbs', '"Learner".learner_progress_entries', '"Learner".learners')
        self.a = LearnerProfile.objects.create(email='p1@example.invalid')
        self.b = LearnerProfile.objects.create(email='p2@example.invalid')
        for profile, codes in ((self.a, ['K1', 'S2']), (self.b, ['B3'])):
            for order, code in enumerate(codes, 1):
                entry = LearnerProgressEntry.objects.create(
                    learner=profile, entry_order=order, kind='component', component_title=f'Activity {code}',
                    passed=True)
                with connection.cursor() as cur:
                    cur.execute('UPDATE "Learner".learner_progress_entries SET activity_status=%s, accepted=true '
                                'WHERE id=%s', ['completed', entry.pk])
                LearnerProgressKsb.objects.create(progress=entry, position=1, ksb_code=code, ksb_description=code)

    def readers(self):
        from coach_api.views import caseload_completed_ksb_codes
        from learner_api.aptem_ksb_breakdown import read_breakdown
        from learner_api.canonical_learning import read_ksb_point_counts
        return {
            'caseload': lambda: {k: sorted(v) for k, v in caseload_completed_ksb_codes([self.a, self.b]).items()},
            'breakdown': lambda: read_breakdown(connections['enrolment'], self.a.pk),
            'breakdown_code': lambda: read_breakdown(connections['enrolment'], self.a.pk, code='K1'),
            'points': lambda: read_ksb_point_counts(self.a.pk),
        }

    def progress_sql(self, fn):
        with queries() as sql:
            value = fn()
        return value, [q for q in sql if 'learner_progress_' in q]

    def truth(self, fn):
        with patch.dict('os.environ', {'LEARNER_PROGRESS_CACHE': 'false'}):
            return fn()

    def test_every_reader_matches_and_hits(self):
        for name, fn in self.readers().items():
            with self.subTest(reader=name):
                expected = json.dumps(self.truth(fn), default=str, sort_keys=True)
                first, _ = self.progress_sql(fn)
                second, sql = self.progress_sql(fn)
                self.assertEqual(json.dumps(first, default=str, sort_keys=True), expected)
                self.assertEqual(json.dumps(second, default=str, sort_keys=True), expected)
                self.assertEqual(sql, [], 'second read must be cached')

    def assert_all_refresh_after(self, write):
        readers = self.readers()
        for fn in readers.values():
            fn()
        write()
        for name, fn in readers.items():
            with self.subTest(reader=name):
                value, sql = self.progress_sql(fn)
                self.assertEqual(json.dumps(value, default=str, sort_keys=True),
                                 json.dumps(self.truth(fn), default=str, sort_keys=True))

    def test_entry_save_and_bulk_update_and_delete(self):
        entry = LearnerProgressEntry.objects.filter(learner=self.a).first()

        def save():
            entry.component_title = 'Renamed activity'
            entry.passed = False
            entry.save()
        self.assert_all_refresh_after(save)
        self.assert_all_refresh_after(lambda: LearnerProgressEntry.objects.filter(learner=self.a).update(
            deleted_at=timezone.now()))
        self.assert_all_refresh_after(lambda: LearnerProgressEntry.objects.filter(learner=self.a).update(
            deleted_at=None))
        self.assert_all_refresh_after(lambda: LearnerProgressKsb.objects.filter(progress=entry).delete())

    def test_ksb_link_bulk_create(self):
        entry = LearnerProgressEntry.objects.filter(learner=self.a).first()
        self.assert_all_refresh_after(lambda: LearnerProgressKsb.objects.bulk_create(
            [LearnerProgressKsb(progress=entry, position=9, ksb_code='K9', ksb_description='K9')]))

    def test_raw_sql_writers_bump(self):
        from learner_api.progress_cache import bump_learners

        def raw():
            with connection.cursor() as cur:
                cur.execute('UPDATE "Learner".learner_progress_ksbs SET ksb_code=%s WHERE ksb_code=%s', ['K7', 'K1'])
            bump_learners([self.a.pk])  # what each raw SQL writer now does
        self.assert_all_refresh_after(raw)

    def test_learners_are_isolated(self):
        from coach_api.views import caseload_completed_ksb_codes
        caseload_completed_ksb_codes([self.a, self.b])
        LearnerProgressKsb.objects.filter(progress__learner=self.b).update(ksb_code='B4')
        value, sql = self.progress_sql(lambda: caseload_completed_ksb_codes([self.a, self.b]))
        self.assertEqual(sorted(value[self.b.pk]), ['B4'])
        self.assertTrue(sql)

    def test_missing_version_key_valkey_down_and_transactions(self):
        from django.db import transaction
        from learner_api import progress_cache
        fn = self.readers()['breakdown']
        fn()
        cache.delete(cache_versions.version_key(progress_cache.NAMESPACE, self.a.pk))
        self.assertTrue(self.progress_sql(fn)[1])
        fn()
        with valkey_down():
            self.assertTrue(self.progress_sql(fn)[1])
        with transaction.atomic(using='enrolment'):
            self.assertTrue(self.progress_sql(fn)[1], 'no cache inside a transaction')

    def test_values_over_the_cap_are_not_cached(self):
        from learner_api import progress_cache
        fn = self.readers()['breakdown']
        with patch.object(progress_cache, 'MAX_VALUE_BYTES', 10), \
                self.assertLogs('learner_api.progress_cache', 'INFO') as logs:
            fn()
            self.assertTrue(self.progress_sql(fn)[1])
        self.assertTrue(any('not cached' in line for line in logs.output))

    def test_report_largest_value(self):
        for fn in self.readers().values():
            fn()
        sizes = [len(blob) for key, blob in cache._cache.items() if 'lprog:v1:' in key]
        print(f'\n[progress cache] entries={len(sizes)} largest_pickled_bytes={max(sizes)}', flush=True)
        self.assertTrue(sizes)
