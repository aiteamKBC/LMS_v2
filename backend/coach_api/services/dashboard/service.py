"""Coach Dashboard read model.

This module is the ownership boundary for ``GET /coach_api/coach/dashboard``.
It deliberately consumes the coach's learner rows once and passes that same
context to every bulk loader.  Detailed caseload, timetable and marking views
must not be called from here.
"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, timedelta

from django.conf import settings

from coach_api.selectors.dashboard.marking import dashboard_marking_projection
from .context import CoachDashboardContext


class CoachDashboardService:
    """Build the dashboard DTO without invoking any detailed endpoint loader."""

    def __init__(self, owner_email: str, *, today: date | None = None):
        self.context = CoachDashboardContext(owner_email, today or date.today())

    # v17 adds consecutive absence counts from the canonical attendance source.
    SCHEMA_VERSION = 17

    def build(self) -> dict:
        """Read the persistent projection; build once only if it is absent."""
        if getattr(settings, "COACH_DASHBOARD_SHARED_READ_MODEL_ENABLED", False):
            from coach_api.read_model import MODEL_KEY, SCOPE_TYPE
            from read_models.repository import get_read_model

            shared = get_read_model(
                MODEL_KEY,
                SCOPE_TYPE,
                self.context.owner_email,
                schema_version=self.SCHEMA_VERSION,
                cache_ttl=max(int(getattr(settings, "COACH_DASHBOARD_CACHE_TTL", 30)), 1),
            )
            if shared is not None:
                payload = dict(shared.payload)
                payload["readModel"] = {
                    "version": shared.schema_version,
                    "refreshedAt": shared.refreshed_at.isoformat(),
                }
                return payload

        # Resolve through the compatibility module so existing patch points and
        # operational tooling remain valid during the module relocation.
        from coach_api import dashboard_service as compatibility
        snapshot = compatibility.CoachDashboardSnapshot.objects.filter(
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
        previous = compatibility.CoachDashboardSnapshot.objects.filter(
            owner_email=self.context.owner_email,
        ).only("payload", "refreshed_at", "schema_version").first()
        if previous is not None:
            return self.refresh_metric_projection(previous.payload)
        return self.refresh()

    def refresh_metric_projection(self, previous_payload: dict) -> dict:
        """Upgrade a prior Dashboard snapshot without rebuilding unrelated domains."""
        from coach_api import dashboard_service as compatibility
        from coach_api import views as domain

        payload = deepcopy(previous_payload)
        learners = payload.get("learners") or []
        rows = domain.fetch_caseload_learner_profiles(self.context.owner_email)
        rows_by_id = {int(row.id): row for row in rows}
        canonical_metrics = domain.caseload_canonical_metrics(rows, learner_workspace=True)
        aptem_by_profile = domain.caseload_aptem_ids(rows)
        attendance_rows = domain.dashboard_attendance_rows(
            rows, learners, aptem_by_profile=aptem_by_profile,
        )
        attendance_by_id = {
            domain.to_int(item.get("id")): item for item in attendance_rows
            if domain.to_int(item.get("id")) is not None
        }
        for learner in learners:
            profile_id = domain.to_int(learner.get("id"))
            if profile_id is None or profile_id not in rows_by_id:
                continue
            row = rows_by_id[profile_id]
            source_row = getattr(row, "_caseload_source", None)
            learner["programme"] = domain.clean_text(
                getattr(source_row, "programme", None) or getattr(row, "programme", None),
            ) or "--"
            domain.apply_canonical_learner_metrics(learner, canonical_metrics.get(profile_id), learner_workspace=True)
            domain.apply_aptem_variance_status(learner, aptem_by_profile.get(profile_id))
            attendance_metrics = attendance_by_id.get(profile_id)
            domain.apply_attendance_summary(learner, attendance_metrics)
            learner["attendanceConsecutiveMissed"] = (
                domain.to_int(attendance_metrics.get("consecutiveMissed"))
                if attendance_metrics else None
            )
            learner["attendanceAvailable"] = bool(learner.get("attendanceRateAvailable"))
        # Marking changed independently of the learner metric fields. Refresh
        # it here so snapshots from the previous schema cannot retain the old
        # all-submission count.
        self.context.rows = rows
        payload["marking"] = dashboard_marking_projection(self.context)
        compatibility.CoachDashboardSnapshot.objects.update_or_create(
            owner_email=self.context.owner_email,
            defaults={"payload": payload, "schema_version": self.SCHEMA_VERSION},
        )
        return payload

    def refresh(self) -> dict:
        from coach_api import dashboard_service as compatibility
        payload = self.build_live()
        snapshot, _created = compatibility.CoachDashboardSnapshot.objects.update_or_create(
            owner_email=self.context.owner_email,
            defaults={"payload": payload, "schema_version": self.SCHEMA_VERSION},
        )
        shared = None
        if getattr(settings, "READ_MODEL_DUAL_WRITE_ENABLED", False):
            from coach_api.read_model import MODEL_KEY, SCOPE_TYPE
            from read_models.repository import put_read_model
            shared = put_read_model(
                MODEL_KEY,
                SCOPE_TYPE,
                self.context.owner_email,
                payload,
                schema_version=self.SCHEMA_VERSION,
                ttl_seconds=max(int(getattr(settings, "COACH_DASHBOARD_SNAPSHOT_MAX_AGE", 30)), 1),
            )
        response_payload = dict(payload)
        response_payload["readModel"] = {
            "version": self.SCHEMA_VERSION,
            "refreshedAt": (shared.refreshed_at if shared else snapshot.refreshed_at).isoformat(),
        }
        return response_payload

    def build_live(self) -> dict:
        # Imported lazily to avoid moving the established domain functions in
        # the same change.  The dependency direction remains one-way: the view
        # calls this service; this service never calls a view/HTTP endpoint.
        from coach_api import views as domain

        context = self.context
        context.rows = domain.fetch_caseload_learner_profiles(context.owner_email)
        context.learners = [
            domain.serialize_caseload_learner(row, refresh_live_snapshots=False)
            for row in context.rows
        ]
        canonical_metrics = domain.caseload_canonical_metrics(context.rows, learner_workspace=True)
        ksb_fallback_rows = [
            row for row in context.rows
            if (
                (canonical_metrics.get(int(row.id)) or {}).get("ksb") or {}
            ).get("status") != "ready"
        ]
        progress_projections = domain.caseload_dashboard_progress_projections(
            context.rows,
            ksb_rows=ksb_fallback_rows,
        )
        audit_totals = domain.caseload_audit_hour_totals(context.rows)
        ksb_counts = domain.caseload_evidenced_ksb_counts(context.rows)
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
        progress_by_learner = domain.caseload_progress_history(context.rows)
        monthly_risk = domain.build_monthly_risk_history(
            context.rows,
            progress_by_learner,
            expected,
            today=context.today,
            hydrated_plans_by_learner=plans,
        )

        owner_name = domain.coach_staff_display_name(context.owner_email) or next(
            (getattr(row, "coach_name", "") for row in context.rows if getattr(row, "coach_name", "")),
            "Coach",
        )
        resolved = domain.resolve_coach_review_events(
            context.owner_email,
            owner_name,
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
        learners_by_id = {int(row.id): row for row in context.rows}
        standalone_events = [
            domain.build_catchup_calendar_event(
                record,
                owner_name=owner_name,
                learner=learners_by_id.get(record.learner_id),
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
            owner_name,
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
            domain.apply_canonical_learner_metrics(learner, canonical_metrics.get(int(row.id)), learner_workspace=True)
            domain.apply_aptem_variance_status(learner, aptem_by_profile.get(int(row.id)))
            attendance_metrics = attendance_by_id.get(int(row.id))
            domain.apply_attendance_summary(learner, attendance_metrics)
            learner["attendanceConsecutiveMissed"] = (
                domain.to_int(attendance_metrics.get("consecutiveMissed"))
                if attendance_metrics else None
            )
            learner["attendanceAvailable"] = bool(learner.get("attendanceRateAvailable"))

        marking = dashboard_marking_projection(context)
        return {
            "owner": {"name": owner_name, "email": context.owner_email},
            "learners": context.learners,
            "monthlyRisk": monthly_risk,
            "assignedGroups": domain.fetch_official_assigned_groups(context.owner_email, owner_name),
            "meetings": {
                "events": preview_events,
                "summary": resolved.get("sourceCounts", {}),
                "reviewGenerationIssues": resolved.get("reviewGenerationIssues", []),
            },
            "marking": marking,
            "errors": {},
        }
