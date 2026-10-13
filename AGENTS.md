# Project Agent Instructions - LMS_v2

Shared working policy for every agent and teammate working in this repository. Read this file before investigating or editing a task. Apply it to screenshots, short messages, follow-up requests, bug fixes, features, refactors, configuration, and documentation. Do not depend on the owner's local `CLAUDE.md`; it is not the team's policy.

## 1. Start every task with scope and restrictions

Before editing, give the teammate a short scope note containing:

- **Outcome:** the requested behavior and how success will be checked.

- **Scope:** affected screen, user role, likely files, and downstream features.

- **Restrictions:** no agent commits, pushes, pulls, or PRs; database/schema/data changes are allowed when required by the task; preserve unrelated work; Teams checks are required.

- **Validation:** Teams baseline plus tests for the changed feature and shared dependencies.

Keep reminders short. Repeat the relevant restrictions when a follow-up changes scope. Do not turn each message into a long checklist.

### Screenshots and ambiguous "fix this" requests

A screenshot shows a symptom; it does not define the expected behavior or authorize changes across the application.

1. Inspect the screenshot and relevant code using read-only actions.

2. Use the guided questionnaire below to collect missing scope before making edits that depend on it. Cover the essential questions:

   - Which page and role are affected, and what action produces the issue?

   - What should happen instead? Is this appearance only or a behavior/data change?

   - Is the change limited to this screen, or should connected workflows change too?

3. Explain the reason briefly: "AGENTS.md requires a clear scope because this screen shares behavior with other LMS features."

4. Continue independent read-only investigation while waiting. Do not guess business rules, infer permission from silence, or expand scope because a screenshot contains other fields.

5. Once the teammate has answered, summarize the agreed scope and proceed. Do not ask again for information or authorization already supplied in the conversation.

If the request already specifies the outcome and scope, state your understanding and start. Do not make clear tasks wait for ceremonial confirmation.

### Guided scope questionnaire

Use a short conversational questionnaire for each new implementation task with missing scope. Guide the teammate through decisions; do not merely say "please clarify" or require them to rewrite their prompt.

- Prefer the client's interactive question tool with selectable answers when available and permitted in the current mode. In Claude Code this may be `AskUserQuestion`; in Codex use the available user-input tool. Follow the tool's actual availability and rules; do not assume a tool exists or switch modes solely to force a questionnaire.

- If interactive questions are unavailable, use a numbered questionnaire with lettered choices in chat. Accept replies such as `1A, 2B, 3C` as well as free text. This remains a conversation, not a required document or a new prompt the teammate has to write.

- Ask one to three short questions per round. Start with the most important unresolved decision, and use a further round only when the answer reveals another necessary decision.

- Tailor choices to the actual screenshot, code, and task. State what is already known; never ask again for supplied answers. Do not ask teammates to choose implementation files or diagnose technical causes.

- Always allow a custom answer. Where useful, offer "Not sure - investigate and explain the options"; that authorizes investigation only, not a guessed behavior change.

- Present a recommendation when evidence supports one. A recommended or preselected option is not an answer or approval.

Question bank (use only the questions whose answers are missing):

| Decision | Example question | Example choices |

| --- | --- | --- |

| Desired outcome | "What should this fix change?" | A. Appearance/layout; B. Behavior or saved values; C. Both |

| Affected workflow | "Who encounters this problem?" | Use the actual relevant roles/screens; allow a custom description |

| Scope | "Where should the corrected behavior apply?" | A. This screen only; B. The same workflow across connected screens; C. Investigate the impact first |

| Teams intent | "Should meeting behavior change as part of this task?" | A. Preserve existing meeting behavior; B. Change the specified Teams behavior; C. Investigate whether Teams is involved |

| Expected result | "After this action, what result should the user see?" | Offer concrete outcomes from the task, or ask one short free-text question |

Ask the Teams intent question when Teams involvement is plausible or the intended scope is unclear. An unrelated task does not need a repeated Teams permission question; Teams regression tests remain mandatory. If the teammate selects a Teams behavior change without describing it, ask which behavior should change before editing it.

After the answers, give a brief scope recap: "I will change [outcome] for [workflow]. Connected effects: [known impact]. Required checks: Teams baseline and [feature checks]." Proceed with the already-authorized scope without an extra generic "shall I continue?" prompt.

Reopen the questionnaire when a new request changes the outcome, a shared dependency requires behavior changes outside the agreed scope, or investigation reveals a business decision. Ask only about the new decision. Do not interrupt at every file edit, tool call, or routine implementation choice.

