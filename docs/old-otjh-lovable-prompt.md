Improve the UI/UX of the existing KBC “Previous learning record” feature. This is an existing React + TypeScript + Vite + Tailwind application backed by Django. Deliver working components in the current project, not a new application or a static screenshot.

Understand the purpose first:
- Existing learners review their historical monthly learning records through August 2026 inclusive before entering the new LMS.
- After login they see two cards: “LMS” and “Previous learning record”.
- Each required month needs both the learner’s signature and their assigned coach’s signature, followed by explicit completion by the learner.
- The LMS unlocks only when the backend confirms that all required months are complete. The backend also protects direct links and API access.
- Activities, attendance, assignments, attachments and updates come from shared source tables used by another system. We read the same data; we do not migrate or copy those records.

Design direction:
Make this feel like a carefully designed learning journal: clear hierarchy, excellent typography, compact readable rows, restrained borders/shadows, consistent spacing and polished interactions. The current UI feels too generic and spacious; improve its composition materially. Avoid oversized empty cards, giant signature panels and rows padded like separate landing-page sections.

Preserve the current KBC logo, navigation shell, sidebar, fonts and design tokens. Purple is the brand identity, but inspect the actual button/action tokens before choosing action colors. Use the existing semantic primary action color. Scope CSS to this feature; avoid global table or button overrides. The attached journal screenshots are references for information structure, not replacement branding. All product text must remain in English.

1. Portal and LMS access dialog
- Keep the two existing cards. Give each a clear icon, concise description and obvious primary action, with balanced dimensions and spacing.
- Show a refined transition progress summary using actual completed/remaining month counts. Zero progress must look empty.
- Open LMS refreshes the existing API state. Complete learners enter directly.
- Incomplete learners see an accessible dialog titled “Complete your learning transition”. Show the remaining work, progress, assigned coach and a real contact action when available.
- “Review outstanding months” opens the first incomplete required month. “Not now” closes the dialog. A connection failure has its own retry state.

2. Monthly report layout
- Start with All months, month/year, learner name, status and a usable month selector with Previous/Next navigation.
- Follow with a compact learner/programme/coach/date grid and the monthly hours summary.
- Then enforce this exact content order:
  Attendance → Activities → Assignments → Report sign-off.
- Attendance is recognized from the attendance category or its att: source reference. All non-assignment learning/manual/other activities stay in Activities. Assignments have their own final activity group.
- Keep the source order within each group. Show group counts. Omit empty groups without reordering the remaining ones. Each record appears once; attachments are not extra activities.
- Report sign-off comes after all three groups.

3. Report rows and embedded content
- Desktop columns: Date | Category | Activity | Timestamp | Actual | KSB scope.
- Give the Activity column the most space. Use compact group headers, subtle alternating row backgrounds, aligned numeric values and small readable badges.
- Preserve titles, group/component names, notes, stored completion/results, planned hours, durations, available KSB codes and all attachments. Accepted hours and completed activities are different states.
- Clicking an activity title expands its content INSIDE the report. Retain the working iframe/media/document viewers and multi-part Reading + Quiz selection.
- Load content only on demand; mount only the selected material. Keep the iframe/player mounted during background refresh so playback and reading do not restart.
- Private PDF and Word files open inside the report. Open and Download remain available. Never publish private files or send them to a third-party conversion service.
- Keep the new-tab fallback for sources that disallow embedding. Missing content gets an honest empty state.
- On mobile/tablet, use readable compact rows/cards with every field and attachment available, no page-wide horizontal scrolling, no overlapping labels and no duplicate interactive DOM.

4. Signatures and completion
- Create a compact, professional sign-off area with Role | Signature | Print name | Date | Status and separate Learner and Coach rows.
- Reuse SignatureCapture. Preserve Draw, Upload PNG/JPEG, Clear, Preview and explicit confirmation before saving.
- Each person signs only their own row from their own authenticated account. A learner must not upload or draw on behalf of the coach.
- Show saved signatures clearly at a sensible size. Use brief explanatory text for an unsigned other-party row. Completed months are read-only.
- Preserve unsaved drawings/uploads/previews across polling and temporary errors. Never remount the capture component merely because fresh data arrived.
- Complete month is a learner action governed by backend can_complete. Respect required signatures, available data and pending revisions. Explain blockers and use confirmation before completion.
- On success refresh the report/summary and move to the next incomplete month. Once all are complete, offer Open LMS.

5. Existing data and behavior are the contract
- Keep the current Django APIs, authenticated session, protected document routes and learner/coach scopes. Do not introduce Supabase, a parallel login, another database or a proxy service.
- Identity is resolved server-side: session account → subject_id → enrolment.Created_users → aptem_id. Browser IDs do not grant access.
- Preserve the existing API types and hooks. The optional activity_id parameter on the manual rows endpoint is a manual report row ID, not an arbitrary LMS activity ID.
- Poll relevant open views about every 7 seconds. Source edits must appear while saved signatures remain intact. Do not invent automatic “Needs re-sign”, erase signatures or revoke completion just because a digest changed.
- New signature submissions still use the draft’s original digest and the current backend conflict validation.
- Preserve backend totals. Training plan target is not the sum of activity planned hours. Missing data displays —. Do not invent page counts, KSB codes, parent/child links, dates or second-level precision.
- Keep required months and the August 2026 cutoff as supplied by the backend. Do not generate calendar months.

6. Implementation and delivery
Read the existing code and docs first:
- frontend/src/features/old-otjh/page.tsx
- MonthReport.tsx, ReportSections.tsx, report.module.css
- TransitionDialog.tsx, ActivityExpansion.tsx, ContentPreview.tsx
- SignatureCapture.tsx, report.ts, api.ts, useRecordSummary.ts, hooks.tsx in the same feature directory
- Shared Panel, Modal, ProgressMetric, WorkspaceShell and the project's design tokens
- docs/old-otjh-transition.md

Focus your changes on presentation and interaction. Preserve working data integration and permissions. If you cannot access the project files, request the relevant files before claiming to integrate; do not invent a replacement backend.

Implement the redesign and verify portal/dialog, a populated month, expanded content, PDF/Word preview, both signing roles, completion, refresh stability and mobile layouts. Keep keyboard focus visible, label controls clearly, return focus on close and respect reduced motion. Show desktop and mobile screenshots of the finished result. Report changed files, checks and any unavailable source fields. Follow AGENTS.md: no commits/pushes/PRs, migrations or database writes.
