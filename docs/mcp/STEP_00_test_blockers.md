> **STATUS: SKIPPED by owner decision (2026-10-18).** DB-backed Django test suites stay blocked. See README "Testing without DB suites".

# Step 0 — Unblock DB-backed tests

Minimum before Step 2: **0.1 only**. 0.2 may wait until before Step 7 (when MCP tools start calling curriculum_api).

Found during Step 1: two problems already on `main` stop DB-backed suites from running. Steps 2–11 need DB tests,
so fix these FIRST, on a separate branch off `main` (they are not MCP work), merge to main, then rebase `MCP-Server`.

Branch: `fix/test-suite-blockers` from `main`.

## 0.1 engagement_api migration conflict (two `0004` leaves)
- Inspect both `0004_*` files: what each does, which commits added them, whether either is already applied in
  production (`django_migrations` table — READ-ONLY query via the branch, compare with prod only by asking the owner).
- If they touch independent things: create a merge migration with
  `makemigrations engagement_api --merge` under the BRANCH settings (never against prod). It must contain NO operations,
  only `dependencies` on both leaves. Show the file before committing.
- If they conflict (same table/field): STOP and report — owner decides.
- Note: the team never runs `migrate` on Neon — schema changes are applied by hand in the Neon SQL editor. This merge
  file exists ONLY so Django's test runner stops refusing to start. It changes no database and nothing needs to be run in Neon.

## 0.2 curriculum_api test that replaces `django` in sys.modules  (DEFERRABLE — must be done before Step 7)
- `curriculum_api/test_attendee_compare_no_db.py:56` swaps a fake `django` module at import time and breaks app-wide
  discovery. Fix by scoping the fake to the test (e.g. `unittest.mock.patch.dict(sys.modules, …)` inside setUp /
  a context manager) and restoring after. Do not change what the test asserts.

## 0.3 Local wrapper
- Add `SECURITY_TEST_BRANCH_ID=br-mute-voice-aboca1lt` to the local, gitignored `scripts/test_on_branch.sh` /
  `.env.branch` (not committed).
- Update the stale "branch expired 2026-10-03" line in `CLAUDE.md` and document the required env var there.

## Acceptance
- `login`, `curriculum_api`, `quiz_api`, `config` suites start and run on the branch. Record results; pre-existing
  test FAILURES (e.g. the 6 in `config`) are out of scope — list them, don't fix them.
- Merge to main (owner approves), then `git rebase main` on `MCP-Server`; `mcp_api` suite still 8/8.
