"""Install the durable, provider-neutral malware scan persistence foundation.

The forward migration creates only empty scanner-owned tables. The reverse is
deliberately limited to an empty foundation so rollback cannot erase scan audit
history after a later batch activates the workflow.
"""

import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import connections, migrations, models
from django.db.models import F, Q


STATES = (
    "pending_upload",
    "quarantined",
    "scan_pending",
    "scanning",
    "clean_verified",
    "infected",
    "scan_failed",
    "expired",
)
ACTIVE_STATES = (
    "pending_upload",
    "quarantined",
    "scan_pending",
    "scanning",
    "scan_failed",
)
TERMINAL_STATES = ("clean_verified", "infected", "expired")
EVENT_KINDS = ("state_transition", "provider_delivery", "reconcile", "operator_action")
EVENT_DISPOSITIONS = ("recorded", "deferred", "applied", "duplicate", "rejected")
OUTBOX_OPERATIONS = ("upload_reconcile", "submit_scan", "promote", "cleanup_quarantine")
OUTBOX_STATUSES = ("pending", "processing", "retry", "completed", "dead")
FAILURE_CATEGORIES = (
    "authentication_failed",
    "integrity_mismatch",
    "internal_error",
    "lease_expired",
    "provider_rejected",
    "provider_timeout",
    "retry_exhausted",
    "scanner_unavailable",
    "storage_error",
)

TABLES = (
    '"Learner".file_scan_jobs',
    '"Learner".file_scan_events',
    '"Learner".file_scan_outbox',
)

