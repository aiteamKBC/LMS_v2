# Breathe HR integration

The integration tables are provisioned by
`backend/sql/2026-11-11_breathe_integrations.sql`. The SQL creates the
`integrations` schema and never stores a Breathe API key; `secret_ref` resolves
to a server-side Breathe environment variable name.

## Activation and isolation

The HR System workspace at `/workspace/hr-system` is a synthetic presentation
demo. It does not modify learner progress, hours, KSB evidence, enrolments,
meetings or existing employer signing rules. Its preview requests do not send
data to Breathe. The original integration configuration screen remains at
`/workspace/integrations/breathe`.

The persistent connector is **off by default**. Before enabling it, review and
apply its separate SQL schema against the intended database with a restore
point, configure the server-side Breathe key, then set
`BREATHE_INTEGRATIONS_ENABLED=true`. API routes return a clear 503 while it is
off; management sync also refuses to run. No migration is applied automatically
and this release does not require altering the existing learner database.

Supported secret references are `env:BREATHE_API_KEY_<NAME>` or an opaque
reference resolved to a `BREATHE_API_KEY_*` environment variable. A Secrets
Manager fetcher is not implemented. Never put key values in frontend code or Git.
Only the official production and sandbox HTTPS origins are accepted;
pagination stays on that origin and redirects are refused.

Browser writes obtain a CSRF token from `GET /integrations_api/breathe/csrf`.
Identity approvals and signing-grant administration require integration staff or
super-admin access. Existing employer signatures do not call these new grants.

## Scheduler trigger

AWS can call:

```text
POST /integrations_api/breathe/connections/{connection_id}/sync
```

with JSON such as:

```json
{
  "resources": ["employees", "departments", "leave_requests", "working_patterns", "training_courses"],
  "dry_run": false,
  "idempotency_key": "scheduler-job-id"
}
```

The endpoint returns `202 Accepted` with `sync_run_id`. The queued run is
processed locally with:

```text
python manage.py run_breathe_sync --run-id <sync_run_id>
```

For a scheduler request without a browser session, set the server-side
`BREATHE_TRIGGER_SECRET` and send:

```text
X-Integration-Timestamp: <unix seconds>
X-Integration-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>." + raw request body>
```

The timestamp is accepted for five minutes and the idempotency key prevents a
replayed scheduler message from creating a second run. Browser calls use the
existing `kbc_session` cookie and `X-Requested-With` header.

The connector reads Breathe pagination from the `Link` header, caps pages at
100 records, retries 429/5xx responses with backoff, and stores only the
approved HR projection. It does not write training completions back to Breathe.

Retention is anchored by `integration_tenants.retention_anchor` (the programme
end date). Run `python manage.py purge_breathe_integration_data --dry-run` to
review rows whose anchor is at least one year old, then run it without
`--dry-run` through the approved retention process.
