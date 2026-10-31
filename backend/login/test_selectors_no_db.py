"""Synthetic Phase 1 contracts. Stdlib only; no Django or database runner.

These validate result/refusal semantics and emitted SQL, not PostgreSQL, grants,
physical table existence, writer consistency or HTTP integration.
"""
import ast
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import re
import sys
# Direct script invocation must not shadow stdlib selectors (used by socket).
sys.path = [entry for entry in sys.path if Path(entry).resolve() != Path(__file__).parent]
import unittest
from unittest.mock import Mock


PATH = Path(__file__).with_name("selectors.py")
sys.path.insert(0, str(PATH.parents[1]))
spec = importlib.util.spec_from_file_location("phase1_auth_selectors", PATH)
reads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reads)
NOW = datetime(2026, 10, 22, tzinfo=timezone.utc)
ACCOUNT = dict(account_id=17, subject_type="learner", subject_id=271,
               email="synthetic@example.test", display_name="Synthetic",
               stored_role="learner", is_active=True, last_login_at=None,
               has_password=False)
SESSION = dict(ACCOUNT, session_id=93, expires_at=NOW + timedelta(hours=1),
               revoked_at=None, created_at=NOW - timedelta(days=90),
               last_seen_at=None, remember=False)
SUBJECT = dict(account_id=17, subject_type="learner", subject_id=271,
               subject_present=True)
GRANTS = dict(account_id=18, staff_subject_id=72, email="staff@example.test",
              position="Tutor",
              primary_access="coach", access_extra="tutor")
LINK = dict(account_id=17, canonical_profile_id=510, legacy_enrolment_id=271,
            learner_type="commercial", relationship="self",
            subject_type="learner", subject_id=271, profile_count=1)
TOKEN = dict(ACCOUNT, token_id=44, token_email="synthetic@example.test",
             expires_at=NOW + timedelta(hours=1), used_at=None)


class AccountTests(unittest.TestCase):
    def test_email_ambiguity_across_roles(self):
        staff = dict(ACCOUNT, account_id=18, subject_type="staff")
        for method in (reads.account_for_email, reads.password_account_for_email):
            for rows in ([], [ACCOUNT], [ACCOUNT, staff]):
                with self.subTest(method=method.__name__, rows=len(rows)):
                    query = Mock(return_value=rows)
                    result = method(" SYNTHETIC@EXAMPLE.TEST ", query=query)
                    self.assertEqual(result, ACCOUNT if len(rows) == 1 else None)
                    sql, params = query.call_args.args
                    self.assertEqual(params, ["synthetic@example.test"])
                    self.assertIn('a."Is_active" = TRUE LIMIT 2', sql)
                    self.assertNotIn('"Subject_type" =', sql)

    def test_credentials_are_an_explicit_separate_projection(self):
        query = Mock(return_value=[])
        reads.account_for_email("a@example.test", query=query)
        sql = query.call_args.args[0]
        self.assertNotIn('AS password_hash', sql)
        self.assertNotIn('AS locked_until', sql)
        reads.password_account_for_email("a@example.test", query=query)
        sql = query.call_args.args[0]
        for field in ("password_hash", "password_set_at", "failed_attempts", "locked_until"):
            self.assertIn("AS " + field, sql)

    def test_subject_lookup_keeps_inactive_and_namespace(self):
        query = Mock(return_value=[dict(ACCOUNT, is_active=False)])
        row = reads.account_for_subject("learner", 271, query=query)
        self.assertFalse(row["is_active"])
        self.assertEqual(query.call_args.args[1], ["learner", 271])
        self.assertNotIn('"Is_active" = TRUE', query.call_args.args[0])
        self.assertEqual((row["account_id"], row["subject_id"]), (17, 271))

    def test_duplicate_subject_refused(self):
        with self.assertRaises(reads.IdentityReviewRequired):
            reads.account_for_subject("learner", 271, query=Mock(return_value=[ACCOUNT, ACCOUNT]))

    def test_result_cannot_be_mutated_or_saved(self):
        source = dict(ACCOUNT)
        row = reads.account_for_email("synthetic@example.test", query=Mock(return_value=[source]))
        source["is_active"] = False
        self.assertTrue(row["is_active"])
        with self.assertRaises(TypeError):
            row["is_active"] = False
        self.assertFalse(hasattr(row, "save"))


