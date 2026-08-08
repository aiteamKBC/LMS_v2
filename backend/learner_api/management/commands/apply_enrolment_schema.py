"""Apply the whole enrolment schema, in dependency order, as one step.

ENROLMENT_GAP_ANALYSIS.md 6.10 Option A. The enrolment tables are created by a
dozen separate apply_* commands with an ordering dependency that nothing
enforced: apply_employer_signing has to run after the table it patches exists,
and apply_document_learner_signature after Enrolment_Documents exists. Both
skip silently when their target is missing, so a deployment that ran the
commands in the wrong order — or missed one — produced a database whose tables
did not match the models reading them. That is the root cause of P0-1 and P0-2.

This command is the single documented deployment step. It runs every schema
command in the order below and reports a summary at the end. Each underlying
command is idempotent, so re-running this is safe.

    python manage.py apply_enrolment_schema --check     # report only, change nothing
    python manage.py apply_enrolment_schema --dry-run   # rehearse each step, roll back
    python manage.py apply_enrolment_schema             # apply

Requires PostgreSQL: every step issues CREATE SCHEMA, which SQLite rejects, and
the tables use jsonb/timestamptz/bigserial. It refuses to run under
DJANGO_USE_SQLITE rather than failing halfway with a bare syntax error.
"""
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

# (command, supports_dry_run, note). Order matters: later entries reference or
# patch tables created by earlier ones.
STEPS = (
    # The core learner table first — everything else keys off its ids.
    ("apply_created_users_table", True, "core learner table"),
    ("apply_staff_users_table", True, "staff directory"),
    ("apply_employer_tables", True, "Organisations + Employers"),
    ("apply_created_users_employer_id", False, "Created_users.Employer_id"),
    ("apply_learning_plan_jsonb", False, "Learning_plan text -> jsonb"),
    # Wizard + ILR capture.
    ("apply_extended_ilr_table", False, "Extended_ILR"),
    ("apply_enrolment_wizard_tables", False, "the 7 Wizard_* tables"),
    # Reviews, then the detail tables that carry an FK to them.
    ("apply_enrolment_reviews_table", True, "Enrolment_Reviews"),
    ("apply_review_detail_tables", True, "Review_Eligibility / _RPL / _Health_Safety"),
    # Compliance documents: the generic index, then the four dedicated tables.
    ("apply_enrolment_documents_table", True, "Enrolment_Documents"),
    ("apply_apprenticeship_agreements_table", False, "Apprenticeship_Agreements"),
    ("apply_ilr_documents_table", False, "ILR_Documents"),
    ("apply_training_plans_table", False, "Training_Plan_Documents"),
    ("apply_written_agreements_table", False, "Written_Agreements"),
    # Patches that need their target tables to exist. These are the two whose
    # unenforced ordering caused P0-1 and P0-2; running them here guarantees it.
    ("apply_employer_signing", True, "employer sign-off columns"),
    ("apply_document_learner_signature", False, "learner sign-off columns"),
)


class Command(BaseCommand):
    help = "Apply every enrolment-schema command in dependency order (see 6.10)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check",
            action="store_true",
            help="Report each step's state without changing anything.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Rehearse each step that supports it and roll back.",
        )
        parser.add_argument(
            "--continue-on-error",
            action="store_true",
            help=(
                "Keep going after a failing step. Off by default: a later step "
                "usually depends on an earlier one, so continuing hides the "
                "cause behind a cascade of unrelated failures."
            ),
        )

    def handle(self, *args, **options):
        if getattr(settings, "USE_SQLITE_FOR_TESTS", False):
            raise CommandError(
                "DJANGO_USE_SQLITE is set. Every step issues CREATE SCHEMA, which "
                "SQLite rejects, and these tables use jsonb/timestamptz/bigserial. "
                "Unset it and point Database_url at the Neon instance."
            )
        if "enrolment" not in settings.DATABASES:
            raise CommandError(
                "The `enrolment` database alias is not configured. Set "
                "ENROLMENT_DATABASE_URL, or Database_url/DATABASE_URL which it "
                "falls back to."
            )

        check = options["check"]
        dry_run = options["dry_run"]
        keep_going = options["continue_on_error"]

        done, skipped, failed = [], [], []

        for name, supports_dry_run, note in STEPS:
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n===== {name} — {note}"))

            kwargs = {}
            if check:
                # Not every command exposes --check; the ones that don't are
                # skipped rather than run, since --check must change nothing.
                if not self._accepts(name, "check"):
                    self.stdout.write("  (no --check support — skipped)")
                    skipped.append(name)
                    continue
                kwargs["check"] = True
            elif dry_run:
                if not supports_dry_run:
                    self.stdout.write("  (no --dry-run support — skipped)")
                    skipped.append(name)
                    continue
                kwargs["dry_run"] = True

            try:
                call_command(name, **kwargs)
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f"  FAILED: {exc}"))
                failed.append((name, exc))
                if not keep_going:
                    self._summary(done, skipped, failed)
                    raise CommandError(
                        f"Stopped at {name}. Later steps depend on it; fix this "
                        "and re-run (every step is idempotent). Pass "
                        "--continue-on-error to push past it."
                    ) from exc
            else:
                done.append(name)

        self._summary(done, skipped, failed)
        if failed:
            raise CommandError(f"{len(failed)} step(s) failed.")

    def _accepts(self, command_name, option):
        """Whether a command declares --<option>, without running it."""
        from django.core.management import load_command_class

        try:
            parser = load_command_class("learner_api", command_name).create_parser(
                "manage.py", command_name
            )
        except Exception:
            # Commands living in enrolment_api resolve through the app registry
            # instead; if we cannot introspect, assume it does not support it.
            try:
                parser = load_command_class(
                    "enrolment_api", command_name
                ).create_parser("manage.py", command_name)
            except Exception:
                return False
        return any(f"--{option}" in a.option_strings for a in parser._actions)

    def _summary(self, done, skipped, failed):
        self.stdout.write(self.style.MIGRATE_HEADING("\n===== summary"))
        self.stdout.write(f"  applied: {len(done)}")
        if skipped:
            self.stdout.write(f"  skipped: {len(skipped)} -> {', '.join(skipped)}")
        if failed:
            for name, exc in failed:
                self.stderr.write(self.style.ERROR(f"  failed:  {name}: {exc}"))
        else:
            self.stdout.write(self.style.SUCCESS("  no failures"))
