#!/usr/bin/env bash
# Throwaway Neon branch for the database tests: production's *schema only*
# (no rows, so no learner data), deleted after the run.
#   create  -> writes id=... and url=... to $GITHUB_OUTPUT (url is masked)
#   delete <branch-id>
# Env: NEON_API_KEY (secret), NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID (optional,
# default = the project's default branch), NEON_DATABASE (default neondb),
# NEON_ROLE (default neondb_owner).
set -euo pipefail
API=https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID
AUTH=(-H "Authorization: Bearer $NEON_API_KEY" -H "Accept: application/json")

case "${1:?create|delete}" in
  create)
    body=$(python3 - <<PY
import json, os
branch = {"name": "ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}", "init_source": "schema-only"}
if os.environ.get("NEON_PARENT_BRANCH_ID"):
    branch["parent_id"] = os.environ["NEON_PARENT_BRANCH_ID"]
print(json.dumps({"branch": branch, "endpoints": [{"type": "read_write"}]}))
PY
)
    # Neon's own error message (no key or password in it) when it refuses
    code=$(curl -sS -o /tmp/neon_resp.json -w '%{http_code}' "${AUTH[@]}" \
      -H "Content-Type: application/json" -X POST "$API/branches" -d "$body")
    if [ "${code:0:1}" != 2 ]; then
      echo "::error::Neon refused to create the test branch: HTTP $code $(head -c 500 /tmp/neon_resp.json)"
      exit 1
    fi
    resp=$(cat /tmp/neon_resp.json); rm -f /tmp/neon_resp.json
    id=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["branch"]["id"])' <<<"$resp")
    echo "id=$id" >> "$GITHUB_OUTPUT"
    echo "Created Neon branch $id (schema only)"
    # Wait for the branch and its compute to be ready
    for i in $(seq 1 60); do
      pending=$(curl -sf "${AUTH[@]}" "$API/operations?limit=20" | python3 -c '
import json,sys
ops=json.load(sys.stdin)["operations"]
print(sum(1 for o in ops if o.get("branch_id")==sys.argv[1] and o["status"] not in ("finished","skipped","cancelled")))' "$id")
      [ "$pending" = 0 ] && break
      sleep 5
    done
    url=$(curl -sf "${AUTH[@]}" \
      "$API/connection_uri?branch_id=$id&database_name=${NEON_DATABASE:-neondb}&role_name=${NEON_ROLE:-neondb_owner}" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["uri"])')
    echo "::add-mask::$url"
    echo "url=$url" >> "$GITHUB_OUTPUT"
    ;;
  delete)
    curl -sf "${AUTH[@]}" -X DELETE "$API/branches/${2:?branch id}" >/dev/null
    echo "Deleted Neon branch $2"
    ;;
esac
