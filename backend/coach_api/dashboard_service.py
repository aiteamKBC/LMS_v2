"""Coach Dashboard read model.

This module is the ownership boundary for ``GET /coach_api/coach/dashboard``.
It deliberately consumes the coach's learner rows once and passes that same
context to every bulk loader.  Detailed caseload, timetable and marking views
must not be called from here.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from django.db import connections
from coach_api.models import CoachDashboardSnapshot


@dataclass
class CoachDashboardContext:
    owner_email: str
    today: date
    rows: list = field(default_factory=list)
    learners: list[dict] = field(default_factory=list)

    @property
    def profile_ids(self) -> list[int]:
        return [int(row.id) for row in self.rows]

    @property
    def enrolment_ids(self) -> list[str]:
        return [str(row.enrolment_id) for row in self.rows if getattr(row, "enrolment_id", None)]


def dashboard_marking_projection(context: CoachDashboardContext) -> dict:
    """One row per learner, never the paginated marking-detail result set."""
    if not context.enrolment_ids:
        return {"summary": {"pendingItems": 0}, "items": []}

    sql = """
        SELECT learner_id,
               MIN(learner_name) AS learner_name,
               COUNT(*) AS pending_count,
               MIN(submitted_at) AS oldest_pending,
               MAX(submitted_at) AS latest_pending
          FROM "Learner".learning_reflection_submissions
         WHERE learner_id = ANY(%s)
           AND status IN ('submitted_for_tutor_review', 'escalated')
         GROUP BY learner_id
         ORDER BY oldest_pending, learner_id
    """
    with connections["enrolment"].cursor() as cursor:
        cursor.execute(sql, [context.enrolment_ids])
        rows = cursor.fetchall()

    profile_by_enrolment = {
        str(row.enrolment_id): row
        for row in context.rows
        if getattr(row, "enrolment_id", None)
    }
    items = []
    total = 0
    for learner_id, learner_name, count, oldest, latest in rows:
        profile = profile_by_enrolment.get(str(learner_id))
        if profile is None:
            continue
        count = int(count or 0)
        total += count
        items.append({
            "id": str(profile.id),
            "learnerId": str(profile.id),
            "learner": learner_name or getattr(profile, "full_name", "") or "Learner",
            "programme": getattr(profile, "programme", "") or "--",
            "group": getattr(profile, "group_name", "") or "--",
            "pendingEvidence": count,
            "submittedAt": oldest.isoformat() if oldest else None,
            "lastSubmissionIso": latest.isoformat() if latest else None,
        })
    return {"summary": {"pendingItems": total}, "items": items}


class CoachDashboardService:
    """Build the dashboard DTO without invoking any detailed endpoint loader."""

    def __init__(self, owner_email: str, *, today: date | None = None):
        self.context = CoachDashboardContext(owner_email, today or date.today())

    # v3 restores canonical programme/KSB ratios and carries attendance detail
    # counts through to the embedded caseload. Do not serve persisted v2 rows.
    SCHEMA_VERSION = 3

    def build(self) -> dict:
        """Read the persistent projection; build once only if it is absent."""
        snapshot = CoachDashboardSnapshot.objects.filter(
            owner_email=self.context.owner_email,
            schema_version=self.SCHEMA_VERSION,
        ).only("payload", "refreshed_at").first()
        if snapshot is not None:
            payload = dict(snapshot.payload)
            payload["readModel"] = {
                "version": self.SCHEMA_VERSION,
                "refreshedAt": snapshot.refreshed_at.isoformat(),
            }
            return payload
        return self.refresh()

    def refresh(self) -> dict:
        payload = self.build_live()
        CoachDashboardSnapshot.objects.update_or_create(
            owner_email=self.context.owner_email,
            defaults={"payload": payload, "schema_version": self.SCHEMA_VERSION},
        )
        return payload

    def build_live(self) -> dict:
        # Imported lazily to avoid moving the established domain functions in
        # the same change.  The dependency direction remains one-way: the view
        # calls this service; this service never calls a view/HTTP endpoint.
        from coach_api import views as domain

        context = self.context
        context.rows = domain.fetch_caseload_dashboard_profiles(context.owner_email)
        context.learners = [domain.serialize_caseload_dashboard_learner(row) for row in context.rows]

        progress_projections = domain.caseload_dashboard_progress_projections(context.rows)
        audit_totals = domain.caseload_audit_hour_totals(context.rows)
        ksb_counts = domain.caseload_evidenced_ksb_counts(context.rows)
        canonical_metrics = domain.caseload_canonical_metrics(context.rows)
        aptem_by_profile = domain.caseload_aptem_ids(context.rows)

        # Dashboard monthly risk uses the already-prefetched learner plan.  It
        # must never hydrate curriculum once per learner.
        plans = {int(row.id): getattr(row, "training_plan", None) or [] for row in context.rows}
        component_ids = [
            component_id
            for plan in plans.values()
            for week in domain.curriculum_monthly_target_hours_weeks(plan)
            for component_id in week
        ]
        expected = domain.curriculum_expected_otjh_by_component_id(component_ids)
        progress_by_learner = {
            int(row.id): [
                entry for entry in domain.list_or_empty(row.training_plan_progress)
                if isinstance(entry, dict)
            ]
            for row in context.rows
        }
        monthly_risk = domain.build_monthly_risk_history(
            context.rows,
            progress_by_learner,
            expected,
            today=context.today,
            hydrated_plans_by_learner=plans,
        )

        resolved = domain.resolve_coach_review_events(
            context.owner_email,
            domain.coach_staff_display_name(context.owner_email) or "Coach",
            context.rows,
        )
        all_review_events = resolved.get("events", [])
        generated_keys = [event.get("eventKey") for event in all_review_events if event.get("eventKey")]
        stored_by_key = domain.fetch_calendar_event_records(context.owner_email, generated_keys) if generated_keys else {}
        all_review_events = [
            domain.overlay_calendar_record(event, stored_by_key.get(event.get("eventKey")))
            for event in all_review_events
        ]
        standalone_records = [
            record for record in domain.fetch_standalone_event_records(context.owner_email)
            if record.event_key not in stored_by_key
        ]
        standalone_type_fields = domain.review_type_fields_by_template(
            getattr(record, "review_template_id", "") for record in standalone_records
        )
        standalone_events = [
            domain.build_catchup_calendar_event(
                record,
                owner_name=domain.coach_staff_display_name(context.owner_email) or "Coach",
                learner={int(row.id): row for row in context.rows}.get(record.learner_id),
                review_type_fields=standalone_type_fields,
            )
            for record in standalone_records
        ]
        preview_events = [
            event for event in all_review_events
            if (parsed := domain.parse_schedule_date(event.get("date")))
            and context.today - timedelta(days=31) <= parsed <= context.today + timedelta(days=90)
        ]
        preview_events.extend(
            event for event in standalone_events
            if (parsed := domain.parse_schedule_date(event.get("date")))
            and context.today - timedelta(days=31) <= parsed <= context.today + timedelta(days=90)
        )
        # Live sessions are already tracked rows.  This is a bounded projection,
        # not timetable recurrence generation.
        preview_events.extend(domain.collect_tracked_live_session_events(
            context.owner_email,
            domain.coach_staff_display_name(context.owner_email) or "Coach",
            start_date=context.today - timedelta(days=31),
            end_date=context.today + timedelta(days=90),
        ))
        preview_events.sort(key=lambda event: (event.get("date") or "", event.get("startHour") or 0))

        last_dates: dict[int, dict] = defaultdict(lambda: {"lastPr": None, "lastMcm": None})
        for event in all_review_events:
            if event.get("status") != "completed":
                continue
            learner_id = domain.to_int(event.get("learnerId"))
            completed = event.get("date") or event.get("scheduledDate")
            if learner_id is None or not completed:
                continue
            key = "lastMcm" if event.get("source") == "mcr" else "lastPr" if event.get("source") == "progress-review" else None
            if key and (last_dates[learner_id][key] is None or completed > last_dates[learner_id][key]):
                last_dates[learner_id][key] = completed

        attendance_rows = domain.dashboard_attendance_rows(
            context.rows, context.learners, aptem_by_profile=aptem_by_profile,
        )
        attendance_by_id = {
            domain.to_int(item.get("id")): item for item in attendance_rows
            if domain.to_int(item.get("id")) is not None
        }
        for row, learner in zip(context.rows, context.learners):
            learner.update(last_dates.get(int(row.id), {"lastPr": None, "lastMcm": None}))
            learner.update(progress_projections.get(int(row.id), {}))
            domain.apply_audit_hour_totals(learner, audit_totals.get(int(row.id)))
            domain.apply_evidenced_ksb_count(learner, ksb_counts.get(int(row.id)))
            domain.apply_canonical_learner_metrics(learner, canonical_metrics.get(int(row.id)))
            domain.apply_aptem_variance_status(learner, aptem_by_profile.get(int(row.id)))
            domain.apply_attendance_summary(learner, attendance_by_id.get(int(row.id)))
            learner["attendanceAvailable"] = bool(learner.get("attendanceRateAvailable"))

        marking = dashboard_marking_projection(context)
        owner_name = domain.coach_staff_display_name(context.owner_email) or next(
            (getattr(row, "coach_name", "") for row in context.rows if getattr(row, "coach_name", "")),
            "Coach",
        )
        return {
            "owner": {"name": owner_name, "email": context.owner_email},
            "learners": context.learners,
            "monthlyRisk": monthly_risk,
            "assignedGroups": domain.fetch_official_assigned_groups(context.owner_email),
            "meetings": {
                "events": preview_events,
                "summary": resolved.get("sourceCounts", {}),
                "reviewGenerationIssues": resolved.get("reviewGenerationIssues", []),
            },
            "marking": marking,
            "errors": {},
        }
