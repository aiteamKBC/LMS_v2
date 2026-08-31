import json
import logging
import os
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
# `time` below is datetime.time, so the sleep function is imported under its own
# name to avoid shadowing it.
from time import perf_counter, sleep as _sleep
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from types import SimpleNamespace
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row
from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError, IntegrityError, close_old_connections, connections, router, transaction
from django.db.models import Max, Q
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from coach_api.auth import authenticated_coach_email, coach_access_required
from coach_api.errors import coach_error
from coach_api.models import CoachAbsenceReport, CoachCalendarEvent, CoachCalendarSequence
from coach_api.validation import (
    ObjectValidator,
    ValidationError,
    parse_json_object,
    validate_month,
    validation_error_response,
)
from config.observability import metric_event
from login.permissions import require_access
from learner_api.evidence_storage import (
    azure_configured,
    blob_url,
    move_blob,
    parse_blob_url,
    resolve_read_url,
)
from learner_api.models import (
    CommercialUser,
    EnrolmentUser,
    LearnerAbsence,
    LearnerProfile,
    StaffUser,
    learner_activity_events_relation_exists,
    learner_ksbs_relation_exists,
)
from learner_api.constants import ACCESS_COACH, ACCESS_SUPER_ADMIN
from learner_api.active_users import dedupe_otjh_progress_records, hydrate_source_training_plan, refresh_learner_ksb_snapshot
from learner_api.calendar_connections import (
    booking_conflicts as personal_calendar_booking_conflicts,
)
from learner_api.learner_detail import refresh_learner_otjh_snapshot
from learner_api.progress_rules import progress_record_counts_as_achieved
from learner_api.teams_attendance import fetch_verified_teams_attendance_rows
from curriculum_api.views import (
    actual_cohort_identity,
    actual_group_identity,
    apply_teams_meeting_options,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    authoring_fetch_all,
    authoring_modules_as_training_rows,
    build_module_session_plan,
    COHORT_AUTHORING_DETAILS_TABLE,
    delivery_days_per_week,
    get_program_config_rows,
    get_training_rows,
    is_operational_training_row,
    LIVE_SESSION_OCCURRENCES_TABLE,
    LIVE_SESSIONS_TABLE,
    parse_date,
    parse_int,
    parse_json_value,
    program_config_by_id,
    programme_identity,
    schedule_time_parts,
)


logger = logging.getLogger(__name__)
PROGRESS_REVIEW_RESPONSE_IDS = {
    "attendance_issues",
    "workplace_training_since_review",
    "ksb_learning_activities",
    "evidence_timely",
    "other_progress_issues",
    "other_progress_issues_detail",
    "learner_attitude_pride_rating",
    "learner_collaboration_rating",
    "learner_time_management_rating",
    "learner_respect_empathy_rating",
    "learner_english_confidence_rating",
    "learner_maths_confidence_rating",
    "learner_wider_skills_rating",
    "learner_workplace_behaviours_rating",
    "learner_provider_safeguarding_confidence_rating",
    "learner_employer_safeguarding_confidence_rating",
    "learner_provider_support_rating",
    "learner_manager_support_rating",
    "learner_additional_comments",
    "manager_learning_application_rating",
    "manager_wider_skills_rating",
    "manager_workplace_behaviours_rating",
    "manager_valued_application",
    "manager_progress_summary",
    "tutor_learning_attitude_rating",
    "tutor_time_management_rating",
    "tutor_respect_empathy_rating",
    "tutor_english_maths_rating",
    "tutor_workplace_behaviours_rating",
    "tutor_strengths",
    "tutor_progress_summary",
    "safeguarding_understood",
    "prevent_understood",
    "safeguarding_reporting_understood",
    "safeguarding_reporting_process",
    "safeguarding_concerns",
    "safeguarding_concerns_detail",
    "key_theme",
    "key_theme_other",
    "key_theme_comments",
    "additional_learning_support",
    "additional_learning_support_detail",
    "health_adjustments",
    "health_adjustments_detail",
    "other_support_circumstances",
    "other_support_detail",
    "previous_targets_achieved",
    "previous_targets_detail",
    "targets_actions",
    "action_owners_dates",
    "rag_status",
    "rag_reason",
}
PROGRESS_REVIEW_OPTIONAL_RESPONSE_IDS = {
    "other_progress_issues_detail",
    "learner_additional_comments",
    "safeguarding_concerns_detail",
    "key_theme_other",
    "additional_learning_support_detail",
    "health_adjustments_detail",
    "other_support_detail",
    "previous_targets_detail",
}
PROGRESS_REVIEW_REQUIRED_RESPONSE_IDS = (
    PROGRESS_REVIEW_RESPONSE_IDS - PROGRESS_REVIEW_OPTIONAL_RESPONSE_IDS
)
PROGRESS_REVIEW_RATING_RESPONSE_IDS = {
    response_id
    for response_id in PROGRESS_REVIEW_RESPONSE_IDS
    if response_id.endswith("_rating")
}
PROGRESS_REVIEW_YES_NO_RESPONSE_IDS = {
    "attendance_issues",
    "workplace_training_since_review",
    "ksb_learning_activities",
    "evidence_timely",
    "other_progress_issues",
    "safeguarding_understood",
    "prevent_understood",
    "safeguarding_reporting_understood",
    "safeguarding_concerns",
    "additional_learning_support",
    "health_adjustments",
    "other_support_circumstances",
    "previous_targets_achieved",
}
PROGRESS_REVIEW_KEY_THEMES = {
    "Health & Safety",
    "Prevent",
    "British Values",
    "Equality, Diversity & Inclusion",
    "Online Safety",
    "Wellbeing",
    "Other",
}
MONTHLY_COACHING_RESPONSE_IDS = {
    "mcm_previous_meeting",
    "mcm_previous_summary",
    "mcm_presentation_summary",
    "mcm_knowledge_reflection",
    "mcm_skills_reflection",
    "mcm_behaviour_reflection",
    "mcm_behaviour_next_step",
    "mcm_next_month_focus",
    "mcm_expected_evidence",
    "mcm_learning_resources",
    "mcm_resources_read",
    "mcm_paid_hours_confirmed",
    "mcm_workload_manageable",
    "mcm_wellbeing_impact",
    "mcm_wellbeing_outcome",
    "mcm_safeguarding_contact_confidence",
    "mcm_wellbeing_support_confidence",
    "mcm_safe_and_respected",
    "mcm_online_safety_prevent",
    "mcm_raise_concerns_confidence",
    "mcm_provider_safeguarding_confidence",
    "mcm_learner_feedback",
    "mcm_curriculum_planned",
    "mcm_teaching_well_delivered",
    "mcm_resources_accessible",
    "mcm_assessment_feedback_helpful",
    "mcm_tutor_support",
    "mcm_overall_learning_progress",
    "mcm_next_meeting_booked",
    "mcm_next_meeting_date",
    "mcm_meeting_summary",
    "mcm_meeting_notes",
    "mcm_outcome",
}
MONTHLY_COACHING_REQUIRED_RESPONSE_IDS = (
    MONTHLY_COACHING_RESPONSE_IDS - {"mcm_meeting_notes"}
)
MONTHLY_COACHING_YES_NO_RESPONSE_IDS = {
    "mcm_paid_hours_confirmed",
    "mcm_next_meeting_booked",
}
MONTHLY_COACHING_AGREEMENT_RESPONSE_IDS = {
    "mcm_workload_manageable",
    "mcm_wellbeing_impact",
    "mcm_safeguarding_contact_confidence",
    "mcm_wellbeing_support_confidence",
    "mcm_safe_and_respected",
    "mcm_online_safety_prevent",
    "mcm_raise_concerns_confidence",
    "mcm_provider_safeguarding_confidence",
    "mcm_curriculum_planned",
    "mcm_teaching_well_delivered",
    "mcm_resources_accessible",
    "mcm_assessment_feedback_helpful",
    "mcm_tutor_support",
    "mcm_overall_learning_progress",
}
DEFAULT_ATTENDANCE_DATABASE = "AiTeamKBC"
DEFAULT_MARKING_OWNER_ID = 6452
ATTENDANCE_INCLUDED_STATUSES = {"active", "break"}
MARKING_OVERDUE_DAYS = 7
TIMETABLE_SCHEDULE_SLOTS = (9, 10, 11, 13, 14, 15, 16)
ENV_FILE_NAME = ".env"
COACH_ATTENDANCE_DETAILS_RELATION_CANDIDATES = (
    '"Learner"."learner_attendance_details"',
    '"Learner"."Learner_attendance_details"',
    '"learner"."learner_attendance_details"',
    '"Coach"."learner_attendance_details"',
    '"coach"."learner_attendance_details"',
)
LEARNER_ABSENCE_RELATION_CANDIDATES = (
    '"Learner"."Absence"',
    '"Learner"."absence"',
    '"learner"."Absence"',
    '"learner"."absence"',
)
LEARNER_EVIDENCE_FILES_RELATION_CANDIDATES = (
    '"Learner"."evidence_files"',
    '"learner"."evidence_files"',
)
COACH_RAG_LABELS = {
    "green": "Green",
    "amber": "Amber",
    "red": "Red",
}
TIMETABLE_MCR_INTERVAL = timedelta(days=30)
TIMETABLE_PROGRESS_REVIEW_INTERVAL = timedelta(weeks=12)
TIMETABLE_DEFAULT_DURATION_MINUTES = 60
MICROSOFT_GRAPH_DEFAULT_SCOPE = "https://graph.microsoft.com/.default"
MICROSOFT_GRAPH_DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0"
MICROSOFT_GRAPH_DEFAULT_TIMEZONE = "GMT Standard Time"
CATCH_UP_EVENT_TYPE = "catch-up"


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


def to_number(value) -> float:
    return float(to_decimal(value))


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
    parsed = parse_date_value(value)
    if not parsed:
        return clean_text(value) or "--"
    return parsed.strftime("%d %b %Y")


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


def parse_time_value(value) -> time | None:
    if not value:
        return None
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    if isinstance(value, datetime):
        return value.time().replace(second=0, microsecond=0)

    text = str(value).strip()
    if not text:
        return None

    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).time().replace(second=0, microsecond=0)
        except ValueError:
            continue
    return None


def format_time_value(value) -> str | None:
    parsed = parse_time_value(value)
    return parsed.strftime("%H:%M") if parsed else None


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

    iso_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if iso_match:
        year, month, day = iso_match.groups()
        try:
            return date(int(year), int(month), int(day))
        except ValueError:
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


def schedule_status_label(value: str | None) -> str:
    normalized = clean_text(value).lower()
    labels = {
        "not-scheduled": "Not Scheduled",
        "scheduled": "Scheduled",
        "in-progress": "In Progress",
        "awaiting-signature": "Awaiting Signature",
        "completed": "Completed",
        "cancelled": "Not Scheduled",
    }
    return labels.get(normalized, clean_text(value) or "Not Scheduled")


def build_timetable_event_key(learner_id: int, event_type: str, sequence: int, target_date: date) -> str:
    return f"{event_type}:{learner_id}:{sequence}:{target_date.isoformat()}"


def build_catchup_template_event_key(owner_email: str, learner_id: int) -> str:
    return f"{CATCH_UP_EVENT_TYPE}:{normalize_email(owner_email)}:{learner_id}:template"


# Learner-booked session types (booked from the learner calendar page, unlike the
# generated mcr / progress-review events which only the coach schedules).
# The three onboarding reviews are booked the same way, but with the learner's
# case owner rather than their coach (see learner_api.calendar).
# Membership here means "a learner booked this", which decides more than the
# title: the invite says who booked it, the coach is added as an attendee, and
# the event is organised on the learner's mailbox so the coach actually receives
# an email (see graph_organizer_mailbox). Any type a learner can book needs an
# entry, or their booking is treated as a system-generated slot.
BOOKED_EVENT_TITLES = {
    "catch-up": "Catch-up Session",
    "student-support": "Student Support",
    "mcr": "Monthly Coaching",
    "progress-review": "Progress Review",
    "eligibility-review": "Eligibility Review & FS Discussion",
    "workspace": "RPL And Experience",
    "training-plan": "Workplace Health & Safety Declaration",
}

# Session types the coach can book from their own timetable page.
COACH_BOOKABLE_EVENT_TYPES = ("catch-up", "student-support")

# Calendar colour/type vocabulary for the booked types above.
BOOKED_EVENT_JSON_TYPES = {
    "student-support": "welfare",
    "eligibility-review": "review",
    "workspace": "review",
    "training-plan": "review",
}


def get_graph_settings() -> dict[str, str]:
    """Credentials for the app-only Graph client (Teams meetings, calendar sync).

    MICROSOFT_GRAPH_* comes first and deliberately so. The bare MICROSOFT_CLIENT_ID
    name is shared with the learner calendar-connection OAuth app, which is a
    delegated-auth registration holding no application roles; whichever of the two
    the .env declares last used to win here, so adding that app silently repointed
    Teams booking at credentials Graph answers with 403 ErrorAccessDenied. The old
    names stay as a fallback for deployments not yet carrying the dedicated ones.
    """
    load_env_file()
    return {
        "tenant_id": clean_text(
            os.environ.get("MICROSOFT_GRAPH_TENANT_ID")
            or os.environ.get("MICROSOFT_TENANT_ID")
            or os.environ.get("TENANTID")
        ),
        "client_id": clean_text(
            os.environ.get("MICROSOFT_GRAPH_CLIENT_ID")
            or os.environ.get("MICROSOFT_CLIENT_ID")
            or os.environ.get("CLIENTID")
        ),
        "client_secret": clean_text(
            os.environ.get("MICROSOFT_GRAPH_CLIENT_SECRET")
            or os.environ.get("MICROSOFT_CLIENT_SECRET")
        ),
        "scope": clean_text(os.environ.get("MICROSOFT_GRAPH_SCOPE")) or MICROSOFT_GRAPH_DEFAULT_SCOPE,
        "base_url": clean_text(os.environ.get("MICROSOFT_GRAPH_BASE_URL")) or MICROSOFT_GRAPH_DEFAULT_BASE_URL,
        "timezone": clean_text(os.environ.get("MICROSOFT_GRAPH_TIMEZONE")) or MICROSOFT_GRAPH_DEFAULT_TIMEZONE,
    }


def has_graph_credentials() -> bool:
    settings = get_graph_settings()
    return all(settings[key] for key in ("tenant_id", "client_id", "client_secret", "scope", "base_url"))


