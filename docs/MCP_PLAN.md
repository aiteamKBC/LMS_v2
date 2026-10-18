# LMS MCP Server — Implementation Plan (v1)

Audience: Claude Code. Do ONE step at a time, on a feature branch, and stop for review after each step.
Read `CLAUDE.md`, `AGENTS.md` and `SECURITY_AUDIT.md` before Step 1.

## Sub-plans
Detailed per-step instructions: `docs/mcp/README.md` and `docs/mcp/STEP_XX_*.md`. Work from those.

## Goal

Let curriculum staff use Claude / ChatGPT (custom connector) to look up curriculum structure, create quizzes with
structured KSB mappings, add lesson content and (Phase C) create programme/cohort/group/module structure —
as THEMSELVES, through the existing views, with preview → confirm on every write.

## Ground rules (apply to every step)

1. **Additive only.** Do not modify `login/sessions.py::authenticate_request`, the `kbc_session` cookie flow,
   or any existing view's behaviour. Bearer tokens are accepted ONLY under `/mcp/`.
2. **Never use production.** A plain `manage.py runserver` connects to PRODUCTION (A20). Use
   `scripts/runserver_test_branch.sh` and the seeded test branch only.
3. **No raw SQL writes for business data.** MCP tools call existing views/services (pattern: `config/batch.py`
   sub-requests through `login.api_gate.refusal_for`) so validation, versioning, cache epochs and audit all fire.
4. **Identity only from the token** → `LoginAccount`. Never accept a user/learner id from tool arguments (THE RULE).
5. **Every tool** checks `require_access("curriculum")` semantics (re-read the grant per call, fail closed).
6. **MCP can never:** publish, delete, archive, permanently delete, touch learners/staff/employers, progress,
   KSB awards, OTJ hours, signatures, reviews, ILR, audit sign-off. Never send `removeMissing`, `remove*Ids`,
   `deleted*Ids` or `hydrationComplete` to any endpoint.
7. **Feature flag** `MCP_ENABLED` (env, default `0`). When off, `/mcp/` and `/oauth/` return 404.
8. New tables follow the repo convention: hand-written DDL under `backend/sql/<date>_mcp_*/` with a README/RUNBOOK,
   models `managed = False`. Never run `migrate` or apply DDL yourself — the owner runs SQL in the Neon SQL editor.
9. Run the full existing backend test suite before and after each step; it must stay green with no changes to
   existing tests.

---

## Phase 0 — Foundations

### Step 1 — Skeleton app + flag + gate rules
- Create Django app `backend/mcp_api/` (urls, views, `tools/` package, `tests/`).
- Mount `path("mcp/", ...)` and `path("oauth/", ...)` and `/.well-known/oauth-*` in `config/urls.py`.
- `login/api_gate.py::rule_for`: add explicit, commented early-returns of `None` for `/mcp/`, `/oauth/`,
  `/.well-known/oauth-` (they self-authenticate, like `/curriculum_api/office-preview/`).
- All views `@csrf_exempt` (bearer, no cookies) EXCEPT the authorize consent POST (cookie-based → keep CSRF).
- `MCP_ENABLED` check → 404 when off.
- **Done when:** flag off = 404; flag on = `/mcp/` returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`;
  full test suite unchanged and green.

### Step 2 — OAuth tables
DDL in `backend/sql/<date>_mcp_oauth/` (schema `login`):
- `mcp_oauth_clients` (client_id, client_name, redirect_uris jsonb, created_at, disabled_at)
- `mcp_oauth_codes` (code_hash, client_id, account_id, code_challenge, redirect_uri, scope, expires_at [5 min], used_at)
- `mcp_oauth_tokens` (token_hash, refresh_hash, client_id, account_id, scope, expires_at [1h], refresh_expires_at [30d],
  revoked_at, last_used_at, created_at)
- `mcp_pending_changes` (id uuid, account_id, tool, payload jsonb, payload_hash, preview jsonb, expires_at [15 min],
  applied_at, result jsonb)
- Store only SHA-256 hashes of codes/tokens (mirror `LoginSession.token_hash`).
- Unmanaged models in `mcp_api/models.py`. RUNBOOK with apply + rollback (DROP) SQL.
- **Done when:** applied on test branch; models read/write in a test.

### Step 3 — OAuth 2.1 endpoints (PKCE S256 required)
- `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (RFC 9728 / RFC 8414).
- `POST /oauth/register` — dynamic client registration (RFC 7591); allowlist redirect URI hosts via setting
  `MCP_ALLOWED_REDIRECT_HOSTS` (e.g. claude.ai, claude.com, chatgpt.com).
