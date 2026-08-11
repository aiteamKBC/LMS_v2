# Session Memory — Learner Journal / OTJH

Last updated: 2026-08-11 (Africa/Cairo)

## Current objective

Maintain `/workspace/auditor-copy/journal` as a read-only view of the deployed
Last Audit Ledger data while keeping learner-profile data completely isolated.

Hard business rule introduced in this session:

- Engineered OTJH values are allowed through **2026-08-01** inclusive.
- For dates after 2026-08-01, report fetched source values only.
- Fetched Aptem assignment planned/actual values remain unchanged.
- Fetched attendance `activity_hours` is reported verbatim after the cutoff.
- Video and Reading+Quiz rows after the cutoff receive no generated duration
  when the source provides no learner duration.

## Work completed

### LMS auditor-copy frontend

The journal reads from:

```text
https://fetch-evidence.kentbusinesscollege.net/api/last-audit-ledger
```

Implemented/verified behavior:

- Learner-profile API calls were removed from the journal's core loading path.
- Aptem learner identity from the cohort endpoint is used directly.
- Planned, claimed, timestamps, filters, and activity-detail requests are mapped
  to the deployed endpoint contract.
- Invalid source years are quarantined under `Undated LMS activities` rather
  than shown as genuine dates.
- Invalid dates do not change their hours.
- Reading, Quiz, and Reading+Quiz share the same journal filter family.
- Activity-detail requests use the endpoint's `activity_id` parameter.

Relevant frontend files:

- `frontend/src/features/audit/learner-log-pro-copy/lib/api.ts`
- `frontend/src/features/audit/learner-log-pro-copy/lib/lastAuditRequests.test.ts`
- `frontend/src/features/audit/learner-log-pro-copy/components/InlineActivityRow.tsx`
- `frontend/src/features/audit/learner-log-pro-copy/routes/journal.index.tsx`

### Fetch-evidence calculation policy

The source/generation project is the sibling repository:

```text
E:\Kent\fetch evidence
```

Implemented there:

- Central reporting cutoff and source-date overrides.
- Actual-hours rebuild stops engineering attendance/media/Reading+Quiz after
  2026-08-01.
- Planned-hours rebuild stops engineered attendance/Reading+Quiz allocation
  after 2026-08-01.
- Post-cutoff attendance retains fetched `activity_hours` exactly.
- Post-cutoff media and Reading+Quiz have no fabricated duration.
- Aptem assignments remain fetched values at every date.
- Reusable anomaly-report management command.
- Targeted date-fix management command.
- Ingest-time normalization prevents the known malformed source dates from
  being reintroduced while preserving the untouched raw payload.

Relevant fetch-evidence files:

- `backend/evidence/services/last_audit_reporting_policy.py`
- `backend/evidence/services/last_audit_ingest.py`
- `backend/evidence/management/commands/apply_actual_activity_hours.py`
- `backend/evidence/management/commands/apply_planned_activity_hours.py`
- `backend/evidence/management/commands/fix_last_audit_activity_dates.py`
- `backend/evidence/management/commands/generate_last_audit_anomaly_report.py`
- `backend/evidence/test_last_audit_reporting_policy.py`
- `backend/evidence/test_last_audit_anomaly_report.py`
- `docs/LAST_AUDIT_OTJH_HOURS_HANDOVER.md`

## Live data changes applied

Only normalized shared activity data and the two derived OTJH fact tables were
changed. Learner-profile records were not changed.

Corrected shared activities:

- Activities `74931, 74932, 74933, 74934, 74951, 74954, 74957, 74959`:
  `8202-08-30` → `2025-08-30`.
- Activities `140917, 140919, 140921`:
  `0202-08-12` → `2026-08-12`.
- Activity `74931` normalized title:
  `30/8/82025` → `30/8/2025`.

Derived-table rebuild result:

- `activity_planned_hours`: 132,582 rows.
- `activity_actual_hours`: 273,731 rows.
- Engineered rows after 2026-08-01: **0**.
- Post-cutoff attendance rows using fetched values: 242.
- Post-cutoff attendance rows with positive fetched hours: 109.
- Sum of those positive fetched hours: 1,800.02 hours.
- Post-cutoff attendance rows with no fetched value: 23; these remain
  unavailable.
