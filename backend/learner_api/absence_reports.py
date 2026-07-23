"""Learner-facing absence report API backed by Coach.coach_absence_report."""
from datetime import date, time
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from coach_api.models import CoachAbsenceReport

from .models import ActiveUser, CommercialUser, EnrolmentUser


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
DEFAULT_COACH_NAME = "Med Maher"
DEFAULT_COACH_EMAIL = "med.maher@kbc.ac.uk"
EVIDENCE_STORAGE = FileSystemStorage(
    location=Path(settings.BASE_DIR) / "media" / "absence-evidence",
    base_url="/media/absence-evidence/",
)
ATTENDANCE_TABLE = '"Coach"."learner_attendance_details"'


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _source_learner(kind, learner_id):
    model = CommercialUser if kind == "commercial" else EnrolmentUser if kind == "apprenticeship" else None
    return model.objects.filter(pk=learner_id).first() if model else None


def _fetch_missed_sessions(learner, learner_id):
    """Return this learner's sessions that are marked absent in attendance."""
    learner_email = str(getattr(learner, "email", "") or "").strip()
    select_sql = f"""
        SELECT session_id, session_title, session_type, session_date,
               session_start_time, session_end_time, coach_name, module_title
        FROM {ATTENDANCE_TABLE}
        WHERE {{learner_filter}}
          AND lower(trim(attendance_status::text)) IN
              ('0', 'false', 'no', 'n', 'absent', 'missed',
               'did not attend', 'non-attendance')
        ORDER BY session_date DESC, session_start_time DESC, id DESC
    """

    with connection.cursor() as cursor:
        rows = []
        if learner_email:
            cursor.execute(
                select_sql.format(
                    learner_filter="lower(trim(learner_email)) = lower(trim(%s))"
                ),
                [learner_email],
            )
            rows = cursor.fetchall()
        if not rows:
            cursor.execute(
                select_sql.format(learner_filter="learner_id = %s"),
                [learner_id],
            )
            rows = cursor.fetchall()

    return [
        {
            "id": f"{row[0]}-{row[3].isoformat()}",
            "sessionId": row[0],
            "title": row[1],
            "sessionType": row[2] or "",
            "dateIso": row[3].isoformat(),
            "startTime": row[4].strftime("%H:%M") if row[4] else "",
            "endTime": row[5].strftime("%H:%M") if row[5] else "",
            "coach": row[6] or "",
            "module": row[7] or "",
        }
        for row in rows
    ]


def _serialize(report):
    return {
        "id": report.id,
        "reference": f"AR-{report.id:04d}",
        "sessionTitle": report.session_title,
        "sessionDate": report.session_date.isoformat(),
        "sessionTime": report.session_time.strftime("%H:%M") if report.session_time else "",
        "reasonCategory": report.reason_category,
        "reason": report.reason,
        "status": report.status,
        "evidenceProvided": report.evidence_provided,
        "evidenceKind": report.evidence_kind,
        "evidenceUrl": report.evidence_image_url,
        "evidenceText": report.evidence_text,
        "coachNote": report.coach_note,
        "attendanceRate": report.attendance_rate,
        "previousAbsences": report.previous_absences,
        "createdAt": report.created_at.isoformat(),
        "updatedAt": report.updated_at.isoformat(),
    }


@csrf_exempt
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
        except DatabaseError as exc:
            return _error(f"Could not load absence reports: {exc}", 502)
        return JsonResponse({
            "count": len(results),
            "results": results,
            "missedSessions": missed_sessions,
        })

    if request.method != "POST":
        return _error("Method not allowed.", 405)

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

    if upload is not None:
        if upload.content_type not in ALLOWED_UPLOAD_TYPES:
            return _error("Evidence must be a JPG, PNG, WEBP, or PDF file.")
        if upload.size > MAX_UPLOAD_SIZE:
            return _error("Evidence must be smaller than 10 MB.")

    try:
        attendance_rate = int(request.POST.get("attendanceRate", ""))
        if not 0 <= attendance_rate <= 100:
            raise ValueError
    except (TypeError, ValueError):
        attendance_rate = None

    active = ActiveUser.objects.filter(id=learner_id).first()
    owner_name = str(getattr(active, "coach_name", "") or "").strip() or DEFAULT_COACH_NAME
    owner_email = str(getattr(active, "coach_email", "") or "").strip() or DEFAULT_COACH_EMAIL
    reason = other_reason if reason_category == "other" else REASON_LABELS[reason_category]
    evidence_url = ""
    saved_name = ""

    try:
        if upload is not None:
            extension = Path(upload.name).suffix.lower()
            saved_name = EVIDENCE_STORAGE.save(f"{uuid4().hex}{extension}", upload)
            evidence_url = EVIDENCE_STORAGE.url(saved_name)

        with transaction.atomic():
            previous_absences = CoachAbsenceReport.objects.filter(learner_id=learner_id).count()
            report = CoachAbsenceReport.objects.create(
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
                status="Pending",
                evidence_provided=bool(upload or evidence_text),
                coach_note="",
                attendance_rate=attendance_rate,
                evidence_image_url=evidence_url,
                evidence_kind="both" if upload and evidence_text else "file" if upload else "text",
                evidence_text=evidence_text,
                previous_absences=previous_absences,
            )
    except (DatabaseError, OSError) as exc:
        if saved_name:
            EVIDENCE_STORAGE.delete(saved_name)
        return _error(f"Could not save absence report: {exc}", 502)

    return JsonResponse(_serialize(report), status=201)