def microsoft_graph_token() -> str:
    settings = get_graph_settings()
    if not has_graph_credentials():
        raise RuntimeError("Microsoft Graph credentials are not configured.")

    token_url = f"https://login.microsoftonline.com/{settings['tenant_id']}/oauth2/v2.0/token"
    payload = urllib_parse.urlencode(
        {
            "client_id": settings["client_id"],
            "client_secret": settings["client_secret"],
            "scope": settings["scope"],
            "grant_type": "client_credentials",
        }
    ).encode("utf-8")
    request = urllib_request.Request(
        token_url,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    # Transient DNS/network blips otherwise fail a booking outright and leave the
    # learner holding a slot nobody was told about, so retry the connection a
    # couple of times. HTTP errors are real rejections -- never retried.
    last_url_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib_request.urlopen(request, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
            last_url_error = None
            break
        except urllib_error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Microsoft token request failed: {exc.code} {detail}") from exc
        except urllib_error.URLError as exc:
            last_url_error = exc
            if attempt < 2:
                _sleep(1 + attempt)
    if last_url_error is not None:
        raise RuntimeError(f"Microsoft token request failed: {last_url_error}") from last_url_error

    access_token = data.get("access_token")
    if not access_token:
        raise RuntimeError("Microsoft token response did not include access_token.")
    return access_token


def microsoft_graph_request(method: str, path: str, *, payload: dict | None = None) -> dict:
    started = perf_counter()
    settings = get_graph_settings()
    try:
        token = microsoft_graph_token()
    except Exception:
        metric_event(
            "graph_call",
            method=method.upper(),
            graph_status="token_error",
            latency_ms=round((perf_counter() - started) * 1000, 1),
        )
        raise
    url = f"{settings['base_url'].rstrip('/')}/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")

    request = urllib_request.Request(url, data=body, headers=headers, method=method.upper())
    try:
        with urllib_request.urlopen(request, timeout=25) as response:
            raw = response.read().decode("utf-8")
    except urllib_error.HTTPError as exc:
        metric_event(
            "graph_call",
            method=method.upper(),
            graph_status=f"http_{exc.code}",
            latency_ms=round((perf_counter() - started) * 1000, 1),
        )
        detail = exc.read().decode("utf-8", errors="ignore")
        graph_code = ""
        graph_message = ""
        request_id = ""
        try:
            parsed_detail = json.loads(detail) if detail else {}
            graph_error = parsed_detail.get("error") if isinstance(parsed_detail, dict) else {}
            if isinstance(graph_error, dict):
                graph_code = str(graph_error.get("code") or "").strip()
                graph_message = str(graph_error.get("message") or "").strip()
                inner_error = graph_error.get("innerError") or graph_error.get("innererror") or {}
                if isinstance(inner_error, dict):
                    request_id = str(
                        inner_error.get("request-id")
                        or inner_error.get("requestId")
                        or ""
                    ).strip()
        except (TypeError, ValueError, json.JSONDecodeError):
            graph_message = detail[:1500].strip()
        if not request_id and exc.headers:
            request_id = str(
                exc.headers.get("request-id")
                or exc.headers.get("client-request-id")
                or ""
            ).strip()
        diagnostics = [f"HTTP {exc.code}"]
        if graph_code:
            diagnostics.append(f"code={graph_code}")
        if graph_message:
            diagnostics.append(f"message={graph_message}")
        if request_id:
            diagnostics.append(f"request-id={request_id}")
        raise RuntimeError(
            f"Microsoft Graph {method.upper()} {path} failed: {'; '.join(diagnostics)}"
        ) from exc
    except urllib_error.URLError as exc:
        metric_event(
            "graph_call",
            method=method.upper(),
            graph_status="network_error",
            latency_ms=round((perf_counter() - started) * 1000, 1),
        )
        raise RuntimeError(f"Microsoft Graph {method.upper()} {path} failed: {exc}") from exc

    metric_event(
        "graph_call",
        method=method.upper(),
        graph_status="success",
        latency_ms=round((perf_counter() - started) * 1000, 1),
    )
    return json.loads(raw) if raw else {}


def normalize_program_status(raw_status: str | None) -> str:
    normalized = (raw_status or "").strip().lower().replace(" ", "")
    if normalized == "withdrawn":
        return "withdrawn"
    if normalized in {"break", "onbreak", "onabreak", "onmaternitybreak", "onillnessbreak", "onotherbreak"}:
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


def normalize_person_name(value: str | None) -> str:
    return " ".join(clean_text(value).lower().split())


def clean_text(value) -> str:
    return "" if value in (None, "") else str(value).strip()


def parse_json_body(request) -> dict:
    return parse_json_object(request)


def normalize_coach_rag_value(value) -> str | None:
    normalized = clean_text(value).lower()
    if not normalized or normalized in {"--", "null", "none"}:
        return None
    if normalized in COACH_RAG_LABELS:
        return normalized
    raise ValueError("coachRag must be one of: green, amber, red.")


def format_coach_rag_value(value) -> str:
    return COACH_RAG_LABELS.get(clean_text(value).lower(), "")

def list_or_empty(value) -> list:
    return value if isinstance(value, list) else []


def count_planned_components(training_plan) -> int:
    total = 0
    for module in list_or_empty(training_plan):
        if not isinstance(module, dict):
            continue
        for week in list_or_empty(module.get("weeks")):
            if not isinstance(week, dict):
                continue
            total += sum(1 for component in list_or_empty(week.get("components")) if isinstance(component, dict))
    return total


def activity_completion_key(item: dict, index: int) -> str:
    quiz_id = item.get("quizId")
    if quiz_id not in (None, ""):
        return f"quiz:{quiz_id}"

    component_id = clean_text(item.get("componentId"))
    if component_id:
        return f"component:{component_id}"

    parts = [
        clean_text(item.get("module")),
        clean_text(item.get("week")),
        clean_text(item.get("kind")),
        clean_text(item.get("title")),
        clean_text(item.get("quizName")),
        clean_text(item.get("action")),
    ]
    compact = "|".join(part for part in parts if part)
    return compact or f"item:{index}"


KSB_PARENT_CODE_RE = re.compile(r"^([KSB])(\d+)(?:\.\d+)?$")


def normalize_ksb_parent_code(value: str) -> str:
    code = clean_text(value).upper()
    if not code:
        return ""
    match = KSB_PARENT_CODE_RE.match(code)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    return code


def extract_ksb_codes(values) -> set[str]:
    codes: set[str] = set()
    for value in list_or_empty(values):
        if isinstance(value, str):
            code = normalize_ksb_parent_code(value)
        elif isinstance(value, dict):
            code = normalize_ksb_parent_code(
                value.get("code") or value.get("Code") or value.get("id")
            )
        else:
            code = ""
        if code:
            codes.add(code)
    return codes


def summarize_ksb_breakdown(target_codes: set[str], completed_codes: set[str]) -> dict[str, dict[str, int | None]]:
    completed_in_target = completed_codes & target_codes if target_codes else set()
    breakdown: dict[str, dict[str, int | None]] = {}

    for label, prefix in (("knowledge", "K"), ("skills", "S"), ("behaviours", "B")):
        target_for_type = {code for code in target_codes if code.startswith(prefix)}
        completed_for_type = {code for code in completed_in_target if code.startswith(prefix)}
        target_count = len(target_for_type)
        completed_count = len(completed_for_type)

        breakdown[label] = {
            "completed": completed_count if target_count else None,
            "target": target_count if target_count else None,
            "progress": percentage(completed_count, target_count) if target_count else None,
        }

    return breakdown


def ksb_sort_key(code: str) -> tuple[int, int, str]:
    normalized = normalize_ksb_parent_code(code)
    match = re.match(r"^([KSB])(\d+)$", normalized)
    if not match:
        return (9, 0, normalized)
    prefix_order = {"K": 0, "S": 1, "B": 2}
    return (prefix_order.get(match.group(1), 9), int(match.group(2)), normalized)


def ksb_type_label(code: str, explicit_type: str = "") -> str:
    value = clean_text(explicit_type).lower()
    if value.startswith("knowledge") or value == "k":
        return "Knowledge"
    if value.startswith("skill") or value == "s":
        return "Skills"
    if value.startswith("behaviour") or value.startswith("behavior") or value == "b":
        return "Behaviours"

    normalized = normalize_ksb_parent_code(code)
    if normalized.startswith("K"):
        return "Knowledge"
    if normalized.startswith("S"):
        return "Skills"
    if normalized.startswith("B"):
        return "Behaviours"
    return clean_text(explicit_type) or "KSB"


def ksb_target_lookup(values) -> dict[str, dict[str, str]]:
    lookup: dict[str, dict[str, str]] = {}
    for value in list_or_empty(values):
        if isinstance(value, str):
            code = normalize_ksb_parent_code(value)
            explicit_type = ""
            description = ""
        elif isinstance(value, dict):
            code = normalize_ksb_parent_code(
                value.get("code") or value.get("Code") or value.get("id") or value.get("number")
            )
            explicit_type = clean_text(value.get("type") or value.get("ksb_type") or value.get("category"))
            description = clean_text(value.get("description") or value.get("label") or value.get("title") or value.get("name"))
        else:
            continue
        if not code:
            continue
        lookup.setdefault(code, {
            "code": code,
            "type": ksb_type_label(code, explicit_type),
            "description": description,
        })
    return lookup


def count_completed_components(progress_entries: list[dict]) -> int:
    seen: set[str] = set()
    for entry in progress_entries:
        if not isinstance(entry, dict):
            continue
        seen.add(activity_completion_key(entry, len(seen)))
    return len(seen)


def completed_ksb_codes(progress_entries: list[dict], activity_entries: list[dict]) -> set[str]:
    """KSB codes evidenced by activity the learner actually completed.

    A failed attempt is an attempt, not KSB evidence. Legacy failed quizzes can
    carry an entire profile's codes, which previously made coach totals jump to
    almost 100% while the learner page correctly showed only KSBs evidenced by
    completed activities. The gate is ``learner_api.progress_rules`` — the same
    rule Curriculum impact uses — so it holds for any kind, not just quizzes:
    ``passed=False`` on a Component with real lineage is excluded too.
    """
    completed: set[str] = set()
    for entry in [*progress_entries, *activity_entries]:
        if not isinstance(entry, dict):
            continue
        if not progress_record_counts_as_achieved(entry):
            continue
        completed.update(extract_ksb_codes(entry.get("ksbs")))
    return completed


def is_evidence_entry(entry: dict) -> bool:
    joined = " ".join(
        clean_text(entry.get(field))
        for field in ("kind", "title", "action", "detail", "quizName")
    ).lower()
    return "evidence" in joined


def derive_evidence_count(progress_entries: list[dict], activity_entries: list[dict]) -> int:
    seen: set[str] = set()
    for entry in [*progress_entries, *activity_entries]:
        if isinstance(entry, dict) and is_evidence_entry(entry):
            seen.add(activity_completion_key(entry, len(seen)))
    return len(seen)


def derive_completed_evidence_count(progress_entries: list[dict], activity_entries: list[dict]) -> int:
    completed_statuses = {"accepted", "approved", "complete", "completed", "validated"}
    seen: set[str] = set()
    for entry in [*progress_entries, *activity_entries]:
        if not isinstance(entry, dict) or not is_evidence_entry(entry):
            continue
        status = clean_text(entry.get("status") or entry.get("reviewStatus")).lower()
        if status in completed_statuses:
            seen.add(activity_completion_key(entry, len(seen)))
    return len(seen)


def derive_ksb_status(completed: int | None, target: int | None) -> str:
    if not target:
        return ""
    if not completed:
        return "Not Started"
    if completed >= target:
        return "Completed"
    return "In Progress"


def build_active_user_risk_flags(
    *,
    otjh_status: str,
    ksb_status: str,
    progress_variance: str,
    hours_progress: int,
    hours_available: bool,
    ksb_progress: int,
    ksb_available: bool,
    component_progress: int,
    component_available: bool,
) -> list[str]:
    flags: list[str] = []
    normalized_otjh = clean_text(otjh_status).lower().replace(" ", "")

    if normalized_otjh == "needattention":
        flags.append("Hours need attention")
    elif normalized_otjh == "atrisk":
        flags.append("OTJH at risk")

    if ksb_status == "Not Started":
        flags.append("KSBs not started")
    if progress_variance:
        flags.append(f"Variance {progress_variance}")
    if component_available and component_progress < 25:
        flags.append("Components behind target")
    if hours_available and hours_progress < 25:
        flags.append("Low hours progress")
    if ksb_available and ksb_progress < 25:
        flags.append("Low KSB progress")

    deduped: list[str] = []
    seen: set[str] = set()
    for flag in flags:
        if flag not in seen:
            seen.add(flag)
            deduped.append(flag)
    return deduped[:4]


def determine_active_user_status(
    *,
    program_status: str,
    otjh_status: str,
    progress_variance: str,
    hours_progress: int,
    hours_available: bool,
    ksb_progress: int,
    ksb_available: bool,
    component_progress: int,
    component_available: bool,
) -> str:
    if normalize_program_status(program_status) == "ready-to-enrol":
        return "new-starter"

    normalized_otjh = clean_text(otjh_status).lower().replace(" ", "")
    if normalized_otjh == "atrisk":
        return "at-risk"
    if normalized_otjh == "needattention" and (
        (hours_available and hours_progress < 45)
        or (ksb_available and ksb_progress < 35)
        or (component_available and component_progress < 35)
    ):
        return "at-risk"
    if progress_variance and parse_variance(progress_variance) <= -10:
        return "at-risk"
    if (
        hours_available
        and ksb_available
        and component_available
        and hours_progress >= 80
        and ksb_progress >= 75
        and component_progress >= 75
    ):
        return "high"
    return "on-track"


def get_lms_row_program_status(row) -> str:
    return clean_text(getattr(row, "programme_status", None) or getattr(row, "status", None))


def get_learner_db_alias() -> str:
    return router.db_for_read(LearnerProfile) or "default"


def find_existing_relation(connection, relation_candidates: tuple[str, ...]) -> str | None:
    with connection.cursor() as cursor:
        for relation in relation_candidates:
            cursor.execute("select to_regclass(%s)", [relation])
            result = cursor.fetchone()
            if result and result[0]:
                return relation
    return None


def find_learner_absence_relation(connection) -> str | None:
    return find_existing_relation(connection, LEARNER_ABSENCE_RELATION_CANDIDATES)


def relation_schema_and_table(relation: str) -> tuple[str, str]:
    parts = [part.strip('"') for part in relation.split(".")]
    if len(parts) != 2:
        raise ValueError(f"Expected a schema-qualified relation, got {relation}")
    return parts[0], parts[1]


def quote_sql_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def relation_columns(connection, relation: str) -> dict[str, str]:
    schema, table = relation_schema_and_table(relation)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = %s and table_name = %s
            """,
            [schema, table],
        )
        return {str(row[0]).lower(): str(row[0]) for row in cursor.fetchall()}


def first_existing_column(columns: dict[str, str], *candidates: str) -> str | None:
    for candidate in candidates:
        match = columns.get(candidate.lower())
        if match:
            return match
    return None


def find_learner_absence_relation(connection) -> str | None:
    return find_existing_relation(connection, LEARNER_ABSENCE_RELATION_CANDIDATES)


def fetch_caseload_learner_profiles(owner_email: str) -> list[LearnerProfile | SimpleNamespace]:
    requested_owner = normalize_email(owner_email)
    learner_alias = get_learner_db_alias()
    prefetches = [
        "ksb_assignment__profile_version__definitions",
        "plan_modules__weeks__components",
        "progress_entries__ksb_links",
        "progress_entries__quiz_answers__correct_answers",
        "progress_entries__quiz_answers__chosen_answers",
    ]
    # Legacy relations are prefetched only where they still exist. A queryset
    # prefetch of a dropped table raises before LearnerProfile's own tolerant
    # accessors can fall back, which turned the whole caseload into a 500.
    if learner_ksbs_relation_exists(learner_alias):
        prefetches.insert(0, "assigned_ksbs")
    if learner_activity_events_relation_exists(learner_alias):
        prefetches.append("activity_events")
    queryset = (
        LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
        .filter(coach_email_key=requested_owner)
        .prefetch_related(*prefetches)
        .order_by("full_name", "id")
    )
    rows = [
        row
        for row in queryset
        if clean_text(row.username)
    ]
    commercial_rows, enrolment_rows = fetch_source_schedule_rows(rows)
    for row in rows:
        setattr(
            row,
            "_caseload_source",
            resolve_caseload_source_row(
                row,
                commercial_rows=commercial_rows,
                enrolment_rows=enrolment_rows,
            ),
        )
    return rows


def fetch_caseload_dashboard_profiles(owner_email: str) -> list[LearnerProfile]:
    """Return a lean learner snapshot for the coach dashboard first paint."""
    requested_owner = normalize_email(owner_email)
    queryset = (
        LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
        .filter(coach_email_key=requested_owner)
        .only(
            "id",
            "full_name",
            "email",
            "programme",
            "programme_status",
            "cohort",
            "group_name",
            "completed_hours",
            "target_hours",
            "minimum_hours",
            "planned_hours",
            "progress_hours",
            "progress_variance",
            "otjh_status",
            "coach_name",
            "coach_email",
            "coach_rag",
            "start_date",
            "end_date",
            "gateway_review_date",
        )
        .order_by("full_name", "id")
    )
    return [row for row in queryset if clean_text(row.username)]


def fetch_attendance_caseload_rows(owner_email: str) -> list[LearnerProfile]:
    requested_owner = normalize_email(owner_email)
    queryset = (
        LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
        .filter(coach_email_key=requested_owner)
        .only(
            "id",
            "full_name",
            "email",
            "programme",
            "programme_status",
            "cohort",
            "group_name",
            "completed_hours",
            "target_hours",
            "minimum_hours",
            "planned_hours",
            "lifecycle_status",
            "coach_name",
            "coach_email",
        )
        .order_by("full_name", "id")
    )
    rows: list[LearnerProfile] = []
    for row in queryset:
        if not clean_text(row.username):
            continue
        if normalize_program_status(get_lms_row_program_status(row)) not in ATTENDANCE_INCLUDED_STATUSES:
            continue
        rows.append(row)
    return rows


def fetch_owner_active_learner_profiles(owner_email: str) -> list[LearnerProfile]:
    requested_owner = normalize_email(owner_email)
    queryset = (
        LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
        .filter(lifecycle_status="active", coach_email_key=requested_owner)
        .only(
            "id",
            "full_name",
            "email",
            "programme",
            "cohort",
            "group_name",
            "coach_name",
            "coach_email",
            "start_date",
            "end_date",
            "gateway_review_date",
            "minimum_hours",
            "planned_hours",
            "completed_hours",
            "target_hours",
            "otjh_status",
            "programme_status",
            "lifecycle_status",
        )
        .order_by("full_name", "id")
    )
    return [row for row in queryset if clean_text(row.username)]


def fetch_source_schedule_rows(
    learners: list[LearnerProfile | SimpleNamespace],
) -> tuple[dict[int, CommercialUser], dict[int, EnrolmentUser]]:
    """Map profile ids to Created_users source rows using email identity."""
    if not learners:
        return {}, {}

    profile_ids_by_email = {
        normalize_email(getattr(learner, "email", "")): int(learner.id)
        for learner in learners
        if getattr(learner, "id", None) is not None
        and normalize_email(getattr(learner, "email", ""))
    }
    if not profile_ids_by_email:
        return {}, {}

    try:
        source_rows = EnrolmentUser.all_learners.annotate(
            source_email_key=Lower(Trim("email"))
        ).filter(source_email_key__in=profile_ids_by_email)
    except DatabaseError:
        return {}, {}

    commercial_rows = {}
    enrolment_rows = {}
    for row in source_rows:
        profile_id = profile_ids_by_email.get(normalize_email(row.email))
        if profile_id is None:
            continue
        if clean_text(row.learner_type).casefold() == "commercial":
            commercial_rows[profile_id] = row
        else:
            enrolment_rows[profile_id] = row
    return commercial_rows, enrolment_rows


def profile_prefers_apprenticeship_source(profile: LearnerProfile | SimpleNamespace) -> bool:
    programme = clean_text(getattr(profile, "programme", "")).casefold()
    lifecycle = clean_text(getattr(profile, "lifecycle_status", "")).casefold()
    return "apprentice" in programme or programme.startswith("apm") or lifecycle == "onboarding"


def resolve_caseload_source_row(
    learner: LearnerProfile | SimpleNamespace,
    *,
    commercial_rows: dict[int, CommercialUser] | None = None,
    enrolment_rows: dict[int, EnrolmentUser] | None = None,
) -> CommercialUser | EnrolmentUser | None:
    learner_id = getattr(learner, "id", None)
    if learner_id is None:
        return None
    if commercial_rows is None and enrolment_rows is None:
        commercial_rows, enrolment_rows = fetch_source_schedule_rows([learner])
    commercial_rows = commercial_rows or {}
    enrolment_rows = enrolment_rows or {}
    commercial_row = commercial_rows.get(learner_id)
    enrolment_row = enrolment_rows.get(learner_id)
    if profile_prefers_apprenticeship_source(learner):
        return enrolment_row or commercial_row
    return commercial_row or enrolment_row


def learner_calendar_source_identity(
    learner: LearnerProfile | SimpleNamespace,
    *,
    commercial_rows: dict[int, CommercialUser] | None = None,
    enrolment_rows: dict[int, EnrolmentUser] | None = None,
) -> tuple[str, int] | None:
    source = resolve_caseload_source_row(
        learner,
        commercial_rows=commercial_rows,
        enrolment_rows=enrolment_rows,
    )
    if source is None or not getattr(source, "id", None):
        return None
    kind = "commercial" if clean_text(getattr(source, "learner_type", "")).casefold() == "commercial" else "apprenticeship"
    return kind, int(source.id)


def coach_learner_personal_calendar_conflicts(
    learner: LearnerProfile | SimpleNamespace,
    scheduled_date: date,
    scheduled_time: time,
    duration_minutes: int,
    timezone_offset_minutes: int = 0,
) -> bool:
    identity = learner_calendar_source_identity(learner)
    if not identity:
        return False
    kind, source_id = identity
    return personal_calendar_booking_conflicts(
        kind,
        source_id,
        scheduled_date,
        scheduled_time,
        duration_minutes,
        timezone_offset_minutes,
    )


def refresh_caseload_learner_ksb_snapshot(row: LearnerProfile | SimpleNamespace) -> None:
    if not callable(getattr(row, "save", None)):
        return
    source = getattr(row, "_caseload_source", None) or resolve_caseload_source_row(row)
    if source is None:
        return
    try:
        refresh_learner_ksb_snapshot(row, source, training_plan=getattr(row, "training_plan", None))
        prefetched = getattr(row, "_prefetched_objects_cache", None)
        if isinstance(prefetched, dict):
            prefetched.pop("assigned_ksbs", None)
    except Exception as exc:
        logger.warning(
            "Could not refresh live KSB snapshot for learner %s: %s",
            getattr(row, "id", None),
            exc,
        )


def resolve_schedule_window(
    learner_id: int,
    commercial_rows: dict[int, CommercialUser],
    enrolment_rows: dict[int, EnrolmentUser],
    learner: LearnerProfile | None = None,
) -> tuple[date | None, date | None]:
    commercial_row = commercial_rows.get(learner_id)
    if commercial_row:
        start_value = getattr(commercial_row, "start_date", None)
        end_value = getattr(commercial_row, "end_date", None)
    else:
        enrolment_row = enrolment_rows.get(learner_id)
        start_value = getattr(enrolment_row, "start_date", None) if enrolment_row else None
        end_value = (
            getattr(enrolment_row, "end_date", None)
            or getattr(enrolment_row, "apprenticeship_end_date", None)
            or getattr(enrolment_row, "practical_period_end_date", None)
        ) if enrolment_row else None

    start_value = start_value or getattr(learner, "start_date", None)
    end_value = end_value or getattr(learner, "end_date", None)
    start_date = parse_date_value(start_value)
    end_date = parse_date_value(end_value)
    if isinstance(start_date, datetime):
        start_date = start_date.date()
    if isinstance(end_date, datetime):
        end_date = end_date.date()
    return start_date, end_date


def learner_activity_feed_entries(row: LearnerProfile | SimpleNamespace, *, newest_first: bool = False) -> list[dict]:
    activity_reader = getattr(row, "activity_feed_entries", None)
    if callable(activity_reader):
        return [entry for entry in activity_reader(newest_first=newest_first) if isinstance(entry, dict)]
    return [entry for entry in list_or_empty(getattr(row, "activity_feed", [])) if isinstance(entry, dict)]


def serialize_caseload_learner(
    row: LearnerProfile | SimpleNamespace,
    *,
    refresh_live_snapshots: bool = True,
) -> dict:
    if refresh_live_snapshots:
        refresh_caseload_learner_ksb_snapshot(row)
        if callable(getattr(row, "save", None)) and hasattr(row, "training_plan_progress"):
            try:
                # Keep coach-facing caseload cards aligned with the live learner
                # detail OTJ calculation instead of stale stored snapshot values.
                refresh_learner_otjh_snapshot(row)
            except Exception as exc:
                logger.warning(
                    "Could not refresh live OTJ snapshot for learner %s: %s",
                    getattr(row, "id", None),
                    exc,
                )

    progress_entries = [entry for entry in list_or_empty(row.training_plan_progress) if isinstance(entry, dict)]
    activity_entries = learner_activity_feed_entries(row)
    otjh_completed_entries = build_otjh_completed_entries(progress_entries, activity_entries, row.training_plan)
    planned_components = count_planned_components(row.training_plan)
    completed_components = count_completed_components(progress_entries)
    component_available = planned_components > 0
    component_progress = percentage(completed_components, planned_components) if component_available else 0

    target_hours_value = (
        clean_text(row.target_hours)
        or clean_text(row.minimum_hours)
        or clean_text(row.planned_hours)
    )
    hours_available = bool(clean_text(row.completed_hours) or target_hours_value)
    hours_progress = percentage(row.completed_hours, target_hours_value) if target_hours_value else 0

    target_ksb_lookup = ksb_target_lookup(row.ksbs)
    target_ksb_codes = set(target_ksb_lookup)
    completed_codes = completed_ksb_codes(progress_entries, activity_entries)
    ksb_completed_details = build_ksb_completed_details(
        row.ksbs,
        completed_codes,
        progress_entries,
        activity_entries,
        row.training_plan,
    )
    ksb_available = bool(target_ksb_codes)
    completed_target_codes = completed_codes & target_ksb_codes
    ksb_completed = len(completed_target_codes) if ksb_available else None
    ksb_target = len(target_ksb_codes) if ksb_available else None
    ksb_progress = percentage(ksb_completed, ksb_target) if ksb_available else 0
    ksb_status = derive_ksb_status(ksb_completed, ksb_target)
    ksb_breakdown = summarize_ksb_breakdown(target_ksb_codes, completed_codes)

    progress_variance = clean_text(row.progress_variance)
    otjh_status = clean_text(row.otjh_status)
    program_status = get_lms_row_program_status(row)
    performance_status = determine_active_user_status(
        program_status=program_status,
        otjh_status=otjh_status,
        progress_variance=progress_variance,
        hours_progress=hours_progress,
        hours_available=hours_available,
        ksb_progress=ksb_progress,
        ksb_available=ksb_available,
        component_progress=component_progress,
        component_available=component_available,
    )
    risk_flags = build_active_user_risk_flags(
        otjh_status=otjh_status,
        ksb_status=ksb_status,
        progress_variance=progress_variance,
        hours_progress=hours_progress,
        hours_available=hours_available,
        ksb_progress=ksb_progress,
        ksb_available=ksb_available,
        component_progress=component_progress,
        component_available=component_available,
    )

    cohort_name = clean_text(row.cohort) or "--"
    group_name = clean_text(row.group) or "--"
    cohort_id = re.sub(r"[^a-z0-9]+", "-", cohort_name.lower()).strip("-") or "unassigned"

    return {
        "id": str(row.id),
        "name": clean_text(row.username) or "Unknown learner",
        "initials": build_initials(row.username),
        "employer": "--",
        "cohortId": cohort_id,
        "cohortName": cohort_name,
        "group": group_name,
        "status": performance_status,
        "enrollmentStatus": normalize_program_status(program_status),
        "riskFlags": risk_flags,
        "overallProgress": hours_progress,
        "overallProgressAvailable": hours_available,
        "attendanceRate": component_progress,
        "attendanceRateAvailable": component_available,
        "componentsCompleted": completed_components,
        "componentsPlanned": planned_components,
        "otjhCompleted": to_number(row.completed_hours),
        "otjhTarget": max(to_number(target_hours_value) if target_hours_value else 1, 1),
        "otjhMinimum": to_number(row.minimum_hours),
        "otjhPlanned": to_number(row.planned_hours),
        "otjhCompletedEntries": otjh_completed_entries,
        "otjhCompletedEntryCount": len(otjh_completed_entries),
        "otjhProgressHours": clean_text(row.progress_hours) or "--",
        "otjhStatus": otjh_status,
        "ksbCompleted": ksb_completed,
        "ksbTarget": ksb_target,
        "ksbStatus": ksb_status,
        "ksbProgress": ksb_progress,
        "ksbProgressAvailable": ksb_available,
        "ksbCompletedDetails": ksb_completed_details,
        "ksbCompletedDetailCount": len(ksb_completed_details),
        "knowledgeCompleted": ksb_breakdown["knowledge"]["completed"],
        "knowledgeTarget": ksb_breakdown["knowledge"]["target"],
        "knowledgeProgress": ksb_breakdown["knowledge"]["progress"],
        "skillsCompleted": ksb_breakdown["skills"]["completed"],
        "skillsTarget": ksb_breakdown["skills"]["target"],
        "skillsProgress": ksb_breakdown["skills"]["progress"],
        "behavioursCompleted": ksb_breakdown["behaviours"]["completed"],
        "behavioursTarget": ksb_breakdown["behaviours"]["target"],
        "behavioursProgress": ksb_breakdown["behaviours"]["progress"],
        "evidenceCount": derive_evidence_count(progress_entries, activity_entries),
        "evidenceCompletedCount": derive_completed_evidence_count(progress_entries, activity_entries),
        "evidenceCountAvailable": bool(progress_entries or activity_entries),
        "nextCoaching": "--",
        "nextReview": "--",
        "lastContact": "--",
        "lastAttendanceDate": "--",
        "lastProgressReview": "--",
        "lastReview": "--",
        "lastCoachingSession": "--",
        "lastSubmittedEvidence": "--",
        "recentFlag": risk_flags[0] if risk_flags else None,
        "email": clean_text(row.email) or None,
        "employerEmail": None,
        "employerPhone": None,
        "progressVariance": progress_variance or "--",
        "startDate": format_date(getattr(row, "start_date", None)),
        "gatewayReviewDate": format_date(getattr(row, "gateway_review_date", None)),
        "plannedEndDate": format_date(getattr(row, "end_date", None)),
        "coachName": clean_text(row.coach_name) or None,
        "coachEmail": clean_text(row.coach_email) or None,
        "rawProgramStatus": program_status or "--",
        "coachRag": format_coach_rag_value(getattr(row, "coach_rag", None)),
    }


def serialize_caseload_dashboard_learner(row: LearnerProfile | SimpleNamespace) -> dict:
    """Serialize only the fields the coach dashboard needs immediately."""
    target_hours_value = (
        clean_text(getattr(row, "target_hours", None))
        or clean_text(getattr(row, "minimum_hours", None))
        or clean_text(getattr(row, "planned_hours", None))
    )
    hours_available = bool(clean_text(getattr(row, "completed_hours", None)) or target_hours_value)
    hours_progress = percentage(getattr(row, "completed_hours", None), target_hours_value) if target_hours_value else 0
    otjh_status = clean_text(getattr(row, "otjh_status", None))
    progress_variance = clean_text(getattr(row, "progress_variance", None))
    program_status = get_lms_row_program_status(row)
    performance_status = determine_active_user_status(
        program_status=program_status,
        otjh_status=otjh_status,
        progress_variance=progress_variance,
        hours_progress=hours_progress,
        hours_available=hours_available,
        ksb_progress=0,
        ksb_available=False,
        component_progress=0,
        component_available=False,
    )
    risk_flags = build_active_user_risk_flags(
        otjh_status=otjh_status,
        ksb_status="",
        progress_variance=progress_variance,
        hours_progress=hours_progress,
        hours_available=hours_available,
        ksb_progress=0,
        ksb_available=False,
        component_progress=0,
        component_available=False,
    )
    cohort_name = clean_text(getattr(row, "cohort", None)) or "--"
    group_name = clean_text(getattr(row, "group", None)) or "--"
    programme_name = clean_text(getattr(row, "programme", None)) or cohort_name
    cohort_id = re.sub(r"[^a-z0-9]+", "-", cohort_name.lower()).strip("-") or "unassigned"

    return {
        "id": str(row.id),
        "name": clean_text(row.username) or "Unknown learner",
        "initials": build_initials(row.username),
        "employer": "--",
        "cohortId": cohort_id,
        "cohortName": cohort_name,
        "programme": programme_name,
        "group": group_name,
        "status": performance_status,
        "enrollmentStatus": normalize_program_status(program_status),
        "riskFlags": risk_flags,
        "overallProgress": hours_progress,
        "overallProgressAvailable": hours_available,
        "attendanceRate": 0,
        "attendanceRateAvailable": False,
        "otjhCompleted": to_number(getattr(row, "completed_hours", None)),
        "otjhTarget": max(to_number(target_hours_value) if target_hours_value else 1, 1),
        "otjhMinimum": to_number(getattr(row, "minimum_hours", None)),
        "otjhPlanned": to_number(getattr(row, "planned_hours", None)),
        "otjhProgressHours": clean_text(getattr(row, "progress_hours", None)) or "--",
        "otjhStatus": otjh_status,
        "ksbCompleted": None,
        "ksbTarget": None,
        "ksbStatus": "",
        "ksbProgress": 0,
        "ksbProgressAvailable": False,
        "evidenceCount": 0,
        "evidenceCompletedCount": 0,
        "evidenceCountAvailable": False,
        "nextCoaching": "--",
        "nextReview": "--",
        "lastContact": "--",
        "recentFlag": risk_flags[0] if risk_flags else None,
        "email": clean_text(getattr(row, "email", None)) or None,
        "progressVariance": progress_variance or "--",
        "startDate": format_date(getattr(row, "start_date", None)),
        "gatewayReviewDate": format_date(getattr(row, "gateway_review_date", None)),
        "plannedEndDate": format_date(getattr(row, "end_date", None)),
        "coachName": clean_text(getattr(row, "coach_name", None)) or None,
        "coachEmail": clean_text(getattr(row, "coach_email", None)) or None,
        "rawProgramStatus": program_status or "--",
        "coachRag": format_coach_rag_value(getattr(row, "coach_rag", None)),
    }


def request_prefers_live_caseload_snapshots(request) -> bool:
    """Opt into expensive live KSB/OTJ recalculation when explicitly requested.

    The dashboard and coach list views only need the persisted caseload
    snapshot, so they stay fast by default. Drill-down callers can pass
    `?live=1` when they genuinely need a fresh recomputation.
    """
    return clean_text(request.GET.get("live")).casefold() in {"1", "true", "yes", "on"}


def serialize_attendance_source_learner(row: LearnerProfile) -> dict:
    target_hours_value = (
        clean_text(row.target_hours)
        or clean_text(row.minimum_hours)
        or clean_text(row.planned_hours)
    )
    hours_available = bool(clean_text(row.completed_hours) or target_hours_value)
    hours_progress = percentage(row.completed_hours, target_hours_value) if target_hours_value else 0
    programme_name = clean_text(getattr(row, "programme", None)) or "--"
    cohort_name = clean_text(getattr(row, "cohort", None)) or "--"
    group_name = clean_text(getattr(row, "group", None)) or "--"
    program_status = get_lms_row_program_status(row)

    return {
        "id": str(row.id),
        "name": clean_text(row.username) or "Unknown learner",
        "initials": build_initials(row.username),
        "email": clean_text(row.email) or None,
        "employer": "--",
        "programmeName": programme_name,
        "cohortName": cohort_name,
        "group": group_name,
        "enrollmentStatus": normalize_program_status(program_status),
        "overallProgress": hours_progress,
        "overallProgressAvailable": hours_available,
        "otjhCompleted": to_number(row.completed_hours),
        "otjhTarget": max(to_number(target_hours_value) if target_hours_value else 1, 1),
        "otjhPlanned": to_number(row.planned_hours),
        "ksbProgress": 0,
        "ksbProgressAvailable": False,
        "coachName": clean_text(row.coach_name) or None,
        "coachEmail": clean_text(row.coach_email) or None,
        "rawProgramStatus": program_status or "--",
    }


def parse_month_bounds(value: str | None) -> tuple[date, date, str, str]:
    return validate_month(value)


def date_only(value) -> date | None:
    parsed = parse_date_value(value)
    if isinstance(parsed, datetime):
        return parsed.date()
    return parsed if isinstance(parsed, date) else None


def entry_activity_date(entry: dict) -> date | None:
    for field in ("submittedAt", "at", "completedAt", "startedAt", "date", "createdAt"):
        parsed = date_only(entry.get(field))
        if parsed:
            return parsed
    return None


def entry_is_between(entry: dict, start_date: date, end_date: date) -> bool:
    entry_date = entry_activity_date(entry)
    return bool(entry_date and start_date <= entry_date <= end_date)


def reported_minutes(value) -> float:
    text = clean_text(value)
    if not text:
        return 0.0
    if ":" in text:
        parts = text.split(":")
        try:
            minutes = float(parts[0])
            seconds = float(parts[1]) if len(parts) > 1 else 0.0
            return max(0.0, minutes + seconds / 60.0)
        except (ValueError, IndexError):
            return 0.0

    lower_text = text.lower()
    hour_matches = [float(amount) for amount in re.findall(r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", lower_text)]
    minute_matches = [float(amount) for amount in re.findall(r"(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b", lower_text)]
    if hour_matches or minute_matches:
        return sum(hour_matches) * 60 + sum(minute_matches)

    match = re.search(r"\d+(?:\.\d+)?", lower_text)
    if not match:
        return 0.0
    value = float(match.group(0))
    return value if value > 24 else value * 60


def format_hours_number(hours: float) -> str:
    rounded = round(hours, 1)
    return str(int(rounded)) if rounded == int(rounded) else str(rounded)


def monthly_activity_identity(entry: dict, index: int) -> str:
    entry_date = entry_activity_date(entry)
    date_key = entry_date.isoformat() if entry_date else ""
    key_parts = [
        clean_text(entry.get("kind")),
        clean_text(entry.get("quizId")),
        clean_text(entry.get("componentId")),
        clean_text(entry.get("attempt")),
        date_key,
        clean_text(entry.get("title") or entry.get("action") or entry.get("quizName")),
    ]
    key = "|".join(part for part in key_parts if part)
    return key or f"activity:{index}"


def monthly_activity_dedupe_identity(entry: dict, index: int) -> str:
    entry_date = entry_activity_date(entry)
    date_key = entry_date.isoformat() if entry_date else ""
    key_parts = [
        clean_text(entry.get("kind")),
        clean_text(entry.get("quizId")),
        clean_text(entry.get("componentId")),
        date_key,
    ]
    key = "|".join(part for part in key_parts if part)
    if key:
        return key
    return monthly_activity_identity(entry, index)


def monthly_learning_type(entry: dict) -> str:
    kind = clean_text(entry.get("kind")).lower()
    component_type = clean_text(entry.get("componentType") or entry.get("type")).lower().replace("-", "_")
    if kind == "quiz":
        return "Quiz"
    if kind == "video":
        return "Video"
    if component_type == "assignment":
        return "Assignment"
    if component_type == "podcast":
        return "Audio"
    if component_type == "reading":
        return "Reading"
    if component_type:
        return component_type.replace("_", " ").title()
    if kind == "component":
        return "Component"
    return clean_text(entry.get("action")) or "Activity"


def monthly_learning_title(entry: dict) -> str:
    return (
        clean_text(entry.get("title"))
        or clean_text(entry.get("quizName"))
        or clean_text(entry.get("componentTitle"))
        or monthly_learning_type(entry)
    )


def monthly_learning_detail(entry: dict) -> str:
    detail = clean_text(entry.get("detail"))
    if detail:
        return detail

    reported_time = clean_text(entry.get("reportedTime"))
    grade = entry.get("grade")
    achieved = entry.get("achievedScore")
    total = entry.get("totalScore")
    if achieved not in (None, "") and total not in (None, ""):
        return f"Score {achieved}/{total}"
    if grade not in (None, ""):
        return f"Grade {round(to_number(grade) * 100)}%"
    if reported_time:
        return reported_time
    return clean_text(entry.get("module") or entry.get("week")) or "--"


def curriculum_monthly_target_hours_weeks(training_plan) -> list[list[str]]:
    """Training plan components grouped by week, in plan order.

    A learner's plan is a flat sequence of weeks (module order, then week order
    within it) with no date of its own. Split out from
    `curriculum_monthly_target_hours` so callers can collect component ids
    across many learners and fetch `expected_otjh` in one batched query instead
    of one per learner.
    """
    weeks: list[list[str]] = []
    for module in list_or_empty(training_plan):
        if not isinstance(module, dict):
            continue
        for week in list_or_empty(module.get("weeks")):
            if not isinstance(week, dict):
                continue
            component_ids = [
                training_plan_component_id(component)
                for component in list_or_empty(week.get("components"))
                if isinstance(component, dict) and training_plan_component_id(component)
            ]
            weeks.append(component_ids)
    return weeks


def training_plan_has_components(training_plan) -> bool:
    return any(component_ids for component_ids in curriculum_monthly_target_hours_weeks(training_plan))


def monthly_target_training_plan(row: LearnerProfile | SimpleNamespace):
    plan = getattr(row, "training_plan", None)
    if training_plan_has_components(plan):
        return plan

    source = getattr(row, "_caseload_source", None)
    if source is None:
        return plan

    try:
        hydrated = hydrate_source_training_plan(source)
    except Exception as exc:
        logger.warning(
            "Could not hydrate monthly target training plan for learner %s: %s",
            getattr(row, "id", None),
            exc,
        )
        return plan

    if training_plan_has_components(hydrated):
        try:
            setattr(row, "training_plan", hydrated)
        except Exception:
            pass
        return hydrated
    return plan


def training_plan_component_id(component: dict) -> str:
    return clean_text(
        component.get("componentId")
        or component.get("component_id")
        or component.get("id")
    )


def training_plan_expected_otjh_lookup(training_plan) -> dict[str, float]:
    lookup: dict[str, float] = {}
    for module in list_or_empty(training_plan):
        if not isinstance(module, dict):
            continue
        for week in list_or_empty(module.get("weeks")):
            if not isinstance(week, dict):
                continue
            for component in list_or_empty(week.get("components")):
                if not isinstance(component, dict):
                    continue
                component_id = training_plan_component_id(component)
                expected = component.get("expectedOtjh")
                if expected in (None, ""):
                    expected = component.get("expected_otjh")
                if not component_id or expected in (None, ""):
                    continue
                try:
                    lookup[component_id] = float(expected)
                except (TypeError, ValueError):
                    continue
    return lookup


def curriculum_monthly_target_hours(
    training_plan,
    learner_start_date: date | None,
    start_date: date,
    end_date: date,
    expected_by_id: dict[str, float],
) -> float:
    """The learner's own planned OTJH for one month, read off their training plan.

    A week's components count toward the month whose [start_date, end_date]
    window contains that week's start. This is an estimate, not the authored
    calendar: weeks are assumed contiguous with no gaps for holidays or breaks.

    `expected_by_id` is a pre-fetched, batched lookup (see
    `curriculum_monthly_target_hours_weeks` and `curriculum_expected_otjh_by_component_id`)
    — this function does no DB work of its own.
    """
    raw_weeks = [
        week
        for module in list_or_empty(training_plan)
        if isinstance(module, dict)
        for week in list_or_empty(module.get("weeks"))
        if isinstance(week, dict)
    ]
    if not raw_weeks:
        return 0.0

    plan_expected_by_id = training_plan_expected_otjh_lookup(training_plan)
    total_hours = 0.0
    for index, week in enumerate(raw_weeks):
        explicit_start = parse_date_value(
            week.get("startDate") or week.get("start_date") or week.get("weekStart") or week.get("week_start")
        )
        if isinstance(explicit_start, datetime):
            explicit_start = explicit_start.date()
        # Prefer authored curriculum week dates. Older plans have no dates, so
        # retain the contiguous-week calculation from the learner start date;
        # when that is also absent, anchor week 1 to the requested month.
        week_start = explicit_start or (
            (learner_start_date or start_date) + timedelta(weeks=index)
        )
        if not (start_date <= week_start <= end_date):
            continue
        component_ids = [
            training_plan_component_id(component)
            for component in list_or_empty(week.get("components"))
            if isinstance(component, dict) and training_plan_component_id(component)
        ]
        total_hours += sum(
            expected_by_id.get(component_id, plan_expected_by_id.get(component_id, 0.0))
            for component_id in component_ids
        )
    return round(total_hours, 1)


def monthly_target_start_date(row: LearnerProfile | SimpleNamespace) -> date | None:
    source = getattr(row, "_caseload_source", None)
    start_value = getattr(source, "start_date", None) if source is not None else None
    start_value = start_value or getattr(row, "start_date", None)
    start_date = parse_date_value(start_value)
    if isinstance(start_date, datetime):
        return start_date.date()
    return start_date


def training_plan_component_lookup(training_plan) -> dict[str, dict[str, str]]:
    lookup: dict[str, dict[str, str]] = {}
    for module in list_or_empty(training_plan):
        if not isinstance(module, dict):
            continue
        module_title = clean_text(module.get("moduleTitle") or module.get("module"))
        for week in list_or_empty(module.get("weeks")):
            if not isinstance(week, dict):
                continue
            week_title = clean_text(week.get("weekTitle") or week.get("week"))
            for component in list_or_empty(week.get("components")):
                if not isinstance(component, dict):
                    continue
                component_id = training_plan_component_id(component)
                if not component_id:
                    continue
                lookup[component_id] = {
                    "module": module_title,
                    "week": week_title,
                    "title": clean_text(component.get("componentTitle") or component.get("title")),
                    "expectedOtjh": component.get("expectedOtjh") or component.get("expected_otjh"),
                }
    return lookup


def curriculum_expected_otjh_by_component_id(component_ids: list[str]) -> dict[str, float]:
    ids = sorted({clean_text(component_id) for component_id in component_ids if clean_text(component_id)})
    if not ids:
        return {}
    for alias in ("default", "enrolment"):
        try:
            with connections[alias].cursor() as cur:
                cur.execute(
                    "SELECT id, expected_otjh FROM curriculum.components WHERE id = ANY(%s)",
                    [ids],
                )
                values = {
                    component_id: float(expected)
                    for component_id, expected in cur.fetchall()
                    if expected is not None
                }
                if values:
                    return values
        except DatabaseError as exc:
            logger.warning("Could not look up component expected_otjh on %s: %s", alias, exc)
    return {}


def component_expected_otjh_hours(component_id: str, component_meta: dict, expected_by_id: dict[str, float], progress_entry: dict | None = None) -> float | None:
    if isinstance(progress_entry, dict):
        snapshot_expected = progress_entry.get("expectedOtjh") or progress_entry.get("expected_otjh")
        if snapshot_expected not in (None, ""):
            try:
                return float(snapshot_expected)
            except (TypeError, ValueError):
                pass
    if component_id in expected_by_id:
        return expected_by_id[component_id]
    expected = component_meta.get("expectedOtjh")
    if expected in (None, ""):
        return None
    try:
        return float(expected)
    except (TypeError, ValueError):
        return None


def build_otjh_completed_entries(
    progress_entries: list[dict],
    activity_entries: list[dict],
    training_plan,
) -> list[dict]:
    component_lookup = training_plan_component_lookup(training_plan)
    activity_by_quiz: dict[str, dict] = {}
    activity_by_component: dict[str, dict] = {}

    for activity in activity_entries:
        if not isinstance(activity, dict):
            continue
        quiz_id = clean_text(activity.get("quizId"))
        component_id = clean_text(activity.get("componentId"))
        kind = clean_text(activity.get("kind")).lower()
        if quiz_id and quiz_id not in activity_by_quiz:
            activity_by_quiz[quiz_id] = activity
        if component_id:
            keyed_component = f"{kind}:{component_id}" if kind else component_id
            activity_by_component.setdefault(keyed_component, activity)
            activity_by_component.setdefault(component_id, activity)

    entries: list[dict] = []
    expected_by_id = curriculum_expected_otjh_by_component_id([
        clean_text(entry.get("componentId"))
        for entry in progress_entries
        if isinstance(entry, dict)
    ])
    for index, entry in enumerate(dedupe_otjh_progress_records(progress_entries)):
        if not isinstance(entry, dict):
            continue

        kind = clean_text(entry.get("kind")).lower()
        quiz_id = clean_text(entry.get("quizId"))
        component_id = clean_text(entry.get("componentId"))
        component_meta = component_lookup.get(component_id, {})
        expected_hours = component_expected_otjh_hours(component_id, component_meta, expected_by_id, entry)
        minutes = expected_hours * 60 if expected_hours is not None else reported_minutes(entry.get("reportedTime"))
        if minutes <= 0:
            continue

        activity = (
            activity_by_quiz.get(quiz_id)
            if quiz_id
            else activity_by_component.get(f"{kind}:{component_id}") or activity_by_component.get(component_id)
        )
        merged_entry = {
            **(activity or {}),
            **entry,
            "title": (
                clean_text(entry.get("title"))
                or clean_text(entry.get("quizName"))
                or clean_text(entry.get("componentTitle"))
                or clean_text((activity or {}).get("title"))
                or clean_text(component_meta.get("title"))
            ),
            "module": (
                clean_text(entry.get("moduleTitle") or entry.get("module"))
                or clean_text((activity or {}).get("module"))
                or clean_text(component_meta.get("module"))
            ),
            "week": (
                clean_text(entry.get("weekTitle") or entry.get("week"))
                or clean_text((activity or {}).get("week"))
                or clean_text(component_meta.get("week"))
            ),
        }
        recorded_at = (
            clean_text(entry.get("submittedAt"))
            or clean_text((activity or {}).get("at"))
            or clean_text(entry.get("startedAt"))
        )
        entries.append({
            "id": f'{monthly_activity_identity(merged_entry, index)}:{index}',
            "title": monthly_learning_title(merged_entry),
            "typeLabel": monthly_learning_type(merged_entry),
            "kind": kind or "activity",
            "module": clean_text(merged_entry.get("module")) or "--",
            "week": clean_text(merged_entry.get("week")) or "--",
            "reportedTime": clean_text(entry.get("reportedTime")) or "--",
            "hours": round(minutes / 60, 2),
            "completedAt": recorded_at or "",
            "completedDate": format_date(recorded_at or entry_activity_date(entry)),
            "detail": monthly_learning_detail(merged_entry),
            "ksbs": sorted(extract_ksb_codes(entry.get("ksbs"))),
        })

    entries.sort(
        key=lambda item: (
            clean_text(item.get("completedAt")),
            clean_text(item.get("title")),
        ),
        reverse=True,
    )
    return entries


def build_ksb_completed_details(
    target_ksbs,
    completed_codes: set[str],
    progress_entries: list[dict],
    activity_entries: list[dict],
    training_plan,
) -> list[dict]:
    target_lookup = ksb_target_lookup(target_ksbs)
    if not target_lookup:
        return []

    completed_in_target = completed_codes & set(target_lookup)
    details_by_code = {
        code: {
            **target_lookup[code],
            "sources": [],
        }
        for code in completed_in_target
    }
    seen_sources_by_code = {code: set() for code in completed_in_target}

    component_lookup = training_plan_component_lookup(training_plan)
    activity_by_quiz: dict[str, dict] = {}
    activity_by_component: dict[str, dict] = {}

    for activity in activity_entries:
        if not isinstance(activity, dict):
            continue
        quiz_id = clean_text(activity.get("quizId"))
        component_id = clean_text(activity.get("componentId"))
        kind = clean_text(activity.get("kind")).lower()
        if quiz_id and quiz_id not in activity_by_quiz:
            activity_by_quiz[quiz_id] = activity
        if component_id:
            keyed_component = f"{kind}:{component_id}" if kind else component_id
            activity_by_component.setdefault(keyed_component, activity)
            activity_by_component.setdefault(component_id, activity)

    source_entries = [
        ("progress", entry)
        for entry in dedupe_otjh_progress_records(progress_entries)
        if isinstance(entry, dict) and progress_record_counts_as_achieved(entry)
    ]
    source_entries.extend(
        ("activity", entry)
        for entry in activity_entries
        if isinstance(entry, dict) and progress_record_counts_as_achieved(entry)
    )

    for index, (source_kind, entry) in enumerate(source_entries):
        entry_codes = extract_ksb_codes(entry.get("ksbs")) & completed_in_target
        if not entry_codes:
            continue

        kind = clean_text(entry.get("kind")).lower()
        quiz_id = clean_text(entry.get("quizId"))
        component_id = clean_text(entry.get("componentId"))
        activity = (
            activity_by_quiz.get(quiz_id)
            if quiz_id
            else activity_by_component.get(f"{kind}:{component_id}") or activity_by_component.get(component_id)
        )
        if source_kind == "activity":
            activity = None

        component_meta = component_lookup.get(component_id, {})
        merged_entry = {
            **(activity or {}),
            **entry,
            "title": (
                clean_text(entry.get("title"))
                or clean_text(entry.get("quizName"))
                or clean_text(entry.get("componentTitle"))
                or clean_text((activity or {}).get("title"))
                or clean_text(component_meta.get("title"))
            ),
            "module": (
                clean_text(entry.get("moduleTitle") or entry.get("module"))
                or clean_text((activity or {}).get("module"))
                or clean_text(component_meta.get("module"))
            ),
            "week": (
                clean_text(entry.get("weekTitle") or entry.get("week"))
                or clean_text((activity or {}).get("week"))
                or clean_text(component_meta.get("week"))
            ),
        }
        recorded_at = (
            clean_text(entry.get("submittedAt"))
            or clean_text((activity or {}).get("at"))
            or clean_text(entry.get("startedAt"))
            or clean_text(entry.get("at"))
        )
        minutes = reported_minutes(entry.get("reportedTime"))
        source_key = activity_completion_key(merged_entry, index)
        source = {
            "id": source_key,
            "title": monthly_learning_title(merged_entry),
            "typeLabel": monthly_learning_type(merged_entry),
            "kind": kind or "activity",
            "module": clean_text(merged_entry.get("module")) or "--",
            "week": clean_text(merged_entry.get("week")) or "--",
            "reportedTime": clean_text(entry.get("reportedTime")) or "--",
            "hours": round(minutes / 60, 2) if minutes > 0 else None,
            "completedAt": recorded_at or "",
            "completedDate": format_date(recorded_at or entry_activity_date(entry)),
            "detail": monthly_learning_detail(merged_entry),
        }

        for code in entry_codes:
            seen_sources = seen_sources_by_code[code]
            if source_key in seen_sources:
                continue
            seen_sources.add(source_key)
            details_by_code[code]["sources"].append(source)

    details = sorted(details_by_code.values(), key=lambda item: ksb_sort_key(item["code"]))
    for item in details:
        item["sources"].sort(
            key=lambda source: (
                clean_text(source.get("completedAt")),
                clean_text(source.get("title")),
            ),
            reverse=True,
        )
    return details


def monthly_learning_tone(entry: dict) -> str:
    kind = clean_text(entry.get("kind")).lower()
    if is_evidence_entry(entry):
        return "emerald"
    if kind == "quiz":
        return "amber"
    if kind == "video":
        return "red"
    return "primary"


def monthly_status_label(status: str) -> str:
    value = clean_text(status).lower()
    if value == CoachCalendarEvent.STATUS_NOT_SCHEDULED:
        return "Needs schedule"
    if value == CoachCalendarEvent.STATUS_IN_PROGRESS:
        return "In progress"
    return value.replace("-", " ").title() if value else "--"


def monthly_event_is_unscheduled(status: str) -> bool:
    value = clean_text(status).lower().replace("_", "-")
    return value in {
        CoachCalendarEvent.STATUS_NOT_SCHEDULED,
        "needs-schedule",
        "need-schedule",
    } or value.replace("-", " ") in {"needs schedule", "need schedule"}


def monthly_event_display_date(event: dict) -> date | None:
    return date_only(event.get("scheduledDate") or event.get("date") or event.get("targetDate"))


def monthly_event_matches_learner(event: dict, learner: dict) -> bool:
    event_learner_id = clean_text(event.get("learnerId"))
    learner_id = clean_text(learner.get("id"))
    if event_learner_id and learner_id and event_learner_id == learner_id:
        return True

    event_email = normalize_email(event.get("email"))
    learner_email = normalize_email(learner.get("email"))
    return bool(event_email and learner_email and event_email == learner_email)


def monthly_event_type_label(event: dict) -> str:
    source = clean_text(event.get("source")).lower()
    if source == "mcr":
        return "MCM"
    if source == "progress-review":
        return "PR"
    if source == CATCH_UP_EVENT_TYPE:
        return "Catch-up"
    if source == "student-support":
        return "Support"
    return clean_text(event.get("title")) or "Session"


def monthly_event_tone(event: dict) -> str:
    status = clean_text(event.get("status")).lower()
    if status == CoachCalendarEvent.STATUS_COMPLETED:
        return "emerald"
    if status == CoachCalendarEvent.STATUS_NOT_SCHEDULED:
        return "amber"
    if status == CoachCalendarEvent.STATUS_CANCELLED:
        return "red"
    return "primary"


def build_monthly_activity_item(
    *,
    item_id: str,
    item_date: date,
    item_type: str,
    title: str,
    detail: str,
    tone: str,
    source: str,
    status: str = "",
    time_label: str = "",
) -> dict:
    return {
        "id": item_id,
        "date": item_date.isoformat(),
        "type": item_type,
        "title": title,
        "detail": detail,
        "tone": tone,
        "source": source,
        "status": status,
        "timeLabel": time_label,
    }


def build_monthly_activity_learner(
    row: LearnerProfile | SimpleNamespace,
    learner: dict,
    events: list[dict],
    start_date: date,
    end_date: date,
    attendance_rows: list[dict] | None = None,
    expected_otjh_by_component_id: dict[str, float] | None = None,
) -> dict:
    progress_entries = [entry for entry in list_or_empty(row.training_plan_progress) if isinstance(entry, dict)]
    activity_entries = learner_activity_feed_entries(row)
    monthly_progress = [entry for entry in progress_entries if entry_is_between(entry, start_date, end_date)]
    monthly_feed = [entry for entry in activity_entries if entry_is_between(entry, start_date, end_date)]
    learner_events = [
        event
        for event in events
        if monthly_event_matches_learner(event, learner)
    ]

    deduped_monthly_progress = dedupe_otjh_progress_records(monthly_progress)
    monthly_hours = round(sum(reported_minutes(entry.get("reportedTime")) for entry in deduped_monthly_progress) / 60, 1)
    quizzes = sum(1 for entry in deduped_monthly_progress if clean_text(entry.get("kind")).lower() == "quiz")
    videos = sum(1 for entry in deduped_monthly_progress if clean_text(entry.get("kind")).lower() == "video")
    components = sum(1 for entry in deduped_monthly_progress if clean_text(entry.get("kind")).lower() == "component")
    reflections = sum(1 for entry in deduped_monthly_progress if clean_text(entry.get("feedback")))
    evidence_keys = {
        monthly_activity_dedupe_identity(entry, index)
        for index, entry in enumerate([*monthly_progress, *monthly_feed])
        if is_evidence_entry(entry)
    }
    monthly_ksb_codes = completed_ksb_codes(deduped_monthly_progress, [])

    active_learner_events = [
        event
        for event in learner_events
        if clean_text(event.get("status")).lower() != CoachCalendarEvent.STATUS_CANCELLED
    ]
    event_sources = [clean_text(event.get("source")).lower() for event in active_learner_events]
    mcm_count = event_sources.count("mcr")
    review_count = event_sources.count("progress-review")
    catchup_count = event_sources.count(CATCH_UP_EVENT_TYPE)
    needs_schedule_count = sum(
        1 for event in learner_events if monthly_event_is_unscheduled(event.get("status"))
    )
    booked_count = sum(
        1
        for event in learner_events
        if clean_text(event.get("status")).lower()
        in {CoachCalendarEvent.STATUS_SCHEDULED, CoachCalendarEvent.STATUS_IN_PROGRESS, CoachCalendarEvent.STATUS_COMPLETED, "confirmed"}
    )

    activities: list[dict] = []
    seen_activity_keys: set[str] = set()

    for index, event in enumerate(learner_events):
        event_status = clean_text(event.get("status")).lower()
        if monthly_event_is_unscheduled(event_status) or event_status == CoachCalendarEvent.STATUS_CANCELLED:
            continue
        event_date = monthly_event_display_date(event)
        if not event_date:
            continue
        activity_key = f"event:{clean_text(event.get('eventKey') or event.get('id')) or index}"
        seen_activity_keys.add(activity_key)
        activities.append(
            build_monthly_activity_item(
                item_id=activity_key,
                item_date=event_date,
                item_type=monthly_event_type_label(event),
                title=clean_text(event.get("title")) or monthly_event_type_label(event),
                detail=f"{monthly_status_label(clean_text(event.get('status')))} - {clean_text(event.get('timeLabel')) or 'Time TBC'}",
                tone=monthly_event_tone(event),
                source="calendar",
                status=clean_text(event.get("status")),
                time_label=clean_text(event.get("timeLabel")) or "Time TBC",
            )
        )

    for index, entry in enumerate(monthly_feed):
        activity_key = f"feed:{monthly_activity_identity(entry, index)}"
        if activity_key in seen_activity_keys:
            continue
        seen_activity_keys.add(activity_key)
        seen_activity_keys.add(f"learning:{monthly_activity_dedupe_identity(entry, index)}")
        entry_date = entry_activity_date(entry)
        if not entry_date:
            continue
        activities.append(
            build_monthly_activity_item(
                item_id=activity_key,
                item_date=entry_date,
                item_type=monthly_learning_type(entry),
                title=monthly_learning_title(entry),
                detail=monthly_learning_detail(entry),
                tone=monthly_learning_tone(entry),
                source="activity-feed",
            )
        )

    for index, entry in enumerate(monthly_progress):
        identity = monthly_activity_identity(entry, index)
        dedupe_key = f"learning:{monthly_activity_dedupe_identity(entry, index)}"
        if dedupe_key in seen_activity_keys:
            continue
        seen_activity_keys.add(dedupe_key)
        entry_date = entry_activity_date(entry)
        if not entry_date:
            continue
        activities.append(
            build_monthly_activity_item(
                item_id=f"progress:{identity}",
                item_date=entry_date,
                item_type=monthly_learning_type(entry),
                title=monthly_learning_title(entry),
                detail=monthly_learning_detail(entry),
                tone=monthly_learning_tone(entry),
                source="training-plan-progress",
            )
        )

    for index, attendance_row in enumerate(attendance_rows or []):
        session_date = attendance_row.get("session_date")
        if not isinstance(session_date, date) or not (start_date <= session_date <= end_date):
            continue
        status = clean_text(attendance_row.get("attendance_status")).lower()
        activities.append(
            build_monthly_activity_item(
                item_id=f"attendance:{attendance_row.get('session_id')}:{index}",
                item_date=session_date,
                item_type="Attendance",
                title=clean_text(attendance_row.get("session_title")) or "Live session",
                detail="Present" if status == "present" else "Absent",
                tone="emerald" if status == "present" else "red",
                source="attendance",
                status=status,
            )
        )

    activities.sort(key=lambda item: (item["date"], item["title"]), reverse=True)

    needs_action: list[str] = []
    if not monthly_progress:
        needs_action.append("No learning activity this month")
    if mcm_count == 0:
        needs_action.append("Need MCM schedule")
    if review_count == 0:
        needs_action.append("Need PR schedule")
    if not evidence_keys:
        needs_action.append("No evidence this month")
    if monthly_hours <= 0:
        needs_action.append("No OTJH logged")
    if needs_schedule_count:
        needs_action.append(f"{needs_schedule_count} session{'s' if needs_schedule_count != 1 else ''} need schedule")

    otjh_status = clean_text(learner.get("otjhStatus")).lower()
    if otjh_status == "at risk" or len(needs_action) >= 3:
        monthly_status = "at-risk"
    elif needs_action:
        monthly_status = "need-attention"
    else:
        monthly_status = "on-track"

    last_activity = activities[0] if activities else None
    target_training_plan = monthly_target_training_plan(row)
    monthly_target_hours = curriculum_monthly_target_hours(
        target_training_plan,
        monthly_target_start_date(row),
        start_date,
        end_date,
        expected_otjh_by_component_id or {},
    )

    return {
        "id": learner["id"],
        "name": learner["name"],
        "initials": learner["initials"],
        "email": learner.get("email"),
        "cohortName": learner.get("cohortName") or "--",
        "group": learner.get("group") or "--",
        "programme": clean_text(getattr(row, "programme", "")) or learner.get("cohortName") or "--",
        "status": monthly_status,
        "otjhStatus": learner.get("otjhStatus") or "--",
        "lastActivityDate": last_activity["date"] if last_activity else None,
        "lastActivityLabel": last_activity["title"] if last_activity else "--",
        "learning": {
            "total": len(monthly_progress),
            "quizzes": quizzes,
            "videos": videos,
            "components": components,
            "reflections": reflections,
        },
        "coaching": {
            "total": len(active_learner_events),
            "booked": booked_count,
            "needsSchedule": needs_schedule_count,
            "mcm": mcm_count,
            "progressReviews": review_count,
            "catchups": catchup_count,
        },
        "evidence": {
            "submitted": len(evidence_keys),
            "latestDate": next((item["date"] for item in activities if item["type"].lower() == "evidence"), None),
        },
        "ksb": {
            "touched": len(monthly_ksb_codes),
            "codes": sorted(monthly_ksb_codes),
        },
        "otjh": {
            "monthlyHours": monthly_hours,
            "monthlyHoursLabel": f"{format_hours_number(monthly_hours)}h",
            "monthlyTarget": monthly_target_hours,
            "progress": percentage(monthly_hours, monthly_target_hours),
            "completed": learner.get("otjhCompleted") or 0,
            "target": learner.get("otjhTarget") or 0,
        },
        "needsAction": needs_action[:5],
        "activities": activities,
    }


def fetch_evidence_file_queue(owner_email: str) -> tuple[list[dict], list[dict]]:
    active_rows = fetch_caseload_learner_profiles(owner_email)
    caseload_learners = [
        serialize_caseload_learner(row, refresh_live_snapshots=False)
        for row in active_rows
    ]
    caseload_by_id = {
        str(learner["id"]): learner
        for learner in caseload_learners
        if clean_text(learner.get("id"))
    }
    if not caseload_by_id:
        return [], caseload_learners

    connection = connections[get_learner_db_alias()]
    relation = find_existing_relation(connection, LEARNER_EVIDENCE_FILES_RELATION_CANDIDATES)
    if not relation:
        return [], caseload_learners

    columns = relation_columns(connection, relation)
    learner_id_column = first_existing_column(columns, "learner_id", "learnerid", "Learner ID")
    created_at_column = first_existing_column(columns, "created_at", "submitted_at", "uploaded_at", "updated_at")
    if not learner_id_column:
        return [], caseload_learners

    learner_ids = sorted(caseload_by_id.keys(), key=lambda value: int(value) if value.isdigit() else value)
    placeholders = ", ".join(["%s"] * len(learner_ids))
    last_submission_select = (
        f"max({quote_sql_identifier(created_at_column)}) as last_submission"
        if created_at_column
        else "null as last_submission"
    )
    query = f"""
        select
            {quote_sql_identifier(learner_id_column)}::text as learner_id,
            count(*)::int as evidence_count,
            {last_submission_select}
        from {relation}
        where {quote_sql_identifier(learner_id_column)}::text in ({placeholders})
        group by {quote_sql_identifier(learner_id_column)}::text
        order by evidence_count desc, learner_id
    """

    with connection.cursor() as cursor:
        cursor.execute(query, learner_ids)
        rows = cursor.fetchall()

    items = []
    today = date.today()
    for learner_id, evidence_count, last_submission in rows:
        learner = caseload_by_id.get(str(learner_id))
        if not learner:
            continue

        last_submission_date = parse_date_value(last_submission)
        last_submission_day = last_submission_date.date() if isinstance(last_submission_date, datetime) else last_submission_date
        elapsed_days = (today - last_submission_day).days if isinstance(last_submission_day, date) else 0
        count = to_int(evidence_count)
        items.append({
            "id": str(learner_id),
            "learnerId": str(learner_id),
            "learner": learner["name"],
            "initials": learner["initials"],
            "email": learner.get("email"),
            "programme": learner["cohortName"],
            "group": learner["group"],
            "pendingEvidence": count,
            "acceptedEvidence": 0,
            "referredEvidence": 0,
            "totalEvidence": count,
            "lastSubmission": format_date_value(last_submission),
            "lastSubmissionIso": format_iso_date_value(last_submission),
            "isOverdue": elapsed_days > MARKING_OVERDUE_DAYS,
        })

    return items, caseload_learners


def update_learner_coach_rag(learner_id: int, coach_rag: str | None) -> bool:
    return LearnerProfile.objects.filter(id=learner_id).update(coach_rag=coach_rag) > 0


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


def fetch_learner_absence_data(email_keys: list[str]) -> dict:
    """Read fallback attendance summary rows when the legacy absence table exists."""
    """Read the optional legacy summary table when it still exists."""
    unique_email_keys = sorted({normalize_email(email) for email in email_keys if email})
    empty = {"metrics": {}, "records": {}, "trends": {"week": [], "month": [], "year": []}}
    if not unique_email_keys:
        return empty

    connection = connections[router.db_for_read(LearnerAbsence) or "default"]
    relation = find_learner_absence_relation(connection)
    if not relation:
        return empty

    columns = relation_columns(connection, relation)
    email_column = first_existing_column(columns, "learner_email", "email")
    sessions_column = first_existing_column(columns, "sessions")
    present_column = first_existing_column(columns, "present")
    absent_column = first_existing_column(columns, "absent")
    catchup_column = first_existing_column(columns, "catchup")
    if not all([email_column, sessions_column, present_column, absent_column, catchup_column]):
        return empty

    late_column = first_existing_column(columns, "late")
    risk_column = first_existing_column(columns, "risk")
    last_session_date_column = first_existing_column(columns, "last_session_date")
    consecutive_missed_column = first_existing_column(columns, "consecutive_missed")

    selected_aliases: dict[str, str | None] = {
        "learner_email": email_column,
        "sessions": sessions_column,
        "present": present_column,
        "absent": absent_column,
        "catchup": catchup_column,
        "late": late_column,
        "risk": risk_column,
        "last_session_date": last_session_date_column,
        "consecutive_missed": consecutive_missed_column,
    }
    select_columns = [
        f"{quote_sql_identifier(column)} as {quote_sql_identifier(alias)}" if column else f"null as {quote_sql_identifier(alias)}"
        for alias, column in selected_aliases.items()
    ]
    query = f"""
        select {", ".join(select_columns)}
        from {relation}
        where lower(trim({quote_sql_identifier(email_column)}::text)) = any(%s)
    """

    with connection.cursor() as cursor:
        cursor.execute(query, [unique_email_keys])
        result_columns = [column[0] for column in cursor.description]
        rows = [dict(zip(result_columns, row)) for row in cursor.fetchall()]

    metrics: dict[str, dict] = {}
    for row in rows:
        email_key = normalize_email(row["learner_email"])
        metrics[email_key] = {
            "sessions": to_int(row["sessions"]),
            "present": to_int(row["present"]),
            "absent": to_int(row["absent"]),
            "late": to_int(row.get("late")),
            "catchup": to_int(row["catchup"]),
            "risk": clean_text(row.get("risk")) or None,
            "lastSessionDate": format_iso_date(row.get("last_session_date")),
            "lastSession": format_date(row.get("last_session_date")),
            "consecutiveMissed": to_int(row.get("consecutive_missed")),
        }

    trends: dict[str, list[dict]] = {"week": [], "month": [], "year": []}
    trend_groups: dict[str, dict[tuple, dict]] = {"week": {}, "month": {}, "year": {}}
    for row in rows:
        session_date = row.get("last_session_date")
        if not session_date:
            continue
        week_start = session_date - timedelta(days=session_date.weekday())
        group_keys = {
            "week": ((week_start.year, week_start.isocalendar().week), week_start, f"W{week_start.isocalendar().week:02d}"),
            "month": ((session_date.year, session_date.month), session_date.replace(day=1), session_date.strftime("%b %Y")),
            "year": ((session_date.year,), session_date.replace(month=1, day=1), str(session_date.year)),
        }
        for view, (key, period, label) in group_keys.items():
            group = trend_groups[view].setdefault(key, {"period": period, "label": label, "attended": 0, "absent": 0})
            group["attended"] += to_int(row["present"])
            group["absent"] += to_int(row["absent"])

    for view, groups in trend_groups.items():
        for group in sorted(groups.values(), key=lambda item: item["period"]):
            total = group["attended"] + group["absent"]
            trends[view].append({
                "label": group["label"],
                "value": percentage(group["absent"], total),
                "sessionDate": format_iso_date(group["period"]),
                "attended": group["attended"],
                "absent": group["absent"],
                "onBreak": 0,
            })

    return {"metrics": metrics, "records": {}, "trends": trends}


def sync_learner_absence_counts_from_details(learner_ids: list[int], email_keys: list[str]) -> None:
    ids = sorted({int(learner_id) for learner_id in learner_ids if learner_id})
    emails = sorted({normalize_email(email) for email in email_keys if normalize_email(email)})
    if not ids and not emails:
        return

    connection = connections[router.db_for_read(CoachAbsenceReport) or "default"]
    absence_relation = find_learner_absence_relation(connection)
    if not absence_relation:
        return

    detail_relation = find_existing_relation(connection, COACH_ATTENDANCE_DETAILS_RELATION_CANDIDATES)
    if not detail_relation:
        return

    detail_columns = relation_columns(connection, detail_relation)
    learner_id_column = first_existing_column(detail_columns, "learner_id", "learnerid", "Learner ID")
    learner_email_column = first_existing_column(detail_columns, "learner_email", "email", "Email")
    status_column = first_existing_column(detail_columns, "attendance_status", "status", "attendance", "is_present", "present", "attended")
    if not status_column or not any([learner_id_column, learner_email_column]):
        return

    absence_columns = relation_columns(connection, absence_relation)
    absence_learner_id_column = first_existing_column(absence_columns, "learner_id", "learnerid", "Learner ID")
    absence_learner_email_column = first_existing_column(absence_columns, "learner_email", "email", "Email")
    absence_present_column = first_existing_column(absence_columns, "present")
    absence_absent_column = first_existing_column(absence_columns, "absent")
    if not absence_present_column or not absence_absent_column or not any([absence_learner_id_column, absence_learner_email_column]):
        return

    filters = []
    params: list = []
    if learner_id_column and ids:
        placeholders = ", ".join(["%s"] * len(ids))
        filters.append(f"{quote_sql_identifier(learner_id_column)} in ({placeholders})")
        params.extend(ids)
    if learner_email_column and emails:
        filters.append(f"lower(trim({quote_sql_identifier(learner_email_column)}::text)) = any(%s)")
        params.append(emails)
    if not filters:
        return

    learner_id_select = (
        f"{quote_sql_identifier(learner_id_column)} as learner_id"
        if learner_id_column
        else "null as learner_id"
    )
    learner_email_select = (
        f"{quote_sql_identifier(learner_email_column)} as learner_email"
        if learner_email_column
        else "null as learner_email"
    )
    query = f"""
        select
            {learner_id_select},
            {learner_email_select},
            {quote_sql_identifier(status_column)} as attendance_status
        from {detail_relation}
        where {" or ".join(filters)}
    """

    with connection.cursor() as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()

    counts_by_id: dict[int, dict[str, int]] = {}
    counts_by_email: dict[str, dict[str, int]] = {}
    for learner_id_value, learner_email_value, status_value in rows:
        status = normalize_attendance_detail_status(status_value)
        if status not in {"present", "absent"}:
            continue
        learner_id = to_int(learner_id_value)
        email_key = normalize_email(learner_email_value)
        if learner_id:
            counts = counts_by_id.setdefault(learner_id, {"present": 0, "absent": 0})
            counts[status] += 1
        if email_key:
            counts = counts_by_email.setdefault(email_key, {"present": 0, "absent": 0})
            counts[status] += 1

    if not counts_by_id and not counts_by_email:
        return

    with connection.cursor() as cursor:
        if absence_learner_id_column:
            for learner_id, counts in counts_by_id.items():
                cursor.execute(
                    f"""
                    update {absence_relation}
                    set {quote_sql_identifier(absence_present_column)} = %s,
                        {quote_sql_identifier(absence_absent_column)} = %s
                    where {quote_sql_identifier(absence_learner_id_column)} = %s
                    """,
                    [counts["present"], counts["absent"], learner_id],
                )
        if absence_learner_email_column:
            learner_id_guard = (
                f" and {quote_sql_identifier(absence_learner_id_column)} is null"
                if absence_learner_id_column
                else ""
            )
            for email_key, counts in counts_by_email.items():
                cursor.execute(
                    f"""
                    update {absence_relation}
                    set {quote_sql_identifier(absence_present_column)} = %s,
                        {quote_sql_identifier(absence_absent_column)} = %s
                    where lower(trim({quote_sql_identifier(absence_learner_email_column)}::text)) = %s
                    {learner_id_guard}
                    """,
                    [counts["present"], counts["absent"], email_key],
                )


def is_truthy_value(value) -> bool:
    text = clean_text(value).lower()
    return text in {"1", "true", "yes", "y", "completed", "complete", "done"}


def build_attendance_metrics_from_detail_rows(rows: list[dict]) -> dict:
    rows = sorted(
        rows,
        key=lambda item: (
            parse_date_value(item.get("session_date")) or datetime.min,
            clean_text(item.get("session_start_time")),
        ),
        reverse=True,
    )
    present = sum(1 for row in rows if normalize_attendance_detail_status(row.get("attendance_status")) == "present")
    absent = sum(1 for row in rows if normalize_attendance_detail_status(row.get("attendance_status")) == "absent")
    late = sum(1 for row in rows if to_int(row.get("minutes_late")) > 0)
    catchup = sum(1 for row in rows if is_truthy_value(row.get("catchup_completed")))
    absence_reasons: dict[str, int] = {}
    authorised_absent = 0
    unauthorised_absent = 0
    for row in rows:
        if normalize_attendance_detail_status(row.get("attendance_status")) != "absent":
            continue
        reason = clean_text(row.get("absence_reason"))
        if reason and reason.lower() not in {"--", "none", "n/a", "no reason", "no reason provided"}:
            authorised_absent += 1
            label = reason[:80]
        else:
            unauthorised_absent += 1
            label = "No Reason Provided"
        absence_reasons[label] = absence_reasons.get(label, 0) + 1
    last_session_date = None
    for row in rows:
        parsed_date = parse_date_value(row.get("session_date"))
        if parsed_date:
            last_session_date = parsed_date.date() if isinstance(parsed_date, datetime) else parsed_date
            break

    consecutive_missed = 0
    for row in rows:
        status = normalize_attendance_detail_status(row.get("attendance_status"))
        if status == "absent":
            consecutive_missed += 1
        elif status == "present":
            break

    recorded_sessions = present + absent
    attendance_rate = percentage(present, recorded_sessions) if recorded_sessions else None
    return {
        "sessions": len(rows),
        "present": present,
        "absent": absent,
        "late": late,
        "catchup": catchup,
        "authorisedAbsent": authorised_absent,
        "unauthorisedAbsent": unauthorised_absent,
        "absenceReasons": absence_reasons,
        "risk": attendance_risk_from_rate(attendance_rate),
        "lastSessionDate": format_iso_date(last_session_date),
        "lastSession": format_date(last_session_date),
        "consecutiveMissed": consecutive_missed,
    }


def empty_attendance_detail_summary() -> dict:
    return {
        "metrics": {},
        "metricsById": {},
        "records": {},
        "recordsById": {},
        "trends": {"week": [], "month": [], "year": []},
        "rows": [],
    }


def build_attendance_detail_summary_payload(rows: list[dict]) -> dict:
    rows_by_id: dict[int, list[dict]] = {}
    rows_by_email: dict[str, list[dict]] = {}
    for row in rows:
        learner_id = to_int(row.get("learner_id"))
        email_key = normalize_email(row.get("learner_email"))
        if learner_id:
            rows_by_id.setdefault(learner_id, []).append(row)
        if email_key:
            rows_by_email.setdefault(email_key, []).append(row)

    metrics_by_id = {
        learner_id: build_attendance_metrics_from_detail_rows(items)
        for learner_id, items in rows_by_id.items()
    }
    metrics_by_email = {
        email: build_attendance_metrics_from_detail_rows(items)
        for email, items in rows_by_email.items()
    }

    trend_groups: dict[str, dict[tuple, dict]] = {"week": {}, "month": {}, "year": {}}
    for row in rows:
        status = normalize_attendance_detail_status(row.get("attendance_status"))
        if status not in {"present", "absent"}:
            continue
        parsed_date = parse_date_value(row.get("session_date"))
        if not parsed_date:
            continue
        session_date = parsed_date.date() if isinstance(parsed_date, datetime) else parsed_date
        week_start = session_date - timedelta(days=session_date.weekday())
        group_keys = {
            "week": ((week_start.year, week_start.isocalendar().week), week_start, f"W{week_start.isocalendar().week:02d}"),
            "month": ((session_date.year, session_date.month), session_date.replace(day=1), session_date.strftime("%b %Y")),
            "year": ((session_date.year,), session_date.replace(month=1, day=1), str(session_date.year)),
        }
        for view, (key, period, label) in group_keys.items():
            group = trend_groups[view].setdefault(key, {"period": period, "label": label, "attended": 0, "absent": 0})
            if status == "present":
                group["attended"] += 1
            else:
                group["absent"] += 1

    trends: dict[str, list[dict]] = {"week": [], "month": [], "year": []}
    for view, groups in trend_groups.items():
        for group in sorted(groups.values(), key=lambda item: item["period"]):
            total = group["attended"] + group["absent"]
            trends[view].append({
                "label": group["label"],
                "value": percentage(group["absent"], total),
                "sessionDate": format_iso_date(group["period"]),
                "attended": group["attended"],
                "absent": group["absent"],
                "onBreak": 0,
            })

    return {
        "metrics": metrics_by_email,
        "metricsById": metrics_by_id,
        "records": rows_by_email,
        "recordsById": rows_by_id,
        "trends": trends,
        "rows": rows,
    }


def filter_attendance_detail_summary_data(summary_data: dict, learner_ids: list[int], email_keys: list[str]) -> dict:
    ids = {int(learner_id) for learner_id in learner_ids if learner_id}
    emails = {normalize_email(email) for email in email_keys if normalize_email(email)}
    if not ids and not emails:
        return empty_attendance_detail_summary()

    rows = [
        row
        for row in summary_data.get("rows", [])
        if (to_int(row.get("learner_id")) in ids) or (normalize_email(row.get("learner_email")) in emails)
    ]
    return build_attendance_detail_summary_payload(rows)


def fetch_attendance_detail_summary_data(learner_ids: list[int], email_keys: list[str]) -> dict:
    ids = sorted({int(learner_id) for learner_id in learner_ids if learner_id})
    emails = sorted({normalize_email(email) for email in email_keys if normalize_email(email)})
    empty = empty_attendance_detail_summary()
    if not ids and not emails:
        return empty

    rows = fetch_verified_teams_attendance_rows(ids, emails)
    return build_attendance_detail_summary_payload(rows)


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
        "coachEmail": row["owner_email"] or "",
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


def build_caseload_matchers(rows: list[LearnerProfile | SimpleNamespace]) -> tuple[set[str], set[str]]:
    learner_emails: set[str] = set()
    learner_names: set[str] = set()

    for row in rows:
        email = normalize_email(getattr(row, "email", None))
        name = normalize_person_name(getattr(row, "username", None))
        if email:
            learner_emails.add(email)
        if name:
            learner_names.add(name)

    return learner_emails, learner_names


def timetable_row_matches_caseload(
    row: dict,
    learner_emails: set[str],
    learner_names: set[str],
) -> bool:
    email = normalize_email(row.get("Email"))
    if email and email in learner_emails:
        return True

    name = normalize_person_name(row.get("FullName"))
    if name and name in learner_names:
        return True

    return False


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
        "notes": f"{label} - {source_status}",
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
    day_taken_slots: dict[str, set[int]] = {}
    for event in events:
        if event.get("isTimeEstimated"):
            continue
        day_taken_slots.setdefault(event["date"], set()).add(int(event["startHour"]))

    for event in sorted(events, key=lambda item: (item["date"], item["type"], item["learner"])):
        if not event.get("isTimeEstimated"):
            continue
        taken_slots = day_taken_slots.setdefault(event["date"], set())
        slot = next(
            (candidate for candidate in TIMETABLE_SCHEDULE_SLOTS if candidate not in taken_slots),
            TIMETABLE_SCHEDULE_SLOTS[len(taken_slots) % len(TIMETABLE_SCHEDULE_SLOTS)],
        )
        event["startHour"] = slot
        event["endHour"] = slot + max(1, round((event.get("durationMinutes") or TIMETABLE_DEFAULT_DURATION_MINUTES) / 60))
        taken_slots.add(int(slot))
    return events


def summarize_timetable_events(events: list[dict], needs_scheduling: int) -> dict:
    completed_events = sum(1 for event in events if event["status"] == "completed")
    scheduled_events = sum(1 for event in events if event["status"] == "scheduled")
    in_progress_events = sum(1 for event in events if event["status"] == "in-progress")
    total_events = len(events)

    return {
        "totalEvents": total_events,
        "completedEvents": completed_events,
        "scheduledEvents": scheduled_events,
        "inProgressEvents": in_progress_events,
        "needsScheduling": needs_scheduling,
        "completionRate": percentage(completed_events, total_events),
        "coachingEvents": sum(1 for event in events if event["type"] == "coaching"),
        "reviewEvents": sum(1 for event in events if event["type"] == "review"),
        "supportEvents": sum(1 for event in events if event["type"] == "welfare"),
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
                "catchUp": summarize_timetable_events(
                    [event for event in events if event["source"] == CATCH_UP_EVENT_TYPE],
                    source_needs_scheduling.get(CATCH_UP_EVENT_TYPE, 0),
                ),
            },
            "timeAvailability": "Times are not available in MCR/progress_review; events are shown as Time TBC.",
            "sourceCounts": source_counts,
        }
    )
    return summary


def iterate_generated_schedule_dates(
    start_date: date,
    end_date: date,
    interval: timedelta,
    *,
    range_start: date | None = None,
    range_end: date | None = None,
):
    current = start_date + interval
    sequence = 1
    if range_start and current < range_start:
        interval_days = max(int(interval.days), 1)
        skipped_steps = max((range_start - current).days // interval_days, 0)
        if skipped_steps:
            current += interval * skipped_steps
            sequence += skipped_steps
        while current < range_start:
            current += interval
            sequence += 1
    while current <= end_date:
        if range_end and current > range_end:
            break
        yield sequence, current
        current += interval
        sequence += 1


def generated_event_priority(status: str, target_date: date, display_date: date) -> str:
    today = datetime.utcnow().date()
    if status == CoachCalendarEvent.STATUS_NOT_SCHEDULED and target_date < today:
        return "high"
    if status in {CoachCalendarEvent.STATUS_SCHEDULED, CoachCalendarEvent.STATUS_IN_PROGRESS} and display_date <= today:
        return "high"
    return "normal"


def build_learner_profile_map(rows: list[LearnerProfile]) -> dict[int, LearnerProfile]:
    learner_profile_map: dict[int, LearnerProfile] = {}
    for row in rows:
        try:
            learner_id = int(getattr(row, "id", 0) or 0)
        except (TypeError, ValueError):
            continue
        if learner_id > 0:
            learner_profile_map[learner_id] = row
    return learner_profile_map


def fetch_owner_name(owner_email: str, fallback: str = "Coach") -> str:
    staff_name = coach_staff_display_name(owner_email)
    if staff_name:
        return staff_name
    active_rows = fetch_owner_active_learner_profiles(owner_email)
    return next(
        (clean_text(row.coach_name) for row in active_rows if clean_text(row.coach_name)),
        fallback,
    )


def calendar_record_has_launch_url(record: CoachCalendarEvent) -> bool:
    return bool(clean_text(record.meeting_link) or clean_text(record.graph_web_link))


TEAMS_SYNC_PERMISSION_MESSAGE = (
    "Teams calendar sync needs updated Microsoft permissions. "
    "The event was saved locally only; reconnect Microsoft Calendar or ask an admin to refresh access."
)
TEAMS_SYNC_NOT_CONFIGURED_MESSAGE = "Teams calendar sync is not configured. The event was saved locally only."
# A coach session is recorded and transcribed like a taught one: the recording is
# the learner's catch-up route and the transcript is what the audit trail reads.
# A calendar event alone only ever opens at the tenant defaults -- nothing
# recording, nothing transcribed -- so every event this app creates has these
# applied to the Teams meeting behind it.
COACH_MEETING_RECORDING = "record-transcribe"
COACH_MEETING_LOBBY_BYPASS = "invited"
TEAMS_SYNC_TEMPORARY_MESSAGE = (
    "Teams calendar sync could not be completed. "
    "The event was saved locally only; try again later or ask an admin to check Microsoft permissions."
)
TEAMS_SYNC_LINK_MISSING_MESSAGE = (
    "Teams did not return a meeting link, so this event was moved back to Needs Schedule. "
    "Try scheduling again after Microsoft sync is available."
)


def public_graph_sync_warning(raw_message: str | None) -> str:
    """Convert low-level Microsoft Graph errors into safe coach-facing copy."""
    message = clean_text(raw_message)
    if not message:
        return ""
    lowered = message.casefold()
    if "credentials are not configured" in lowered:
        return TEAMS_SYNC_NOT_CONFIGURED_MESSAGE
    if "erroraccessdenied" in lowered or "access is denied" in lowered or " 403 " in f" {lowered} ":
        return TEAMS_SYNC_PERMISSION_MESSAGE
    if "did not return a teams meeting link" in lowered or (
        "did not return" in lowered and "teams" in lowered
    ):
        return TEAMS_SYNC_LINK_MISSING_MESSAGE
    if "microsoft graph" in lowered or "microsoft token" in lowered:
        return TEAMS_SYNC_TEMPORARY_MESSAGE
    return TEAMS_SYNC_TEMPORARY_MESSAGE


def calendar_record_needs_schedule_repair(record: CoachCalendarEvent) -> bool:
    if record.status not in {CoachCalendarEvent.STATUS_SCHEDULED, CoachCalendarEvent.STATUS_IN_PROGRESS}:
        return False
    event_type = clean_text(record.event_type).lower()
    if event_type not in {"mcr", "progress-review", CATCH_UP_EVENT_TYPE}:
        return False
    return not calendar_record_has_launch_url(record)


def repair_calendar_record_to_needs_schedule(
    record: CoachCalendarEvent,
    *,
    reason: str | None = None,
) -> CoachCalendarEvent:
    default_reason = "Teams meeting details were not stored, so this event has been returned to Needs Schedule."
    if clean_text(record.graph_event_id):
        delete_calendar_event_from_graph(record)

    record.status = CoachCalendarEvent.STATUS_NOT_SCHEDULED
    record.scheduled_date = None
    record.scheduled_time = None
    record.meeting_provider = ""
    record.meeting_link = ""
    record.graph_web_link = ""
    record.graph_event_id = ""
    record.last_graph_sync_error = public_graph_sync_warning(reason) or default_reason
    record.save()
    return record


def normalize_calendar_records(records: list[CoachCalendarEvent]) -> list[CoachCalendarEvent]:
    normalized_records: list[CoachCalendarEvent] = []
    for record in records:
        if calendar_record_needs_schedule_repair(record):
            normalized_records.append(
                repair_calendar_record_to_needs_schedule(
                    record,
                    reason=clean_text(record.last_graph_sync_error),
                )
            )
            continue
        normalized_records.append(record)
    return normalized_records


def build_catchup_note_lines(record: CoachCalendarEvent, target_date: date) -> list[str]:
    lines = [f"Catch-up session managed by the coach. Target date: {format_date(target_date)}."]
    if record.scheduled_date and record.scheduled_time:
        lines.append(
            f"Scheduled for {format_date(record.scheduled_date)} at {record.scheduled_time.strftime('%H:%M')}."
        )
    if clean_text(record.notes):
        lines.append(clean_text(record.notes))
    sync_warning = public_graph_sync_warning(record.last_graph_sync_error)
    if sync_warning:
        lines.append(f"Microsoft sync warning: {sync_warning}")
    return lines


def build_catchup_template_event(
    learner: LearnerProfile,
    *,
    owner_email: str,
    owner_name: str,
) -> dict:
    target_date = date.today()
    learner_name = clean_text(getattr(learner, "username", None)) or "Unknown learner"
    learner_email = clean_text(getattr(learner, "email", None)) or None
    programme = clean_text(getattr(learner, "programme", None)) or "--"
    cohort = clean_text(getattr(learner, "cohort", None)) or "--"

    return {
        "eventKey": build_catchup_template_event_key(owner_email, int(learner.id)),
        "id": build_catchup_template_event_key(owner_email, int(learner.id)),
        "ownerEmail": owner_email,
        "ownerName": owner_name,
        "learnerId": str(learner.id),
        "learner": learner_name,
        "email": learner_email,
        "programme": programme,
        "cohort": cohort,
        "source": CATCH_UP_EVENT_TYPE,
        "sequence": 1,
        "title": "Catch-up Session",
        "type": "coaching",
        "targetDate": target_date.isoformat(),
        "date": target_date.isoformat(),
        "year": target_date.year,
        "month": target_date.month - 1,
        "dayOfMonth": target_date.day,
        "dayOfWeek": target_date.weekday(),
        "startHour": 9,
        "endHour": 10,
        "durationMinutes": TIMETABLE_DEFAULT_DURATION_MINUTES,
        "timeLabel": "Time TBC",
        "isTimeEstimated": True,
        "priority": "normal",
        "status": CoachCalendarEvent.STATUS_NOT_SCHEDULED,
        "sourceStatus": schedule_status_label(CoachCalendarEvent.STATUS_NOT_SCHEDULED),
        "rawPlanned": target_date.isoformat(),
        "rawStatus": schedule_status_label(CoachCalendarEvent.STATUS_NOT_SCHEDULED),
        "notes": "Coach can create a catch-up session for this learner.",
        "scheduledDate": None,
        "scheduledTime": None,
        "meetingProvider": "",
        "meetingLink": "",
        "graphWebLink": "",
        "platform": "--",
        "location": "--",
        "syncWarning": "",
        "schedulerOnly": True,
    }


def build_catchup_calendar_event(
    record: CoachCalendarEvent,
    *,
    owner_name: str | None = None,
    learner: LearnerProfile | None = None,
) -> dict:
    event_type = clean_text(record.event_type).lower() or CATCH_UP_EVENT_TYPE
    event_title = {
        **BOOKED_EVENT_TITLES,
        "live-session": "Live Session",
        "employer-meeting": "Employer Meeting",
        "welfare": "Welfare Session",
        "review": "Review",
    }.get(event_type, event_type.replace("-", " ").title())
    target_date = record.target_date or record.scheduled_date or date.today()
    display_date = record.scheduled_date or target_date
    duration_minutes = record.duration_minutes or TIMETABLE_DEFAULT_DURATION_MINUTES
    meeting_provider = clean_text(record.meeting_provider)
    meeting_link = clean_text(record.meeting_link)
    graph_web_link = clean_text(record.graph_web_link)

    start_time = record.scheduled_time
    start_hour = 9
    end_hour = 10
    time_label = "Time TBC"
    is_time_estimated = True
    if start_time:
        start_hour = start_time.hour + (start_time.minute / 60)
        end_hour = start_hour + (duration_minutes / 60)
        time_label = f"{start_time.strftime('%H:%M')} - {duration_minutes} min"
        is_time_estimated = False

    learner_name = clean_text(record.learner_name) or clean_text(getattr(learner, "username", None)) or "Unknown learner"
    learner_email = clean_text(record.learner_email) or clean_text(getattr(learner, "email", None)) or None
    programme = clean_text(getattr(learner, "programme", None)) or "--"
    cohort = clean_text(getattr(learner, "cohort", None)) or "--"
    event_kind = "welfare" if event_type == "student-support" else ("live-session" if event_type == "live-session" else "coaching")
    note_text = (
        " ".join(build_catchup_note_lines(record, target_date))
        if event_type == CATCH_UP_EVENT_TYPE
        else (
            clean_text(record.notes)
            or ("Support session managed by the coach." if event_type == "student-support" else (f"{event_title} booked by the learner." if event_type in BOOKED_EVENT_TITLES else ""))
        )
    )

    return {
        "eventKey": record.event_key,
        "id": record.event_key,
        "ownerEmail": clean_text(record.owner_email),
        "ownerName": clean_text(owner_name) or clean_text(record.owner_name) or "Med Maher",
        "learnerId": str(record.learner_id),
        "learner": learner_name,
        "email": learner_email,
        "programme": programme,
        "cohort": cohort,
        "source": event_type,
        "sequence": int(record.sequence or 1),
        "title": event_title,
        "type": event_kind,
        "targetDate": target_date.isoformat(),
        "date": display_date.isoformat(),
        "year": display_date.year,
        "month": display_date.month - 1,
        "dayOfMonth": display_date.day,
        "dayOfWeek": display_date.weekday(),
        "startHour": start_hour,
        "endHour": end_hour,
        "durationMinutes": duration_minutes,
        "timeLabel": time_label,
        "isTimeEstimated": is_time_estimated,
        "priority": generated_event_priority(record.status, target_date, display_date),
        "status": record.status,
        "sourceStatus": schedule_status_label(record.status),
        "rawPlanned": target_date.isoformat(),
        "rawStatus": schedule_status_label(record.status),
        "notes": note_text,
        "scheduledDate": record.scheduled_date.isoformat() if record.scheduled_date else None,
        "scheduledTime": format_time_value(record.scheduled_time),
        "meetingProvider": meeting_provider,
        "meetingLink": meeting_link,
        "graphWebLink": graph_web_link,
        "platform": meeting_provider or ("Microsoft Teams" if meeting_link else "--"),
        "location": "Online" if meeting_link else "--",
        "syncWarning": public_graph_sync_warning(record.last_graph_sync_error),
        "operationId": str(record.operation_id),
        "syncState": record.sync_state,
        "syncAttemptCount": record.sync_attempt_count,
    }


def fetch_calendar_event_records(owner_email: str, event_keys: list[str]) -> dict[str, CoachCalendarEvent]:
    if not event_keys:
        return {}

    records = normalize_calendar_records(
        list(
            CoachCalendarEvent.objects.filter(
                owner_email__iexact=owner_email,
                event_key__in=event_keys,
            )
        )
    )
    return {record.event_key: record for record in records}


def fetch_catchup_event_records(owner_email: str) -> list[CoachCalendarEvent]:
    return normalize_calendar_records(
        list(
            CoachCalendarEvent.objects.filter(
                owner_email__iexact=owner_email,
                event_type__iexact=CATCH_UP_EVENT_TYPE,
            ).order_by("scheduled_date", "target_date", "scheduled_time", "learner_name")
        )
    )


def build_catchup_scheduler_events(
    owner_email: str,
    owner_name: str,
    active_rows: list[LearnerProfile],
    learner_profile_map: dict[int, LearnerProfile],
    persisted_records: list[CoachCalendarEvent],
) -> list[dict]:
    scheduler_events = [
        build_catchup_calendar_event(
            record,
            owner_name=owner_name,
            learner=learner_profile_map.get(record.learner_id),
        )
        for record in persisted_records
    ]

    selectable_record_ids: dict[int, bool] = {}
    for record in persisted_records:
        status = clean_text(record.status).lower()
        if status in {CoachCalendarEvent.STATUS_COMPLETED, CoachCalendarEvent.STATUS_IN_PROGRESS, "confirmed"}:
            continue
        selectable_record_ids[record.learner_id] = True

    for learner in active_rows:
        learner_id = int(getattr(learner, "id", 0) or 0)
        if learner_id <= 0 or selectable_record_ids.get(learner_id):
            continue
        scheduler_events.append(
            build_catchup_template_event(
                learner,
                owner_email=owner_email,
                owner_name=owner_name,
            )
        )

    return scheduler_events

def fetch_standalone_event_records(owner_email: str) -> list[CoachCalendarEvent]:
    return normalize_calendar_records(
        list(
            CoachCalendarEvent.objects.filter(owner_email__iexact=owner_email)
            .exclude(event_type__in=["mcr", "progress-review"])
            .order_by("scheduled_date", "target_date", "scheduled_time", "learner_name")
        )
    )


def build_generated_calendar_event(
    *,
    learner: LearnerProfile,
    owner_email: str,
    owner_name: str,
    event_type: str,
    sequence: int,
    target_date: date,
) -> dict:
    source = "mcr" if event_type == "mcr" else "progress-review"
    title = "Monthly Coaching" if event_type == "mcr" else "Progress Review"
    return {
        "eventKey": build_timetable_event_key(learner.id, event_type, sequence, target_date),
        "id": build_timetable_event_key(learner.id, event_type, sequence, target_date),
        "ownerEmail": owner_email,
        "ownerName": owner_name,
        "learnerId": str(learner.id),
        "learner": clean_text(learner.username) or "Unknown learner",
        "email": clean_text(learner.email) or None,
        "programme": clean_text(learner.programme) or "--",
        "cohort": clean_text(learner.cohort) or "--",
        "source": source,
        "sequence": sequence,
        "title": title,
        "type": "coaching" if event_type == "mcr" else "review",
        "targetDate": target_date.isoformat(),
        "date": target_date.isoformat(),
        "year": target_date.year,
        "month": target_date.month - 1,
        "dayOfMonth": target_date.day,
        "dayOfWeek": target_date.weekday(),
        "startHour": 9,
        "endHour": 10,
        "durationMinutes": TIMETABLE_DEFAULT_DURATION_MINUTES,
        "timeLabel": "Time TBC",
        "isTimeEstimated": True,
        "priority": "normal",
        "status": CoachCalendarEvent.STATUS_NOT_SCHEDULED,
        "sourceStatus": "Not Scheduled",
        "meetingProvider": "",
        "meetingLink": "",
        "graphWebLink": "",
        "platform": "--",
        "location": "--",
        "notes": f"Generated from learner start date. Target date: {format_date(target_date)}.",
        "rawPlanned": target_date.isoformat(),
        "rawStatus": "Not Scheduled",
    }


def build_booked_calendar_event(record: CoachCalendarEvent) -> dict:
    """Base event dict for a learner-booked session (catch-up / student-support).

    Unlike mcr / progress-review events these have no generated source row — the
    stored record IS the source, so the base event is rebuilt from it and then
    passed through overlay_calendar_record like any generated event.
    """
    title = BOOKED_EVENT_TITLES.get(record.event_type, "Coaching Session")
    target_date = record.target_date or date.today()
    return {
        "eventKey": record.event_key,
        "id": record.event_key,
        "ownerEmail": record.owner_email,
        "ownerName": record.owner_name,
        "learnerId": str(record.learner_id),
        "learner": clean_text(record.learner_name) or "Unknown learner",
        "email": clean_text(record.learner_email) or None,
        "programme": "--",
        "cohort": "--",
        "source": record.event_type,
        "sequence": record.sequence,
        "title": title,
        "type": BOOKED_EVENT_JSON_TYPES.get(record.event_type, "coaching"),
        "targetDate": target_date.isoformat(),
        "date": target_date.isoformat(),
        "year": target_date.year,
        "month": target_date.month - 1,
        "dayOfMonth": target_date.day,
        "dayOfWeek": target_date.weekday(),
        "startHour": 9,
        "endHour": 10,
        "durationMinutes": record.duration_minutes or TIMETABLE_DEFAULT_DURATION_MINUTES,
        "timeLabel": "Time TBC",
        "isTimeEstimated": True,
        "priority": "normal",
        "status": record.status,
        "sourceStatus": schedule_status_label(record.status),
        "meetingProvider": "",
        "meetingLink": "",
        "graphWebLink": "",
        "platform": "--",
        "location": "--",
        "notes": f"{title} booked by the learner.",
        "rawPlanned": target_date.isoformat(),
        "rawStatus": schedule_status_label(record.status),
    }


def event_note_lines(base_event: dict, record: CoachCalendarEvent | None) -> list[str]:
    if base_event.get("source") in BOOKED_EVENT_TITLES:
        lines = [f"{base_event.get('title') or 'Session'} booked by the learner."]
    else:
        lines = [f"Generated from learner start date. Target date: {format_date(parse_date_value(base_event.get('targetDate')))}."]
    if record and record.scheduled_date and record.scheduled_time:
        lines.append(
            f"Scheduled for {format_date(record.scheduled_date)} at {record.scheduled_time.strftime('%H:%M')}."
        )
    if record and clean_text(record.notes):
        lines.append(clean_text(record.notes))
    sync_warning = public_graph_sync_warning(record.last_graph_sync_error) if record else ""
    if sync_warning:
        lines.append(f"Microsoft sync warning: {sync_warning}")
    return lines


def overlay_calendar_record(base_event: dict, record: CoachCalendarEvent | None) -> dict:
    event = dict(base_event)
    target_date = parse_date_value(base_event.get("targetDate"))
    if isinstance(target_date, datetime):
        target_date = target_date.date()
    if target_date is None:
        target_date = date.today()

    if record and record.scheduled_date:
        display_date = record.scheduled_date
    else:
        display_date = target_date

    start_time = record.scheduled_time if record and record.scheduled_time else None
    duration_minutes = record.duration_minutes if record and record.duration_minutes else TIMETABLE_DEFAULT_DURATION_MINUTES
    start_hour = 9
    end_hour = 10
    time_label = "Time TBC"
    is_time_estimated = True
    if start_time:
        start_hour = start_time.hour + (start_time.minute / 60)
        end_hour = start_hour + (duration_minutes / 60)
        time_label = f"{start_time.strftime('%H:%M')} - {duration_minutes} min"
        is_time_estimated = False

    status = record.status if record else CoachCalendarEvent.STATUS_NOT_SCHEDULED
    meeting_link = clean_text(record.meeting_link) if record else ""
    graph_web_link = clean_text(record.graph_web_link) if record else ""
    meeting_provider = clean_text(record.meeting_provider) if record else ""

    event.update(
        {
            "id": base_event["eventKey"],
            "date": display_date.isoformat(),
            "year": display_date.year,
            "month": display_date.month - 1,
            "dayOfMonth": display_date.day,
            "dayOfWeek": display_date.weekday(),
            "startHour": start_hour,
            "endHour": end_hour,
            "durationMinutes": duration_minutes,
            "timeLabel": time_label,
            "isTimeEstimated": is_time_estimated,
            "status": status,
            "sourceStatus": schedule_status_label(status),
            "rawStatus": schedule_status_label(status),
            "scheduledDate": record.scheduled_date.isoformat() if record and record.scheduled_date else None,
            "scheduledTime": format_time_value(record.scheduled_time) if record else None,
            "meetingProvider": meeting_provider,
            "meetingLink": meeting_link,
            "graphWebLink": graph_web_link,
            "platform": meeting_provider or ("Microsoft Teams" if meeting_link else "--"),
            "location": "Online" if meeting_link else "--",
            "notes": " ".join(event_note_lines(base_event, record)),
            "reviewResponses": record.review_responses if record and isinstance(record.review_responses, dict) else {},
            "reviewCompletedAt": record.review_completed_at.isoformat() if record and record.review_completed_at else None,
            "managerSignedAt": record.manager_signed_at.isoformat() if record and record.manager_signed_at else None,
            "managerSignedBy": clean_text(record.manager_signed_by) if record else "",
            "priority": generated_event_priority(status, target_date, display_date),
            "syncWarning": public_graph_sync_warning(record.last_graph_sync_error) if record else "",
            "operationId": str(record.operation_id) if record else "",
            "syncState": record.sync_state if record else CoachCalendarEvent.SYNC_PENDING,
            "syncAttemptCount": record.sync_attempt_count if record else 0,
        }
    )
    return event


def build_graph_event_payload(record: CoachCalendarEvent, base_event: dict) -> dict:
    settings = get_graph_settings()
    if not record.scheduled_date or not record.scheduled_time:
        raise RuntimeError("Scheduled date and time are required before syncing to Microsoft Graph.")

    start_date_time = datetime.combine(record.scheduled_date, record.scheduled_time).replace(second=0, microsecond=0)
    end_date_time = start_date_time + timedelta(minutes=record.duration_minutes or TIMETABLE_DEFAULT_DURATION_MINUTES)
    learner_name = clean_text(record.learner_name) or "Learner"
    learner_email = clean_text(record.learner_email)
    subject = f"{base_event['title']} - {learner_name}"
    body_lines = [
        f"<p><strong>{base_event['title']}</strong></p>",
        f"<p>Learner: {learner_name}</p>",
    ]
    if base_event.get("source") in BOOKED_EVENT_TITLES:
        # Learner-booked: the owner is being told about a meeting someone else
        # put in their diary, so lead with who booked it and when.
        body_lines.append(f"<p>Booked by the learner for {format_date(record.scheduled_date)} "
                          f"at {record.scheduled_time.strftime('%H:%M')}.</p>")
        if learner_email:
            body_lines.append(f"<p>Learner email: {learner_email}</p>")
        if clean_text(record.notes):
            body_lines.append(f"<p>Notes: {clean_text(record.notes)}</p>")
    else:
        body_lines.append(f"<p>Target date: {format_date(record.target_date)}</p>")

    payload = {
        "subject": subject,
        "start": {
            "dateTime": start_date_time.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": settings["timezone"],
        },
        "end": {
            "dateTime": end_date_time.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": settings["timezone"],
        },
        "body": {
            "contentType": "HTML",
            "content": "".join(body_lines),
        },
        "isOnlineMeeting": True,
        "onlineMeetingProvider": "teamsForBusiness",
    }
    # Microsoft Graph documents transactionId specifically for suppressing
    # redundant event POSTs after an ambiguous client/network timeout. The
    # durable local operation UUID is stable for every retry of this booking.
    if not clean_text(record.graph_event_id) and record.operation_id:
        payload["transactionId"] = str(record.operation_id)
    attendees = []
    if learner_email:
        attendees.append(
            {
                "emailAddress": {
                    "address": learner_email,
                    "name": learner_name,
                },
                "type": "required",
            }
        )

    # The mailbox the event is created on becomes the organizer, and Graph never
    # emails the organizer -- it just appears on their calendar. So for
    # learner-booked sessions the owner is listed as an attendee AND the event is
    # created on the learner's mailbox instead (see graph_organizer_mailbox), or
    # the invite would land on the calendar of the one person who already knows.
    owner_email = clean_text(record.owner_email)
    if base_event.get("source") in BOOKED_EVENT_TITLES and owner_email:
        already_invited = any(
            clean_text(a["emailAddress"]["address"]).casefold() == owner_email.casefold()
            for a in attendees
        )
        if not already_invited:
            attendees.append(
                {
                    "emailAddress": {
                        "address": owner_email,
                        "name": clean_text(record.owner_name) or owner_email,
                    },
                    "type": "required",
                }
            )

    # Drop the organizer from its own attendee list -- Graph would ignore the
    # entry for mail purposes anyway, and leaving it in shows the organizer as an
    # invitee of their own meeting.
    organizer = graph_organizer_mailbox(record, base_event).casefold()
    attendees = [
        a for a in attendees
        if clean_text(a["emailAddress"]["address"]).casefold() != organizer
    ]

    if attendees:
        payload["attendees"] = attendees
    return payload


def graph_organizer_mailbox(record: CoachCalendarEvent, base_event: dict) -> str:
    """Which mailbox the Graph event is created on -- i.e. who organizes it.

    Graph never emails the organizer; the meeting just shows up on their
    calendar. Only the other attendees get an invite.

    For coach-scheduled events (mcr / progress-review) the coach is the organizer
    and the learner is mailed -- correct, the coach already knows.

    Learner-booked sessions are the mirror image: the learner initiated it and the
    owner (coach or enrolment officer) is the one who must be told. Creating the
    event on the owner's mailbox would make them the organizer and silently
    deliver no mail, so it is created on the learner's mailbox instead.

    Falls back to the owner when the learner has no address to organize from.
    """
    if base_event.get("source") in BOOKED_EVENT_TITLES:
        learner_email = clean_text(record.learner_email)
        if learner_email:
            return learner_email
    return clean_text(record.owner_email)


def sync_calendar_event_to_graph(record: CoachCalendarEvent, base_event: dict) -> str:
    if not has_graph_credentials():
        record.meeting_provider = ""
        record.meeting_link = ""
        record.graph_web_link = ""
        return TEAMS_SYNC_NOT_CONFIGURED_MESSAGE

    payload = build_graph_event_payload(record, base_event)
    organizer_mailbox = graph_organizer_mailbox(record, base_event)
    owner_key = urllib_parse.quote(organizer_mailbox, safe="")
    try:
        if clean_text(record.graph_event_id):
            event_key = urllib_parse.quote(record.graph_event_id, safe="")
            response = microsoft_graph_request(
                "PATCH",
                f"users/{owner_key}/events/{event_key}",
                payload=payload,
            )
            if not response:
                response = microsoft_graph_request(
                    "GET",
                    f"users/{owner_key}/events/{event_key}",
                )
        else:
            response = microsoft_graph_request(
                "POST",
                f"users/{owner_key}/events",
                payload=payload,
            )
    except RuntimeError as exc:
        logger.exception("Unable to sync coach timetable event to Microsoft Graph")
        record.meeting_provider = ""
        record.meeting_link = ""
        record.graph_web_link = ""
        return public_graph_sync_warning(str(exc))

    response_event_id = clean_text(response.get("id")) or clean_text(record.graph_event_id)
    online_meeting = response.get("onlineMeeting") or {}
    response_web_link = clean_text(response.get("webLink"))
    response_join_url = clean_text(online_meeting.get("joinUrl"))

    if response_event_id and not (response_join_url or response_web_link):
        event_key = urllib_parse.quote(response_event_id, safe="")
        try:
            refreshed_response = microsoft_graph_request(
                "GET",
                f"users/{owner_key}/events/{event_key}",
            )
        except RuntimeError:
            refreshed_response = {}

        if refreshed_response:
            response = refreshed_response
            online_meeting = response.get("onlineMeeting") or {}
            response_event_id = clean_text(response.get("id")) or response_event_id
            response_web_link = clean_text(response.get("webLink"))
            response_join_url = clean_text(online_meeting.get("joinUrl"))

    record.graph_event_id = response_event_id
    record.graph_organizer_email = organizer_mailbox if response_event_id else ""
    record.meeting_provider = "Microsoft Teams" if (response_event_id or response_join_url or response_web_link) else ""
    record.meeting_link = response_join_url or response_web_link
    record.graph_web_link = response_web_link

    # The booking is already saved and invited by this point. These options are
    # the difference between a session that records and transcribes itself and one
    # that opens with nothing running, so they are applied on every sync -- Graph
    # hands out a new online meeting whenever the event gets one, at the tenant
    # defaults. A deployment without OnlineMeetings.ReadWrite.All and an
    # application access policy is logged, not surfaced: the meeting itself works.
    if response_join_url:
        applied, _meeting, option_warnings = apply_teams_meeting_options(
            organizer_mailbox,
            response_join_url,
            recording=COACH_MEETING_RECORDING,
            lobby_bypass=COACH_MEETING_LOBBY_BYPASS,
            attendees=[
                clean_text((attendee.get("emailAddress") or {}).get("address"))
                for attendee in payload.get("attendees") or []
            ],
        )
        if not applied:
            logger.warning(
                "Coach Teams meeting created without its recording options: %s",
                "; ".join(clean_text(warning.get("message")) for warning in option_warnings),
            )
    return ""


def delete_calendar_event_from_graph(record: CoachCalendarEvent) -> str:
    if not clean_text(record.graph_event_id) or not has_graph_credentials():
        return ""

    # The event lives on whichever mailbox organized it, which for learner-booked
    # sessions is the learner, not the owner (see graph_organizer_mailbox). Deleting
    # as the organizer is also what makes Graph email the cancellation to attendees.
    mailbox = clean_text(record.graph_organizer_email) or clean_text(record.owner_email)
    owner_key = urllib_parse.quote(mailbox, safe="")
    event_key = urllib_parse.quote(record.graph_event_id, safe="")
    try:
        microsoft_graph_request("DELETE", f"users/{owner_key}/events/{event_key}")
    except RuntimeError as exc:
        logger.exception("Unable to delete coach timetable event from Microsoft Graph")
        return public_graph_sync_warning(str(exc))
    return ""


def cancel_reserved_calendar_event(record: CoachCalendarEvent) -> tuple[CoachCalendarEvent, str]:
    """Persist cancellation intent before deleting the external Graph event."""
    with transaction.atomic():
        current = CoachCalendarEvent.objects.select_for_update().get(pk=record.pk)
        current.sync_state = CoachCalendarEvent.SYNC_CANCELLED
        current.save(update_fields=["sync_state", "updated_at"])

    warning = delete_calendar_event_from_graph(current)
    with transaction.atomic():
        current = CoachCalendarEvent.objects.select_for_update().get(pk=record.pk)
        current.status = CoachCalendarEvent.STATUS_NOT_SCHEDULED
        current.scheduled_date = None
        current.scheduled_time = None
        current.last_graph_sync_error = public_graph_sync_warning(warning)
        if warning:
            # Retain the external identifiers so an operator/retry can reconcile
            # the cancellation instead of silently losing the orphan's address.
            current.sync_state = CoachCalendarEvent.SYNC_RECONCILIATION
        else:
            current.meeting_link = ""
            current.graph_web_link = ""
            current.graph_event_id = ""
            current.graph_organizer_email = ""
            current.meeting_provider = ""
            current.sync_state = CoachCalendarEvent.SYNC_CANCELLED
        current.save()
    return current, warning


def build_live_session_calendar_event(
    row: dict,
    session: dict,
    *,
    programme: str,
    cohort: str,
    group: str,
    owner_email: str,
    owner_name: str,
    week_title: str | None = None,
    tracked_occurrence: dict | None = None,
    tracked_series: dict | None = None,
    component_meeting_link: str = "",
) -> dict:
    tracked_occurrence = tracked_occurrence or {}
    tracked_series = tracked_series or {}
    tracked_start = tracked_occurrence.get("scheduled_start")
    event_date = tracked_start.date().isoformat() if isinstance(tracked_start, datetime) else session["date"]
    session_date = date.fromisoformat(event_date)
    module_name = clean_text(row.get("module_name")) or "Live Session"
    session_title = f"{module_name} — {week_title}" if week_title else f"{module_name} — Week {session['sessionNumber']}"

    schedule_value = clean_text(row.get("session_week_day"))
    fallback_start_text, fallback_end_text = schedule_time_parts(schedule_value)
    start_hour, end_hour, time_label, duration_minutes, is_time_estimated = 9, 10, "Time TBC", TIMETABLE_DEFAULT_DURATION_MINUTES, True
    start_time = parse_time_value(row.get("session_start_time") or fallback_start_text)
    end_time = parse_time_value(row.get("session_end_time") or fallback_end_text)
    if start_time:
        start_hour = start_time.hour + start_time.minute / 60
        is_time_estimated = False
        if end_time:
            end_hour = end_time.hour + end_time.minute / 60
            duration_minutes = max(15, round((end_hour - start_hour) * 60))
        else:
            end_hour = start_hour + duration_minutes / 60
        time_label = f'{start_time.strftime("%H:%M")} - {end_time.strftime("%H:%M")}' if end_time else start_time.strftime("%H:%M")

    meeting_link = (
        clean_text(tracked_occurrence.get("join_url"))
        or clean_text(tracked_series.get("join_url"))
        or clean_text(tracked_series.get("web_link"))
        or clean_text(component_meeting_link)
    )

    return {
        "eventKey": f'live-session-{row.get("id")}-{session["sessionNumber"]}',
        "id": f'live-session-{row.get("id")}-{session["sessionNumber"]}',
        "ownerEmail": owner_email,
        "ownerName": owner_name,
        "learnerId": "",
        "learner": f'{cohort} · {group}' if cohort and group else (group or cohort or module_name),
        "email": None,
        "programme": programme or "--",
        "cohort": cohort or "--",
        "group": group or "--",
        "module": module_name,
        "tutor": clean_text(row.get("Tutor_name")) or "Unassigned",
        "schedule": schedule_value,
        "source": "live-session",
        "sequence": session["sessionNumber"],
        "title": session_title,
        "type": "live-session",
        "targetDate": event_date,
        "date": event_date,
        "year": session_date.year,
        "month": session_date.month - 1,
        "dayOfMonth": session_date.day,
        "dayOfWeek": session_date.weekday(),
        "startHour": start_hour,
        "endHour": end_hour,
        "durationMinutes": duration_minutes,
        "timeLabel": time_label,
        "isTimeEstimated": is_time_estimated,
        "priority": "normal",
        "status": clean_text(tracked_occurrence.get("status")).lower() or "scheduled",
        "sourceStatus": clean_text(tracked_occurrence.get("status")).title() or "Scheduled",
        "meetingProvider": clean_text(tracked_series.get("provider")) or ("Microsoft Teams" if meeting_link else ""),
        "meetingLink": meeting_link,
        "graphWebLink": clean_text(tracked_series.get("web_link")),
        "platform": "Microsoft Teams" if meeting_link else "LMS",
        "location": "Microsoft Teams" if meeting_link else "--",
        "notes": f'{session_title}.',
        "rawPlanned": event_date,
        "rawStatus": clean_text(tracked_occurrence.get("status")).title() or "Scheduled",
    }


def coach_has_live_session_access(owner_email: str) -> bool:
    """Use the enrolment staff access grant as the coach authority.

    Curriculum staff profiles used to gate live sessions through
    ``assigned_group_ids``. Staff identity and workspace access now live in
    enrolment."Staff_users", so the dashboard admits only the staff row whose
    email matches the requested owner and whose Access grant is ``coach``.
    """
    requested_owner = normalize_email(owner_email)
    if not requested_owner:
        return False
    try:
        return (
            StaffUser.objects.annotate(
                staff_email_key=Lower(Trim("email")),
                staff_access_key=Lower(Trim("access")),
            )
            .filter(
                staff_email_key=requested_owner,
                staff_access_key=ACCESS_COACH,
            )
            .exists()
        )
    except DatabaseError:
        return False


def coach_staff_display_name(owner_email: str) -> str:
    requested_owner = normalize_email(owner_email)
    if not requested_owner:
        return ""
    try:
        row = (
            StaffUser.objects.annotate(
                staff_email_key=Lower(Trim("email")),
                staff_access_key=Lower(Trim("access")),
            )
            .filter(
                staff_email_key=requested_owner,
                staff_access_key=ACCESS_COACH,
            )
            .only("username")
            .first()
        )
    except Exception:
        # Display-name lookup is optional; coach data must remain available when
        # the staff database is offline, unavailable in tests, or still on a
        # legacy schema.
        return ""
    return clean_text(getattr(row, "username", None))


def fetch_cohort_selected_holidays(cohort_id: str) -> list[dict]:
    """The holidays actually ticked on a cohort, not every one in its period.

    Curriculum's own generator plans sessions around this same selection, and a
    cohort's end date is extended by it, so reading the wider in-range list here
    would put the coach's calendar on dates the cohort itself never planned.
    """
    for cohort in authoring_fetch_all(
        COHORT_AUTHORING_DETAILS_TABLE,
        'cohort_id = %s',
        [cohort_id],
        ensure_tables=False,
    ):
        return parse_json_value(cohort.get("selected_holidays"), [])
    return []


def collect_live_session_events(
    owner_email: str,
    owner_name: str,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[dict]:
    if not coach_has_live_session_access(owner_email):
        return []

    program_configs_by_id = program_config_by_id(get_program_config_rows())
    weeks_by_module: dict[str, list[dict]] = {}
    for week in authoring_fetch_all(AUTHORING_WEEKS_TABLE, ensure_tables=False):
        module_catalogue_id = clean_text(week.get("module_catalogue_id"))
        if module_catalogue_id:
            weeks_by_module.setdefault(module_catalogue_id, []).append(week)
    component_links_by_week: dict[str, str] = {}
    for component in authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, ensure_tables=False):
        if clean_text(component.get("type")).lower() != "live_session":
            continue
        week_id = clean_text(component.get("week_id"))
        meeting_link = clean_text(component.get("live_sessions_link"))
        if week_id and meeting_link:
            component_links_by_week[week_id] = meeting_link
    holidays_by_cohort_id: dict[str, list[dict]] = {}
    active_series_by_module: dict[str, dict] = {}
    occurrences_by_series_and_number: dict[tuple[str, int], dict] = {}
    try:
        active_series = authoring_fetch_all(
            LIVE_SESSIONS_TABLE,
            "status = %s",
            ["active"],
            "updated_at desc, created_at desc",
            ensure_tables=False,
        )
        for series in active_series:
            module_id = clean_text(series.get("module_catalogue_id"))
            if module_id and module_id not in active_series_by_module:
                active_series_by_module[module_id] = series
        active_series_ids = {clean_text(series.get("id")) for series in active_series}
        for occurrence in authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, ensure_tables=False):
            series_id = clean_text(occurrence.get("live_session_id"))
            if series_id in active_series_ids:
                occurrences_by_series_and_number[
                    (series_id, parse_int(occurrence.get("session_number"), 0))
                ] = occurrence
    except Exception:
        # Calendar dates still work when legacy databases do not have the
        # Teams tracking tables yet.
        active_series_by_module = {}
        occurrences_by_series_and_number = {}
    today = date.today()

    events: list[dict] = []
    # The current curriculum source is the normalized authoring schema. Reading
    # it once avoids the previous duplicate full-table pass and skips DDL checks
    # that belong to deployment/migrations, not a dashboard GET request.
    training_rows = authoring_modules_as_training_rows(ensure_tables=False)
    for row in training_rows:
        if not is_operational_training_row(row):
            continue
        if not clean_text(row.get("module_name")):
            continue
        identity = programme_identity(row, program_configs_by_id)
        programme = identity["name"]
        cohort = actual_cohort_identity(row, programme)
        if not cohort:
            continue
        group = actual_group_identity(row, cohort["id"])
        if not group:
            continue

        module_start = row.get("start_date")
        if not module_start:
            continue

        module_catalogue_id = clean_text(row.get("_meta", {}).get("module_catalogue_id"))
        module_weeks = weeks_by_module.get(module_catalogue_id) or []
        # The stored session count leads: this builds a SESSION calendar, and a
        # module delivered Mon+Thu runs two sessions per authored week, so
        # counting week rows showed the coach half its live sessions.
        session_count = parse_int(row.get("sessions_number"), 0) or len(module_weeks)
        if session_count <= 0:
            continue

        cohort_id = clean_text(row.get("_meta", {}).get("cohort_id"))
        if cohort_id not in holidays_by_cohort_id:
            holidays_by_cohort_id[cohort_id] = fetch_cohort_selected_holidays(cohort_id)
        cohort_holidays = holidays_by_cohort_id[cohort_id]

        delivery_day_name = clean_text(row.get("session_week_day")) or parse_date(module_start).strftime("%A")
        plan = build_module_session_plan(module_start, session_count, delivery_day_name, cohort_holidays)
        if plan["warnings"]:
            continue

        ordered_weeks = sorted(module_weeks, key=lambda week: parse_int(week.get("week_number"), 0))
        delivery_days = delivery_days_per_week(row)
        tracked_series = active_series_by_module.get(module_catalogue_id) or {}
        tracked_series_id = clean_text(tracked_series.get("id"))
        for session in plan["sessions"]:
            tracked_occurrence = occurrences_by_series_and_number.get(
                (tracked_series_id, session["sessionNumber"])
            )
            tracked_start = (tracked_occurrence or {}).get("scheduled_start")
            effective_date = tracked_start.date() if isinstance(tracked_start, datetime) else date.fromisoformat(session["date"])
            if effective_date < today:
                continue
            # Sessions fold into weeks by the delivery days: for a Mon+Thu module
            # sessions 1 and 2 are both taught inside week 1.
            week_index = (session["sessionNumber"] - 1) // delivery_days
            week = ordered_weeks[week_index] if week_index < len(ordered_weeks) else None
            events.append(
                build_live_session_calendar_event(
                    row,
                    session,
                    programme=programme,
                    cohort=cohort["name"],
                    group=group["name"],
                    owner_email=owner_email,
                    owner_name=owner_name,
                    week_title=clean_text(week.get("title")) if week else None,
                    tracked_series=tracked_series,
                    tracked_occurrence=tracked_occurrence,
                    component_meeting_link=clean_text(week.get("id")) and component_links_by_week.get(
                        clean_text(week.get("id")), ""
                    ),
                )
            )

    if start_date or end_date:
        events = [
            event
            for event in events
            if (not start_date or date.fromisoformat(event["date"]) >= start_date)
            and (not end_date or date.fromisoformat(event["date"]) <= end_date)
        ]

    return events


def collect_tracked_live_session_events(
    owner_email: str,
    owner_name: str,
    *,
    start_date: date,
    end_date: date,
) -> list[dict]:
    """Read only already-scheduled live occurrences for the dashboard.

    The full timetable planner expands every authored week and component. That
    is useful on the timetable page, but unnecessarily expensive for the small
    dashboard preview.
    """
    if not coach_has_live_session_access(owner_email):
        return []

    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, ensure_tables=False)
    modules_by_id = {
        clean_text(row.get("module_catalogue_id")): row
        for row in module_rows
        if clean_text(row.get("module_catalogue_id"))
    }
    if not modules_by_id:
        return []

    active_series = authoring_fetch_all(
        LIVE_SESSIONS_TABLE,
        "status = %s",
        ["active"],
        "updated_at desc, created_at desc",
        ensure_tables=False,
    )
    series_by_id = {
        clean_text(series.get("id")): series
        for series in active_series
        if clean_text(series.get("module_catalogue_id")) in modules_by_id
    }
    if not series_by_id:
        return []

    events = []
    for occurrence in authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, ensure_tables=False):
        series = series_by_id.get(clean_text(occurrence.get("live_session_id")))
        if not series:
            continue
        scheduled_start = parse_date_value(occurrence.get("scheduled_start"))
        if isinstance(scheduled_start, datetime):
            occurrence_date = scheduled_start.date()
        elif isinstance(scheduled_start, date):
            occurrence_date = scheduled_start
        else:
            continue
        if occurrence_date < start_date or occurrence_date > end_date:
            continue

        module = modules_by_id.get(clean_text(series.get("module_catalogue_id"))) or {}
        session_number = max(1, parse_int(occurrence.get("session_number"), 1))
        tracked_occurrence = {**occurrence, "scheduled_start": scheduled_start}
        events.append(build_live_session_calendar_event(
            {
                "id": module.get("module_catalogue_id"),
                "module_name": module.get("title") or series.get("module_title"),
                "Tutor_name": module.get("tutor_name"),
                "session_week_day": module.get("session_week_day"),
                "session_start_time": module.get("session_start_time"),
                "session_end_time": module.get("session_end_time"),
            },
            {"date": occurrence_date.isoformat(), "sessionNumber": session_number},
            programme=clean_text(module.get("programme_name")),
            cohort=clean_text(module.get("cohort_name")),
            group=clean_text(module.get("group_name")),
            owner_email=owner_email,
            owner_name=owner_name,
            tracked_occurrence=tracked_occurrence,
            tracked_series=series,
        ))
    return events


def collect_generated_timetable(
    owner_email: str,
    start_date: date | None = None,
    end_date: date | None = None,
    *,
    include_live_sessions: bool = True,
    include_scheduler_queues: bool = True,
) -> dict:
    active_rows = fetch_owner_active_learner_profiles(owner_email)
    learner_profile_map = build_learner_profile_map(active_rows)
    staff_owner_name = coach_staff_display_name(owner_email)
    owner_name = staff_owner_name or next(
        (clean_text(row.coach_name) for row in active_rows if clean_text(row.coach_name)),
        "Med Maher",
    )
    commercial_rows, enrolment_rows = fetch_source_schedule_rows(active_rows)
    live_session_events = []
    if include_live_sessions:
        try:
            live_session_events = collect_live_session_events(
                owner_email,
                owner_name,
                start_date=start_date,
                end_date=end_date,
            )
        except Exception as exc:
            logger.warning("Could not collect live session events for %s: %s", owner_email, exc)

    generated_events: list[dict] = []
    source_counts = {
        "progressReviewRows": 0,
        "mcrRows": 0,
        "catchUpRows": 0,
        "liveSessionRows": len(live_session_events),
        "caseloadLearners": len(active_rows),
        "learnersWithDates": 0,
    }
    for learner in active_rows:
        learner_start_date, learner_end_date = resolve_schedule_window(learner.id, commercial_rows, enrolment_rows, learner)
        if not learner_start_date or not learner_end_date or learner_end_date <= learner_start_date:
            continue

        source_counts["learnersWithDates"] += 1
        for sequence, target_date in iterate_generated_schedule_dates(
            learner_start_date,
            learner_end_date,
            TIMETABLE_MCR_INTERVAL,
            range_start=start_date,
            range_end=end_date,
        ):
            generated_events.append(
                build_generated_calendar_event(
                    learner=learner,
                    owner_email=owner_email,
                    owner_name=owner_name,
                    event_type="mcr",
                    sequence=sequence,
                    target_date=target_date,
                )
            )
            source_counts["mcrRows"] += 1

        for sequence, target_date in iterate_generated_schedule_dates(
            learner_start_date,
            learner_end_date,
            TIMETABLE_PROGRESS_REVIEW_INTERVAL,
            range_start=start_date,
            range_end=end_date,
        ):
            generated_events.append(
                build_generated_calendar_event(
                    learner=learner,
                    owner_email=owner_email,
                    owner_name=owner_name,
                    event_type="progress-review",
                    sequence=sequence,
                    target_date=target_date,
                )
            )
            source_counts["progressReviewRows"] += 1

    persisted_standalone_records = fetch_standalone_event_records(owner_email)
    persisted_standalone_events = [
        build_catchup_calendar_event(
            record,
            owner_name=owner_name,
            learner=learner_profile_map.get(record.learner_id),
        )
        for record in persisted_standalone_records
    ]
    scheduler_catchups: list[dict] = []
    if include_scheduler_queues:
        persisted_catchup_records = [
            record
            for record in persisted_standalone_records
            if clean_text(record.event_type).lower() == CATCH_UP_EVENT_TYPE
        ]
        scheduler_catchups = build_catchup_scheduler_events(
            owner_email,
            owner_name,
            active_rows,
            learner_profile_map,
            persisted_catchup_records,
        )
    source_counts["catchUpRows"] = sum(1 for event in persisted_standalone_events if event["source"] == CATCH_UP_EVENT_TYPE)

    record_map = fetch_calendar_event_records(owner_email, [event["eventKey"] for event in generated_events])
    events = [overlay_calendar_record(event, record_map.get(event["eventKey"])) for event in generated_events]
    events.extend(persisted_standalone_events)
    events.extend(live_session_events)

    if start_date or end_date:
        filtered_events = []
        for event in events:
            event_date = parse_schedule_date(event["date"])
            if not event_date:
                continue
            if start_date and event_date < start_date:
                continue
            if end_date and event_date > end_date:
                continue
            filtered_events.append(event)
        events = filtered_events

    source_needs_scheduling = {
        "mcr": sum(1 for event in events if event["source"] == "mcr" and event["status"] == CoachCalendarEvent.STATUS_NOT_SCHEDULED),
        "progress-review": sum(1 for event in events if event["source"] == "progress-review" and event["status"] == CoachCalendarEvent.STATUS_NOT_SCHEDULED),
        CATCH_UP_EVENT_TYPE: sum(
            1
            for event in events
            if event["source"] == CATCH_UP_EVENT_TYPE and event["status"] == CoachCalendarEvent.STATUS_NOT_SCHEDULED
        ),
    }
    needs_scheduling = sum(source_needs_scheduling.values())
    events = assign_timetable_slots(events)
    events = sorted(events, key=lambda event: (event["date"], event["startHour"], event["learner"]))
    summary = build_timetable_summary(events, needs_scheduling, source_counts, source_needs_scheduling)
    summary["timeAvailability"] = "MCR events are generated every 30 days after the learner start date; progress reviews are generated every 12 weeks; catch-up and support sessions can be created by the coach for any learner in their caseload."
    return {
        "owner_name": owner_name,
        "events": events,
        "summary": summary,
        "schedulerQueues": {
            "catchUp": scheduler_catchups,
        },
    }


def normalize_duration_minutes(value) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise ValueError("durationMinutes must be a whole number.")
    if minutes < 15 or minutes > 480:
        raise ValueError("durationMinutes must be between 15 and 480.")
    return minutes


IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$")


def calendar_idempotency_key(request) -> str:
    """Return the caller's stable booking-operation identity.

    The key is scoped to the authenticated Coach by the database constraint.
    Reusing it with different booking inputs is rejected rather than silently
    changing the meaning of an already durable operation.
    """
    value = clean_text(request.headers.get("Idempotency-Key"))
    if not value:
        raise ValueError("Idempotency-Key header is required.")
    if not IDEMPOTENCY_KEY_PATTERN.fullmatch(value):
        raise ValueError("Idempotency-Key must be 8 to 255 URL-safe characters.")
    return value


def booking_request_matches_record(
    record: CoachCalendarEvent,
    *,
    learner_id: int,
    session_type: str,
    scheduled_date: date,
    scheduled_time: time,
    duration_minutes: int,
    notes: str,
) -> bool:
    return (
        record.learner_id == learner_id
        and clean_text(record.event_type).lower() == session_type
        and record.scheduled_date == scheduled_date
        and record.scheduled_time == scheduled_time
        and record.duration_minutes == duration_minutes
        and clean_text(record.notes) == notes
    )


def reserve_coach_calendar_booking(
    *,
    owner_email: str,
    owner_name: str,
    learner_id: int,
    learner_name: str,
    learner_email: str,
    session_type: str,
    scheduled_date: date,
    scheduled_time: time,
    duration_minutes: int,
    notes: str,
    idempotency_key: str,
) -> tuple[CoachCalendarEvent, bool]:
    """Durably reserve one booking before any external call.

    ``CoachCalendarSequence`` is the stable row locked for the whole allocation.
    Its unique scope and the event constraints make this safe across processes,
    not merely threads in one Python worker.
    """

    owner_email = normalize_email(owner_email)
    session_type = clean_text(session_type).lower()

    def existing_replay() -> CoachCalendarEvent | None:
        return CoachCalendarEvent.objects.filter(
            owner_email=owner_email,
            idempotency_key=idempotency_key,
        ).first()

    existing = existing_replay()
    if existing:
        if not booking_request_matches_record(
            existing,
            learner_id=learner_id,
            session_type=session_type,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            duration_minutes=duration_minutes,
            notes=notes,
        ):
            raise ValueError("Idempotency-Key was already used for a different booking.")
        return existing, False

    try:
        with transaction.atomic():
            # Recheck after entering the transaction. The unique constraint is
            # the final authority if another transaction is still uncommitted.
            existing = (
                CoachCalendarEvent.objects.select_for_update()
                .filter(owner_email=owner_email, idempotency_key=idempotency_key)
                .first()
            )
            if existing:
                if not booking_request_matches_record(
                    existing,
                    learner_id=learner_id,
                    session_type=session_type,
                    scheduled_date=scheduled_date,
                    scheduled_time=scheduled_time,
                    duration_minutes=duration_minutes,
                    notes=notes,
                ):
                    raise ValueError("Idempotency-Key was already used for a different booking.")
                return existing, False

            current_max = (
                CoachCalendarEvent.objects.filter(
                    learner_id=learner_id,
                    event_type=session_type,
                ).aggregate(max_seq=Max("sequence"))["max_seq"]
                or 0
            )
            counter, _ = CoachCalendarSequence.objects.select_for_update().get_or_create(
                learner_id=learner_id,
                event_type=session_type,
                defaults={"last_sequence": current_max},
            )
            # Handles a counter introduced before a legacy/manual event import.
            counter.last_sequence = max(counter.last_sequence, current_max) + 1
            counter.save(update_fields=["last_sequence", "updated_at"])
            sequence = counter.last_sequence

            record = CoachCalendarEvent.objects.create(
                event_key=build_timetable_event_key(
                    learner_id, session_type, sequence, scheduled_date
                ),
                idempotency_key=idempotency_key,
                owner_email=owner_email,
                owner_name=owner_name,
                learner_id=learner_id,
                learner_name=learner_name,
                learner_email=learner_email,
                event_type=session_type,
                sequence=sequence,
                target_date=scheduled_date,
                scheduled_date=scheduled_date,
                scheduled_time=scheduled_time,
                duration_minutes=duration_minutes,
                status=CoachCalendarEvent.STATUS_SCHEDULED,
                sync_state=CoachCalendarEvent.SYNC_PENDING,
                notes=notes,
            )
            return record, True
    except IntegrityError:
        # A same-key concurrent transaction may have committed while this one
        # waited on the unique index. The failed transaction has rolled back its
        # counter increment, so returning the winner cannot create a sequence gap.
        existing = existing_replay()
        if existing and booking_request_matches_record(
            existing,
            learner_id=learner_id,
            session_type=session_type,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            duration_minutes=duration_minutes,
            notes=notes,
        ):
            return existing, False
        raise


def finalize_calendar_graph_sync(record: CoachCalendarEvent, warning: str) -> None:
    record.sync_state = CoachCalendarEvent.SYNC_SYNCED
    record.last_graph_sync_error = public_graph_sync_warning(warning)
    record.save()


class CalendarSyncInProgress(RuntimeError):
    pass


def persist_calendar_sync_reservation(candidate: CoachCalendarEvent) -> CoachCalendarEvent:
    """Persist scheduling inputs and mark pending before Graph network I/O."""
    mutable_fields = (
        "owner_email",
        "owner_name",
        "learner_id",
        "learner_name",
        "learner_email",
        "event_type",
        "sequence",
        "target_date",
        "scheduled_date",
        "scheduled_time",
        "duration_minutes",
        "status",
        "notes",
    )
    with transaction.atomic():
        record = CoachCalendarEvent.objects.select_for_update().get(pk=candidate.pk)
        if record.sync_state in {
            CoachCalendarEvent.SYNC_SYNCING,
            CoachCalendarEvent.SYNC_RECONCILIATION,
        }:
            raise CalendarSyncInProgress("Calendar event synchronization is already in progress.")
        for field in mutable_fields:
            setattr(record, field, getattr(candidate, field))
        record.sync_state = CoachCalendarEvent.SYNC_PENDING
        record.save(update_fields=[*mutable_fields, "sync_state", "updated_at"])
        return record


def synchronize_reserved_calendar_event(
    record_id: int,
    base_event: dict,
) -> tuple[CoachCalendarEvent, str, bool]:
    """Claim and synchronise a durable operation without holding DB locks on I/O."""
    with transaction.atomic():
        record = CoachCalendarEvent.objects.select_for_update().get(pk=record_id)
        if record.sync_state == CoachCalendarEvent.SYNC_SYNCED:
            return record, "", False
        syncing_is_fresh = (
            record.sync_state == CoachCalendarEvent.SYNC_SYNCING
            and record.last_sync_attempt_at
            and record.last_sync_attempt_at > timezone.now() - timedelta(minutes=5)
        )
        if syncing_is_fresh or record.sync_state in {
            CoachCalendarEvent.SYNC_RECONCILIATION,
            CoachCalendarEvent.SYNC_CANCELLED,
        }:
            return record, public_graph_sync_warning(record.last_graph_sync_error), False
        record.sync_state = CoachCalendarEvent.SYNC_SYNCING
        record.sync_attempt_count += 1
        record.last_sync_attempt_at = timezone.now()
        record.save(update_fields=["sync_state", "sync_attempt_count", "last_sync_attempt_at", "updated_at"])

    logger.info(
        "coach_calendar_graph_sync_started",
        extra={
            "event": "coach_calendar_graph_sync_started",
            "operation_id": str(record.operation_id),
            "graph_status": record.sync_state,
            "attempt_count": record.sync_attempt_count,
        },
    )
    try:
        warning = sync_calendar_event_to_graph(record, base_event)
    except Exception:
        CoachCalendarEvent.objects.filter(pk=record.pk).update(
            sync_state=CoachCalendarEvent.SYNC_FAILED,
            last_graph_sync_error=TEAMS_SYNC_TEMPORARY_MESSAGE,
            updated_at=timezone.now(),
        )
        logger.exception(
            "coach_calendar_graph_sync_exception",
            extra={
                "event": "coach_calendar_graph_sync_exception",
                "operation_id": str(record.operation_id),
                "graph_status": CoachCalendarEvent.SYNC_FAILED,
                "attempt_count": record.sync_attempt_count,
            },
        )
        raise
    warning = public_graph_sync_warning(warning)
    if not calendar_record_has_launch_url(record):
        warning = warning or TEAMS_SYNC_LINK_MISSING_MESSAGE
        record.sync_state = CoachCalendarEvent.SYNC_FAILED
        record.last_graph_sync_error = public_graph_sync_warning(warning)
        record.save()
        logger.warning(
            "coach_calendar_graph_sync_failed",
            extra={
                "event": "coach_calendar_graph_sync_failed",
                "operation_id": str(record.operation_id),
                "graph_status": record.sync_state,
                "attempt_count": record.sync_attempt_count,
            },
        )
        return record, warning, True

    try:
        finalize_calendar_graph_sync(record, warning)
    except Exception:
        logger.exception(
            "coach_calendar_graph_finalize_failed",
            extra={"event": "coach_calendar_graph_finalize_failed", "operation_id": str(record.operation_id)},
        )
        compensation_warning = delete_calendar_event_from_graph(record)
        recovery_state = (
            CoachCalendarEvent.SYNC_RECONCILIATION
            if compensation_warning
            else CoachCalendarEvent.SYNC_FAILED
        )
        recovery_error = compensation_warning or "Graph event was compensated after local finalization failed."
        try:
            CoachCalendarEvent.objects.filter(pk=record.pk).update(
                sync_state=recovery_state,
                last_graph_sync_error=public_graph_sync_warning(recovery_error),
                graph_event_id="" if not compensation_warning else record.graph_event_id,
                graph_organizer_email="" if not compensation_warning else record.graph_organizer_email,
                meeting_provider="" if not compensation_warning else record.meeting_provider,
                meeting_link="" if not compensation_warning else record.meeting_link,
                graph_web_link="" if not compensation_warning else record.graph_web_link,
                updated_at=timezone.now(),
            )
        except Exception:
            logger.exception(
                "coach_calendar_graph_recovery_record_failed",
                extra={"event": "coach_calendar_graph_recovery_record_failed", "operation_id": str(record.operation_id)},
            )
        raise

    logger.info(
        "coach_calendar_graph_sync_completed",
        extra={
            "event": "coach_calendar_graph_sync_completed",
            "operation_id": str(record.operation_id),
            "graph_status": record.sync_state,
            "attempt_count": record.sync_attempt_count,
        },
    )
    return record, warning, True


def find_generated_timetable_event(owner_email: str, event_key: str) -> tuple[dict | None, str]:
    payload = collect_generated_timetable(owner_email)
    event = next((item for item in payload["events"] if item.get("eventKey") == event_key), None)
    return event, payload["owner_name"]


def find_catchup_calendar_record(owner_email: str, event_key: str) -> tuple[CoachCalendarEvent | None, str]:
    record = CoachCalendarEvent.objects.filter(
        owner_email__iexact=owner_email,
        event_key=event_key,
        event_type__iexact=CATCH_UP_EVENT_TYPE,
    ).first()
    if record and calendar_record_needs_schedule_repair(record):
        record = repair_calendar_record_to_needs_schedule(
            record,
            reason=clean_text(record.last_graph_sync_error),
        )
    owner_name = fetch_owner_name(owner_email, fallback=clean_text(record.owner_name) or "Med Maher") if record else fetch_owner_name(owner_email)
    return record, owner_name


def find_catchup_template_event(owner_email: str, event_key: str) -> tuple[dict | None, str]:
    active_rows = fetch_owner_active_learner_profiles(owner_email)
    owner_name = next(
        (clean_text(row.coach_name) for row in active_rows if clean_text(row.coach_name)),
        "Med Maher",
    )

    for learner in active_rows:
        learner_id = int(getattr(learner, "id", 0) or 0)
        if learner_id <= 0:
            continue
        if build_catchup_template_event_key(owner_email, learner_id) == event_key:
            return build_catchup_template_event(
                learner,
                owner_email=owner_email,
                owner_name=owner_name,
            ), owner_name

    return None, owner_name


@coach_access_required
def coach_timetable_schedule_event(request):
    if request.method not in ("POST", "PATCH"):
        return JsonResponse({"detail": "Method not allowed."}, status=405)

    try:
        payload = parse_json_body(request)
        owner_email = authenticated_coach_email(request)
        validator = ObjectValidator(payload)
        event_key = validator.text("eventKey", required=True, max_length=255)
        scheduled_date = validator.iso_date("scheduledDate", required=True)
        scheduled_time = validator.clock_time("scheduledTime", required=True)
        duration_minutes = validator.integer(
            "durationMinutes", default=TIMETABLE_DEFAULT_DURATION_MINUTES, minimum=15, maximum=480
        )
        timezone_offset_minutes = validator.integer(
            "timezoneOffsetMinutes", default=0, minimum=-840, maximum=840
        )
        validator.check()
    except ValidationError as exc:
        return validation_error_response(exc)

    catchup_record, owner_name = find_catchup_calendar_record(owner_email, event_key)
    if catchup_record:
        learner_rows = fetch_owner_active_learner_profiles(owner_email)
        learner_map = build_learner_profile_map(learner_rows)
        learner = learner_map.get(catchup_record.learner_id)
        if learner and coach_learner_personal_calendar_conflicts(
            learner, scheduled_date, scheduled_time, duration_minutes, timezone_offset_minutes
        ):
            return JsonResponse({"detail": "This learner is busy at that time. Choose another time."}, status=409)
        catchup_record.owner_name = owner_name or catchup_record.owner_name
        catchup_record.scheduled_date = scheduled_date
        catchup_record.scheduled_time = scheduled_time
        catchup_record.duration_minutes = duration_minutes
        catchup_record.target_date = catchup_record.target_date or scheduled_date
        catchup_record.status = CoachCalendarEvent.STATUS_SCHEDULED

        try:
            catchup_record = persist_calendar_sync_reservation(catchup_record)
        except CalendarSyncInProgress:
            return coach_error(
                request,
                code="calendar_sync_in_progress",
                message="Calendar event synchronization is already in progress.",
                status=409,
            )
        base_event = build_catchup_calendar_event(
            catchup_record,
            owner_name=owner_name,
            learner=learner_map.get(catchup_record.learner_id),
        )
        catchup_record, warning, _attempted = synchronize_reserved_calendar_event(
            catchup_record.pk, base_event
        )
        if not calendar_record_has_launch_url(catchup_record):
            warning = warning or TEAMS_SYNC_LINK_MISSING_MESSAGE
            catchup_record = repair_calendar_record_to_needs_schedule(catchup_record, reason=warning)
        else:
            catchup_record.last_graph_sync_error = public_graph_sync_warning(warning)
            catchup_record.save()

        updated_event = build_catchup_calendar_event(
            catchup_record,
            owner_name=owner_name,
            learner=learner_map.get(catchup_record.learner_id),
        )
        return JsonResponse({"event": updated_event, "warning": warning})

    catchup_template_event, owner_name = find_catchup_template_event(owner_email, event_key)
    if catchup_template_event:
        learner_rows = fetch_owner_active_learner_profiles(owner_email)
        learner_map = build_learner_profile_map(learner_rows)
        learner_id = int(catchup_template_event["learnerId"])
        learner = learner_map.get(learner_id)
        if learner and coach_learner_personal_calendar_conflicts(
            learner, scheduled_date, scheduled_time, duration_minutes, timezone_offset_minutes
        ):
            return JsonResponse({"detail": "This learner is busy at that time. Choose another time."}, status=409)
        target_date = scheduled_date

        record, _ = CoachCalendarEvent.objects.get_or_create(
            event_key=event_key,
            defaults={
                "owner_email": owner_email,
                "owner_name": owner_name,
                "learner_id": learner_id,
                "learner_name": clean_text(catchup_template_event.get("learner")),
                "learner_email": clean_text(catchup_template_event.get("email")),
                "event_type": CATCH_UP_EVENT_TYPE,
                "sequence": int(catchup_template_event.get("sequence") or 1),
                "target_date": target_date,
            },
        )
        record.owner_email = owner_email
        record.owner_name = owner_name
        record.learner_id = learner_id
        record.learner_name = clean_text(catchup_template_event.get("learner"))
        record.learner_email = clean_text(catchup_template_event.get("email"))
        record.event_type = CATCH_UP_EVENT_TYPE
        record.sequence = int(catchup_template_event.get("sequence") or 1)
        record.target_date = target_date
        record.scheduled_date = scheduled_date
        record.scheduled_time = scheduled_time
        record.duration_minutes = duration_minutes
        record.status = CoachCalendarEvent.STATUS_SCHEDULED

        try:
            record = persist_calendar_sync_reservation(record)
        except CalendarSyncInProgress:
            return coach_error(
                request,
                code="calendar_sync_in_progress",
                message="Calendar event synchronization is already in progress.",
                status=409,
            )
        base_event = build_catchup_calendar_event(
            record,
            owner_name=owner_name,
            learner=learner_map.get(record.learner_id),
        )
        record, warning, _attempted = synchronize_reserved_calendar_event(record.pk, base_event)
        if not calendar_record_has_launch_url(record):
            warning = warning or TEAMS_SYNC_LINK_MISSING_MESSAGE
            record = repair_calendar_record_to_needs_schedule(record, reason=warning)
        else:
            record.last_graph_sync_error = public_graph_sync_warning(warning)
            record.save()

        updated_event = build_catchup_calendar_event(
            record,
            owner_name=owner_name,
            learner=learner_map.get(record.learner_id),
        )
        return JsonResponse({"event": updated_event, "warning": warning})

    base_event, owner_name = find_generated_timetable_event(owner_email, event_key)
    if not base_event:
        return JsonResponse({"detail": "Calendar event not found for this coach."}, status=404)

    target_date = parse_date_value(base_event.get("targetDate"))
    if isinstance(target_date, datetime):
        target_date = target_date.date()
    if not isinstance(target_date, date):
        return JsonResponse({"detail": "Target date is missing for this event."}, status=400)

    learner_rows = fetch_owner_active_learner_profiles(owner_email)
    learner_map = build_learner_profile_map(learner_rows)
    base_learner = learner_map.get(int(base_event["learnerId"]))
    if base_learner and coach_learner_personal_calendar_conflicts(
        base_learner, scheduled_date, scheduled_time, duration_minutes, timezone_offset_minutes
    ):
        return JsonResponse({"detail": "This learner is busy at that time. Choose another time."}, status=409)

    record, _ = CoachCalendarEvent.objects.get_or_create(
        event_key=event_key,
        defaults={
            "owner_email": owner_email,
            "owner_name": owner_name,
            "learner_id": int(base_event["learnerId"]),
            "learner_name": clean_text(base_event.get("learner")),
            "learner_email": clean_text(base_event.get("email")),
            "event_type": clean_text(base_event.get("source")),
            "sequence": int(base_event.get("sequence") or 1),
            "target_date": target_date,
        },
    )
    if record.status in {
        CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
        CoachCalendarEvent.STATUS_COMPLETED,
    }:
        return JsonResponse(
            {"detail": "A submitted or completed review cannot be scheduled again."},
            status=409,
        )
    record.owner_email = owner_email
    record.owner_name = owner_name
    record.learner_id = int(base_event["learnerId"])
    record.learner_name = clean_text(base_event.get("learner"))
    record.learner_email = clean_text(base_event.get("email"))
    record.event_type = clean_text(base_event.get("source"))
    record.sequence = int(base_event.get("sequence") or 1)
    record.target_date = target_date
    record.scheduled_date = scheduled_date
    record.scheduled_time = scheduled_time
    record.duration_minutes = duration_minutes
    record.status = CoachCalendarEvent.STATUS_SCHEDULED

    try:
        record = persist_calendar_sync_reservation(record)
    except CalendarSyncInProgress:
        return coach_error(
            request,
            code="calendar_sync_in_progress",
            message="Calendar event synchronization is already in progress.",
            status=409,
        )
    record, warning, _attempted = synchronize_reserved_calendar_event(record.pk, base_event)
    if not calendar_record_has_launch_url(record):
        warning = warning or TEAMS_SYNC_LINK_MISSING_MESSAGE
        record = repair_calendar_record_to_needs_schedule(record, reason=warning)
    else:
        record.last_graph_sync_error = public_graph_sync_warning(warning)
        record.save()

    updated_event = overlay_calendar_record(base_event, record)
    return JsonResponse({"event": updated_event, "warning": warning})


@coach_access_required
def coach_timetable_book_event(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed."}, status=405)

    try:
        payload = parse_json_body(request)
        owner_email = authenticated_coach_email(request)
        validator = ObjectValidator(payload)
        learner_id = validator.integer("learnerId", required=True, minimum=1)
        # Deliberately narrower than BOOKED_EVENT_TITLES: onboarding reviews
        # are booked by the learner against their case owner, not here.
        session_type = validator.text(
            "sessionType", required=True, lower=True, choices=set(COACH_BOOKABLE_EVENT_TYPES)
        )
        scheduled_date = validator.iso_date("scheduledDate", required=True)
        scheduled_time = validator.clock_time("scheduledTime", required=True)
        duration_minutes = validator.integer(
            "durationMinutes", default=TIMETABLE_DEFAULT_DURATION_MINUTES, minimum=15, maximum=480
        )
        timezone_offset_minutes = validator.integer(
            "timezoneOffsetMinutes", default=0, minimum=-840, maximum=840
        )
        notes = validator.text("notes", max_length=500)
        if scheduled_date and scheduled_date < date.today():
            validator.error("scheduledDate", "Choose today or a future date for this session.")
        validator.check()
    except ValidationError as exc:
        return validation_error_response(exc)
    caseload_rows = fetch_caseload_learner_profiles(owner_email)
    learner = next((row for row in caseload_rows if int(getattr(row, "id", 0) or 0) == learner_id), None)
    if not learner:
        return JsonResponse({"detail": "Learner not found in this coach caseload."}, status=404)

    owner_name = fetch_owner_name(owner_email, fallback=clean_text(getattr(learner, "coach_name", None)) or "Med Maher")
    learner_name = clean_text(getattr(learner, "username", None)) or "Unknown learner"
    learner_email = clean_text(getattr(learner, "email", None))
    try:
        idempotency_key = calendar_idempotency_key(request)
    except ValueError as exc:
        return validation_error_response(ValidationError({"Idempotency-Key": [str(exc)]}))

    replay = CoachCalendarEvent.objects.filter(
        owner_email=normalize_email(owner_email),
        idempotency_key=idempotency_key,
    ).first()
    if replay:
        if not booking_request_matches_record(
            replay,
            learner_id=learner_id,
            session_type=session_type,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            duration_minutes=duration_minutes,
            notes=notes,
        ):
            return JsonResponse(
                {"detail": "Idempotency-Key was already used for a different booking."},
                status=409,
            )
        try:
            replay, warning, _attempted = synchronize_reserved_calendar_event(
                replay.pk, build_booked_calendar_event(replay)
            )
        except Exception:
            logger.exception(
                "coach_calendar_booking_replay_failed",
                extra={"event": "coach_calendar_booking_replay_failed", "operation_id": str(replay.operation_id)},
            )
            return coach_error(
                request,
                code="calendar_sync_failed",
                message="The calendar operation could not be completed.",
                status=500,
            )
        event = build_catchup_calendar_event(replay, owner_name=owner_name, learner=learner)
        return JsonResponse(
            {
                "event": event,
                "warning": warning,
                "operation": {
                    "id": str(replay.operation_id),
                    "syncState": replay.sync_state,
                    "attemptCount": replay.sync_attempt_count,
                    "replayed": True,
                },
            },
            status=200,
        )

    if coach_learner_personal_calendar_conflicts(
        learner, scheduled_date, scheduled_time, duration_minutes, timezone_offset_minutes
    ):
        return JsonResponse({"detail": "This learner is busy at that time. Choose another time."}, status=409)

    try:
        record, created = reserve_coach_calendar_booking(
            owner_email=owner_email,
            owner_name=owner_name,
            learner_id=learner_id,
            learner_name=learner_name,
            learner_email=learner_email,
            session_type=session_type,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            duration_minutes=duration_minutes,
            notes=notes,
            idempotency_key=idempotency_key,
        )
        record, warning, attempted = synchronize_reserved_calendar_event(
            record.pk,
            build_booked_calendar_event(record),
        )
    except ValueError as exc:
        if "already used" in str(exc):
            return coach_error(
                request,
                code="idempotency_conflict",
                message="Idempotency-Key was already used for a different booking.",
                status=409,
            )
        return validation_error_response(ValidationError({"body": ["The booking could not be validated."]}))
    except Exception:  # noqa: BLE001
        logger.exception(
            "coach_calendar_booking_failed coach_account_id=%s learner_id=%s event_type=%s",
            owner_email,
            learner_id,
            session_type,
        )
        return coach_error(
            request,
            code="calendar_sync_failed",
            message="The calendar operation could not be completed.",
            status=500,
        )

    event = build_catchup_calendar_event(record, owner_name=owner_name, learner=learner)
    return JsonResponse(
        {
            "event": event,
            "warning": warning,
            "operation": {
                "id": str(record.operation_id),
                "syncState": record.sync_state,
                "attemptCount": record.sync_attempt_count,
                "replayed": not created,
            },
        },
        status=201 if created else 200,
    )


@coach_access_required
def coach_timetable_event_action(request):
    if request.method not in ("POST", "PATCH"):
        return JsonResponse({"detail": "Method not allowed."}, status=405)

    try:
        payload = parse_json_body(request)
        validator = ObjectValidator(payload)
        event_key = validator.text("eventKey", required=True, max_length=255)
        action = validator.text(
            "action", required=True, lower=True, choices={"start", "complete", "sign", "cancel"}
        )
        validator.check()
    except ValidationError as exc:
        return validation_error_response(exc)

    owner_email = authenticated_coach_email(request)

    catchup_record, owner_name = find_catchup_calendar_record(owner_email, event_key)
    if catchup_record:
        warning = ""
        if action == "sign":
            return JsonResponse({"detail": "Only progress reviews can be signed off."}, status=400)
        if action == "start" and not calendar_record_has_launch_url(catchup_record):
            return JsonResponse({"detail": "This event does not have a Teams link yet. Schedule it again first."}, status=409)
        if action == "start" and catchup_record.status != CoachCalendarEvent.STATUS_SCHEDULED:
            return JsonResponse({"detail": "Only a scheduled event can be started."}, status=409)
        if action == "start" and catchup_record.scheduled_date and catchup_record.scheduled_date > date.today():
            return JsonResponse({"detail": "Join Meeting becomes available on the scheduled day."}, status=409)
        if action == "complete" and catchup_record.status != CoachCalendarEvent.STATUS_IN_PROGRESS:
            return JsonResponse({"detail": "Start the event before completing it."}, status=409)
        if action == "start":
            catchup_record.status = CoachCalendarEvent.STATUS_IN_PROGRESS
        elif action == "complete":
            catchup_record.status = CoachCalendarEvent.STATUS_COMPLETED
        elif action == "cancel":
            catchup_record, warning = cancel_reserved_calendar_event(catchup_record)

        catchup_record.owner_name = owner_name or catchup_record.owner_name
        catchup_record.last_graph_sync_error = public_graph_sync_warning(warning)
        catchup_record.save()

        learner = fetch_owner_active_learner_profiles(owner_email)
        learner_map = build_learner_profile_map(learner)
        updated_event = build_catchup_calendar_event(
            catchup_record,
            owner_name=owner_name,
            learner=learner_map.get(catchup_record.learner_id),
        )
        return JsonResponse({"event": updated_event, "warning": warning})

    base_event, owner_name = find_generated_timetable_event(owner_email, event_key)
    if not base_event:
        return JsonResponse({"detail": "Calendar event not found for this coach."}, status=404)

    record = CoachCalendarEvent.objects.filter(owner_email__iexact=owner_email, event_key=event_key).first()
    if not record:
        return JsonResponse({"detail": "This event has not been scheduled yet."}, status=400)
    if calendar_record_needs_schedule_repair(record):
        repair_calendar_record_to_needs_schedule(
            record,
            reason=clean_text(record.last_graph_sync_error),
        )
        return JsonResponse({"detail": "This event does not have a Teams link anymore and was moved back to Needs Schedule."}, status=409)

    record.owner_name = owner_name
    warning = ""
    review_responses = None
    completion_source = base_event.get("source")
    response_ids = (
        PROGRESS_REVIEW_RESPONSE_IDS
        if completion_source == "progress-review"
        else MONTHLY_COACHING_RESPONSE_IDS
        if completion_source == "mcr"
        else None
    )
    required_response_ids = (
        PROGRESS_REVIEW_REQUIRED_RESPONSE_IDS
        if completion_source == "progress-review"
        else MONTHLY_COACHING_REQUIRED_RESPONSE_IDS
        if completion_source == "mcr"
        else response_ids
    )
    if action == "complete" and response_ids:
        submitted_responses = payload.get("reviewResponses")
        if not isinstance(submitted_responses, dict):
            return validation_error_response(ValidationError({
                "reviewResponses": ["Responses are required as a JSON object before completing the session."]
            }))
        invalid_response_text = {
            f"reviewResponses.{key}": ["Must be a string of at most 4000 characters."]
            for key, value in submitted_responses.items()
            if key in response_ids and (not isinstance(value, str) or len(value.strip()) > 4000)
        }
        if invalid_response_text:
            return validation_error_response(ValidationError(invalid_response_text))
        review_responses = {
            key: clean_text(submitted_responses.get(key))
            for key in response_ids
        }
        missing = sorted(
            key
            for key in (required_response_ids or set())
            if not review_responses.get(key)
        )
        if missing:
            return validation_error_response(ValidationError({
                f"reviewResponses.{key}": ["This response is required."] for key in missing
            }))
        if completion_source == "progress-review":
            invalid_ratings = sorted(
                key
                for key in PROGRESS_REVIEW_RATING_RESPONSE_IDS
                if not review_responses.get(key, "").isdigit()
                or not 1 <= int(review_responses[key]) <= 10
            )
            if invalid_ratings:
                return validation_error_response(ValidationError({
                    f"reviewResponses.{key}": ["Must be a whole number between 1 and 10."]
                    for key in invalid_ratings
                }))
            invalid_yes_no = sorted(
                key
                for key in PROGRESS_REVIEW_YES_NO_RESPONSE_IDS
                if review_responses.get(key) not in {"Yes", "No"}
            )
            if invalid_yes_no:
                return validation_error_response(ValidationError({
                    f"reviewResponses.{key}": ["Must be Yes or No."] for key in invalid_yes_no
                }))
            if review_responses.get("key_theme") not in PROGRESS_REVIEW_KEY_THEMES:
                return validation_error_response(ValidationError({
                    "reviewResponses.key_theme": ["Select a valid key theme."]
                }))
            conditional_requirements = {
                ("other_progress_issues", "Yes"): "other_progress_issues_detail",
                ("safeguarding_concerns", "Yes"): "safeguarding_concerns_detail",
                ("key_theme", "Other"): "key_theme_other",
                ("additional_learning_support", "Yes"): "additional_learning_support_detail",
                ("health_adjustments", "Yes"): "health_adjustments_detail",
                ("other_support_circumstances", "Yes"): "other_support_detail",
                ("previous_targets_achieved", "No"): "previous_targets_detail",
            }
            missing_conditional = sorted(
                detail_id
                for (answer_id, trigger_value), detail_id in conditional_requirements.items()
                if review_responses.get(answer_id) == trigger_value
                and not review_responses.get(detail_id)
            )
            if missing_conditional:
                return validation_error_response(ValidationError({
                    f"reviewResponses.{key}": ["This follow-up detail is required."]
                    for key in missing_conditional
                }))
        if completion_source == "mcr":
            invalid_yes_no = sorted(
                key
                for key in MONTHLY_COACHING_YES_NO_RESPONSE_IDS
                if review_responses.get(key) not in {"Yes", "No"}
            )
            if invalid_yes_no:
                return validation_error_response(ValidationError({
                    f"reviewResponses.{key}": ["Must be Yes or No."] for key in invalid_yes_no
                }))
            valid_agreement_values = {"Agree", "Neutral", "Disagree", "Not discussed"}
            invalid_agreements = sorted(
                key
                for key in MONTHLY_COACHING_AGREEMENT_RESPONSE_IDS
                if review_responses.get(key) not in valid_agreement_values
            )
            if invalid_agreements:
                return validation_error_response(ValidationError({
                    f"reviewResponses.{key}": ["Select a valid agreement response."]
                    for key in invalid_agreements
                }))
            if review_responses.get("mcm_previous_meeting") not in {
                "Previous Monthly Coaching Meeting",
                "No previous meeting",
            }:
                return validation_error_response(ValidationError({
                    "reviewResponses.mcm_previous_meeting": ["Select a valid previous meeting."]
                }))
            try:
                date.fromisoformat(review_responses.get("mcm_next_meeting_date", ""))
            except ValueError:
                return validation_error_response(ValidationError({
                    "reviewResponses.mcm_next_meeting_date": ["Enter a valid date in YYYY-MM-DD format."]
                }))
        outcome_key = "rag_status" if completion_source == "progress-review" else "mcm_outcome"
        if review_responses[outcome_key].lower() not in {"green", "amber", "red"}:
            return validation_error_response(ValidationError({
                f"reviewResponses.{outcome_key}": ["Must be Green, Amber or Red."]
            }))

    if action == "start" and not calendar_record_has_launch_url(record):
        return JsonResponse({"detail": "This event does not have a Teams link yet. Schedule it again first."}, status=409)
    if action == "start" and record.status != CoachCalendarEvent.STATUS_SCHEDULED:
        return JsonResponse({"detail": "Only a scheduled event can be started."}, status=409)
    if action == "start" and record.scheduled_date and record.scheduled_date > date.today():
        return JsonResponse({"detail": "Join Meeting becomes available on the scheduled day."}, status=409)
    if action == "complete" and record.status != CoachCalendarEvent.STATUS_IN_PROGRESS:
        return JsonResponse({"detail": "Start the review before completing it."}, status=409)
    if action == "sign":
        if completion_source != "progress-review":
            return JsonResponse({"detail": "Only progress reviews require a manager signature."}, status=400)
        if record.status != CoachCalendarEvent.STATUS_AWAITING_SIGNATURE:
            return JsonResponse({"detail": "This progress review is not awaiting a manager signature."}, status=409)
    if action == "start":
        record.status = CoachCalendarEvent.STATUS_IN_PROGRESS
    elif action == "complete":
        record.status = (
            CoachCalendarEvent.STATUS_AWAITING_SIGNATURE
            if completion_source == "progress-review"
            else CoachCalendarEvent.STATUS_COMPLETED
        )
        if review_responses is not None:
            record.review_responses = review_responses
            record.review_completed_at = timezone.now()
    elif action == "sign":
        record.status = CoachCalendarEvent.STATUS_COMPLETED
        record.manager_signed_at = timezone.now()
        record.manager_signed_by = clean_text(payload.get("managerName")) or "Line Manager"
    elif action == "cancel":
        record, warning = cancel_reserved_calendar_event(record)

    record.last_graph_sync_error = public_graph_sync_warning(warning)
    record.save()
    updated_event = overlay_calendar_record(base_event, record)
    return JsonResponse({"event": updated_event, "warning": warning})


def serialize_attendance_learner(
    learner: dict,
    attendance_metrics: dict | None,
    catchup_count: int = 0,
) -> dict:
    sessions = attendance_metrics.get("sessions", 0) if attendance_metrics else 0
    present = attendance_metrics.get("present", 0) if attendance_metrics else 0
    absent = attendance_metrics.get("absent", 0) if attendance_metrics else 0
    recorded_sessions = present + absent
    attendance_rate = percentage(present, recorded_sessions) if recorded_sessions else None
    risk = attendance_metrics.get("risk") if attendance_metrics else None
    if risk not in {"green", "amber", "red"}:
        risk = attendance_risk_from_rate(attendance_rate)

    return {
        "id": learner["id"],
        "learner": learner["name"],
        "initials": learner["initials"],
        "email": learner.get("email"),
        "programme": learner.get("programmeName") or learner["cohortName"],
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
        "late": attendance_metrics.get("late", 0) if attendance_metrics else None,
        "catchup": max(catchup_count, attendance_metrics.get("catchup", 0) if attendance_metrics else 0),
        "authorisedAbsent": attendance_metrics.get("authorisedAbsent", 0) if attendance_metrics else None,
        "unauthorisedAbsent": attendance_metrics.get("unauthorisedAbsent", 0) if attendance_metrics else None,
        "absenceReasons": attendance_metrics.get("absenceReasons", {}) if attendance_metrics else {},
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


def normalize_attendance_detail_status(value) -> str:
    text = clean_text(value).lower()
    if text in {"1", "true", "yes", "y", "present", "attended", "attend"}:
        return "present"
    if text in {"0", "false", "no", "n", "absent", "missed", "did not attend", "non-attendance"}:
        return "absent"
    return text or "--"


def fetch_attendance_detail_rows(learner: dict) -> list[dict]:
    rows = fetch_verified_teams_attendance_rows(
        [to_int(learner.get("id"))],
        [normalize_email(learner.get("email"))],
    )

    return [
        {
            "learnerId": clean_text(row.get("learner_id")),
            "learnerName": clean_text(row.get("learner_name")) or learner.get("name", ""),
            "learnerEmail": clean_text(row.get("learner_email")) or learner.get("email", ""),
            "sessionId": clean_text(row.get("session_id")) or "--",
            "sessionTitle": clean_text(row.get("session_title")) or "--",
            "sessionType": clean_text(row.get("session_type")) or "--",
            "sessionDate": format_iso_date_value(row.get("session_date")),
            "sessionDateLabel": format_date_value(row.get("session_date")),
            "startTime": format_time_value(row.get("session_start_time")) or "--",
            "endTime": format_time_value(row.get("session_end_time")) or "--",
            "status": normalize_attendance_detail_status(row.get("attendance_status")),
            "reason": clean_text(row.get("absence_reason")) or "--",
            "catchupCompleted": is_truthy_value(row.get("catchup_completed")),
            "attendedSeconds": to_int(row.get("attended_seconds")),
        }
        for row in rows
    ]


@coach_access_required
@require_GET
def coach_attendance_details(request):
    owner_email = authenticated_coach_email(request)
    learner_id = clean_text(request.GET.get("learner_id"))
    learner_email = normalize_email(request.GET.get("learner_email"))

    try:
        caseload_rows = fetch_attendance_caseload_rows(owner_email)
        learners = [serialize_attendance_source_learner(row) for row in caseload_rows]
        learner = next(
            (
                item for item in learners
                if (learner_id and str(item["id"]) == learner_id)
                or (learner_email and normalize_email(item.get("email")) == learner_email)
            ),
            None,
        )
        if not learner:
            return JsonResponse({"detail": "Learner not found in this coach caseload."}, status=404)

        sessions = fetch_attendance_detail_rows(learner)
    except Exception:
        logger.exception("coach_attendance_details_failed coach_account_id=%s learner_id=%s", owner_email, learner_id)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load learner attendance details.",
            status=503,
        )

    present = sum(1 for item in sessions if item["status"] == "present")
    absent = sum(1 for item in sessions if item["status"] == "absent")
    return JsonResponse(
        {
            "learner": {
                "id": learner["id"],
                "name": learner["name"],
                "email": learner.get("email"),
                "cohort": learner.get("cohortName"),
                "group": learner.get("group"),
            },
            "summary": {
                "total": len(sessions),
                "present": present,
                "absent": absent,
                "unknown": len(sessions) - present - absent,
            },
            "sessions": sessions,
        }
    )


@coach_access_required
@require_GET
def coach_timetable(request):
    owner_email = authenticated_coach_email(request)
    validator = ObjectValidator(request.GET)
    start_date = validator.iso_date("start")
    end_date = validator.iso_date("end")
    if start_date and end_date and start_date > end_date:
        validator.error("end", "Must be on or after start.")
    try:
        validator.check()
    except ValidationError as exc:
        return validation_error_response(exc)
    include_live_sessions = clean_text(request.GET.get("include_live_sessions", "1")).casefold() not in {"0", "false", "no", "off"}
    include_scheduler_queues = clean_text(request.GET.get("include_scheduler_queues", "1")).casefold() not in {"0", "false", "no", "off"}

    try:
        timetable_payload = collect_generated_timetable(
            owner_email,
            start_date=start_date,
            end_date=end_date,
            include_live_sessions=include_live_sessions,
            include_scheduler_queues=include_scheduler_queues,
        )
    except Exception:
        logger.exception("coach_timetable_load_failed coach_account_id=%s", owner_email)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load coach timetable data.",
            status=503,
        )

    return JsonResponse(
        {
            "owner": {"name": timetable_payload["owner_name"], "email": owner_email},
            "summary": timetable_payload["summary"],
            "events": timetable_payload["events"],
            "schedulerQueues": timetable_payload.get("schedulerQueues", {}),
        }
    )


def caseload_counts_by_coach(coach_emails: set[str]) -> dict[str, dict[str, int]]:
    """Learner counts per coach email, in one pass over the caseload table.

    Reusing ``fetch_caseload_dashboard_profiles`` per coach would issue a query
    and serialise a full caseload for every card on the picker; each card shows
    two integers.
    """
    counts: dict[str, dict[str, int]] = {}
    if not coach_emails:
        return counts

    # Not ``.iterator()``: the pooled connection this runs over rejects the
    # server-side cursor it opens ("portal does not exist"). Three short columns
    # for the coached learners is a small result set to hold.
    rows = (
        LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
        .filter(coach_email_key__in=sorted(coach_emails))
        .values_list("coach_email_key", "programme_status", "full_name")
    )
    for email_key, programme_status, full_name in rows:
        # The same "has a name" guard the caseload fetches apply — a row without
        # one is a placeholder and is not counted as a learner anywhere else.
        if not clean_text(full_name):
            continue
        bucket = counts.setdefault(email_key, {"total": 0, "active": 0})
        bucket["total"] += 1
        if normalize_program_status(programme_status) == "active":
            bucket["active"] += 1
    return counts


@require_access(ACCESS_SUPER_ADMIN)
@require_GET
def coach_directory(request):
    """The accounts holding Coach access, for the admin's coach-workspace picker.

    Gated on ``ACCESS_SUPER_ADMIN`` rather than ``ACCESS_COACH`` because this is
    the one coach route where that grant is the requirement and not a bypass: a
    coach has no reason to enumerate their colleagues' caseloads.
    """
    try:
        staff_rows = list(
            StaffUser.objects.annotate(
                staff_email_key=Lower(Trim("email")),
                staff_access_key=Lower(Trim("access")),
            )
            .filter(staff_access_key=ACCESS_COACH)
            .values("id", "username", "email", "staff_email_key")
            .order_by("username", "id")
        )
    except DatabaseError:
        logger.exception("coach_directory_staff_lookup_failed")
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load the coach directory.",
            status=503,
        )

    emails = {row["staff_email_key"] for row in staff_rows if row["staff_email_key"]}
    counts_available = True
    try:
        counts = caseload_counts_by_coach(emails)
    except DatabaseError:
        # The list itself is still worth serving: a caseload database that is
        # down must not hide which accounts hold Coach access.
        logger.exception("coach_directory_caseload_counts_failed")
        counts_available = False
        counts = {}

    coaches: list[dict] = []
    seen: set[str] = set()
    for row in staff_rows:
        email = row["staff_email_key"]
        # An address is what every coach-scoped query is keyed by, so a staff row
        # without one cannot open a workspace and is left out rather than shown
        # as a card that loads nothing.
        if not email or email in seen:
            continue
        seen.add(email)
        bucket = counts.get(email, {})
        coaches.append(
            {
                "id": row["id"],
                "name": clean_text(row["username"]) or email,
                "email": email,
                "caseloadCount": bucket.get("total", 0),
                "activeLearnerCount": bucket.get("active", 0),
            }
        )

    return JsonResponse(
        {
            "coaches": coaches,
            "count": len(coaches),
            "caseloadCountsAvailable": counts_available,
        }
    )


@coach_access_required
@require_GET
def coach_dashboard(request):
    """Return every data set needed by the coach workspace in one request."""
    owner_email = authenticated_coach_email(request)
    today = date.today()
    calendar_end = today + timedelta(days=90)

    def load_dashboard_learners():
        try:
            rows = fetch_caseload_dashboard_profiles(owner_email)
            return [serialize_caseload_dashboard_learner(row) for row in rows]
        finally:
            close_old_connections()

    def load_dashboard_timetable():
        cache_key = f"coach-dashboard-timetable:v3:{normalize_email(owner_email)}:{today.isoformat()}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached
        try:
            payload = collect_generated_timetable(
                owner_email,
                start_date=today,
                end_date=calendar_end,
                include_live_sessions=False,
                include_scheduler_queues=False,
            )
            live_events = collect_tracked_live_session_events(
                owner_email,
                payload.get("owner_name") or "Med Maher",
                start_date=today,
                end_date=calendar_end,
            )
            payload["events"] = sorted(
                [*payload.get("events", []), *live_events],
                key=lambda event: (event.get("date") or "", event.get("startHour") or 0),
            )
            payload.setdefault("summary", {})["liveSessionRows"] = len(live_events)
            cache.set(cache_key, payload, 60)
            return payload
        finally:
            close_old_connections()

    try:
        # These sections use independent read-only connections. Running them
        # together makes initial page latency the duration of the slowest query
        # instead of the sum of both remote-database round trips.
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="coach-dashboard") as executor:
            learners_future = executor.submit(load_dashboard_learners)
            timetable_future = executor.submit(load_dashboard_timetable)
            learners = learners_future.result()
            timetable_payload = timetable_future.result()
        owner_name = coach_staff_display_name(owner_email) or next(
            (clean_text(learner.get("coachName")) for learner in learners if clean_text(learner.get("coachName"))),
            "Coach",
        )
    except Exception:
        logger.exception("coach_dashboard_load_failed coach_account_id=%s", owner_email)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load coach dashboard data.",
            status=503,
        )

    return JsonResponse(
        {
            "owner": {
                "name": timetable_payload.get("owner_name") or owner_name,
                "email": owner_email,
            },
            "learners": learners,
            # The compact dashboard cards do not render attendance or evidence.
            # Their dedicated pages load those expensive datasets on demand.
            "attendance": {"learners": []},
            "timetable": {
                "summary": timetable_payload.get("summary", {}),
                "events": timetable_payload.get("events", []),
            },
            "evidence": {"items": []},
            "errors": {},
        }
    )

@coach_access_required
@require_GET
def coach_monthly_activity(request):
    owner_email = authenticated_coach_email(request)
    try:
        start_date, end_date, month_label, month_key = parse_month_bounds(request.GET.get("month"))
    except ValidationError as exc:
        return validation_error_response(exc)
    refresh_live_snapshots = request_prefers_live_caseload_snapshots(request)

    try:
        rows = fetch_caseload_learner_profiles(owner_email)
        timetable_payload = collect_generated_timetable(
            owner_email,
            start_date=start_date,
            end_date=end_date,
            # Attendance is loaded from its dedicated projection below, and
            # Monthly Cycle does not render timetable scheduler queues.
            include_live_sessions=False,
            include_scheduler_queues=False,
        )
        events = timetable_payload.get("events", [])
        active_pairs = [
            (row, learner)
            for row in rows
            for learner in [serialize_caseload_learner(row, refresh_live_snapshots=refresh_live_snapshots)]
            if learner.get("enrollmentStatus") == "active"
        ]
        # Curriculum is the attendance source of truth: live-session
        # occurrences and their imported Microsoft Teams attendance reports.
        attendance_rows = fetch_verified_teams_attendance_rows(
            [row.id for row, _learner in active_pairs if getattr(row, "id", None)],
            start_date=start_date,
            end_date=end_date,
        )
        attendance_by_learner_id: dict[int, list[dict]] = defaultdict(list)
        for attendance_row in attendance_rows:
            learner_id = to_int(attendance_row.get("learner_id"))
            if learner_id:
                attendance_by_learner_id[learner_id].append(attendance_row)
        expected_otjh_by_component_id = curriculum_expected_otjh_by_component_id(
            [
                component_id
                for row, _learner in active_pairs
                for component_ids in curriculum_monthly_target_hours_weeks(monthly_target_training_plan(row))
                for component_id in component_ids
            ]
        )
        learners = [
            build_monthly_activity_learner(
                row,
                learner,
                events,
                start_date,
                end_date,
                attendance_rows=attendance_by_learner_id.get(to_int(learner.get("id")), []),
                expected_otjh_by_component_id=expected_otjh_by_component_id,
            )
            for row, learner in active_pairs
        ]
    except Exception:
        logger.exception("coach_monthly_activity_load_failed coach_account_id=%s month=%s", owner_email, month_key)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load monthly activity data.",
            status=503,
        )

    owner_name = coach_staff_display_name(owner_email) or next(
        (clean_text(getattr(row, "coach_name", "")) for row, _learner in active_pairs if clean_text(getattr(row, "coach_name", ""))),
        timetable_payload.get("owner_name") or "Coach",
    )
    on_track = sum(1 for learner in learners if learner["status"] == "on-track")
    need_attention = sum(1 for learner in learners if learner["status"] == "need-attention")
    at_risk = sum(1 for learner in learners if learner["status"] == "at-risk")
    all_ksb_codes = {
        code
        for learner in learners
        for code in learner["ksb"].get("codes", [])
    }

    return JsonResponse(
        {
            "owner": {"name": owner_name, "email": owner_email},
            "month": month_key,
            "monthLabel": month_label,
            "dateRange": {"start": start_date.isoformat(), "end": end_date.isoformat()},
            "summary": {
                "activeLearners": len(learners),
                "timelineItems": sum(len(learner["activities"]) for learner in learners),
                "learningActivities": sum(learner["learning"]["total"] for learner in learners),
                "quizzes": sum(learner["learning"]["quizzes"] for learner in learners),
                "videos": sum(learner["learning"]["videos"] for learner in learners),
                "components": sum(learner["learning"]["components"] for learner in learners),
                "coachingSessions": sum(learner["coaching"]["total"] for learner in learners),
                "bookedSessions": sum(learner["coaching"]["booked"] for learner in learners),
                "needsSchedule": sum(learner["coaching"]["needsSchedule"] for learner in learners),
                "evidence": sum(learner["evidence"]["submitted"] for learner in learners),
                "ksbTouched": len(all_ksb_codes),
                "otjhHours": round(sum(learner["otjh"]["monthlyHours"] for learner in learners), 1),
                "needsAction": sum(1 for learner in learners if learner["needsAction"]),
                "onTrack": on_track,
                "needAttention": need_attention,
                "atRisk": at_risk,
            },
            "learners": learners,
        }
    )


@coach_access_required
@require_GET
def coach_caseload(request):
    owner_email = authenticated_coach_email(request)
    refresh_live_snapshots = request_prefers_live_caseload_snapshots(request)
    summary_only = clean_text(request.GET.get("summary")).casefold() in {"1", "true", "yes", "on"}

    try:
        if summary_only:
            rows = fetch_caseload_dashboard_profiles(owner_email)
            learners = [serialize_caseload_dashboard_learner(row) for row in rows]
        else:
            rows = fetch_caseload_learner_profiles(owner_email)
            learners = [
                serialize_caseload_learner(row, refresh_live_snapshots=refresh_live_snapshots)
                for row in rows
            ]
    except Exception:
        logger.exception("coach_caseload_load_failed coach_account_id=%s", owner_email)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load coach caseload data.",
            status=503,
        )

    owner_name = coach_staff_display_name(owner_email) or next(
        (clean_text(learner.get("coachName")) for learner in learners if clean_text(learner.get("coachName"))),
        "Coach",
    )
    return JsonResponse(
        {
            "owner": {"name": owner_name, "email": owner_email},
            "learners": learners,
        }
    )


@coach_access_required
def coach_caseload_coach_rag(request, learner_id):
    if request.method not in ("GET", "PATCH", "PUT"):
        return JsonResponse({"detail": "Method not allowed."}, status=405)

    owner_email = authenticated_coach_email(request)
    learner_queryset = LearnerProfile.objects.annotate(
        coach_email_key=Lower(Trim("coach_email")),
    ).filter(
        id=learner_id,
        coach_email_key=normalize_email(owner_email),
    )

    if request.method == "GET":
        row = learner_queryset.values_list("coach_rag", flat=True).first()
        if row is None and not learner_queryset.exists():
            return JsonResponse({"detail": "Learner not found."}, status=404)
        return JsonResponse({"id": str(learner_id), "coachRag": format_coach_rag_value(row)})

    try:
        payload = parse_json_body(request)
        validator = ObjectValidator(payload)
        raw_rag = validator.text("coachRag", lower=True)
        if raw_rag and raw_rag not in COACH_RAG_LABELS:
            validator.error("coachRag", "Must be one of: green, amber, red.")
        validator.check()
        coach_rag = raw_rag or None
    except ValidationError as exc:
        return validation_error_response(exc)

    try:
        updated = learner_queryset.update(coach_rag=coach_rag) > 0
    except Exception:  # noqa: BLE001
        logger.exception("coach_rag_update_failed coach_account_id=%s learner_id=%s", owner_email, learner_id)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to update coach RAG.",
            status=503,
        )

    if not updated:
        return JsonResponse({"detail": "Learner not found."}, status=404)

    return JsonResponse({"id": str(learner_id), "coachRag": format_coach_rag_value(coach_rag)})


@coach_access_required
@require_GET
def coach_attendance(request):
    owner_email = authenticated_coach_email(request)

    try:
        caseload_rows = fetch_attendance_caseload_rows(owner_email)
        caseload_learners = [
            learner
            for learner in [serialize_attendance_source_learner(row) for row in caseload_rows]
            if should_include_in_attendance_page(learner)
        ]
        active_learners = [
            learner for learner in caseload_learners if should_include_in_attendance_metrics(learner)
        ]
        learner_ids = [int(learner["id"]) for learner in caseload_learners if learner.get("id")]
        active_learner_ids = [int(learner["id"]) for learner in active_learners if learner.get("id")]
        email_keys = [normalize_email(learner.get("email")) for learner in caseload_learners]
        active_email_keys = [normalize_email(learner.get("email")) for learner in active_learners]
        attendance_data = fetch_attendance_detail_summary_data(learner_ids, email_keys)
        active_attendance_data = filter_attendance_detail_summary_data(
            attendance_data,
            active_learner_ids,
            active_email_keys,
        )
        sync_learner_absence_counts_from_details(learner_ids, email_keys)
        metrics_by_id = attendance_data["metricsById"]
        metrics_by_email = attendance_data["metrics"]
        missing_fallback_emails = [
            normalize_email(learner.get("email"))
            for learner in caseload_learners
            if (
                normalize_email(learner.get("email"))
                and not metrics_by_id.get(int(learner["id"]))
                and not metrics_by_email.get(normalize_email(learner.get("email")))
            )
        ]
        fallback_attendance_data = fetch_learner_absence_data(missing_fallback_emails)
        fallback_metrics_by_email = fallback_attendance_data["metrics"]
        catchup_records = list(
            CoachCalendarEvent.objects.filter(
                owner_email__iexact=owner_email,
                event_type__iexact=CATCH_UP_EVENT_TYPE,
            )
        )
        catchups_by_learner_id: dict[int, int] = {}
        for record in catchup_records:
            catchups_by_learner_id[record.learner_id] = catchups_by_learner_id.get(record.learner_id, 0) + 1

        attendance_learners = [
            serialize_attendance_learner(
                learner,
                metrics_by_id.get(int(learner["id"]))
                or metrics_by_email.get(normalize_email(learner.get("email")))
                or fallback_metrics_by_email.get(normalize_email(learner.get("email"))),
                catchups_by_learner_id.get(int(learner["id"]), 0),
            )
            for learner in caseload_learners
        ]
    except Exception:
        logger.exception("coach_attendance_load_failed coach_account_id=%s", owner_email)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load coach attendance data.",
            status=503,
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
    total_recorded_sessions = total_present + total_absent
    pending_catchups = [
        record
        for record in catchup_records
        if record.status not in {CoachCalendarEvent.STATUS_COMPLETED, CoachCalendarEvent.STATUS_CANCELLED}
    ]
    scheduled_catchups = [
        record
        for record in catchup_records
        if record.status in {CoachCalendarEvent.STATUS_SCHEDULED, CoachCalendarEvent.STATUS_IN_PROGRESS}
    ]
    today = date.today()
    overdue_catchups = [
        record
        for record in pending_catchups
        if (record.scheduled_date or record.target_date) < today
    ]
    stored_catchups = sum(learner["catchup"] or 0 for learner in metric_learners)
    absence_reasons: dict[str, int] = {}
    for learner in metric_learners:
        for reason, count in (learner.get("absenceReasons") or {}).items():
            absence_reasons[reason] = absence_reasons.get(reason, 0) + to_int(count)

    summary = {
        "totalLearners": len(attendance_learners),
        "activeLearners": len(metric_learners),
        "onBreakLearners": sum(1 for learner in attendance_learners if learner["isOnBreak"]),
        "learnersWithAttendance": len(learners_with_attendance),
        "cohortCount": len({learner["cohort"] for learner in attendance_learners if learner["cohort"]}),
        "averageAttendance": percentage(total_present, total_recorded_sessions) if total_recorded_sessions else None,
        "totalSessions": total_sessions,
        "totalPresent": total_present,
        "totalAbsent": total_absent,
        "onTrack": sum(1 for learner in learners_with_attendance if learner["risk"] == "green"),
        "needsAttention": sum(1 for learner in learners_with_attendance if learner["risk"] == "amber"),
        "atRisk": sum(1 for learner in learners_with_attendance if learner["risk"] == "red"),
        "unknown": len(metric_learners) - len(learners_with_attendance),
        "catchupsPending": max(len(pending_catchups), stored_catchups),
        "scheduledCatchups": len(scheduled_catchups),
        "overdueCatchups": len(overdue_catchups),
        "absenceReasons": absence_reasons,
    }

    owner_name = (
        caseload_learners[0]["coachName"]
        if caseload_learners
        else coach_staff_display_name(owner_email) or "Coach"
    )
    active_trends = active_attendance_data["trends"]
    if not any(active_trends.values()):
        active_trends = fetch_learner_absence_data(active_email_keys)["trends"]
    return JsonResponse(
        {
            "owner": {"name": owner_name, "email": owner_email},
            "summary": summary,
            "learners": attendance_learners,
            "trends": active_trends,
        }
    )


def fetch_absence_report_attendance_rates(learner_ids: list[int], learner_emails: list[str]) -> dict:
    detail_data = fetch_attendance_detail_summary_data(learner_ids, learner_emails)
    by_id: dict[int, int | None] = {}
    by_email: dict[str, int | None] = {}

    for learner_id, metrics in detail_data["metricsById"].items():
        present = to_int(metrics.get("present"))
        absent = to_int(metrics.get("absent"))
        recorded_sessions = present + absent
        by_id[learner_id] = percentage(present, recorded_sessions) if recorded_sessions else None

    for email_key, metrics in detail_data["metrics"].items():
        present = to_int(metrics.get("present"))
        absent = to_int(metrics.get("absent"))
        recorded_sessions = present + absent
        if email_key:
            by_email[email_key] = percentage(present, recorded_sessions) if recorded_sessions else None

    missing_ids = [int(learner_id) for learner_id in learner_ids if learner_id and int(learner_id) not in by_id]
    missing_emails = [
        normalize_email(email)
        for email in learner_emails
        if normalize_email(email) and normalize_email(email) not in by_email
    ]
    connection = connections[router.db_for_read(LearnerAbsence) or "default"]
    legacy_summary_exists = find_existing_relation(connection, ('"Learner"."Absence"',))
    if legacy_summary_exists and (missing_ids or missing_emails):
        query = Q()
        if missing_ids:
            query |= Q(learner_id__in=missing_ids)
        if missing_emails:
            query |= Q(learner_email__in=missing_emails)
        rows = LearnerAbsence.objects.filter(query).values("learner_id", "learner_email", "present", "absent")
        for row in rows:
            present = to_int(row["present"])
            absent = to_int(row["absent"])
            recorded_sessions = present + absent
            attendance_rate = percentage(present, recorded_sessions) if recorded_sessions else None
            learner_id = to_int(row["learner_id"])
            email_key = normalize_email(row["learner_email"])
            if learner_id and learner_id not in by_id:
                by_id[learner_id] = attendance_rate
            if email_key and email_key not in by_email:
                by_email[email_key] = attendance_rate

    return {"by_id": by_id, "by_email": by_email}


def count_previous_absences_from_detail_rows(rows: list[dict], before_date: date | None) -> int:
    seen = set()
    previous_absences = 0
    for row in rows:
        parsed_date = parse_date_value(row.get("session_date"))
        session_date = parsed_date.date() if isinstance(parsed_date, datetime) else parsed_date
        row_key = (
            clean_text(row.get("learner_id")),
            normalize_email(row.get("learner_email")),
            format_iso_date(session_date),
            clean_text(row.get("session_start_time")),
        )
        if row_key in seen:
            continue
        seen.add(row_key)
        if (
            before_date
            and session_date
            and session_date < before_date
            and normalize_attendance_detail_status(row.get("attendance_status")) == "absent"
        ):
            previous_absences += 1
    return previous_absences


def normalize_absence_report_status(value: str | None) -> str:
    status = clean_text(value).lower()
    if status in {
        CoachAbsenceReport.STATUS_PENDING,
        CoachAbsenceReport.STATUS_APPROVED,
        CoachAbsenceReport.STATUS_DECLINED,
    }:
        return status
    return CoachAbsenceReport.STATUS_PENDING


def route_absence_report_evidence(report: CoachAbsenceReport, status: str):
    """Move cloud evidence to the container matching the coach's decision."""
    original_blob_location = parse_blob_url(report.evidence_image_url)
    if not original_blob_location:
        return None
    if not azure_configured():
        raise RuntimeError("Evidence storage is not configured.")
    destination_container = (
        settings.AZURE_APPROVED_CONTAINER
        if status == CoachAbsenceReport.STATUS_APPROVED
        else settings.AZURE_REJECTED_CONTAINER
    )
    source_container, blob_name = original_blob_location
    move_blob(source_container, destination_container, blob_name)
    report.evidence_image_url = blob_url(destination_container, blob_name)
    return source_container, destination_container, blob_name


