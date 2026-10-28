"""Pytest entry point for the same fail-closed boundary used by Django tests."""
import os

os.environ.setdefault("LMS_TEST_ACTIVE", "true")

from config.test_isolation import install_test_isolation  # noqa: E402

install_test_isolation()

