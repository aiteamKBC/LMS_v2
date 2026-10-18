# Step 11 — Hardening, admin controls, docs

## Tasks
11.1 Security review pass (write findings into `SECURITY_AUDIT.md` new section "MCP surface"):
     token storage, PKCE, redirect allowlist, refresh reuse, CSRF on consent, Origin check, rate limits,
     dispatcher allowlist, forbidden-key scrubber, PII guard, Markdown sanitising, error messages leak nothing.
11.2 Admin controls (super-admin only, inside existing staff console or a minimal Django view):
     list MCP tokens per account (client, created, last used), revoke one / revoke all for account,
     disable a client. Add a staff-console banner/setting? — not needed; env flag is the kill switch.
11.3 Kill-switch drill test: flip `MCP_ENABLED=0` → all MCP/OAuth 404 immediately, existing app unaffected.
11.4 Load sanity: script firing 60 read calls/min from 5 tokens on branch; confirm DB pool OK
     (`config/db_release.py`), latency of normal app pages unchanged (use `perf/` tooling if handy).
11.5 Audit verification: query curriculum revisions for the test run → every MCP write has actor email + `mcp:*`.
11.6 Observability: add MCP counters to existing `config/observability.py` logging if it supports custom fields.
11.7 Docs: update `CLAUDE.md` gate table (`/mcp/`, `/oauth/`, `/.well-known/oauth-*` = self-authenticating),
     add `docs/MCP_OPERATIONS.md` (env vars, apply SQL, rotate/revoke, kill switch, logs to watch, cleanup command).
11.8 Retention: schedule `mcp_cleanup` (same mechanism as other periodic jobs in the repo).
11.9 Full regression: run every app suite on branch (app-by-app, per CLAUDE.md), compare with Step 1 baseline.

## Acceptance checklist
- [ ] Security section written, no open HIGH items.
- [ ] Regression identical to baseline (except new tests).
