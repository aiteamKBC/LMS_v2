# Breathe HR integration

The integration tables are provisioned by
`backend/sql/2026-11-11_breathe_integrations.sql`. The SQL creates the
`integrations` schema and never stores a Breathe API key; `secret_ref` points to
Secrets Manager or an environment variable name.

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