class SessionTests(unittest.TestCase):
    def test_empty_digest_does_not_query(self):
        query = Mock()
        self.assertIsNone(reads.session_with_account("", now=NOW, query=query))
        query.assert_not_called()

    def test_active_legacy_expiry_window_is_not_clamped(self):
        query = Mock(return_value=[SESSION])
        self.assertEqual(reads.session_with_account("synthetic-digest", now=NOW, query=query), SESSION)
        sql, params = query.call_args.args
        self.assertIn('a.id = s."Account_id"', sql)
        self.assertIn('s."Revoked_at" IS NULL', sql)
        self.assertEqual(params, ["synthetic-digest"])
        self.assertNotIn("AS password_hash", sql)

    def test_invalid_sessions_refused(self):
        for rows in ([], [dict(SESSION, revoked_at=NOW)],
                     [dict(SESSION, expires_at=NOW)],
                     [dict(SESSION, expires_at=NOW - timedelta(seconds=1))],
                     [dict(SESSION, is_active=False)]):
            with self.subTest(rows=bool(rows)):
                self.assertIsNone(reads.session_with_account("digest", now=NOW, query=Mock(return_value=rows)))

    def test_duplicate_digest_refused(self):
        with self.assertRaises(reads.IdentityReviewRequired):
            reads.session_with_account("digest", now=NOW, query=Mock(return_value=[SESSION, SESSION]))


class IdentityAndOwnershipTests(unittest.TestCase):
    def test_verified_subject_has_source_id_not_profile_id(self):
        row = reads.subject_identity_for_account(17, query=Mock(return_value=[SUBJECT]))
        self.assertEqual(row["subject_id"], 271)
        self.assertNotIn("canonical_profile_id", row)

    def test_subject_missing_unverified_duplicate_refused(self):
        self.assertIsNone(reads.subject_identity_for_account(17, query=Mock(return_value=[])))
        for rows in ([SUBJECT, SUBJECT], [dict(SUBJECT, subject_present=False)],
                     [dict(SUBJECT, subject_id=None)]):
            with self.assertRaises(reads.IdentityReviewRequired):
                reads.subject_identity_for_account(17, query=Mock(return_value=rows))

    def test_grants_refresh_without_cached_role_fallback(self):
        query = Mock(side_effect=[[GRANTS], [dict(GRANTS, primary_access=None, access_extra="")]])
        self.assertEqual(reads.staff_grants_for_actor(18, query=query)["primary_access"], "coach")
        row = reads.staff_grants_for_actor(18, query=query)
        self.assertIsNone(row["primary_access"])
        self.assertEqual(row["access_extra"], "")
        self.assertEqual(query.call_count, 2)
        self.assertNotIn('"Role"', query.call_args.args[0])

    def test_missing_unverified_grants_fail_closed(self):
        for rows in ([], [dict(GRANTS, staff_subject_id=None)]):
            self.assertIsNone(reads.staff_grants_for_actor(18, query=Mock(return_value=rows)))
        with self.assertRaises(reads.IdentityReviewRequired):
            reads.staff_grants_for_actor(18, query=Mock(return_value=[GRANTS, GRANTS]))

    def test_self_and_staff_study_keep_three_namespaces(self):
        for row in (LINK, dict(LINK, learner_type="apprenticeship"),
                    dict(LINK, account_id=18, subject_id=72,
                               subject_type="staff", relationship="staff_self")):
            query = Mock(return_value=[row])
            result = reads.learner_link_for_actor(row["account_id"], query=query)
            self.assertEqual(result["legacy_enrolment_id"], 271)
            self.assertEqual(result["canonical_profile_id"], 510)
            self.assertEqual(result["account_id"], row["account_id"])
            self.assertEqual(query.call_args.args[1], [row["account_id"]])

    def test_link_missing_duplicate_revoked_and_wrong_identity(self):
        self.assertIsNone(reads.learner_link_for_actor(17, query=Mock(return_value=[])))
        for rows in ([LINK, LINK], [dict(LINK, legacy_enrolment_id=None)],
                     [dict(LINK, profile_count=2)], [dict(LINK, subject_id=510)],
                     [dict(LINK, subject_type="employer")]):
            with self.assertRaises(reads.IdentityReviewRequired):
                reads.learner_link_for_actor(17, query=Mock(return_value=rows))

    def test_target_and_actor_and_relationship_are_all_bound(self):
        for relationship, kind in (("coach", "staff"), ("employer", "employer")):
            query = Mock(return_value=[dict(LINK, relationship=relationship, subject_type=kind)])
            result = reads.relationship_for_target(17, 271, relationship, query=query)
            self.assertEqual(result["relationship"], relationship)
            sql, params = query.call_args.args
            self.assertEqual(params, [17, 271, relationship])
            self.assertIn('k.account_id = %s', sql)
            self.assertIn('k.enrolment_id = %s', sql)
            self.assertIn('k.relationship = %s', sql)
            self.assertNotIn('k.revoked_at', sql)
        self.assertIsNone(reads.relationship_for_target(99, 271, "coach", query=Mock(return_value=[])))

    def test_subject_projection_uses_typed_key_and_preserves_nulls(self):
        for groups in (None, [], [1, 2]):
            query = Mock(return_value=[dict(subject_type="employer", subject_id=90,
                account_id=19, organisation_ids=groups, source_display_name=None)])
            row = reads.subject_for_account(19, query=query)
            self.assertEqual(row["organisation_ids"], None if groups is None else tuple(groups))
            self.assertIsNone(row["source_display_name"])
            self.assertIn('s.subject_type = a."Subject_type"', query.call_args.args[0])
            self.assertIn('s.subject_id = a."Subject_id"', query.call_args.args[0])
        self.assertIsNone(reads.subject_for_account(19, query=Mock(return_value=[])))
        row = reads.subject_for_account(19, query=Mock(return_value=[{'organisation_ids': '[1,2]'}]))
        self.assertEqual(row['organisation_ids'], (1,2))
        row = reads.subject_for_account(19, query=Mock(return_value=[{'organisation_ids': 'null'}]))
        self.assertIsNone(row['organisation_ids'])

    def test_onboarding_without_profile_preserves_source_link(self):
        row = dict(LINK, canonical_profile_id=None, profile_count=0)
        self.assertEqual(reads.learner_link_for_actor(17, query=Mock(return_value=[row])), row)
        for count in (1, 2):
            with self.assertRaises(reads.IdentityReviewRequired):
                reads.learner_link_for_actor(17, query=Mock(return_value=[dict(row, profile_count=count)]))

    def test_canonical_identity_uses_existing_validator_and_independent_evidence(self):
        owner = dict(id=510, enrolment_id=271, email="test@example.test", aptem_id=3582,
                     account_record_id=271, account_email="test@example.test", account_aptem_id="003582")
        for hours in (None, "", "0", " 20 "):
            query = Mock(return_value=[dict(owner, programme_planned_hours=hours)])
            row = reads.profile_for_enrolment(271, query=query, error_type=IdentityError)
            self.assertEqual(row["programme_planned_hours"], hours)
            self.assertIn('e.source_email AS account_email', query.call_args.args[0])
            self.assertIn('"Learner".progress_transfer_requests', query.call_args.args[0])
            self.assertIn("coalesce(nullif(btrim(programme.name),''),l.programme_id,'') AS programme",
                          query.call_args.args[0])
            self.assertIn('LEFT JOIN curriculum.programmes programme', query.call_args.args[0])
            for field in ('lifecycle_status', 'programme_status', 'cohort_id', 'group_id'):
                self.assertIn(f'l.{field}', query.call_args.args[0])
        self.assertIsNone(reads.profile_for_enrolment(271, query=Mock(return_value=[]), error_type=IdentityError))
        for rows in ([owner, owner], [dict(owner, account_record_id=None)],
                     [dict(owner, account_email="other@example.test")],
                     [dict(owner, account_aptem_id="999")]):
            with self.assertRaises(IdentityError) as caught:
                reads.profile_for_enrolment(271, query=Mock(return_value=rows), error_type=IdentityError)
            self.assertEqual((caught.exception.code, caught.exception.status), ("identity_review_required", 409))


