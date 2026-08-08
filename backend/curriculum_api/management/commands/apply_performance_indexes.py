from dataclasses import dataclass

from django.core.management.base import BaseCommand, CommandError
from django.db import connections


@dataclass(frozen=True)
class PerformanceIndex:
    name: str
    relation: str
    columns: str
    database: str = "default"


# These indexes follow the filters and ordering used by the API views. Most LMS
# tables are externally managed, so model Meta.indexes/migrations would not
# create them. Keeping the definitions here gives every environment one
# idempotent deployment command instead of modifying historical migrations.
PERFORMANCE_INDEXES = (
    # Curriculum and quizzes.
    PerformanceIndex("perf_quiz_filter_updated_idx", '"curriculum"."quizzes"', "assessment_type, status, updated_at DESC"),
    PerformanceIndex("perf_quiz_programme_week_idx", '"curriculum"."quizzes"', "programme_id, week_id, status"),
    PerformanceIndex("perf_quiz_question_active_order_idx", '"curriculum"."quiz_questions"', "quiz_id, is_archived, sort_order, id"),
    PerformanceIndex("perf_quiz_answer_order_idx", '"curriculum"."quiz_answers"', "question_id, sort_order, id"),
    PerformanceIndex("perf_live_session_module_date_idx", '"curriculum"."live_sessions"', "module_catalogue_id, start_datetime"),
    PerformanceIndex("perf_live_occurrence_session_date_idx", '"curriculum"."live_session_occurrences"', "live_session_id, scheduled_start"),
    PerformanceIndex("perf_live_attendance_occurrence_email_idx", '"curriculum"."live_session_attendance"', "occurrence_id, email"),

    # Coach calendars and reporting.
    PerformanceIndex("coach_owner_date_status_idx", '"Coach"."coach_calendar_event"', "owner_email, target_date, status"),
    PerformanceIndex("coach_learner_type_date_idx", '"Coach"."coach_calendar_event"', "learner_id, event_type, target_date"),
    PerformanceIndex("coach_abs_owner_status_idx", '"Coach"."coach_absence_report"', "owner_email, status, session_date DESC"),
    PerformanceIndex("coach_abs_learner_date_idx", '"Coach"."coach_absence_report"', "learner_id, session_date DESC"),

    # Learner lists, plans, progress and dashboard feeds.
    PerformanceIndex("perf_learner_lifecycle_programme_idx", '"Learner"."learners"', "lifecycle_status, programme, id"),
    PerformanceIndex("perf_learner_coach_email_idx", '"Learner"."learners"', "(lower(btrim(coach_email))), full_name, id"),
    PerformanceIndex("perf_plan_module_learner_order_idx", '"Learner"."learner_training_plan_modules"', "learner_id, position, id"),
    PerformanceIndex("perf_plan_week_module_order_idx", '"Learner"."learner_training_plan_weeks"', "plan_module_id, position, id"),
    PerformanceIndex("perf_plan_component_week_order_idx", '"Learner"."learner_training_plan_components"', "plan_week_id, position, id"),
    PerformanceIndex("perf_progress_learner_order_idx", '"Learner"."learner_progress_entries"', "learner_id, entry_order, id"),
    PerformanceIndex("perf_progress_feed_learner_date_idx", '"Learner"."learner_progress_entries"', "learner_id, feed_occurred_at DESC"),
    PerformanceIndex("perf_learner_ksb_order_idx", '"Learner"."learner_ksbs"', "learner_id, position, id"),
    PerformanceIndex("perf_absence_learner_id_idx", '"Learner"."Absence"', "learner_id"),

    # Engagement collections and learner-scoped totals.
    PerformanceIndex("perf_claim_learner_status_date_idx", '"Engagement"."voucher_claims"', "learner_id, status, requested_at DESC"),
    PerformanceIndex("perf_recognition_learner_date_idx", '"Engagement"."recognitions"', "learner_id, awarded_at DESC"),
    PerformanceIndex("perf_event_status_created_idx", '"Engagement"."events"', "status, created_at DESC"),
    PerformanceIndex("perf_booking_learner_date_idx", '"Engagement"."event_bookings"', "learner_id, booked_at DESC"),
    PerformanceIndex("perf_meeting_club_idx", '"Engagement"."club_meetings"', "club_id, id"),
    PerformanceIndex("perf_grant_learner_date_idx", '"Engagement"."points_grants"', "learner_id, awarded_at DESC"),
    PerformanceIndex("perf_rule_key_active_idx", '"Engagement"."points_rules"', "key, active"),
    PerformanceIndex("perf_deck_status_updated_idx", '"Engagement"."flash_card_decks"', "status, updated_at DESC"),
    PerformanceIndex("perf_deck_week_programme_idx", '"Engagement"."flash_card_decks"', "week_id, programme_id"),
    PerformanceIndex("perf_card_deck_order_idx", '"Engagement"."flash_cards"', "deck_id, sort_order, id"),
    PerformanceIndex("perf_card_view_learner_idx", '"Engagement"."flash_card_views"', "learner_id, flash_card_id"),

    # Enrolment and onboarding wizard reads.
    PerformanceIndex("perf_created_user_type_status_idx", '"enrolment"."Created_users"', '"Learner_type", "Programme_status", id', "enrolment"),
    PerformanceIndex("perf_staff_position_name_idx", '"enrolment"."Staff_users"', '"Position", "Username", id', "enrolment"),
    PerformanceIndex("perf_extended_ilr_learner_idx", '"enrolment"."Extended_ILR"', '"Learner_kind", "Learner_id"', "enrolment"),
    PerformanceIndex("perf_wizard_personal_learner_idx", '"enrolment"."Wizard_Personal_Details"', '"Learner_kind", "Learner_id"', "enrolment"),
    PerformanceIndex("perf_wizard_radar_learner_idx", '"enrolment"."Wizard_Skills_Radar"', '"Learner_kind", "Learner_id"', "enrolment"),
    PerformanceIndex("perf_wizard_ksb_learner_idx", '"enrolment"."Wizard_Ksb_Assessments"', '"Learner_kind", "Learner_id", "Ksb_id"', "enrolment"),
    PerformanceIndex("perf_wizard_plr_learner_idx", '"enrolment"."Wizard_Plr"', '"Learner_kind", "Learner_id"', "enrolment"),
    PerformanceIndex("perf_wizard_plr_record_learner_idx", '"enrolment"."Wizard_Plr_Records"', '"Learner_kind", "Learner_id", id', "enrolment"),
    PerformanceIndex("perf_wizard_cv_learner_idx", '"enrolment"."Wizard_Cv_Job"', '"Learner_kind", "Learner_id"', "enrolment"),
    PerformanceIndex("perf_wizard_policy_learner_idx", '"enrolment"."Wizard_Policy_Acks"', '"Learner_kind", "Learner_id", "Policy_id"', "enrolment"),

    # Audit learner-log filters and ordering (normally a separate DB alias).
    PerformanceIndex("perf_mre_month_date_idx", '"Audit"."mre"', "month_no, unit_planned_date, plan_id", "audit"),
    PerformanceIndex("perf_mre_activity_date_idx", '"Audit"."mre"', "activity_date, month_no", "audit"),
    PerformanceIndex("perf_mre_category_month_idx", '"Audit"."mre"', "activity_category, month_no", "audit"),
)


