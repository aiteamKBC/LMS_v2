# Coach production operations

## Implemented telemetry

- Every HTTP request receives a server-generated UUID in `X-Request-ID`. Inbound
  request IDs are ignored until a trusted reverse-proxy contract is configured.
- Production console logs are JSON and include an allowlisted set of safe fields.
- `http_request` events provide request count, status/error rate, and latency data.
- `graph_call` events provide Graph call count, outcome, and latency data.
- Calendar sync lifecycle logs include the durable operation ID, state, and attempt.
- Marking queue latency and failures can be derived from `http_request` events for
  `/coach_api/coach/marking-queue` and `marking_queue_unavailable` error logs.
- SQL timing/query-count response headers are restricted to `DEBUG=True`.

No Sentry, OpenTelemetry collector, Prometheus endpoint, or alert manager is
configured in this repository. The JSON events are a baseline for the deployment's
existing log collector; they are not a claim that dashboards or alerts exist.

## Async Graph deployment blocker

The repository currently has no durable task-queue framework, worker entrypoint,
process supervisor configuration, or documented production worker lifecycle.
Redis is configured for Channels and caching only; that does not make a reliable
background job processor. Calendar Graph calls therefore remain synchronous.

Before implementing the transactional outbox, operations must approve and provide
a continuously supervised worker process (for example, a chosen queue framework or
a dedicated PostgreSQL-outbox worker service), including startup, health checks,
restart policy, and deployment ownership. The HTTP `202` contract must not be
enabled until that worker is deployed and verified.

## Scheduled Teams artifact sync

Until a durable queue exists, Microsoft Teams artifact collection is driven by
the deployment scheduler. The existing live-session sync command also checks
recently ended coach meetings (MCM, progress reviews, catch-ups and support
sessions) and stores their attendance/transcript/recording snapshots when the
manual Coach snapshot tables have been created.

Recommended scheduler entry:

```cron
*/5 * * * * cd /path/to/LMS/backend && .venv/bin/python manage.py sync_teams_meeting_artifacts --lookback-hours 24 --limit 100 --coach-limit 100
```

### Coach meetings: attendance-driven MCM/Progress Review status (Phase 3)

`sync_coach_meeting_snapshots --recent` is not only artifact backfill any more:
for any coach calendar event linked to a Curriculum-driven review instance
(MCM/Progress Review), it is also the primary mechanism that moves that
review's canonical status from `scheduled` to `in-progress` once Microsoft
Teams reports a real attendance join by the expected coach or learner (see
`coach_api.views.apply_teams_attendance_status_transition`). **This has not
been wired into any actual deployment scheduler as part of this change** --
the line below is the recommended cron entry to add; until it (or an
equivalent) is configured, this transition only happens when a coach/learner
opens that meeting's Event Details/artifacts panel, which triggers the same
check on demand.

Recommended scheduler entry (every 5 minutes, matching the artifact sync
above -- `--recent` now also picks up meetings currently in progress, not
just ones that already ended; see the command's own `--help` for
`--lookback-hours`/`--lead-minutes`):

```cron
*/5 * * * * cd /path/to/LMS/backend && .venv/bin/python manage.py sync_coach_meeting_snapshots --recent --lookback-hours 24 --lead-minutes 10 --limit 100 >> /var/log/kbc_coach_meeting_sync.log 2>&1
```

This deployment runs on a Hostinger VPS (`srv1915049`, OpenLiteSpeed + Gunicorn
-- see `claude-code-prompt-lms-db-performance-v2.md`), a plain Linux host, so
standard user `crontab -e` (or a root-owned file under `/etc/cron.d/`, which
additionally needs a user column) is the natural mechanism -- consistent with
this file's other entries, which already assume it. Neither this repository
nor any file in it names the real deployment path, venv location, or which
system user owns the app process, so `/path/to/LMS/backend` and
`.venv/bin/python` above are placeholders, exactly like this document's other
cron entries -- replace them with the real path (e.g. found via `pwd` in the
directory Gunicorn is actually launched from) and the real virtualenv's
python before installing the line. If Graph credentials or other required
settings are read from environment variables rather than a `.env` file
`manage.py` already loads, cron's minimal environment may need them set
explicitly, e.g. by sourcing an env file first:
`cd /path/to/LMS/backend && set -a && . /path/to/LMS/backend/.env && set +a && .venv/bin/python manage.py ...`.

**How to test it manually** (on the actual VPS, as the app's user):

```bash
cd /path/to/LMS/backend
.venv/bin/python manage.py sync_coach_meeting_snapshots --recent --dry-run
# lists exactly which coach calendar events currently qualify, without calling Graph or writing anything
.venv/bin/python manage.py sync_coach_meeting_snapshots --recent --lookback-hours 24 --lead-minutes 10 --limit 100
# a real run; check its stdout summary line ("Done. stored=N, partial=N, skipped=N, failed=N")
```

**How to verify it is actually running in production** once the cron line is
installed: confirm the line is present with `crontab -l` (or in the relevant
`/etc/cron.d/` file); tail `/var/log/kbc_coach_meeting_sync.log` (or wherever
the redirection above points) a few minutes after the top of an hour and
confirm new "Done. stored=..." lines are appearing every 5 minutes; separately,
watch a real scheduled MCM/Progress Review move from `scheduled` to
`in-progress` shortly after someone actually joins its Teams meeting, without
anyone opening its Event Details panel (which would also trigger the check,
and so would not prove the *cron* path is the one that fired).

Do not reduce the interval below 5 minutes (Graph's own attendance-report
publication lag makes anything faster wasted load), and do not switch this to
`--all` on a cron cadence -- that scans every scheduled/in-progress/completed
row with a Teams link regardless of age, which is unbounded and unnecessary
for this purpose.

### Manual in-progress override (Phase 4)

For linked MCM/Progress Review, the assigned coach (or a super-admin viewing
that coach's workspace via `viewAsCoach`) may manually move a `scheduled`
review to `in-progress` when Teams attendance cannot be detected automatically
-- see `coach_api.views.coach_review_instance_mark_in_progress_manually` and
`curriculum_api.review_instances.mark_review_instance_in_progress_manually`.
This is an authorised exception path, not a replacement for the sync above.

**No persistent audit table exists for this yet.** A structured log line is
emitted today (logger `curriculum_api.review_instance_manual_override`,
one INFO record per override with `review_instance_id`, `calendar_event_id`,
`previous_status`, `new_status`, `source=manual`, `reason_code`, `note`,
`changed_by`, `changed_at`) as an interim measure -- this is **not** a
substitute for a real audit table if persistent, queryable business audit is
required; see the Phase 4 report for the recommended schema, which needs
explicit approval (and a migration) before it can be added.

## Recommended alerts (not configured)

- 5xx responses above 2% for five minutes.
- Graph failure outcomes above 5% for ten minutes.
- Any reconciliation rows older than 15 minutes, or a growing reconciliation backlog.
- PostgreSQL connection-pool exhaustion or sustained acquisition latency.
- Redis connection failures affecting Channels or cache operations.
- Marking queue p95 latency above 750 ms for ten minutes.

Do not include request bodies, cookies, CSRF values, authorization headers, Graph
tokens, or secrets in log fields or alert payloads.
