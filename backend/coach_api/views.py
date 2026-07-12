import os
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row
from django.http import JsonResponse
from django.views.decorators.http import require_GET


DEFAULT_COACH_EMAIL = "Med.Maher@kentbusinesscollege.com"
DEFAULT_ATTENDANCE_DATABASE = "AiTeamKBC"
DEFAULT_MARKING_OWNER_ID = 6452
ATTENDANCE_INCLUDED_STATUSES = {"active", "break"}
MARKING_OVERDUE_DAYS = 7
TIMETABLE_SCHEDULE_SLOTS = (9, 10, 11, 13, 14, 15, 16)
ENV_FILE_NAME = ".env"


def load_env_file() -> None:
    if getattr(load_env_file, "_loaded", False):
        return

    env_path = Path(__file__).resolve().parent.parent / ENV_FILE_NAME
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())

    load_env_file._loaded = True


def get_aptem_connection_string() -> str:
    load_env_file()
    return os.environ.get("APTEMAUTOEXTRACTINGDATABASE", "")


def get_kbc_attendance_connection_string() -> str:
    load_env_file()
    connection_string = os.environ.get("KBCDATABASE", "")
    if not connection_string:
        raise RuntimeError("KBCDATABASE is not configured.")

    database_name = os.environ.get("KBC_ATTENDANCE_DATABASE", DEFAULT_ATTENDANCE_DATABASE)
    try:
        conninfo = conninfo_to_dict(connection_string)
        conninfo["dbname"] = database_name
        return make_conninfo(**conninfo)
    except Exception as exc:
        raise RuntimeError(f"Unable to prepare KBC attendance database connection: {exc}") from exc


