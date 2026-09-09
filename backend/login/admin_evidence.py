"""Assignment-classification API for the Super Admin Evidence page.

The classification pipeline is owned by the fetching service.  This module
reads its output and stores admin decisions in evaluations.manual_selected. It takes the roster from Aptem,
not from the result table, so an active learner with no eligible assignment is
still visible.  Blob names never leave this module: document endpoints resolve
them from the authoritative evidence row only after the learner/run/evidence
relationship has been proved.
"""
from __future__ import annotations

import ast
import datetime
import io
import json
import mimetypes
import re
import httpx
from datetime import timedelta
from pathlib import PurePosixPath

from django.conf import settings
from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt

from learner_api import evidence_storage

from .models import ROLE_ADMIN
from .permissions import require_role


DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100
TEST_LEARNER_ID = 8539
EVIDENCE_CONTAINER = "fetch-aptem-evidences"
MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
EVALUATIONS = 'fetching_evidence.assignment_classification_evaluations'
EVIDENCE_ITEMS = 'fetching_evidence.evidence_items'
LEARNER_EVIDENCE = 'fetching_evidence.learner_evidence'
RESULT_OPTIONS = ["Accepted", "Referred", "TraineeAccepted", "TraineeReferred"]


def _exclusions_available():
    return _manual_available()


def _exclusion_source():
    if not _exclusions_available():
        return 'SELECT NULL::bigint AS run_id, NULL::bigint AS learner_id, NULL::bigint AS component_id, NULL::bigint AS evidence_id WHERE false'
    return f'SELECT run_id, learner_id, component_id, evidence_id FROM {EVALUATIONS} WHERE manual_selected = false'


def _manual_available():
    return bool(_rows('''SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'fetching_evidence' AND table_name = 'assignment_classification_evaluations'
          AND column_name = 'manual_selected' AND data_type = 'boolean') AS available''')[0]['available'])


def _manual_source():
    # Keep existing read screens usable until the owner installs the table.
    if not _manual_available():
        return 'SELECT NULL::bigint AS run_id, NULL::bigint AS learner_id, NULL::bigint AS component_id, NULL::bigint AS evidence_id, NULL::int AS rank WHERE false'
    return f'''SELECT m.run_id, m.learner_id, m.component_id, m.evidence_id,
            coalesce((SELECT max(r.rank) FROM fetching_evidence.assignment_classification_results r
                WHERE r.run_id = m.run_id AND r.learner_id = m.learner_id), 0)
            + row_number() OVER (PARTITION BY m.run_id, m.learner_id ORDER BY m.id) AS rank
        FROM {EVALUATIONS} m
        WHERE m.manual_selected = true AND NOT EXISTS (
            SELECT 1 FROM fetching_evidence.assignment_classification_results r
            WHERE r.run_id = m.run_id AND r.learner_id = m.learner_id
              AND r.component_id = m.component_id
              AND NOT EXISTS (SELECT 1 FROM ({_exclusion_source()}) x
                  WHERE x.run_id = r.run_id AND x.learner_id = r.learner_id AND x.evidence_id = r.evidence_id)
        )'''


def _error(message, status, code=None):
    payload = {"error": message}
    if code:
        payload["code"] = code
    return JsonResponse(payload, status=status)