While required answers are pending, continue independent read-only investigation and safe baseline checks when asynchronous input is supported. Wait before dependent edits; no-response timeouts do not approve changes. In clients that require ending a turn to receive input, finish with the concrete questionnaire and resume the same task after the reply. Never claim you can keep an interactive questionnaire open when the client cannot.

### Scope expansion

- A request to fix one field authorizes that fix and necessary checks, not a redesign of the whole form or API.

- Trace shared dependencies before editing. If a solution requires behavior changes in another feature, explain the concrete additional change and obtain scope clarification before making it unless already authorized.

- Teams changes are allowed when explicitly included in the task. Identify the intended change and the meeting behavior that must remain intact; apply the expanded Teams checks below.

- Report unrelated bugs separately. Do not silently fix them or classify them as part of the task.

- Do not delegate to other agents or start concurrent implementers unless the teammate explicitly requests it. If delegation is authorized, pass along this policy, the agreed scope, allowed files, existing changes, and test requirements.

## 2. Git and concurrent work

- Do not create commits.

- Do not push or pull from remotes.

- Do not create, update, or merge pull requests.

- The project owner manually handles commits, pushes, pulls, and pull requests.

- Read-only Git commands such as status, diffs, and history are allowed.

- Inspect `git status --short` and relevant diffs before editing. Record existing modified and untracked files so your changes can be distinguished from someone else's work.

- Never reset, clean, discard, stash, overwrite, or revert another person's changes to get a clean baseline.

- Prefer one task per separate working folder. If multiple agents share a folder, avoid overlapping writes; clarify ownership when concurrent edits affect the same code.

- Recheck relevant files before editing and the diff before finishing. If unexpected changes appear, preserve them and resolve overlapping ownership with the teammate.

- Separate folders do not isolate databases, queues, mailboxes, storage, or Microsoft tenants. Check the actual environment before running application workflows.

## 3. Database and external-system safety

- Database changes are allowed when they are required to complete the agreed task. Agents may create, modify, and run database migrations; execute database-changing SQL; and use application tooling, management commands, HTTP requests, browser interactions, or approved connectors to update schema or data.

- The project owner authorizes agents to apply normal database changes directly when they are part of the requested implementation. Do not stop and hand SQL back to the owner merely because a task needs a schema or data update.

- Before any database write, identify the actual target environment and database without printing connection strings or secrets. Verify that the intended database matches the task and that the operation is scoped to the correct tables, records, learners, programmes, cohorts, groups, or other entities.

- For normal application changes, use the project's established database mechanism: prefer migrations for schema changes when the project uses them, and use ORM/management commands or targeted SQL for data changes as appropriate. Apply the change and run a read-only verification query or equivalent application check afterward.

- Broad or destructive production operations such as `DROP`, `TRUNCATE`, deleting large data sets, resetting production tables, or irreversible bulk rewrites require explicit confirmation immediately before execution unless that exact destructive operation was already clearly requested in the current task. Ordinary inserts, updates, schema additions, indexes, constraints, and scoped fixes do not require a separate confirmation.

- Schema-repair helpers, seed scripts, data-fix scripts, test runners, and automatically invoked `ensure_*` helpers may be used when they are relevant to the task. Inspect their side effects first, keep them scoped, and do not let them overwrite unrelated production data.

- Test/dev/staging databases may be created, migrated, seeded, and mutated by automated tests when their configuration has been verified as non-production. Never assume that the word "test", a localhost URL, a branch name, or `--keepdb` proves isolation; inspect the configured database target first.

- Do not start a server or run backend/browser tests against an unverified database configuration. Never print connection strings, credentials, tokens, or secrets while checking configuration.

- Use mocked external services for routine regression tests. Do not create, reschedule, cancel, or delete real Teams meetings, send invitations/emails, change tenant settings, upload/delete real evidence, or call paid services as a side effect of testing unless the task explicitly authorizes those live external effects.

- A request to edit integration code authorizes the database changes needed for that implementation, but it does not automatically authorize unrelated live operations in Microsoft 365, Teams, mail, storage, payment, or other external systems. Live external validation still needs an explicitly identified environment and scope.

- Never change `.env` files, credentials, permissions, or deployment configuration just to make tests pass unless changing that configuration is itself part of the agreed task.

## 4. Preserve behavior throughout the LMS

