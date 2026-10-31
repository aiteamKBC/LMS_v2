"""Phase 1 characterization: execute selected current functions, never app startup.

Only stdlib imports; ORM, clock, and event effects are doubles. These tests do
not prove Django routing, PostgreSQL semantics, HTTP gates, or proposed DDL.
"""
import ast
import builtins
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


ROOT = Path(__file__).resolve().parents[1]


def load_function(path, name, scope):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    # Selected functions must remain undecorated; no framework controls removed.
    if node.decorator_list:
        raise AssertionError("Review decorated function before isolated execution")
    # Characterize the original disabled branch without importing Django.
    # Enabled integration has separate real middleware/PostgreSQL coverage.
    def import_disabled(name, globals=None, locals=None, fromlist=(), level=0):
        if level == 1 and tuple(fromlist) == ('learner_auth_runtime',):
            return SimpleNamespace(learner_auth_runtime=SimpleNamespace(enabled=lambda: False))
        return builtins.__import__(name, globals, locals, fromlist, level)
    scope['__builtins__'] = {**vars(builtins), '__import__': import_disabled}
    exec(compile(ast.Module(body=[node], type_ignores=[]), path, "exec"), scope)
    return scope[name]


class SessionReadBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 22, tzinfo=timezone.utc)
        self.manager = Mock()
        self.row = SimpleNamespace(expires_at=self.now + timedelta(hours=1),
                                   account=SimpleNamespace(is_active=True))
        self.manager.select_related.return_value.filter.return_value.first.return_value = self.row
        self.scope = dict(LoginSession=SimpleNamespace(objects=self.manager),
                          hash_token=Mock(return_value="synthetic-hash"),
                          timezone=SimpleNamespace(now=lambda: self.now),
                          event_log=Mock(), _event=Mock(), expiry_reason=lambda row: "expired_idle")
        self.resolve = load_function("login/sessions.py", "resolve_session", self.scope)

    def test_empty_token_never_queries(self):
        self.assertIsNone(self.resolve(""))
        self.manager.select_related.assert_not_called()

    def test_token_hash_and_revocation_filter_with_joined_account(self):
        self.assertIs(self.resolve("synthetic-token"), self.row)
        self.manager.select_related.assert_called_once_with("account")
        self.manager.select_related.return_value.filter.assert_called_once_with(
            token_hash="synthetic-hash", revoked_at__isnull=True)
        self.scope["hash_token"].assert_called_once_with("synthetic-token")

    def test_unknown_or_revoked_lookup_result_refused(self):
        self.manager.select_related.return_value.filter.return_value.first.return_value = None
        self.assertIsNone(self.resolve("synthetic-token"))

    def test_expiry_boundary_refused(self):
        for delta in (0, -1):
            self.row.expires_at = self.now + timedelta(seconds=delta)
            self.assertIsNone(self.resolve("synthetic-token"))

    def test_inactive_account_refused(self):
        self.row.account.is_active = False
        self.assertIsNone(self.resolve("synthetic-token"))

    def test_read_failure_not_misreported_as_missing(self):
        self.manager.select_related.side_effect = RuntimeError("synthetic unavailable")
        with self.assertRaises(RuntimeError):
            self.resolve("synthetic-token")

    def test_bulk_revocation_preserves_current_session_exception(self):
        revoke = load_function("login/sessions.py", "revoke_all_for_account", self.scope)
        account = SimpleNamespace(id=17)
        live = self.manager.filter.return_value
        live.exclude.return_value.update.return_value = 2
        self.assertEqual(revoke(account, except_session_id=23), 2)
        self.manager.filter.assert_called_once_with(account=account, revoked_at__isnull=True)
        live.exclude.assert_called_once_with(pk=23)
        live.exclude.return_value.update.assert_called_once_with(revoked_at=self.now)


class AccountReadBoundaryTests(unittest.TestCase):
    def test_learner_subject_lookup_projects_only_auth_payload_fields(self):
        row = SimpleNamespace(pk=17)
        projected = Mock()
        projected.get.return_value = row
        manager = Mock()
        manager.only.return_value = projected
        learner_model = SimpleNamespace(all_learners=manager, DoesNotExist=LookupError)
        fetch = load_function("login/identity.py", "fetch_subject", dict(
            SUBJECT_LEARNER="learner", EnrolmentUser=learner_model,
            attach_programme_name=lambda source: source,
            subject_model=lambda _subject_type: learner_model,
        ))

        self.assertIs(fetch("learner", 17), row)
        manager.only.assert_called_once_with(
            "learner_type", "aptem_id",
            "email", "username", "preferred_name",
        )
        projected.get.assert_called_once_with(pk=17)

    def test_email_lookup_refuses_zero_or_multiple_accounts(self):
        for matches in ([], [object()], [object(), object()]):
            manager = Mock()
            manager.filter.return_value = matches
            lookup = load_function("login/identity.py", "account_for_email", dict(
                LoginAccount=SimpleNamespace(objects=manager),
                normalize_email=lambda value: value.strip().lower()))
            result = lookup(" TEST@EXAMPLE.TEST ")
            self.assertIs(result, matches[0] if len(matches) == 1 else None)
            manager.filter.assert_called_once_with(email="test@example.test", is_active=True)

    def test_staff_learner_link_refuses_duplicate_email(self):
        class Ambiguous(Exception):
            pass
        manager = Mock()
        manager.filter.return_value = [SimpleNamespace(pk=17), SimpleNamespace(pk=18)]
        lookup = load_function("login/learner_enrolment.py", "existing_learner_record", dict(
            EnrolmentUser=SimpleNamespace(all_learners=manager),
            normalize_email=lambda value: value.strip().lower(), AmbiguousLearnerRecord=Ambiguous))
        with self.assertRaises(Ambiguous):
            lookup("test@example.test")


class CanonicalIdentityBoundaryTests(unittest.TestCase):
    def setUp(self):
        class IdentityError(Exception):
            def __init__(self, message, code, status):
                self.code, self.status = code, status
                super().__init__(message)
        self.error = IdentityError
        self.scope = {}
        load_function("learner_api/selectors/identity.py", "validate_profile", self.scope)
        self.lookup = load_function("learner_api/selectors/identity.py", "profile_for_enrolment", self.scope)
        self.owner = dict(id=510, enrolment_id=271, email="test@example.test", aptem_id=3582,
                          account_record_id=271, account_email="test@example.test", account_aptem_id="003582")

    def test_current_cross_schema_evidence_is_not_silently_removed(self):
        query = Mock(return_value=[self.owner])
        self.assertIs(self.lookup(271, query=query, error_type=self.error), self.owner)
        sql, params = query.call_args.args
        self.assertIn('LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id', sql)
        self.assertIn('WHERE l.enrolment_id=%s', sql)
        self.assertEqual(params, [271])
        self.assertNotEqual(self.owner["id"], params[0])

    def test_missing_duplicate_or_inconsistent_identity(self):
        self.assertIsNone(self.lookup(271, query=Mock(return_value=[]), error_type=self.error))
        for records in ([self.owner, self.owner],
                        [{**self.owner, "account_record_id": None}],
                        [{**self.owner, "account_email": "other@example.test"}],
                        [{**self.owner, "account_aptem_id": "9999"}]):
            with self.assertRaises(self.error) as caught:
                self.lookup(271, query=Mock(return_value=records), error_type=self.error)
            self.assertEqual((caught.exception.code, caught.exception.status),
                             ("identity_review_required", 409))


if __name__ == "__main__":
    unittest.main()