class TokenAndAuditTests(unittest.TestCase):
    def test_purposes_use_separate_tables_and_allow_inactive_invites(self):
        for kind, table in (("invitation", "Invitations"), ("reset", "Password_resets")):
            query = Mock(return_value=[dict(TOKEN, is_active=False)])
            row = reads.pending_token(kind, "digest", now=NOW, query=query)
            self.assertFalse(row["is_active"])
            sql, params = query.call_args.args
            self.assertIn('"Learner"."' + table + '"', sql)
            self.assertEqual(params, ["digest"])
            self.assertNotIn("AS password_hash", sql)
            self.assertNotIn('"Is_active" = TRUE', sql)

    def test_missing_used_expired_tokens_share_result(self):
        for kind in ("invitation", "reset"):
            for rows in ([], [dict(TOKEN, used_at=NOW)], [dict(TOKEN, expires_at=NOW)],
                         [dict(TOKEN, expires_at=NOW - timedelta(seconds=1))]):
                self.assertIsNone(reads.pending_token(kind, "digest", now=NOW, query=Mock(return_value=rows)))
            with self.assertRaises(reads.IdentityReviewRequired):
                reads.pending_token(kind, "digest", now=NOW, query=Mock(return_value=[TOKEN, TOKEN]))

    def test_audit_filters_preserve_reset_counting_all_outcomes(self):
        query = Mock(return_value=[{"event_count": 3}])
        self.assertEqual(reads.recent_auth_event_count(since=NOW, query=query,
            only_failures=False, email=" TEST@EXAMPLE.TEST ", event="reset_requested"), 3)
        sql, params = query.call_args.args
        self.assertIn('"Created_at" >= %s', sql)
        self.assertNotIn('"Succeeded"', sql)
        self.assertEqual(params, [NOW, "test@example.test", "reset_requested"])
        reads.recent_auth_event_count(since=NOW, query=query, ip="192.0.2.1")
        self.assertEqual(query.call_args.args[1], [NOW, False, "192.0.2.1"])

    def test_bad_count_is_not_zero(self):
        for rows in ([], [{"event_count": -1}], [{"event_count": None}]):
            with self.assertRaises(reads.IdentityReviewRequired):
                reads.recent_auth_event_count(since=NOW, query=Mock(return_value=rows))


