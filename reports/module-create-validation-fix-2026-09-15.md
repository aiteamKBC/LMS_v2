# Add module validation fix — 15 September 2026

## Confirmed cause and database repair

The configured PostgreSQL database was missing both `curriculum.modules.weekly_schedule` and `curriculum.live_sessions.calendar_series`. Its latest curriculum migration was `0062_englandholiday`. A module with per-day times therefore reached the missing-column guard in `save_module_authoring_structure` and failed.

Ran `manage.py migrate curriculum_api 0063 --plan`; the plan contained only `0063_module_weekly_schedule`. Applied that migration successfully with `--noinput`. Read-only checks afterward confirmed both nullable JSONB columns, the migration record, and the application's `has_column` checks. The local development backend reloaded after the code change and returned HTTP 200 from its health endpoint with database health OK.

## Code changes

- The group-module endpoint preserves `validationErrors` and reports the actual affected fields instead of always naming `weeklySchedule`.
- Frontend error handling includes structured validation messages in the form while excluding the HTTP diagnostic prefix. Duplicate and malformed details are handled safely.
- Regression coverage checks a missing migration, atomic batch rollback, an invalid week title, and the drawer retaining entered values after a refused save.

## Verification

- Focused backend SQLite suite: 6 passed, including two regressions that failed before the fix.
- Frontend API, HTTP retry, module form and weekly schedule suites: 65 passed.
- Production Vite build: passed; output recorded in `module-create-fix-build.txt`.
- Changed-file whitespace checks: passed.
- A broader backend run had 16 passes and the previously documented `test_a_smaller_weeks_count_never_deletes_authored_weeks` failure (fixture expects 12 authored weeks but creates zero). See the earlier `module-weekly-schedule-validation-2026-09-15.md` baseline evidence.

Business-flow tests used isolated SQLite or mocked HTTP. Verification did not create a real module or send meeting invitations. No commits, pushes, pulls or pull requests were made.