CREATE_STATEMENTS = (
    """
    CREATE TABLE "Learner".file_scan_jobs (
        id uuid PRIMARY KEY,
        domain_type varchar(48) NOT NULL,
        domain_record_key varchar(255),
        canonical_learner_kind varchar(32) NOT NULL,
        canonical_enrolment_id integer NOT NULL,
        requested_by_account_key varchar(255) NOT NULL,
        requested_by_role varchar(32) NOT NULL,
        idempotency_key_hash varchar(64) NOT NULL,
        original_filename text NOT NULL,
        content_type varchar(255) NOT NULL,
        size_bytes bigint NOT NULL,
        content_sha256 varchar(64),
        quarantine_account varchar(255),
        quarantine_container varchar(255),
        quarantine_blob_name text,
        quarantine_etag text,
        quarantine_version_id text,
        provider varchar(64),
        correlation_id varchar(255),
        lifecycle_state varchar(32) NOT NULL DEFAULT 'pending_upload',
        state_version bigint NOT NULL DEFAULT 0,
        attempt_count integer NOT NULL DEFAULT 0,
        retry_limit integer NOT NULL,
        next_attempt_at timestamptz,
        lease_owner varchar(255),
        lease_expires_at timestamptz,
        last_error_code varchar(64),
        approved_account varchar(255),
        approved_container varchar(255),
        approved_blob_name text,
        approved_etag text,
        promotion_completed_at timestamptz,
        domain_metadata_committed_at timestamptz,
        terminal_at timestamptz,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT file_scan_jobs_state_ck CHECK (lifecycle_state IN (
            'pending_upload', 'quarantined', 'scan_pending', 'scanning',
            'clean_verified', 'infected', 'scan_failed', 'expired'
        )),
        CONSTRAINT file_scan_jobs_version_ck CHECK (state_version >= 0),
        CONSTRAINT file_scan_jobs_attempt_ck CHECK (
            attempt_count >= 0 AND retry_limit >= 0 AND attempt_count <= retry_limit + 1
        ),
        CONSTRAINT file_scan_jobs_size_ck CHECK (size_bytes >= 0),
        CONSTRAINT file_scan_jobs_hash_ck CHECK (
            content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT file_scan_jobs_idem_hash_ck CHECK (
            idempotency_key_hash ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT file_scan_jobs_error_ck CHECK (
            last_error_code IS NULL OR last_error_code IN (
                'authentication_failed', 'integrity_mismatch', 'internal_error',
                'lease_expired', 'provider_rejected', 'provider_timeout',
                'retry_exhausted', 'scanner_unavailable', 'storage_error'
            )
        ),
        CONSTRAINT file_scan_jobs_lease_pair_ck CHECK (
            (lease_owner IS NULL AND lease_expires_at IS NULL) OR
            (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        ),
        CONSTRAINT file_scan_jobs_blob_shape_ck CHECK (
            (
                quarantine_account IS NULL AND quarantine_container IS NULL AND
                quarantine_blob_name IS NULL AND quarantine_etag IS NULL AND
                quarantine_version_id IS NULL
            ) OR (
                quarantine_account IS NOT NULL AND quarantine_container IS NOT NULL AND
                quarantine_blob_name IS NOT NULL AND quarantine_etag IS NOT NULL
            )
        ),
        CONSTRAINT file_scan_jobs_approved_shape_ck CHECK (
            (
                approved_account IS NULL AND approved_container IS NULL AND
                approved_blob_name IS NULL AND approved_etag IS NULL
            ) OR (
                approved_account IS NOT NULL AND approved_container IS NOT NULL AND
                approved_blob_name IS NOT NULL AND approved_etag IS NOT NULL
            )
        ),
        CONSTRAINT file_scan_jobs_terminal_ck CHECK (
            (lifecycle_state IN ('clean_verified', 'infected', 'expired') AND terminal_at IS NOT NULL)
            OR
            (lifecycle_state NOT IN ('clean_verified', 'infected', 'expired') AND terminal_at IS NULL)
        ),
        CONSTRAINT file_scan_jobs_expiry_ck CHECK (expires_at > created_at),
        CONSTRAINT file_scan_jobs_actor_idem_uniq UNIQUE (
            requested_by_account_key, canonical_enrolment_id, domain_type, idempotency_key_hash
        )
    )
    """,
    """
    CREATE UNIQUE INDEX file_scan_jobs_blob_version_uniq
        ON "Learner".file_scan_jobs (
            quarantine_account, quarantine_container, quarantine_blob_name,
            quarantine_version_id, quarantine_etag
        ) NULLS NOT DISTINCT
        WHERE quarantine_blob_name IS NOT NULL
    """,
    """
    CREATE INDEX file_scan_jobs_due_idx
        ON "Learner".file_scan_jobs (next_attempt_at, id)
        WHERE lifecycle_state IN (
            'pending_upload', 'quarantined', 'scan_pending', 'scanning', 'scan_failed'
        )
    """,
    """
    CREATE INDEX file_scan_jobs_lease_idx
        ON "Learner".file_scan_jobs (lease_expires_at, id)
        WHERE lease_expires_at IS NOT NULL
    """,
    """
    CREATE TABLE "Learner".file_scan_events (
        id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        job_id uuid NOT NULL,
        event_kind varchar(32) NOT NULL,
        disposition varchar(24) NOT NULL,
        from_state varchar(32),
        to_state varchar(32),
        state_version bigint,
        provider varchar(64),
        provider_event_id varchar(255),
        provider_event_fingerprint varchar(64),
        correlation_id varchar(255),
        payload_sha256 varchar(64),
        error_code varchar(64),
        occurred_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        CONSTRAINT file_scan_events_job_fk FOREIGN KEY (job_id)
            REFERENCES "Learner".file_scan_jobs(id) ON DELETE RESTRICT,
        CONSTRAINT file_scan_events_kind_ck CHECK (event_kind IN (
            'state_transition', 'provider_delivery', 'reconcile', 'operator_action'
        )),
        CONSTRAINT file_scan_events_disp_ck CHECK (disposition IN (
            'recorded', 'deferred', 'applied', 'duplicate', 'rejected'
        )),
        CONSTRAINT file_scan_events_version_ck CHECK (
            state_version IS NULL OR state_version >= 0
        ),
        CONSTRAINT file_scan_events_fp_ck CHECK (
            provider_event_fingerprint IS NULL OR
            provider_event_fingerprint ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT file_scan_events_payload_ck CHECK (
            payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT file_scan_events_error_ck CHECK (
            error_code IS NULL OR error_code IN (
                'authentication_failed', 'integrity_mismatch', 'internal_error',
                'lease_expired', 'provider_rejected', 'provider_timeout',
                'retry_exhausted', 'scanner_unavailable', 'storage_error'
            )
        ),
        CONSTRAINT file_scan_events_from_state_ck CHECK (
            from_state IS NULL OR from_state IN (
                'pending_upload', 'quarantined', 'scan_pending', 'scanning',
                'clean_verified', 'infected', 'scan_failed', 'expired'
            )
        ),
        CONSTRAINT file_scan_events_to_state_ck CHECK (
            to_state IS NULL OR to_state IN (
                'pending_upload', 'quarantined', 'scan_pending', 'scanning',
                'clean_verified', 'infected', 'scan_failed', 'expired'
            )
        ),
        CONSTRAINT file_scan_events_provider_ck CHECK (
            event_kind <> 'provider_delivery' OR (
                provider IS NOT NULL AND provider_event_id IS NOT NULL AND
                provider_event_fingerprint IS NOT NULL AND payload_sha256 IS NOT NULL
            )
        ),
        CONSTRAINT file_scan_events_transition_ck CHECK (
            event_kind <> 'state_transition' OR
            (to_state IS NOT NULL AND state_version IS NOT NULL)
        )
    )
    """,
    """
    CREATE UNIQUE INDEX file_scan_events_state_uniq
        ON "Learner".file_scan_events (job_id, state_version)
        WHERE event_kind = 'state_transition'
    """,
    """
    CREATE UNIQUE INDEX file_scan_events_provider_uniq
        ON "Learner".file_scan_events (provider, provider_event_id)
        WHERE event_kind = 'provider_delivery'
    """,
    """
    CREATE INDEX file_scan_events_deferred_idx
        ON "Learner".file_scan_events (received_at, id)
        WHERE event_kind = 'provider_delivery' AND disposition = 'deferred'
    """,
    """
    CREATE TABLE "Learner".file_scan_outbox (
        id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        job_id uuid NOT NULL,
        job_state_version bigint NOT NULL,
        operation varchar(32) NOT NULL,
        idempotency_key varchar(64) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'pending',
        attempt_count integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL DEFAULT now(),
        lease_owner varchar(255),
        lease_expires_at timestamptz,
        last_error_code varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        CONSTRAINT file_scan_outbox_job_fk FOREIGN KEY (job_id)
            REFERENCES "Learner".file_scan_jobs(id) ON DELETE RESTRICT,
        CONSTRAINT file_scan_outbox_version_ck CHECK (job_state_version >= 0),
        CONSTRAINT file_scan_outbox_operation_ck CHECK (operation IN (
            'upload_reconcile', 'submit_scan', 'promote', 'cleanup_quarantine'
        )),
        CONSTRAINT file_scan_outbox_status_ck CHECK (status IN (
            'pending', 'processing', 'retry', 'completed', 'dead'
        )),
        CONSTRAINT file_scan_outbox_attempt_ck CHECK (attempt_count >= 0),
        CONSTRAINT file_scan_outbox_key_ck CHECK (
            idempotency_key ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT file_scan_outbox_error_ck CHECK (
            last_error_code IS NULL OR last_error_code IN (
                'authentication_failed', 'integrity_mismatch', 'internal_error',
                'lease_expired', 'provider_rejected', 'provider_timeout',
                'retry_exhausted', 'scanner_unavailable', 'storage_error'
            )
        ),
        CONSTRAINT file_scan_outbox_lease_pair_ck CHECK (
            (lease_owner IS NULL AND lease_expires_at IS NULL) OR
            (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        ),
        CONSTRAINT file_scan_outbox_completed_ck CHECK (
            (status = 'completed' AND completed_at IS NOT NULL) OR
            (status <> 'completed' AND completed_at IS NULL)
        ),
        CONSTRAINT file_scan_outbox_idem_uniq UNIQUE (idempotency_key)
    )
    """,
    """
    CREATE INDEX file_scan_outbox_due_idx
        ON "Learner".file_scan_outbox (available_at, id)
        WHERE status IN ('pending', 'retry')
    """,
    """
    CREATE INDEX file_scan_outbox_lease_idx
        ON "Learner".file_scan_outbox (lease_expires_at, id)
        WHERE lease_expires_at IS NOT NULL
    """,
)