def to_decimal(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def to_int(value) -> int:
    return int(to_decimal(value))


def percentage(numerator, denominator) -> int:
    denominator_value = to_decimal(denominator)
    if denominator_value <= 0:
        return 0
    numerator_value = to_decimal(numerator)
    value = int(round((numerator_value / denominator_value) * 100))
    return max(0, min(100, value))


def parse_variance(value: str | None) -> int:
    if not value:
        return 0
    match = re.search(r"-?\d+", value)
    return int(match.group()) if match else 0


def format_date(value) -> str:
    if not value:
        return "--"
    return value.strftime("%d %b %Y")


def format_iso_date(value) -> str | None:
    if not value:
        return None
    return value.isoformat()


def parse_date_value(value):
    if not value:
        return None
    if isinstance(value, (date, datetime)):
        return value

    text = str(value).strip()
    if not text:
        return None

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(text[:10] if fmt == "%Y-%m-%d" else text, fmt)
        except ValueError:
            continue
    return None


def format_date_value(value) -> str:
    parsed = parse_date_value(value)
    if parsed:
        return parsed.strftime("%d %b %Y")
    return str(value).strip() if value not in (None, "") else "--"


def format_iso_date_value(value) -> str | None:
    parsed = parse_date_value(value)
    return parsed.date().isoformat() if isinstance(parsed, datetime) else parsed.isoformat() if parsed else None


def parse_schedule_date(value):
    if not value:
        return None

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text or text.lower() in {"null", "not yet", "()"}:
        return None

    match = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", text)
    if not match:
        return None

    day, month, year = match.groups()
    try:
        return date(int(year), int(month), int(day))
    except ValueError:
        return None


def normalize_schedule_status(value: str | None) -> str:
    text = str(value or "").strip()
    if not text or text.lower() in {"null", "not yet", "()"}:
        return "--"

    bracket_match = re.search(r"\(([^)]+)\)", text)
    if bracket_match:
        text = bracket_match.group(1).strip()

    normalized = re.sub(r"\s+", " ", text).strip().lower()
    if "completed" in normalized:
        return "Completed"
    if "not scheduled" in normalized:
        return "Not Scheduled"
    if "scheduled" in normalized:
        return "Scheduled"
    if "in progress" in normalized:
        return "In Progress"
    return text


def normalize_schedule_label(value: str | None, fallback: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\d{1,2}[-/]\d{1,2}[-/]\d{4}", "", text)
    text = re.sub(r"\([^)]*\)", "", text)
    text = text.strip(" -")
    return text or fallback


def build_initials(full_name: str | None) -> str:
    if not full_name:
        return "?"
    parts = [part for part in full_name.split() if part]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def normalize_program_status(raw_status: str | None) -> str:
    normalized = (raw_status or "").strip().lower().replace(" ", "")
    if normalized == "withdrawn":
        return "withdrawn"
    if normalized in {"break", "onbreak"}:
        return "break"
    if normalized == "readytoenrol":
        return "ready-to-enrol"
    if normalized == "active":
        return "active"
    return "unknown"


def should_include_in_attendance_page(learner: dict) -> bool:
    return learner["enrollmentStatus"] in ATTENDANCE_INCLUDED_STATUSES


def should_include_in_attendance_metrics(learner: dict) -> bool:
    return learner["enrollmentStatus"] == "active"


def build_risk_flags(row: dict, hours_progress: int, ksb_progress: int) -> list[str]:
    flags: list[str] = []

    if row["coach_rag"] in {"Red", "Amber"}:
        flags.append(f'Coach RAG: {row["coach_rag"]}')
    if row["otjh_status"] == "Need Attention":
        flags.append("Hours need attention")
    if row["ksb_status"] == "Not Started":
        flags.append("KSBs not started")
    if row["comp_status"] == "Behind":
        flags.append("Components behind target")
    if row["progress_variance"]:
        flags.append(f'Variance {row["progress_variance"]}')
    if hours_progress < 25:
        flags.append("Low hours progress")
    if ksb_progress < 25:
        flags.append("Low KSB progress")

    seen: set[str] = set()
    deduped: list[str] = []
    for flag in flags:
        if flag not in seen:
            seen.add(flag)
            deduped.append(flag)
    return deduped[:4]


def determine_performance_status(row: dict, hours_progress: int, ksb_progress: int, component_progress: int) -> str:
    if row["program_status"] == "ReadyToEnrol":
        return "new-starter"
    if row["coach_rag"] in {"Red", "Amber"}:
        return "at-risk"
    if row["otjh_status"] == "Need Attention" and (hours_progress < 45 or ksb_progress < 35):
        return "at-risk"
    if parse_variance(row["progress_variance"]) <= -10:
        return "at-risk"
    if hours_progress >= 80 and ksb_progress >= 75 and component_progress >= 20:
        return "high"
    return "on-track"


def fetch_caseload_rows(owner_email: str) -> list[dict]:
    connection_string = get_aptem_connection_string()
    if not connection_string:
        raise RuntimeError("APTEMAUTOEXTRACTINGDATABASE is not configured.")

    query = """
        select
            "ID" as learner_id,
            "FullName" as full_name,
            "Email" as learner_email,
            "Program Name" as cohort_name,
            "Program-Status" as program_status,
            "Group" as group_name,
            "Coach-RAG" as coach_rag,
            "OTJHoursStatus" as otjh_status,
            "KSBStatus" as ksb_status,
            "CompStatus" as comp_status,
            "ProgressVariance" as progress_variance,
            "TotalCompletedKSB" as total_completed_ksb,
            "TotalTargetKSB" as total_target_ksb,
            "Completed" as completed_hours,
            "Planned" as planned_hours,
            "Minimum" as minimum_hours,
            "Submitted" as submitted_hours,
            "Forecast" as forecast_hours,
            "Exepected" as expected_hours,
            "Progress-Hours" as progress_hours,
            "Assignment Evidence" as assignment_evidence,
            "LMS Evidence" as lms_evidence,
            "ExtraAct-Evidence" as extra_evidence,
            "CompletedCompCount" as completed_components,
            "TargetCompCount" as target_components,
            "Start-Date" as start_date,
            "End-Date" as end_date,
            "Gateway Review Date" as gateway_review_date,
            "OrganizationName" as organization_name,
            "OwnerName" as owner_name,
            "OwnerEmail" as owner_email,
            "OwnerPhone" as owner_phone,
            "ManagerName" as manager_name,
            "ManagerEmail" as manager_email,
            "Employer Email" as employer_email,
            "Learner Phone" as learner_phone
        from public.aptem_auto_extracting
        where "OwnerEmail" = %s
        order by "FullName"
    """

    with psycopg.connect(connection_string, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(query, (owner_email,))
            return list(cur.fetchall())


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def attendance_risk_from_rate(rate: int | None) -> str | None:
    if rate is None:
        return None
    if rate >= 90:
        return "green"
    if rate >= 80:
        return "amber"
    return "red"


def attendance_trend_from_records(records: list[dict]) -> str:
    if len(records) < 2:
        return "stable"

    recent = records[:4]
    previous = records[4:8]
    if not previous:
        return "up" if recent[0]["attendance"] == 1 else "down"

    recent_rate = sum(row["attendance"] for row in recent) / len(recent)
    previous_rate = sum(row["attendance"] for row in previous) / len(previous)
    if recent_rate > previous_rate + 0.05:
        return "up"
    if recent_rate < previous_rate - 0.05:
        return "down"
    return "stable"


def build_trend_point(row: dict) -> dict:
    attended = to_int(row["attended"])
    absent = to_int(row["absent"])
    total = attended + absent
    return {
        "label": row["label"],
        "value": percentage(absent, total),
        "sessionDate": format_iso_date(row["period"]),
        "attended": attended,
        "absent": absent,
        "onBreak": 0,
    }


def fetch_attendance_data(email_keys: list[str]) -> dict:
    if not email_keys:
        return {"metrics": {}, "records": {}, "trends": {"week": [], "month": [], "year": []}}

    unique_email_keys = sorted({email for email in email_keys if email})
    connection_string = get_kbc_attendance_connection_string()

    metrics: dict[str, dict] = {}
    records: dict[str, list[dict]] = {}
    trends: dict[str, list[dict]] = {"week": [], "month": [], "year": []}

    trend_queries = {
        "week": (
            "date_trunc('week', \"date\")::date",
            "'W' || to_char(date_trunc('week', \"date\"), 'IW')",
        ),
        "month": (
            "date_trunc('month', \"date\")::date",
            "to_char(date_trunc('month', \"date\"), 'Mon YYYY')",
        ),
        "year": (
            "date_trunc('year', \"date\")::date",
            "to_char(date_trunc('year', \"date\"), 'YYYY')",
        ),
    }

    with psycopg.connect(connection_string, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                    lower(trim("Email")) as email_key,
                    count(*) filter (where "Attendance" in (0, 1)) as sessions,
                    count(*) filter (where "Attendance" = 1) as present,
                    count(*) filter (where "Attendance" = 0) as absent,
                    min("date") as first_session_date,
                    max("date") as last_session_date
                from public.kbc_attendance
                where lower(trim("Email")) = any(%s)
                  and "Attendance" in (0, 1)
                group by lower(trim("Email"))
                """,
                (unique_email_keys,),
            )
            for row in cur.fetchall():
                metrics[row["email_key"]] = {
                    "sessions": to_int(row["sessions"]),
                    "present": to_int(row["present"]),
                    "absent": to_int(row["absent"]),
                    "firstSessionDate": format_iso_date(row["first_session_date"]),
                    "lastSessionDate": format_iso_date(row["last_session_date"]),
                    "lastSession": format_date(row["last_session_date"]),
                }

            cur.execute(
                """
                select
                    lower(trim("Email")) as email_key,
                    "date" as session_date,
                    "Attendance" as attendance
                from public.kbc_attendance
                where lower(trim("Email")) = any(%s)
                  and "Attendance" in (0, 1)
                order by lower(trim("Email")), "date" desc
                """,
                (unique_email_keys,),
            )
            for row in cur.fetchall():
                records.setdefault(row["email_key"], []).append(
                    {
                        "date": row["session_date"],
                        "attendance": to_int(row["attendance"]),
                    }
                )

            for key, (period_expr, label_expr) in trend_queries.items():
                cur.execute(
                    f"""
                    select
                        {period_expr} as period,
                        {label_expr} as label,
                        count(*) filter (where "Attendance" = 1) as attended,
                        count(*) filter (where "Attendance" = 0) as absent
                    from public.kbc_attendance
                    where lower(trim("Email")) = any(%s)
                      and "Attendance" in (0, 1)
                    group by period, label
                    order by period
                    """,
                    (unique_email_keys,),
                )
                trends[key] = [build_trend_point(row) for row in cur.fetchall()]

    for email_key, email_records in records.items():
        consecutive_missed = 0
        for row in email_records:
            if row["attendance"] == 0:
                consecutive_missed += 1
            else:
                break
        metrics.setdefault(email_key, {})["consecutiveMissed"] = consecutive_missed
        metrics[email_key]["trend"] = attendance_trend_from_records(email_records)

    return {"metrics": metrics, "records": records, "trends": trends}


def fetch_marking_rows(case_owner: str, case_owner_id: int | None = None) -> list[dict]:
    connection_string = get_aptem_connection_string()
    if not connection_string:
        raise RuntimeError("APTEMAUTOEXTRACTINGDATABASE is not configured.")

    query = """
        select
            "FullName" as full_name,
            "Email" as learner_email,
            "Subscription Status" as subscription_status,
            "CaseOwner ID" as case_owner_id,
            "ElapsedDays" as elapsed_days,
            "Phone" as phone,
            "CountEvidencePending" as count_evidence_pending,
            "Evidence Accepted" as evidence_accepted,
            "Evidence Reffered" as evidence_referred,
            "Referred Closure" as referred_closure,
            "Total Evidence" as total_evidence,
            "Last Snapshot CountApproved" as last_snapshot_count_approved,
            "Last Snapshot Date" as last_snapshot_date,
            "Start-Date" as start_date,
            "Status" as status,
            "CaseOwner" as case_owner,
            "LearnerId" as learner_id,
            "LastSubDate" as last_sub_date
        from public."Require Marking"
        where lower(trim(coalesce("CaseOwner", ''))) = lower(trim(%s))
           or (%s is not null and "CaseOwner ID" = %s)
        order by coalesce("CountEvidencePending", 0) desc,
                 coalesce("ElapsedDays", 0) desc,
                 "FullName"
    """

    with psycopg.connect(connection_string, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(query, (case_owner, case_owner_id, case_owner_id))
            return list(cur.fetchall())


def serialize_marking_row(row: dict, caseload_learner: dict | None) -> dict:
    pending_evidence = to_int(row["count_evidence_pending"])
    elapsed_days = to_int(row["elapsed_days"])
    normalized_status = normalize_program_status(row["status"])
    learner_id = row["learner_id"] or (caseload_learner or {}).get("id") or normalize_email(row["learner_email"])

    return {
        "id": str(learner_id),
        "learnerId": str(learner_id),
        "learner": row["full_name"] or (caseload_learner or {}).get("name") or "Unknown learner",
        "initials": build_initials(row["full_name"] or (caseload_learner or {}).get("name")),
        "email": row["learner_email"] or (caseload_learner or {}).get("email"),
        "programme": (caseload_learner or {}).get("cohortName") or "--",
        "group": (caseload_learner or {}).get("group") or "--",
        "status": row["status"] or "--",
        "enrollmentStatus": normalized_status,
        "isOnBreak": normalized_status == "break",
        "pendingEvidence": pending_evidence,
        "acceptedEvidence": to_int(row["evidence_accepted"]),
        "referredEvidence": to_int(row["evidence_referred"]),
        "referredClosure": to_int(row["referred_closure"]),
        "totalEvidence": to_int(row["total_evidence"]),
        "elapsedDays": elapsed_days,
        "isOverdue": elapsed_days > MARKING_OVERDUE_DAYS,
        "lastSubmission": format_date_value(row["last_sub_date"]),
        "lastSubmissionIso": format_iso_date_value(row["last_sub_date"]),
        "startDate": format_date_value(row["start_date"]),
        "module": None,
        "title": None,
        "type": None,
        "due": None,
        "words": None,
    }


def serialize_learner(row: dict) -> dict:
    hours_progress = percentage(row["completed_hours"], row["minimum_hours"] or row["planned_hours"])
    component_progress = percentage(row["completed_components"], row["target_components"])
    ksb_progress = percentage(row["total_completed_ksb"], row["total_target_ksb"])
    performance_status = determine_performance_status(row, hours_progress, ksb_progress, component_progress)
    cohort_name = (row["cohort_name"] or "").strip() or "Unassigned cohort"
    group_name = (row["group_name"] or "").strip() or "General"
    cohort_id = re.sub(r"[^a-z0-9]+", "-", cohort_name.lower()).strip("-") or "unassigned"
    evidence_count = (
        to_int(row["assignment_evidence"])
        + to_int(row["lms_evidence"])
        + to_int(row["extra_evidence"])
    )
    risk_flags = build_risk_flags(row, hours_progress, ksb_progress)

    return {
        "id": str(row["learner_id"]),
        "name": row["full_name"] or "Unknown learner",
        "initials": build_initials(row["full_name"]),
        "employer": row["organization_name"] or "Employer not set",
        "cohortId": cohort_id,
        "cohortName": cohort_name,
        "group": group_name,
        "status": performance_status,
        "enrollmentStatus": normalize_program_status(row["program_status"]),
        "riskFlags": risk_flags,
        "overallProgress": hours_progress,
        "attendanceRate": component_progress,
        "otjhCompleted": to_int(row["completed_hours"]),
        "otjhTarget": max(to_int(row["minimum_hours"]), to_int(row["planned_hours"]), 1),
        "otjhMinimum": to_int(row["minimum_hours"]),
        "otjhPlanned": to_int(row["planned_hours"]),
        "otjhSubmitted": to_int(row["submitted_hours"]),
        "otjhForecast": to_int(row["forecast_hours"]),
        "otjhExpected": to_int(row["expected_hours"]),
        "otjhProgressHours": row["progress_hours"] or "",
        "otjhStatus": row["otjh_status"] or "",
        "ksbCompleted": to_int(row["total_completed_ksb"]),
        "ksbTarget": to_int(row["total_target_ksb"]),
        "ksbStatus": row["ksb_status"] or "",
        "ksbProgress": ksb_progress,
        "evidenceCount": evidence_count,
        "nextCoaching": format_date(row["end_date"]),
        "nextReview": format_date(row["gateway_review_date"]),
        "lastContact": row["owner_name"] or "--",
        "lastAttendanceDate": format_date(row["start_date"]),
        "lastProgressReview": format_date(row["gateway_review_date"]),
        "lastReview": format_date(row["gateway_review_date"]),
        "lastCoachingSession": format_date(row["end_date"]),
        "lastSubmittedEvidence": "--",
        "recentFlag": risk_flags[0] if risk_flags else None,
        "email": row["learner_email"] or None,
        "employerEmail": row["employer_email"] or row["manager_email"] or None,
        "employerPhone": str(row["owner_phone"]) if row["owner_phone"] not in (None, "") else None,
        "progressVariance": row["progress_variance"] or "0%",
        "startDate": format_date(row["start_date"]),
        "gatewayReviewDate": format_date(row["gateway_review_date"]),
        "plannedEndDate": format_date(row["end_date"]),
        "coachName": row["owner_name"] or "Med Maher",
        "coachEmail": row["owner_email"] or DEFAULT_COACH_EMAIL,
        "rawProgramStatus": row["program_status"] or "",
        "coachRag": row["coach_rag"] or "",
    }


def fetch_timetable_source_rows(case_owner: str) -> dict[str, list[dict]]:
    connection_string = get_aptem_connection_string()
    if not connection_string:
        raise RuntimeError("APTEMAUTOEXTRACTINGDATABASE is not configured.")

    with psycopg.connect(connection_string, row_factory=dict_row) as conn:
        progress_rows = conn.execute(
            """
            select *
            from public.progress_review
            where lower(trim(coalesce("CaseOwner", ''))) = lower(trim(%s))
            """,
            (case_owner,),
        ).fetchall()
        mcr_rows = conn.execute(
            """
            select *
            from public."MCR"
            where lower(trim(coalesce("CaseOwner", ''))) = lower(trim(%s))
            """,
            (case_owner,),
        ).fetchall()

    return {"progress_review": list(progress_rows), "mcr": list(mcr_rows)}


def timetable_event_status(source_status: str) -> str | None:
    normalized = source_status.lower()
    if normalized == "completed":
        return "completed"
    if normalized == "scheduled":
        return "scheduled"
    if normalized == "in progress":
        return "in-progress"
    if normalized == "not scheduled":
        return "not-scheduled"
    return None


def timetable_priority(event_status: str, event_type: str) -> str:
    if event_status == "in-progress":
        return "high"
    if event_type == "welfare":
        return "high"
    return "normal"


def build_timetable_event(
    *,
    source: str,
    source_row: dict,
    sequence: int,
    planned_value: str | None,
    status_value: str | None,
    fallback_title: str,
) -> tuple[dict | None, bool]:
    event_date = parse_schedule_date(planned_value) or parse_schedule_date(status_value)
    source_status = normalize_schedule_status(status_value)
    needs_scheduling = source_status == "Not Scheduled"
    event_status = timetable_event_status(source_status)
    if event_date is None or event_status is None:
        return None, needs_scheduling

    label = normalize_schedule_label(planned_value, fallback_title)
    label_lower = label.lower()
    if source == "mcr":
        event_type = "coaching"
        title = "Monthly Coaching"
    elif "personal support" in label_lower:
        event_type = "welfare"
        title = "Personal Support Plan"
    else:
        event_type = "review"
        title = "Progress Review"

    if event_status == "not-scheduled":
        title = "Not Scheduled"

    learner = source_row.get("FullName") or "Unknown learner"
    event = {
        "id": f"{source}-{source_row.get('ID') or normalize_email(source_row.get('Email'))}-{sequence}",
        "source": source,
        "sourceStatus": source_status,
        "sequence": sequence,
        "title": title,
        "type": event_type,
        "date": event_date.isoformat(),
        "year": event_date.year,
        "month": event_date.month - 1,
        "dayOfMonth": event_date.day,
        "dayOfWeek": event_date.weekday(),
        "startHour": 9,
        "endHour": 10,
        "timeLabel": "Time TBC",
        "isTimeEstimated": True,
        "learner": learner,
        "email": source_row.get("Email"),
        "programme": source_row.get("programme") or source_row.get("Status") or "--",
        "cohort": source_row.get("Group") or "--",
        "employer": source_row.get("Manager Name") or None,
        "managerEmail": source_row.get("Manager Email") or None,
        "platform": "--",
        "location": "--",
        "priority": timetable_priority(event_status, event_type),
        "status": event_status,
        "notes": f"{label} · {source_status}",
        "rawPlanned": planned_value or "--",
        "rawStatus": status_value or "--",
    }
    return event, needs_scheduling


def extract_progress_review_events(row: dict) -> tuple[list[dict], int]:
    events = []
    needs_scheduling = 0
    for sequence in range(1, 17):
        event, is_unscheduled = build_timetable_event(
            source="progress-review",
            source_row=row,
            sequence=sequence,
            planned_value=row.get(f"Review Planned Date{sequence}"),
            status_value=row.get(f"Review Status{sequence}"),
            fallback_title="Progress Review",
        )
        if is_unscheduled:
            needs_scheduling += 1
        if event:
            events.append(event)
    return events, needs_scheduling


def extract_mcr_events(row: dict) -> tuple[list[dict], int]:
    events = []
    needs_scheduling = 0
    for sequence in range(1, 23):
        event, is_unscheduled = build_timetable_event(
            source="mcr",
            source_row=row,
            sequence=sequence,
            planned_value=row.get(f"MCM{sequence}"),
            status_value=row.get(f"Status{sequence}"),
            fallback_title="Monthly Coaching",
        )
        if is_unscheduled:
            needs_scheduling += 1
        if event:
            events.append(event)
    return events, needs_scheduling


def assign_timetable_slots(events: list[dict]) -> list[dict]:
    day_counts: dict[str, int] = {}
    for event in sorted(events, key=lambda item: (item["date"], item["type"], item["learner"])):
        count = day_counts.get(event["date"], 0)
        slot = TIMETABLE_SCHEDULE_SLOTS[count % len(TIMETABLE_SCHEDULE_SLOTS)]
        event["startHour"] = slot
        event["endHour"] = slot + 1
        day_counts[event["date"]] = count + 1
    return events


def summarize_timetable_events(events: list[dict], needs_scheduling: int) -> dict:
    completed_events = sum(1 for event in events if event["status"] == "completed")
    scheduled_events = sum(1 for event in events if event["status"] == "scheduled")
    in_progress_events = sum(1 for event in events if event["status"] == "in-progress")
    active_events = [event for event in events if event["status"] != "not-scheduled"]
    total_events = len(events)

    return {
        "totalEvents": total_events,
        "completedEvents": completed_events,
        "scheduledEvents": scheduled_events,
        "inProgressEvents": in_progress_events,
        "needsScheduling": needs_scheduling,
        "completionRate": percentage(completed_events, total_events),
        "coachingEvents": sum(1 for event in active_events if event["type"] == "coaching"),
        "reviewEvents": sum(1 for event in active_events if event["type"] == "review"),
        "supportEvents": sum(1 for event in active_events if event["type"] == "welfare"),
    }


def build_timetable_summary(
    events: list[dict],
    needs_scheduling: int,
    source_counts: dict,
    source_needs_scheduling: dict[str, int],
) -> dict:
    summary = summarize_timetable_events(events, needs_scheduling)
    summary.update(
        {
            "sourceBreakdown": {
                "mcr": summarize_timetable_events(
                    [event for event in events if event["source"] == "mcr"],
                    source_needs_scheduling.get("mcr", 0),
                ),
                "progressReview": summarize_timetable_events(
                    [event for event in events if event["source"] == "progress-review"],
                    source_needs_scheduling.get("progress-review", 0),
                ),
            },
            "timeAvailability": "Times are not available in MCR/progress_review; events are shown as Time TBC.",
            "sourceCounts": source_counts,
        }
    )
    return summary


def serialize_attendance_learner(learner: dict, attendance_metrics: dict | None) -> dict:
    sessions = attendance_metrics.get("sessions", 0) if attendance_metrics else 0
    present = attendance_metrics.get("present", 0) if attendance_metrics else 0
    absent = attendance_metrics.get("absent", 0) if attendance_metrics else 0
    attendance_rate = percentage(present, sessions) if sessions else None
    risk = attendance_risk_from_rate(attendance_rate)

    return {
        "id": learner["id"],
        "learner": learner["name"],
        "initials": learner["initials"],
        "email": learner.get("email"),
        "programme": learner["cohortName"],
        "cohort": learner["cohortName"],
        "group": learner["group"],
        "programStatus": learner["rawProgramStatus"],
        "enrollmentStatus": learner["enrollmentStatus"],
        "isOnBreak": learner["enrollmentStatus"] == "break",
        "includedInAttendanceMetrics": should_include_in_attendance_metrics(learner),
        "attendance": attendance_rate,
        "sessions": sessions if sessions else None,
        "present": present if sessions else None,
        "absent": absent if sessions else None,
        "late": None,
        "catchup": None,
        "trend": attendance_metrics.get("trend", "stable") if attendance_metrics else "stable",
        "risk": risk,
        "employer": learner["employer"],
        "overallProgress": learner["overallProgress"],
        "otjhCompleted": learner["otjhCompleted"],
        "otjhTarget": learner["otjhPlanned"] or learner["otjhTarget"],
        "ksbProgress": learner["ksbProgress"],
        "lastSession": attendance_metrics.get("lastSession", "--") if attendance_metrics else "--",
        "lastSessionDate": attendance_metrics.get("lastSessionDate") if attendance_metrics else None,
        "nextSession": "--",
        "consecutiveMissed": attendance_metrics.get("consecutiveMissed", 0) if attendance_metrics else None,
        "hasAttendance": bool(sessions),
    }


@require_GET
def coach_timetable(request):
    owner_email = request.GET.get("owner_email", DEFAULT_COACH_EMAIL).strip() or DEFAULT_COACH_EMAIL
    requested_owner_name = request.GET.get("owner_name", "").strip()
    start_date = parse_date_value(request.GET.get("start"))
    end_date = parse_date_value(request.GET.get("end"))
    if isinstance(start_date, datetime):
        start_date = start_date.date()
    if isinstance(end_date, datetime):
        end_date = end_date.date()

    try:
        caseload_rows = [
            row
            for row in fetch_caseload_rows(owner_email)
            if (row["full_name"] or "").strip()
        ]
        owner_name = requested_owner_name or (caseload_rows[0]["owner_name"] if caseload_rows else "Med Maher")
        source_rows = fetch_timetable_source_rows(owner_name)

        events: list[dict] = []
        needs_scheduling = 0
        source_needs_scheduling = {"progress-review": 0, "mcr": 0}
        for row in source_rows["progress_review"]:
            row_events, row_needs_scheduling = extract_progress_review_events(row)
            events.extend(row_events)
            needs_scheduling += row_needs_scheduling
            source_needs_scheduling["progress-review"] += row_needs_scheduling
        for row in source_rows["mcr"]:
            row_events, row_needs_scheduling = extract_mcr_events(row)
            events.extend(row_events)
            needs_scheduling += row_needs_scheduling
            source_needs_scheduling["mcr"] += row_needs_scheduling

        if start_date or end_date:
            filtered_events = []
            filtered_needs_scheduling = 0
            for event in events:
                event_date = parse_schedule_date(event["date"])
                if start_date and event_date < start_date:
                    continue
                if end_date and event_date > end_date:
                    continue
                filtered_events.append(event)
            events = filtered_events

            # Needs-scheduling items are source-derived and do not become events, so
            # keep the global count unless the frontend asks for all data.
            filtered_needs_scheduling = needs_scheduling
            needs_scheduling = filtered_needs_scheduling

        events = assign_timetable_slots(events)
        events = sorted(events, key=lambda event: (event["date"], event["startHour"], event["learner"]))
        source_counts = {
            "progressReviewRows": len(source_rows["progress_review"]),
            "mcrRows": len(source_rows["mcr"]),
            "caseloadLearners": len(caseload_rows),
        }
        summary = build_timetable_summary(events, needs_scheduling, source_counts, source_needs_scheduling)
    except Exception as exc:
        return JsonResponse(
            {"detail": "Unable to load coach timetable data.", "error": str(exc)},
            status=500,
        )

    return JsonResponse(
        {
            "owner": {"name": owner_name, "email": owner_email},
            "summary": summary,
            "events": events,
        }
    )


@require_GET
def coach_caseload(request):
    owner_email = request.GET.get("owner_email", DEFAULT_COACH_EMAIL).strip() or DEFAULT_COACH_EMAIL

    try:
        rows = [
            row
            for row in fetch_caseload_rows(owner_email)
            if (row["full_name"] or "").strip()
        ]
        learners = [serialize_learner(row) for row in rows]
    except Exception as exc:
        return JsonResponse(
            {"detail": "Unable to load coach caseload data.", "error": str(exc)},
            status=500,
        )

    owner_name = learners[0]["coachName"] if learners else "Med Maher"
    return JsonResponse(
        {
            "owner": {"name": owner_name, "email": owner_email},
            "learners": learners,
        }
    )


@require_GET
def coach_attendance(request):
    owner_email = request.GET.get("owner_email", DEFAULT_COACH_EMAIL).strip() or DEFAULT_COACH_EMAIL

    try:
        rows = [
            row
            for row in fetch_caseload_rows(owner_email)
            if (row["full_name"] or "").strip()
        ]
        caseload_learners = [
            learner
            for learner in [serialize_learner(row) for row in rows]
            if should_include_in_attendance_page(learner)
        ]
        active_learners = [
            learner for learner in caseload_learners if should_include_in_attendance_metrics(learner)
        ]
        email_keys = [normalize_email(learner.get("email")) for learner in caseload_learners]
        active_email_keys = [normalize_email(learner.get("email")) for learner in active_learners]
        attendance_data = fetch_attendance_data(email_keys)
        active_attendance_data = fetch_attendance_data(active_email_keys)
        metrics_by_email = attendance_data["metrics"]

        attendance_learners = [
            serialize_attendance_learner(
                learner,
                metrics_by_email.get(normalize_email(learner.get("email"))),
            )
            for learner in caseload_learners
        ]
    except Exception as exc:
        return JsonResponse(
            {"detail": "Unable to load coach attendance data.", "error": str(exc)},
            status=500,
        )

    metric_learners = [
        learner
        for learner in attendance_learners
        if learner["includedInAttendanceMetrics"]
    ]
    learners_with_attendance = [learner for learner in metric_learners if learner["hasAttendance"]]
    total_sessions = sum(learner["sessions"] or 0 for learner in learners_with_attendance)
    total_present = sum(learner["present"] or 0 for learner in learners_with_attendance)
    total_absent = sum(learner["absent"] or 0 for learner in learners_with_attendance)

    summary = {
        "totalLearners": len(attendance_learners),
        "activeLearners": len(metric_learners),
        "onBreakLearners": sum(1 for learner in attendance_learners if learner["isOnBreak"]),
        "learnersWithAttendance": len(learners_with_attendance),
        "cohortCount": len({learner["cohort"] for learner in attendance_learners if learner["cohort"]}),
        "averageAttendance": percentage(total_present, total_sessions) if total_sessions else None,
        "totalSessions": total_sessions,
        "totalPresent": total_present,
        "totalAbsent": total_absent,
        "onTrack": sum(1 for learner in learners_with_attendance if learner["risk"] == "green"),
        "needsAttention": sum(1 for learner in learners_with_attendance if learner["risk"] == "amber"),
        "atRisk": sum(1 for learner in learners_with_attendance if learner["risk"] == "red"),
        "unknown": len(metric_learners) - len(learners_with_attendance),
        "catchupsPending": None,
        "scheduledCatchups": None,
        "overdueCatchups": None,
    }

    owner_name = caseload_learners[0]["coachName"] if caseload_learners else "Med Maher"
    return JsonResponse(
        {
            "owner": {"name": owner_name, "email": owner_email},
            "summary": summary,
            "learners": attendance_learners,
            "trends": active_attendance_data["trends"],
        }
    )


@require_GET
def coach_marking_queue(request):
    owner_email = request.GET.get("owner_email", DEFAULT_COACH_EMAIL).strip() or DEFAULT_COACH_EMAIL
    requested_owner_id = request.GET.get("case_owner_id")
    case_owner_id = None
    if requested_owner_id:
        try:
            case_owner_id = int(requested_owner_id)
        except ValueError:
            case_owner_id = None

    try:
        caseload_rows = [
            row
            for row in fetch_caseload_rows(owner_email)
            if (row["full_name"] or "").strip()
        ]
        caseload_learners = [serialize_learner(row) for row in caseload_rows]
        owner_name = caseload_learners[0]["coachName"] if caseload_learners else "Med Maher"

        if case_owner_id is None and owner_email.lower() == DEFAULT_COACH_EMAIL.lower():
            case_owner_id = DEFAULT_MARKING_OWNER_ID

        caseload_by_email = {
            normalize_email(learner.get("email")): learner
            for learner in caseload_learners
            if normalize_email(learner.get("email"))
        }

        marking_rows = fetch_marking_rows(owner_name, case_owner_id)
        items = [
            serialize_marking_row(
                row,
                caseload_by_email.get(normalize_email(row.get("learner_email"))),
            )
            for row in marking_rows
        ]
        items = [
            item
            for item in items
            if item["pendingEvidence"] > 0
            and item["enrollmentStatus"] in ATTENDANCE_INCLUDED_STATUSES
        ]
    except Exception as exc:
        return JsonResponse(
            {"detail": "Unable to load coach marking queue data.", "error": str(exc)},
            status=500,
        )

    dated_items = [item for item in items if item["lastSubmissionIso"]]
    oldest_iso = min((item["lastSubmissionIso"] for item in dated_items), default=None)
    oldest_submission = "--"
    if oldest_iso:
        oldest_submission = next(
            item["lastSubmission"]
            for item in dated_items
            if item["lastSubmissionIso"] == oldest_iso
        )

    overdue_items = [item for item in items if item["isOverdue"]]
    summary = {
        "caseloadLearners": len(caseload_learners),
        "queueLearners": len(items),
        "activeLearners": sum(1 for learner in caseload_learners if learner["enrollmentStatus"] == "active"),
        "queueActiveLearners": sum(1 for item in items if item["enrollmentStatus"] == "active"),
        "onBreakLearners": sum(1 for learner in caseload_learners if learner["enrollmentStatus"] == "break"),
        "queueOnBreakLearners": sum(1 for item in items if item["isOnBreak"]),
        "pendingItems": sum(item["pendingEvidence"] for item in items),
        "overdueLearners": len(overdue_items),
        "overdueItems": sum(item["pendingEvidence"] for item in overdue_items),
        "inProgressItems": None,
        "acceptedEvidence": sum(item["acceptedEvidence"] for item in items),
        "referredEvidence": sum(item["referredEvidence"] for item in items),
        "totalEvidence": sum(item["totalEvidence"] for item in items),
        "oldestSubmission": oldest_submission,
        "oldestSubmissionIso": oldest_iso,
        "overdueThresholdDays": MARKING_OVERDUE_DAYS,
        "unavailableFields": ["module", "title", "type", "due", "words"],
    }

    return JsonResponse(
        {
            "owner": {"name": owner_name, "email": owner_email},
            "summary": summary,
            "items": items,
        }
    )