Use this map to identify affected areas. It is a starting point, not an exhaustive file allowlist: follow imports, callers, payloads, and data flows.

| Area | Starting points | Behavior to preserve and verify |

| --- | --- | --- |

| Authentication, roles, account identity | `backend/login/`, frontend auth hooks, route guards, API clients | Server-side session identity and record ownership; role boundaries; CSRF; login/logout/expiry; authorized view-as behavior |

| Enrolment and user management | `backend/enrolment_api/`, `backend/learner_api/`, `frontend/src/pages/users/` | Correct learner type and identity; wizard state; account links; enrolment status; existing profile fields |

| Curriculum and scheduling | `backend/curriculum_api/`, `frontend/src/pages/curriculum/` | Programme/cohort/group/module scope; inheritance; session ordering; holidays; dates; learner-plan propagation; Teams synchronization |

| Teams and calendars | Section 5 below | Meeting identity; invitations; schedule; participant roles; options; attendance; recordings; booking consistency |

| Learner journey and content | `backend/learner_api/`, `frontend/src/pages/learner/`, `frontend/src/pages/workspace/learner/` | Access windows; assigned content; progress/completion; training plans; calendar; correct learner/source |

| Coach, tutor, employer, and reviews | `backend/coach_api/`, `backend/progress_reviews_api/`, related frontend workspaces | Caseload and employer ownership; bookings; review history; signatures; marking; authorized read/write boundaries |

| Quizzes, assignments, and marking | `backend/quiz_api/`, learner/coach APIs, content components | Attempts; submissions; scores; feedback; uploaded evidence; historical records; completion rules |

| Hours, attendance, audit, and reports | `backend/audit_api/`, `backend/manual_audit_api/`, `backend/old_otjh/`, learner attendance, `frontend/src/features/audit/` | Planned/actual hours; verified evidence; date boundaries; learner/month scope; totals; exports; historical audit trail |

| Engagement and rewards | `backend/engagement_api/`, corresponding frontend pages | Eligibility; membership; points; claims; notifications; learner scoping |

| Chat, files, notifications, and integrations | `backend/chat/`, storage/mail/calendar helpers, upload/download components | Authorization; attachment ownership; delivery side effects; private URLs; existing enable/disable settings |

| Shared infrastructure and UI | `backend/config/`, frontend API/lib/hooks/router, shared components | Response contracts; cache keys/invalidation; error handling; navigation; loading/empty states; accessibility; all callers |

### Required implementation discipline

- Make the smallest cohesive change that satisfies the agreed outcome. Avoid unrelated refactors, renames, formatting sweeps, dependency upgrades, and file moves.

- Inspect actual request/response contracts. Preserve existing fields, types, defaults, null/empty/omitted semantics, status codes, and consumers unless changing them is part of the task.

- Updating one field must not clear or regenerate unrelated fields. In partial updates, distinguish "not supplied" from "explicitly cleared".

- Keep authorization and ownership checks on the server. Never fix an access error by removing a gate, trusting a client-supplied identity, or disabling CSRF/authentication.

- Preserve distinctions between commercial and apprenticeship learners, and between learner, staff, tutor, coach, employer, and admin workflows. Test affected variants.

- Scope data operations and caches by the correct learner, programme, cohort, group, module, and role. Verify a change to one entity leaves another entity unaffected.

- Preserve business-time-zone behavior and UTC instants. Do not substitute the developer machine's local time for the business time zone.

- Preserve historical submissions, signatures, audit records, verified attendance, and evidence links. Do not recalculate or rewrite history merely to make a current screen appear correct.

- For hours, completion, eligibility, scoring, and reporting rules, locate the authoritative rule and existing tests. Clarify missing business decisions instead of inventing them. Read the relevant project skill when available.

- Do not hide errors with fabricated success responses, empty catch blocks, hardcoded metrics, or silent fallback writes. Distinguish partial success from complete success.

- UI fixes must preserve form values, keyboard access, validation, unsaved-change behavior, loading/error states, and the existing design conventions. Inspect the changed UI when a safe local environment is available.

- Keep secrets and personal learner data out of logs, fixtures, screenshots, generated documents, and final responses. Use synthetic examples.

## 5. Teams is a mandatory regression boundary

Teams protection applies even when the task mentions a different screen.

### Direct and indirect change triggers

Treat changes to any of the following as Teams-impacting until dependency inspection establishes otherwise:

