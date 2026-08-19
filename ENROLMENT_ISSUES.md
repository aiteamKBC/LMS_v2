# Enrolment Section — Full Issues List

**Date:** 2026-08-12
**Type:** Read-only audit (nothing changed yet)
**Scope:** The enrolment feature end-to-end —
- **Backend:** `enrolment_api/` (views, extended_ilr, documents, wizard_bootstrap, wizard_steps, models, management commands) + the `learner_api/` document & progression modules (apprenticeship_agreement, written_agreement, training_plan_document, ilr_document, learning_plan, learner_progression, routers, checks).
- **Frontend UI:** `pages/users/wizard/` (shell, context, steps, validation), `pages/users/BoardPage.tsx` (admin profile + compliance docs), `pages/users/page.tsx` + modals, `pages/learner/onboarding/`, `pages/learner/compliance/`.
- **API layer:** the 9 clients in `src/api/` + their data contracts against the Django endpoints.

> This is a second, deeper pass. It supersedes `ENROLMENT_AUDIT.md` and adds ~20 findings that pass didn't surface. Every High/Med finding here was verified against source; key ones re-verified by me directly (routing, mobile progress bar, PLR no-op controls, CvJob cancel-clear, auth middleware).

**How to use:** skim the TL;DR, then read the sections. Each finding has an **ID · severity · file:line · what · why · fix**. When you're ready, tell me which IDs to implement (e.g. *"do BE-1, FE-1, FE-4, API-4"* or *"do the TL;DR list"*).

**Severity key:** 🔴 High (data-integrity / security / real bug) · 🟠 Med (correctness or maintainability risk) · 🟡 Low (polish / hygiene).

---

## TL;DR — top priorities

| # | ID | Sev | One-liner |
|---|-----|-----|-----------|
| 1 | **BE-1** | 🔴 | 4 document "issue" endpoints run `transaction.atomic()` on the **wrong DB** → supersede+create is not atomic (can leave a learner with 0 active docs). |
| 2 | **BE-2** | 🔴* | **No auth** on any enrolment endpoint — anyone reaching the URL can read/patch learners & sign statutory documents. (*verify your gateway*) |
| 3 | **BE-3** | 🟠 | `extended_ilr` PUT with partial `answers` **wipes** previously-saved answers and clears the signed/completed flags. |
| 4 | **BE-4** | 🟠 | `sign_*` does a full-row save with no lock → concurrent signers overwrite each other's signature; `fully_signed` computed on stale data. |
| 5 | **FE-1** | 🟠 | ILR **"Saved" badge lies** — stays green after edits. |
| 6 | **FE-2** | 🟠 | `CvJob` file input **clears the CV** on picker-cancel; can't re-add same file. |
| 7 | **FE-3** | 🟠 | Mobile progress bar fills by **step position**, so going Back visibly *reduces* progress (desktop already fixed this). |
| 8 | **API-1** | 🟠 | Signing/issuing a doc promotes the learner server-side, but BoardPage never **invalidates the wizard/learner caches** → stale status for ~30s. |
| 9 | **API-2** | 🟠 | 4 board document fetches `.catch(() => {})` — a real server error is shown as "not issued yet". |
| 10 | **DEAD** | 🟠 | Dead code: whole `complianceDocuments.ts` client, `completed`/`markComplete` in WizardContext, `fetchCommercialUsers`, `HeroStat`. |
| 11 | **DUP** | 🟠 | Big duplication: 4 copy-pasted backend document modules; 6 party-chip + 4 doc-row components in BoardPage; 3 hand-rolled modals. |
| 12 | **TEST** | 🔴 | `enrolment_api` has **zero behavioural tests**; frontend `validation.ts` untested. |

\* BE-2 severity depends on whether an upstream gateway enforces auth — **please confirm** (see BE-2).

---

# A. Backend

## A.1 Bugs & correctness

### BE-1 · 🔴 High · `transaction.atomic()` opens on the wrong database (writes aren't protected)
- `learner_api/apprenticeship_agreement.py:333`, `written_agreement.py:296`, `training_plan_document.py:391`, `ilr_document.py:257`
- These models are `managed=False` and routed to the **`enrolment`** DB (`learner_api/routers.py:13-22`). A bare `with transaction.atomic():` (no `using=`) opens a transaction on **`default`** (SQLite), while the actual writes autocommit on `enrolment` — so the block gives **no rollback protection** to the writes it appears to wrap.
- **Impact:** the "supersede the active row, then create a new active row" sequence isn't atomic. If the `create()` fails (e.g. a partial-unique-active index rejects a concurrent duplicate → `IntegrityError`), the supersede `save()` is **already committed** → learner left with **zero active documents**. Racing issues can leave two.
- **Fix:** `with transaction.atomic(using="enrolment"):` (×4). Correct example already in repo at `enrolment_api/extended_ilr.py:179`.

