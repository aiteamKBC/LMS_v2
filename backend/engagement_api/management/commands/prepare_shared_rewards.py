"""Prepare the exact pilot disabled; activation is explicit and uses server time."""
import calendar
from datetime import date
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction
from django.utils import timezone
from engagement_api.models import PointsRule
from engagement_api.reward_policy import HOUR_RULE, QUIZ_RULE, BONUS_RULE
from engagement_api.shared_reward_setup import PILOT_MODULE, require_same_database, require_global_ready, operator_reference

RULES = (
    (HOUR_RULE, "Accepted learning hour", "One point per whole accepted active study hour."),
    (QUIZ_RULE, "First submitted quiz", "At least 70 percent: one point per correct answer; perfect first submission: two."),
    (BONUS_RULE, "Verified learning bonus", "Staff-verified once-only opportunities under the current shared reward policy."),
)

def date_argument(value):
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise CommandError("Use a date in YYYY-MM-DD format.") from None

class Command(BaseCommand):
    help = "Prepare disabled Stakeholder Management and Reporting rewards, or explicitly activate at the current UTC instant."

    def add_arguments(self, parser):
        parser.add_argument("--operator", required=True)
        parser.add_argument("--programme-start", type=date_argument)
        parser.add_argument("--module-end", type=date_argument)
        parser.add_argument("--semester-end", type=date_argument)
        parser.add_argument("--masterclass-event-id", type=int)
        parser.add_argument("--activate-now", action="store_true")

    def handle(self, *args, **options):
        require_same_database()
        operator = operator_reference(options["operator"])
        if options["activate_now"]:
            require_global_ready()
        semester = options.get("semester_end")
        if semester and (semester.month not in (1, 4, 9) or semester.day < calendar.monthrange(semester.year, semester.month)[1] - 6):
            raise CommandError("Semester end must be in the last seven days of January, April or September.")
        with transaction.atomic(using="default"), connections["default"].cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ["engagement:shared-reward-setup"])
            cursor.execute('INSERT INTO "Engagement".shared_reward_config(module_id,updated_by) VALUES(%s,%s) ON CONFLICT DO NOTHING',
                           [PILOT_MODULE, operator])
            cursor.execute('SELECT enabled,starts_at,programme_start,module_end,semester_end,masterclass_event_id FROM "Engagement".shared_reward_config WHERE module_id=%s FOR UPDATE', [PILOT_MODULE])
            enabled, starts_at, began, end, prior_semester, prior_event = cursor.fetchone()
            if options["activate_now"] and starts_at is not None and not enabled:
                raise CommandError("An existing cutover cannot be reset. Review the disabled policy before resuming.")
            began = options.get("programme_start") or began
            end = options.get("module_end") or end
            semester = semester or prior_semester
            event = options.get("masterclass_event_id") if options.get("masterclass_event_id") is not None else prior_event
            if began and end and end < began:
                raise CommandError("Module end must not precede programme start.")
            if event is not None:
                if event <= 0:
                    raise CommandError("An existing positive masterclass event ID is required.")
                cursor.execute('SELECT 1 FROM "Engagement".events WHERE id=%s', [event])
                if not cursor.fetchone():
                    raise CommandError("The configured masterclass event does not exist.")
            for key, name, description in RULES:
                rows = list(PointsRule.objects.select_for_update().filter(key=key))
                if len(rows) > 1:
                    raise CommandError("A reserved shared-reward rule has duplicate rows; resolve before activation.")
                if rows:
                    rule = rows[0]
                    if rule.points != 0 or rule.trigger != key:
                        raise CommandError("A reserved shared-reward rule has conflicting configuration.")
                else:
                    rule = PointsRule.objects.create(key=key,name=name,description=description,points=0,
                        category="Learning",frequency="Per verified event",trigger=key,active=False)
                if options["activate_now"] and not rule.active:
                    rule.active = True
                    rule.save(update_fields=["active", "updated_at"])
            if options["activate_now"] and starts_at is None:
                starts_at = timezone.now()
                enabled = True
            cursor.execute('UPDATE "Engagement".shared_reward_config SET enabled=%s,starts_at=%s,programme_start=%s,module_end=%s,semester_end=%s,masterclass_event_id=%s,updated_by=%s,updated_at=now() WHERE module_id=%s',
                           [enabled, starts_at, began, end, semester, event, operator, PILOT_MODULE])
        self.stdout.write("Shared rewards policy " + ("enabled; original cutover preserved." if enabled else "prepared disabled."))
