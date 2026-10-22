"""Read-only deployment validation for learner evidence tables.

Evidence schema is deployment-owned. HTTP requests must never create or alter
it. Run ``python manage.py validate_evidence_schema`` during deployment after
the target database has been independently verified.
"""
from dataclasses import dataclass
import re

from django.db import connections, transaction


SCHEMA = "Learner"

# PostgreSQL catalog type names are used so aliases such as ``bigint`` and
# ``timestamp with time zone`` have one stable representation.
REQUIRED_COLUMNS = {
    "evidence_files": {
        "id": ({"uuid"}, False),
        "learner_kind": ({"varchar"}, False),
        "learner_id": ({"varchar"}, False),
        "azure_oid": ({"varchar"}, True),
        "section_ref": ({"varchar"}, False),
        "container": ({"varchar"}, False),
        "blob_name": ({"varchar"}, False),
        "original_filename": ({"varchar"}, False),
        "content_type": ({"varchar"}, False),
        "size_bytes": ({"int8"}, False),
        "status": ({"varchar"}, False),
        "scan_result": ({"varchar"}, True),
        "uploaded_by": ({"varchar"}, True),
        "uploaded_at": ({"timestamptz"}, False),
        "reviewed_at": ({"timestamptz"}, True),
        "Training_plan_details": ({"json", "jsonb"}, True),
        "progress_entry_id": ({"int8"}, True),
        "component_ref": ({"text"}, True),
    },
    "Evidence": {
        "id": ({"int4", "int8"}, False),
        "Azure_id": ({"text", "varchar"}, True),
        "Evidence_name": ({"text", "varchar"}, True),
        "Evidence_path": ({"text", "varchar"}, True),
    },
}

REQUIRED_INDEXES = {
    ("evidence_files", "evidence_files_pkey"): {
        "columns": ("id",), "primary": True, "unique": True,
    },
    ("evidence_files", "evidence_files_blob_name_key"): {
        "columns": ("blob_name",), "primary": False, "unique": True,
    },
    ("evidence_files", "idx_evidence_files_learner"): {
        "columns": ("learner_kind", "learner_id"), "primary": False, "unique": False,
    },
    ("evidence_files", "idx_evidence_files_section"): {
        "columns": ("section_ref",), "primary": False, "unique": False,
    },
    ("evidence_files", "idx_evidence_files_status"): {
        "columns": ("status",), "primary": False, "unique": False,
    },
    ("evidence_files", "idx_evidence_files_component_ref"): {
        "columns": ("component_ref",), "primary": False, "unique": False,
        "predicate": "component_refisnotnull",
    },
    ("evidence_files", "idx_evidence_files_progress_entry"): {
        "columns": ("progress_entry_id",), "primary": False, "unique": False,
        "predicate": "progress_entry_idisnotnull",
    },
    ("Evidence", "Evidence_pkey"): {
        "columns": ("id",), "primary": True, "unique": True,
    },
    ("Evidence", "evidence_azure_id_uniq"): {
        "columns": ("Azure_id",), "primary": False, "unique": True,
    },
}


@dataclass(frozen=True)
class EvidenceSchemaReport:
    issues: tuple[str, ...]
    relation_count: int
    required_column_count: int
    required_index_count: int

    @property
    def valid(self):
        return not self.issues


class EvidenceSchemaValidationError(RuntimeError):
    """Raised by the deployment validator when the schema is not compatible."""

    def __init__(self, report):
        self.report = report
        super().__init__("; ".join(report.issues))


def _normalise_expression(value):
    return re.sub(r'[\s"()]', "", str(value or "").lower())


def _normalise_index_column(value):
    value = str(value or "").strip()
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1].replace('""', '"')
    return value


