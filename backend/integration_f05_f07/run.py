"""Opt-in F05/F07 PostgreSQL integration runner.

The runner accepts the disposable credential only through stdin, pins every
connection to the approved direct Neon endpoint, forbids DDL/administrative
SQL, and cleans the two deliberately committed concurrency fixtures by their
exact IDs. Other fixture checks run in transactions that are always rolled
back.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import uuid

import certifi
import psycopg
from psycopg import sql


APP_NAME = "f05-f07-closure-runner"
EXPECTED_LEDGER = "db539ffd7a63b7ae29ee104c94fd9b024e989fd0bf458319895325e88b5beec8"
FORBIDDEN_SQL = re.compile(
    r"\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|REINDEX|"
    r"DISCARD|SET\s+ROLE|SET\s+SESSION\s+AUTHORIZATION|PG_TERMINATE_BACKEND)\b",
    re.I,
)
TOUCHED_TABLES = (
    ("Learner", "learner_progress_entries"),
    ("Learner", "learner_quiz_answers"),
    ("Learner", "learning_reflection_submissions"),
    ("Learner", "learner_monthly_reports"),
    ("Learner", "monthly_log_provisional_rows"),
    ("Learner", "progress_review_runs"),
    ("Learner", "progress_review_source_snapshots"),
    ("Learner", "progress_review_signature_cache"),
    ("Learner", "progress_review_pptx_files"),
    ("Coach", "coach_imported_review_instance"),
    ("Coach", "coach_migrated_review_signature"),
    ("Coach", "coach_migrated_review_document"),
    ("curriculum", "review_instances"),
    ("curriculum", "review_instance_signatures"),
)


class Refused(RuntimeError):
    pass


@dataclass(frozen=True)
class Approval:
    authorization_id: str
    project_id: str
    branch_id: str
    parent_branch_id: str
    endpoint_id: str
    host: str
    database: str
    role: str
    starts_at: str
    expires_at: str
    approver: str
    rollback_owner: str
    ledger_sha256: str
    run_id: str

    @classmethod
    def parse(cls, raw: dict) -> "Approval":
        if set(raw) != set(cls.__dataclass_fields__):
            raise Refused("authorization manifest fields do not match")
        item = cls(**raw)
        exact = {
            "authorization_id": "F05-F07-PG-CLOSURE-20261024-01",
            "project_id": "green-term-97168878",
            "branch_id": "br-damp-river-abvy0gv6",
            "parent_branch_id": "br-raspy-sky-abvs8lq9",
            "endpoint_id": "ep-patient-paper-abu3q4y6",
            "host": "ep-patient-paper-abu3q4y6.eu-west-2.aws.neon.tech",
            "database": "neondb",
            "role": "neondb_owner",
            "approver": "Project Owner",
            "rollback_owner": "Project Owner",
            "ledger_sha256": EXPECTED_LEDGER,
        }
        for name, value in exact.items():
            if getattr(item, name) != value:
                raise Refused(f"authorization {name} is not approved")
        start = datetime.fromisoformat(item.starts_at.replace("Z", "+00:00"))
        expiry = datetime.fromisoformat(item.expires_at.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if not start <= now < expiry:
            raise Refused("authorization window is not active")
        if not re.fullmatch(r"f05f07_[0-9a-f]{32}", item.run_id):
            raise Refused("synthetic run ID is invalid")
        return item

    def require_active_window(self) -> None:
        start = datetime.fromisoformat(self.starts_at.replace("Z", "+00:00"))
        expiry = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        if not start <= datetime.now(timezone.utc) < expiry:
            raise Refused("authorization window is not active")


class GuardedCursor(psycopg.Cursor):
    def execute(self, query, params=None, **kwargs):
        rendered = query.as_string(self.connection) if hasattr(query, "as_string") else str(query)
        if FORBIDDEN_SQL.search(rendered):
            raise Refused("forbidden SQL operation")
        if ";" in rendered.rstrip().rstrip(";") or "--" in rendered or "/*" in rendered:
            raise Refused("multiple or opaque SQL statements are forbidden")
        return super().execute(query, params, **kwargs)

    def executemany(self, query, params_seq, **kwargs):
        rendered = query.as_string(self.connection) if hasattr(query, "as_string") else str(query)
        if FORBIDDEN_SQL.search(rendered):
            raise Refused("forbidden SQL operation")
        return super().executemany(query, params_seq, **kwargs)

    def copy(self, *args, **kwargs):
        raise Refused("COPY is forbidden")


def ledger_digest(rows) -> str:
    normalized = sorted((str(app), str(name)) for app, name in rows)
    payload = json.dumps(normalized, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return hashlib.sha256(payload).hexdigest()


def connect(approval: Approval, password: str, *, readonly: bool = True):
    options = (
        "-c statement_timeout=30000 -c lock_timeout=5000 "
        "-c idle_in_transaction_session_timeout=60000 "
        f"-c default_transaction_read_only={'on' if readonly else 'off'}"
    )
    return psycopg.connect(
        host=approval.host,
        port=5432,
        dbname=approval.database,
        user=approval.role,
        password=password,
        sslmode="verify-full",
        sslrootcert=certifi.where(),
        channel_binding="require",
        connect_timeout=10,
        application_name=APP_NAME,
        options=options,
        cursor_factory=GuardedCursor,
    )


def summarize_session_guard(*, observer_pid: int, rows, waiting_locks: int,
                            lock_waiters: int, blocking_sessions: int,
                            endpoint_host: str) -> dict:
    """Return safe diagnostics without assuming PgBouncer-labelled ownership."""
    observer = None
    others = []
    for row in rows:
        item = {
            "pid": int(row[0]),
            "application_name": str(row[1] or ""),
            "state": str(row[2] or "unknown"),
            "backend_type": str(row[3] or "unknown"),
            "wait_event_type": str(row[4] or ""),
            "wait_event": str(row[5] or ""),
            "xact_age_seconds": None if row[6] is None else int(row[6]),
            "backend_age_seconds": None if row[7] is None else int(row[7]),
        }
        if item["pid"] == observer_pid:
            observer = item
        elif item["backend_type"] == "client backend":
            others.append(item)
    if observer is None:
        raise Refused("monitoring connection is absent from its own session snapshot")
    by_state = {}
    by_application = {}
    for item in others:
        by_state[item["state"]] = by_state.get(item["state"], 0) + 1
        app = item["application_name"] or "(empty)"
        by_application[app] = by_application.get(app, 0) + 1
    return {
        "endpoint_connection_type": "pooled" if "-pooler." in endpoint_host else "direct",
        "observer": observer,
        "other_client_sessions": len(others),
        "other_sessions_by_state": dict(sorted(by_state.items())),
        "other_sessions_by_application": dict(sorted(by_application.items())),
        "other_sessions": others,
        "waiting_locks": int(waiting_locks),
        "lock_waiters": int(lock_waiters),
        "blocking_sessions": int(blocking_sessions),
    }


def enforce_session_guard(report: dict) -> None:
    if report["endpoint_connection_type"] != "direct":
        raise Refused("guarded integration requires the direct endpoint")
    if (report["other_client_sessions"] or report["waiting_locks"]
            or report["lock_waiters"] or report["blocking_sessions"]):
        raise Refused("unidentified client sessions or blocking locks remain")


def verified_tls_diagnostics(connection) -> dict:
    """Use libpq's client-side TLS facts; Neon proxies hide them in pg_stat_ssl."""
    if not connection.pgconn.ssl_in_use:
        raise Refused("TLS is not active")
    return {
        "enabled": True,
        "verification": "verify-full",
        "channel_binding": "require",
    }


