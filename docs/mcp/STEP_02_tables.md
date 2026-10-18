# Step 2 — OAuth + pending-change tables

## Goal
New tables for OAuth clients, codes, tokens and write previews. Additive only.

## Tasks
2.1 Folder `backend/sql/<YYYY-MM-DD>_mcp_oauth/` with `01_create.sql`, `99_rollback.sql`, `RUNBOOK.md`
    (copy the structure/tone of `sql/2026-10-14_ksb_standards_migration/RUNBOOK.md`).
2.2 DDL (schema `login`, quoted names to match house style, e.g. `login."Mcp_oauth_clients"`):
    - `Mcp_oauth_clients`: id bigserial PK, client_id text UNIQUE, client_name text, redirect_uris jsonb,
      created_at timestamptz default now(), disabled_at timestamptz null.
    - `Mcp_oauth_codes`: id PK, code_hash varchar(64) UNIQUE, client_id text, account_id bigint REFERENCES
      login."Login_accounts"(id), code_challenge text, redirect_uri text, scope text, expires_at, used_at, created_at.
    - `Mcp_oauth_tokens`: id PK, access_hash varchar(64) UNIQUE, refresh_hash varchar(64) UNIQUE, family_id uuid,
      client_id text, account_id bigint FK, scope text, expires_at, refresh_expires_at, revoked_at, revoked_reason text,
      last_used_at, created_at. Index on (account_id), (family_id).
    - `Mcp_pending_changes`: id uuid PK, account_id bigint FK, client_id text, tool text, payload jsonb,
      payload_hash varchar(64), preview jsonb, expires_at, applied_at, cancelled_at, result jsonb, created_at.
      Index on (account_id, created_at).
    - Grants: mirror what existing `login` tables grant to the app role (check an existing table's grants).
2.3 `mcp_api/models.py`: unmanaged models for all four (`managed = False`, `db_table = 'login"."Mcp_...'`).
2.4 `mcp_api/crypto.py`: `new_token()` (secrets.token_urlsafe(48)), `hash_token()` (sha256 hex) — mirror
    `login/sessions.py` hashing; never store plaintext.
2.5 Retention: management command `mcp_cleanup` deleting expired codes (>1 day), expired+revoked tokens (>90 days),
    pending changes (>30 days). Not scheduled yet.
2.6 Do NOT run the SQL yourself. The owner applies `01_create.sql` by hand in the Neon SQL editor on the TEST BRANCH
    (team convention — no `migrate`, no scripted DDL). Stop after writing the SQL + models, ask the owner to apply it,
    then run the tests. Production apply is a later, separate, human-run step documented in the RUNBOOK.

## Tests (DB suites are blocked — see README)
- DB-free: `hash_token` deterministic, 64 hex chars; `new_token` length/entropy; each model's `_meta.db_table`,
  `managed is False`, field→column names match the SQL file (parse the SQL in the test).
- `mcp_selfcheck` command (branch-only guard as in README): insert/read/update/delete one row in each of the four
  tables, print OK/FAIL per table, remove its rows. Run it AFTER the owner has applied the SQL in Neon.

## Acceptance checklist
- [x] SQL applied on branch (2026-10-18, owner, `security_test`); `mcp_selfcheck` OK on all four tables.
      Rollback rehearsal (RUNBOOK A5–A6) **waived by the owner** — low risk: four `DROP TABLE IF EXISTS`,
      dependants first, nothing else references the tables.
- [x] No existing table altered.
- [x] RUNBOOK lists exact prod apply + verify + rollback commands.
- Production: `01_create.sql` applied by the owner on 2026-10-18, on purpose, **without** the B1 snapshot.
  Tables empty and unused while `MCP_ENABLED` is off; the owner decided to keep them.

## Do not
- Use Django migrations to create these tables. Apply anything to production.
