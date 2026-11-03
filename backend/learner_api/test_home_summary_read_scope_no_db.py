"""Home summary C1: identical canonical SELECTs are reused within one request.

Database and network are prohibited. Only the lowest SQL layer
(old_otjh.repository._query_rows) is mocked, so the real canonical readers,
cache key, deep copy and write invalidation are exercised. Counts here are
mocked statement counts, not PostgreSQL timings.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from old_otjh import repository
from . import canonical_learning
from . import overview_week as week

ENROLMENT = 101


def owner_row(enrolment_id=ENROLMENT, profile_id=70, email='learner@example.test'):
    return {'id': profile_id, 'enrolment_id': enrolment_id, 'aptem_id': None, 'programme_id': 'P1',
            'name': 'Synthetic', 'programme': 'Programme', 'coach_name': None, 'coach_email': None,
            'email': email, 'start_date': None, 'end_date': None, 'learner_type': 'commercial',
            'account_record_id': enrolment_id, 'account_email': email, 'account_aptem_id': None,
            'programme_planned_hours': None, 'learner_start_date': None, 'learner_end_date': None,
            'progress_transfer_active': False}


class Statements:
    """Answers each SELECT by learner parameter and counts real executions."""

    def __init__(self):
        self.calls = []

    def __call__(self, alias, sql, params):
        self.calls.append((sql, tuple(params)))
        if 'FROM "Learner".learners l' in sql and 'WHERE l.enrolment_id=%s' in sql:
            return [owner_row(enrolment_id=params[0], profile_id=params[0] - 31)]
        return []

    def count(self, fragment):
        return sum(fragment in sql for sql, _ in self.calls)


def home_sequence():
    """The duplicated canonical reads home-summary performs (overview_week.py:478,
    module_progress.py:128 for identity; metrics + home_progress.py:217 for the ledger)."""
    owner = canonical_learning.require_profile(ENROLMENT)
    canonical_learning.entries_for(owner, lineage_only=True)
    again = canonical_learning.require_profile(ENROLMENT)
    canonical_learning.entries_for(again, lineage_only=True)
    return owner, again


class ReadScopeReuseTests(SimpleTestCase):
    def run_sequence(self, *, scoped):
        statements = Statements()
        with patch.object(repository, '_query_rows', side_effect=statements):
            if scoped:
                with repository.request_read_scope():
                    result = home_sequence()
            else:
                result = home_sequence()
        return statements, result

    def test_identity_and_ledger_reads_execute_once_inside_the_scope(self):
        before, (owner_before, _) = self.run_sequence(scoped=False)
        after, (owner_after, again) = self.run_sequence(scoped=True)
        owner_sql = 'WHERE l.enrolment_id=%s'
        self.assertEqual(before.count(owner_sql), 2)
        self.assertEqual(after.count(owner_sql), 1)
        ledger_before = len(before.calls) - before.count(owner_sql)
        ledger_after = len(after.calls) - after.count(owner_sql)
        self.assertGreater(ledger_before, 0)
        self.assertEqual(ledger_after * 2, ledger_before)      # every ledger statement once
        self.assertEqual(owner_after, owner_before)              # identical values
        self.assertEqual(again, owner_after)

    def test_cached_rows_are_copies_so_no_stale_or_shared_mutation(self):
        statements = Statements()
        with patch.object(repository, '_query_rows', side_effect=statements), repository.request_read_scope():
            first = canonical_learning.require_profile(ENROLMENT)
            first['email'] = 'mutated@example.test'
            second = canonical_learning.require_profile(ENROLMENT)
        self.assertEqual(second['email'], 'learner@example.test')

    def test_another_learner_never_receives_cached_rows(self):
        statements = Statements()
        with patch.object(repository, '_query_rows', side_effect=statements), repository.request_read_scope():
            a = canonical_learning.require_profile(ENROLMENT)
            b = canonical_learning.require_profile(ENROLMENT + 1)
        self.assertEqual((a['enrolment_id'], b['enrolment_id']), (ENROLMENT, ENROLMENT + 1))
        self.assertEqual(statements.count('WHERE l.enrolment_id=%s'), 2)

    def test_a_write_through_the_repository_clears_the_cache(self):
        statements = Statements()
        with patch.object(repository, '_query_rows', side_effect=statements), repository.request_read_scope():
            canonical_learning.require_profile(ENROLMENT)
            repository.query('UPDATE "Learner".learners SET email=email WHERE id=%s', [70])
            canonical_learning.require_profile(ENROLMENT)
        self.assertEqual(statements.count('WHERE l.enrolment_id=%s'), 2)

    def test_nothing_survives_the_scope(self):
        statements = Statements()
        with patch.object(repository, '_query_rows', side_effect=statements):
            with repository.request_read_scope():
                canonical_learning.require_profile(ENROLMENT)
            self.assertIsNone(repository._read_scope.get())
            canonical_learning.require_profile(ENROLMENT)
        self.assertEqual(statements.count('WHERE l.enrolment_id=%s'), 2)


class ViewScopeTests(SimpleTestCase):
    """Only section=home-summary opens the scope; the gate is unchanged."""

    learner = SimpleNamespace(role='learner', subject_id=ENROLMENT, subject_type='learner', is_active=True)
    staff = SimpleNamespace(role='staff', subject_id=900, subject_type='staff', is_active=True)

    def call(self, account, section, kind='commercial'):
        seen = {}

        def read_week(source, **kwargs):
            seen['scope'] = repository._read_scope.get()
            seen['kwargs'] = kwargs
            return {'weekStart': '2026-11-02', 'weekEnd': '2026-11-08', 'modules': [], 'homeProgress': {}}

        model = type('Model', (), {'all_learners': MagicMock(), 'DoesNotExist': LookupError})
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(pk=ENROLMENT)
        params = {'section': section} if section else {}
        request = RequestFactory().get(f'/learner_api/overview-week/{kind}/{ENROLMENT}/', params)
        with patch.dict(week.SOURCE_MODELS, {kind: model}), \
                patch('login.permissions._auth_gate_enabled', return_value=True), \
                patch('login.permissions.session_unreadable', return_value=False), \
                patch('login.permissions.authenticate_request', return_value=account), \
                patch.object(week, 'read_week', side_effect=read_week):
            response = week.overview_week(request, kind=kind, pk=ENROLMENT)
        return response, seen

    def test_home_summary_reads_inside_a_fresh_scope_for_both_kinds_and_roles(self):
        scopes = []
        for kind in ('commercial', 'apprenticeship'):
            for account in (self.learner, self.staff):
                with self.subTest(kind=kind, role=account.role):
                    response, seen = self.call(account, 'home-summary', kind)
                    self.assertEqual(response.status_code, 200)
                    self.assertIsNotNone(seen['scope'])
                    self.assertEqual(seen['kwargs'], {'home_kind': kind, 'home_summary': True})
                    scopes.append(seen['scope'])
                    self.assertIsNone(repository._read_scope.get())       # reset after the request
        self.assertEqual(len({id(scope[0]) for scope in scopes}), len(scopes))  # never shared across requests

    def test_other_sections_are_unchanged(self):
        for section in (None, 'home', 'dashboard'):
            with self.subTest(section=section):
                _, seen = self.call(self.learner, section)
                self.assertIsNone(seen['scope'])

    def test_gate_is_unchanged(self):
        other = SimpleNamespace(role='learner', subject_id=ENROLMENT + 1, subject_type='learner', is_active=True)
        for account, status in ((other, 404), (None, 401)):
            with self.subTest(status=status):
                response, seen = self.call(account, 'home-summary')
                self.assertEqual(response.status_code, status)
                self.assertNotIn('scope', seen)

    def test_employer_fallback_calls_read_week_without_the_scope(self):
        from . import employer_portal
        seen = {}

        def read_week(source, **kwargs):
            seen['scope'] = repository._read_scope.get()
            seen['kwargs'] = kwargs
            return {'homeProgress': {'otjh': {'actual': 1}}}

        with patch.object(week, 'read_week', side_effect=read_week), \
                patch('django.db.close_old_connections'), patch('django.db.connections') as connections:
            result = employer_portal._read_employer_home_progress(SimpleNamespace(learner_type='commercial'))
        self.assertEqual(result, {'otjh': {'actual': 1}})
        self.assertIsNone(seen['scope'])
        self.assertEqual(seen['kwargs'], {'home_kind': 'commercial', 'home_summary': True})
        connections.close_all.assert_called_once()
