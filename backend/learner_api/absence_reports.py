"""Learner-facing absence report API backed by Coach.coach_absence_report."""
import hashlib
import logging
from datetime import date, time
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from coach_api.models import CoachAbsenceReport
from login.permissions import learner_self_only

from .attendance import fetch_kbc_attendance_rows
from .evidence_storage import (
    azure_configured,
    blob_url,
    delete_blob,
    resolve_read_url,
    upload_to_quarantine,
)
from .identity import learner_profile_for_source
from .models import CommercialUser, EnrolmentUser


logger = logging.getLogger(__name__)

ALLOWED_REASONS = {"illness", "work", "emergency", "travel", "technical", "other"}
REASON_LABELS = {
    "illness": "Illness or medical appointment",
    "work": "Work commitment",
    "emergency": "Family or personal emergency",
    "travel": "Travel disruption",
    "technical": "Technical issue",
}
ALLOWED_UPLOAD_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024
UPLOAD_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
DEFAULT_COACH_NAME = "Med Maher"
DEFAULT_COACH_EMAIL = "med.maher@kbc.ac.uk"
KBC_ATTENDANCE_ID_BASE = 8_000_000_000_000_000_000
KBC_ATTENDANCE_ID_RANGE = 1_000_000_000_000_000_000


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _source_learner(kind, learner_id):
    model = {"commercial": CommercialUser, "apprenticeship": EnrolmentUser}.get(kind)
    if model is None:
        return None
    return model.objects.filter(pk=learner_id).first()


def _kbc_rows_for_learner(learner, learner_id):
    learner_email = str(getattr(learner, "email", "") or "").strip()
    learner_name = str(getattr(learner, "username", "") or "").strip() or learner_email
    return fetch_kbc_attendance_rows(
        aptem_id=getattr(learner, "aptem_id", None),
        learner_id=learner_id,
        learner_name=learner_name,
        learner_email=learner_email,
    )


def _fetch_missed_sessions(learner, learner_id):
    """Return this learner's absent sessions from the live KBC register."""
    rows = [
        row for row in _kbc_rows_for_learner(learner, learner_id)
        if str(row.get("attendance_status") or "").strip().lower() == "absent"
    ]

    return [
        {
            "id": f"{row['session_id']}-{row['session_date'].isoformat()}",
            "sessionId": str(row["session_id"]),
            "title": row.get("session_title", "") or "",
            "sessionType": row.get("session_type", "") or "",
            "dateIso": row["session_date"].isoformat(),
            "startTime": row["session_start_time"].strftime("%H:%M") if row.get("session_start_time") else "",
            "endTime": row["session_end_time"].strftime("%H:%M") if row.get("session_end_time") else "",
            "coach": row.get("coach_name", "") or "",
            "module": row.get("module_title", "") or "",
        }
        for row in rows
    ]


def _kbc_attendance_report_id(session_id):
    """Map KBC's text key into CoachAbsenceReport's signed bigint column."""
    digest = hashlib.sha256(str(session_id).encode("utf-8")).digest()
    return KBC_ATTENDANCE_ID_BASE + (
        int.from_bytes(digest[:8], "big") % KBC_ATTENDANCE_ID_RANGE
    )


def _resolve_absent_attendance(
    learner,
    learner_id,
    session_id,
    session_title,
    session_date,
    session_time,
):
    del session_time  # KBC currently records dates, but not lesson start times.
    expected_id = str(session_id or "").strip()
    expected_title = str(session_title or "").strip().casefold()
    matches = [
        row for row in _kbc_rows_for_learner(learner, learner_id)
        if str(row.get("attendance_status") or "").strip().lower() == "absent"
        and row.get("session_date") == session_date
        and str(row.get("session_title") or "").strip().casefold() == expected_title
        and (not expected_id or str(row.get("session_id") or "") == expected_id)
    ]
    if len(matches) != 1:
        return None
    return _kbc_attendance_report_id(matches[0]["session_id"])


def _serialize(report):
    allowed_containers = {
        settings.AZURE_QUARANTINE_CONTAINER,
        settings.AZURE_APPROVED_CONTAINER,
    }
    evidence_url = ""
    if report.status != CoachAbsenceReport.STATUS_DECLINED:
        evidence_url = resolve_read_url(report.evidence_image_url, allowed_containers)
    return {
        "id": report.id,
        "attendanceId": report.attendance_id,
        "reference": f"AR-{report.id:04d}",
        "sessionTitle": report.session_title,
        "sessionDate": report.session_date.isoformat(),
        "sessionTime": report.session_time.strftime("%H:%M") if report.session_time else "",
        "reasonCategory": report.reason_category,
        "reason": report.reason,
        "status": report.status,
        "evidenceProvided": report.evidence_provided,
        "evidenceKind": report.evidence_kind,
        "evidenceUrl": evidence_url,
        "evidenceText": report.evidence_text,
        "coachNote": report.coach_note,
        "attendanceRate": report.attendance_rate,
        "previousAbsences": report.previous_absences,
        "createdAt": report.created_at.isoformat(),
        "updatedAt": report.updated_at.isoformat(),
    }


