# Module session count repair — 15 September 2026

## Confirmed cause

`MOD-2026091423231353355366EC83E5D5C3` (Advanced Project and Logistics Management) held 16 active live-session components across 17 content rows, including a reading-only Saudi National Day row. Its persisted `sessions_number` was still 3. Builder imports appended content while retaining the draft's original session count; the backend accepted that stale positive count. Teams renders the generated module session list, which used that persisted 3.

## Code changes

- Builder recalculation and backend structure saves retain planned sessions for unfinished content and ensure the count covers authored live sessions. Reading-only rows do not increase it.
- Complete imports with one content row per session use one planned date per live component and zero for reading-only rows. Calendar-week structures retain their existing multiple-dates-per-week behavior.
- The builder's plan request and Teams attachment walk recognize these imported rows. Reattachment does not create meetings inside their reading-only rows or add a second live component to every session row.
- `deliveryWeeks` supplies the edit form with 8 teaching weeks while preserving the 17 authored content rows and IDs.
- Teams reads the latest session list instead of a cached count.
- Migration `0064_module_session_holidays` adds nullable module-specific closures. The planner and form preview include them without changing other modules' calendars.

## Applied data correction

The user explicitly approved excluding 23 September 2026. Applied migration 0064 after confirming it was the only pending operation in the requested migration plan. Ran the guarded repair script first in dry-run mode, then with `--apply`.

- Persisted count: 3 → 16.
- Session dates: 16 September → 18 November 2026.
- Monday 11:00–14:00; Wednesday 11:30–14:30, using the existing calendar timezone.
- Skipped: 23 September (module closure), 28 and 30 September (existing Workshop closure).
- Updated the 16 live components' schedule fields and the module end date; retained all content IDs and reading settings.
- No Teams series or invitations were created.

Backup: `backend/private_media/schedule-repair-backups/MOD-2026091423231353355366EC83E5D5C3-20260915T000450477908Z.json` (ignored private storage).

## Verification

- 45 backend tests passed (count repair, weekday calendars and holiday reading weeks).
- 86 frontend tests passed across module form, weekday schedule, date mapping, holiday reading weeks and Teams page.
- Production frontend build passed: `module-session-count-build.txt`.
- Full TypeScript check reported diagnostics outside this change; no diagnostics for the changed files. Full output: `module-session-count-types.txt`.
- Independent read-only database verification confirmed 16 unique stored dates, 16 generated calendar sessions, 8 teaching weeks, the excluded dates, unchanged content IDs/readings, and zero Teams series.

Data changes are applied to the configured database. Code changes are local and require deployment to the hosted application; the hosted UI was not verified. No commit, push, pull or PR was performed. Concurrent learner-import and learner-assignment changes were preserved.