def inspect_evidence_schema(cursor):
    """Inspect evidence catalog metadata through the supplied read-only cursor."""
    issues = []

    cursor.execute(
        """
        SELECT c.relname, c.relkind
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = %s
           AND c.relname IN ('evidence_files', 'Evidence')
        """,
        [SCHEMA],
    )
    relations = dict(cursor.fetchall())
    for table in REQUIRED_COLUMNS:
        kind = relations.get(table)
        if kind is None:
            issues.append(f'missing base table "{SCHEMA}"."{table}"')
        elif kind not in {"r", "p"}:
            issues.append(f'"{SCHEMA}"."{table}" is not a base table')

    cursor.execute(
        """
        SELECT table_name, column_name, udt_name, is_nullable
          FROM information_schema.columns
         WHERE table_schema = %s
           AND table_name IN ('evidence_files', 'Evidence')
        """,
        [SCHEMA],
    )
    columns = {
        (table, column): (udt_name, nullable == "YES")
        for table, column, udt_name, nullable in cursor.fetchall()
    }
    for table, required in REQUIRED_COLUMNS.items():
        for column, (accepted_types, nullable) in required.items():
            actual = columns.get((table, column))
            if actual is None:
                issues.append(f'missing column "{SCHEMA}"."{table}"."{column}"')
                continue
            actual_type, actual_nullable = actual
            if actual_type not in accepted_types:
                issues.append(
                    f'incompatible type for "{SCHEMA}"."{table}"."{column}": {actual_type}'
                )
            if actual_nullable != nullable:
                requirement = "nullable" if nullable else "not null"
                issues.append(
                    f'incompatible nullability for "{SCHEMA}"."{table}"."{column}": '
                    f"expected {requirement}"
                )

    cursor.execute(
        """
        SELECT t.relname,
               i.relname,
               ix.indisprimary,
               ix.indisunique,
               ix.indisvalid,
               ARRAY(
                   SELECT pg_get_indexdef(ix.indexrelid, position, true)
                     FROM generate_series(1, ix.indnkeyatts) AS position
                    ORDER BY position
               ),
               pg_get_expr(ix.indpred, ix.indrelid)
          FROM pg_index ix
          JOIN pg_class t ON t.oid = ix.indrelid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = %s
           AND t.relname IN ('evidence_files', 'Evidence')
        """,
        [SCHEMA],
    )
    indexes = {
        (table, name): {
            "primary": primary,
            "unique": unique,
            "valid": valid,
            "columns": tuple(_normalise_index_column(column) for column in columns),
            "predicate": _normalise_expression(predicate),
        }
        for table, name, primary, unique, valid, columns, predicate in cursor.fetchall()
    }
    for key, required in REQUIRED_INDEXES.items():
        actual = indexes.get(key)
        label = f'"{SCHEMA}"."{key[0]}" index {key[1]}'
        if actual is None:
            issues.append(f"missing {label}")
            continue
        if not actual["valid"]:
            issues.append(f"invalid {label}")
        if actual["primary"] != required["primary"]:
            issues.append(f"incorrect primary-key flag for {label}")
        if actual["unique"] != required["unique"]:
            issues.append(f"incorrect uniqueness for {label}")
        if actual["columns"] != required["columns"]:
            issues.append(f"incorrect columns for {label}")
        predicate = required.get("predicate", "")
        if actual["predicate"] != predicate:
            issues.append(f"incorrect predicate for {label}")

    return EvidenceSchemaReport(
        issues=tuple(issues),
        relation_count=len(relations),
        required_column_count=sum(len(columns) for columns in REQUIRED_COLUMNS.values()),
        required_index_count=len(REQUIRED_INDEXES),
    )


def validate_evidence_schema(*, using="enrolment"):
    """Validate through an explicit read-only transaction; never execute DDL."""
    connection = connections[using]
    with transaction.atomic(using=using):
        with connection.cursor() as cursor:
            # This must be the first statement inside the transaction.
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SHOW transaction_read_only")
            mode = cursor.fetchone()
            if not mode or mode[0] != "on":
                raise RuntimeError("Evidence schema validation transaction is not read-only.")
            report = inspect_evidence_schema(cursor)
            if not report.valid:
                raise EvidenceSchemaValidationError(report)
            return report
