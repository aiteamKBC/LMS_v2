"""Read-only adapters to the existing, learner-owned LMS records."""
import hashlib
import json
from datetime import date, datetime, time, timedelta
from django.db import connections
from .policy import LONDON

def stable_key(kind, *parts):
    return kind + ":" + hashlib.sha256(json.dumps(parts, default=str).encode()).hexdigest()

def assignment_events(components, dates, submissions):
    flagged = any(row.get("monthlyAssignment") for row in components if row.get("type") == "assignment")
    for row in components:
        if row.get("type") != "assignment" or (flagged and not row.get("monthlyAssignment")):
            continue
        cid = str(row["componentId"])
        schedule = dates.get(cid, {})
        if schedule.get("date_needs_review") or schedule.get("date_source") in {"original_created_at", "source_date", "undated"}:
            continue
        day = str(schedule.get("date") or row.get("sessionDate") or "")[:10]
        try:
            planned = date.fromisoformat(day)
            due = date.fromisoformat(str(schedule["week_end"])[:10]) if str(schedule.get("due_timing", "")).strip().lower() == "end of week" else planned.replace(day=21)
        except (ValueError, KeyError):
            continue
        # Every named topic must be submitted; partial submissions remain due.
        topics = [str(x.get("id")) for x in row.get("assignmentTopics", []) if x.get("id")]
        states = submissions.get(cid, {})
        submitted = states.get("") in {"accepted", "submitted_for_tutor_review", "completed"} or (
            bool(topics) and all(states.get(topic) in {"accepted", "submitted_for_tutor_review", "completed"} for topic in topics))
        yield {"key":stable_key("assignment",cid), "kind":"assignment",
               "dueAt":datetime.combine(due,time(9),LONDON), "submitted":submitted,
               "target":{"screen":"work"}}

def task_events(event_key, summary):
    for index, action in enumerate((summary or {}).get("actions", [])):
        if str(action.get("owner", "")).strip().lower() != "learner":
            continue
        try:
            due = date.fromisoformat(str(action.get("dueDate", "")))
        except ValueError:
            continue
        yield {"key":stable_key("task",event_key,index,action.get("title","")), "kind":"task",
               "dueAt":datetime.combine(due,time(9),LONDON),
               "completed":str(action.get("status","")).lower() in {"done","completed","complete","cancelled","canceled"},
               "target":{"screen":"meetings"}}

def events_for(principal):
    if principal.kind != "learner":
        return {}
    from learner_api.models import EnrolmentUser, LearnerProfile
    from learner_api.calendar import coaching_events_for_learner, alternative_recovery_events_for_learner
    from learner_api.attendance_confirmation import read_confirmations
    from learner_api.meeting_attendance import ledger_id, report_key
    from learner_api.absence_reports import _kbc_attendance_report_id
    from learner_api.attendance_lectures import lecture_register, report_id
    from coach_api.models import CoachAbsenceReport, CoachCalendarEvent
    from coach_api.meeting_outcomes import learner_attended_event_keys
    from coach_api.live_session_outcomes import _present_occurrences
    from coach_api.views import stored_coach_meeting_summary
    from learner_api.learner_detail import build_learner_detail
    from learner_api.builder_activity_dates import read_builder_activity_dates

    source = EnrolmentUser.all_learners.get(pk=principal.subject_id)
    profile = LearnerProfile.objects.get(enrolment_id=source.pk,lifecycle_status="active")
    result = []
    approved = {str(x) for x in CoachAbsenceReport.objects.filter(learner_id=source.pk,status="approved").values_list("attendance_id",flat=True)}
    confirmations = read_confirmations(source.pk)
    meetings = coaching_events_for_learner(source,profile) + alternative_recovery_events_for_learner(source.pk)
    attended = learner_attended_event_keys(x.get("calendarEventKey") or x.get("eventKey") for x in meetings)
    for item in meetings:
        if item.get("status") not in {"scheduled","in-progress"} or item.get("bookingStatus") in {"cancelled","deleted","superseded","failed"}:
            continue
        try:
            start = datetime.combine(date.fromisoformat(item["scheduledDate"]),time.fromisoformat(item["scheduledTime"]),LONDON)
        except (ValueError,KeyError,TypeError):
            continue
        key = item.get("calendarEventKey") or item.get("eventKey") or item["id"]
        result.append({"key":stable_key("meeting",key), "kind":"meeting","startsAt":start,
            "attended":key in attended or ledger_id(source,item) in confirmations,
            "authorisedAbsence":str(_kbc_attendance_report_id(report_key(source,item))) in approved,
            "target":{"screen":"meetings"}})
    lectures = lecture_register(source)
    present = _present_occurrences([str(x.get("occurrence_id") or x["session_id"]) for x in lectures],
        learner_profile_id=profile.pk,learner_email=str(profile.email or source.email or ""))
    for row in lectures:
        start = row.get("scheduled_start")
        if not start:
            day, clock = row.get("session_date"), row.get("session_start_time")
            if not day or not clock:continue
            start = datetime.combine(day,clock,LONDON)
        if start.tzinfo is None:start = start.replace(tzinfo=LONDON)
        result.append({"key":stable_key("session",row.get("occurrence_id") or row["session_id"]),
            "kind":"session","startsAt":start,
            "attended":row.get("attendance_status") == "present" or bool(row.get("attendance_confirmed"))
                or str(row.get("occurrence_id") or row["session_id"]) in present,
            "cancelled":str(row.get("status","")).lower() in {"cancelled","canceled","superseded"},
            "authorisedAbsence":str(report_id(row)) in approved, "target":{"screen":"meetings"}})
    # The read_only option prevents plan backfills or progression writes.
    detail = build_learner_detail(source,source.pk,compact=True,read_only=True,quiz_view=True)
    components = detail.get("components",[])
    module_ids = sorted({str(x["moduleId"]) for x in components if x.get("moduleId")})
    with connections["enrolment"].cursor() as cursor:
        dates = read_builder_activity_dates(cursor,module_ids)
        cursor.execute('''SELECT activity_id,assignment_topic_id,status FROM "Learner".learning_reflection_submissions
            WHERE learner_kind=%s AND learner_id=%s AND activity_type='assignment' ''',[str(source.learner_type),str(source.pk)])
        submissions = {}
        for cid,topic,status in cursor.fetchall():submissions.setdefault(str(cid),{})[str(topic or "")] = status
    result.extend(assignment_events(components,dates,submissions))
    # Summary actions remain owned by their actual calendar record. Never infer
    # learner ownership from an overlapping profile/source numeric ID.
    email = str(profile.email or source.email or "").strip()
    if email:
        for record in CoachCalendarEvent.objects.filter(learner_email__iexact=email).order_by("-target_date"):
            saved = stored_coach_meeting_summary(record)
            if saved and saved.get("status") == "ready":
                result.extend(task_events(record.event_key,saved["summary"]))
    return {item["key"]:item for item in result}
