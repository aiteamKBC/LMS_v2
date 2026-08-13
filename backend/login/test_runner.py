"""Test runner that provisions the unmanaged Neon tables into the test database.

The `login` models — like every other Neon-backed model in this project — are
``managed = False``, and ``EnrolmentRouter.allow_migrate`` returns False for the
enrolment connection. So Django's test runner creates ``test_neondb`` with none
of the tables the tests need, and every query fails with "relation does not
exist".

This runner closes that gap by running the same ``apply_*`` DDL commands that
provision a real environment, against the test database, immediately after it is
created. The tests then exercise the actual table shapes rather than a Django
approximation of them — which is the point, given the DDL is hand-written.

Enable it for a run:

    python manage.py test login --testrunner=login.test_runner.EnrolmentTestRunner

or make it the default by setting in config/settings.py:

    TEST_RUNNER = 'login.test_runner.EnrolmentTestRunner'
"""
from django.core.management import call_command
from django.db import connections
from django.test.runner import DiscoverRunner

#: DDL commands to run against the freshly created test database, in order.
#: Staff_users and Employers come first: the login tables reference the people
#: in them, and the tests create staff rows to hang accounts off.
SETUP_COMMANDS = (
    "apply_staff_users_table",
    "apply_employer_tables",
    # The learner table, for the tests that post to the learner creation form.
    # Its Employer_id column was added later, by its own command — a fresh test
    # database needs both, in this order.
    "apply_created_users_table",
    "apply_created_users_employer_id",
    "apply_login_tables",
)

#: Django's test databases are always named with this prefix. Used as the
#: safety check that we are not about to run DDL against production.
TEST_DATABASE_PREFIX = "test_"


class EnrolmentTestRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        old_config = super().setup_databases(**kwargs)

        connection = connections["enrolment"]

        # The apply_* commands address connections["enrolment"] directly. By
        # this point Django has pointed that alias's NAME at the test database,
        # but a connection to the *production* database may already be open and
        # cached from an earlier query. Close it so the next cursor is opened
        # against the test database — otherwise these commands would silently
        # re-run their DDL against production.
        connection.close()
        test_name = connection.settings_dict["NAME"]

        # Refuse to run the DDL unless the alias really was redirected to a test
        # database. Django leaves an alias pointing at the original database
        # when it considers it a mirror/duplicate of another entry — and both
        # `default` and `enrolment` are configured from the same Neon URL here.
        # Without this guard the "test" setup would create tables in production.
        if not test_name.startswith(TEST_DATABASE_PREFIX):
            raise RuntimeError(
                f"Refusing to provision test tables: the 'enrolment' connection "
                f"still points at {test_name!r}, not a test database. Give the "
                f"enrolment alias its own TEST['NAME'] in settings, or run these "
                f"tests against a separate database."
            )

        self.log(f"Provisioning unmanaged enrolment/login tables into '{test_name}'…")

        # The apply_* commands create tables *in* the enrolment schema but do
        # not create the schema itself — on a real deployment it predates them.
        # A fresh test database has neither.
        with connection.cursor() as cursor:
            cursor.execute('CREATE SCHEMA IF NOT EXISTS "enrolment"')

        for command in SETUP_COMMANDS:
            try:
                call_command(command, verbosity=0)
            except Exception as exc:  # noqa: BLE001 - report and continue
                # Surfaced rather than raised: one missing optional table should
                # not stop the whole suite, and the failing tests will say
                # exactly which relation is absent.
                self.log(f"WARNING: {command} failed against the test database: {exc}")

        return old_config