def serialize_absence_report(
    report: CoachAbsenceReport,
    learner=None,
    attendance_rate_override=None,
    previous_absences_override=None,
) -> dict:
    learner_snapshot = (
        serialize_caseload_learner(learner, refresh_live_snapshots=False)
        if learner
        else {}
    )
    reported_by = clean_text(report.reported_by)
    if reported_by not in {"Learner", "Employer", "Coach"}:
        reported_by = "Learner"
    attendance_rate = attendance_rate_override
    if attendance_rate is None:
        attendance_rate = report.attendance_rate if report.attendance_rate is not None else learner_snapshot.get("attendanceRate") or 0
    status = normalize_absence_report_status(report.status)
    evidence_url = resolve_read_url(
        report.evidence_image_url,
        {
            settings.AZURE_QUARANTINE_CONTAINER,
            settings.AZURE_APPROVED_CONTAINER,
            settings.AZURE_REJECTED_CONTAINER,
        },
    )
    return {
        "id": str(report.id),
        "learnerId": str(report.learner_id),
        "learner": report.learner_name,
        "initials": build_initials(report.learner_name),
        "email": report.learner_email or None,
        "programme": clean_text(getattr(learner, "programme", None)) or "--",
        "cohort": learner_snapshot.get("cohortName") or "--",
        "sessionTitle": report.session_title,
        "sessionDate": report.session_date.isoformat(),
        "sessionTime": report.session_time.strftime("%H:%M") if report.session_time else "--",
        "module": report.session_title,
        "tutor": report.owner_name or "--",
        "reasonCategory": report.reason_category,
        "reason": report.reason,
        "reportedBy": reported_by,
        "reportedDate": report.created_at.date().isoformat(),
        "status": status,
        "evidenceProvided": report.evidence_provided,
        "evidenceKind": report.evidence_kind,
        "evidenceType": "Image" if report.evidence_kind == "image" else "Text" if report.evidence_kind == "text" else None,
        "evidenceText": report.evidence_text or None,
        "evidenceImageUrl": evidence_url or None,
        "previousAbsences": previous_absences_override if previous_absences_override is not None else report.previous_absences,
        "attendanceRate": attendance_rate,
        "coachNote": report.coach_note,
        "coachNotes": report.coach_note,
        "decisionDate": report.updated_at.date().isoformat() if status != CoachAbsenceReport.STATUS_PENDING else None,
        "decisionBy": report.owner_name if status != CoachAbsenceReport.STATUS_PENDING else None,
    }