DROP_STATEMENTS = (
    'DROP TABLE "Learner".file_scan_outbox',
    'DROP TABLE "Learner".file_scan_events',
    'DROP TABLE "Learner".file_scan_jobs',
)


def _database_identity(connection):
    config = connection.settings_dict
    default_port = "5432" if connection.vendor == "postgresql" else ""
    return tuple(str(config.get(key) or "") for key in ("ENGINE", "NAME", "HOST", "USER")) + (
        str(config.get("PORT") or default_port),
    )


def _require_target(connection):
    if connection.vendor == "sqlite":
        return False
    if connection.vendor != "postgresql" or connection.alias != "default":
        raise RuntimeError("Install scanner persistence only on the canonical PostgreSQL default alias.")
    if _database_identity(connection) != _database_identity(connections["enrolment"]):
        raise RuntimeError("Verify default and enrolment identify the same database before scanner DDL.")
    return True


def _table_presence(cursor):
    cursor.execute(
        "SELECT to_regclass(%s), to_regclass(%s), to_regclass(%s)",
        TABLES,
    )
    return tuple(value is not None for value in cursor.fetchone())


def install(apps, schema_editor):
    connection = schema_editor.connection
    if not _require_target(connection):
        return
    with connection.cursor() as cursor:
        present = _table_presence(cursor)
    if any(present):
        raise RuntimeError("Scanner persistence tables already exist or are partially installed; migration refused.")
    for statement in CREATE_STATEMENTS:
        schema_editor.execute(statement)


