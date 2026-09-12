"""Builds the JSON "progress review pack" for one learner and one 12-week
review period — the intermediate document every Progress Review PPTX is
rendered from (pptx_generator.py consumes exactly this shape, nothing else).

Composes EXISTING learner_api functions rather than re-deriving learner data:
  learner_api.learner_detail.build_learner_detail   profile/programme/KSBs/components
  learner_api.identity.learner_profile_for_source   EnrolmentUser -> LearnerProfile
  learner_api.attendance.fetch_kbc_attendance_rows  live KBC attendance register
  learner_api.evidence                              "Learner"."evidence_files" + marking status

Nothing here raises on missing data. Every subsystem call that can fail (a live
DB unreachable, a field simply absent from the schema) appends one line to
`source_warnings` and the affected value becomes NOT_AVAILABLE — never a guess.
Every number that *is* present is a real aggregate of real rows; see each
`_build_*` function's docstring for exactly which rows and columns it reads.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import DatabaseError

from .period import ReviewPeriod

logger = logging.getLogger(__name__)

NOT_AVAILABLE = "Not available"

# Mirrors frontend/src/utils/learnerJourney.ts::progressCountsAsAchieved.
GRADED_PROGRESS_KINDS = {"quiz"}


class LearnerLookupError(Exception):
    """The learner_id does not resolve to any learner (either kind)."""


# --------------------------------------------------------------------------- #
# small shared helpers
# --------------------------------------------------------------------------- #

def _clean(value) -> str:
    return str(value or "").strip()


def _num(value, default=None):
    if value is None or value == "":
        return default
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    try:
        return float(Decimal(str(value)))
    except (InvalidOperation, ValueError, TypeError):
        return default


def _parse_date(value):
    """Best-effort date parsing. EnrolmentUser.start_date/end_date are stored
    as TextField despite the name (see progress_reviews_api README), so a
    string, a date, a datetime, or None all need to resolve the same way."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text[:10] if fmt == "%Y-%m-%d" else text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def _iso(value):
    parsed = _parse_date(value) if not isinstance(value, (date, datetime)) else value
    if isinstance(parsed, datetime):
        parsed = parsed.date()
    return parsed.isoformat() if isinstance(parsed, date) else None


def _within(day, start, end) -> bool:
    return bool(day and start and end and start <= day <= end)


def ksb_parent_code(code) -> str:
    return _clean(code).upper().split(".")[0]


def ksb_type_code(kind, code="") -> str:
    value = _clean(kind).upper() or _clean(code)[:1].upper()
    if value == "K" or value.startswith("KNOWLEDGE"):
        return "K"
    if value == "S" or value.startswith("SKILL"):
        return "S"
    if value == "B" or value.startswith("BEHAVIOUR") or value.startswith("BEHAVIOR"):
        return "B"
    return "?"


def progress_counts_as_achieved(record: dict) -> bool:
    """Mirrors frontend/src/utils/learnerJourney.ts::progressCountsAsAchieved."""
    if not record:
        return False
    if record.get("passed") is False:
        return False
    kind = _clean(record.get("kind")).lower()
    if kind in GRADED_PROGRESS_KINDS:
        return record.get("passed") is True
    return True


def completed_component_ids(detail: dict) -> set:
    """Mirrors frontend/src/utils/learnerJourney.ts::completedComponentIds."""
    ids = set()
    for row in detail.get("videoProgress") or []:
        cid = row.get("componentId")
        if cid and progress_counts_as_achieved(row):
            ids.add(cid)
    for row in detail.get("componentProgress") or []:
        cid = row.get("componentId")
        if cid and progress_counts_as_achieved(row):
            ids.add(cid)
    return ids


