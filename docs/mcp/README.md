# MCP sub-plans

Master plan: `../MCP_PLAN.md` (ground rules apply to every step — re-read them).
Do one file at a time, in order. Each sub-plan ends with an acceptance checklist; stop and report when it is met.

| # | File | Phase |
|---|---|---|
| 1 | STEP_01_skeleton.md | 0 Foundations |
| 2 | STEP_02_tables.md | 0 |
| 3 | STEP_03_oauth.md | 0 |
| 4 | STEP_04_transport.md | 0 |
| 5 | STEP_05_preview_apply.md | 0 |
| 6 | STEP_06_read_tools.md | A |
| 7 | STEP_07_create_quiz.md | B |
| 8 | STEP_08_edit_clone_quiz.md | B |
| 9 | STEP_09_ksb_lesson.md | B |
| 10 | STEP_10_structure.md | C |
| 11 | STEP_11_hardening.md | D |
| 12 | STEP_12_pilot.md | D |

Single developer: work through the steps in order. (`TEAM_SEQUENCE.md` is a parked option for two devs — NOT active, ignore it.)

## Standard report after each step (Claude Code must output this)
1. Files added / changed (paths).
2. Confirmation that no existing behaviour changed (list any existing file touched and why).
3. Test commands run (before + after) and results.
4. Anything deferred, assumptions made, open questions.

## Testing reminder
- Working branch: `MCP-Server` (local). `STEP_00_test_blockers.md` was SKIPPED.

## How MCP is tested (from 2026-11-05: NO test branch — production with guardrails)
The Neon test branch `security_test` (br-mute-voice-aboca1lt) expired on 2026-10-27. By owner decision it is
NOT recreated: MCP is checked against production (`br-holy-band-abhispwg`). `scripts/test_on_branch.sh`,
`.env.branch` and `SECURITY_TEST_BRANCH_ID` are retired for MCP work (left on disk, not used).

Guardrails:
- **Production server keeps `MCP_ENABLED` off.** Only a developer's LOCAL server runs with `MCP_ENABLED=1`, so
  staff never see MCP until go-live (Step 12).
- **Automated tests never touch a real database.** Run them with the SQLite-only settings, which refuse to start
  if any PostgreSQL connection is configured:

      cd backend
      python manage.py test mcp_api --settings=config.settings_sqlite_test --noinput

  Tests are `SimpleTestCase` + in-memory fakes of the MCP managers.
- **Real-database checks** use `mcp_selfcheck` (built in Step 2, extended each step). Against production it needs
  `--allow-production` AND the connected Neon branch id typed back (prompt, or `--confirm-branch ID`). On
  production it only touches the four `login."Mcp_*"` tables (it reads `Login_accounts`), and every mode except
  `delete-clients` is rolled back:

      cd backend
      python manage.py mcp_selfcheck --mode changes --allow-production
      # modes: tables | oauth | transport | changes | delete-clients

- **Real curriculum writes** (Step 7 onward) go only into a clearly labelled test module agreed with the owner,
  and are removed by a person in the LMS afterwards. Never into a live module.
- Every report states which checks were automated, which were selfcheck, which were manual.

## Local server for MCP Inspector runs (against production, MCP on locally only)
Git Bash, from `backend/` (a plain local server IS production data — A20 — so act as you would in the live LMS):

    MCP_ENABLED=1 MCP_PUBLIC_BASE_URL=http://localhost:8000 \
    MCP_ALLOWED_REDIRECT_HOSTS=localhost,127.0.0.1 \
    MCP_ALLOWED_ORIGINS=http://localhost:6274,http://127.0.0.1:6274 \
    FRONTEND_URL=http://localhost:3000 \
    python manage.py runserver 8000

Frontend: `cd frontend && npm run dev` (port 3000). Inspector: `npx @modelcontextprotocol/inspector`, open it on
`localhost` (not 127.0.0.1), add server `http://localhost:8000/mcp/`, sign in with your normal LMS account.
