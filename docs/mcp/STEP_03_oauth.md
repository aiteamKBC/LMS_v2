# Step 3 — OAuth 2.1 authorization server (PKCE, DCR, consent)

## Goal
Claude/ChatGPT can obtain a per-user token by having the staff member approve access in the LMS,
reusing the EXISTING cookie login. Nothing in `login/` changes behaviour.

## Settings (env, read per call)
`MCP_PUBLIC_BASE_URL`, `MCP_ALLOWED_REDIRECT_HOSTS` (comma list, e.g. `claude.ai,claude.com,chatgpt.com,localhost`
for Inspector in dev only), `MCP_ACCESS_TTL=3600`, `MCP_REFRESH_TTL=2592000`, `MCP_CODE_TTL=300`.

## Tasks
3.1 Metadata endpoints (public, cacheable 1h):
    - `/.well-known/oauth-protected-resource` → `{resource: <base>/mcp/, authorization_servers: [<base>],
      scopes_supported: ["lms.curriculum"], bearer_methods_supported: ["header"]}`.
    - `/.well-known/oauth-authorization-server` → issuer, authorization_endpoint `/oauth/authorize`,
      token_endpoint `/oauth/token`, registration_endpoint `/oauth/register`, revocation_endpoint `/oauth/revoke`,
      `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code","refresh_token"]`,
      `response_types_supported: ["code"]`, `token_endpoint_auth_methods_supported: ["none"]`.
3.1a Fail closed: if `MCP_ENABLED=1` but `MCP_PUBLIC_BASE_URL` is unset/blank, metadata endpoints, `/oauth/*`
     and the `/mcp/` 401 header return 503 `{"code":"mcp_misconfigured"}` and log an error (never emit relative URLs).
3.2 `POST /oauth/register` (RFC 7591, public clients only): validate every redirect URI is https (http only for
    localhost when DEBUG/branch) and host in allowlist; store client; return client_id. Rate-limit by IP
    (e.g. 10/hour) to stop table spam.
3.3 `GET /oauth/authorize`:
    - Validate `response_type=code`, known `client_id`, exact `redirect_uri` match, `code_challenge` +
      `code_challenge_method=S256` present, `state` passed through, `scope` ⊆ supported.
      Invalid client/redirect → show error page (never redirect to an unvalidated URI).
    - `account = authenticate_request(request)` (existing cookie). None → redirect to the SPA login route with
      `next=<this full URL>` (check how the SPA login handles `next`; if it doesn't, add a SAFE same-origin
      `next` handling in the consent flow only — do not change login views).
    - Refuse (error page) unless `account.role in {staff, admin}` and access grant includes `curriculum`
      or `super-admin` (reuse `login.permissions._accesses_of` / `accesses_for_staff`).
    - Render consent page (Django template, simple, KBC branding, English): "<client_name> wants to act as
      <display_name> in the LMS curriculum area. It can read curriculum and create DRAFT content. It cannot
      publish, delete, or see learner records." Buttons Allow / Deny. Include CSRF token.
3.4 `POST /oauth/authorize` (consent submit, CSRF-protected, re-check session + grant):
    - Deny → redirect `redirect_uri?error=access_denied&state=…`.
    - Allow → create code (hash stored, TTL 5 min, bound to client, account, redirect_uri, challenge) →
      redirect `redirect_uri?code=…&state=…`.
3.5 `POST /oauth/token` (csrf_exempt, form-encoded):
    - `authorization_code`: code exists, unused, unexpired, client & redirect_uri match, PKCE S256 verifies →
      mark used (atomic, `select_for_update`) → issue access + refresh (new family_id). Code reuse → revoke any
      tokens issued from it.
    - `refresh_token`: find by refresh_hash; if already rotated/revoked → revoke WHOLE family (reuse detection);
      re-check account active + grant; rotate (new access + refresh, revoke old row).
    - Response `{access_token, token_type:"Bearer", expires_in, refresh_token, scope}`; `Cache-Control: no-store`.
    - Errors per RFC 6749 (`invalid_grant`, `invalid_client`, `invalid_request`).
3.6 `POST /oauth/revoke` (RFC 7009): revoke by access or refresh token; always 200.
3.7 `mcp_api/auth.py::resolve_bearer(request) -> (account, token_row) | None`:
    header parse, hash lookup, not revoked, not expired, account `is_active`, not locked, role staff/admin,
    grant still includes curriculum/super-admin (re-read every call). Used by Step 4.
3.8 Revocation coupling WITHOUT editing `login/`: in `resolve_bearer`, also reject when the account has had all
    sessions revoked after the token was issued (check latest `Login_sessions.revoked_at` with
    reason credential change, or compare `password_set_at > token.created_at`). Document the chosen rule.
3.9 Structured events (same style as `login.sessions._event`): `mcp.client_registered`, `mcp.consent_granted`,
    `mcp.consent_denied`, `mcp.token_issued`, `mcp.token_refreshed`, `mcp.refresh_reuse_detected`, `mcp.token_revoked`.
    Never log token values.

## Tests (`mcp_api/tests/test_oauth.py`)
Happy path end-to-end; missing/plain PKCE; wrong verifier; code reuse (→ tokens revoked); expired code; redirect
mismatch; unregistered client; non-allowlisted redirect host at registration; learner / employer / staff without
curriculum grant refused at consent; super-admin allowed; consent POST without CSRF rejected; refresh rotation;
refresh reuse → family revoked; deactivated account → bearer rejected; password change after issue → rejected;
grant removed → rejected on next call.

## Manual check
Run MCP Inspector (`npx @modelcontextprotocol/inspector`) against the branch server with localhost allowed;
complete the OAuth flow.

## Acceptance checklist
- [ ] All tests green; `login` suite unchanged and green.
- [ ] No edits in `login/` except none (or justified read-only helper import).
- [ ] Inspector completes OAuth on branch.

## Do not
- Accept bearer tokens anywhere outside `/mcp/`. Issue tokens without PKCE. Use client secrets in v1.
