# Monthly assignment submission (version 2)

## Entry points and storage

- Learner sidebar: **My Progress → Monthly submission** (`/learner/monthly-submission`). Only live assigned assignment components are listed.
- The existing assignment component page and the monthly submission route use the same wizard and APIs.
- Author the question in Module Builder → Assignment question. Planned hours, fixed engagement points, assurance, version and group assignment remain owned by the existing component editor.
- All eight steps are saved under `full_submission.monthlyAssignment` in the existing `Learner.learning_reflection_submissions` table. Existing answer/learning/impact columns and payload fields remain compatible with tutor review.
- Evidence uploads continue through the existing Azure upload/scanning service. Cross-references store permanent evidence IDs, never expiring download URLs. External evidence links and references to the learner's evidence library are also supported.
- Editable presentation slides are persisted in the draft. A real `.pptx` is generated on demand and can be exported again after submission. This does not create a second persistent PowerPoint blob in Azure.
- No migration or schema change is required for this version. No old assignments are imported by this implementation.

## Drafts and submission

Any incomplete step can be saved explicitly or by debounced autosave. Drafts include the month, current step, answers, evidence links, KSB claims, declarations, time, booking reference and slides. Writes are serialized. Navigation flushes the latest snapshot; a tab-local recovery copy protects unsaved work during connection failures. Failed initial loading disables editing and saving to avoid overwriting an unseen server draft.

New submissions must pass these 13 server checks:

1. Assignment answer: at least 120 words.
2. Learned / understood / gained skills: at least 20 words each.
3. At least one available evidence file owned by this learner, or HTTP(S) evidence link, cross-referenced to valid answer point numbers (non-empty answer lines).
4. Every claimed programme KSB: at least 20 words of explanation and cross-referenced evidence. Unknown or duplicate KSB codes are rejected.
5. Planned hours and KSB review confirmed.
6. New knowledge, new skills/behaviours and employer-sharing declarations confirmed.
7. Positive finite time, with out-of-hours confirmation where applicable. **No six-hour cap.** Existing signed timing/progress verification remains in force.
8. LMS monthly reflection and integrated understanding: at least 20 words each. Additional activities are optional.
9. Employer benefit confirmed and measurable outcomes: at least 20 words.
10. Career, job and employer impacts: at least 20 words each.
11. Next-month action plan and EPA preparedness: at least 20 words each.
12. An owned, non-cancelled monthly coaching booking in the last ten calendar days of the selected month. Existing booking restrictions and conflict checking still apply.
13. Presentation exported and reviewed. Server-signed export receipts bind the slides and written/evidence content to the learner and assignment. Content edits require another reviewed export; timer ticks and booking changes do not invalidate the presentation.

The 20-word thresholds make the reference's qualitative “sufficient depth” requirements explicit. These checks measure completeness, not academic quality or tutor approval. Voice transcription and proofreading reuse the existing configured services; AI suggestions never replace text without learner acceptance. This version does not add an AI assessment/grade or an AI answer-recommendation endpoint.

The completion endpoint locks the saved draft, rechecks requirements, saves progress and marks the assignment submitted in a single enrolment-database transaction. A failed completion leaves the draft intact. A delayed draft cannot overwrite a submitted record. Preview appears only after submission and includes the saved sections, cross-references, slides and inline evidence preview. Some external sites prohibit embedded viewing using their own security headers.

## Historical import boundary

`submissionOrigin` is server-owned: normal learner writes always use `learner`. A future controlled historical import can set `imported_legacy` and preserve the old record without enforcing new-submission requirements. These records are read-only in the learner wizard and cannot be rewritten or re-completed by posting an import flag. The import workflow and actual old-assignment upload are a separate next phase.

## Verification

Schema-free backend tests: `python manage.py test learner_api.tests_monthly_assignment learner_api.tests_bookable_session_types --noinput`.

Frontend draft tests: `node node_modules/vitest/vitest.mjs run src/pages/learner/video-watch/AssignmentSubmissionWizard.test.tsx src/api/reflectionSubmission.test.ts`.

Before production rollout, manually exercise an authorized learner account: partial save/reload; scanned Azure evidence plus library cross-reference; positive time above six hours; out-of-hours confirmation; a real coaching booking and conflict rejection; PPT export/edit/re-export; final submission and locked preview. These live writes are deliberately not performed by repository automation.