@csrf_exempt
# Learners report their own absences here; staff/coaches file absences through
# coach_api's own endpoint, so this is learner-self-only (staff write -> 403).
# GET reads stay open (A5, later group).
@learner_self_only(kwarg="learner_id")
def learner_absence_reports(request, kind, learner_id):
    try:
        learner = _source_learner(kind, learner_id)
    except DatabaseError as exc:
        return _error(f"Could not load learner: {exc}", 502)
    if learner is None:
        return _error("Learner not found.", 404)

    learner_email = str(getattr(learner, "email", "") or "").strip()
    learner_name = str(getattr(learner, "username", "") or "").strip() or learner_email

    if request.method == "GET":
        try:
            reports = CoachAbsenceReport.objects.filter(learner_id=learner_id).order_by("-created_at")
            results = [_serialize(report) for report in reports]
            missed_sessions = _fetch_missed_sessions(learner, learner_id)
        except Exception:
            logger.exception(
                "Could not load KBC absence sessions for %s learner %s",
                kind,
                learner_id,
            )
            return _error("Could not load absence reports from KBC.", 502)
        return JsonResponse({
            "count": len(results),
            "results": results,
            "missedSessions": missed_sessions,
        })

    if request.method != "POST":
        return _error("Method not allowed.", 405)

    session_id = request.POST.get("sessionId", "").strip()
    session_title = request.POST.get("sessionTitle", "").strip()
    session_date_text = request.POST.get("sessionDate", "").strip()
    session_time_text = request.POST.get("sessionTime", "").strip()
    reason_category = request.POST.get("reasonCategory", "").strip().lower()
    other_reason = request.POST.get("otherReason", "").strip()
    evidence_text = request.POST.get("explanation", "").strip()
    upload = request.FILES.get("evidence")

    if not session_title or not session_date_text:
        return _error("Session title and date are required.")
    if reason_category not in ALLOWED_REASONS:
        return _error("Choose a valid absence reason.")
    if reason_category == "other" and not other_reason:
        return _error("Please specify the other reason.")
    if not evidence_text and upload is None:
        return _error("Add a written explanation or supporting evidence.")

    try:
        parsed_date = date.fromisoformat(session_date_text)
        parsed_time = time.fromisoformat(session_time_text) if session_time_text else None
    except ValueError:
        return _error("Invalid session date or time.")

    try:
        attendance_id = _resolve_absent_attendance(
            learner,
            learner_id,
            session_id,
            session_title,
            parsed_date,
            parsed_time,
        )
    except Exception:
        logger.exception(
            "Could not validate KBC absence session for %s learner %s",
            kind,
            learner_id,
        )
        return _error("Could not validate the missed session with KBC.", 502)
    if attendance_id is None:
        return _error("Choose a valid missed attendance session.")
    if CoachAbsenceReport.objects.filter(attendance_id=attendance_id).exists():
        return _error("An absence report already exists for this session.", 409)

    if upload is not None:
        if upload.content_type not in ALLOWED_UPLOAD_TYPES:
            return _error("Evidence must be a JPG, PNG, WEBP, or PDF file.")
        if upload.size > MAX_UPLOAD_SIZE:
            return _error("Evidence must be smaller than 10 MB.")
        if not azure_configured():
            return _error("Evidence storage is not configured.", 503)

    try:
        attendance_rate = int(request.POST.get("attendanceRate", ""))
        if not 0 <= attendance_rate <= 100:
            raise ValueError
    except (TypeError, ValueError):
        attendance_rate = None

    active = learner_profile_for_source(learner, learner_id, active_only=True)
    owner_name = str(getattr(active, "coach_name", "") or "").strip() or DEFAULT_COACH_NAME
    owner_email = str(getattr(active, "coach_email", "") or "").strip() or DEFAULT_COACH_EMAIL
    reason = other_reason if reason_category == "other" else REASON_LABELS[reason_category]
    evidence_url = ""
    blob_name = ""
    quarantine_container = settings.AZURE_QUARANTINE_CONTAINER

    if upload is not None:
        extension = UPLOAD_EXTENSIONS[upload.content_type]
        blob_name = f"absence-reports/{kind}/{learner_id}/{uuid4().hex}{extension}"
        try:
            upload_to_quarantine(upload, blob_name, upload.content_type)
            evidence_url = blob_url(quarantine_container, blob_name)
        except Exception:
            logger.exception(
                "Could not upload absence evidence for %s learner %s attendance %s",
                kind,
                learner_id,
                attendance_id,
            )
            try:
                delete_blob(quarantine_container, blob_name)
            except Exception:
                pass
            return _error(
                "Could not upload the evidence to secure storage. Please retry.",
                502,
            )

    try:
        with transaction.atomic():
            previous_absences = CoachAbsenceReport.objects.filter(learner_id=learner_id).count()
            report = CoachAbsenceReport.objects.create(
                attendance_id=attendance_id,
                owner_email=owner_email,
                owner_name=owner_name,
                learner_id=learner_id,
                learner_name=learner_name,
                learner_email=learner_email,
                session_title=session_title,
                session_date=parsed_date,
                session_time=parsed_time,
                reason_category=reason_category,
                reason=reason,
                reported_by=learner_email or learner_name,
                status=CoachAbsenceReport.STATUS_PENDING,
                evidence_provided=bool(upload or evidence_text),
                coach_note="",
                attendance_rate=attendance_rate,
                evidence_image_url=evidence_url,
                evidence_kind="both" if upload and evidence_text else "file" if upload else "text",
                evidence_text=evidence_text,
                previous_absences=previous_absences,
            )
    except Exception:
        logger.exception(
            "Could not save absence report for %s learner %s attendance %s",
            kind,
            learner_id,
            attendance_id,
        )
        if blob_name:
            try:
                delete_blob(quarantine_container, blob_name)
            except Exception:
                pass
        return _error("The evidence was uploaded, but the absence report could not be saved.", 502)

    return JsonResponse(_serialize(report), status=201)