### BE-4 · 🟠 Med · `sign_*` full-row save with no lock → concurrent-signer overwrite
- `apprenticeship_agreement.py:407-417`, `written_agreement.py:356-363`, `training_plan_document.py:452-459`, `ilr_document.py:316-327`
- Each loads the row, sets one party's signature fields, then `agreement.save()` (full save, no `update_fields`, no `select_for_update`, no transaction). Apprentice + employer signing concurrently: each loads the row, sets their own signature, the second full save **overwrites the first party's columns**. `recalculate_signed()` runs on a stale in-memory copy → `fully_signed` can be wrong.
- **Fix:** wrap read-modify-write in `transaction.atomic(using="enrolment")` + `select_for_update()`, and/or `save(update_fields=[...])` for just that party.

### BE-3 · 🟠 Med · `extended_ilr` PUT with partial `answers` wipes stored data
- `enrolment_api/extended_ilr.py:174-177, 180-184`
- On every write, `answers` and the derived signature/`completed` flags **fully replace** the stored row (no merge), unlike `draft` which is left alone when omitted. A client that PUTs a partial `answers` payload (e.g. save-before-sign) silently wipes previously-stored answers and clears `learner_signed`/`provider_signed`/`completed`.
- **Impact:** last-write-wins data loss on a compliance record.
- **Fix:** merge `answers` (or require full payloads and document it) and only recompute flags from the merged result.

### BE-5 · 🟡 Low · `wizard_bootstrap` GET performs writes
- `enrolment_api/wizard_bootstrap.py:39, 60-65` — a GET runs `promote_learner_if_ready` + `advance_learner` (status save + `sync_active_user`). Side effects on GET violate HTTP semantics; any prefetch/crawler/caching layer mutates learner status. Combined with BE-2 (no auth) it's triggerable by anyone.
- **Fix:** move the promotion side effect to a POST, or gate it behind an explicit action.

### BE-6 · 🟡 Low · Status transitions have no row lock
- `learner_api/learner_progression.py:120-151`, `learning_plan.py:294-320` — read `programme_status` then `save(update_fields=["programme_status"])` with no lock. Concurrent paths (sign hook + daily command + GET-triggered healing) can race. Transitions are idempotent so impact is limited, but the read-modify-write is unguarded.

### BE-7 · 🟡 Low · `commercial_board` PATCH: two keys map to one column (last-write-wins)
- `enrolment_api/views.py:44, 49, 50` — `organization`+`reference` both map to `organization`; `username`+`name` both map to `username`. Sending both lets dict order silently pick the winner.

> **Not injectable:** the f-string SQL in `documents.py` / `document_tables.py` interpolates only module constants and validated enums; all user values use parameter binding. Worth a comment, not a vuln.

## A.2 Security

### BE-2 · 🔴 High (confirm gateway) · No authentication/authorization anywhere in enrolment
- Every view in `enrolment_api/views.py`, `extended_ilr.py`, `documents.py`, `wizard_bootstrap.py`, and the four `learner_api` document modules is `@csrf_exempt` with **no `login_required`, no permission class, no `request.user` use** (verified by grep — matches only in `audit_api`/`chat`/`config`). Verified `config/settings.py:181-197` has no `LoginRequiredMiddleware`; `AuthenticationMiddleware` only *populates* `request.user`, it doesn't require login.
- **Impact:** if nothing upstream enforces auth, anyone reaching the API can read/write any learner's ILR, issue/sign statutory documents, overwrite commercial records, and force status transitions.
- **Action needed from you:** is there a gateway/proxy enforcing auth in front of Django? If **no**, this is the #1 issue and we should add `login_required`/a permission mixin to every enrolment view.

