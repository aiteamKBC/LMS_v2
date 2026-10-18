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
- Working branch: `MCP-Server` (local). `STEP_00_test_blockers.md` was SKIPPED — DB-backed suites cannot start.

## Testing without DB suites (applies to Steps 2–11)
- Automated tests must be DB-free: `SimpleTestCase` + `unittest.mock` (mock model managers / dispatcher responses).
  Run with `bash scripts/test_on_branch.sh mcp_api` (SECURITY_TEST_BRANCH_ID set).
- Real-database checks use a management command `mcp_selfcheck` (built in Step 2, extended each step) that:
  - REFUSES to run unless `USE_SECURITY_TEST_BRANCH=1` and the resolved DB host is the test branch host (not prod);
  - performs the step's round-trip on the branch and cleans up its own rows;
  - is run with the same env as `scripts/test_on_branch.sh` (never plain `manage.py`).
- Manual end-to-end via `scripts/runserver_test_branch.sh` + MCP Inspector from Step 3 on.
- Every report must state which checks were automated, which were selfcheck, which were manual.
- Test commands need `SECURITY_TEST_BRANCH_ID=br-mute-voice-aboca1lt` set (put it in the local, gitignored wrapper).
- Tests: `cd backend && bash scripts/test_on_branch.sh <app>` — app-by-app, never plain `manage.py test`.
- Manual server: `scripts/runserver_test_branch.sh` only. Plain `runserver` = PRODUCTION (A20).
- The branch is a production clone with real PII unless sanitised — never expose it publicly (see Step 12).
