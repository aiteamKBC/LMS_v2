# MCP OAuth tables: runbook

**Read this first:** run **only** the steps below, **in this order**, one at a time, in the **Neon SQL editor**. Nobody runs `migrate` or scripts this DDL.

| File | When |
|---|---|
| `01_create.sql` | Apply (test branch first, Production later) |
| `99_rollback.sql` | Rollback only (see the bottom of this page) |

**What it does:** creates four new tables in the `login` schema: `Mcp_oauth_clients`, `Mcp_oauth_codes`, `Mcp_oauth_tokens`, `Mcp_pending_changes`. **No existing table is altered.** The tables are unused until `MCP_ENABLED=1`.

**Grants:** none. Every existing `login` table (checked on `login."Login_sessions"`) is owned by `neondb_owner` with no explicit GRANTs, and the application connects as `neondb_owner`. `01_create.sql` refuses to run as any other role.

---

## A. Test branch (`security_test`, `br-mute-voice-aboca1lt`)

1. In the SQL editor, select project **LMS**, branch **security_test**, role **neondb_owner**. Confirm the branch:
   ```sql
   select current_setting('neon.branch_id');   -- expect br-mute-voice-aboca1lt
   ```
2. **Apply:** `01_create.sql`. Expected: `COMMIT`, no error.
3. **Verify:** run the query in section C. Expected: exactly the result written there.
4. **Self-check** (from `backend/`, test-branch environment only; the command refuses anything else):
   ```bash
   set -a; source .env.branch; set +a
   env USE_SECURITY_TEST_BRANCH=1 RUN_APP_ON_TEST_BRANCH=1 \
       SECURITY_TEST_BRANCH_ID=br-mute-voice-aboca1lt DB_POOL=false \
       DATABASE_URL="$security_Database_url" Database_url="$security_Database_url" \
       AUDIT_DATABASE_URL= AUDIT_CLONE_DATABASE_URL= KBC_ATTENDANCE_DATABASE_URL= \
       'LASR-ADUTIOD-CLNE=' python manage.py mcp_selfcheck
   ```
   Expected: `OK` on all four tables, `mcp_selfcheck: all OK`. It rolls back everything it wrote.
5. **Rollback rehearsal:** `99_rollback.sql`, then the section C query. Expected: **0 rows**.
6. **Re-apply:** `01_create.sql`, section C query again, then the self-check again. Expected: as steps 3 and 4.

## B. Production (later, separate release, only when the owner decides)

1. **Restore point.** In the Neon console, create a snapshot (or branch) of Production. Write its name down: `__________`.
2. In the SQL editor, select the **Production** branch, role **neondb_owner**.
3. **Apply:** `01_create.sql`. Expected: `COMMIT`, no error. If it raises **any** error, nothing was created: stop and send the message.
4. **Verify:** the section C query. Expected: exactly the result written there.
5. Nothing to restart: the application does not read these tables until `MCP_ENABLED=1`.

## C. Verify query

```sql
select c.relname, c.relowner::regrole as owner, c.relacl is null as no_grants,
       (select count(*) from information_schema.columns
         where table_schema = 'login' and table_name = c.relname) as columns
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'login' and c.relkind = 'r' and c.relname like 'Mcp\_%'
 order by 1;
```

Expected:

| relname | owner | no_grants | columns |
|---|---|---|---|
| Mcp_oauth_clients | neondb_owner | true | 6 |
| Mcp_oauth_codes | neondb_owner | true | 10 |
| Mcp_oauth_tokens | neondb_owner | true | 13 |
| Mcp_pending_changes | neondb_owner | true | 12 |

## Rollback (only if needed)

1. `99_rollback.sql`. Every MCP connector is signed out and pending previews are lost; nothing else in the LMS is affected.
2. The section C query. Expected: **0 rows**.
3. Set `MCP_ENABLED=0` (or leave it unset) so the endpoints answer 404.

**Last resort:** restore the step-B1 snapshot.