### BE-8 · 🟠 Med · Upload trusts client-supplied MIME (no magic-byte check)
- `enrolment_api/documents.py:153-154` (POST) & `:263` (replace) — the only file-type gate is `f.content_type` (client-set, spoofable); no `%PDF` header sniff. The docstring justifies skipping scanning "because we generate the files" — but the endpoint is unauthenticated (BE-2), so an attacker can POST arbitrary bytes as `application/pdf`, later served via SAS URL. (`learner_api/evidence.py` does real content inspection; this path doesn't.)

## A.3 Missing validation

### BE-9 · 🟠 Med · `commercial_board` PATCH has no per-field validation
- `enrolment_api/views.py:162-166` — values coerced with `str(value).strip()` but no length/format/allowed-value checks. `programme_status` accepts any string (bypasses the evidence-based progression state machine); `email`/`phone` unformatted; `trainingPlan` checked only to be a list, element shapes unvalidated.

### BE-10 · 🟡 Low · `extended_ilr` jsonb accepted opaque (by design)
- `enrolment_api/extended_ilr.py:163-172` — only type (`dict`) + 2 MB cap validated. `signatureUrl` values inside `answers` are trusted verbatim and drive `learner_signed`/`completed` with no check they're real image data URLs. Documented as ESFA-resilience; note only.

### BE-11 · 🟡 Low · `documents` POST stores `learner_name`/`f.name` unvalidated
- `enrolment_api/documents.py:186` — no length/shape bound (blob name is server-generated at `:166`, so not a path risk).

## A.4 Duplication

### BE-DUP · 🟠 Med · Four document modules are near-identical copies
- `MAX_SIGNATURE_CHARS = 400_000` — 5+ copies (`documents.py:234`, `apprenticeship_agreement.py:45`, `written_agreement.py:44`, `training_plan_document.py:42`, `ilr_document.py:45`).
- `_learner_kind` — 5 identical copies (the 4 modules + `learner_progression.py:57`).
- `_party_json` — 4 copies (`apprenticeship_agreement.py:185`, `written_agreement.py:179`, `training_plan_document.py:271`, `ilr_document.py:157`).
- `_error`, `_iso`, `_active_document`, `SIGNING_PARTIES` — redeclared per module.
- **Entire `sign_*` handler body** (parse → party validation → signature length/`data:image/` check → name-required → set attrs → `recalculate_signed` → save → `advance_learner` → response) — 4 copies that already differ slightly (apprentice/ilr use `if/else`, written/training use `setattr`).
- **Why it matters:** this duplication is *why* BE-1 and BE-4 each recur four times. One shared `document_signing` helper fixes all four at once.

## A.5 Dead code

### BE-DEAD-1 · 🟡 Low · `advance_learner_by_id` unused
- `learner_api/learner_progression.py:157-164` — grep finds only the definition + its own log line; no callers.

### BE-DEAD-2 · 🟡 Low · `admin.py` registers nothing
- `enrolment_api/admin.py:1-3` — boilerplate stub only (models are `managed=False`, so admin would be non-trivial anyway). Note only.

## A.6 Management commands

- ✅ `apply_extended_ilr_table.py`, `apply_enrolment_wizard_tables.py`, `apply_enrolment_documents_table.py`: idempotent (`… IF NOT EXISTS`), correctly use `transaction.atomic(using=CONN)` + `connections["enrolment"]`, support `--dry-run/--check`. No issues.
- **BE-12 · 🟠 Med** — `learner_api/management/commands/drop_old_learner_tables.py`: well-guarded overall (row-count parity, orphan check, dry-run, rollback), **but** the parity check `VERIFY_AGAINST` is single-table (`Enrolment_Users`) while the drop list (`:29-34`) includes `Commercial_users` — so the commercial table is dropped **without** an equivalent presence check.
- **BE-13 · 🟡 Low** — `advance_learner_statuses.py`: the `--check` branch (`:38-53`) re-implements the transition logic instead of sharing `advance_learner` (can drift); runs `compliance_documents_complete` (4 queries) per learner in a loop (N+1, acceptable for a daily batch).

## A.7 Test gaps (backend)

### TEST-BE-1 · 🔴 High · `enrolment_api` has zero behavioural tests
- `enrolment_api/tests.py:1-3` is the empty stub. Only `tests_document_schema.py` exists (DDL text parsing). **No HTTP-level test** for `extended_ilr` GET/PUT, `wizard_bootstrap`, `commercial_board` PATCH, `documents` POST/GET/download/replace/sign, or any of the 4 `learner_api` `issue_*`/`sign_*` endpoints. `wizard_steps.project_draft`/`read_projection` (the most logic-dense code — RAG mapping, legacy values, orphan-row deletion, policy-ack timestamps) has **no coverage**.

### TEST-BE-2 · 🟠 Med · The "no bare atomic()" guard doesn't cover the view layer
- `learner_api/tests_enrolment_schema.py:259-298` iterates a hardcoded `COMMANDS` list of **management commands only**, giving false confidence — the identical BE-1 bug in the four *view* modules is invisible to it.
- **Fix:** extend the guard to scan `ilr_document`, `apprenticeship_agreement`, `training_plan_document`, `written_agreement`.

---

# B. Frontend — Wizard & Board UI

## B.1 Bugs & correctness

### FE-1 · 🟠 Med · ILR "Saved" badge never tracks dirty state
- `pages/users/wizard/steps/Ilr.tsx:234-238` — shows "Saved" whenever `ilrSavedAt && !ilrSaving && !ilrFiling`. `ilrSavedAt` is set once (first save, or seeded from `seed?.meta.updatedAt` in `WizardContext.tsx:196`) and never cleared when the draft becomes dirty. Contrast `HeroProgrammeStatus` (`BoardPage.tsx:226`) which correctly derives `dirty = val !== saved`.
- **Fix:** hide/clear the badge when the current draft differs from `lastSavedDraft`.

### FE-2 · 🟠 Med · CvJob file input clears the CV on cancel; can't re-add same file
- `pages/users/wizard/steps/CvJob.tsx:26` — `set({ cvFile: e.target.files?.[0]?.name })`. Cancelling the picker yields `undefined` → clears the value. Input never resets (`e.target.value=''`), so re-selecting the same filename after delete won't fire `change`.
- **Fix:** `const name = e.target.files?.[0]?.name; if (name) set({ cvFile: name }); e.target.value = '';`

### FE-3 · 🟠 Med · Mobile progress bar fills by position, not completion (regression vs desktop)
- `pages/users/wizard/WizardShell.tsx:333` uses `((currentIndex + 1) / WIZARD_STEPS.length) * 100`, while the desktop rail (`:170/208`) uses `pct` (completed steps). On mobile, flicking back to Introduction visibly **reduces** the bar — the exact behaviour the desktop comment (`:152-160`) says it fixed.
- **Fix:** use `pct` (and `statusKnown`) in the mobile bar too.

### FE-4 · 🟠 Med · ILR mount-time draft mutation triggers an unrequested save
- `pages/users/wizard/steps/Ilr.tsx:34-47` — the effect copies `personalDetails.signature` into `ilr.learnerSignature.signatureUrl` when the ILR block has none, but (unlike the KSB-seed at `WizardContext.tsx:297` and cache-seed at `:218-220`) does **not** re-point `lastSavedDraft.current`, so it dirties the draft. Merely opening the ILR step (incl. **staff** viewing — this step isn't read-only) and paging away fires a full network save nobody requested. Also risks a stale-closure clobber of concurrently-edited `learnerSignature` fields (exhaustive-deps disabled at `:46`).
- **Fix:** use the functional `set` updater and re-point `lastSavedDraft` after the seed (or gate the write).

### FE-5 · 🟠 Med · BoardPage top-level board fetch has no cancellation
- `pages/users/BoardPage.tsx:1119-1128` — `load()` does `.then(setBoard)/.catch(setError)/.finally(setLoading)` with no `cancelled` guard and no cleanup. Unmount mid-flight or rapid `userId`/`source` change → setState-after-unmount + slow-response-wins race. (`ComplianceDocuments` `:561-587` and `ReviewDocuments` `:1016-1022` in the same file already guard — inconsistent.)

### FE-6 · 🟠 Med · Programme-status save doesn't refresh the board
- `pages/users/BoardPage.tsx:228-241` — `HeroProgrammeStatus.save` sets only local `saved`, never calls `onReload`. Everything derived from `board.programme.status` (the `FinishEnrolment` "Enrolment complete" gate at `:285`, the onboarding badge, `StatusBadge`) stays stale until manual reload → contradictory status shown. (`cancelUser` at `:1217` correctly calls `onReload`.)

### FE-7 · 🟠 Med · `downloadIlrDocument` is a floating promise with no error/loading feedback
- `pages/users/wizard/steps/Ilr.tsx:225` — `onClick={() => downloadIlrDocument(ilr, board)}` not awaited/caught. If `buildIlrPdf`/`loadKentLogo` throws → unhandled rejection, no feedback, no spinner. Sibling "Save & file" (`:231`) is properly wrapped.

### FE-8 · 🟡 Low · Stale conditional answers persist into the filed PDF
- `Ilr.tsx:132-134` (`completedWhen`), `:86-87` (`yearsInUk`, `requiresWorkPermit`) — when a Yes/No trigger flips back, the dependent value isn't cleared. Validation stops requiring it, but `buildRows` (`ilrDocument.ts:117, 133`) prints it unconditionally → a contradicted answer can appear on the filed compliance PDF.

### FE-9 · 🟡 Low · `yearsInUk` can store NaN
- `Ilr.tsx:86` — `yearsInUk: v ? Number(v) : undefined`. A pasted non-numeric value → `NaN`; `NaN == null` is false so `ilrMissing` (`validation.ts:103`) treats it as answered and the PDF prints `"NaN"`.

### FE-10 · 🟡 Low · ComplianceDocuments can show "No documents" alongside four "not issued" rows
- `BoardPage.tsx:695-913` — when nothing exists, `<EmptyState text="No documents" />` (`:695`) renders at the same time as the four `…===null` "not issued yet" issue-rows (`:698/741/801/858`) → contradictory messaging.

### FE-11 · 🟡 Low · Unknown step slug silently falls back to step 0
- `WizardPage.tsx:110-111` and `learner/onboarding/page.tsx:155-156` — `idx === -1 ? 0 : idx`. A typo'd slug renders Introduction at a mismatched URL instead of redirecting/404.

> ✅ Off-by-one in step nav was checked — none found (`navigateTo` guards `target < 0 || target >= length`; title-bar Next guards `!isLast`).

## B.2 UX gaps

### FE-12 · 🟠 Med · Name-only "uploads" that store nothing
- `CvJob.tsx:26`, `SkillsRadar.tsx:302-305`, `Ilr.tsx:115` — only the filename string is kept in the draft; the file is never uploaded, and `FileList` renders it as a link to `href="#"` (`ui.tsx:271`). The user gets no indication the document wasn't stored and the "link" goes nowhere. (If deliberate mock, add a "reference only" hint; otherwise wire real upload.)

### FE-13 · 🟠 Med · Silent no-op controls on the PLR step
- `pages/users/wizard/steps/Plr.tsx:45` "Export to CSV" has no `onClick`; `:64` "Edit record" has no `onClick`; `:43` "Get PLR" injects a hardcoded `PLR_SAMPLE` regardless of the entered ULN. All read as working features but do nothing / mislead. (Verified.)

### FE-14 · 🟠 Med · FunctionalSkills exempt toggle & file actions are no-ops
- `BoardPage.tsx:355-358` — Exempt/Not-Exempt only flips local `useState` (never persisted); `FileList` gets `onDelete={()=>{}}` / `onAdd={()=>{}}`. Also `exempt` is seeded from `block.exempt` with no resync effect, so it goes stale after `onReload`.

### FE-15 · 🟡 Low · ILR evidence input can't re-add the same file
- `Ilr.tsx:115` — unlike `SkillsRadar.tsx:306` (which resets `e.target.value=''`), the ILR evidence input never resets, so selecting the same filename twice won't re-fire `change`.

### FE-16 · 🟡 Low · Apprenticeship/IBIS-specific copy shown to commercial learners
- `Introduction.tsx:8` ("apprenticeship with IBIS"), `NextSteps.tsx:11-16` (Apprenticeship Agreement, Aptem). The wizard is explicitly shared with commercial learners, for whom this is inaccurate.

### FE-17 · 🟡 Low · Dead placeholder links on the users list
- `page.tsx:471-473` — "Export" and "Column settings" are `<a href="#">` with no handler.

## B.3 Accessibility

### FE-18 · 🟠 Med · Wizard field labels not associated with inputs
- `components/ui.tsx:122-146` (`FieldRow`) renders the label in a plain `<div>` with no `htmlFor`; `LabeledInput/Select/Textarea` (`fields.tsx:34-128`) give controls no `id`. So no Personal Details / ILR field has a programmatic label (the test even notes this at `learnerStepGating.test.tsx:156`). `CreateUserModal.tsx:381-494` does it correctly — the wizard is the outlier.

### FE-19 · 🟡 Low · `aria-disabled` tabs stay clickable
- `WizardShell.tsx:229-236` (rail), `:310-312` (mobile), `:348` (title-bar Next) — locked tabs set `aria-disabled` but keep an active `onClick` and aren't `disabled`; they fire (raise a toast). An `aria-disabled` control that still acts is an a11y inconsistency.

## B.4 Duplication

### FE-DUP-1 · 🔴 High (size) · Six near-identical "party chip" components
- `BoardPage.tsx` — `DocumentParties` (`:378-415`), `AgreementParties` (`:418-445`), `IlrParties` (`:448-475`), `TrainingPlanParties` (`:478-506`), `WrittenAgreementParties` (`:509-533`), `SignatureParties` (`:956-1004`). All map a party list to emerald/neutral chips with identical classes and signed/not-signed logic. ~150 lines → one `<Parties parties={[…]} />`.

### FE-DUP-2 · 🔴 High (size) · Four near-identical issue/document-row blocks + handlers
- `BoardPage.tsx:603-688` (handlers) & `:698-913` (JSX) — Agreement/ILR/Training Plan/Written each carry a duplicated `issue*` handler, `signing*` boolean, `sign*AsProvider` handler, "not issued yet" placeholder, and document row. The learner-side `DocumentCard` (`compliance/DocumentCard.tsx`) already proves this is parameterisable — the admin side never adopted it.
- **Fix:** one config-driven `<ComplianceDocRow>` + shared handler factory.

### FE-DUP-3 · 🟠 Med · Three separate modal implementations
- A reusable `Modal` (`components/Modal.tsx`) exists with focus-trap/Esc/portal/scroll-lock, but `SignReviewModal.tsx:71-112` and `PriorLearningModal` in `reviews/form.tsx:197-233` hand-roll their own backdrop/panel/portal — and so lack the focus trap / Esc handling.

### FE-DUP-4 · 🟠 Med · Repeated evidence file-input block
- The "hidden file input + name-mapping" pattern is copy-pasted in `SkillsRadar.tsx:296-308`, `Ilr.tsx:113-116`, `CvJob.tsx:24-27`, each subtly different (only one resets `e.target.value` — see FE-15).

## B.5 Dead code

### FE-DEAD-1 · 🟠 Med · `completed` / `markComplete` in WizardContext (confirmed dead)
- `WizardContext.tsx:120-121, 194, 324-325, 371` — leftover from the progress rework; grep confirms no consumer reads `completed` or calls `markComplete` (the shell comment at `WizardShell.tsx:157` even says its "only mutator was never called"). Remove the state, the two interface members, the initializer, the value entries, and drop `completed` from the `useMemo` deps (`:371`).

### FE-DEAD-2 · 🟡 Low · `HeroStat` export unused
- `components/ui.tsx:53-60` — not imported anywhere (`page.tsx:11` imports `Hero`/`StatCard`, not `HeroStat`).

### FE-DEAD-3 · 🟡 Low · Exports used only internally
- `WizardContext.tsx:15` `ddmmToIso` (only caller: `makeInitialDraft` same file); `validation.ts:219` `firstIncompleteStep` (only used by `maxReachableStep`). Drop the `export` (or cover with a test). Minor: stale JSDoc on `SkillsRadar.tsx:99` (`commit` claims a return value; returns void).

> ⚠️ **Do not remove** `SignaturePad.defaultName` (`SignaturePad.tsx:32-39`) — marked `@deprecated` but still live at `BoardPage.tsx:792/849/906`. The tag is misleading given active use.

## B.6 Type safety

### FE-TS-1 · 🟠 Med · Unchecked `results as Ksb[]` casts
- `SkillsRadar.tsx:48, 62, 71` and `WizardContext.tsx:280` — raw API `results` cast to `Ksb[]` with no validation; a shape change surfaces as runtime `undefined` (e.g. `ksb.codes.join` at `SkillsRadar.tsx:197`).

### FE-TS-2 · 🟠 Med · `row as StaffUserRow` upcast treats optionals as required
- `page.tsx:264` — `setEditStaff(row as StaffUserRow)` where `DirectoryRow = UserListRow & Partial<StaffUserRow>`; relies on the untyped `source === 'staff'` invariant. A non-staff row would prefill `EditStaffModal` from `undefined`s.

### FE-TS-3 · 🟡 Low · Contained casts
- `ilrDocument.ts:210-213` jsPDF monkey-patch uses `as never`/`as typeof`; `page.tsx:341` / `BoardPage.tsx:1512` cast raw input to string-union filter types (option-constrained, low risk).

## B.7 Test gaps (frontend)

### TEST-FE-1 · 🔴 High · `validation.ts` has no unit tests
- The only test (`learnerStepGating.test.tsx`) covers gating/save/progress-count end-to-end. Untested pure logic: `personalDetailsMissing`, `ilrMissing` (largest, conditional follow-ups at `:103/107/124`), `cvJobMissing` (CV-or-experience, `:175-184`), `policiesMissing`, `skillsRadarMissing`, `badFormat`, `firstIncompleteStep`, `maxReachableStep`, `missingAcrossWizard` — the core completeness/gating rules.

### TEST-FE-2 · 🟠 Med · Date/age & format helpers untested
- `ageFromDob` (`WizardContext.tsx:31` — leap-year/future/>120/31-Feb branches), `ddmmToIso` (`:15`), `fmtDate` (`ilrDocument.ts:79`), and `formatError` email/tel/number regex (`fields.tsx:21-32`, reused by CreateUserModal + `badFormat`) have no direct coverage. Also the progress % calc (`WizardShell.tsx:169-170`) and the `ComplianceDocuments` `loaded` anti-flicker gate (`BoardPage.tsx:539-585`) are untested.

### TEST-FE-3 · 🟡 Low · PDF builders untested
- `ilrDocument.ts` `latin1` transliteration (`:65-76`) and `buildRows`/Yes-No marking (`:309-313`) — regressions would silently corrupt the filed compliance PDF.

---

# C. API clients & data contracts

## C.1 Bugs & correctness

### API-1 · 🟠 Med · Learner caches not invalidated after issuing/signing documents
- `BoardPage.tsx:604-688` (`issue*`, `sign*AsProvider`). The sign/issue endpoints call `advance_learner` and return `programmeStatus` + `programmeStatusChangedTo` (`apprenticeship_agreement.py:418/423-427`, and the other three) — i.e. signing can promote the learner to **Active** server-side. But BoardPage only sets local state; it never calls `invalidateWizardCacheById` (`extendedIlr.ts`) or `invalidateLearnerDetailCache` (`learnerDetail.ts`), unlike the write paths in `enrolmentUsers.ts:153/167` and `commercialUsers.ts:128`. → the wizard-bootstrap cache (TTL 30s) and learner-detail cache can serve a **stale board/status** for up to 30s. The clients also **discard** the `programmeStatusChangedTo` signal (they return only `data.agreement`/`data.document`).
- **Fix:** invalidate both caches in the issue/sign handlers; optionally surface `programmeStatusChangedTo` as a toast.

### API-2 · 🟠 Med · Board document fetches swallow all errors as "not issued yet"
- `BoardPage.tsx:570-581` — `fetchAgreement/Ilr/TrainingPlan/WrittenAgreement` all `.catch(() => {})`. But the backend models "no document yet" as **200 + `document: null`** (`apprenticeship_agreement.py:307`, etc.) — so a thrown error here is a real 404/500/502/network failure, not "absent". Blanket-catching makes a genuine failure indistinguishable from "not issued", so the officer sees the "Issue…" button and may re-issue. (Only `fetchEnrolmentDocuments` surfaces its error.)
- **Fix:** distinguish absent (200+null) from error; show an error state for the latter.

### API-3 · 🟠 Med · Unguarded `JSON.parse` in 7 clients
- `extendedIlr.ts:48`, `complianceDocuments.ts:65`, `enrolmentDocuments.ts:46`, `apprenticeshipAgreement.ts:78`, `ilrDocument.ts:48`, `trainingPlanDocument.ts:64`, `writtenAgreement.ts:60` — `JSON.parse(text)` with no try/catch. A Django 500 debug page or proxy 502 returns **HTML** → user sees raw `SyntaxError: Unexpected token '<'` instead of a readable message. `enrolmentUsers.ts`/`commercialUsers.ts`/`learnerDetail.ts` already guard it — inconsistent.

### API-4 · 🟠 Med · Bare `fetch` with no network-error catch in the 4 live document clients
- `apprenticeshipAgreement.ts:84/94/107`, `ilrDocument.ts:54/60/73`, `trainingPlanDocument.ts:72/80/94`, `writtenAgreement.ts:68/76/90` — a dropped connection throws raw `TypeError: Failed to fetch`, while `extendedIlr.ts:42-46` and `enrolmentDocuments.ts` produce a friendly "Could not reach the server" message. So within the *same* BoardPage panel, one row gives a friendly offline message and its neighbours give a cryptic one.

### API-5 · 🟡 Low · No request cancellation / in-flight dedup on document clients
- The 4 document clients + `enrolmentDocuments.ts` take no `AbortSignal` and don't use `cachedRequest`'s in-flight map. BoardPage fires 5 parallel fetches per learner guarded only by a `cancelled` boolean → StrictMode double-mount issues each twice; rapid learner-switching wastes in-flight work. Not state corruption (the flag prevents cross-learner setState).

### API-6 · 🟡 Low · `answers: {}` cast as full `IlrForm`
- `extendedIlr.ts:33-34, 50` vs `extended_ilr.py:65` (`row.answers or {}`). A saved-but-empty row yields `{}` typed as a fully-populated `IlrForm`; nested access assumes sub-objects exist. Defended in practice (WizardContext seeds a default), so low.

## C.2 Data-contract mismatches (TS type vs actual Django response)

### API-7 · 🟠 Med (latent) · `AgreementParticularsResponse` doesn't match its endpoint
- `complianceDocuments.ts:14-40` vs `apprenticeship_agreement.py:281-308`: `meta` declared `{datesFrom, moduleCount, planSaved, group, cohort}` but backend returns only `{datesFrom, moduleCount}` → `meta.planSaved/group/cohort` marked required but always `undefined`; `savedLearnerSignature?` never sent; `particulars` omits `durationWeeks` (which backend does send). Confirms the client was written against an older shape. (Effectively dead today — see DEAD below; the correct shape is `apprenticeshipAgreement.ts`'s `AgreementResponse`.)

### API-8 · 🟡 Low · Upload return typed wider than the POST body
- `enrolmentDocuments.ts:67-89` declares full `EnrolmentDocument`, but `documents.py:194-198` returns a partial `{id, docType, docLabel, filename, path, signed}` (no `sizeBytes`, no `generatedAt`). Both call sites discard the return value, so low.

### API-9 · 🟡 Low · `sign*` responses drop extra fields
- `documents.py:397-401` returns `signedName/signedAt`; the 4 learner_api sign endpoints return `programmeStatus/programmeStatusChangedTo` — all typed away by the clients. This is *why* API-1 loses the status-change signal.

### API-10 · 🟡 Low · `age` modelled as both number and string
- `types.ts:251` `PersonalDetails.age?: number` (draft jsonb, never coerced) vs `enrolmentUsers.ts:44`/`commercialUsers.ts:16` `AptemUserFields.age?: string` (backend `to_commercial_row` → `_s()` → string). The two representations never reconcile.
- ✅ Dates are consistently `string` (ISO) on both sides — no date-as-Date mismatch found.

## C.3 Duplication

### API-DUP · 🟠 Med · Request/parse helper copy-pasted ~10×, diverged
- `request`/`readJson` bodies in all 9 clients + `learnerDetail.ts` have diverged: 3 guard `JSON.parse`, 7 don't (API-3); 2 guard network errors, most don't (API-4). This is the **root cause** of the inconsistent error UX. Also scattered `BASE`-URL constants (several files declare two) and per-call `Content-Type` headers.
- **Fix:** one shared `apiRequest<T>(url, init)` (network catch + guarded parse + `!res.ok → data.error` + the `as T`) — fixes API-3, API-4, and gives one place for the header, the base URLs, and future auth/validation. `cachedRequest.ts` is the natural home.

## C.4 Dead code

### API-DEAD-1 · 🟠 Med · `complianceDocuments.ts` — entire file dead
- All 6 exports (`fetchAgreementParticulars`, `fetchComplianceDocuments`, `uploadComplianceDocument`, `signComplianceDocument`, `replaceComplianceDocumentFile`, `documentDownloadUrl`) have **zero importers** (the only "complianceDocuments" hit is the unrelated `EnrolmentBoard.complianceDocuments` field in `types.ts:234`). Superseded by `enrolmentDocuments.ts` + `apprenticeshipAgreement.ts`, and its types are already stale (API-7). **Delete it** — also removes the worst API-3/API-4 offenders.

### API-DEAD-2 · 🟡 Low · `fetchCommercialUsers` dead
- `commercialUsers.ts:92` — no importers (the commercial list uses `fetchEnrolmentUsers`). Every other export in that file is live.

### API-DEAD-3 · 🟡 Low · Deprecated fields still shipped
- `commercialUsers.ts:32-37` `modules/weeks/components` marked `@deprecated` ("use trainingPlan") but still populated by the backend (`mappers.py:581-583`). Cleanup once no consumer reads them.

## C.5 Type safety

### API-TS-1 · 🟠 Med · Systemic unchecked `as T` with no runtime validation
- Every request helper ends `return data as T` with no check (`extendedIlr.ts:50`, and the analogous line in all others). Combined with the C.2 mismatches, TypeScript gives false confidence — declared response types are asserted, never verified, so contract drift silently becomes `undefined` at runtime. A shared helper (API-DUP) is the natural place to add lightweight validation.

### API-TS-2 · 🟡 Low · `contacts: Record<string, any>`
- `trainingPlanDocument.ts:40/56`, `writtenAgreement.ts:37/52` — the backend `contacts` shapes are fixed/knowable, so these `any`s could be typed.

---

# Cross-cutting themes (what actually causes most of this)

1. **No auth layer** (BE-2) makes every other backend endpoint reachable by anyone — settle this first.
2. **Backend document duplication** (BE-DUP) is why the atomicity (BE-1) and locking (BE-4) bugs each exist in 4 places. Extract one signing helper and fix once.
3. **No shared HTTP helper on the frontend** (API-DUP) is why JSON-parse guarding (API-3), network-error UX (API-4), and response validation (API-TS-1) are inconsistent. Introduce `apiRequest` and route all 9 clients through it.
4. **BoardPage duplication** (FE-DUP-1/2) is why FunctionalSkills/compliance UX bugs and the cache-invalidation gap (API-1) hide in copy-pasted blocks. The learner-side `DocumentCard` is the pattern to adopt.
5. **Thin tests** (TEST-BE-1, TEST-FE-1) mean none of the above would be caught by CI.

# Suggested sequencing (once you pick)

1. **Data-integrity & security:** BE-2 (confirm/lock auth), BE-1 (atomic `using=`), BE-3 (partial-answers wipe), BE-4 (sign lock). Small, high-value.
2. **Visible UI bugs** (the screens you were just on): FE-1, FE-2, FE-3, FE-6, API-1, API-2, FE-13/FE-14.
3. **Delete dead code:** API-DEAD-1, FE-DEAD-1, API-DEAD-2, FE-DEAD-2 — shrinks surface before refactor.
4. **Consolidate:** API-DUP (`apiRequest`) → then BE-DUP (backend signing helper) and FE-DUP-1/2 (`<Parties>` + `<ComplianceDocRow>`).
5. **Lock it in:** TEST-BE-1/TEST-BE-2 and TEST-FE-1/TEST-FE-2, ideally alongside each fix above.

---

*Tell me which IDs to implement — e.g. "do BE-1, BE-3, BE-4, FE-1, FE-2, FE-3, API-1, API-2, and delete the dead code" — or "do the TL;DR list". I'll implement and verify the ones you choose.*
