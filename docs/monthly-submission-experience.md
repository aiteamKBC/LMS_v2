# Monthly submission experience

The entry page shows the learner what is required in the current calendar month in Europe/London. Each assignment remains a separate submission, grouped using Training Plan delivery dates.

## Current month

- Fresh visits ignore the old browser-stored month and assignment. An explicit month or assignment URL remains valid for bookmarks, returning from work and staff previews.
- The current month stays visible when it has no assignments. The page explains the empty state and offers the next scheduled month without relabelling future work as current.
- Counts distinguish work requiring the learner, work awaiting the coach, completed work, missing instructions and unavailable statuses.
- The main action prioritises requested changes, then a saved draft, then an available new assignment. Missing instructions and unknown statuses never become a fabricated Start assignment prompt.
- Other current-month assignments appear as readable rows with direct actions. The featured assignment is not repeated in the list.
- Earlier-month change requests have a separate expandable reminder. All months, including undated work, are available through View other months and a labelled month selector.
- Planned dates are described as planned dates, not deadlines or evidence that work is overdue.

## Instructions and feedback

Read instructions opens a dedicated view with the main action at the top. Authored instructions, safe HTML, attachments, file previews, planned hours and support context remain available. A missing brief still permits access to support.

Feedback is shown when it exists or a submission has reached a review state. Empty marking-result panels do not appear on unmarked drafts. Requested changes open the feedback before the learner revises. Returning from the assignment editor opened through Monthly Submission returns to that month's assignments rather than Training Plan.

## Guided submission

The visible stages are Read the task, Prepare your work, Meeting & presentation, and Check & submit. Prepare your work retains the six existing short sections and a section selector. Existing draft section identifiers remain unchanged; the navigation order is 0, 1, 2, 3, 4, 5, 7, 6, so the meeting and presentation precede final validation. Historical records retain their original eight sections and read-only behavior.

All existing server requirements remain in place. Evidence attachments are optional; valid skills claims, learning time, required answers/declarations, a qualifying coaching booking and a reviewed/exported presentation are still checked. Coaching-review signatures and meeting attendance are separate from assignment submission eligibility.

Drafts retain automatic and manual saving, restoration and failure recovery. Final validation runs on entry to the last stage; failed checks link to the relevant part. Submission remains explicit and atomic. Success explains that the work is awaiting coach review and lets the learner choose to open the submission preview.

## Readability and validation

The overview uses larger text, controls at least 48 pixels high, visible labels, clear keyboard focus and a single column on small screens. Routine presentation-design choices and passed checks are disclosed on demand.

Regression tests cover current-month selection, date boundaries, status counts, revision priority, empty/error states, attachments, feedback, draft restoration and final submission. `node scripts/check-monthly-submission-ux.mjs` uses synthetic data against local Vite, intercepts requests and saves screenshots for desktop, mobile and a narrow viewport representing enlarged content. It must never send requests that change real learner data.

User acceptance should include learners with varying experience using technology: find this month's task, continue a saved draft, read requested changes, browse another month, and return to the current month without assistance.
