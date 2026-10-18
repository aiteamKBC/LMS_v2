# Step 12 — Pilot and production rollout (mostly human-run; Claude Code prepares)

## 12.1 Environment for pilot (CRITICAL)
- The `security_test` branch is a production clone with REAL learner PII and blob refs to real Azure evidence
  (A21). Do NOT expose it to the internet or to Claude/ChatGPT as-is.
- Options (owner decides): (a) create a fresh Neon branch and run `scripts/sanitise_test_branch.sql` +
  `seed_verify_branch.sql`, disable Azure SAS minting there; or (b) pilot directly on production behind the flag
  with only the pilot accounts allowed (12.3). Claude Code: prepare both runbooks, do not execute either.
- Public HTTPS URL with valid cert (required by Claude/ChatGPT connectors).

## 12.2 Deploy prep
- Production LiteSpeed only forwards `*_api` prefixes to Django (others fall to the SPA `index.html`). Add forward
  rules for: `/mcp` and `/mcp/`, `/oauth/*`, and ONLY `/.well-known/oauth-protected-resource` +
  `/.well-known/oauth-authorization-server` (not all of `/.well-known/`). No caching on `/mcp` and `/oauth/token`.
  Verify with curl from outside that each returns Django JSON, not index.html.
- Env: `MCP_ENABLED=1`, `MCP_PUBLIC_BASE_URL`, `MCP_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com,chatgpt.com`.
- Apply Step 2 SQL per RUNBOOK; restart `lms-*` services.

## 12.3 Pilot allowlist
- Env `MCP_PILOT_ACCOUNT_IDS` (comma list). When set, consent + bearer refuse anyone not listed.
  (Small addition to Step 3/4 code — implement here.)

## 12.4 Connect
- Claude: org admin adds a custom connector with URL `<base>/mcp/`; pilot user connects → LMS consent page.
- ChatGPT: add as connector/app where the plan supports custom MCP.

## 12.5 Staff guide `docs/MCP_STAFF_GUIDE.md` (1 page, non-technical; also export to PDF/Doc for the team)
- How to connect (screenshots placeholders).
- How to ask: always name programme, module, week. Example prompts:
  "List the weeks in Module 3 of Digital Marketing L3."
  "Using the book <title>, create a 10-question quiz on the marketing mix for Week 2, mapped to the right KSBs."
  "Which KSBs in this programme have no quiz yet?"
- Every change shows a preview — read it, then say "confirm".
- Everything is a DRAFT — review and publish in the LMS yourself.
- What it can't do (publish, delete, learners).
- Who to contact when something looks wrong.

## 12.6 Pilot (2 curriculum staff, 2 weeks)
- Daily: check MCP logs for errors/refusals; collect confusing tool messages; tune descriptions/instructions.
- Success criteria: ≥10 quizzes created via MCP, 0 integrity issues, staff time per quiz reduced, no PII in outputs.

## 12.7 Go-live
- Remove pilot allowlist (or widen), announce guide, keep kill switch documented.
- Review after 1 month: decide on Phase C rollout and coach-tools phase.
