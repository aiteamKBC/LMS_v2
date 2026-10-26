"""Pure fail-closed controls for the PMA-G1B disposable migration runner."""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re


PROJECT_ID = "green-term-97168878"
PROJECT_NAME = "LMS"
DEVELOPMENT_BRANCH_ID = "br-raspy-sky-abvs8lq9"
DEVELOPMENT_BRANCH_NAME = "lms-ideal-architecture"
DEVELOPMENT_ENDPOINT_ID = "ep-odd-grass-ab4t9q2o"
PRODUCTION_BRANCH_ID = "br-holy-band-abhispwg"
PRODUCTION_BRANCH_NAME = "production"
PRODUCTION_ENDPOINT_ID = "ep-wild-shape-ab005yy6"
PURPOSE = "PMA-G1B disposable migration validation"

ALLOWED_TARGETS = frozenset({
    "learner_api.0025_progress_transfer_constraint_repair",
    "learner_api.0026_file_scan_persistence",
    "coach_api.0028_legacy_template_hours_defaults",
    "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery",
})
PLAN_NODES_BY_TARGET = {
    "learner_api.0025_progress_transfer_constraint_repair": frozenset({
        "learner_api.0024_activity_timing_drafts",
        "learner_api.0025_progress_transfer_constraint_repair",
    }),
    "learner_api.0026_file_scan_persistence": frozenset({
        "learner_api.0026_file_scan_persistence",
    }),
    "coach_api.0028_legacy_template_hours_defaults": frozenset({
        "coach_api.0025_review_source_reconciliation",
        "coach_api.0026_migrated_review_revisions",
        "coach_api.0027_personal_support_template",
        "coach_api.0028_legacy_template_hours_defaults",
    }),
    "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery": frozenset({
        "engagement_api.0005_merge_learning_policy_event_feedback",
        "engagement_api.0006_module_feedback",
        "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery",
    }),
}
TARGET_SOURCES = {
    "learner_api.0025_progress_transfer_constraint_repair": (
        "backend/learner_api/migrations/0024_activity_timing_drafts.py",
        "backend/learner_api/migrations/0025_progress_transfer_constraint_repair.py",
    ),
    "learner_api.0026_file_scan_persistence": (
        "backend/learner_api/migrations/0026_file_scan_persistence.py",
    ),
    "coach_api.0028_legacy_template_hours_defaults": (
        "backend/coach_api/migrations/0026_migrated_review_revisions.py",
        "backend/coach_api/migrations/0027_personal_support_template.py",
        "backend/coach_api/migrations/0028_legacy_template_hours_defaults.py",
    ),
    "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery": (
        "backend/engagement_api/migrations/0006_module_feedback.py",
        "backend/engagement_api/migrations/0007_feedbackdeliveryquestion_feedbackreviewdelivery.py",
    ),
}
ROLLBACK_TARGETS = {
    "learner_api.0025_progress_transfer_constraint_repair":
        "learner_api.0024_activity_timing_drafts",
    "learner_api.0026_file_scan_persistence":
        "learner_api.0025_progress_transfer_constraint_repair",
    "coach_api.0028_legacy_template_hours_defaults":
        "coach_api.0025_review_source_reconciliation",
    "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery":
        "engagement_api.0005_merge_learning_policy_event_feedback",
}

PINNED_SOURCE_SHA256 = {
    "learner_api.0026_file_scan_persistence": {
        "backend/learner_api/migrations/0026_file_scan_persistence.py":
            "6ad0e7cbe5814b2edc94d56b0012dcb26bb4174e3773d97cfc468ac65c6ebff2",
    },
}


class Refused(RuntimeError):
    """Raised before any database write when an approval invariant fails."""


def _unwrap(payload, key):
    if not isinstance(payload, dict):
        raise Refused(f"Neon {key} metadata is not an object")
    value = payload.get(key, payload)
    if not isinstance(value, dict):
        raise Refused(f"Neon {key} metadata is malformed")
    return value


