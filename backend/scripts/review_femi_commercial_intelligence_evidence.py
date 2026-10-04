"""Read-only Azure/evidence review for the Femi Commercial Intelligence dry run.

The script deliberately writes only a local review artifact.  It downloads the
referenced Aptem documents, extracts text locally, and records hashes/metadata
without copying learner evidence text into the report.  No database or Azure
write is performed.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

from azure.storage.blob import BlobServiceClient

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402
import repair_msp_evidence_timestamps as extractor  # noqa: E402


DEFAULT_INPUT = Path(__file__).resolve().parents[1] / "reports" / "femi_commercial_intelligence_dryrun.json"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "reports" / "femi_commercial_intelligence_evidence_review.json"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()


def duration_minutes(text: str) -> list[int]:
    """Find explicit hour/minute totals, without treating arbitrary numbers as time."""
    values: list[int] = []
    patterns = (
        r"(?<!\d)(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m(?:in(?:ute)?s?)?(?!\w)",
        r"(?<!\d)(\d+)\s*hours?\s*(?:and\s*)?(\d+)\s*minutes?(?!\w)",
        r"(?<!\d)(\d+(?:\.\d+)?)\s*hours?(?!\w)",
        r"(?<!\d)(\d+)\s*minutes?(?!\w)",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.I):
            if len(match.groups()) == 2:
                hours = float(match.group(1))
                minutes = int(match.group(2))
                values.append(int(round(hours * 60)) + minutes)
            else:
                token = match.group(1)
                if "." in token:
                    values.append(int(round(float(token) * 60)))
                else:
                    values.append(int(token))
    return sorted(set(v for v in values if 0 < v <= 24 * 60))


def date_tokens(text: str) -> list[str]:
    patterns = (
        r"\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+20\d{2}\b",
        r"\b\d{1,2}[/-]\d{1,2}[/-](?:20)?\d{2}\b",
    )
    values: set[str] = set()
    for pattern in patterns:
        values.update(re.findall(pattern, text, flags=re.I))
    return sorted(values)[:40]


def substantive_note(value: Any) -> dict[str, Any]:
    text = str(value or "").strip()
    return {
        "present": bool(text),
        "characters": len(text),
        "sha256": text_hash(text) if text else None,
    }


def safe_label(value: Any) -> tuple[str, dict[str, Any]]:
    text = str(value or "").strip()
    digest = text_hash(text) if text else None
    if len(text) > 180 or "\n" in text or "\r" in text:
        return "[evidence text redacted]", {"characters": len(text), "sha256": digest}
    return text, {"characters": len(text), "sha256": digest}


def read_blob(service: BlobServiceClient, blob: str) -> dict[str, Any]:
    try:
        data = service.get_blob_client(base.CONTAINER, blob).download_blob(timeout=15).readall()
        text = extractor.document_text(blob, service)
        return {
            "status": "READABLE_WITH_TEXT" if text.strip() else "READABLE_EMPTY",
            "bytes": len(data),
            "sha256": sha256(data),
            "text_characters": len(text),
            "text_sha256": text_hash(text) if text else None,
            "duration_minutes_found": duration_minutes(text),
            "date_tokens_found": date_tokens(text),
            "error": None,
        }
    except Exception as exc:  # keep one bad file from hiding the rest
        return {
            "status": "READ_ERROR",
            "bytes": None,
            "sha256": None,
            "text_characters": 0,
            "text_sha256": None,
            "duration_minutes_found": [],
            "date_tokens_found": [],
            "error": type(exc).__name__,
        }


def main() -> int:
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT
    report = json.loads(input_path.read_text(encoding="utf-8"))
    selected_statuses = {"NEW_LEGITIMATE", "BLOCKED", "DURATION_CONFLICT", "AMBIGUOUS", "PARENT_NEEDS_ACTUAL_REPAIR"}
    selected = [row for row in report.get("candidates", []) if row.get("status") in selected_statuses]
    by_evidence: dict[int, dict[str, Any]] = {}
    for row in selected:
        by_evidence.setdefault(int(row["evidence_id"]), row)
    evidence_ids = sorted(by_evidence)
    if not evidence_ids:
        output_path.write_text(json.dumps({"read_only": True, "reviewed": 0}, indent=2), encoding="utf-8")
        return 0

    values = base.env_values()
    connection = values.get("AZURE_STORAGE_CONNECTION_STRING")
    if not connection:
        raise RuntimeError("Azure storage configuration is unavailable; no evidence was read.")
    service = BlobServiceClient.from_connection_string(connection, connection_timeout=10, read_timeout=15)

    # Read only the selected files/reports.  The client is used concurrently to
    # keep the review bounded while preserving the same container/path.
    with base.psycopg.connect(base.database_url(), row_factory=base.dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            rows = cur.execute(
                '''SELECT evidence_id,learner_id,file_blob,report_blob,note_content,
                          spent_time,component_name,evidence_name,
                          coalesce(completed_date_override,completed_date,submission_date,created_date) AS evidence_at
                     FROM fetching_evidence.evidence_items
                    WHERE evidence_id=ANY(%s)''',
                [evidence_ids],
            ).fetchall()
    evidence = {int(row["evidence_id"]): row for row in rows}

    refs: list[tuple[int, str, str]] = []
    for eid, row in evidence.items():
        for kind in ("file", "report"):
            blob = row.get(f"{kind}_blob")
            if blob:
                refs.append((eid, kind, str(blob)))

    blob_results: dict[tuple[int, str], dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(read_blob, service, blob): (eid, kind) for eid, kind, blob in refs}
        for future in as_completed(futures):
            blob_results[futures[future]] = future.result()

    reviewed: list[dict[str, Any]] = []
    for eid in evidence_ids:
        candidate = by_evidence[eid]
        row = evidence.get(eid)
        if row is None:
            reviewed.append({**candidate, "read_status": "DB_ROW_MISSING"})
            continue
        expected = int(row.get("spent_time") or 0)
        files = {
            kind: blob_results.get((eid, kind), {"status": "NO_BLOB"})
            for kind in ("file", "report")
        }
        readable = [value for value in files.values() if value.get("status", "").startswith("READABLE")]
        all_durations = sorted({m for value in readable for m in value.get("duration_minutes_found", [])})
        duration_match = expected in all_durations
        note = substantive_note(row.get("note_content"))
        evidence_label, evidence_label_meta = safe_label(row.get("evidence_name"))
        reviewed.append({
            **candidate,
            "component_name": row.get("component_name"),
            "evidence_name": evidence_label,
            "evidence_name_metadata": evidence_label_meta,
            "evidence_date": str(row.get("evidence_at")) if row.get("evidence_at") else None,
            "spent_minutes": expected,
            "note": note,
            "files": files,
            "content_support": "EXPLICIT_DURATION_MATCH" if duration_match else ("READABLE_NO_EXPLICIT_MATCH" if readable else "NO_READABLE_CONTENT"),
        })

    summary = {
        "read_only": True,
        "database": report.get("database"),
        "reviewed_evidence": len(reviewed),
        "files_checked": len(refs),
        "readable_files": sum(1 for value in blob_results.values() if value.get("status", "").startswith("READABLE")),
        "read_errors": sum(1 for value in blob_results.values() if value.get("status") == "READ_ERROR"),
        "explicit_duration_matches": sum(row.get("content_support") == "EXPLICIT_DURATION_MATCH" for row in reviewed),
        "content_unsupported_or_unreadable": sum(row.get("content_support") != "EXPLICIT_DURATION_MATCH" for row in reviewed),
        "by_candidate_status": {},
        "next_safe_step": "Use this review to finalize duplicate/new/blocked decisions; no database or Azure write was performed.",
    }
    for row in reviewed:
        key = row.get("status", "UNKNOWN")
        summary["by_candidate_status"][key] = summary["by_candidate_status"].get(key, 0) + 1
    output = {"summary": summary, "evidence": reviewed}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
