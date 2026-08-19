"""Run the login test suites with the right runner, without the long incantation.

    python manage.py test_login              # everything (needs Neon)
    python manage.py test_login --fast       # only the tests that need no database
    python manage.py test_login --keepdb     # reuse the test database between runs

The full suite needs ``login.test_runner.EnrolmentTestRunner``, because these
models are ``managed = False`` and Django's own runner creates a test database
with none of their tables in it. Remembering that flag every time is friction,
and friction is why suites stop being run.

``--fast`` selects the subset of ``tests_unit`` that touches no database, so it
runs in about a second against SQLite and is the one to use while iterating.
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand

RUNNER = "login.test_runner.EnrolmentTestRunner"

#: Test classes in login.tests_unit that need no database at all.
FAST_LABELS = [
    "login.tests_unit.NormalisationTests",
    "login.tests_unit.TokenPrimitiveTests",
    "login.tests_unit.PasswordHashingTests",
    "login.tests_unit.PasswordPolicyEdgeTests",
    "login.tests_unit.LockoutScheduleTests",
    "login.tests_unit.LifetimeTests",
    "login.tests_unit.ClientIpTests",
    "login.tests_unit.RoleMappingTests",
    "login.tests_unit.InviteAuthorisationTests",
    "login.tests_unit.MailConfigurationTests",
    "login.tests_unit.MailFallbackTests",
    "login.tests_unit.MessageTemplateTests",
    "login.tests_unit.LinkBuildingTests",
]


class Command(BaseCommand):
    help = "Run the login app's tests (use --fast for the no-database subset)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fast",
            action="store_true",
            help="Only the tests that need no database (~1s).",
        )
        parser.add_argument(
            "--keepdb",
            action="store_true",
            help="Reuse the test database instead of recreating it.",
        )
        # --verbosity is supplied by BaseCommand; do not redeclare it.

    def handle(self, *args, **options):
        if options["fast"]:
            self.stdout.write("Running the no-database subset…\n")
            # No custom runner needed: nothing here opens a connection.
            call_command(
                "test", *FAST_LABELS,
                verbosity=options["verbosity"], interactive=False,
            )
            return

        self.stdout.write(
            "Running the full login suite against the Neon test database.\n"
            "This provisions the unmanaged tables first and takes a minute or two.\n"
        )
        call_command(
            "test", "login",
            testrunner=RUNNER,
            keepdb=options["keepdb"],
            verbosity=options["verbosity"],
            interactive=False,
        )
