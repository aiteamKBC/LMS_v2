"""Bring the audited modules back into the curriculum workspace.

The ``programme_audit`` schema holds a snapshot of twelve modules' authored
content -- the material that was built for learners and is already sitting in
``curriculum.modules`` / ``weeks`` / ``components``. Nothing needs importing:
every one of those 2,998 components is already there.

What happened is that their parent programme row ("MM",
``PROG-20260824104138483006``) was deleted on 2026-09-09. That was a
``programme-delete``, so it cascaded: 74 modules, 843 weeks and 9,115
components were flagged ``deleted_via_parent`` beneath it. Every curriculum read
filters on ``deleted_at is null and not is_programme_deleted``, so the
curriculum team's workspace stopped showing them.

This un-deletes exactly the modules the audit tables cover, and their weeks and
components -- nothing else under that programme, and nothing about the
programme row itself.

Deliberately NOT touched
------------------------
``programme_id`` / ``programme_name`` stay as they are. The restored modules sit
under "Marketing Manager", "MM" and "Project Controls Professional", while
learners are enrolled on "... Level 6" -- so this does not put them into anyone's
learning plan, and is not meant to. Learner plans were assigned separately and
are left alone.

The parent programme row also stays deleted. A module read does not consult it;
``is_programme_deleted`` on the module is the flag that matters, and that is
what this clears.

    python manage.py restore_audit_modules
    python manage.py restore_audit_modules --apply
"""
from django.core.management.base import BaseCommand
from django.db import DatabaseError, connection, transaction

#: The audit tables whose modules should be visible again. Named explicitly
#: rather than discovered from the schema, so adding a table to
#: ``programme_audit`` cannot silently widen what this restores.
AUDIT_TABLES = [
    "ai_in_marketing",
    "commercial_intelligence",
    "customer_journey",
    "earned_value_management_portfolio_management",
    "impact_planning",
    "managing_successful_programmes_scheduling_professional",
    "marketing_technology",
    "project_management_professional",
    "project_planning_control_project_management_office",
    "risk_management",
    "social_media",
    "strategy_planning",
]

#: ``ai_in_marketing`` came from a different source and carries no
#: ``module_catalogue_id`` -- its rows match the curriculum by title instead.
#: The module is named here so it is restored with the rest.
EXTRA_MODULE_IDS = ["MOD-AI-IN-MARKETING-MM"]


def audit_module_ids(cursor):
    """Every curriculum module id the audit tables refer to."""
    union = " union ".join(
        f'select distinct module_catalogue_id from programme_audit."{table}"'
        for table in AUDIT_TABLES
    )
    cursor.execute(
        f"select module_catalogue_id from ({union}) x "
        "where coalesce(module_catalogue_id, '') <> ''"
    )
    ids = [row[0] for row in cursor.fetchall()]
    return sorted(set(ids) | set(EXTRA_MODULE_IDS))


def _normalise(title):
    """A title reduced to letters and digits, for matching across the two sides.

    The legacy group name and the curriculum module title are the same string
    typed twice, so they differ in punctuation, case, spacing, and HTML escapes
    ("Strategy&amp;Planning" against "Strategy & Planning"). Comparing the
    stripped forms matches them without a hand-maintained lookup table.
    """
    import re

    return re.sub(r"[^a-z0-9]+", "", (title or "").replace("&amp;", "&").lower())


def learner_facing_module_ids(cursor):
    """Hidden modules whose legacy group still has at least one learner in it.

    ``programme_audit`` covers twelve modules, but the 2026-09-09 programme
    delete took down far more than that, and the learner's own My Learning page
    is served from the legacy ``Last_audit`` groups rather than from these
    tables. So a module can be invisible to the curriculum team while learners
    are actively working through its content.

    Matching on the title is what links the two: ``Last_audit.groups.group_name``
    and ``curriculum.modules.title`` are the same name. A module nobody is
    enrolled in is left alone -- restoring it would put content back in the
    workspace with no evidence anybody needs it.
    """
    cursor.execute(
        'select g.group_name, '
        '       (select count(*) from "Last_audit".group_learners gl '
        '         where gl.group_id = g.group_id) '
        '  from "Last_audit".groups g'
    )
    with_learners = {
        _normalise(name) for name, learners in cursor.fetchall() if learners
    }

    cursor.execute(
        "select module_catalogue_id, title from curriculum.modules "
        " where deleted_at is not null or is_programme_deleted"
    )
    return sorted(
        module_id
        for module_id, title in cursor.fetchall()
        if _normalise(title) in with_learners
    )


