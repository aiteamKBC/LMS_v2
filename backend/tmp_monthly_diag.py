from coach_api.views import (
    build_monthly_activity_learner,
    collect_generated_timetable,
    parse_month_bounds,
    serialize_caseload_learner,
)
from learner_api.models import LearnerProfile
from django.db import connection


start_date, end_date, _month_label, _month_key = parse_month_bounds("2026-08")
rows = list(
    LearnerProfile.objects.filter(coach_email__iexact="gengentb@gmail.com")
    .order_by("full_name")[:10]
)
print("rows", [
    (
        row.id,
        row.full_name,
        row.email,
        row.coach_email,
        getattr(row, "programme", None),
        getattr(row, "lifecycle_status", None),
    )
    for row in rows
])

owner = rows[0].coach_email if rows else ""
print("owner", owner)
events = collect_generated_timetable(owner, start_date=start_date, end_date=end_date).get("events", []) if owner else []
print("events", len(events))

for row in rows:
    learner = serialize_caseload_learner(row, refresh_live_snapshots=False)
    monthly = build_monthly_activity_learner(row, learner, events, start_date, end_date)
    print("learner", learner.get("id"), learner.get("name"), "enrollment", learner.get("enrollmentStatus"))
    print("raw_progress_len", len(row.training_plan_progress or []), "raw_feed_len", len(getattr(row, "activity_feed", []) or []))
    print("monthly_summary", monthly["learning"], monthly["evidence"], monthly["ksb"], monthly["otjh"], "activities", len(monthly["activities"]), monthly["needsAction"])
    print("progress_sample", (row.training_plan_progress or [])[:2])
    print("feed_sample", (getattr(row, "activity_feed", []) or [])[:2])
    print("progress_entries_count", row.progress_entries.count())
    print("progress_entries_month", list(
        row.progress_entries
        .filter(submitted_at__date__gte=start_date, submitted_at__date__lte=end_date)
        .values("id", "kind", "component_title", "reported_time", "submitted_at")[:10]
    ))
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*), coalesce(sum(nullif(actual_time_hours, '')::numeric), 0)
              from "Learner"."learning_reflection_submissions"
             where learner_id in (%s, %s)
               and submitted_at::date between %s and %s
            """,
            [str(row.id), str(row.enrolment_id or ""), start_date, end_date],
        )
        print("reflection_submissions_count_hours", cursor.fetchone())
        cursor.execute(
            """
            select id, learner_kind, learner_id, activity_type, activity_title,
                   actual_time_hours, status, progress_entry_id, submitted_at
              from "Learner"."learning_reflection_submissions"
             where learner_id in (%s, %s)
             order by submitted_at desc nulls last
             limit 10
            """,
            [str(row.id), str(row.enrolment_id or "")],
        )
        print("reflection_samples", cursor.fetchall())