- `GET/POST /oauth/authorize` — calls the EXISTING `authenticate_request` (cookie). Not signed in → redirect to the
  normal LMS login with `next=`. Signed in → consent page ("Allow <client> to act as <name> in the LMS?").
  Refuse unless account is staff WITH the `curriculum` access grant.
- `POST /oauth/token` — `authorization_code` (+PKCE verify, single-use code) and `refresh_token` (rotate refresh
  token on every use; reuse of an old refresh token revokes the whole family).
- `POST /oauth/revoke`.
- Revocation hooks: when `login.sessions` bulk-revokes an account (credential change) or access is removed,
  MCP tokens for that account must also stop working (check grant + `revoked_at` on every call).
- **Done when:** tests cover PKCE failure, code reuse, expired code, wrong redirect URI, non-curriculum staff refused,
  learner refused, refresh rotation + reuse detection, revoke.

### Step 4 — `/mcp/` transport + per-call context
- Implement MCP Streamable HTTP in **stateless JSON mode** as a plain Django view (no SSE needed):
  JSON-RPC 2.0 methods `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
  (Claude Code may use the official `mcp` Python SDK's types/validation, but keep the endpoint inside Django.)
- Per request: `Authorization: Bearer` → hash → token row → `LoginAccount` → re-check staff + curriculum grant →
  set `request.login_account` (so `authenticate_request` returns early) → `versioning.set_actor(account)` and
  `versioning.source("mcp:<client_name>")` for the whole call → update `last_used_at`.
- Internal dispatcher `mcp_api/dispatch.py`: builds sub-requests to existing endpoints exactly like
  `config/batch.py` (RequestFactory, `refusal_for`, forward login_account). Allowlist of paths+methods it may call.
  Hard-refuse any payload key in the forbidden list (ground rule 6).
- Rate limit per account (e.g. 60 calls/min, 20 writes/hour) → JSON-RPC error with a plain-English message.
- Structured log line per call: account id, tool, outcome, duration. Never log tool arguments containing content bodies.
- Tool registry: each tool = name, description (written for non-technical staff), JSON input schema, handler,
  `writes: bool`.
- **Done when:** MCP Inspector (or curl) can initialize and `tools/list` returns an empty list with a valid token;
  invalid/expired/revoked token → 401; actor appears on a test write.

### Step 5 — Preview → apply framework
- Every write tool runs validation + builds a human-readable preview, stores it in `mcp_pending_changes`,
  and returns `{preview_id, summary, warnings}` WITHOUT writing.
- Tool `apply_change(preview_id)`: same account only, not expired, not already applied, payload hash unchanged,
  re-validate (state may have changed) → execute via dispatcher → store result → return links to the draft in the LMS.
- Tool `cancel_change(preview_id)`.
- **Done when:** tests for other-account apply (404), expired, double apply, re-validation failure.

---

## Phase A — Read-only tools

### Step 6 — Look-up tools
| Tool | Backed by |
|---|---|
| `find_programmes(query?)` | curriculum programmes endpoint; return id, name, level, applied standard (`ksb_profile_source_id`), status |
| `find_cohorts_groups(programme_id)` | cohort/group endpoints |
| `find_modules(programme_id?, query?)` | module collection |
| `get_module_structure(module_id)` | `curriculum/modules/<id>/structure/` → weeks, components, linked quizzes, KSB mappings, status |
| `list_standard_ksbs(programme_id)` | `learner_api/ksb_sources.resolve_source` for the programme's applied standard (server-side, never client-supplied) |
| `ksb_coverage(programme_id \| module_id)` | `.../ksb-coverage/` endpoints → covered + gaps |
| `get_quiz(quiz_id)` | `quiz_api/quizzes/<pk>/` + attempt count from `learner_progress_entries.quiz_ref` |
| `list_books()` / `search_books(book_ids, topic, k)` | `knowledge_base` books + `knowledge_base/retrieval.py`; return chunk text + book title + page |

Rules: name search returns at most 20 results; ambiguous → return candidates, never guess.
Responses contain no learner/staff personal data (add a test asserting no email/DOB/NI fields in any output).
Exclude archived/deleted items unless asked.
- **Done when:** each tool has tests incl. permission denied, not found, ambiguous name.

---

## Phase B — Content tools (writes, drafts only)

### Step 7 — `create_quiz_draft`
Input:
```
{ module_id, week_id, component_id | new_component:{title, expected_otjh?},
  title, passing_grade=65, duration_min?, randomize_questions=false,
  source_book_id?, questions:[{ type: single_choice|multiple_choice|true_false|fill_gap|keywords|ordering|matching,
     text, explanation (markdown), points=1, ksb_codes:[str],
     answers:[{text, is_correct}] }] }