@coach_access_required
def coach_absence_reports(request):
    owner_email = authenticated_coach_email(request)
    active_rows = fetch_owner_active_learner_profiles(owner_email)
    active_ids = {int(row.id) for row in active_rows}
    active_emails = {normalize_email(row.email) for row in active_rows if normalize_email(row.email)}
    active_map = build_learner_profile_map(active_rows)

    if request.method == "PATCH":
        try:
            payload = parse_json_body(request)
            validator = ObjectValidator(payload)
            report_id = validator.integer("id", required=True, minimum=1)
            status = validator.text(
                "status",
                required=True,
                lower=True,
                choices={CoachAbsenceReport.STATUS_APPROVED, CoachAbsenceReport.STATUS_DECLINED},
            )
            coach_note = validator.text("coachNote", max_length=500)
            validator.check()
        except ValidationError as exc:
            return validation_error_response(exc)
        report = CoachAbsenceReport.objects.filter(id=report_id, owner_email__iexact=owner_email).first()
        if not report or (report.learner_id not in active_ids and normalize_email(report.learner_email) not in active_emails):
            return JsonResponse({"detail": "Absence report not found."}, status=404)
        moved_blob = None
        try:
            moved_blob = route_absence_report_evidence(report, status)
        except RuntimeError as exc:
            logger.exception("coach_absence_evidence_route_failed coach_account_id=%s report_id=%s", owner_email, report_id)
            if str(exc) == "Evidence storage is not configured.":
                return coach_error(
                    request,
                    code="storage_unavailable",
                    message="Evidence storage is not configured.",
                    status=503,
                )
            return coach_error(
                request,
                code="storage_unavailable",
                message="Could not move the evidence file in storage.",
                status=502,
            )
        except Exception:
            logger.exception("coach_absence_evidence_route_failed coach_account_id=%s report_id=%s", owner_email, report_id)
            return coach_error(
                request,
                code="storage_unavailable",
                message="Could not move the evidence file in storage.",
                status=502,
            )
        report.status = status
        report.coach_note = coach_note
        update_fields = ["status", "coach_note", "updated_at"]
        if moved_blob:
            update_fields.append("evidence_image_url")
        try:
            report.save(update_fields=update_fields)
        except Exception:
            if moved_blob:
                source_container, current_container, blob_name = moved_blob
                try:
                    move_blob(current_container, source_container, blob_name)
                except Exception:
                    pass
            logger.exception("coach_absence_decision_save_failed coach_account_id=%s report_id=%s", owner_email, report_id)
            return coach_error(
                request,
                code="database_unavailable",
                message="Could not save the absence report decision.",
                status=502,
            )
        attendance_rates = fetch_absence_report_attendance_rates([report.learner_id], [report.learner_email])
        attendance_rate = attendance_rates["by_id"].get(report.learner_id)
        if attendance_rate is None:
            attendance_rate = attendance_rates["by_email"].get(normalize_email(report.learner_email))
        detail_data = fetch_attendance_detail_summary_data([report.learner_id], [report.learner_email])
        detail_rows = detail_data["recordsById"].get(report.learner_id) or detail_data["records"].get(normalize_email(report.learner_email), [])
        previous_absences = count_previous_absences_from_detail_rows(detail_rows, report.session_date)
        return JsonResponse({"item": serialize_absence_report(report, active_map.get(report.learner_id), attendance_rate, previous_absences)})

    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed."}, status=405)

    records = CoachAbsenceReport.objects.filter(owner_email__iexact=owner_email).order_by("-session_date", "learner_name")
    records = [
        report for report in records
        if report.learner_id in active_ids or normalize_email(report.learner_email) in active_emails
    ]
    attendance_rates = fetch_absence_report_attendance_rates(
        [report.learner_id for report in records],
        [report.learner_email for report in records],
    )
    attendance_detail_data = fetch_attendance_detail_summary_data(
        [report.learner_id for report in records],
        [report.learner_email for report in records],
    )
    items = [
        serialize_absence_report(
            report,
            active_map.get(report.learner_id),
            attendance_rates["by_id"].get(report.learner_id)
            if attendance_rates["by_id"].get(report.learner_id) is not None
            else attendance_rates["by_email"].get(normalize_email(report.learner_email)),
            count_previous_absences_from_detail_rows(
                attendance_detail_data["recordsById"].get(report.learner_id)
                or attendance_detail_data["records"].get(normalize_email(report.learner_email), []),
                report.session_date,
            ),
        )
        for report in records
    ]
    return JsonResponse({
        "owner": {"name": fetch_owner_name(owner_email), "email": owner_email},
        "summary": {
            "total": len(items),
            "pending": sum(1 for item in items if item["status"] == CoachAbsenceReport.STATUS_PENDING),
            "approved": sum(1 for item in items if item["status"] == CoachAbsenceReport.STATUS_APPROVED),
            "declined": sum(1 for item in items if item["status"] == CoachAbsenceReport.STATUS_DECLINED),
        },
        "items": items,
    })