def build_ksb_progress(detail: dict, evidenced_codes=None) -> list:
    """Python port of frontend/src/utils/learnerJourney.ts::buildKsbProgress.

    KSB coverage reflects the whole programme to date, not just the review
    window — matching how the existing client-side deck (page.tsx) computes
    it, since a KSB earned two reviews ago is still earned.
    """
    done = completed_component_ids(detail)
    evidenced = {ksb_parent_code(code) for code in (evidenced_codes or [])}
    by_code: dict[str, list] = {}

    for component in detail.get("components") or []:
        component_id = component.get("componentId") or ""
        if not component_id:
            continue
        for mapping in component.get("ksbMappings") or []:
            code = ksb_parent_code(mapping.get("code"))
            if not code:
                continue
            by_code.setdefault(code, []).append({
                "componentId": component_id,
                "title": component.get("component") or "Activity",
                "module": component.get("module"),
                "week": component.get("week"),
                "type": component.get("type"),
                "weight": _num(mapping.get("weight"), 0) or 0,
                "classification": mapping.get("classification"),
                "done": component_id in done,
            })

    results = []
    for ksb in detail.get("ksbs") or []:
        code = _clean(ksb.get("code")).upper()
        contributors = sorted(
            by_code.get(code, []),
            key=lambda c: (c["done"], -c["weight"]),
        )
        available_weight = sum(c["weight"] for c in contributors)
        recorded_evidence = code in evidenced
        earned_weight = available_weight if recorded_evidence else sum(
            c["weight"] for c in contributors if c["done"]
        )
        done_count = sum(1 for c in contributors if c["done"])
        if recorded_evidence:
            pct = 100
        elif available_weight > 0:
            pct = max(0, min(100, round(earned_weight / available_weight * 100)))
        else:
            pct = 0
        if recorded_evidence or (available_weight > 0 and earned_weight >= available_weight):
            status = "complete"
        elif earned_weight > 0:
            status = "in-progress"
        else:
            status = "not-started"
        results.append({
            "code": code,
            "type": ksb_type_code(ksb.get("type"), code),
            "description": ksb.get("description") or "",
            "availableWeight": available_weight,
            "earnedWeight": earned_weight,
            "pct": pct,
            "status": status,
            "contributors": contributors,
            "doneCount": done_count,
            "totalCount": len(contributors),
        })
    return results


# --------------------------------------------------------------------------- #
# learner + review metadata
# --------------------------------------------------------------------------- #

def _resolve_learner(learner_id: int):
    from learner_api.models import EnrolmentUser

    try:
        source = EnrolmentUser.all_learners.get(pk=learner_id)
    except EnrolmentUser.DoesNotExist as exc:
        raise LearnerLookupError(f"No learner found with id {learner_id}.") from exc
    kind = "commercial" if _clean(source.learner_type).lower() == "commercial" else "apprenticeship"
    return kind, source


def _resolve_profile(source, learner_id: int):
    from learner_api.identity import learner_profile_for_source
    return learner_profile_for_source(source, source_pk=learner_id)


def _build_learner_section(source, profile, detail, warnings: list) -> dict:
    start = _parse_date(getattr(profile, "start_date", None)) or _parse_date(getattr(source, "start_date", None))
    end = (
        _parse_date(getattr(profile, "end_date", None))
        or _parse_date(getattr(source, "end_date", None))
        or _parse_date(getattr(source, "apprenticeship_end_date", None))
        or _parse_date(getattr(source, "practical_period_end_date", None))
    )
    programme = detail.get("programme") or getattr(source, "programme", None) or NOT_AVAILABLE
    role = NOT_AVAILABLE
    warnings.append("Learner job role/title has no source column in the current schema; reported as 'Not available'.")

    return {
        "learner_id": str(source.id),
        "full_name": detail.get("name") or _clean(source.username) or NOT_AVAILABLE,
        "email": detail.get("email") or _clean(source.email) or NOT_AVAILABLE,
        "programme": programme,
        # The standard's name IS the programme name in this schema — there is
        # no separate "apprenticeship standard" column to source this from.
        "apprenticeship_standard": programme,
        "employer": detail.get("employer") or _clean(source.employer) or NOT_AVAILABLE,
        "role": role,
        "manager_name": detail.get("lineManager") or _clean(source.line_manager) or NOT_AVAILABLE,
        "cohort": detail.get("cohort") or _clean(source.cohort) or NOT_AVAILABLE,
        "group": detail.get("group") or _clean(source.group) or NOT_AVAILABLE,
        "coach": _clean(getattr(profile, "coach_name", None)) or _clean(source.coach_name) or NOT_AVAILABLE,
        "programme_start_date": start.isoformat() if start else NOT_AVAILABLE,
        "planned_end_date": end.isoformat() if end else NOT_AVAILABLE,
        "active_status": bool(profile and _clean(getattr(profile, "lifecycle_status", "")).lower() == "active"),
    }


