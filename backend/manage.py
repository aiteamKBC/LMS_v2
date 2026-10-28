#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    benchmark_runserver = (
        command == "runserver"
        and os.environ.get("RUN_APP_ON_TEST_BRANCH", "").strip().lower()
        in {"1", "true", "yes", "on"}
    )
    if benchmark_runserver and not os.environ.get("LMS_BENCHMARK_READER_URL"):
        from config.benchmark_credentials import read_benchmark_reader_url
        os.environ["LMS_BENCHMARK_READER_URL"] = read_benchmark_reader_url()
    if command == "test" or benchmark_runserver:
        from config.test_isolation import install_test_isolation
        install_test_isolation()
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