class Command(BaseCommand):
    help = "Un-delete the modules covered by the programme_audit tables."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Write the changes. Without it, only reports what it would do.",
        )
        parser.add_argument(
            "--learner-facing", action="store_true",
            help=(
                "Restore every hidden module whose legacy Last_audit group still "
                "has learners in it, not just the ones the programme_audit tables "
                "cover. A module nobody is enrolled in stays hidden."
            ),
        )

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        learner_facing = bool(options.get("learner_facing"))

        with connection.cursor() as cursor:
            if learner_facing:
                module_ids = learner_facing_module_ids(cursor)
                self.stdout.write(
                    f"Hidden modules whose legacy group has learners: {len(module_ids)}"
                )
            else:
                module_ids = audit_module_ids(cursor)
                self.stdout.write(
                    f"Modules referenced by the audit tables: {len(module_ids)}"
                )

            cursor.execute(
                "select module_catalogue_id, title, programme_name, "
                "       deleted_at is not null, is_programme_deleted "
                "  from curriculum.modules where module_catalogue_id = any(%s) "
                " order by programme_name, title",
                [module_ids],
            )
            rows = cursor.fetchall()
            found = {row[0] for row in rows}
            hidden = [row for row in rows if row[3] or row[4]]

            for module_id, title, programme, deleted, prog_deleted in rows:
                state = "hidden" if (deleted or prog_deleted) else "visible"
                self.stdout.write(
                    f"   {str(title)[:44]:46} {str(programme)[:30]:32} {state}"
                )

            missing = [m for m in module_ids if m not in found]
            if missing:
                self.stdout.write(self.style.WARNING(
                    f"  {len(missing)} module id(s) have no curriculum row at all: "
                    + ", ".join(missing[:5])
                ))

            cursor.execute(
                "select count(*) from curriculum.weeks "
                " where module_catalogue_id = any(%s) "
                "   and (deleted_at is not null or is_programme_deleted)",
                [module_ids],
            )
            weeks = cursor.fetchone()[0]
            cursor.execute(
                "select count(*) from curriculum.components "
                " where module_catalogue_id = any(%s) "
                "   and (deleted_at is not null or is_programme_deleted)",
                [module_ids],
            )
            components = cursor.fetchone()[0]

            self.stdout.write(
                f"\n  modules to restore   : {len(hidden)}"
                f"\n  weeks to restore     : {weeks}"
                f"\n  components to restore: {components}"
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                "\nDry run -- nothing written. Re-run with --apply."
            ))
            return

        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    # The pooler leaks default_transaction_read_only between
                    # clients, so the transaction states that it writes.
                    cursor.execute("SET TRANSACTION READ WRITE")

                    # Cleared in tree order. ``deleted_via_parent`` goes too --
                    # it records which programme took the row down with it, and
                    # leaving it set on a row that is no longer deleted would
                    # misdescribe the state to whoever reads it next.
                    for table, where in (
                        ("modules", "module_catalogue_id = any(%s)"),
                        ("weeks", "module_catalogue_id = any(%s)"),
                        ("components", "module_catalogue_id = any(%s)"),
                    ):
                        cursor.execute(
                            f"update curriculum.{table} "
                            "   set deleted_at = null, deleted_by = null, "
                            "       deleted_via_parent = null, is_programme_deleted = false "
                            f" where {where} "
                            "   and (deleted_at is not null or is_programme_deleted)",
                            [module_ids],
                        )
                        self.stdout.write(f"  {table:<12} restored {cursor.rowcount}")
        except DatabaseError as exc:
            self.stderr.write(self.style.ERROR(f"Restore failed and was rolled back: {exc}"))
            return

        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*) from curriculum.modules "
                " where module_catalogue_id = any(%s) "
                "   and deleted_at is null and not is_programme_deleted",
                [module_ids],
            )
            live = cursor.fetchone()[0]
        self.stdout.write(self.style.SUCCESS(
            f"\nDone. {live} of {len(module_ids)} audited module(s) are now visible "
            "in the curriculum workspace."
        ))
