# Step 4 — `/mcp/` endpoint, request context, dispatcher, tool registry

## Goal
A working MCP server (no business tools yet) that authenticates, attributes and rate-limits every call.

## Tasks
4.1 Protocol: MCP Streamable HTTP, **stateless JSON responses** (no SSE, no session id). Support
    protocol version negotiation (accept the client's version if supported, else reply with the latest supported).
    Methods: `initialize` (serverInfo `kbc-lms`, capabilities `{tools:{listChanged:false}}`, `instructions` string —
    see 4.8), `notifications/initialized` (202, no body), `ping`, `tools/list`, `tools/call`.
    `GET /mcp/` → 405. `DELETE /mcp/` → 405. Batch JSON-RPC arrays → reject with error.
    Optional: use the official `mcp` package only for pydantic types/schema validation; keep transport in Django.
    Validate `Origin` header if present (DNS-rebinding protection) against allowlist.
4.2 Request flow in `mcp_endpoint`:
    1) flag check → 2) `resolve_bearer` → 401 + `WWW-Authenticate` on failure →
    3) `request.login_account = account` (so `authenticate_request` short-circuits) →
    4) `versioning.set_actor(account)` and wrap the call in `versioning.source(f"mcp:{client_name}"[:32])` →
    5) rate limit → 6) dispatch JSON-RPC → 7) in `finally`: `versioning.set_actor(None)`, clear context.
4.3 Rate limiting `mcp_api/ratelimit.py` using the existing cache backend (`config/cache_backends.py`):
    per account 60 calls/min, 20 write-applies/hour, 10 book searches/min (embedding cost, A11).
    Exceeded → JSON-RPC tool error text: "You've hit the limit of N … please wait a minute."
4.4 Dispatcher `mcp_api/dispatch.py` (modelled on `config/batch.py`):
    - `call_api(request, method, path, *, query=None, json=None) -> (status, data)`.
    - Path allowlist (exact patterns) of endpoints MCP may call; method allowlist per pattern.
    - Run `refusal_for(path, account)` like batch does.
    - Build sub-request with RequestFactory for GET/POST/PUT/PATCH, copy `login_account`,
      `_dont_enforce_csrf_checks = True`, JSON body.
    - **Forbidden-key scrubber**: recursively reject (raise, don't strip) any payload containing
      `removeMissing`, `hydrationComplete`, keys starting with `remove`/`deleted`, `permanent`, `status:"published"`.
    - Reject StreamingHttpResponse; parse JSON; map 4xx to plain-English tool errors; 5xx → generic error + log.
4.5 Tool registry `mcp_api/tools/__init__.py`:
    `@tool(name, description, input_schema, writes=False)`; `tools/list` returns name, description, inputSchema,
    and `annotations` (`readOnlyHint`, `destructiveHint:false`, `idempotentHint`).
    Input validated against schema (jsonschema) before handler runs → `isError:true` with readable message.
4.6 Tool result format: `content:[{type:"text", text: <short human summary>}]` + `structuredContent` (JSON).
    Errors: `isError:true`, text explains what to do next (never stack traces).
4.7 Output guard `mcp_api/pii.py::assert_no_pii(obj)`: recursively fail on keys like email, dob, date_of_birth,
    ni_number, national_insurance, address, postcode, phone (configurable list). Applied to every tool result
    in DEBUG/tests; in prod, strip + log.
4.8 Server `instructions` text (shown to the model): explain hierarchy programme › cohort › group and
    programme › module › week › component; always look up ids first; ask the user when ambiguous; every write
    returns a preview that the USER must confirm before `apply_change`; never invent KSB codes — use
    `list_standard_ksbs`; content is Markdown.
4.9 Logging: one structured line per call (account_id, client, tool, ok/error, ms). No arguments, no content.

4.10 Route BOTH `/mcp` and `/mcp/` to the same view (some MCP clients drop the slash; `APPEND_SLASH` cannot
     redirect a POST). Update the Step 1 gate exemption test to cover `/mcp` without slash.

## Tests
- initialize / tools/list / ping with valid token; invalid JSON; unknown method (-32601); batch array rejected.
- 401 variants (no header, bad token, expired, revoked).
- Actor set during call and cleared after (write a dummy tool in tests that reads `versioning.current_actor()`).
- Dispatcher: path not allowlisted → refused; forbidden key → refused; refusal_for honoured.
- Rate limit trips at N+1.
- PII guard catches a nested email key.

## Acceptance checklist
- [ ] Inspector connects via OAuth and lists 0 tools (or test tools only in DEBUG).
- [ ] All new + baseline suites green.