```
Validation (preview stage), reuse `quiz_api/intake.py` + `answer_keys.py`:
- single_choice/true_false exactly 1 correct; multiple_choice ≥2 correct; ≥2 answers; no duplicate answers.
- Duplicate question stems (normalised; Arabic-aware: strip diacritics/tatweel) within quiz and vs question bank → warning.
- Every `ksb_code` must exist in the programme's applied standard. Legacy dotted codes (e.g. K4.2) / unknown →
  error with suggested match (by code then description).
- Programme has no applied standard → refuse.
- Target module/week/component must exist, not archived/deleted.
- Markdown only; strip/refuse raw HTML (A8).
Apply: `quiz_api/quizzes/create-with-questions/` (status draft) → link via ONE canonical route
(component `linkedQuizId` + `quiz_component_links`) → union question KSB codes into the component's mapping via
`curriculum/components/<id>/ksb-mappings/` (defaults: classification `secondary`, weight_class `soft`, weight 1;
existing mappings untouched).
Preview text example: "Create draft quiz 'Marketing Mix' (10 questions) in BUS101 › Module 3 › Week 2 ›
<component>, KSBs: K4, S2. 0 learners affected (draft)."
- **Done when:** end-to-end test on test branch creates quiz + link + mappings; all validation cases tested.

### Step 8 — `edit_quiz_draft` and `clone_quiz_version`
- `edit_quiz_draft`: refuse if quiz has ANY attempts or status != draft. Never send `removeMissing`; removed questions
  are archived (`is_archived`), not deleted.
- `clone_quiz_version(quiz_id, changes)`: new draft quiz with version suffix, same links NOT moved automatically —
  preview tells user to switch the link in the LMS after review.
- **Done when:** attempted quiz edit refused with plain message offering clone.

### Step 9 — `map_ksbs` and `add_lesson_content`
- `map_ksbs(component_id, mappings:[{ksb_code, classification, weight_class, weight}])` → validate with
  `validate_ksb_mapping_payload` rules; preview includes `learner-ksb-impact` for the module/week when the module
  is used by an active cohort. Additive/updates only — removal not supported in v1.
- `add_lesson_content(component_id | new_component, title, body_markdown)` → existing component endpoints, draft.
- **Done when:** tests incl. duplicate KSB on same component, wrong standard, live-cohort warning.

---

## Phase C — Structure tools (after Phase B is piloted)

### Step 10 — `create_programme`, `create_cohort`, `create_group`, `create_module`
- Look-up first: if an item with the same (normalised) name exists in scope → refuse and return the existing one
  (the existing programme POST silently upserts by name — MCP must NOT rely on it).
- Never call the tree-save with any removal flag; prefer the single-entity endpoints.
- Never supply client ids (avoid deleted-id remint); let the server generate them.
- Status always planned/draft. Coach on a group must resolve to an existing staff member (exact match or refuse).
- Cohort preview shows computed end date / duration (default 24 months) for confirmation.
- Module: programme required (never 'Unassigned programme'); weeks/components optional.
- **Done when:** duplicate-name refusal, missing parent, ambiguous coach name all tested.

---

## Phase D — Hardening, rollout

### Step 11 — Hardening
- Kill switch test, rate limit test, token revocation on credential change, PII-free output test across all tools.
- Admin view (super-admin only) to list/revoke MCP tokens per account.
- Ensure every write shows in curriculum revisions with actor + source `mcp:*`.
- Update `SECURITY_AUDIT.md` with the new surface and `CLAUDE.md` gate table with `/mcp/`, `/oauth/`.

### Step 12 — Pilot
- Deploy to test branch environment with a public HTTPS URL; add as a custom connector in Claude (and ChatGPT).
- Pilot with 2 curriculum staff for 2 weeks; collect failed/confusing tool calls from logs.
- Write a one-page staff guide: how to connect, how to ask ("programme, module, week"), preview → confirm,
  review drafts in the LMS before publishing.
- Only then enable on production with `MCP_ENABLED=1`.

## Out of scope for v1
Learner/staff/employer creation, publish/delete/archive, coach tools (caseload, marking, reviews), any compliance write.