MARKING_QUEUE_COLUMNS = """
    id, learner_kind, learner_id, learner_name, programme_name,
    activity_type, activity_id, activity_title, module_title,
    week_title, planned_otjh, status, learning_reflection,
    ksb_codes, ksb_weights, ksb_explanations, confidence_before, confidence_after,
    application_type, application_text, evidence_files,
    evidence_consent_confirmed, selected_benefits,
    benefit_explanation, actual_time_hours,
    completed_during_paid_hours, date_completed, otjh_confirmed,
    signed_declaration, quality_score, coach_feedback, reviewed_by,
    reviewed_at, submitted_at
"""


def serialize_marking_submission(row, *, now=None):
    now = now or timezone.now()
    submitted_at = row["submitted_at"]
    elapsed_days = max((now - submitted_at).days, 0) if submitted_at else 0
    status = "pending" if row["status"] == "submitted_for_tutor_review" else row["status"]
    learner_name = row["learner_name"] or f"Learner {row['learner_id']}"
    initials = "".join(part[:1].upper() for part in learner_name.split()[:2]) or "L"
    return {
        "id": str(row["id"]),
        "learnerKind": row["learner_kind"],
        "learnerId": row["learner_id"],
        "learner": learner_name,
        "initials": initials,
        "programme": row["programme_name"],
        "activityType": row["activity_type"],
        "activityId": row["activity_id"],
        "activityTitle": row["activity_title"],
        "module": row["module_title"],
        "week": row["week_title"],
        "plannedOtjh": row["planned_otjh"],
        "status": status,
        "learningReflection": row["learning_reflection"],
        "ksbCodes": parse_json_value(row["ksb_codes"], []),
        "ksbWeights": parse_json_value(row["ksb_weights"], {}),
        "ksbExplanations": parse_json_value(row["ksb_explanations"], {}),
        "confidenceBefore": parse_json_value(row["confidence_before"], {}),
        "confidenceAfter": parse_json_value(row["confidence_after"], {}),
        "applicationType": row["application_type"],
        "applicationText": row["application_text"],
        "evidenceFiles": parse_json_value(row["evidence_files"], []),
        "evidenceConsentConfirmed": bool(row["evidence_consent_confirmed"]),
        "selectedBenefits": parse_json_value(row["selected_benefits"], []),
        "benefitExplanation": row["benefit_explanation"],
        "actualTimeHours": row["actual_time_hours"],
        "completedDuringPaidHours": row["completed_during_paid_hours"],
        "dateCompleted": row["date_completed"].isoformat() if row["date_completed"] else None,
        "otjhConfirmed": bool(row["otjh_confirmed"]),
        "signedDeclaration": bool(row["signed_declaration"]),
        "qualityScore": row["quality_score"],
        "coachFeedback": row["coach_feedback"],
        "reviewedBy": row["reviewed_by"],
        "reviewedAt": row["reviewed_at"].isoformat() if row["reviewed_at"] else None,
        "submittedAt": submitted_at.isoformat() if submitted_at else None,
        "submittedDisplay": submitted_at.strftime("%d/%m/%Y %H:%M") if submitted_at else "--",
        "elapsedDays": elapsed_days,
        "isOverdue": status == "pending" and elapsed_days >= MARKING_OVERDUE_DAYS,
    }