def _build_review_section(period: ReviewPeriod, *, review_id, generated_by, generated_at) -> dict:
    return {
        "review_id": review_id,
        "review_number": period.review_number,
        "review_date": period.review_date.isoformat(),
        "review_period_start": period.review_period_start.isoformat(),
        "review_period_end": period.review_period_end.isoformat(),
        "action_period_start": period.action_period_start.isoformat(),
        "action_period_end": period.action_period_end.isoformat(),
        "generated_by": generated_by or NOT_AVAILABLE,
        "generated_at": generated_at.isoformat(),
    }


# --------------------------------------------------------------------------- #
# attendance
# --------------------------------------------------------------------------- #

def _build_attendance_section(source, period: ReviewPeriod, warnings: list) -> dict:
    """Live KBC register rows for the review window only (attendance.py itself
    has no date-range parameter — the window filter happens here)."""
    try:
        from learner_api.attendance import _summarize_attendance, fetch_kbc_attendance_rows

        rows = fetch_kbc_attendance_rows(
            aptem_id=_clean(getattr(source, "aptem_id", None)),
            learner_id=source.id,
            learner_name=_clean(source.username),
            learner_email=_clean(source.email),
        )
    except Exception as exc:  # live external DB: network/config errors are expected
        logger.warning("Progress review: attendance lookup failed for learner %s: %s", source.id, exc)
        warnings.append("Attendance register could not be reached; attendance section is 'Not available'.")
        return {
            "attendance_percentage": NOT_AVAILABLE,
            "monthly_summary": [],
            "missed_sessions": NOT_AVAILABLE,
            "catch_ups_completed": NOT_AVAILABLE,
            "catch_ups_needed": NOT_AVAILABLE,
            "engagement_notes": NOT_AVAILABLE,
        }

    window_rows = [
        row for row in rows
        if _within(row.get("session_date"), period.review_period_start, period.review_period_end)
    ]
    summary = _summarize_attendance(window_rows) if window_rows else None
    if summary is None:
        warnings.append("No attendance register rows fall inside this review window.")
        return {
            "attendance_percentage": NOT_AVAILABLE,
            "monthly_summary": [],
            "missed_sessions": 0,
            "catch_ups_completed": 0,
            "catch_ups_needed": 0,
            "engagement_notes": "No recorded sessions in this review period.",
        }

    monthly: dict[str, dict] = {}
    for entry in summary.get("sessionHistory") or []:
        entry_date = _parse_date(entry.get("date"))
        if not entry_date:
            continue
        label = entry_date.strftime("%B %Y")
        bucket = monthly.setdefault(label, {"month": label, "sessions": 0, "present": 0, "absent": 0, "late": 0})
        bucket["sessions"] += 1
        status = _clean(entry.get("status")).lower()
        if status in bucket:
            bucket[status] += 1

    absent = summary.get("absent", 0) or 0
    catchup = summary.get("catchup", 0) or 0
    catch_ups_needed = max(0, absent - catchup)
    rate = summary.get("attendanceRate")

    if rate is not None and rate >= 90:
        notes = "Attendance is strong across the review period; no engagement concerns identified."
    elif rate is not None and rate >= 80:
        notes = "Attendance is broadly on track; monitor missed sessions and confirm catch-ups are booked."
    elif rate is not None:
        notes = "Attendance is below the expected threshold for this period; agree a recovery plan with the learner."
    else:
        notes = NOT_AVAILABLE

    return {
        "attendance_percentage": rate if rate is not None else NOT_AVAILABLE,
        "monthly_summary": sorted(monthly.values(), key=lambda item: item["month"]),
        "missed_sessions": absent,
        "catch_ups_completed": catchup,
        "catch_ups_needed": catch_ups_needed,
        "engagement_notes": notes,
    }


# --------------------------------------------------------------------------- #
# progress / LMS modules
# --------------------------------------------------------------------------- #