def uninstall(apps, schema_editor):
    connection = schema_editor.connection
    if not _require_target(connection):
        return
    with connection.cursor() as cursor:
        present = _table_presence(cursor)
        if not any(present):
            return
        if not all(present):
            raise RuntimeError("Scanner persistence is partial; automatic reversal refused.")
        for table in reversed(TABLES):
            cursor.execute(f"SELECT count(*) FROM {table}")
            if int(cursor.fetchone()[0]) != 0:
                raise RuntimeError("Scanner persistence contains history; destructive reversal refused.")
    for statement in DROP_STATEMENTS:
        schema_editor.execute(statement)


STATE_CHOICES = tuple((value, value) for value in STATES)
EVENT_KIND_CHOICES = tuple((value, value) for value in EVENT_KINDS)
EVENT_DISPOSITION_CHOICES = tuple((value, value) for value in EVENT_DISPOSITIONS)
OUTBOX_OPERATION_CHOICES = tuple((value, value) for value in OUTBOX_OPERATIONS)
OUTBOX_STATUS_CHOICES = tuple((value, value) for value in OUTBOX_STATUSES)


class Migration(migrations.Migration):
    atomic = True
    dependencies = [("learner_api", "0025_progress_transfer_constraint_repair")]
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    install,
                    reverse_code=uninstall,
                    hints={"learner_schema_migration": True},
                )
            ],
            state_operations=[
                migrations.CreateModel(
                    name="FileScanJob",
                    fields=[
                        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ("domain_type", models.CharField(max_length=48)),
                        ("domain_record_key", models.CharField(blank=True, max_length=255, null=True)),
                        ("canonical_learner_kind", models.CharField(max_length=32)),
                        ("canonical_enrolment_id", models.IntegerField()),
                        ("requested_by_account_key", models.CharField(max_length=255)),
                        ("requested_by_role", models.CharField(max_length=32)),
                        ("idempotency_key_hash", models.CharField(max_length=64)),
                        ("original_filename", models.TextField()),
                        ("content_type", models.CharField(max_length=255)),
                        ("size_bytes", models.BigIntegerField()),
                        ("content_sha256", models.CharField(blank=True, max_length=64, null=True)),
                        ("quarantine_account", models.CharField(blank=True, max_length=255, null=True)),
                        ("quarantine_container", models.CharField(blank=True, max_length=255, null=True)),
                        ("quarantine_blob_name", models.TextField(blank=True, null=True)),
                        ("quarantine_etag", models.TextField(blank=True, null=True)),
                        ("quarantine_version_id", models.TextField(blank=True, null=True)),
                        ("provider", models.CharField(blank=True, max_length=64, null=True)),
                        ("correlation_id", models.CharField(blank=True, max_length=255, null=True)),
                        ("lifecycle_state", models.CharField(choices=STATE_CHOICES, default="pending_upload", max_length=32)),
                        ("state_version", models.BigIntegerField(default=0)),
                        ("attempt_count", models.IntegerField(default=0)),
                        ("retry_limit", models.IntegerField()),
                        ("next_attempt_at", models.DateTimeField(blank=True, null=True)),
                        ("lease_owner", models.CharField(blank=True, max_length=255, null=True)),
                        ("lease_expires_at", models.DateTimeField(blank=True, null=True)),
                        ("last_error_code", models.CharField(blank=True, max_length=64, null=True)),
                        ("approved_account", models.CharField(blank=True, max_length=255, null=True)),
                        ("approved_container", models.CharField(blank=True, max_length=255, null=True)),
                        ("approved_blob_name", models.TextField(blank=True, null=True)),
                        ("approved_etag", models.TextField(blank=True, null=True)),
                        ("promotion_completed_at", models.DateTimeField(blank=True, null=True)),
                        ("domain_metadata_committed_at", models.DateTimeField(blank=True, null=True)),
                        ("terminal_at", models.DateTimeField(blank=True, null=True)),
                        ("expires_at", models.DateTimeField()),
                        ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                        ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                    ],
                    options={
                        "db_table": 'Learner"."file_scan_jobs',
                        "indexes": [
                            models.Index(fields=("next_attempt_at", "id"), condition=Q(lifecycle_state__in=ACTIVE_STATES), name="file_scan_jobs_due_idx"),
                            models.Index(fields=("lease_expires_at", "id"), condition=Q(lease_expires_at__isnull=False), name="file_scan_jobs_lease_idx"),
                        ],
                        "constraints": [
                            models.CheckConstraint(condition=Q(lifecycle_state__in=STATES), name="file_scan_jobs_state_ck"),
                            models.CheckConstraint(condition=Q(state_version__gte=0), name="file_scan_jobs_version_ck"),
                            models.CheckConstraint(condition=Q(attempt_count__gte=0) & Q(retry_limit__gte=0) & Q(attempt_count__lte=F("retry_limit") + 1), name="file_scan_jobs_attempt_ck"),
                            models.CheckConstraint(condition=Q(size_bytes__gte=0), name="file_scan_jobs_size_ck"),
                            models.CheckConstraint(condition=Q(content_sha256__isnull=True) | Q(content_sha256__regex=r"^[0-9a-f]{64}$"), name="file_scan_jobs_hash_ck"),
                            models.CheckConstraint(condition=Q(idempotency_key_hash__regex=r"^[0-9a-f]{64}$"), name="file_scan_jobs_idem_hash_ck"),
                            models.CheckConstraint(condition=Q(last_error_code__isnull=True) | Q(last_error_code__in=FAILURE_CATEGORIES), name="file_scan_jobs_error_ck"),
                            models.CheckConstraint(condition=Q(lease_owner__isnull=True, lease_expires_at__isnull=True) | Q(lease_owner__isnull=False, lease_expires_at__isnull=False), name="file_scan_jobs_lease_pair_ck"),
                            models.CheckConstraint(condition=Q(quarantine_account__isnull=True, quarantine_container__isnull=True, quarantine_blob_name__isnull=True, quarantine_etag__isnull=True, quarantine_version_id__isnull=True) | Q(quarantine_account__isnull=False, quarantine_container__isnull=False, quarantine_blob_name__isnull=False, quarantine_etag__isnull=False), name="file_scan_jobs_blob_shape_ck"),
                            models.CheckConstraint(condition=Q(approved_account__isnull=True, approved_container__isnull=True, approved_blob_name__isnull=True, approved_etag__isnull=True) | Q(approved_account__isnull=False, approved_container__isnull=False, approved_blob_name__isnull=False, approved_etag__isnull=False), name="file_scan_jobs_approved_shape_ck"),
                            models.CheckConstraint(condition=Q(lifecycle_state__in=TERMINAL_STATES, terminal_at__isnull=False) | (~Q(lifecycle_state__in=TERMINAL_STATES) & Q(terminal_at__isnull=True)), name="file_scan_jobs_terminal_ck"),
                            models.CheckConstraint(condition=Q(expires_at__gt=F("created_at")), name="file_scan_jobs_expiry_ck"),
                            models.UniqueConstraint(fields=("requested_by_account_key", "canonical_enrolment_id", "domain_type", "idempotency_key_hash"), name="file_scan_jobs_actor_idem_uniq"),
                            models.UniqueConstraint(fields=("quarantine_account", "quarantine_container", "quarantine_blob_name", "quarantine_version_id", "quarantine_etag"), condition=Q(quarantine_blob_name__isnull=False), nulls_distinct=False, name="file_scan_jobs_blob_version_uniq"),
                        ],
                    },
                ),
                migrations.CreateModel(
                    name="FileScanEvent",
                    fields=[
                        ("id", models.BigAutoField(primary_key=True, serialize=False)),
                        ("event_kind", models.CharField(choices=EVENT_KIND_CHOICES, max_length=32)),
                        ("disposition", models.CharField(choices=EVENT_DISPOSITION_CHOICES, max_length=24)),
                        ("from_state", models.CharField(blank=True, choices=STATE_CHOICES, max_length=32, null=True)),
                        ("to_state", models.CharField(blank=True, choices=STATE_CHOICES, max_length=32, null=True)),
                        ("state_version", models.BigIntegerField(blank=True, null=True)),
                        ("provider", models.CharField(blank=True, max_length=64, null=True)),
                        ("provider_event_id", models.CharField(blank=True, max_length=255, null=True)),
                        ("provider_event_fingerprint", models.CharField(blank=True, max_length=64, null=True)),
                        ("correlation_id", models.CharField(blank=True, max_length=255, null=True)),
                        ("payload_sha256", models.CharField(blank=True, max_length=64, null=True)),
                        ("error_code", models.CharField(blank=True, max_length=64, null=True)),
                        ("occurred_at", models.DateTimeField()),
                        ("received_at", models.DateTimeField(default=django.utils.timezone.now)),
                        ("processed_at", models.DateTimeField(blank=True, null=True)),
                        ("job", models.ForeignKey(db_column="job_id", on_delete=django.db.models.deletion.RESTRICT, related_name="scan_events", to="learner_api.filescanjob")),
                    ],
                    options={
                        "db_table": 'Learner"."file_scan_events',
                        "indexes": [
                            models.Index(fields=("received_at", "id"), condition=Q(event_kind="provider_delivery", disposition="deferred"), name="file_scan_events_deferred_idx"),
                        ],
                        "constraints": [
                            models.CheckConstraint(condition=Q(event_kind__in=EVENT_KINDS), name="file_scan_events_kind_ck"),
                            models.CheckConstraint(condition=Q(disposition__in=EVENT_DISPOSITIONS), name="file_scan_events_disp_ck"),
                            models.CheckConstraint(condition=Q(state_version__isnull=True) | Q(state_version__gte=0), name="file_scan_events_version_ck"),
                            models.CheckConstraint(condition=Q(provider_event_fingerprint__isnull=True) | Q(provider_event_fingerprint__regex=r"^[0-9a-f]{64}$"), name="file_scan_events_fp_ck"),
                            models.CheckConstraint(condition=Q(payload_sha256__isnull=True) | Q(payload_sha256__regex=r"^[0-9a-f]{64}$"), name="file_scan_events_payload_ck"),
                            models.CheckConstraint(condition=Q(error_code__isnull=True) | Q(error_code__in=FAILURE_CATEGORIES), name="file_scan_events_error_ck"),
                            models.CheckConstraint(condition=Q(from_state__isnull=True) | Q(from_state__in=STATES), name="file_scan_events_from_state_ck"),
                            models.CheckConstraint(condition=Q(to_state__isnull=True) | Q(to_state__in=STATES), name="file_scan_events_to_state_ck"),
                            models.CheckConstraint(condition=~Q(event_kind="provider_delivery") | Q(provider__isnull=False, provider_event_id__isnull=False, provider_event_fingerprint__isnull=False, payload_sha256__isnull=False), name="file_scan_events_provider_ck"),
                            models.CheckConstraint(condition=~Q(event_kind="state_transition") | Q(to_state__isnull=False, state_version__isnull=False), name="file_scan_events_transition_ck"),
                            models.UniqueConstraint(fields=("job", "state_version"), condition=Q(event_kind="state_transition"), name="file_scan_events_state_uniq"),
                            models.UniqueConstraint(fields=("provider", "provider_event_id"), condition=Q(event_kind="provider_delivery"), name="file_scan_events_provider_uniq"),
                        ],
                    },
                ),
                migrations.CreateModel(
                    name="FileScanOutbox",
                    fields=[
                        ("id", models.BigAutoField(primary_key=True, serialize=False)),
                        ("job_state_version", models.BigIntegerField()),
                        ("operation", models.CharField(choices=OUTBOX_OPERATION_CHOICES, max_length=32)),
                        ("idempotency_key", models.CharField(max_length=64, unique=True)),
                        ("status", models.CharField(choices=OUTBOX_STATUS_CHOICES, default="pending", max_length=16)),
                        ("attempt_count", models.IntegerField(default=0)),
                        ("available_at", models.DateTimeField(default=django.utils.timezone.now)),
                        ("lease_owner", models.CharField(blank=True, max_length=255, null=True)),
                        ("lease_expires_at", models.DateTimeField(blank=True, null=True)),
                        ("last_error_code", models.CharField(blank=True, max_length=64, null=True)),
                        ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                        ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                        ("completed_at", models.DateTimeField(blank=True, null=True)),
                        ("job", models.ForeignKey(db_column="job_id", on_delete=django.db.models.deletion.RESTRICT, related_name="scan_outbox_operations", to="learner_api.filescanjob")),
                    ],
                    options={
                        "db_table": 'Learner"."file_scan_outbox',
                        "indexes": [
                            models.Index(fields=("available_at", "id"), condition=Q(status__in=("pending", "retry")), name="file_scan_outbox_due_idx"),
                            models.Index(fields=("lease_expires_at", "id"), condition=Q(lease_expires_at__isnull=False), name="file_scan_outbox_lease_idx"),
                        ],
                        "constraints": [
                            models.CheckConstraint(condition=Q(job_state_version__gte=0), name="file_scan_outbox_version_ck"),
                            models.CheckConstraint(condition=Q(operation__in=OUTBOX_OPERATIONS), name="file_scan_outbox_operation_ck"),
                            models.CheckConstraint(condition=Q(status__in=OUTBOX_STATUSES), name="file_scan_outbox_status_ck"),
                            models.CheckConstraint(condition=Q(attempt_count__gte=0), name="file_scan_outbox_attempt_ck"),
                            models.CheckConstraint(condition=Q(idempotency_key__regex=r"^[0-9a-f]{64}$"), name="file_scan_outbox_key_ck"),
                            models.CheckConstraint(condition=Q(last_error_code__isnull=True) | Q(last_error_code__in=FAILURE_CATEGORIES), name="file_scan_outbox_error_ck"),
                            models.CheckConstraint(condition=Q(lease_owner__isnull=True, lease_expires_at__isnull=True) | Q(lease_owner__isnull=False, lease_expires_at__isnull=False), name="file_scan_outbox_lease_pair_ck"),
                            models.CheckConstraint(condition=Q(status="completed", completed_at__isnull=False) | (~Q(status="completed") & Q(completed_at__isnull=True)), name="file_scan_outbox_completed_ck"),
                        ],
                    },
                ),
            ],
        )
    ]