- `backend/curriculum_api/views.py`: meeting endpoints, occurrence shifts, meeting options, module/session planning, delivery metadata, summaries, and sync verdicts share this file.

- `backend/coach_api/views.py`: Microsoft Graph transport, calendar booking, meeting options, and imported curriculum helpers.

- `backend/learner_api/teams_attendance.py`, `attendance.py`, `calendar_connections.py`, and learner calendar/attendance consumers.

- Teams management commands under curriculum and learner APIs; inspect them, do not run live synchronization to validate a code edit.

- `frontend/src/pages/curriculum/teams-meetings/`, `module-builder/TeamsMeetingModal.tsx`, and `module-builder/moduleAuthoringData.ts`.

- `frontend/src/pages/curriculum/shared/entities/teamsCalendarPush.ts`, `teamsCalendarNotice.ts`, module/cohort/group forms, session calendar, and module workspace.

- Coach/learner booking clients, `frontend/src/lib/curriculumApi.ts`, shared date/time functions, authentication, caching, API routing, Graph settings, and relevant dependencies.

### Teams invariants

Unless explicitly changed by the agreed task, preserve and test:

1. Meeting/event/occurrence identity and join-link associations; do not recreate meetings during unrelated edits.

2. Organizers, attendees, presenters, co-organizers, lobby rules, recording/transcription flags, and language settings when updating another field.

3. Correct session dates, duration, recurrence, holidays, time zones, and daylight-saving transitions across curriculum, coach, learner, and Teams views.

4. Retry and concurrent-booking behavior: retries must not create duplicate meetings or invitations; partial failures must remain visible and recoverable.

5. Updates limited to the intended meeting/module/group; no cross-group or cross-learner changes.

6. Verified attendance linked to the correct learner and occurrence, without double counting or replacing historical evidence.

7. Recordings and transcripts linked to the correct session and accessible only to authorized users.

8. Accurate sync status: local save success is not proof that Microsoft accepted every update.

### Required check on every prompt

- For every teammate prompt handled in this repository, run the frontend Teams baseline below before the final handoff when the environment permits. This includes screenshot tasks, unrelated features, documentation, and read-only requests. A prompt solely answering a pending clarification stays within the current task; do not launch duplicate concurrent runs.

- For editing tasks, establish a baseline before edits and run it again after the final edit. Re-run after any subsequent relevant change. Do not reuse a result from a different working-tree state as current evidence.

- Run the baseline **plus affected feature tests**. A green Teams suite does not validate unrelated LMS features.

- For direct or indirect Teams changes, also require the expanded backend checks and applicable Teams invariants. Frontend-only success does not satisfy the full Teams change gate.

- Do not suppress failures, remove assertions, skip tests, change expected behavior, or narrow the baseline to force a pass. An intentional behavior change needs an agreed requirement and corresponding test updates with the reason explained.

- If a check cannot safely run, report **BLOCKED / NOT RUN**, the exact reason, and the missing prerequisite. Continue safe work, but do not declare the change fully validated or ready for acceptance while mandatory checks are unresolved.

## 6. Test commands and validation limits

### Frontend Teams baseline (no live Teams validation)

From the repository root:

```powershell

npm --prefix frontend run test:teams

```

This uses installed local Vitest dependencies and existing tests covering the Teams meetings page, module schedule integration, calendar instants, week/session dates, holiday-shift previews, coach booking retries, learner-calendar freshness, and business time-zone formatting. API calls in these suites use test doubles. No new dependency install is required when `frontend/node_modules` is already prepared.

Inspect any changes to test setup or transport mocks before running. Missing dependencies are a prerequisite failure, not permission to install/upgrade packages silently or connect to production. Do not add `--passWithNoTests`.

**Passing this baseline proves only the automated cases it executes. It does not prove live Microsoft availability, permissions, invitations, or backend database behavior.**

### Expanded Teams backend checks

Inspect these existing suites and run the applicable cases only through a verified runner that complies with section 3:

- `backend/curriculum_api/tests.py`: `TeamsMultiDayRecurrenceTests`, `TeamsAttendanceRosterTests`, `CurriculumTeamsMeetingTests`, `TeamsCalendarSyncVerdictTests`.

- `backend/coach_api/tests.py`, `tests_calendar_race.py`, `tests_errors.py`, and `tests_security.py`: meeting invites/options, Graph failure/retry behavior, concurrent booking, and ownership.