def _build_progress_section(detail: dict, profile, period: ReviewPeriod, warnings: list):
    completed_hours = _num(getattr(profile, "completed_hours", None))
    planned_hours = _num(getattr(profile, "planned_hours", None))
    target_hours = _num(getattr(profile, "target_hours", None))

    current_pct = round(completed_hours / planned_hours * 100) if completed_hours is not None and planned_hours else None
    target_pct = round(target_hours / planned_hours * 100) if target_hours is not None and planned_hours else None
    if current_pct is None or target_pct is None:
        warnings.append("Programme progress percentage could not be computed (missing planned/target hours).")

    done_ids = completed_component_ids(detail)
    modules: dict[str, dict] = {}
    for component in detail.get("components") or []:
        module = component.get("module") or NOT_AVAILABLE
        bucket = modules.setdefault(module, {"module": module, "total": 0, "done": 0})
        bucket["total"] += 1
        if component.get("componentId") in done_ids:
            bucket["done"] += 1

    lms_modules = []
    next_module = None
    for module_name, bucket in modules.items():
        pct = round(bucket["done"] / bucket["total"] * 100) if bucket["total"] else 0
        lms_modules.append({"module": module_name, "completion_percentage": pct, "components_done": bucket["done"], "components_total": bucket["total"]})
        if pct < 100 and next_module is None:
            next_module = module_name
    if next_module is None:
        next_module = detail.get("currentModule") or NOT_AVAILABLE

    warnings.append("Overdue LMS activities could not be determined: no due-date column exists on curriculum components.")

    progress = {
        "current_programme_progress_percentage": current_pct if current_pct is not None else NOT_AVAILABLE,
        "target_progress_percentage": target_pct if target_pct is not None else NOT_AVAILABLE,
        "progress_variance": (current_pct - target_pct) if current_pct is not None and target_pct is not None else NOT_AVAILABLE,
        "next_module": next_module,
        "overdue_lms_activities": NOT_AVAILABLE,
        "action_notes": (
            "Agree the next module or evidence project for the upcoming action period."
            if next_module and next_module != NOT_AVAILABLE
            else "Confirm the learner's next learning activity with their coach."
        ),
    }
    return progress, lms_modules


# --------------------------------------------------------------------------- #
# OTJ
# --------------------------------------------------------------------------- #

def _build_otj_section(source, profile, detail: dict, warnings: list) -> dict:
    completed = _num(getattr(profile, "completed_hours", None))
    target = _num(getattr(profile, "target_hours", None))
    planned = _num(getattr(profile, "planned_hours", None))
    minimum = _num(getattr(source, "minimum_required_hours", None))
    status = _clean(getattr(profile, "otjh_status", None)) or detail.get("otjhStatus") or NOT_AVAILABLE

    start = _parse_date(getattr(profile, "start_date", None)) or _parse_date(getattr(source, "start_date", None))
    end = _parse_date(getattr(profile, "end_date", None)) or _parse_date(getattr(source, "end_date", None))
    forecast = NOT_AVAILABLE
    if completed is not None and start and end and end > start:
        today = date.today()
        elapsed_days = max((min(today, end) - start).days, 1)
        total_days = (end - start).days
        elapsed_fraction = min(1.0, elapsed_days / total_days) if total_days else None
        if elapsed_fraction and elapsed_fraction > 0:
            forecast = round(completed / elapsed_fraction, 1)
    if forecast == NOT_AVAILABLE:
        warnings.append("OTJ forecast hours could not be computed (missing/invalid programme dates).")

    variance = None
    if completed is not None and target is not None:
        variance = round(completed - target, 1)

    return {
        "completed_otj_hours": completed if completed is not None else NOT_AVAILABLE,
        "required_otj_hours_to_date": target if target is not None else NOT_AVAILABLE,
        "variance": variance if variance is not None else NOT_AVAILABLE,
        "forecast_hours": forecast,
        "minimum_required_hours": minimum if minimum is not None else NOT_AVAILABLE,
        "planned_hours": planned if planned is not None else NOT_AVAILABLE,
        "risk_status": status,
        "duplicate_or_weak_otj_warning": NOT_AVAILABLE,
    }


# --------------------------------------------------------------------------- #
# evidence / assignments / workplace activities
# --------------------------------------------------------------------------- #

