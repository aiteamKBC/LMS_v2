"""Learner-facing absence report API backed by Coach.coach_absence_report."""
import hashlib
import logging
from datetime import date, datetime, time
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, IntegrityError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from coach_api.models import CoachAbsenceReport, CoachCalendarEvent
from login.permissions import learner_self_or_admin

from .attendance_lectures import lecture_register, session_key, report_id
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
    return model.all_learners.filter(pk=learner_id).first()


def _attendance_rows_for_learner(learner, learner_id, *, meetings=False, kind=None):
    if meetings:
        from .meeting_attendance import absence_rows
        return absence_rows(learner, kind or getattr(learner, 'learner_type', None) or 'apprenticeship')
    return lecture_register(learner)


def _can_report_absence(row):
    status = str(row.get('attendance_status') or '').strip().lower()
    return status in {'absent', 'upcoming', 'in_progress'} or (
        status == 'pending' and row.get('session_date') == timezone.localdate())


def _fetch_missed_sessions(learner, learner_id, *, meetings=False, kind=None):
    """Both registers, including real upcoming occurrences, scoped to this learner."""
    rows = [
        row for row in (_attendance_rows_for_learner(learner, learner_id, meetings=True, kind=kind) if meetings else _attendance_rows_for_learner(learner, learner_id))
        if _can_report_absence(row)
    ]

    return [
        {
            "id": f"{session_key(row)}-{row['session_date'].isoformat()}",
            "sessionId": session_key(row),
            "reportId": str(report_id(row)),
            "status": row['attendance_status'],
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
    kind=None,
):
    del session_time  # Source identity/date/title, not a client-supplied time, authorises the report.
    expected_id = str(session_id or "").strip()
    expected_title = str(session_title or "").strip().casefold()
    matches = [
        row for row in (_attendance_rows_for_learner(learner, learner_id, meetings=True, kind=kind) if expected_id.startswith('meeting:') else _attendance_rows_for_learner(learner, learner_id))
        if _can_report_absence(row)
        and row.get("session_date") == session_date
        and str(row.get("session_title") or "").strip().casefold() == expected_title
        and (not expected_id or session_key(row) == expected_id)
    ]
    if len(matches) != 1:
        return None
    return report_id(matches[0])


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
        "attendanceId": str(report.attendance_id),
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
        "recoveryMethod": report.recovery_method,
        "catchupEventKey": report.catchup_event_key,
        "attendanceRate": report.attendance_rate,
        "previousAbsences": report.previous_absences,
        "createdAt": report.created_at.isoformat(),
        "updatedAt": report.updated_at.isoformat(),
    }


class RecoveryPlanError(ValueError):
    pass


def _catchup_booking(learner, mirror, event_key, session_date, *, lock=False):
    """Recheck the saved appointment; matching IDs never override another email."""
    query = CoachCalendarEvent.objects
    if lock:
        query = query.select_for_update()
    booking = query.filter(event_key=event_key).first()
    emails = {str(getattr(person, 'email', '') or '').strip().casefold()
              for person in (learner, mirror)} - {''}
    ids = {str(getattr(person, 'id', '')) for person in (learner, mirror) if person is not None}
    email = str(getattr(booking, 'learner_email', '') or '').strip().casefold()
    belongs = booking is not None and (email in emails if email else str(booking.learner_id) in ids)
    if not belongs or booking.event_type != 'catch-up':
        raise RecoveryPlanError('Choose one of your own catch-up bookings.')
    if (booking.status not in {'not-scheduled', 'scheduled', 'in-progress'}
            or not booking.scheduled_date or not booking.scheduled_time):
        raise RecoveryPlanError('This catch-up booking is no longer available. Book or select another session.')
    start = datetime.combine(booking.scheduled_date, booking.scheduled_time)
    if booking.scheduled_date < session_date or start <= timezone.localtime().replace(tzinfo=None):
        raise RecoveryPlanError('Choose a future catch-up session on or after the lecture date.')
    return booking


@csrf_exempt
# Learners and admins use the learner workspace; coaches use coach_api.
@learner_self_or_admin(kwarg="learner_id")
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
            missed_sessions = _fetch_missed_sessions(learner, learner_id, meetings=True, kind=kind) if request.GET.get('scope') == 'meetings' else _fetch_missed_sessions(learner, learner_id)
        except Exception:
            logger.exception(
                "Could not load absence sessions for %s learner %s",
                kind,
                learner_id,
            )
            return _error("Could not load absence reports and sessions.", 502)
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
    recovery_method = request.POST.get("recoveryMethod", "").strip()
    catchup_event_key = request.POST.get("catchupEventKey", "").strip()
    upload = request.FILES.get("evidence")

    if not session_title or not session_date_text:
        return _error("Session title and date are required.")
    if reason_category not in ALLOWED_REASONS:
        return _error("Choose a valid absence reason.")
    meeting_absence = session_id.startswith('meeting:')
    if meeting_absence and (recovery_method or catchup_event_key):
        return _error('Report the meeting absence, then reschedule the meeting with your coach.')
    if not meeting_absence and recovery_method not in {'recorded', 'catch-up'}:
        return _error('Choose whether to watch the recording or book a catch-up session.')
    if recovery_method == 'catch-up' and (not catchup_event_key or len(catchup_event_key) > 255):
        return _error('Book or select a catch-up session before submitting your absence report.')
    if recovery_method == 'recorded' and catchup_event_key:
        return _error('A recording recovery plan cannot include a catch-up booking.')
    if reason_category == "other" and not other_reason:
        return _error("Please specify the other reason.")
    if len(evidence_text) > 600 or len(other_reason) > 120 or len(session_title) > 255:
        return _error("Absence details are too long.")

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
            kind=kind,
        )
    except Exception:
        logger.exception(
            "Could not validate absence session for %s learner %s",
            kind,
            learner_id,
        )
        return _error("Could not validate the attendance session.", 502)
    if attendance_id is None:
        return _error("Choose a valid absent, upcoming or in-progress session.")
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
    if recovery_method == 'catch-up':
        try:
            _catchup_booking(learner, active, catchup_event_key, parsed_date)
        except RecoveryPlanError as exc:
            return _error(str(exc))
        except DatabaseError:
            return _error('Could not verify the catch-up booking. Please retry.', 502)
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
            if recovery_method == 'catch-up':
                _catchup_booking(learner, active, catchup_event_key, parsed_date, lock=True)
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
                recovery_method=recovery_method,
                catchup_event_key=catchup_event_key or None,
                attendance_rate=attendance_rate,
                evidence_image_url=evidence_url,
                evidence_kind="both" if upload and evidence_text else "file" if upload else "text" if evidence_text else "none",
                evidence_text=evidence_text,
                previous_absences=previous_absences,
            )
    except RecoveryPlanError as exc:
        if blob_name:
            try:
                delete_blob(quarantine_container, blob_name)
            except Exception:
                pass
        return _error(str(exc), 409)
    except IntegrityError:
        # Another submission may have saved the same lecture after validation.
        # The unique attendance_id still guarantees a single report.
        if blob_name:
            try:
                delete_blob(quarantine_container, blob_name)
            except Exception:
                pass
        if CoachAbsenceReport.objects.filter(attendance_id=attendance_id).exists():
            return _error("An absence report already exists for this session.", 409)
        logger.exception('Could not save absence report')
        return _error('The absence report could not be saved. Please retry.', 502)
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
