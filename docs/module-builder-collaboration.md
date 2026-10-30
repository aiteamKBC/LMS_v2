# Module Builder collaboration

This change adds staff presence and temporary field reservations to **Module
Builder**. It does not enable chat, change the learner interface, or modify
Microsoft meetings, invitations, IDs, recordings, dates or month grouping.

## Behaviour

- The right sidebar lists colleagues on the same module. Editing locations are
  shown beside a reserved field, not in the sidebar.
- Ordinary text, numeric, rich-text and assurance controls reserve their exact
  authored field. Another author can edit and save different fields, including
  fields on the same component. Fields are not reserved across modules.
- Save releases fields included in the successful request. Discard/normal
  departure releases reservations too. A disconnected or idle owner cannot
  renew indefinitely: a grant lasts 60 seconds, with batched renewals every 20
  seconds only for fields used in the last 40 seconds in a visible tab. Page
  presence expires after 75 seconds without a heartbeat.
- A field can remain reserved briefly after typing stops, never for an hour.
  Reconnecting/returning reads saved revisions; expired drafts require rechecking.
- The existing versioned three-way merge remains authoritative. If two saved
  versions genuinely conflict, the author chooses which to keep. Other available
  fields can still save; reserved/conflicting fields remain unsaved in the draft.
  The footer and leave-page guard continue to reflect those unsaved changes.
- Imports, KSB operations, structural edits and calendar controls retain their
  existing workflow. Their structure saves are checked against active reservations
  on the server; they do not acquire a network reservation for every imported
  field. Delete/type changes cannot overwrite a reserved record or child.
- Derived `declaredTotalOtjh` is excluded from authored conflicts, matching the
  backend. Independent component-hour edits recalculate the aggregate together.

## Correctness and load

Content stays in the existing database save path. Redis contains only bounded
staff identities, field paths, expiries and private ownership nonces. Nonces are
never broadcast. Redis WATCH/MULTI makes room updates atomic. Claims and content
saves share the existing short module-row lock; no DB transaction stays open
while someone types. Claim lock wait is bounded to one second on PostgreSQL.

The socket checks LMS `kbc_session` identity, staff role and permitted browser
origin, with periodic session revalidation. HTTP saves reauthenticate and check
reservations before any content write, including older clients. Coordination
failure is visible and retains the draft; it is never reported as save success.
The old Django chat session is not used or enabled.

One discovery GET runs when a module opens. When enabled, one WebSocket carries
presence/reservations and save notifications. There is no per-keystroke request
or database write. The prior fast polling stops while connected. A visible tab
reconciles saved changes once per minute to catch missed notifications and
external/calendar writers; hidden tabs do not run that reconciliation. Heartbeats
touch Redis, with at most one auth recheck per minute. Only grants/saves acquire
the short DB row lock. Availability and notifications are separate from save
success.

## Rollout and rollback

The feature is **off by default**. The OTJH false-conflict correction applies
independently. No `.env`, production source, database schema or production data
was changed by this implementation.

Before enabling on a reviewed release from merged main:

1. Verify the deployed ASGI app is `config.asgi:application`, and the reverse
   proxy forwards `/ws/curriculum/module-collaboration/` with WebSocket upgrades,
   cookies and the original Origin to it.
2. Verify a shared Redis service and Redis-backed Channels layer across workers.
   `CURRICULUM_COLLABORATION_REDIS_URL` may select the coordinator's Redis;
   otherwise it uses the existing `CHAT_REDIS_URL`. Setting it does not enable
   chat. Do not use an in-memory channel layer for multi-worker production.
3. Enable `CURRICULUM_COLLABORATION_ENABLED=true` with
   `CURRICULUM_COLLABORATION_MODULES=<one approved module catalogue ID>` first.
   An empty module list enables all modules, so keep the pilot list explicit.
4. Use two permitted staff sessions: verify sidebar names, same-field refusal,
   different-field saves, close/reconnect, retained draft, logout and another
   module remaining independent. Measure real request latency, query counts,
   socket/Redis traffic and typing responsiveness before wider activation.
5. To disable the pilot, set the enabled flag false and restart the reviewed
   services. Newly opened/reconnecting clients use ordinary versioned authoring;
   existing grants expire. Drafts still require saving or discarding before exit.

Local Redis protocol/atomicity checks use a test-only fakeredis installation in
the private QA folder, not a new runtime dependency. A 100-editor / 101-reservation
simulation is not a production Redis, network or database load benchmark. The
browser check uses two independent contexts and synthetic socket traffic;
authentication and the actual Channels consumer are tested separately.

## Checks

- Feature, from `frontend/`: `node node_modules/vitest/vitest.mjs run src/pages/curriculum/module-builder/__tests__ src/pages/curriculum/week-builder src/pages/curriculum/shared/entities/__tests__/mergeModuleStructure.test.ts --maxWorkers=2`.
  The new collaboration tests cover lease
  expiry, retained projections, sidebar names and save metadata. The actual page
  test saves an independent reorder while retaining a reserved title.
- Backend: `curriculum_api.tests_module_collaboration` runs against verified RAM
  test settings. `curriculum_api.tests_module_collaboration_persistence` requires
  the verified disposable PostgreSQL runner; never run a mutating fixture suite
  against production.
- Because shared Teams files are touched, run the AGENTS.md frontend Teams
  baseline and applicable expanded backend checks, plus type-check/lint/build.
- Live Microsoft changes are not part of these tests. Production activation is
  a separate deployment step after review.
