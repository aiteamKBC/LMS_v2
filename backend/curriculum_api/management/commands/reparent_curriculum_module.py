"""Move a curriculum module row onto its correct cohort/group parents.

Group names are only unique within a cohort, so before the id-scoped guards in
``contentful_catalogue_id_for_attachment`` and ``resolve_group_row`` a wizard
save that arrived without canonical parent ids could match a same-named group in
a different cohort and write the module there. The target group is then left
with no modules, which surfaces in the UI as an unassigned tutor and a "TBD"
delivery window because both are derived from the child module rows.

This command repairs those rows. It is dry-run by default: pass --apply to
write. Reads and writes go through the same normalized tables the API uses, and
the affected groups' module_ids/module_names are rebuilt from curriculum.modules
rather than edited in place, so the cached lists cannot drift from the rows.
"""

import json
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

MODULES_RELATION = '"curriculum"."modules"'
GROUPS_RELATION = '"curriculum"."groups"'


class Command(BaseCommand):
    help = "Re-parent a curriculum module onto the given cohort/group and rebuild affected group module lists."

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
                f"""select module_catalogue_id, title, cohort_id, cohort_name, group_id, group_name,
                           tutor_name, start_date, end_date, deleted_at
                      from {MODULES_RELATION} where module_catalogue_id = %s""",
                [module_id],
            )
            if not module:
                raise CommandError(f"Module {module_id} not found.")
            if module["deleted_at"] is not None:
                raise CommandError(f"Module {module_id} is soft-deleted; restore it before re-parenting.")

            group = self._row(
                cursor,
                f"""select group_id, group_name, cohort_id, cohort_name, programme_id, deleted_at
                      from {GROUPS_RELATION} where group_id = %s""",
                [group_id],
            )
            if not group:
                raise CommandError(f"Group {group_id} not found.")
            if group["deleted_at"] is not None:
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

            affected = [gid for gid in {source_group_id, group_id} if gid]
            with transaction.atomic():
                cursor.execute(
                    f"""update {MODULES_RELATION}
                           set cohort_id = %s, cohort_name = %s, group_id = %s, group_name = %s, updated_at = %s
                         where module_catalogue_id = %s""",
                    [
                        group["cohort_id"],
                        cohort["cohort_name"] or "",
                        group_id,
                        group["group_name"] or "",
                        datetime.utcnow(),
                        module_id,
                    ],
                )
                moved = cursor.rowcount
                for gid in affected:
                    cursor.execute(
                        f"""select module_catalogue_id, title from {MODULES_RELATION}
                             where group_id = %s and deleted_at is null
                             order by created_at, module_catalogue_id""",
                        [gid],
                    )
                    rows = cursor.fetchall()
                    cursor.execute(
                        f"update {GROUPS_RELATION} set module_ids = %s, module_names = %s, updated_at = %s where group_id = %s",
                        [
                            json.dumps([r[0] for r in rows]),
                            json.dumps([r[1] for r in rows]),
                            datetime.utcnow(),
                            gid,
                        ],
                    )
                    self.stdout.write(f"  rebuilt {gid}: {len(rows)} module(s)")

        self.stdout.write(self.style.SUCCESS(f"Re-parented {moved} module row; rebuilt {len(affected)} group list(s)."))
        self.stdout.write("Clear the curriculum cache (or wait for expiry) for the change to appear in the UI.")
