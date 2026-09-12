# Historical assignments in the learner Evidence library

The Evidence page now combines current LMS uploads with each learner's existing audit evidence. Opening previous evidence stays inside the learner workspace: the original file, assessment report, retained original before replacement, saved note and assessor feedback are available in the preview. Office documents use the same Microsoft iframe viewer as Audit; PDF reports use their actual format even when an old display name ends in `.docx`.

The library groups evidence by month, newest first, and then by component. Month and component sections open independently; the latest month and its first component open initially. Expand all months opens the full library. Search and filters automatically reveal matching groups. Native uploads show their filenames beneath the component title; real component IDs prevent unrelated components with the same name from merging. Undated records have their own section. The summary is a compact status strip; source, month, status and type filters sit in an expandable panel beside the Assignments only shortcut.

Current and previous reads load independently, retain usable results when the other source fails, and cancel stale responses when switching learners. Source assessment statuses are retained; a successful antivirus scan of a new upload is still not an assessment. The fixed sidebar badge of 7 was removed.

## Existing data sources

- `fetching_evidence.evidence_items`: all categories, with existing audited classifications, name/date overrides and current replacements.
- `structured_manual_activities.manual_activity_documents`: additional documents on active learner-owned activities. Already mirrored Aptem files/reports are not duplicated as extra library entries.
- `"Audit".learner_evidence_overrides`: active auditor uploads and selected monthly activities. Selected activities reuse the learner monthly-log content preview and their existing documents. Deleted parent activities do not expose content.
- The existing native evidence endpoint remains responsible for new LMS uploads.

This is a read integration. No import, migration, SQL deployment, table provisioning or database update is required. It does not invoke the legacy Audit endpoints that provision tables on a GET.

## Access and documents

Three GET endpoints live below `/learner_api/evidence/<kind>/<learner-id>/historical/`: list, `<source>/<source-id>/` detail, and `<source>/<source-id>/open/?part=...`.

They reuse learner-self-or-staff authorization, verify the Created_users kind and Aptem ID against the exact normalized learner email, and reject ambiguous links. Every evidence, activity and document query is owner-scoped. The open endpoint rechecks ownership before issuing a short-lived, read-only Azure URL for a known document part. Learners cannot pass an arbitrary blob path. Responses use `private, no-store`. List/detail payloads exclude storage paths and internal classification commentary. Historical records have no learner delete action.

The old Audit viewer shares the pure display/iframe helpers; its editing routes are unchanged. Learner evidence does not call Audit-only routes. New-upload and historical-source failures have separate retry feedback.

## Validation, 12 September 2026

- 13 backend tests without creating a test database: ownership, ambiguous identities, missing sources, deleted/archived records, overrides, original/replacement/report documents, manual attachments, auditor uploads, selected activities, invalid document parts and feedback projection.
- Frontend tests cover merging/filtering, original Office/PDF previews, sanitized notes, feedback, source/storage failures, learner switching, selected activity content and sidebar behavior. The complete learner-page empty/error suite also passes.
- Production build and scoped ESLint pass.
- `frontend/scripts/historical-evidence-smoke.mjs` checks month/component layouts and document/note previews at 1600, 1024, 768, 390 and 320 pixels, with synthetic data and all API/external requests intercepted. No horizontal overflow; keyboard toggles, expand/collapse, filters and Escape work. Opening a preview preserves the expanded month/component.
- The grouping update passed 89 frontend tests plus the 13 backend tests. Cases include duplicate component names with different IDs, filename/component searches through collapsed months, undated evidence, and switching between learners.
- Actual source queries were run inside PostgreSQL read-only transactions. Three sampled learners had 262, 66 and 78 Aptem evidence records, including 48, 11 and 4 assignments. Four additional learners verified uploaded-file and selected-activity records. The raw `learner_evidence` archive had no evidence IDs missing from `evidence_items` at the time of the check.
- Read-only Azure HEAD checks returned 200 for a real historical Word assignment, its PDF assessment report, and an auditor-uploaded image. Browser visual checks use synthetic documents; they do not claim a signed-in, live Microsoft viewer session was tested.

The C drive ran out of temporary space during verification. Tests and the isolated visual server were rerun with TEMP/TMP under the ignored `frontend/node_modules/.cache/evidence-preview-temp` on E. The existing app server on port 3000 still serves the modified component successfully. No system-wide environment setting or user file was changed.
