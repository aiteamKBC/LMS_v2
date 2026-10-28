"""Django runner enforcing the central backend test-isolation modes."""
from django.test.runner import DiscoverRunner

from login.test_runner import EnrolmentTestRunner

from .test_isolation import (
    INTEGRATION_MODE,
    POSTGRES_READ_ONLY_MODE,
    UNIT_MODE,
    TestIsolationError,
    assert_unit_database_aliases,
    install_test_isolation,
)


class IsolatedTestRunner(EnrolmentTestRunner):
    def setup_test_environment(self, **kwargs):
        import os
        from django.conf import settings

        policy = install_test_isolation()
        os.environ["AZURE_MAIL_ENABLED"] = "false"
        if policy.mode == UNIT_MODE:
            assert_unit_database_aliases(settings.DATABASES)
            # Skip EnrolmentTestRunner's PostgreSQL-only signal registration.
            return DiscoverRunner.setup_test_environment(self, **kwargs)
        if policy.mode == POSTGRES_READ_ONLY_MODE:
            raise TestIsolationError(
                "manage.py test cannot run in postgres-read-only mode because Django test setup writes. "
                "Use a bounded read-only benchmark script instead."
            )
        return super().setup_test_environment(**kwargs)

    def setup_databases(self, **kwargs):
        from django.conf import settings

        policy = install_test_isolation()
        if policy.mode == UNIT_MODE:
            assert_unit_database_aliases(settings.DATABASES)
            return DiscoverRunner.setup_databases(self, **kwargs)
        if policy.mode != INTEGRATION_MODE:
            raise TestIsolationError("Django database setup is unavailable in this test mode.")
        if not policy.database_writes or not getattr(settings, "USE_SECURITY_TEST_BRANCH", False):
            raise TestIsolationError(
                "Controlled integration database tests require the write opt-in and verified security-branch mode."
            )
        return super().setup_databases(**kwargs)