def verify_live(conn, approval: Approval, *, enforce_sessions: bool = True) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT current_database(),current_user,current_setting(%s,true),"
            "current_setting(%s),current_setting(%s)",
            ["neon.branch_id", "transaction_read_only", "ssl"],
        )
        database, role, branch, read_only, ssl_setting = cur.fetchone()
        if (database, role, branch, read_only) != (
            approval.database, approval.role, approval.branch_id, "on"
        ):
            raise Refused("live database identity mismatch")
        cur.execute("SELECT app,name FROM django_migrations ORDER BY app,name")
        digest = ledger_digest(cur.fetchall())
        if digest != approval.ledger_sha256:
            raise Refused("migration ledger changed after approval")
        cur.execute(
            "SELECT name FROM django_migrations WHERE app=%s AND name IN (%s,%s) ORDER BY name",
            ["learner_api", "0025_progress_transfer_constraint_repair", "0026_file_scan_persistence"],
        )
        pins = [row[0] for row in cur.fetchall()]
        if pins != ["0025_progress_transfer_constraint_repair", "0026_file_scan_persistence"]:
            raise Refused("required learner migrations are not applied")
        cur.execute("SELECT pg_backend_pid()")
        observer_pid = cur.fetchone()[0]
        cur.execute(
            "SELECT pid,application_name,state,backend_type,wait_event_type,wait_event,"
            "CASE WHEN xact_start IS NULL THEN NULL ELSE floor(extract(epoch FROM clock_timestamp()-xact_start))::bigint END,"
            "CASE WHEN backend_start IS NULL THEN NULL ELSE floor(extract(epoch FROM clock_timestamp()-backend_start))::bigint END "
            "FROM pg_stat_activity WHERE datname=current_database() ORDER BY pid"
        )
        session_rows = cur.fetchall()
        cur.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
        waiting_locks = cur.fetchone()[0]
        cur.execute(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type=%s",
            ["Lock"],
        )
        lock_waiters = cur.fetchone()[0]
        cur.execute(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
            "AND cardinality(pg_blocking_pids(pid))>0"
        )
        blocking_sessions = cur.fetchone()[0]
        session_guard = summarize_session_guard(
            observer_pid=observer_pid,
            rows=session_rows,
            waiting_locks=waiting_locks,
            lock_waiters=lock_waiters,
            blocking_sessions=blocking_sessions,
            endpoint_host=approval.host,
        )
        if enforce_sessions:
            enforce_session_guard(session_guard)
        tls = verified_tls_diagnostics(conn)
    conn.rollback()
    return {
        "database": database,
        "role": role,
        "branch_id": branch,
        "transaction_read_only": read_only,
        "ledger_sha256": digest,
        "session_guard": session_guard,
        "tls": tls,
        "server_ssl_setting": ssl_setting,
    }