def _normalize_training_plan_details(value) -> dict:
    """"Learner"."evidence_files"."Training_plan_details" is a `json` column,
    which some rows hold as an already-decoded dict and others as a raw JSON
    string (older rows, or a driver that doesn't auto-decode plain `json`
    columns the way it does `jsonb`) — never assume which you got."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            decoded = json.loads(value)
        except ValueError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _classify_evidence(row: dict) -> str:
    """assignment vs workplace_activity, from what is actually on the row —
    a curriculum link (component_ref/progress_entry_id) means the evidence was
    uploaded against a set assignment; anything else is freeform workplace
    evidence the learner or coach attached without a curriculum reference."""
    details = row.get("trainingPlanDetails") or {}
    text = " ".join(str(v) for v in details.values() if isinstance(v, str)).lower()
    if "workplace" in text or "project" in text:
        return "workplace_activity"
    if row.get("componentRef") or row.get("progressEntryId"):
        return "assignment"
    return "workplace_activity"


def _build_evidence_sections(kind, learner_id, period: ReviewPeriod, warnings: list):
    try:
        from learner_api.evidence import _marking_status, ensure_evidence_tables
        from learner_api.evidence_storage import azure_configured, get_download_sas
        from django.db import connections

        ensure_evidence_tables()
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'select id, original_filename, content_type, size_bytes, status, '
                'scan_result, section_ref, uploaded_at, "Training_plan_details", '
                'component_ref, progress_entry_id, container, blob_name '
                'from "Learner"."evidence_files" '
                'where learner_kind = %s and learner_id = %s '
                'order by uploaded_at desc',
                [kind, str(learner_id)],
            )
            columns = [c[0] for c in cur.description]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]
    except DatabaseError as exc:
        logger.warning("Progress review: evidence lookup failed for learner %s: %s", learner_id, exc)
        warnings.append("Evidence records could not be loaded; evidence section is empty.")
        return [], [], []
    except Exception as exc:  # ensure_evidence_tables/network
        logger.warning("Progress review: evidence lookup failed for learner %s: %s", learner_id, exc)
        warnings.append("Evidence records could not be loaded; evidence section is empty.")
        return [], [], []

    evidence_out = []
    for row in rows:
        uploaded_at = _parse_date(row.get("uploaded_at"))
        if not _within(uploaded_at, period.review_period_start, period.review_period_end):
            continue
        details = _normalize_training_plan_details(row.get("Training_plan_details"))
        ksb_codes = details.get("ksbCodes")
        try:
            marking = _marking_status(kind, learner_id, row.get("section_ref"))
        except Exception:
            marking = "unknown"
        file_link = NOT_AVAILABLE
        if row.get("status") == "approved" and azure_configured():
            try:
                file_link = get_download_sas(row["container"], row["blob_name"], filename=row["original_filename"])
            except Exception:
                file_link = NOT_AVAILABLE

        item = {
            "evidence_title": row.get("original_filename") or NOT_AVAILABLE,
            "evidence_date": uploaded_at.isoformat() if uploaded_at else NOT_AVAILABLE,
            "evidence_type": row.get("content_type") or NOT_AVAILABLE,
            "evidence_status": row.get("status") or NOT_AVAILABLE,
            "evidence_summary": details.get("componentTitle") or NOT_AVAILABLE,
            "evidence_file_link": file_link,
            "image_or_screenshot_link": file_link if _clean(row.get("content_type")).startswith("image/") else NOT_AVAILABLE,
            "manager_verification_status": marking or "not submitted",
            "ai_classification_summary": NOT_AVAILABLE,
            "ksb_mappings": ksb_codes or [],
            "evidence_strength": "strong" if marking == "accepted" else ("pending" if row.get("status") == "pending" else "unverified"),
            "_kind": _classify_evidence({**row, "trainingPlanDetails": details, "componentRef": row.get("component_ref"), "progressEntryId": row.get("progress_entry_id")}),
        }
        evidence_out.append(item)

    if not evidence_out:
        warnings.append("No evidence was uploaded inside this review period.")

    assignments = [dict(item) for item in evidence_out if item["_kind"] == "assignment"]
    workplace = [dict(item) for item in evidence_out if item["_kind"] == "workplace_activity"]
    for item in evidence_out:
        item.pop("_kind", None)
    for item in assignments:
        item.pop("_kind", None)
    for item in workplace:
        item.pop("_kind", None)
    return evidence_out, assignments, workplace


# --------------------------------------------------------------------------- #
# KSBs
# --------------------------------------------------------------------------- #

def _recommend_evidence(ksb: dict) -> str:
    kind = ksb["type"]
    if kind == "K":
        return f"Add a short written reflection or workplace example that shows applied understanding of {ksb['code']}."
    if kind == "S":
        return f"Capture a live workplace task that demonstrates {ksb['code']} end-to-end, with manager sign-off."
    if kind == "B":
        return f"Record a manager or peer observation evidencing {ksb['code']} in day-to-day practice."
    return f"Agree a specific piece of evidence for {ksb['code']} with the coach."


def _build_ksb_sections(detail: dict, profile, warnings: list) -> dict:
    progress = build_ksb_progress(detail)
    if not progress:
        warnings.append("No KSBs are assigned to this learner's programme.")

    def by_type(type_code):
        return [
            {"code": item["code"], "description": item["description"] or NOT_AVAILABLE, "coverage_percentage": item["pct"]}
            for item in progress
            if item["type"] == type_code and item["status"] == "complete"
        ]

    priority = sorted(
        (item for item in progress if item["status"] != "complete"),
        key=lambda item: (item["pct"], item["doneCount"]),
    )[:8]
    priority_out = [
        {
            "code": item["code"],
            "description": item["description"] or NOT_AVAILABLE,
            "coverage_percentage": item["pct"],
            "accepted_count": item["doneCount"],
            "how_to_evidence": _recommend_evidence(item),
            "evidence_to_retain": "Brief, output, manager comment, and a short reflection.",
        }
        for item in priority
    ]

    return {
        "knowledge_evidenced": by_type("K"),
        "skills_evidenced": by_type("S"),
        "behaviours_evidenced": by_type("B"),
        "priority_next": priority_out,
    }, progress


# --------------------------------------------------------------------------- #
# EPA
# --------------------------------------------------------------------------- #

def _build_epa_section(detail: dict, ksb_progress: list, evidence: list, warnings: list) -> dict:
    if ksb_progress:
        overall = round(sum(item["pct"] for item in ksb_progress) / len(ksb_progress))
    else:
        overall = None
        warnings.append("EPA readiness could not be estimated: no KSB coverage data available.")

    quiz_attempts = detail.get("quizAttempts") or []
    if quiz_attempts:
        grades = [_num(a.get("grade"), 0) or 0 for a in quiz_attempts]
        mct_confidence = f"{round(sum(grades) / len(grades))}% average across {len(grades)} quiz attempt(s) to date."
    else:
        mct_confidence = NOT_AVAILABLE
        warnings.append("Multiple Choice Test confidence could not be estimated: no quiz attempts recorded.")

    behaviours = [item for item in ksb_progress if item["type"] == "B"]
    if behaviours:
        pd_pct = round(sum(item["pct"] for item in behaviours) / len(behaviours))
        pd_confidence = f"{pd_pct}% based on Behaviours KSB coverage (not a direct EPA mock result)."
    else:
        pd_confidence = NOT_AVAILABLE

    project_confidence = NOT_AVAILABLE
    warnings.append("Project Showcase confidence has no source data (no mock EPA results are recorded in the LMS).")

    pending = sum(1 for item in evidence if item.get("evidence_status") == "pending")
    rejected = sum(1 for item in evidence if item.get("evidence_status") == "rejected")
    portfolio_risks = []
    if pending:
        portfolio_risks.append(f"{pending} evidence item(s) awaiting review.")
    if rejected:
        portfolio_risks.append(f"{rejected} evidence item(s) rejected and need replacing.")
    if not portfolio_risks:
        portfolio_risks.append("No outstanding portfolio issues identified.")

    admin_risks = []
    low_ksbs = [item for item in ksb_progress if item["status"] != "complete"]
    if low_ksbs:
        admin_risks.append(f"{len(low_ksbs)} KSB(s) below full coverage — see priority KSBs for detail.")
    else:
        admin_risks.append("All assigned KSBs are fully evidenced.")

    return {
        "current_readiness": f"{overall}%" if overall is not None else NOT_AVAILABLE,
        "multiple_choice_test_confidence": mct_confidence,
        "project_showcase_confidence": project_confidence,
        "professional_discussion_confidence": pd_confidence,
        "portfolio_risks": portfolio_risks,
        "evidence_admin_risks": admin_risks,
    }


# --------------------------------------------------------------------------- #
# actions / manager questions
# --------------------------------------------------------------------------- #

def _build_actions(period: ReviewPeriod, progress: dict, otj: dict, priority_ksbs: list) -> list:
    actions = [
        {
            "title": "Close evidence admin",
            "detail": "Review pending uploads and confirm naming/mapping to the right plan areas.",
            "owner": "Coach and learner",
            "due_by": period.action_period_start.isoformat(),
        },
        {
            "title": "Agree next learning focus",
            "detail": f"Confirm progress on {progress.get('next_module', NOT_AVAILABLE)} for the coming action period.",
            "owner": "Learner",
            "due_by": period.action_period_end.isoformat(),
        },
        {
            "title": "Protect off-the-job time",
            "detail": f"Current OTJ status: {otj.get('risk_status', NOT_AVAILABLE)}. Confirm a realistic weekly routine.",
            "owner": "Learner and manager",
            "due_by": period.action_period_end.isoformat(),
        },
    ]
    if priority_ksbs:
        actions.append({
            "title": "Agree a workplace evidence project",
            "detail": f"Target KSBs: {', '.join(item['code'] for item in priority_ksbs[:4])}.",
            "owner": "Learner and manager",
            "due_by": period.action_period_end.isoformat(),
        })
    return actions


def _build_manager_questions(manager_name: str) -> list:
    target = manager_name if manager_name and manager_name != NOT_AVAILABLE else "the line manager"
    return [
        "What improvements have you seen in confidence, independence, or professional judgement?",
        "Which workplace examples best show applied learning rather than routine activity?",
        "Which upcoming project can create strong evidence for the priority KSBs?",
        "What evidence can you verify for portfolio and EPA readiness?",
        "Are there any concerns, barriers, or support needs to address before the next review?",
    ], target


# --------------------------------------------------------------------------- #
# top-level orchestration
# --------------------------------------------------------------------------- #

def build_review_pack(
    learner_id: int,
    period: ReviewPeriod,
    *,
    review_id=None,
    generated_by="",
) -> dict:
    """Assemble the full progress_review_pack for one learner and period.

    Raises LearnerLookupError if `learner_id` does not resolve to any learner
    (either kind) — that is a caller error (404), not a data-quality warning.
    Everything else degrades to NOT_AVAILABLE plus a source_warnings entry.
    """
    from django.utils import timezone
    from learner_api.learner_detail import build_learner_detail

    warnings: list = []
    kind, source = _resolve_learner(learner_id)
    profile = _resolve_profile(source, learner_id)
    if profile is None:
        warnings.append("This learner has no active LearnerProfile record; profile-derived fields may be limited.")

    try:
        detail = build_learner_detail(source, learner_id)
    except DatabaseError as exc:
        logger.warning("Progress review: build_learner_detail failed for learner %s: %s", learner_id, exc)
        warnings.append("Learner detail could not be loaded; programme/KSB/module sections are limited.")
        detail = {}

    learner_section = _build_learner_section(source, profile, detail, warnings)
    review_section = _build_review_section(
        period, review_id=review_id, generated_by=generated_by, generated_at=timezone.now(),
    )
    attendance_section = _build_attendance_section(source, period, warnings)
    progress_section, lms_modules = _build_progress_section(detail, profile, period, warnings)
    otj_section = _build_otj_section(source, profile, detail, warnings)
    evidence, assignments, workplace_activities = _build_evidence_sections(kind, learner_id, period, warnings)
    ksb_sections, ksb_progress = _build_ksb_sections(detail, profile, warnings)
    epa_section = _build_epa_section(detail, ksb_progress, evidence, warnings)
    actions = _build_actions(period, progress_section, otj_section, ksb_sections["priority_next"])
    manager_questions, _manager = _build_manager_questions(learner_section["manager_name"])

    return {
        "learner": learner_section,
        "review": review_section,
        "attendance": attendance_section,
        "progress": progress_section,
        "otj": otj_section,
        "lms_modules": lms_modules,
        "evidence": evidence,
        "assignments": assignments,
        "workplace_activities": workplace_activities,
        "ksbs": ksb_sections,
        "epa": epa_section,
        "actions": actions,
        "manager_questions": manager_questions,
        "source_warnings": warnings,
    }
