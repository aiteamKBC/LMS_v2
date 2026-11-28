"""Feature and Teams regressions using the existing verified disposable DB runner."""
from . import run_local_teams_tests

if __name__ == '__main__':
    run_local_teams_tests.SUITES = (*run_local_teams_tests.SUITES, 'curriculum_api.test_session_attachments_postgres')
    run_local_teams_tests.main()
