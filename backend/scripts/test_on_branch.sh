#!/usr/bin/env bash
# Run the test suite against the SANITISED Neon SECURITY TEST BRANCH (A17),
# never production. One command instead of five environment variables.
#
# The branch connection string does NOT live in the shared backend/.env; it sits
# in backend/.env.branch (gitignored, local-only). This wrapper sources that
# file, exports the branch DSN, and runs `manage.py test` with the branch-mode
# flags already baked in:
#
#   USE_SECURITY_TEST_BRANCH=1   -> settings.py branch DB block (host-asserted)
#   DB_POOL=false                -> direct endpoint, avoids PgBouncer drops
#   LEARNER_API_REQUIRE_AUTH=0   -> the dev/test posture the functional suites expect
#   --testrunner / --keepdb / --noinput -> the runner the branch requires
#
# DATABASE_URL (production) stays sourced from backend/.env by settings.py and is
# only used for branch-mode's host-inequality assert — the tests run against the
# branch alias, not production. It does NOT modify .env or .env.branch.
#
# Usage:
#   scripts/test_on_branch.sh <app-or-test-target> [more targets...]
# Examples (proven green, run app-by-app — the branch drops long connections):
#   scripts/test_on_branch.sh login
#   scripts/test_on_branch.sh login.tests_group1_write_idor
#   scripts/test_on_branch.sh learner_api.tests_module_shift
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH_ENV_FILE=".env.branch"
if [ ! -f "$BRANCH_ENV_FILE" ]; then
  cat >&2 <<'MSG'
ERROR: backend/.env.branch not found.

This script runs the test suite ONLY against the sanitised Neon SECURITY TEST
BRANCH, not production. It requires a local, gitignored backend/.env.branch
containing a single line:

    security_Database_url="postgresql://…@<branch-host>…/…?sslmode=require&channel_binding=require"

If you are a teammate who reached this by accident: you do not need this script.
Use a normal `python manage.py test`, which uses backend/.env as usual.
MSG
  exit 2
fi

if [ "$#" -eq 0 ]; then
  echo "ERROR: give at least one test target (run app-by-app — the branch drops long connections)." >&2
  echo "  e.g. scripts/test_on_branch.sh login" >&2
  exit 2
fi

# .env.branch defines security_Database_url (quoted, so & and ? survive sourcing).
# shellcheck disable=SC1090
source "$BRANCH_ENV_FILE"
if [ -z "${security_Database_url:-}" ]; then
  echo "ERROR: $BRANCH_ENV_FILE exists but does not set security_Database_url." >&2
  exit 2
fi
# settings.py::load_env_file uses setdefault for this key, so exporting it here
# wins over backend/.env (which no longer contains it anyway).
export security_Database_url

echo "Running tests against the test branch (host: $(printf '%s' "$security_Database_url" | sed -E 's#.*@([^/:]+).*#\1#'))"
exec env \
  DB_POOL=false \
  LEARNER_API_REQUIRE_AUTH=0 \
  USE_SECURITY_TEST_BRANCH=1 \
  python manage.py test "$@" \
  --testrunner=login.test_runner.EnrolmentTestRunner --keepdb --noinput