class IdentityError(Exception):
    def __init__(self, message, code, status):
        self.code, self.status = code, status
        super().__init__(message)


def calls(query):
    """Every executable selector, with synthetic injection-shaped values."""
    value = "x' OR 1=1 --"
    return (
        lambda: reads.account_candidates_for_email(value, query=query),
        lambda: reads.account_for_email(value, query=query),
        lambda: reads.password_account_for_email(value, query=query),
        lambda: reads.account_for_subject("learner", 271, query=query),
        lambda: reads.active_account_by_id(17, query=query),
        lambda: reads.session_with_account(value, now=NOW, query=query),
        lambda: reads.subject_identity_for_account(17, query=query),
        lambda: reads.subject_for_account(17, query=query),
        lambda: reads.profile_for_enrolment(271, query=query, error_type=IdentityError),
        lambda: reads.learner_access_facts(271, query=query),
        lambda: reads.cohort_access_facts("C", query=query),
        lambda: reads.staff_grants_for_actor(18, query=query),
        lambda: reads.learner_link_for_actor(17, query=query),
        lambda: reads.relationship_for_target(17, 271, "coach", query=query),
        lambda: reads.pending_token("reset", value, now=NOW, query=query),
        lambda: reads.pending_token("invitation", value, now=NOW, query=query),
        lambda: reads.recent_auth_event_count(since=NOW, email=value, query=query),
    )


class BoundaryTests(unittest.TestCase):
    def test_unavailability_propagates_for_every_executable_read(self):
        failure = RuntimeError("synthetic database unavailable")
        query = Mock(side_effect=failure)
        for call in calls(query):
            with self.assertRaises(RuntimeError) as caught:
                call()
            self.assertIs(caught.exception, failure)

    def test_queries_are_bound_selects_from_only_proposed_learner_tables(self):
        def query(sql, params):
            self.assertTrue(sql.startswith("SELECT"))
            self.assertNotIn("SELECT *", sql)
            self.assertNotIn("x' OR 1=1", sql)
            self.assertEqual(sql.count("%s"), len(params))
            self.assertNotRegex(sql, r"\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b")
            relations = re.findall(r'\b(?:FROM|JOIN)\s+(\S+)', sql)
            allowed = {'"Learner".' + name for name in (
                '"Login_accounts"', '"Login_sessions"', '"Invitations"',
                '"Password_resets"', '"Login_audit"', 'auth_subjects',
                'account_learner_links', 'learners', 'actor_grants',
                'learner_identity_evidence', 'cohort_access_facts', 'progress_transfer_requests')}
            allowed.add('curriculum.programmes')
            self.assertTrue(relations)
            self.assertTrue(set(relations) <= allowed)
            return [{"event_count": 0}] if 'AS event_count' in sql else []
        for call in calls(query):
            call()

    def test_invalid_discriminators_never_reach_query(self):
        query = Mock()
        for call in (
            lambda: reads.pending_token('reset; DROP', "digest", now=NOW, query=query),
            lambda: reads.account_for_subject("unknown", 17, query=query),
            lambda: reads.relationship_for_target(17, 271, "admin", query=query),
        ):
            with self.assertRaises(ValueError):
                call()
        query.assert_not_called()

    def test_naive_clock_refused_before_query(self):
        query = Mock()
        naive = NOW.replace(tzinfo=None)
        for call in (
            lambda: reads.session_with_account("digest", now=naive, query=query),
            lambda: reads.pending_token("reset", "digest", now=naive, query=query),
            lambda: reads.recent_auth_event_count(since=naive, query=query),
        ):
            with self.assertRaises(ValueError):
                call()
        query.assert_not_called()

    def test_only_stdlib_and_existing_pure_validator_imported(self):
        tree = ast.parse(PATH.read_text(encoding="utf-8"))
        imports = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
        self.assertEqual([ast.unparse(node) for node in imports], [
            'import json', 'from types import MappingProxyType',
            'from learner_api.selectors.identity import validate_profile'])


if __name__ == "__main__":
    unittest.main()