def empty_marking_queue_response(owner_email, *, page=1, page_size=25):
    return JsonResponse({
        "owner": {"name": fetch_owner_name(owner_email), "email": owner_email},
        "summary": {
            "totalItems": 0,
            "activeLearners": 0,
            "pendingItems": 0,
            "acceptedItems": 0,
            "referredItems": 0,
            "overdueItems": 0,
            "oldestSubmission": "--",
            "overdueThresholdDays": MARKING_OVERDUE_DAYS,
        },
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "totalItems": 0,
            "totalPages": 0,
            "hasNext": False,
            "hasPrevious": page > 1,
        },
        "items": [],
    })


@coach_access_required
def coach_marking_queue(request, submission_id=None):
    """List and review complete reflections, scoped and paged in PostgreSQL."""
    owner_email = authenticated_coach_email(request)
    requested_owner = normalize_email(owner_email)
    allowed_learner_ids = [
        str(learner_id)
        for learner_id in (
            LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
            .filter(coach_email_key=requested_owner)
            .values_list("id", flat=True)
        )
    ]

    if submission_id is not None:
        if request.method == "GET":
            if not allowed_learner_ids:
                return JsonResponse({"detail": "Submission not found."}, status=404)
            try:
                with connections["enrolment"].cursor() as cur:
                    cur.execute(
                        f"""
                        select {MARKING_QUEUE_COLUMNS}
                          from "Learner".learning_reflection_submissions
                         where id = %s and learner_id = any(%s)
                        """,
                        [str(submission_id), allowed_learner_ids],
                    )
                    columns = [column[0] for column in cur.description]
                    value = cur.fetchone()
            except DatabaseError:
                logger.exception("Could not load Coach marking submission.")
                return coach_error(
                    request,
                    code="marking_queue_unavailable",
                    message="Could not load the marking submission.",
                    status=502,
                )
            if not value:
                return JsonResponse({"detail": "Submission not found."}, status=404)
            return JsonResponse({"item": serialize_marking_submission(dict(zip(columns, value)))})

        if request.method not in {"PATCH", "POST"}:
            return JsonResponse({"detail": "Method not allowed."}, status=405)
        try:
            payload = parse_json_body(request)
            validator = ObjectValidator(payload)
            decision = validator.text(
                "decision",
                required=True,
                lower=True,
                choices={"accepted", "partial", "referred", "escalated", "rejected"},
            )
            feedback = validator.text("feedback", max_length=4000)
            reviewed_by = validator.text("reviewedBy", max_length=255, default="Progress Coach") or "Progress Coach"
            if decision and decision != "accepted" and not feedback:
                validator.error("feedback", "Feedback is required for this decision.")
            validator.check()
        except ValidationError as exc:
            return validation_error_response(exc)

        try:
            with connections["enrolment"].cursor() as cur:
                cur.execute(
                    """
                    update "Learner"."learning_reflection_submissions"
                    set status = %s, coach_feedback = %s, reviewed_by = %s, reviewed_at = %s
                    where id = %s and learner_id = any(%s)
                    returning id, status, reviewed_at
                    """,
                    [decision, feedback, reviewed_by, timezone.now(), str(submission_id), allowed_learner_ids],
                )
                updated = cur.fetchone()
        except DatabaseError:
            logger.exception("Could not update Coach marking submission.")
            return coach_error(
                request,
                code="marking_queue_unavailable",
                message="Could not update the marking submission.",
                status=502,
            )
        if not updated:
            return JsonResponse({"detail": "Submission not found."}, status=404)
        return JsonResponse({
            "id": str(updated[0]),
            "status": updated[1],
            "reviewedAt": updated[2].isoformat() if updated[2] else None,
        })

    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed."}, status=405)

    query_validator = ObjectValidator(request.GET)
    page = query_validator.integer("page", default=1, minimum=1)
    requested_page_size = query_validator.integer("page_size", default=25, minimum=1)
    status_filter = clean_text(request.GET.get("status")).lower()
    status_groups = {
        "pending": ["submitted_for_tutor_review", "escalated"],
        "overdue": ["submitted_for_tutor_review"],
        "accepted": ["accepted", "partial"],
        "referred": ["referred", "rejected"],
        "all": [],
    }
    valid_database_statuses = {
        "submitted_for_tutor_review", "accepted", "partial", "referred",
        "escalated", "rejected",
    }
    if status_filter and status_filter not in status_groups and status_filter not in valid_database_statuses:
        query_validator.error("status", "Select a valid marking status.")
    date_from = query_validator.iso_date("date_from")
    date_to = query_validator.iso_date("date_to")
    if date_from and date_to and date_from > date_to:
        query_validator.error("date_to", "Must be on or after date_from.")
    learner_filter = query_validator.text("learner", max_length=128)
    search_filter = query_validator.text("search", max_length=200)
    try:
        query_validator.check()
    except ValidationError as exc:
        return validation_error_response(exc)
    page_size = min(requested_page_size, 100)
    if not allowed_learner_ids:
        return empty_marking_queue_response(owner_email, page=page, page_size=page_size)

    base_clauses = ["learner_id = any(%s)"]
    base_params = [allowed_learner_ids]
    if learner_filter:
        base_clauses.append("learner_id = %s")
        base_params.append(learner_filter)
    if date_from:
        base_clauses.append("submitted_at >= %s")
        base_params.append(date_from)
    if date_to:
        base_clauses.append("submitted_at < %s")
        base_params.append(date_to + timedelta(days=1))
    if search_filter:
        base_clauses.append(
            "(learner_name ilike %s or activity_title ilike %s or module_title ilike %s or week_title ilike %s)"
        )
        search_pattern = f"%{search_filter}%"
        base_params.extend([search_pattern] * 4)

    item_clauses = list(base_clauses)
    item_params = list(base_params)
    if status_filter and status_filter != "all":
        statuses = status_groups.get(status_filter, [status_filter])
        item_clauses.append("status = any(%s)")
        item_params.append(statuses)
    overdue_before = timezone.now() - timedelta(days=MARKING_OVERDUE_DAYS)
    if status_filter == "overdue":
        item_clauses.append("submitted_at <= %s")
        item_params.append(overdue_before)

    base_where = " and ".join(base_clauses)
    item_where = " and ".join(item_clauses)
    offset = (page - 1) * page_size
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                f"""
                select count(*) as total_items,
                       count(distinct (learner_kind, learner_id)) as active_learners,
                       count(*) filter (where status in ('submitted_for_tutor_review', 'escalated')) as pending_items,
                       count(*) filter (where status in ('accepted', 'partial')) as accepted_items,
                       count(*) filter (where status in ('referred', 'rejected')) as referred_items,
                       count(*) filter (
                           where status = 'submitted_for_tutor_review' and submitted_at <= %s
                       ) as overdue_items,
                       min(submitted_at) filter (
                           where status in ('submitted_for_tutor_review', 'escalated')
                       ) as oldest_submission
                  from "Learner".learning_reflection_submissions
                 where {base_where}
                """,
                [overdue_before, *base_params],
            )
            summary_row = cur.fetchone()
            cur.execute(
                f'select count(*) from "Learner".learning_reflection_submissions where {item_where}',
                item_params,
            )
            filtered_total = cur.fetchone()[0]
            cur.execute(
                f"""
                select {MARKING_QUEUE_COLUMNS}
                  from "Learner".learning_reflection_submissions
                 where {item_where}
                 order by case when status = 'submitted_for_tutor_review' then 0 else 1 end,
                          submitted_at asc, id asc
                 limit %s offset %s
                """,
                [*item_params, page_size, offset],
            )
            columns = [column[0] for column in cur.description]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]
    except DatabaseError:
        logger.exception("Could not load Coach marking queue.")
        return coach_error(
            request,
            code="marking_queue_unavailable",
            message="Could not load the marking queue.",
            status=502,
        )
    now = timezone.now()
    items = [serialize_marking_submission(row, now=now) for row in rows]
    total_items, active_learners, pending_items, accepted_items, referred_items, overdue_items, oldest = summary_row
    total_pages = (filtered_total + page_size - 1) // page_size if filtered_total else 0
    return JsonResponse({
        "owner": {"name": fetch_owner_name(owner_email), "email": owner_email},
        "summary": {
            "totalItems": total_items,
            "activeLearners": active_learners,
            "pendingItems": pending_items,
            "acceptedItems": accepted_items,
            "referredItems": referred_items,
            "overdueItems": overdue_items,
            "oldestSubmission": oldest.strftime("%d/%m/%Y %H:%M") if oldest else "--",
            "overdueThresholdDays": MARKING_OVERDUE_DAYS,
        },
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "totalItems": filtered_total,
            "totalPages": total_pages,
            "hasNext": page < total_pages,
            "hasPrevious": page > 1,
        },
        "items": items,
    })


@coach_access_required
@require_GET
def coach_evidence_awaiting_review(request):
    owner_email = authenticated_coach_email(request)

    try:
        items, caseload_learners = fetch_evidence_file_queue(owner_email)
    except Exception:
        logger.exception("coach_evidence_queue_load_failed coach_account_id=%s", owner_email)
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load coach evidence awaiting review data.",
            status=503,
        )

    return JsonResponse(
        {
            "owner": {"email": owner_email},
            "summary": {
                "caseloadLearners": len(caseload_learners),
                "queueLearners": len(items),
                "pendingItems": sum(item["pendingEvidence"] for item in items),
                "totalEvidence": sum(item["totalEvidence"] for item in items),
            },
            "items": items,
        }
    )
