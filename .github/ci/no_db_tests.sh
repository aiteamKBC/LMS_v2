#!/bin/sh
# Runs every backend test module named test*_no_db.py, each in its own
# process: several replace parts of Django (e.g. django.db) with stand-ins,
# which breaks any module loaded after them in a shared process.
# Runs inside the backend image (cwd /app). Modules listed in
# .github/ci/no_db_known_failures.txt are reported but don't fail the build;
# remove a line once that module is fixed.
cd /app || exit 2
KNOWN=/ci/no_db_known_failures.txt
pass=0; fail=0; known=0; new_failures=""
for f in $(find . -name "test*_no_db.py" -not -path "./node_modules/*" | sort); do
  m=$(echo "${f#./}" | sed 's#/#.#g; s#\.py$##')
  if timeout 300 python manage.py test "$m" --noinput >/tmp/out.txt 2>&1; then
    pass=$((pass + 1))
  elif [ -f "$KNOWN" ] && grep -qx "$m" "$KNOWN"; then
    known=$((known + 1))
  else
    fail=$((fail + 1)); new_failures="$new_failures $m"
    echo "::group::FAILED $m"; tail -40 /tmp/out.txt; echo "::endgroup::"
  fi
done
echo "no-database tests: $pass passed, $known known failures, $fail new failures"
[ "$fail" -eq 0 ] || { echo "New failures:$new_failures"; exit 1; }