@dataclass(frozen=True)
class ApprovedTarget:
    purpose: str
    authorization_id: str
    authorized_by: str
    expires_at: str
    allow_migration_writes: bool
    disposable: bool
    project_id: str
    project_name: str
    parent_branch_id: str
    branch_id: str
    branch_name: str
    endpoint_id: str
    endpoint_host: str
    region_id: str
    database: str
    role: str
    expected_ledger_sha256: str
    targets: tuple
    expected_plan: tuple
    migration_sha256: dict
    timing_schema_decision: str
    feedback_0006_decision: str
    rollback_owner: str
    teardown_owner: str

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != set(cls.__dataclass_fields__):
            raise Refused("Approval fields are incomplete or unexpected")
        value = dict(value)
        if not isinstance(value.get("targets"), list) or not isinstance(value.get("expected_plan"), list):
            raise Refused("Approval targets and expected plan must be JSON lists")
        value["targets"] = tuple(value["targets"])
        value["expected_plan"] = tuple(value["expected_plan"])
        target = cls(**value)
        target._validate()
        return target

    def _validate(self):
        if self.purpose != PURPOSE:
            raise Refused("Approval purpose does not authorize PMA-G1B")
        if self.allow_migration_writes is not True or self.disposable is not True:
            raise Refused("Explicit disposable migration-write authorization is required")
        expiry = datetime.fromisoformat(self.expires_at)
        if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
            raise Refused("Approval is expired or has no timezone")
        required_text = (
            "authorization_id", "authorized_by", "branch_id", "branch_name", "endpoint_id",
            "endpoint_host", "database", "role", "rollback_owner", "teardown_owner",
        )
        if any(not isinstance(getattr(self, field), str) or not getattr(self, field).strip()
               for field in required_text):
            raise Refused("Approval identity and ownership fields must be nonempty strings")
        if self.project_id != PROJECT_ID or self.project_name != PROJECT_NAME:
            raise Refused("Only the independently verified LMS project is allowed")
        if self.parent_branch_id != DEVELOPMENT_BRANCH_ID:
            raise Refused("Disposable target must be forked from the reviewed development branch")
        if not re.fullmatch(r"br-[a-z0-9-]+", self.branch_id):
            raise Refused("Unexpected Neon branch identifier")
        if self.branch_id in {DEVELOPMENT_BRANCH_ID, PRODUCTION_BRANCH_ID}:
            raise Refused("Shared development and Production branches are forbidden")
        if self.branch_name in {DEVELOPMENT_BRANCH_NAME, PRODUCTION_BRANCH_NAME}:
            raise Refused("Shared development and Production branch names are forbidden")
        if self.endpoint_id in {DEVELOPMENT_ENDPOINT_ID, PRODUCTION_ENDPOINT_ID}:
            raise Refused("Shared development and Production endpoints are forbidden")
        if not re.fullmatch(r"ep-[a-z0-9-]+", self.endpoint_id):
            raise Refused("Unexpected Neon endpoint identifier")
        expected_host = f"{self.endpoint_id}.eu-west-2.aws.neon.tech"
        if self.endpoint_host != expected_host or "-pooler." in self.endpoint_host:
            raise Refused("An exact direct eu-west-2 Neon endpoint is required")
        if self.region_id != "aws-eu-west-2":
            raise Refused("Unexpected Neon region")
        if len(self.targets) != 1:
            raise Refused("Exactly one migration family must be validated per disposable target")
        if not set(self.targets) <= ALLOWED_TARGETS:
            raise Refused("Migration target is outside the PMA-G1B allowlist")
        if not self.expected_plan or len(set(self.expected_plan)) != len(self.expected_plan) or any(
            not isinstance(node, str) or node.count(".") != 1 for node in self.expected_plan
        ):
            raise Refused("An exact, unique app_label.migration_name plan is required")
        target_name = self.targets[0]
        if target_name not in self.expected_plan:
            raise Refused("Expected migration plan must include its requested target")
        if not set(self.expected_plan) <= PLAN_NODES_BY_TARGET[target_name]:
            raise Refused("Expected migration plan crosses migration-family boundaries")
        if not re.fullmatch(r"[0-9a-f]{64}", self.expected_ledger_sha256):
            raise Refused("Expected migration-ledger digest is invalid")
        if not isinstance(self.migration_sha256, dict):
            raise Refused("Migration source digest map is required")
        if any(not re.fullmatch(r"[0-9a-f]{64}", str(value))
               for value in self.migration_sha256.values()):
            raise Refused("Migration source digest is invalid")
        if "learner_api.0025_progress_transfer_constraint_repair" in self.targets:
            if self.timing_schema_decision != "public-approved":
                raise Refused("Learner 0025 depends on an explicit public timing-schema approval")
        pinned = PINNED_SOURCE_SHA256.get(target_name)
        if pinned is not None and self.migration_sha256 != pinned:
            raise Refused("Migration source digest differs from the pinned approved source")
        if "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery" in self.targets:
            if self.feedback_0006_decision != "exact-source-reviewed":
                raise Refused("Engagement target requires reviewed exact-name 0006 source")

    def verify_metadata(self, project_payload, branch_payload, endpoint_payload):
        project = _unwrap(project_payload, "project")
        branch = _unwrap(branch_payload, "branch")
        endpoint = _unwrap(endpoint_payload, "endpoint")
        expected_project = (self.project_id, self.project_name, self.region_id)
        actual_project = (project.get("id"), project.get("name"), project.get("region_id"))
        if actual_project != expected_project:
            raise Refused("Neon project metadata does not match approval")
        expected_branch = (
            self.branch_id, self.branch_name, self.project_id, self.parent_branch_id, False,
        )
        actual_branch = (
            branch.get("id"), branch.get("name"), branch.get("project_id"),
            branch.get("parent_id"), branch.get("primary"),
        )
        if actual_branch != expected_branch:
            raise Refused("Neon branch metadata does not match disposable approval")
        expected_endpoint = (
            self.endpoint_id, self.endpoint_host, self.project_id, self.branch_id,
            self.region_id, "read_write",
        )
        actual_endpoint = (
            endpoint.get("id"), endpoint.get("host"), endpoint.get("project_id"),
            endpoint.get("branch_id"), endpoint.get("region_id"), endpoint.get("type"),
        )
        if actual_endpoint != expected_endpoint:
            raise Refused("Neon endpoint metadata does not match disposable approval")

    def verify_sources(self, repository_root):
        root = Path(repository_root).resolve()
        required = {path for target in self.targets for path in TARGET_SOURCES[target]}
        if set(self.migration_sha256) != required:
            raise Refused("Approval must pin exactly every source in each requested migration chain")
        for relative in sorted(required):
            path = (root / relative).resolve()
            if root not in path.parents or not path.is_file():
                raise Refused("Approved migration source is missing or escaped the repository")
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual != self.migration_sha256[relative]:
                raise Refused(f"Migration source changed after approval: {relative}")
        if "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery" in self.targets:
            engagement_target = "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery"
            source = (root / TARGET_SOURCES[engagement_target][0]).read_text(encoding="utf-8")
            assert_feedback_0006_is_narrow(source)


def assert_feedback_0006_is_narrow(source):
    """Keep the runner blocked while historical 0006 uses broad discovery."""
    if "LIKE '%form_type%'" in source or 'LIKE "%form_type%"' in source:
        raise Refused("Engagement 0006 still has a broad constraint selector")
    if "feedback_form_type_check" not in source:
        raise Refused("Engagement 0006 lacks the approved exact constraint identity")


def ledger_digest(rows):
    normalized = sorted((str(app), str(name)) for app, name in rows)
    payload = json.dumps(normalized, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return hashlib.sha256(payload).hexdigest()


def verify_live_identity(target, row):
    expected = (target.database, target.role, target.branch_id, "on")
    if tuple(row) != expected:
        raise Refused("Live database identity/read-only preflight does not match approval")


def parse_target(value):
    if not isinstance(value, str) or value.count(".") != 1:
        raise Refused("Migration target must be app_label.migration_name")
    app_label, migration_name = value.split(".", 1)
    return app_label, migration_name
