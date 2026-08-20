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

## Recommended alerts (not configured)

- 5xx responses above 2% for five minutes.
- Graph failure outcomes above 5% for ten minutes.
- Any reconciliation rows older than 15 minutes, or a growing reconciliation backlog.
- PostgreSQL connection-pool exhaustion or sustained acquisition latency.
- Redis connection failures affecting Channels or cache operations.
- Marking queue p95 latency above 750 ms for ten minutes.

Do not include request bodies, cookies, CSRF values, authorization headers, Graph
tokens, or secrets in log fields or alert payloads.
