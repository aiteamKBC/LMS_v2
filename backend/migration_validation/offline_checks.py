"""Database-free safety tests for the PMA-G1B disposable runner."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .safety import (
    ApprovedTarget,
    Refused,
    assert_feedback_0006_is_narrow,
    ledger_digest,
    verify_live_identity,
)
from .run import (
    DATABASE_ENV_NAMES,
    EXTERNAL_ENV_NAMES,
    TransportGuard,
    _database_config,
    _disable_integrations,
    _verify_execution_quiescence,
    _verify_scanner_preconditions,
    _verify_session_settings,
    _validate_report_destination,
    _write_report,
    verify_provider_attestation,
)


class ScriptedCursor:
    def __init__(self, *, one=(), all_rows=()):
        self._one = iter(one)
        self._all = iter(all_rows)

    def execute(self, _sql, _params=None):
        return None

    def fetchone(self):
        return next(self._one)

    def fetchall(self):
        return next(self._all)


def approval(**updates):
    value = {
        "purpose": "PMA-G1B disposable migration validation",
        "authorization_id": "approval-offline-synthetic",
        "authorized_by": "synthetic-approver",
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "allow_migration_writes": True,
        "disposable": True,
        "project_id": "green-term-97168878",
        "project_name": "LMS",
        "parent_branch_id": "br-raspy-sky-abvs8lq9",
        "branch_id": "br-synthetic-disposable",
        "branch_name": "pma-g1b-synthetic",
        "endpoint_id": "ep-synthetic-disposable",
        "endpoint_host": "ep-synthetic-disposable.eu-west-2.aws.neon.tech",
        "region_id": "aws-eu-west-2",
        "database": "neondb",
        "role": "pma_runner",
        "expected_ledger_sha256": "a" * 64,
        "targets": ["coach_api.0028_legacy_template_hours_defaults"],
        "expected_plan": [
            "coach_api.0026_migrated_review_revisions",
            "coach_api.0027_personal_support_template",
            "coach_api.0028_legacy_template_hours_defaults",
        ],
        "migration_sha256": {
            "backend/coach_api/migrations/0026_migrated_review_revisions.py": "b" * 64,
            "backend/coach_api/migrations/0027_personal_support_template.py": "c" * 64,
            "backend/coach_api/migrations/0028_legacy_template_hours_defaults.py": "d" * 64,
        },
        "timing_schema_decision": "not-requested",
        "feedback_0006_decision": "not-requested",
        "rollback_owner": "synthetic-rollback-owner",
        "teardown_owner": "synthetic-teardown-owner",
    }
    value.update(updates)
    return value


class ApprovalSafetyTests(unittest.TestCase):
    def test_complete_disposable_approval_is_accepted(self):
        self.assertEqual(ApprovedTarget.parse(approval()).branch_id, "br-synthetic-disposable")

    def test_exactly_one_migration_family_is_required(self):
        value = approval(
            targets=[
                "coach_api.0028_legacy_template_hours_defaults",
                "learner_api.0025_progress_transfer_constraint_repair",
            ]
        )
        with self.assertRaisesRegex(Refused, "Exactly one"):
            ApprovedTarget.parse(value)

    def test_expected_plan_cannot_cross_family_boundaries(self):
        value = approval(expected_plan=[
            "coach_api.0028_legacy_template_hours_defaults",
            "learner_api.0025_progress_transfer_constraint_repair",
        ])
        with self.assertRaisesRegex(Refused, "crosses"):
            ApprovedTarget.parse(value)

    def test_every_missing_field_is_refused(self):
        for name in approval():
            value = approval()
            del value[name]
            with self.subTest(name=name), self.assertRaises(Refused):
                ApprovedTarget.parse(value)

    def test_shared_development_and_production_targets_are_refused(self):
        cases = (
            {"branch_id": "br-raspy-sky-abvs8lq9"},
            {"branch_name": "lms-ideal-architecture"},
            {"endpoint_id": "ep-odd-grass-ab4t9q2o",
             "endpoint_host": "ep-odd-grass-ab4t9q2o.eu-west-2.aws.neon.tech"},
            {"branch_id": "br-holy-band-abhispwg"},
            {"branch_name": "production"},
            {"endpoint_id": "ep-wild-shape-ab005yy6",
             "endpoint_host": "ep-wild-shape-ab005yy6.eu-west-2.aws.neon.tech"},
        )
        for update in cases:
            with self.subTest(update=update), self.assertRaises(Refused):
                ApprovedTarget.parse(approval(**update))

    def test_pooler_or_wrong_region_is_refused(self):
        for update in (
            {"endpoint_host": "ep-synthetic-disposable-pooler.eu-west-2.aws.neon.tech"},
            {"region_id": "aws-us-east-1"},
        ):
            with self.subTest(update=update), self.assertRaises(Refused):
                ApprovedTarget.parse(approval(**update))

    def test_malformed_branch_identifier_is_refused(self):
        with self.assertRaisesRegex(Refused, "branch identifier"):
            ApprovedTarget.parse(approval(branch_id="../../other"))

    def test_learner_target_requires_timing_decision(self):
        value = approval(
            targets=["learner_api.0025_progress_transfer_constraint_repair"],
            expected_plan=[
                "learner_api.0024_activity_timing_drafts",
                "learner_api.0025_progress_transfer_constraint_repair",
            ],
            migration_sha256={
                "backend/learner_api/migrations/0024_activity_timing_drafts.py": "b" * 64,
                "backend/learner_api/migrations/0025_progress_transfer_constraint_repair.py": "c" * 64,
            },
        )
        with self.assertRaisesRegex(Refused, "timing-schema"):
            ApprovedTarget.parse(value)

    def test_scanner_target_requires_exact_one_node_plan_and_pinned_source(self):
        pinned = {
            "backend/learner_api/migrations/0026_file_scan_persistence.py":
                "6ad0e7cbe5814b2edc94d56b0012dcb26bb4174e3773d97cfc468ac65c6ebff2",
        }
        value = approval(
            targets=["learner_api.0026_file_scan_persistence"],
            expected_plan=["learner_api.0026_file_scan_persistence"],
            migration_sha256=pinned,
        )
        self.assertEqual(ApprovedTarget.parse(value).expected_plan, tuple(value["expected_plan"]))

        with self.assertRaisesRegex(Refused, "pinned approved source"):
            ApprovedTarget.parse(approval(
                targets=["learner_api.0026_file_scan_persistence"],
                expected_plan=["learner_api.0026_file_scan_persistence"],
                migration_sha256={
                    "backend/learner_api/migrations/0026_file_scan_persistence.py": "f" * 64,
                },
            ))
        with self.assertRaisesRegex(Refused, "crosses"):
            ApprovedTarget.parse(approval(
                targets=["learner_api.0026_file_scan_persistence"],
                expected_plan=[
                    "learner_api.0025_progress_transfer_constraint_repair",
                    "learner_api.0026_file_scan_persistence",
                ],
                migration_sha256=pinned,
            ))

    def test_engagement_target_requires_decision_and_narrow_source(self):
        value = approval(
            targets=["engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery"],
            expected_plan=[
                "engagement_api.0006_module_feedback",
                "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery",
            ],
            migration_sha256={
                "backend/engagement_api/migrations/0006_module_feedback.py": "b" * 64,
                "backend/engagement_api/migrations/0007_feedbackdeliveryquestion_feedbackreviewdelivery.py": "c" * 64,
            },
        )
        with self.assertRaisesRegex(Refused, "0006"):
            ApprovedTarget.parse(value)
        with self.assertRaisesRegex(Refused, "broad"):
            assert_feedback_0006_is_narrow("LIKE '%form_type%' feedback_form_type_check")

    def test_current_engagement_0006_remains_fail_closed(self):
        source = (
            Path(__file__).resolve().parents[1]
            / "engagement_api" / "migrations" / "0006_module_feedback.py"
        ).read_text(encoding="utf-8")
        with self.assertRaisesRegex(Refused, "broad constraint selector"):
            assert_feedback_0006_is_narrow(source)

    def test_provider_metadata_all_coordinates_are_checked(self):
        target = ApprovedTarget.parse(approval())
        project = {"project": {"id": target.project_id, "name": target.project_name,
                                "region_id": target.region_id}}
        branch = {"branch": {"id": target.branch_id, "name": target.branch_name,
                              "project_id": target.project_id, "parent_id": target.parent_branch_id,
                              "primary": False}}
        endpoint = {"endpoint": {"id": target.endpoint_id, "host": target.endpoint_host,
                                  "project_id": target.project_id, "branch_id": target.branch_id,
                                  "region_id": target.region_id, "type": "read_write"}}
        target.verify_metadata(project, branch, endpoint)
        for payload, key in ((project["project"], "id"), (branch["branch"], "parent_id"),
                             (endpoint["endpoint"], "host")):
            original = payload[key]
            payload[key] = "wrong"
            with self.subTest(key=key), self.assertRaises(Refused):
                target.verify_metadata(project, branch, endpoint)
            payload[key] = original

    def test_provider_attestation_requires_exact_fresh_metadata(self):
        target = ApprovedTarget.parse(approval())
        now = datetime.now(timezone.utc)
        attestation = {
            "verified_at": now.isoformat(),
            "project": {"project": {
                "id": target.project_id,
                "name": target.project_name,
                "region_id": target.region_id,
            }},
            "branch": {"branch": {
                "id": target.branch_id,
                "name": target.branch_name,
                "project_id": target.project_id,
                "parent_id": target.parent_branch_id,
                "primary": False,
            }},
            "endpoint": {"endpoint": {
                "id": target.endpoint_id,
                "host": target.endpoint_host,
                "project_id": target.project_id,
                "branch_id": target.branch_id,
                "region_id": target.region_id,
                "type": "read_write",
            }},
        }
        verify_provider_attestation(target, attestation, now=now)
        attestation["verified_at"] = (now - timedelta(minutes=6)).isoformat()
        with self.assertRaisesRegex(Refused, "five-minute"):
            verify_provider_attestation(target, attestation, now=now)

    def test_source_digests_are_exact_and_complete(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sources = {
                "backend/coach_api/migrations/0026_migrated_review_revisions.py": b"one",
                "backend/coach_api/migrations/0027_personal_support_template.py": b"two",
                "backend/coach_api/migrations/0028_legacy_template_hours_defaults.py": b"three",
            }
            for relative, content in sources.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            digests = {name: hashlib.sha256(content).hexdigest() for name, content in sources.items()}
            target = ApprovedTarget.parse(approval(migration_sha256=digests))
            target.verify_sources(root)
            (root / next(iter(sources))).write_bytes(b"changed")
            with self.assertRaisesRegex(Refused, "changed after approval"):
                target.verify_sources(root)

    def test_live_identity_and_ledger_digest_are_deterministic(self):
        target = ApprovedTarget.parse(approval())
        verify_live_identity(target, (target.database, target.role, target.branch_id, "on"))
        with self.assertRaises(Refused):
            verify_live_identity(target, (target.database, target.role, "wrong", "on"))
        self.assertEqual(ledger_digest([("b", "2"), ("a", "1")]),
                         ledger_digest([("a", "1"), ("b", "2")]))


class RunnerIsolationTests(unittest.TestCase):
    def test_scanner_physical_preconditions_are_exact(self):
        ledger = [
            ("learner_api", "0025_progress_transfer_constraint_repair"),
        ]
        constraints = [
            (
                "progress_transfer_items",
                "progress_transfer_items_request_enrolment_fkey",
                "f", True, ["request_id", "enrolment_id"], "Learner",
                "progress_transfer_requests", ["id", "enrolment_id"],
            ),
            (
                "progress_transfer_requests",
                "progress_transfer_requests_id_enrolment_id_key",
                "u", True, ["id", "enrolment_id"], None, None, None,
            ),
        ]
        cursor = ScriptedCursor(one=[(None, None, None)], all_rows=[constraints])
        result = _verify_scanner_preconditions(cursor, ledger)
        self.assertTrue(result["learner_0025_applied"])
        self.assertFalse(result["learner_0026_applied"])

        cursor = ScriptedCursor(one=[("Learner.file_scan_jobs", None, None)])
        with self.assertRaisesRegex(Refused, "already exist"):
            _verify_scanner_preconditions(cursor, ledger)

    def test_runner_timeouts_and_quiescence_fail_closed(self):
        _verify_session_settings(ScriptedCursor(one=[("5s", "5min", "1min")]))
        with self.assertRaisesRegex(Refused, "timeouts"):
            _verify_session_settings(ScriptedCursor(one=[("0", "0", "5min")]))

        quiet = ScriptedCursor(one=[(0, 0, 0), (0,)])
        self.assertEqual(_verify_execution_quiescence(quiet)["other_client_sessions"], 0)
        busy = ScriptedCursor(one=[(1, 0, 0), (0,)])
        with self.assertRaisesRegex(Refused, "sessions or blocking locks"):
            _verify_execution_quiescence(busy)

    def test_database_config_requires_full_tls_and_channel_binding(self):
        target = ApprovedTarget.parse(approval())
        config = _database_config(target, "synthetic-password")
        self.assertEqual(config["HOST"], target.endpoint_host)
        self.assertEqual(config["CONN_MAX_AGE"], 0)
        self.assertTrue(Path(config["OPTIONS"]["sslrootcert"]).is_file())
        self.assertEqual(config["OPTIONS"], {
            "sslmode": "verify-full",
            "sslrootcert": config["OPTIONS"]["sslrootcert"],
            "channel_binding": "require",
            "connect_timeout": 10,
            "options": (
                "-c lock_timeout=5000 "
                "-c statement_timeout=300000 "
                "-c idle_in_transaction_session_timeout=60000"
            ),
        })

    def test_environment_database_and_integration_routes_are_removed(self):
        seeded = {name: "forbidden" for name in DATABASE_ENV_NAMES | EXTERNAL_ENV_NAMES}
        seeded.update({"AZURE_STORAGE_ACCOUNT": "forbidden", "SAFE_UNRELATED": "kept"})
        with patch.dict(os.environ, seeded, clear=True):
            _disable_integrations()
            self.assertTrue(DATABASE_ENV_NAMES.isdisjoint(os.environ))
            self.assertTrue(EXTERNAL_ENV_NAMES.isdisjoint(os.environ))
            self.assertNotIn("AZURE_STORAGE_ACCOUNT", os.environ)
            self.assertEqual(os.environ["SAFE_UNRELATED"], "kept")
            self.assertEqual(
                os.environ["EMAIL_BACKEND"],
                "django.core.mail.backends.locmem.EmailBackend",
            )

    def test_transport_guard_opens_only_the_explicit_connection_window(self):
        guard = TransportGuard()
        with self.assertRaises(Refused):
            guard("socket.connect", (None, ("example.invalid", 443)))
        guard.allow_database_connect()
        guard("socket.connect", (None, ("synthetic", 5432)))
        with self.assertRaises(Refused):
            guard("subprocess.Popen", ())
        guard.lock_down()
        with self.assertRaises(Refused):
            guard("socket.connect", (None, ("synthetic", 5432)))
        with self.assertRaises(Refused):
            guard("open", ("backend/.env", "r"))

    def test_report_is_exclusively_created_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.json"
            self.assertEqual(_validate_report_destination(path), path.resolve())
            _write_report(path, {"status": "synthetic"})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"status": "synthetic"})
            with self.assertRaises(Refused):
                _validate_report_destination(path)
            with self.assertRaises(FileExistsError):
                _write_report(path, {"status": "overwritten"})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"status": "synthetic"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