def table_fingerprint(cur, schema: str, table: str):
    statement = sql.SQL(
        "SELECT count(*),coalesce(sum(hashtextextended(row_to_json(t)::text,0)::numeric),0) "
        "FROM {}.{} t"
    ).format(sql.Identifier(schema), sql.Identifier(table))
    cur.execute(statement)
    count, digest = cur.fetchone()
    return {"count": count, "digest": str(digest)}


def fingerprints(conn):
    with conn.cursor() as cur:
        return {f"{schema}.{table}": table_fingerprint(cur, schema, table)
                for schema, table in TOUCHED_TABLES}


def measured(cur, statement, params=()):
    started = time.perf_counter()
    cur.execute(statement, params)
    rows = cur.fetchall()
    elapsed = (time.perf_counter() - started) * 1000
    payload = len(json.dumps(rows, default=str, separators=(",", ":")).encode("utf-8"))
    return rows, round(elapsed, 3), payload


def quiz_students_index_probe(conn) -> dict:
    """Run bounded read-only plans for the real Quiz Students access path."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT quiz_ref FROM \"Learner\".learner_progress_entries "
            "WHERE kind=%s AND deleted_at IS NULL AND quiz_ref IS NOT NULL "
            "GROUP BY quiz_ref ORDER BY count(*) DESC,quiz_ref LIMIT 1",
            ["quiz"],
        )
        selected = cur.fetchone()
        if not selected:
            raise Refused("no quiz attempts exist for a representative plan")
        quiz_ref = selected[0]
        plans = {}
        statements = {
            "summary": (
                "SELECT p.learner_id,count(p.id),max(p.grade),"
                "(SELECT p2.passed FROM \"Learner\".learner_progress_entries p2 "
                "WHERE p2.learner_id=p.learner_id AND p2.kind=%s AND p2.quiz_ref=%s "
                "AND p2.deleted_at IS NULL ORDER BY p2.submitted_at DESC NULLS LAST,"
                "p2.attempt DESC,p2.id DESC LIMIT 1) "
                "FROM \"Learner\".learner_progress_entries p "
                "JOIN \"Learner\".learners l ON l.id=p.learner_id "
                "WHERE l.lifecycle_status=%s AND p.kind=%s AND p.quiz_ref=%s "
                "AND p.deleted_at IS NULL GROUP BY p.learner_id"
            ),
            "learner_page": (
                "SELECT l.id,(SELECT p2.submitted_at FROM \"Learner\".learner_progress_entries p2 "
                "WHERE p2.learner_id=l.id AND p2.kind=%s AND p2.quiz_ref=%s "
                "AND p2.deleted_at IS NULL ORDER BY p2.submitted_at DESC NULLS LAST,"
                "p2.attempt DESC,p2.id DESC LIMIT 1) AS latest_quiz_submitted "
                "FROM \"Learner\".learners l WHERE l.lifecycle_status=%s AND EXISTS "
                "(SELECT 1 FROM \"Learner\".learner_progress_entries p "
                "WHERE p.learner_id=l.id AND p.kind=%s AND p.quiz_ref=%s AND p.deleted_at IS NULL) "
                "ORDER BY latest_quiz_submitted DESC NULLS LAST,l.full_name DESC NULLS LAST,l.id DESC LIMIT 25"
            ),
        }
        params = ["quiz", quiz_ref, "active", "quiz", quiz_ref]
        for name, statement in statements.items():
            cur.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + statement, params)
            document = cur.fetchone()[0][0]
            nodes = []

            def walk(node):
                nodes.append({
                    "node_type": node.get("Node Type"),
                    "index_name": node.get("Index Name"),
                    "actual_rows": node.get("Actual Rows"),
                    "loops": node.get("Actual Loops"),
                    "shared_hit_blocks": node.get("Shared Hit Blocks", 0),
                    "shared_read_blocks": node.get("Shared Read Blocks", 0),
                })
                for child in node.get("Plans", []):
                    walk(child)

            walk(document["Plan"])
            plans[name] = {
                "planning_time_ms": round(document.get("Planning Time", 0), 3),
                "execution_time_ms": round(document.get("Execution Time", 0), 3),
                "root_total_cost": document["Plan"].get("Total Cost"),
                "nodes": nodes,
            }
        cur.execute(
            "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=%s AND tablename=%s ORDER BY indexname",
            ["Learner", "learner_progress_entries"],
        )
        indexes = [{"name": name, "definition": definition} for name, definition in cur.fetchall()]
    conn.rollback()
    return {"representative_quiz_ref_redacted": True, "plans": plans, "indexes": indexes}


def read_performance(conn):
    results = {"query_count": 0}
    with conn.cursor() as cur:
        pages = []
        for offset in (0, 25):
            rows, latency, payload = measured(
                cur,
                "SELECT id,title,status,assessment_type,updated_at FROM curriculum.quizzes "
                "WHERE assessment_type=%s ORDER BY updated_at DESC,id DESC LIMIT %s OFFSET %s",
                ["quiz", 25, offset],
            )
            pages.append({"ids": [r[0] for r in rows], "latency_ms": latency,
                          "payload_bytes": payload, "size": len(rows)})
            results["query_count"] += 1
        if set(pages[0]["ids"]) & set(pages[1]["ids"]):
            raise AssertionError("quiz pagination duplicated rows")
        results["quiz_workspace"] = {
            "pages": [{k: v for k, v in page.items() if k != "ids"} for page in pages],
            "duplicates": 0,
        }

        qpages = []
        for offset in (0, 50):
            rows, latency, payload = measured(
                cur,
                "SELECT q.id,q.quiz_id,q.question_type,q.sort_order FROM curriculum.quiz_questions q "
                "JOIN curriculum.quizzes z ON z.id=q.quiz_id WHERE NOT q.is_archived "
                "ORDER BY z.updated_at DESC,z.id DESC,q.sort_order,q.id LIMIT %s OFFSET %s",
                [50, offset],
            )
            qpages.append({"ids": [r[0] for r in rows], "latency_ms": latency,
                           "payload_bytes": payload, "size": len(rows)})
            results["query_count"] += 1
        if set(qpages[0]["ids"]) & set(qpages[1]["ids"]):
            raise AssertionError("question pagination duplicated rows")
        results["question_bank"] = {
            "pages": [{k: v for k, v in page.items() if k != "ids"} for page in qpages],
            "duplicates": 0,
        }

        rows, latency, _ = measured(
            cur,
            "SELECT quiz_ref,count(*),count(DISTINCT learner_id) FROM \"Learner\".learner_progress_entries "
            "WHERE kind=%s AND deleted_at IS NULL AND quiz_ref IS NOT NULL GROUP BY quiz_ref "
            "ORDER BY count(*) DESC,quiz_ref LIMIT 1",
            ["quiz"],
        )
        results["query_count"] += 1
        quiz_ref = rows[0][0]
        student_pages = []
        for offset in (0, 25):
            rows, page_latency, payload = measured(
                cur,
                "SELECT learner_id,count(*) AS attempts,max(grade) AS best_grade,max(submitted_at) AS latest "
                "FROM \"Learner\".learner_progress_entries WHERE kind=%s AND quiz_ref=%s "
                "AND deleted_at IS NULL GROUP BY learner_id ORDER BY latest DESC NULLS LAST,learner_id LIMIT %s OFFSET %s",
                ["quiz", quiz_ref, 25, offset],
            )
            student_pages.append({"ids": [r[0] for r in rows], "latency_ms": page_latency,
                                  "payload_bytes": payload, "size": len(rows)})
            results["query_count"] += 1
        if set(student_pages[0]["ids"]) & set(student_pages[1]["ids"]):
            raise AssertionError("quiz student pagination duplicated learners")
        results["quiz_students"] = {
            "representative_attempt_rows": rows and "bounded" or "empty",
            "selection_latency_ms": latency,
            "pages": [{k: v for k, v in page.items() if k != "ids"} for page in student_pages],
            "duplicates": 0,
        }

        rows, latency, payload = measured(
            cur,
            "SELECT id,learner_kind,learner_id,month_key,status,summary_metrics,attachments,"
            "learned_summary,updated_at FROM \"Learner\".learner_monthly_reports "
            "ORDER BY month_key DESC,id DESC LIMIT %s OFFSET %s",
            [25, 0],
        )
        results["query_count"] += 1
        results["monthly_reports"] = {
            "size": len(rows), "latency_ms": latency, "payload_bytes": payload,
            "note": "live table is too small for representative pagination conclusions",
        }
    conn.rollback()
    return results


def f05_transactional(conn, run_id: str):
    run_uuid = uuid.UUID(run_id.split("_", 1)[1])
    progress_id = -int(run_uuid.hex[:15], 16)
    answer_id = progress_id - 1
    learner_id = None
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM \"Learner\".learners ORDER BY id LIMIT 1")
        learner_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO \"Learner\".learner_progress_entries "
            "(id,learner_id,entry_order,kind,quiz_ref,attempt,grade,achieved_score,total_score,passed,"
            "submitted_at,component_link_source,source_system,source_activity_id,source_attempt_key,"
            "canonical_activity_key,activity_status,reporting_month) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s,%s,%s,%s,%s,%s,%s)",
            [progress_id, learner_id, 2_000_000_000, "quiz", "5601", 1, Decimal("0.8"),
             4, 5, True, "quiz_ref", "f05f07", run_id, run_id + ":1", run_id,
             "completed", "2026-10"],
        )
        cur.execute(
            "INSERT INTO \"Learner\".learner_quiz_answers "
            "(id,progress_id,position,question_ref,is_correct,earned,result_snapshot) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            [answer_id, progress_id, 0, 1, True, 1, json.dumps({"runId": run_id})],
        )
        reflection_id = run_uuid
        for suffix, learner_text in (("a", str(learner_id)), ("b", str(learner_id + 10_000_000))):
            rid = reflection_id if suffix == "a" else uuid.UUID(int=(reflection_id.int + 1) % (1 << 128))
            cur.execute(
                "INSERT INTO \"Learner\".learning_reflection_submissions "
                "(id,learner_kind,learner_id,activity_type,activity_id,learning_reflection,assignment_topic_id,full_submission) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                [rid, "commercial", learner_text, "assignment", run_id,
                 "Synthetic closure reflection", "S", json.dumps({"runId": run_id})],
            )
        cur.execute(
            "SELECT count(*) FROM \"Learner\".learning_reflection_submissions "
            "WHERE activity_id=%s GROUP BY learner_id ORDER BY learner_id",
            [run_id],
        )
        isolated = [row[0] for row in cur.fetchall()]
        if isolated != [1, 1]:
            raise AssertionError("learner identity isolation failed")
        cur.execute(
            "SELECT count(*) FILTER (WHERE passed),count(*) FILTER (WHERE NOT passed) "
            "FROM \"Learner\".learner_progress_entries WHERE id=%s",
            [progress_id],
        )
        completion = cur.fetchone()
        if completion != (1, 0):
            raise AssertionError("authoritative completion state failed")
    conn.rollback()
    return {"assessment_persistence": "pass", "identity_isolation": "pass",
            "completion_calculation": "pass", "transaction": "rolled_back"}


def f07_transactional(conn, run_id: str):
    run_uuid = uuid.UUID(run_id.split("_", 1)[1])
    run_text = run_id
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO \"Learner\".monthly_log_provisional_rows "
            "(run_id,aptem_id,month,source_ref,payload,formula_rule,created_by) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            [run_uuid, -int(run_uuid.hex[:12], 16), "2026-10", run_id,
             json.dumps({"runId": run_id, "hours": 1}), "synthetic-closure", "Project Owner"],
        )
        cur.execute(
            "INSERT INTO \"Learner\".progress_review_runs "
            "(id,learner_kind,learner_id,review_date,review_period_start,review_period_end,"
            "generation_status,generated_by,review_kind) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [run_text, "commercial", -int(run_uuid.hex[:10], 16), "2026-10-24",
             "2026-09-01", "2026-10-24", "completed", "Project Owner", "progress_review"],
        )
        cur.execute(
            "INSERT INTO \"Learner\".progress_review_source_snapshots (run_id,pack) VALUES (%s,%s)",
            [run_text, json.dumps({"runId": run_id, "monthlyTotal": 1})],
        )
        cur.execute(
            "INSERT INTO \"Learner\".progress_review_signature_cache "
            "(learner_id,source_fingerprint,learner_signature_data,learner_signer_name,"
            "coach_signature_data,coach_signer_name,extraction_version) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            [run_text, run_text, "synthetic-signature", "Synthetic Learner",
             "synthetic-coach-signature", "Synthetic Coach", "closure-v1"],
        )
        cur.execute(
            "INSERT INTO \"Learner\".progress_review_pptx_files "
            "(run_id,container,blob_name,original_filename,size_bytes,generated_by) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            [run_text, "synthetic", run_text + ".pptx", "synthetic.pptx", 128, "Project Owner"],
        )

        overlay_id = -int(run_uuid.hex[:15], 16)
        cur.execute(
            "INSERT INTO \"Coach\".coach_imported_review_instance "
            "(id,event_key,owner_email,learner_id,answers,status,created_at,updated_at,"
            "template_snapshot,signature_requirements,meeting_intelligence) "
            "VALUES (%s,%s,%s,%s,%s,%s,now(),now(),%s,%s,%s)",
            [overlay_id, run_id, "synthetic@example.invalid", -1, json.dumps({"runId": run_id}),
             "awaiting-signature", json.dumps({}), json.dumps({"learner": True}), json.dumps({})],
        )
        signature_id = overlay_id - 1
        cur.execute(
            "INSERT INTO \"Coach\".coach_migrated_review_signature "
            "(id,role,signer_account_id,signer_name,signer_email,signature,signed_at,created_at,updated_at,overlay_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,now(),now(),now(),%s)",
            [signature_id, "learner", -1, "Synthetic Learner", "synthetic@example.invalid",
             "synthetic-signature", overlay_id],
        )
        pdf = b"%PDF-1.4 synthetic closure"
        pdf_sha = hashlib.sha256(pdf).hexdigest()
        cur.execute(
            "INSERT INTO \"Coach\".coach_migrated_review_document "
            "(id,pdf_bytes,sha256,created_at,overlay_id) VALUES (%s,%s,%s,now(),%s)",
            [overlay_id, pdf, pdf_sha, overlay_id],
        )
        cur.execute(
            "SELECT encode(digest(pdf_bytes,%s),%s)=sha256 FROM \"Coach\".coach_migrated_review_document WHERE id=%s",
            ["sha256", "hex", overlay_id],
        )
        if cur.fetchone()[0] is not True:
            raise AssertionError("PDF digest mismatch")

        cur.execute(
            "SELECT id,review_template_id,programme_id FROM curriculum.review_instances "
            "ORDER BY created_at LIMIT 1"
        )
        existing = cur.fetchone()
        review_id = run_id
        if existing:
            _, template_id, programme_id = existing
            cur.execute(
                "INSERT INTO curriculum.review_instances "
                "(id,review_template_id,learner_id,learner_kind,programme_id,occurrence_number,"
                "target_date,coach_email,definition_snapshot,status,created_by,updated_by,occurrence_source,occurrence_ref) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                [review_id, template_id, -1, "commercial", programme_id, 2_000_000_000,
                 "2026-10-24", "synthetic@example.invalid", json.dumps({"runId": run_id}),
                 "awaiting-signature", "Project Owner", "Project Owner", "manual", run_id],
            )
            cur.execute(
                "INSERT INTO curriculum.review_instance_signatures "
                "(id,review_instance_id,role,signed_by,signed_name,signature,signed_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,now())",
                [run_id + ":signature", review_id, "participant", "synthetic",
                 "Synthetic Learner", "synthetic-signature"],
            )
        cur.execute(
            "SELECT generation_status FROM \"Learner\".progress_review_runs WHERE id=%s",
            [run_text],
        )
        if cur.fetchone() != ("completed",):
            raise AssertionError("progress review persistence failed")
    conn.rollback()
    return {"monthly_log": "pass", "mcm": "pass", "progress_review": "pass",
            "signatures": "pass", "pdf_digest": "pass", "transaction": "rolled_back"}


def committed_concurrency(approval: Approval, password: str, run_id: str):
    marker = uuid.UUID(run_id.split("_", 1)[1])
    monthly_id = marker
    reflection_id = uuid.UUID(int=(marker.int + 2) % (1 << 128))
    results = {}
    setup = connect(approval, password, readonly=False)
    try:
        with setup.cursor() as cur:
            cur.execute(
                "INSERT INTO \"Learner\".learner_monthly_reports "
                "(id,learner_kind,learner_id,learner_name,programme_name,month_key,month_label,status,learned_summary) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                [monthly_id, "commercial", run_id, "Synthetic Learner", "Synthetic Programme",
                 "2026-10", "October 2026", "submitted", run_id],
            )
            cur.execute(
                "INSERT INTO \"Learner\".learning_reflection_submissions "
                "(id,learner_kind,learner_id,activity_type,activity_id,learning_reflection,assignment_topic_id,full_submission) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                [reflection_id, "commercial", run_id, "assignment", run_id,
                 "Synthetic concurrency reflection", "S", json.dumps({"runId": run_id})],
            )
        setup.commit()

        first = connect(approval, password, readonly=False)
        second = connect(approval, password, readonly=False)
        try:
            with first.cursor() as cur:
                cur.execute("SELECT updated_at FROM \"Learner\".learner_monthly_reports WHERE id=%s", [monthly_id])
                expected = cur.fetchone()[0]
                cur.execute(
                    "UPDATE \"Learner\".learner_monthly_reports SET learned_summary=%s,updated_at=clock_timestamp() "
                    "WHERE id=%s AND updated_at IS NOT DISTINCT FROM %s",
                    ["first", monthly_id, expected],
                )
                first_count = cur.rowcount
            first.commit()
            with second.cursor() as cur:
                cur.execute(
                    "UPDATE \"Learner\".learner_monthly_reports SET learned_summary=%s,updated_at=clock_timestamp() "
                    "WHERE id=%s AND updated_at IS NOT DISTINCT FROM %s",
                    ["stale", monthly_id, expected],
                )
                stale_count = cur.rowcount
            second.rollback()
            if (first_count, stale_count) != (1, 0):
                raise AssertionError("monthly stale-write protection failed")

            with first.cursor() as cur:
                cur.execute(
                    "UPDATE \"Learner\".learning_reflection_submissions SET status=%s,reviewed_at=clock_timestamp() "
                    "WHERE id=%s AND reviewed_at IS NULL",
                    ["accepted", reflection_id],
                )
                first_mark = cur.rowcount
            first.commit()
            with second.cursor() as cur:
                cur.execute(
                    "UPDATE \"Learner\".learning_reflection_submissions SET status=%s,reviewed_at=clock_timestamp() "
                    "WHERE id=%s AND reviewed_at IS NULL",
                    ["rejected", reflection_id],
                )
                stale_mark = cur.rowcount
            second.rollback()
            if (first_mark, stale_mark) != (1, 0):
                raise AssertionError("marking stale-write protection failed")
            results = {"monthly_first_write": first_count, "monthly_stale_write": stale_count,
                       "marking_first_write": first_mark, "marking_stale_write": stale_mark}
        finally:
            first.close()
            second.close()
    finally:
        try:
            with setup.cursor() as cur:
                cur.execute("DELETE FROM \"Learner\".learning_reflection_submissions WHERE id=%s", [reflection_id])
                cur.execute("DELETE FROM \"Learner\".learner_monthly_reports WHERE id=%s", [monthly_id])
            setup.commit()
        finally:
            setup.close()

    verify = connect(approval, password, readonly=True)
    try:
        with verify.cursor() as cur:
            cur.execute(
                "SELECT (SELECT count(*) FROM \"Learner\".learning_reflection_submissions WHERE id=%s),"
                "(SELECT count(*) FROM \"Learner\".learner_monthly_reports WHERE id=%s)",
                [reflection_id, monthly_id],
            )
            remaining = cur.fetchone()
            if remaining != (0, 0):
                raise Refused("committed fixture cleanup failed")
    finally:
        verify.close()
    results["cleanup_remaining"] = 0
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--diagnose-only", action="store_true")
    parser.add_argument("--quiz-students-plan", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.execute, args.diagnose_only, args.quiz_students_plan)) != 1:
        raise Refused("choose exactly one runner mode")
    approval = Approval.parse(json.loads(args.approval.read_text(encoding="utf-8")))
    secret = json.loads(sys.stdin.readline())
    if set(secret) != {"password"} or not isinstance(secret["password"], str) or not secret["password"]:
        raise Refused("credential input is invalid")
    if args.receipt.exists():
        raise Refused("receipt path already exists")

    readonly = connect(approval, secret["password"], readonly=True)
    writable = None
    receipt = {"authorization_id": approval.authorization_id, "run_id": approval.run_id,
               "started_at": datetime.now(timezone.utc).isoformat(), "status": "failed"}
    try:
        if args.diagnose_only:
            receipt["preflight"] = verify_live(readonly, approval, enforce_sessions=False)
            receipt["status"] = "ready" if not (
                receipt["preflight"]["session_guard"]["other_client_sessions"]
                or receipt["preflight"]["session_guard"]["waiting_locks"]
                or receipt["preflight"]["session_guard"]["lock_waiters"]
                or receipt["preflight"]["session_guard"]["blocking_sessions"]
            ) else "blocked"
            receipt["finished_at"] = datetime.now(timezone.utc).isoformat()
            args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True), encoding="utf-8")
            print(json.dumps({"status": receipt["status"], "receipt": str(args.receipt)}, sort_keys=True))
            return 0 if receipt["status"] == "ready" else 3
        if args.quiz_students_plan:
            receipt["preflight"] = verify_live(readonly, approval)
            receipt["quiz_students_index_probe"] = quiz_students_index_probe(readonly)
            receipt["status"] = "passed"
            receipt["finished_at"] = datetime.now(timezone.utc).isoformat()
            args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True), encoding="utf-8")
            print(json.dumps({"status": "passed", "receipt": str(args.receipt)}, sort_keys=True))
            return 0
        receipt["preflight"] = verify_live(readonly, approval)
        receipt["before"] = fingerprints(readonly)
        receipt["read_performance"] = read_performance(readonly)
        readonly.close()

        approval.require_active_window()
        writable = connect(approval, secret["password"], readonly=False)
        receipt["f05"] = f05_transactional(writable, approval.run_id)
        receipt["f07"] = f07_transactional(writable, approval.run_id)
        writable.close()
        writable = None
        approval.require_active_window()
        receipt["concurrency"] = committed_concurrency(approval, secret["password"], approval.run_id)

        readonly = connect(approval, secret["password"], readonly=True)
        receipt["after"] = fingerprints(readonly)
        if receipt["before"] != receipt["after"]:
            raise Refused("historical table fingerprints changed")
        receipt["cleanup_verified"] = True
        receipt["status"] = "passed"
        receipt["finished_at"] = datetime.now(timezone.utc).isoformat()
        args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps({"status": "passed", "receipt": str(args.receipt),
                          "run_id": approval.run_id}, sort_keys=True))
        return 0
    finally:
        if writable is not None:
            writable.rollback()
            writable.close()
        if not readonly.closed:
            readonly.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        reason = "guard_or_case_failure"
        if isinstance(exc, Refused):
            reason = str(exc)
        if isinstance(exc, psycopg.Error):
            diag = exc.diag
            safe_parts = [f"sqlstate={exc.sqlstate or 'unknown'}"]
            for label, value in (
                ("schema", diag.schema_name),
                ("table", diag.table_name),
                ("column", diag.column_name),
                ("constraint", diag.constraint_name),
            ):
                if value:
                    safe_parts.append(f"{label}={value}")
            reason = ",".join(safe_parts)
        if isinstance(exc, psycopg.OperationalError):
            message = str(exc).lower()
            if "password authentication failed" in message:
                reason = "credential_rejected_by_authorized_child"
            elif "channel binding" in message:
                reason = "channel_binding_unavailable"
            elif "certificate" in message or "ssl" in message:
                reason = "tls_verification_failed"
            elif "timeout" in message:
                reason = "connection_timeout"
            else:
                reason = "database_connection_failed"
        print(f"INTEGRATION REFUSED/FAILED: {type(exc).__name__}:{reason}", file=sys.stderr)
        raise SystemExit(2) from None
