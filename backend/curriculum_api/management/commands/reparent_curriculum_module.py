"""Move a curriculum module row onto its correct cohort/group parents.

Group names are only unique within a cohort, so before the id-scoped guards in
``contentful_catalogue_id_for_attachment`` and ``resolve_group_row`` a wizard
save that arrived without canonical parent ids could match a same-named group in
a different cohort and write the module there. The target group is then left
with no modules, which surfaces in the UI as an unassigned tutor and a "TBD"
delivery window because both are derived from the child module rows.

This command repairs those rows. It is dry-run by default: pass --apply to
write. The module keeps its cohort and group by id (their names are their own
rows'), and a group's modules are the module rows that name it, so the move is
one update of those two ids. Archived means ``status = 'inactive'``.
"""

from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

MODULES_RELATION = '"curriculum"."modules"'
GROUPS_RELATION = '"curriculum"."groups"'
INACTIVE_STATUSES = ("inactive", "archived")


class Command(BaseCommand):
    help = "Re-parent a curriculum module onto the given cohort/group."

    def add_arguments(self, parser):
        parser.add_argument("--module", required=True, help="module_catalogue_id to move (MOD-...).")
        parser.add_argument("--group", required=True, help="Destination group_id (GROUP-...).")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Perform the write. Without it the command only reports the planned change.",
        )
        parser.add_argument(
            "--allow-outside-cohort-window",
            action="store_true",
            help="Proceed even if the module start date falls outside the destination cohort's window.",
        )

    def _row(self, cursor, sql, params):
        cursor.execute(sql, params)
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(zip([column[0] for column in cursor.description], row))

    def handle(self, *args, **options):
        module_id = options["module"].strip()
        group_id = options["group"].strip()

        with connection.cursor() as cursor:
            module = self._row(
                cursor,
                f"""select m.module_catalogue_id, m.title, m.cohort_id, c.cohort_name, m.group_id, g.group_name,
                           t.name as tutor_name, m.start_date, m.end_date, m.status
                      from {MODULES_RELATION} m
                      left join "curriculum"."cohorts" c on c.cohort_id = m.cohort_id
                      left join {GROUPS_RELATION} g on g.group_id = m.group_id
                      left join "curriculum"."tutors" t on t.id = m.tutor_id
                     where m.module_catalogue_id = %s""",
                [module_id],
            )
            if not module:
                raise CommandError(f"Module {module_id} not found.")
            if (module["status"] or "").strip().lower() in INACTIVE_STATUSES:
                raise CommandError(f"Module {module_id} is soft-deleted; restore it before re-parenting.")

            group = self._row(
                cursor,
                f"""select group_id, group_name, cohort_id, programme_id, status
                      from {GROUPS_RELATION} where group_id = %s""",
                [group_id],
            )
            if not group:
                raise CommandError(f"Group {group_id} not found.")
            if (group["status"] or "").strip().lower() in INACTIVE_STATUSES:
                raise CommandError(f"Group {group_id} is soft-deleted; pick a live destination group.")

            cohort = self._row(
                cursor,
                """select cohort_id, cohort_name, start_date, end_date
                     from "curriculum"."cohorts" where cohort_id = %s""",
                [group["cohort_id"]],
            )
            if not cohort:
                raise CommandError(f"Destination group {group_id} has no resolvable parent cohort.")

            source_group_id = (module["group_id"] or "").strip()
            if source_group_id == group_id:
                self.stdout.write(self.style.SUCCESS(f"{module_id} is already parented to {group_id}; nothing to do."))
                return

            # The API rejects attachments that start outside the cohort window, so
            # a move that would violate it needs an explicit override rather than
            # silently creating a row the wizard itself would refuse to save.
            start = module["start_date"]
            if start and cohort["start_date"] and cohort["end_date"]:
                if not (cohort["start_date"] <= start <= cohort["end_date"]) and not options["allow_outside_cohort_window"]:
                    raise CommandError(
                        f"Module starts {start}, outside cohort {cohort['cohort_name']} "
                        f"({cohort['start_date']} - {cohort['end_date']}). "
                        "Re-run with --allow-outside-cohort-window to override."
                    )

            self.stdout.write(f"module    {module_id} ({module['title']})")
            self.stdout.write(f"  from    {module['cohort_name']} / {module['group_name']} [{source_group_id or 'unparented'}]")
            self.stdout.write(f"  to      {cohort['cohort_name']} / {group['group_name']} [{group_id}]")
            self.stdout.write(f"  tutor   {module['tutor_name'] or '(none)'}  dates {module['start_date']} - {module['end_date']}")

            if not options["apply"]:
                self.stdout.write(self.style.WARNING("Dry run: no changes written. Re-run with --apply."))
                return

            with transaction.atomic():
                cursor.execute(
                    f"""update {MODULES_RELATION}
                           set cohort_id = %s, group_id = %s, updated_at = %s
                         where module_catalogue_id = %s""",
                    [group["cohort_id"], group_id, datetime.utcnow(), module_id],
                )
                moved = cursor.rowcount

        self.stdout.write(self.style.SUCCESS(f"Re-parented {moved} module row."))
        self.stdout.write("Clear the curriculum cache (or wait for expiry) for the change to appear in the UI.")
