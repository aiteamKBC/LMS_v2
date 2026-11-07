#!/bin/sh
# Runs every backend test module named test*_no_db.py, each in its own
# process: several replace parts of Django (e.g. django.db) with stand-ins,
# which breaks any module loaded after them in a shared process.
# Modules run in parallel (TEST_JOBS, default: number of CPUs), each still
# in its own process. Runs inside the backend image (cwd /app).
# Modules listed in .github/ci/no_db_known_failures.txt are skipped; remove a
# line once that module is fixed so CI checks it again.
cd /app || exit 2
KNOWN=/ci/no_db_known_failures.txt
JOBS=${TEST_JOBS:-$(nproc 2>/dev/null || echo 4)}
OUT=$(mktemp -d)

find . -name "test*_no_db.py" -not -path "./node_modules/*" | sort \
  | sed 's#^\./##; s#/#.#g; s#\.py$##' > "$OUT/all"
if [ -f "$KNOWN" ]; then
  grep -vxF -f "$KNOWN" "$OUT/all" > "$OUT/run" || true
else
  cp "$OUT/all" "$OUT/run"
fi
known=$(( $(wc -l < "$OUT/all") - $(wc -l < "$OUT/run") ))

# SHARD/SHARDS (e.g. 2 of 4): this machine runs every SHARDS-th module
if [ -n "${SHARDS:-}" ] && [ "${SHARDS}" -gt 1 ]; then
  awk -v n="$SHARDS" -v k="$SHARD" 'NR % n == k % n' "$OUT/run" > "$OUT/part" && mv "$OUT/part" "$OUT/run"
  echo "part $SHARD of $SHARDS: $(wc -l < "$OUT/run") modules"
fi

# One process per module, JOBS at a time; each writes <module>.ok or .fail
export OUT
xargs -P "$JOBS" -I{} sh -c '
  if timeout 300 python manage.py test "$1" --noinput > "$OUT/$1.log" 2>&1; then
    touch "$OUT/$1.ok"
  else
    touch "$OUT/$1.fail"
  fi' _ {} < "$OUT/run"

pass=$(find "$OUT" -name "*.ok" | wc -l)
fail=0
for f in $(find "$OUT" -name "*.fail" | sort); do
  m=$(basename "$f" .fail)
  fail=$((fail + 1))
  echo "::group::FAILED $m"; tail -40 "$OUT/$m.log"; echo "::endgroup::"
done
echo "no-database tests: $pass passed, $fail new failures, $known known failures skipped ($JOBS at a time)"
[ "$fail" -eq 0 ] || exit 1