- `backend/learner_api/tests.py`: Teams attendance eligibility and sync; also `tests_attendance_lectures.py`, `tests_dashboard_metrics.py`, `tests_booking_calendar.py`, and `tests_cohort_schedule.py` when affected.

- Add relevant curriculum schedule/holiday/propagation tests when changing shared planning logic.

The existing `backend/login/test_runner.py` provisions schema/data, and several Django suites create or mutate tables/fixtures. These operations are allowed when the configured database has been verified as a non-production test/dev/staging database. Before running a blanket `manage.py test`, branch wrapper, or migration-based setup, verify the target database and external-service side effects; never point a mutating test runner at production by accident.

If no safe verified execution path exists, list the affected suites as blocked and state the missing prerequisite. Do not invent a passing backend result. Live Teams smoke checks remain separate and require the external-system authorization described in section 3.

### Checks for other changes

- Run the changed feature's existing tests and tests of affected shared consumers. Add a focused regression test for a behavioral bug when it can meaningfully demonstrate the failure and run safely.

- For frontend code changes, run `npm --prefix frontend run type-check` and the relevant tests; run `npm --prefix frontend run build` for bundling, routing, dependency, or build-configuration changes.

- Use the project's existing lint command for applicable frontend changes. Report pre-existing failures without broadening scope to repair unrelated code.

- Backend tests, browser tests, imports, and scripts require the section 3 side-effect review; a command name alone does not establish safety.

- For authorization changes, cover allowed and forbidden users and affected role/learner-type variants. For shared APIs/components, test callers beyond the page in the screenshot.

- For documentation/policy-only edits, verify references and commands and run the mandatory Teams baseline. Do not add implementation-mirroring tests just for prose changes.

- Record exact commands, outcomes, test counts, and whether failures existed before your edits. Do not label a failure pre-existing without evidence.

## 7. Handoff and review gate

Before finishing:

1. Review the final diff against the agreed scope and existing teammate changes.

2. Check for accidental payload/field changes, shared dependency effects, secrets, generated files, and weakened tests.

3. Run required checks against the final state. If another agent edits relevant files during testing, the result is not a valid final-state check; coordinate and rerun.

4. Provide a concise, self-contained handoff:

```text

Changed: <outcome and files>

Scope: <agreed scope; any explicitly authorized expansion>

Teams baseline: PASS / FAIL / BLOCKED - <command and result>

Expanded Teams checks: PASS / FAIL / BLOCKED / NOT APPLICABLE - <reason>

Feature checks: <commands and results>

Live Teams: NOT RUN, unless separately authorized and actually verified

Outstanding: <failures, missing environment, database verification/change notes, or review needed>

```

Do not claim "everything works", "Teams is working", "all tests pass", or "ready" based solely on code inspection, mocks, an old report, or an incomplete test run. Report the evidence and its limits.

## 8. Policy ownership and team adoption

- Treat this file, test selection, and test setup as shared controls. Modify them only when the task explicitly requests policy/test-maintenance work or a necessary new regression test. Never weaken them as a workaround for another task.

- Team members should start their agents in this repository and verify the agent loaded this file. For tools that do not automatically load `AGENTS.md`, explicitly attach/reference it in their project instructions. Do not assume every product recognizes the filename.

- For Codex, restart an existing session after policy changes and ask it to summarize the active instructions. Check for overriding instruction files if the summary differs. See [official instruction discovery documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

- For Claude Code, the shared `.claude/CLAUDE.md` imports this file at startup. Keep project instructions enabled, start in this repository, and use `/context` in a fresh session to verify the loader/import appears under Memory files. See [Claude Code memory documentation](https://code.claude.com/docs/en/memory). The owner's root `CLAUDE.md` stays local and is not required for teammates.

- The owner must distribute `AGENTS.md`, `.claude/CLAUDE.md`, the narrow `.gitignore` exception, and the frontend test command through the normal manual sharing process. Local edits do not automatically reach other teammates. Existing sessions need to reload the changed instructions; do not claim their startup behavior was tested unless it actually was.

- Suggested teammate task template: "Read AGENTS.md. Page/role: __. Current behavior: __. Expected behavior: __. Scope: __. Teams behavior changes intended: yes/no, details __. Clarify missing scope before editing and report the required test results."

- These instructions and the test command are a working policy, not tamper-proof enforcement. Owner-controlled CI/acceptance checks and restricted write permissions are separate controls; do not claim they are installed merely because this file exists. The owner should verify scope and test evidence before manually accepting changes.