class Command(BaseCommand):
    help = "Create the LMS query indexes on every configured PostgreSQL database."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Print work without creating indexes.")
        parser.add_argument(
            "--database",
            action="append",
            dest="databases",
            help="Limit work to a database alias. May be passed more than once.",
        )

    def handle(self, *args, **options):
        requested = options["databases"] or list(connections)
        unknown = sorted(set(requested) - set(connections))
        if unknown:
            raise CommandError(f"Unknown database alias(es): {', '.join(unknown)}")

        created = skipped = 0
        for alias in requested:
            connection = connections[alias]
            if connection.vendor != "postgresql":
                self.stdout.write(self.style.WARNING(f"[{alias}] skipped: PostgreSQL indexes are not applicable."))
                continue

            indexes = [item for item in PERFORMANCE_INDEXES if item.database == alias]
            if alias == "default":
                # When enrolment/audit have no dedicated alias their tables are
                # routed through default, so include their definitions there.
                if "enrolment" not in connections:
                    indexes.extend(item for item in PERFORMANCE_INDEXES if item.database == "enrolment")
                if "audit" not in connections:
                    indexes.extend(item for item in PERFORMANCE_INDEXES if item.database == "audit")

            with connection.cursor() as cursor:
                for item in indexes:
                    cursor.execute("select to_regclass(%s)", [item.relation])
                    if cursor.fetchone()[0] is None:
                        skipped += 1
                        self.stdout.write(f"[{alias}] skip missing {item.relation}")
                        continue
                    sql = f'CREATE INDEX IF NOT EXISTS "{item.name}" ON {item.relation} ({item.columns})'
                    if options["dry_run"]:
                        self.stdout.write(f"[{alias}] would create {item.name}")
                    else:
                        cursor.execute(sql)
                        self.stdout.write(self.style.SUCCESS(f"[{alias}] ready {item.name}"))
                    created += 1

        action = "planned" if options["dry_run"] else "ready"
        self.stdout.write(self.style.SUCCESS(f"Performance indexes {action}: {created}; missing tables skipped: {skipped}."))