- Post-cutoff fetched assignment actuals currently total zero.

Live endpoint verification:

- Cohort learners: 586.
- Malformed month keys after correction: 0.
- Mohamed Elmasry activity `74931` now returns date `2025-08-30` and the
  corrected `30/8/2025` title.
- Mohamed's August 2026 positive value is fetched attendance `21.26h`; it is
  intentionally not normalized because the user requested source values.

## Generated anomaly reports

Summary:

- `reports/learner-journal-audit-2026-08-11/learner_journal_suspicious_data_2026-08-11.md`

Complete CSV:

- `reports/learner-journal-audit-2026-08-11/learner_journal_suspicious_data_2026-08-11.csv`

Current report contains 6,913 potentially overlapping findings:

- 3,166 future-dated activities already showing progress/completion.
- 2,492 learner-months where claimed exceeds fetched Aptem actual.
- 490 monthly totals exceeding the configured monthly bound.
- 454 activity-title/date mismatches.
- 125 System timestamps on England and Wales bank holidays.
- 102 present attendance rows with missing/zero fetched hours.
- 61 fetched attendance values above eight hours.
- 20 fetched attendance values above the 2.5-hour session norm and at or below
  eight hours.
- 3 unrelated invalid date tokens still embedded in source activity titles.

The bank-holiday check uses the authoritative GOV.UK calendar:
`https://www.gov.uk/bank-holidays.json`.

## Verification completed

- Fetch-evidence `manage.py check`: passed.
- Focused fetch-evidence tests: 13 passed.
- Focused LMS frontend request tests: 10 passed.
- Public endpoint was checked after the database rebuild.
- Confirmed zero invalid cohort month keys.
- Confirmed zero post-cutoff engineered actual rows.

## Current user-visible issue — not fixed yet

The latest screenshot shows Mohamed Elmasry with future reporting periods through
July 2027. Selecting July 2027 shows:

- Monthly plan: `4.00h`.
- Claimed: `0.00h`.
- Activity log: zero activities.
- Card heading: `OFF-THE-JOB HOURS (ENGINEERED)`.

Why this happens:

- Post-cutoff Aptem assignment planned hours are fetched source values and were
  intentionally preserved.
- The cohort endpoint therefore contains future months with non-zero `planned`
  but zero `actual`.
- The frontend creates a learner's period dropdown from any month with non-zero
  planned, actual, or not-accepted values, even when the journal has no activity
  rows for that month.
- The `ENGINEERED` heading is static UI text and is now misleading for
  post-cutoff months that contain fetched-only data.

Recommended next change:

1. For months after 2026-08-01, hide a learner's period option when it has no
   displayable journal activities and no fetched claimed value; retain the raw
   future plan in source/report data.
2. Make the card heading provenance-aware, e.g. `OFF-THE-JOB HOURS (FETCHED)`
   after the cutoff and `OFF-THE-JOB HOURS (ENGINEERED)` on/before it.
3. Add tests for a future month with `planned > 0`, `actual = 0`, and zero
   journal activities.

Do not silently delete or zero the fetched Aptem assignment plan merely to hide
the dropdown entry.

## Deployment and persistence warning

- The shared live database and deployed read endpoint already reflect the date
  corrections and rebuilt derived values.
- The permanent cutoff/normalization implementation lives in the local
  `E:\Kent\fetch evidence` repository.
- That fetch-evidence code must be deployed before the next server-side rebuild;
  otherwise an older deployed generator could recreate post-cutoff engineered
  values or malformed normalized dates.
- No commit, push, or code deployment was performed in this session.

## Safety constraints for the next session

- Do not write to or remap the learner-profile feature.
- Treat fetched values as source truth, even when suspicious; highlight them
  instead of silently correcting them.
- Keep raw LMS payloads untouched when applying normalized date/title fixes.
- Test the deployed endpoint before rebuilding or mutating derived tables.
- Preserve user changes and avoid resetting unrelated worktree files.
