"""Synthetic reconciliation and existing security rules; no app startup or DB."""
import sys
from pathlib import Path

sys.path[0] = str(Path(__file__).resolve().parent.parent)

import ast
import functools
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock
from uuid import uuid4

from learner_api.services.identity_reconciliation import (
    IdentityReconciliationError, _reconcile_locked, reconcile_identity,
)


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.uuid = uuid4()
        self.source = (17, self.uuid, " New name ", "a@example.test", None, "commercial", "00042")
        self.profile = (91, 17, self.uuid, "Old", "A@example.test", "old", "commercial", 42)
        self.cursor = Mock(rowcount=1)

    def run_pair(self, sources=None, profiles=None, apply=True):
        self.cursor.fetchall.side_effect = [sources if sources is not None else [self.source],
                                             profiles if profiles is not None else [self.profile]]
        return _reconcile_locked(self.cursor, 17, 91, self.uuid, apply=apply)

    def refused(self, code, **kwargs):
        with self.assertRaises(IdentityReconciliationError) as caught:
            self.run_pair(**kwargs)
        self.assertEqual(caught.exception.code, code)
        self.assertFalse(any(call.args[0].startswith("UPDATE") for call in self.cursor.execute.call_args_list))

    def test_independent_ids_and_exact_contact_mapping(self):
        result = self.run_pair()
        self.assertEqual((result.status, result.changed_fields), ("updated", ("full_name", "phone_number")))
        self.assertEqual(self.cursor.execute.call_args.args[1], ["New name", "", 91, 17, self.uuid])

    def test_preview_does_not_write(self):
        self.assertEqual(self.run_pair(apply=False).status, "would_update")
        self.assertEqual(self.cursor.execute.call_count, 2)

    def test_replay_no_update(self):
        self.profile = (*self.profile[:3], "New name", self.profile[4], "", *self.profile[6:])
        self.assertEqual(self.run_pair().status, "unchanged")
        self.assertEqual(self.cursor.execute.call_count, 2)

    def test_missing_rows(self):
        self.refused("missing_source", sources=[])
        self.refused("missing_profile", profiles=[])

    def test_duplicate_source_or_destination_is_not_first_match(self):
        self.refused("ambiguous_source", sources=[self.source, self.source])
        self.refused("ambiguous_profile", profiles=[self.profile, self.profile])

    def test_unlinked_or_wrong_uuid_never_healed(self):
        for index, value in ((0, 92), (1, None), (1, 18), (2, uuid4())):
            row = list(self.profile); row[index] = value
            self.refused("profile_identity_conflict", profiles=[row])

    def test_source_uuid_and_id_must_agree(self):
        for index, value in ((0, 18), (1, uuid4())):
            row = list(self.source); row[index] = value
            self.refused("source_identity_conflict", sources=[row])

    def test_existing_email_aptem_integrity_gate_retained(self):
        for index, value in ((4, "other@example.test"), (4, ""), (7, 43)):
            row = list(self.profile); row[index] = value
            self.refused("identity_review_required", profiles=[row])

    def test_no_type_change(self):
        row = list(self.profile); row[6] = "apprenticeship"
        self.refused("learner_type_conflict", profiles=[row])

    def test_invalid_identifiers_before_database_import(self):
        for source, profile, uid in ((True, 91, self.uuid), (0, 91, self.uuid), (17, -1, self.uuid), (17, 91, "bad")):
            with self.assertRaises(IdentityReconciliationError):
                reconcile_identity(source, profile, uid, using="never-opened")


def functions(path, names, scope):
    tree = ast.parse((Path(__file__).resolve().parent.parent / path).read_text(encoding="utf-8"))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in nodes} == set(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), path, "exec"), scope)


class SecurityPreservationTests(unittest.TestCase):
    def test_permission_gate_uses_current_grants_and_rejects_other_roles(self):
        account = NS(role="staff")
        current_grants = set()
        scope = dict(functools=functools, authenticate_request=lambda _: account,
                     _accesses_of=lambda _: frozenset(current_grants),
                     _forbidden=lambda _: 403, _unauthenticated=lambda _: 401)
        functions("login/permissions.py", {"require_access"}, scope)
        protected = scope["require_access"]("coach")(lambda _: 200)
        self.assertEqual(protected(NS()), 403)
        current_grants.add("coach")
        self.assertEqual(protected(NS()), 200)
        current_grants.clear()
        self.assertEqual(protected(NS()), 403)
        current_grants.add("super-admin")
        self.assertEqual(protected(NS()), 200)
        for role in ("learner", "employer"):
            account.role = role
            self.assertEqual(protected(NS()), 403)

    def test_current_grant_changes_and_demotion(self):
        scope = dict(ACCESS_SUPER_ADMIN="super-admin", ACCESS_CHOICES={"super-admin", "coach", "tutor"},
                     ROLE_ADMIN="admin", ROLE_STAFF="staff")
        functions("login/identity.py", {"role_for_staff", "access_for_staff", "parse_access_list", "accesses_for_staff"}, scope)
        staff = NS(position="Admin", access="super-admin", access_extra="")
        grants = scope["accesses_for_staff"]
        role = scope["role_for_staff"]
        self.assertEqual(role(staff.position, grants(staff)), "admin")
        staff.access = "coach"
        self.assertEqual(role(staff.position, grants(staff)), "staff")
        self.assertEqual(grants(staff), frozenset({"coach"}))
        staff.access = ""; staff.access_extra = "invalid"
        self.assertEqual(grants(staff), frozenset())
        self.assertEqual(role(staff.position, grants(staff)), "staff")

    def test_session_revocation_expiry_and_disabled_account_remain_authoritative(self):
        now = datetime.now(timezone.utc)
        manager = Mock()
        query = manager.select_related.return_value.filter.return_value
        scope = dict(LoginSession=NS(objects=manager), hash_token=lambda _: "synthetic-hash",
                     timezone=NS(now=lambda: now), event_log=Mock(), _event=Mock(), expiry_reason=lambda _: "expired")
        functions("login/sessions.py", {"resolve_session"}, scope)
        resolve = scope["resolve_session"]
        session = NS(expires_at=now + timedelta(hours=1), account=NS(is_active=True))
        query.first.return_value = session
        self.assertIs(resolve("synthetic-token"), session)
        manager.select_related.return_value.filter.assert_called_with(token_hash="synthetic-hash", revoked_at__isnull=True)
        query.first.return_value = None
        self.assertIsNone(resolve("revoked-token"))
        query.first.return_value = session
        session.account.is_active = False
        self.assertIsNone(resolve("synthetic-token"))
        session.account.is_active = True; session.expires_at = now
        self.assertIsNone(resolve("synthetic-token"))


if __name__ == "__main__":
    def guard(event, args):
        if event == "import" and args[0].split(".")[0] in {"django", "psycopg", "psycopg2"}:
            raise RuntimeError("Database/framework import forbidden")
        if event.startswith("socket.") or event in {"subprocess.Popen", "os.system"}:
            raise RuntimeError("External transport forbidden")
    sys.addaudithook(guard)
    unittest.main()
