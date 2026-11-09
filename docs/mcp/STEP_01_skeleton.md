# Step 1 — Skeleton app, feature flag, gate exemptions

## Goal
An empty, switched-off `mcp_api` app wired into URLs, with zero effect on the existing system.

## Prerequisites
- Branch `feature/mcp-server` created from current main.
- Baseline test run recorded: `bash scripts/test_on_branch.sh login`, `curriculum_api`, `quiz_api`, `config`.

## Tasks
1.1 Create app `backend/mcp_api/`: `__init__.py`, `apps.py`, `urls.py`, `views.py`, `settings.py` (module-level
    helpers that read env), `tools/__init__.py`, `tests/__init__.py`. Add to `INSTALLED_APPS`. No migrations
    (convention: `managed = False`, DDL by hand).
1.2 Flag helper `mcp_api/settings.py::mcp_enabled()` — reads `MCP_ENABLED` per call (like `api_gate._enabled`),
    default `"0"`. Also `MCP_PUBLIC_BASE_URL` (e.g. `https://lms.example.com`) used later for metadata.
1.3 Decorator `mcp_api/views.py::mcp_feature_required` → returns plain 404 when the flag is off.
1.4 Stub views (all behind 1.3):
    - `mcp_endpoint` (POST/GET/DELETE on `/mcp/`) → for now always 401 with header
      `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"`.
    - `oauth_protected_resource_metadata`, `oauth_authorization_server_metadata` → 501 placeholder JSON.
1.5 `config/urls.py`: add
    - `path('mcp/', include('mcp_api.urls'))`
    - `path('oauth/', include('mcp_api.oauth_urls'))` (create empty `oauth_urls.py`)
    - `path('.well-known/oauth-protected-resource', ...)`, `path('.well-known/oauth-authorization-server', ...)`
1.6 `login/api_gate.py::rule_for`: add early `return None` for paths starting with `/mcp/`, `/oauth/`,
    `/.well-known/oauth-` — with a comment in the same style as the office-preview exemption explaining they
    authenticate themselves with bearer tokens / the consent flow.
1.7 Confirm the reverse proxy / deploy config (nginx or similar in `deploy/` or docs) will route `/mcp/`, `/oauth/`,
    `/.well-known/` to Django. Do NOT change prod deploy files yet — just note what will be needed in the report.

## Tests (`mcp_api/tests/test_skeleton.py`)
- Flag off: `/mcp/`, `/oauth/anything`, both `.well-known` → 404.
- Flag on: `/mcp/` → 401 + correct `WWW-Authenticate` header.
- `rule_for('/mcp/')` is None; `rule_for('/curriculum_api/x')` unchanged (regression).
- Existing gate tests still pass.

## Acceptance checklist
- [ ] Only files touched outside `mcp_api/`: `config/settings.py` (INSTALLED_APPS), `config/urls.py`, `login/api_gate.py`.
- [ ] Baseline suites green, identical counts before/after.
- [ ] New tests green.

## Do not
- Touch `login/sessions.py`, `login/permissions.py`, middleware order.

## Rollback
Remove the app from INSTALLED_APPS + the url lines + the gate lines. No data involved.