def _paging(request):
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.GET.get("pageSize", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        page_size = DEFAULT_PAGE_SIZE
    return page, max(1, min(page_size, MAX_PAGE_SIZE))


def _iso(value):
    return value.isoformat() if value else None


def _json_list(value, depth=0):
    # Legacy pipeline rows sometimes contain JSON/Python list text rather
    # than arrays (including an array with one serialized list inside it).
    if isinstance(value, str) and depth < 3 and len(value) <= 64000:
        candidate = value.strip()
        if candidate.startswith('[') and candidate.endswith(']'):
            for decode in (json.loads, ast.literal_eval):
                try:
                    parsed = decode(candidate)
                except (ValueError, SyntaxError, TypeError, RecursionError):
                    continue
                if isinstance(parsed, list):
                    return _json_list(parsed, depth + 1)
    if isinstance(value, list):
        return [item for entry in value for item in _json_list(entry, depth + 1)] if depth < 4 else [str(entry) for entry in value]
    if value in (None, ""):
        return []
    return [str(value)]


def _unclassified_summary(row):
    if int(row.get("assignment_slots") or 0) == 0:
        return "No assignment components were found in the learner's evidence."
    if int(row.get("accepted_assignment_files") or 0) == 0 and int(row.get("referred_assignment_files") or 0) > 0:
        return "Assignment evidence exists, but it is referred and has not been accepted."
    if int(row.get("assignment_files") or 0) == 0:
        return "Assignment components exist, but no assignment submission file is available."
    return "No eligible accepted assignment was available for classification."


def _audit_alias():
    return "audit" if "audit" in connections.databases else "enrolment"


def _rows(sql, params=None):
    with connections[_audit_alias()].cursor() as cursor:
        cursor.execute(sql, params or [])
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


LATEST_COMPLETED_RUN = """
    SELECT r.*
    FROM fetching_evidence.assignment_classification_runs r
    WHERE r.learner_id = a."ID" AND r.status = 'completed'
    ORDER BY (r.source_fingerprint IS NOT NULL) DESC,
             r.completed_at DESC NULLS LAST,
             r.id DESC
    LIMIT 1
"""


@require_GET
@require_role(ROLE_ADMIN)
def classified_learners(request):
    """All current Aptem-active learners with their latest completed run."""
    page, page_size = _paging(request)
    search = str(request.GET.get("q") or "").strip()
    readiness = str(request.GET.get("portfolioReadiness") or "").strip().lower()
    selection = str(request.GET.get("selection") or "").strip().lower()
    human_verification = str(request.GET.get("humanVerification") or "").strip().lower()

    where = [
        "lower(btrim(coalesce(a.\"Program-Status\", ''))) = 'active'",
        "a.\"ID\" <> %s",
    ]
    params = [TEST_LEARNER_ID]
    if search:
        where.append("(a.\"FullName\" ILIKE %s OR a.\"ID\"::text ILIKE %s)")
        term = f"%{search}%"
        params.extend([term, term])
    programme = str(request.GET.get('programme') or '').strip()
    if programme:
        where.append('''coalesce(nullif(btrim(a."Program Name"), ''),
            nullif(btrim(a."Group"), ''), 'Unknown programme') = %s''')
        params.append(programme)
    for key, expression in {
        'found': 'coalesce(run.assignments_found, 0)',
        'evaluated': 'coalesce(run.unique_assignments_evaluated, 0)',
        'selectedCount': 'coalesce(run.assignments_selected, 0) + coalesce(manual_count.total, 0) - coalesce(excluded_count.total, 0)',
    }.items():
        value = request.GET.get(key, '')
        if value != '':
            try:
                count = int(value)
                if count < 0 or count > 2147483647:
                    raise ValueError
            except (TypeError, ValueError):
                return _error(f'{key} must be a non-negative whole number.', 400)
            where.append(f'({expression}) = %s')
            params.append(count)
    if readiness == "not_classified":
        where.append("run.id IS NULL")
    elif readiness:
        where.append("run.portfolio_readiness = %s")
        params.append(readiness)
    if selection == "recommended":
        where.append("coalesce(run.assignments_selected, 0) + coalesce(manual_count.total, 0) - coalesce(excluded_count.total, 0) > 0")
    elif selection == "none":
        where.append("run.id IS NOT NULL AND coalesce(run.assignments_selected, 0) + coalesce(manual_count.total, 0) - coalesce(excluded_count.total, 0) = 0")
    elif selection == "unclassified":
        where.append("run.id IS NULL")
    if human_verification in {"yes", "true", "1"}:
        where.append(
            "run.id IS NOT NULL AND jsonb_typeof(run.human_checks_required) = 'array' "
            "AND jsonb_array_length(run.human_checks_required) > 0"
        )

    try:
        manual_source = _manual_source()
        programmes = _programme_options()
        exclusion_source = _exclusion_source()
    except DatabaseError:
        return _error("Could not load assignment classifications.", 503)
    sql = f"""
        WITH manual AS ({manual_source}), excluded AS ({exclusion_source})
        SELECT a."ID" AS learner_id,
               coalesce(nullif(btrim(a."FullName"), ''), 'Learner ' || a."ID"::text) AS full_name,
               coalesce(nullif(btrim(a."Program Name"), ''),
                        nullif(btrim(a."Group"), ''), 'Unknown programme') AS programme,
               run.id AS run_id, run.assignments_found,
               run.unique_assignments_evaluated,
               coalesce(run.assignments_selected, 0) + coalesce(manual_count.total, 0) - coalesce(excluded_count.total, 0) AS assignments_selected,
               run.portfolio_readiness, run.selection_status,
               run.portfolio_summary, run.human_checks_required,
               run.completed_at,
               source.assignment_slots, source.assignment_files,
               source.accepted_assignment_files, source.referred_assignment_files,
               count(*) OVER () AS total_count
        FROM "LMS"."Aptem_users" a
        LEFT JOIN LATERAL ({LATEST_COMPLETED_RUN}) run ON true
        LEFT JOIN (SELECT run_id, learner_id, count(*) AS total FROM manual GROUP BY run_id, learner_id)
          manual_count ON manual_count.run_id = run.id AND manual_count.learner_id = a."ID"
        LEFT JOIN (SELECT x.run_id, x.learner_id, count(*) AS total FROM excluded x
            JOIN fetching_evidence.assignment_classification_results r ON r.run_id = x.run_id
              AND r.learner_id = x.learner_id AND r.evidence_id = x.evidence_id
            GROUP BY x.run_id, x.learner_id) excluded_count
          ON excluded_count.run_id = run.id AND excluded_count.learner_id = a."ID"
        LEFT JOIN LATERAL (
            SELECT count(DISTINCT e.component_id) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                   ) AS assignment_slots,
                   count(*) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                         AND e.file_blob IS NOT NULL
                   ) AS assignment_files,
                   count(*) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                         AND e.file_blob IS NOT NULL
                         AND lower(coalesce(e.evidence_status, '')) = 'accepted'
                   ) AS accepted_assignment_files,
                   count(*) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                         AND e.file_blob IS NOT NULL
                         AND lower(coalesce(e.evidence_status, '')) = 'referred'
                   ) AS referred_assignment_files
            FROM fetching_evidence.evidence_items e
            WHERE e.learner_id = a."ID"
        ) source ON run.id IS NULL
        WHERE {' AND '.join(where)}
        ORDER BY lower(coalesce(a."FullName", '')), a."ID"
        LIMIT %s OFFSET %s
    """
    params.extend([page_size, (page - 1) * page_size])
    try:
        rows = _rows(sql, params)
    except DatabaseError:
        return _error("Could not load assignment classifications.", 503)

    total = int(rows[0]["total_count"]) if rows else 0
    results = []
    for row in rows:
        checks = _json_list(row.get("human_checks_required"))
        has_run = row.get("run_id") is not None
        results.append({
            "learnerId": int(row["learner_id"]),
            "fullName": row["full_name"],
            "programme": row["programme"],
            "runId": int(row["run_id"]) if has_run else None,
            "assignmentsFound": int(row.get("assignments_found") or 0),
            "uniqueAssignmentsEvaluated": int(row.get("unique_assignments_evaluated") or 0),
            "assignmentsSelected": int(row.get("assignments_selected") or 0),
            "portfolioReadiness": row.get("portfolio_readiness") if has_run else "not_classified",
            "selectionStatus": row.get("selection_status") if has_run else "not_classified",
            "portfolioSummary": row.get("portfolio_summary") or (_unclassified_summary(row) if not has_run else ""),
            "humanChecksRequired": len(checks),
            "completedAt": _iso(row.get("completed_at")),
            "hasCompletedRun": has_run,
        })
    return JsonResponse({
        "count": total,
        "page": page,
        "pageSize": page_size,
        "results": results,
        "programmes": programmes,
    })


def _programme_options():
    rows = _rows('''SELECT DISTINCT coalesce(nullif(btrim(a."Program Name"), ''),
        nullif(btrim(a."Group"), ''), 'Unknown programme') AS programme
        FROM "LMS"."Aptem_users" a
        WHERE lower(btrim(coalesce(a."Program-Status", ''))) = 'active'
          AND a."ID" <> %s
        ORDER BY programme''', [TEST_LEARNER_ID])
    return [row['programme'] for row in rows]


def _learner_and_run(learner_id):
    rows = _rows(
        f"""
        SELECT a."ID" AS learner_id,
               coalesce(nullif(btrim(a."FullName"), ''), 'Learner ' || a."ID"::text) AS full_name,
               coalesce(nullif(btrim(a."Program Name"), ''),
                        nullif(btrim(a."Group"), ''), 'Unknown programme') AS programme,
               run.id AS run_id, run.assignments_selected,
               run.portfolio_readiness, run.selection_status,
               run.portfolio_summary, run.completed_at
               , source.assignment_slots, source.assignment_files,
               source.accepted_assignment_files, source.referred_assignment_files
        FROM "LMS"."Aptem_users" a
        LEFT JOIN LATERAL ({LATEST_COMPLETED_RUN}) run ON true
        LEFT JOIN LATERAL (
            SELECT count(DISTINCT e.component_id) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                   ) AS assignment_slots,
                   count(*) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                         AND e.file_blob IS NOT NULL
                   ) AS assignment_files,
                   count(*) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                         AND e.file_blob IS NOT NULL
                         AND lower(coalesce(e.evidence_status, '')) = 'accepted'
                   ) AS accepted_assignment_files,
                   count(*) FILTER (
                       WHERE lower(coalesce(e.component_name, '')) LIKE '%%assignment%%'
                         AND e.file_blob IS NOT NULL
                         AND lower(coalesce(e.evidence_status, '')) = 'referred'
                   ) AS referred_assignment_files
            FROM fetching_evidence.evidence_items e
            WHERE e.learner_id = a."ID"
        ) source ON run.id IS NULL
        WHERE a."ID" = %s
          AND a."ID" <> %s
          AND lower(btrim(coalesce(a."Program-Status", ''))) = 'active'
        LIMIT 1
        """,
        [learner_id, TEST_LEARNER_ID],
    )
    return rows[0] if rows else None


SORTS = {
    "date": "v.assignment_date DESC NULLS LAST, v.id DESC",
    "score": "v.final_score DESC, v.assignment_date DESC NULLS LAST, v.id DESC",
    "component": "lower(v.component_name), v.assignment_date DESC NULLS LAST, v.id DESC",
    "selected": "((result.evidence_id IS NOT NULL AND excluded.evidence_id IS NULL) OR manual.evidence_id IS NOT NULL) DESC, coalesce(result.rank, manual.rank) ASC NULLS LAST, v.assignment_date DESC NULLS LAST, v.id DESC",
}


def _assignment_payload(row, learner_id):
    evaluation = row.get("evaluation") if isinstance(row.get("evaluation"), dict) else {}
    selected = bool(row.get("selected"))
    selection_reasons = row.get("selection_reasons")
    if not isinstance(selection_reasons, list):
        selection_reasons = _json_list(row.get("selection_reason"))

    def chosen(key, default=None):
        admin_key = f"admin_{key}"
        if admin_key in evaluation:
            return evaluation[admin_key]
        value = row.get(key)
        return evaluation.get(key, default) if value is None else value

    evidence_id = int(row["evidence_id"])
    base = f"/login_api/admin/evidence/classified-learners/{learner_id}/evidence/{evidence_id}"
    return {
        "evidenceId": evidence_id,
        "componentId": int(row["component_id"]),
        "evidenceName": row.get("evidence_name") or f"Evidence {evidence_id}",
        "componentName": row.get("component_name") or "",
        "assignmentDate": _iso(row.get("assignment_date")),
        "rank": int(row["rank"]) if selected and row.get("rank") is not None else None,
        "finalScore": float(row.get("final_score") or 0),
        "classification": row.get("classification") or "",
        "auditReadiness": row.get("audit_readiness") or "",
        "selected": selected,
        "manuallySelected": bool(row.get("manually_selected")),
        "selectionReasons": selection_reasons,
        "reasonNotSelected": 'Unselected by an administrator.' if row.get('manually_excluded') else row.get("reason_not_selected") or row.get("exclusion_reason") or "",
        "verifiedKsbCodes": _json_list(chosen("verified_ksb_codes", [])),
        "knowledgeFound": bool(chosen("knowledge_found", False)),
        "skillsFound": bool(chosen("skills_found", False)),
        "behavioursFound": bool(chosen("behaviours_found", False)),
        "keyStrengths": _json_list(chosen("key_strengths", [])),
        "weaknesses": _json_list(chosen("weaknesses", [])),
        "risks": _json_list(chosen("risks", [])),
        "workplaceEvidenceSummary": chosen("workplace_evidence_summary", "") or "",
        "feedbackQualitySummary": chosen("feedback_quality_summary", "") or "",
        "humanVerificationRequired": bool(chosen("human_verification_required", False)),
        "humanVerificationReason": chosen("human_verification_reason", "") or "",
        "hasFile": bool(row.get("has_file")),
        "hasReport": bool(row.get("has_report")),
        "filePreviewPath": f"{base}/open/?part=file" if row.get("has_file") else None,
        "reportPreviewPath": f"{base}/open/?part=report" if row.get("has_report") else None,
    }


@require_GET
@require_role(ROLE_ADMIN)
def learner_assignments(request, learner_id):
    """Recommended or all assignments for the learner's latest completed run."""
    view = str(request.GET.get("view") or "recommended").strip().lower()
    if view not in {"recommended", "all"}:
        return _error("view must be 'recommended' or 'all'.", 400)
    sort = str(request.GET.get("sort") or ("date" if view == "all" else "rank")).strip().lower()
    if view == "all" and sort not in SORTS:
        return _error("sort must be date, score, component or selected.", 400)
    page, page_size = _paging(request)

    try:
        learner = _learner_and_run(learner_id)
    except DatabaseError:
        return _error("Could not load this learner.", 503)
    if not learner:
        return _error("Active learner not found.", 404)

    run_id = learner.get("run_id")
    if run_id is None:
        return JsonResponse({
            "learner": {
                "learnerId": int(learner["learner_id"]),
                "fullName": learner["full_name"],
                "programme": learner["programme"],
                "runId": None,
                "portfolioReadiness": "not_classified",
                "selectionStatus": "not_classified",
                "portfolioSummary": _unclassified_summary(learner),
                "completedAt": None,
            },
            "view": view, "sort": sort, "count": 0,
            "page": page, "pageSize": page_size, "results": [],
        })

    try:
        manual_source = _manual_source()
        exclusion_source = _exclusion_source()
    except DatabaseError:
        return _error("Could not load classified assignments.", 503)
    selected_only = 'AND ((result.evidence_id IS NOT NULL AND excluded.evidence_id IS NULL) OR manual.evidence_id IS NOT NULL)' if view == 'recommended' else ''
    order = 'coalesce(result.rank, manual.rank) ASC, v.id ASC' if view == 'recommended' else SORTS[sort]
    sql = f"""
            WITH manual_selections AS ({manual_source}), exclusions AS ({exclusion_source})
            SELECT v.evidence_id, v.component_id, v.evidence_name, v.component_name,
                   v.assignment_date, coalesce(result.rank, manual.rank) AS rank,
                   coalesce(result.final_score, v.final_score) AS final_score,
                   coalesce(result.classification, v.classification) AS classification,
                   coalesce(result.audit_readiness, v.audit_readiness) AS audit_readiness,
                   ((result.evidence_id IS NOT NULL AND excluded.evidence_id IS NULL) OR manual.evidence_id IS NOT NULL) AS selected,
                   (excluded.evidence_id IS NOT NULL AND manual.evidence_id IS NULL) AS manually_excluded,
                   (manual.evidence_id IS NOT NULL) AS manually_selected, result.selection_reasons,
                   v.selection_reason, v.reason_not_selected, v.exclusion_reason,
                   result.verified_ksb_codes, result.knowledge_found, result.skills_found,
                   result.behaviours_found, result.key_strengths, result.weaknesses,
                   result.risks, result.workplace_evidence_summary,
                   result.feedback_quality_summary, result.human_verification_required,
                   result.human_verification_reason, v.evaluation,
                   (e.file_blob IS NOT NULL) AS has_file,
                   (e.report_blob IS NOT NULL) AS has_report,
                   count(*) OVER () AS total_count
            FROM fetching_evidence.assignment_classification_evaluations v
            LEFT JOIN fetching_evidence.assignment_classification_results result
              ON result.run_id = v.run_id AND result.learner_id = v.learner_id
             AND result.component_id = v.component_id AND result.evidence_id = v.evidence_id
            LEFT JOIN exclusions excluded ON excluded.run_id = v.run_id AND excluded.learner_id = v.learner_id
              AND excluded.component_id = v.component_id AND excluded.evidence_id = v.evidence_id
            LEFT JOIN manual_selections manual
              ON manual.run_id = v.run_id AND manual.learner_id = v.learner_id
             AND manual.component_id = v.component_id AND manual.evidence_id = v.evidence_id
            JOIN fetching_evidence.evidence_items e
              ON e.evidence_id = v.evidence_id AND e.learner_id = v.learner_id
            WHERE v.run_id = %s AND v.learner_id = %s
            {selected_only}
            ORDER BY {order}
            LIMIT %s OFFSET %s
        """
    try:
        rows = _rows(sql, [run_id, learner_id, page_size, (page - 1) * page_size])
    except DatabaseError:
        return _error("Could not load classified assignments.", 503)

    return JsonResponse({
        "learner": {
            "learnerId": int(learner["learner_id"]),
            "fullName": learner["full_name"],
            "programme": learner["programme"],
            "runId": int(run_id),
            "portfolioReadiness": learner.get("portfolio_readiness") or "",
            "selectionStatus": learner.get("selection_status") or "",
            "portfolioSummary": learner.get("portfolio_summary") or "",
            "completedAt": _iso(learner.get("completed_at")),
        },
        "view": view,
        "sort": sort,
        "count": int(rows[0]["total_count"]) if rows else 0,
        "page": page,
        "pageSize": page_size,
        "results": [_assignment_payload(row, learner_id) for row in rows],
    })


@csrf_exempt
@require_POST
@require_role(ROLE_ADMIN)
def select_assignment(request, learner_id, evidence_id):
    """Select/unselect assignments without rewriting pipeline output."""
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        return _error('Missing X-Requested-With header.', 403)
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return _error('Invalid JSON body.', 400)
    if not isinstance(payload, dict):
        return _error('Request body must be a JSON object.', 400)
    run_id = payload.get('runId')
    component_id = payload.get('componentId')
    selected = payload.get('selected')
    if type(run_id) is not int or type(component_id) is not int or type(selected) is not bool:
        return _error('runId, componentId and selected are required.', 400)

    try:
        if not _manual_available():
            return _error('Manual selection is not configured yet. Please contact the administrator.', 503)
        with transaction.atomic(using=_audit_alias()):
            # Serialize all selections for this run, including capacity checks.
            locked = _rows('''SELECT id FROM fetching_evidence.assignment_classification_runs
                WHERE id = %s AND learner_id = %s FOR UPDATE''', [run_id, learner_id])
            learner = _learner_and_run(learner_id)
            if not learner:
                return _error('Active learner not found.', 404)
            if not locked or learner.get('run_id') != run_id:
                return _error('Classification changed. Refresh the page and try again.', 409)
            evidence = _rows('''SELECT v.evidence_id FROM fetching_evidence.assignment_classification_evaluations v
                JOIN fetching_evidence.evidence_items e
                  ON e.evidence_id = v.evidence_id AND e.learner_id = v.learner_id
                 AND e.component_id = v.component_id
                WHERE v.run_id = %s AND v.learner_id = %s
                  AND v.component_id = %s AND v.evidence_id = %s''',
                [run_id, learner_id, component_id, evidence_id])
            if not evidence:
                return _error('Assignment not found for this learner and classification.', 404)
            exclusions = _exclusion_source()
            manual_source = _manual_source()
            all_portfolio = _rows(f'''SELECT r.component_id, r.evidence_id, r.rank, false AS manual,
                    (x.evidence_id IS NOT NULL) AS excluded
                FROM fetching_evidence.assignment_classification_results r
                LEFT JOIN ({exclusions}) x ON x.run_id = r.run_id AND x.learner_id = r.learner_id
                  AND x.evidence_id = r.evidence_id
                WHERE r.run_id = %s AND r.learner_id = %s
                UNION ALL
                SELECT m.component_id, m.evidence_id, m.rank, true AS manual, false AS excluded FROM ({manual_source}) m
                WHERE m.run_id = %s AND m.learner_id = %s
                ''', [run_id, learner_id, run_id, learner_id])
            portfolio = [row for row in all_portfolio if not row.get('excluded')]
            existing = next((row for row in portfolio if row['component_id'] == component_id), None)
            if selected:
                if existing:
                    if existing['evidence_id'] != evidence_id:
                        return _error('Another assignment for this component is already selected.', 409)
                if not existing and len(portfolio) >= 10:
                    return _error('This portfolio already has 10 selected assignments.', 409)
            _rows(f'''UPDATE {EVALUATIONS} SET manual_selected = %s
                WHERE run_id = %s AND learner_id = %s AND component_id = %s AND evidence_id = %s
                RETURNING evidence_id''', [selected, run_id, learner_id, component_id, evidence_id])
        return JsonResponse({'selected': selected})
    except DatabaseError:
        return _error('Could not save the selection. Please try again.', 503)


@csrf_exempt
@require_POST
@require_role(ROLE_ADMIN)
def update_ksb_codes(request, learner_id, evidence_id):
    """Store the administrator's verified KSB-code override."""
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        return _error('Missing X-Requested-With header.', 403)
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return _error('Invalid JSON body.', 400)
    if not isinstance(payload, dict):
        return _error('Request body must be a JSON object.', 400)

    run_id = payload.get('runId')
    component_id = payload.get('componentId')
    ksb_codes = payload.get('verifiedKsbCodes')
    if type(run_id) is not int or type(component_id) is not int:
        return _error('runId and componentId are required.', 400)
    if not isinstance(ksb_codes, list) or len(ksb_codes) > 200 or not all(isinstance(code, str) for code in ksb_codes):
        return _error('verifiedKsbCodes must be a list of up to 200 codes.', 400)
    normalized_codes = []
    for code in ksb_codes:
        normalized = code.strip().upper()
        if not re.fullmatch(r'[KSB]\d+(?:\.\d+)*', normalized):
            return _error(f'Invalid KSB code: {code}', 400)
        if normalized not in normalized_codes:
            normalized_codes.append(normalized)

    overrides = json.dumps({'admin_verified_ksb_codes': normalized_codes})
    try:
        learner = _learner_and_run(learner_id)
        if not learner:
            return _error('Active learner not found.', 404)
        if learner.get('run_id') != run_id:
            return _error('Classification changed. Refresh the page and try again.', 409)
        updated = _rows(f'''UPDATE {EVALUATIONS}
            SET evaluation = coalesce(evaluation, '{{}}'::jsonb) || %s::jsonb
            WHERE run_id = %s AND learner_id = %s AND component_id = %s AND evidence_id = %s
            RETURNING evidence_id''', [overrides, run_id, learner_id, component_id, evidence_id])
        if not updated:
            return _error('Assignment not found for this learner and classification.', 404)
    except DatabaseError:
        return _error('Could not save the KSB codes. Please try again.', 503)

    return JsonResponse({'verifiedKsbCodes': normalized_codes})


def _report_form_row(learner_id, evidence_id):
    rows = _rows(
        f"""
        SELECT run.id AS run_id, e.evidence_id, e.learner_id, e.full_name,
               e.program_name, e.evidence_name, e.evidence_status, e.spent_time,
               e.completed_date, e.report_blob,
               coalesce(nullif(e.component_name, ''), nullif(v.component_name, '')) AS activity_name
        FROM "LMS"."Aptem_users" a
        JOIN LATERAL ({LATEST_COMPLETED_RUN}) run ON true
        JOIN {EVALUATIONS} v
          ON v.run_id = run.id AND v.learner_id = run.learner_id
        JOIN {EVIDENCE_ITEMS} e
          ON e.evidence_id = v.evidence_id AND e.learner_id = v.learner_id
        WHERE a."ID" = %s AND a."ID" <> %s
          AND lower(btrim(coalesce(a."Program-Status", ''))) = 'active'
          AND e.evidence_id = %s
        LIMIT 1
        """,
        [learner_id, TEST_LEARNER_ID, evidence_id],
    )
    return rows[0] if rows else None


@require_GET
@require_role(ROLE_ADMIN)
def report_form(request, learner_id, evidence_id):
    """Prefill the Aptem-style assessment-report form for one assignment."""
    try:
        row = _report_form_row(learner_id, evidence_id)
    except DatabaseError:
        return _error('Could not load the assessment report form.', 503)
    if not row:
        return _error('Assignment not found for this learner.', 404)

    options = list(RESULT_OPTIONS)
    current_result = str(row.get('evidence_status') or '').strip()
    if current_result and current_result not in options:
        options.insert(0, current_result)
    return JsonResponse({
        'learner_name': row.get('full_name') or '',
        'activity_name': row.get('activity_name') or '',
        'evidence_name': row.get('evidence_name') or '',
        'time_spent': row.get('spent_time') or 0,
        'result': current_result or 'Accepted',
        'assessor': '',
        'date': timezone.localdate().strftime('%d/%m/%Y'),
        'result_options': options,
        'has_report': bool(row.get('report_blob')),
    })


def _safe_blob_segment(value, default='_', max_length=150):
    value = str(value or '').strip().replace('\r', ' ').replace('\n', ' ')
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', value)
    value = re.sub(r'\s+', ' ', value).strip(' .') or default
    return value[:max_length].strip(' .')


def _updated_manifest(manifest, evidence_id, report_blob):
    if not isinstance(manifest, dict):
        return manifest
    items = manifest.get('items')
    if not isinstance(items, list):
        return manifest
    filename = PurePosixPath(report_blob).name
    previous_status = None
    matched = None
    for item in items:
        if isinstance(item, dict) and str(item.get('evidence_id')) == str(evidence_id):
            matched = item
            report = item.get('report') if isinstance(item.get('report'), dict) else {}
            previous_status = report.get('status')
            item['report'] = {'blob': report_blob, 'status': 'present', 'filename': filename}
            feedback = item.get('feedback')
            if isinstance(feedback, dict):
                feedback['report_blob'] = report_blob
                feedback['report_filename'] = filename
            break
    if matched is None:
        return manifest
    counts = manifest.get('counts')
    if isinstance(counts, dict) and previous_status == 'missing':
        counts['reports_missing'] = max(0, int(counts.get('reports_missing') or 0) - 1)
        counts['reports_present'] = int(counts.get('reports_present') or 0) + 1
    missing_ids = manifest.get('missing_ids')
    submission = matched.get('submission') if isinstance(matched.get('submission'), dict) else {}
    if isinstance(missing_ids, list) and submission.get('status') not in {'missing', 'failed'}:
        manifest['missing_ids'] = [item for item in missing_ids if str(item) != str(evidence_id)]
    return manifest


def _persist_report_source(learner_id, evidence_id, report_blob):
    rows = _rows(
        f'SELECT evidence, azure_manifest FROM {LEARNER_EVIDENCE} '
        'WHERE learner_id=%s FOR UPDATE',
        [learner_id],
    )
    if not rows:
        return
    evidence = rows[0].get('evidence')
    if isinstance(evidence, list):
        for item in evidence:
            if isinstance(item, dict) and str(item.get('id')) == str(evidence_id):
                item['report_blob'] = report_blob
                break
    manifest = _updated_manifest(rows[0].get('azure_manifest'), evidence_id, report_blob)
    _rows(
        f'''UPDATE {LEARNER_EVIDENCE}
            SET evidence=%s::jsonb, azure_manifest=%s::json
            WHERE learner_id=%s RETURNING learner_id''',
        [json.dumps(evidence or []), json.dumps(manifest) if manifest is not None else None, learner_id],
    )


def _report_text(value, field, max_length):
    if value is None:
        return ''
    if not isinstance(value, (str, int, float)):
        raise ValueError(f'{field} must be text.')
    text = str(value).strip()
    if len(text) > max_length:
        raise ValueError(f'{field} is too long.')
    return text


def _start_evidence_reanalysis(evidence_id):
    """Ask the existing fetch-evidence worker to queue an immediate fresh audit."""
    base_url = str(getattr(settings, 'EVIDENCE_AUDIT_SERVICE_URL', '') or '').rstrip('/')
    if not base_url:
        raise RuntimeError('The evidence audit service is not configured.')
    try:
        response = httpx.post(
            f'{base_url}/api/evidence/{evidence_id}/reanalyze',
            json={}, timeout=20.0,
        )
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError('Could not reach the evidence audit service.') from exc
    if response.status_code >= 400 or not payload.get('queued'):
        raise RuntimeError(str(payload.get('error') or 'The evidence audit could not be queued.'))
    return payload


@csrf_exempt
@require_POST
@require_role(ROLE_ADMIN)
def save_report_form(request, learner_id, evidence_id):
    """Build, store and link a real Aptem-style assessment-report PDF."""
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        return _error('Missing X-Requested-With header.', 403)
    try:
        payload = json.loads(request.body or b'{}')
    except (ValueError, TypeError, UnicodeDecodeError):
        return _error('Invalid form data.', 400)
    if not isinstance(payload, dict):
        return _error('Request body must be a JSON object.', 400)
    reanalyze = payload.get('reanalyze')
    if type(reanalyze) is not bool:
        return _error('reanalyze must be true or false.', 400)
    try:
        row = _report_form_row(learner_id, evidence_id)
    except DatabaseError:
        return _error('Could not load this assignment.', 503)
    if not row:
        return _error('Assignment not found for this learner.', 404)

    try:
        minutes = int(payload.get('time_spent') or 0)
        if minutes < 0 or minutes > 10_000_000:
            raise ValueError('Time spent must be a positive number of minutes.')
        result = _report_text(payload.get('result'), 'Assessment result', 200)
        allowed_results = set(RESULT_OPTIONS)
        if row.get('evidence_status'):
            allowed_results.add(str(row['evidence_status']))
        if result not in allowed_results:
            raise ValueError('Choose a valid assessment result.')
        report_data = {
            'learner_name': _report_text(payload.get('learner_name') or row.get('full_name'), 'Learner name', 1000),
            'activity_name': _report_text(payload.get('activity_name'), 'Activity name', 2000),
            'evidence_name': _report_text(payload.get('evidence_name'), 'Evidence name', 2000),
            'time_spent': minutes,
            'result': result,
            'assessor': _report_text(payload.get('assessor'), 'Assessed by', 1000),
            'date': _report_text(payload.get('date'), 'Assessment date', 20),
            'criteria': _report_text(payload.get('criteria'), 'Criteria', 50_000),
            'comments': _report_text(payload.get('comments'), 'Comments', 50_000),
            'evidence_date': row.get('completed_date'),
        }
    except (TypeError, ValueError) as exc:
        return _error(str(exc), 400)
    try:
        datetime.datetime.strptime(report_data['date'], '%d/%m/%Y')
    except ValueError:
        return _error('Assessment date must use DD/MM/YYYY.', 400)

    try:
        from .report_pdf import build_assessment_report_pdf
        pdf = build_assessment_report_pdf(report_data)
    except Exception:
        return _error('Could not build the report PDF.', 500)
    if not pdf.startswith(b'%PDF'):
        return _error('Could not build a valid report PDF.', 500)
    if not evidence_storage.azure_configured():
        return _error('The document store is not configured.', 503)

    folder = (
        f"{_safe_blob_segment(row.get('program_name'))}/"
        f"{_safe_blob_segment(row.get('full_name'))}-{row['learner_id']}"
    )
    report_blob = f'{folder}/{evidence_id}-AssessmentReport-form.pdf'
    try:
        evidence_storage.upload_blob(
            io.BytesIO(pdf), EVIDENCE_CONTAINER, report_blob,
            'application/pdf', overwrite=True,
        )
    except Exception:
        return _error('Could not store the assessment report.', 503)

    try:
        with transaction.atomic(using=_audit_alias()):
            updated = _rows(
                f'''UPDATE {EVIDENCE_ITEMS} SET report_blob=%s, updated_at=now()
                    WHERE evidence_id=%s AND learner_id=%s RETURNING evidence_id''',
                [report_blob, evidence_id, learner_id],
            )
            if not updated:
                raise DatabaseError('Evidence changed while the report was being built.')
            _persist_report_source(learner_id, evidence_id, report_blob)
    except DatabaseError:
        return _error('The PDF was built but its evidence record could not be updated.', 503)

    reanalysis = None
    if reanalyze:
        try:
            reanalysis = _start_evidence_reanalysis(evidence_id)
        except RuntimeError:
            return _error(
                'The report was saved, but the new audit could not be started. Your previous analysis was preserved.',
                503,
            )

    return JsonResponse({
        'report_blob': report_blob,
        'analysis_required': False,
        'analysis_preserved': not reanalyze,
        'reanalyze_queued': bool(reanalysis),
        'job_id': reanalysis.get('job_id') if reanalysis else None,
    })


def _authorised_document(learner_id, evidence_id):
    """Authoritative blob row, reachable only through the latest valid run."""
    rows = _rows(
        f"""
        SELECT e.evidence_id, e.evidence_name, e.file_blob, e.report_blob
        FROM "LMS"."Aptem_users" a
        JOIN LATERAL ({LATEST_COMPLETED_RUN}) run ON true
        JOIN fetching_evidence.assignment_classification_evaluations v
          ON v.run_id = run.id AND v.learner_id = run.learner_id
        JOIN fetching_evidence.evidence_items e
          ON e.evidence_id = v.evidence_id AND e.learner_id = v.learner_id
        WHERE a."ID" = %s AND a."ID" <> %s
          AND lower(btrim(coalesce(a."Program-Status", ''))) = 'active'
          AND e.evidence_id = %s
        LIMIT 1
        """,
        [learner_id, TEST_LEARNER_ID, evidence_id],
    )
    return rows[0] if rows else None


def _document_details(request, learner_id, evidence_id):
    part = str(request.GET.get("part") or "file").strip().lower()
    if part not in {"file", "report"}:
        return None, None, _error("part must be 'file' or 'report'.", 400)
    try:
        row = _authorised_document(learner_id, evidence_id)
    except DatabaseError:
        return None, None, _error("Could not authorise this document.", 503)
    if not row:
        # 404 avoids confirming that an evidence id belongs to somebody else.
        return None, None, _error("Document not found for this learner.", 404)
    blob = row.get("file_blob") if part == "file" else row.get("report_blob")
    if not blob:
        return None, None, _error(f"This assignment has no {part}.", 404)
    return row, str(blob), None


def _document_name(row, blob, part):
    blob_name = PurePosixPath(str(blob).replace("\\", "/")).name
    if part == "report":
        suffix = PurePosixPath(blob_name).suffix
        stem = PurePosixPath(str(row.get("evidence_name") or "Assignment")).stem[:180]
        return f"{stem} - Assessment report{suffix}"
    return str(row.get("evidence_name") or blob_name or f"Evidence {row['evidence_id']}")


@require_GET
@require_role(ROLE_ADMIN)
def open_evidence_document(request, learner_id, evidence_id):
    """Create short-lived, read-only preview and download URLs after auth."""
    row, blob, error = _document_details(request, learner_id, evidence_id)
    if error:
        return error
    if not evidence_storage.azure_configured():
        return _error("The document store is not configured.", 503)
    part = str(request.GET.get("part") or "file").strip().lower()
    name = _document_name(row, blob, part)
    try:
        preview_url = evidence_storage.get_read_sas(EVIDENCE_CONTAINER, blob)
        download_url = evidence_storage.get_download_sas(EVIDENCE_CONTAINER, blob, filename=name)
    except Exception:
        # Never include the exception: Azure errors can contain the signed URL.
        return _error("The document store is not reachable.", 503)
    expires_at = timezone.now() + timedelta(minutes=settings.AZURE_SAS_TTL_MINUTES)
    content_type = mimetypes.guess_type(PurePosixPath(str(blob)).name)[0]
    return JsonResponse({
        "id": int(evidence_id),
        "name": name,
        "contentType": content_type,
        "url": preview_url,
        "downloadUrl": download_url,
        "expiresAt": expires_at.isoformat(),
        "textPreviewPath": (
            f"/login_api/admin/evidence/classified-learners/{learner_id}/evidence/"
            f"{evidence_id}/text/?part={part}"
            if str(blob).split("?", 1)[0].lower().endswith(".txt") else None
        ),
    })


@require_GET
@require_role(ROLE_ADMIN)
def evidence_text_preview(request, learner_id, evidence_id):
    """Safely return a bounded TXT document as text, never as HTML."""
    row, blob, error = _document_details(request, learner_id, evidence_id)
    if error:
        return error
    if not str(blob).split("?", 1)[0].lower().endswith(".txt"):
        return _error("Only TXT documents can use the text preview.", 415)
    try:
        content = evidence_storage.download_blob_bytes(
            EVIDENCE_CONTAINER, blob, max_bytes=MAX_TEXT_PREVIEW_BYTES,
        )
    except ValueError:
        return _error("This text document is too large to preview.", 413)
    except Exception:
        return _error("The document store is not reachable.", 503)
    return JsonResponse({"id": int(evidence_id), "text": content.decode("utf-8", errors="replace")})
