# Enrolment Section — Audit & Improvement Report

**Date:** 2026-08-12
**Scope:** The enrolment feature end-to-end — backend `enrolment_api/` + the `learner_api/` document modules it drives, the frontend enrolment wizard (`pages/users/wizard/`, learner onboarding mount), the admin board (`BoardPage.tsx`), and the 9 enrolment API clients.

## How to use this document

Each finding has an **ID**, a **severity**, a **file:line**, what it is, why it matters, and a suggested fix.
Read through, then tell me which IDs you want actioned — I'll implement the ones you pick.
Nothing in here has been changed yet; this is read-only analysis.

Severity key: **🔴 High** (real bug / data-integrity / security) · **🟠 Med** (correctness or maintainability risk) · **🟡 Low** (polish / hygiene).

---

## 0. TL;DR — the 8 I'd action first

| # | ID | Severity | One-liner |
|---|-----|----------|-----------|
| 1 | **B-1** | 🔴 High | The 4 document "issue" endpoints run `transaction.atomic()` on the **wrong database** — supersede+create is not actually atomic. |
| 2 | **B-6** | 🔴 High* | **No auth check** on any enrolment endpoint — anyone who can reach the URL can read/patch a learner & sign documents (*verify your gateway*). |
| 3 | **F-3** | 🟠 Med | `CvJob` file input **clears the CV** if the picker is cancelled, and can't re-add the same filename. |
| 4 | **F-4** | 🟠 Med | ILR **"Saved" badge lies** — stays green after the learner edits fields (never marked dirty). |
| 5 | **A-3 / F-2** | 🟠 Med | Dead code: `complianceDocuments.ts` (whole file unused) and `completed`/`markComplete` in `WizardContext`. |
| 6 | **A-1** | 🟠 Med | Blanket `.catch(() => {})` on 4 board fetches hides real server errors as "not issued yet". |
| 7 | **T-1 / T-2** | 🔴/🟠 | Backend `enrolment_api` has **no behavioural tests**; frontend `validation.ts` untested. |
| 8 | **D-1 / F-6** | 🟠 Med | Heavy duplication: 4 copy-pasted document modules (backend) & 4 copy-pasted doc rows + parties chips (BoardPage). |

\* B-6 is High **if** there is no upstream gateway enforcing auth; Med if there is. Needs a one-line confirmation from you.

---

## 1. Backend — Bugs & correctness

### B-1 · 🔴 High · `transaction.atomic()` on the wrong DB (not atomic)
- `learner_api/apprenticeship_agreement.py:333`, `written_agreement.py:296`, `training_plan_document.py:391`, `ilr_document.py:257`
- Each "issue" endpoint does `with transaction.atomic():` **with no `using=` argument**. But these models are `managed=False` and routed to the **`enrolment`** database (`learner_api/routers.py:11-24`). A bare `transaction.atomic()` opens a transaction on `default` (SQLite) — which never touches the connection the writes actually go through.
- **Impact:** the "supersede the active row, then create a new active row" sequence is *meant* to be atomic. If the `create` fails after the supersede `save()`, you can be left with **zero active rows**; two racing issues can leave **two active rows** (and `_active_document(...).first()` silently picks one).
- **Fix:** `with transaction.atomic(using="enrolment"):` — there's already a correct example to copy at `enrolment_api/extended_ilr.py:179`. One-line change ×4.

### B-2 · 🟠 Med · `advance_learner` has no row lock — concurrent signs can double-advance
- `learner_api/learner_progression.py:120-151`
- Reads `programme_status`, then `save()`s a new status, no `select_for_update`. The Ready→Active branch runs `sync_active_user(learner)` as a side effect. Two near-simultaneous signatures (employer + provider) can both see `Ready to enrol` and both run the Active transition + side effect.
- **Fix:** wrap the read+write in `transaction.atomic(using="enrolment")` + `select_for_update()`, or make the transition idempotent.

### B-3 · 🟠 Med · `sign_document` does two UPDATEs with no transaction
- `enrolment_api/documents.py:359-392`
- Writes the party's signature columns, then a second UPDATE recomputes the summary `Signed` flag — not wrapped in `transaction.atomic(using="enrolment")` (unlike `extended_ilr`). A failure between them records the signature but leaves `Signed` stale.
- **Fix:** wrap the pair.

### B-4 · 🟡 Low · Signed-date columns are free-text, unvalidated
- `enrolment_api/models.py:42,44` (TextField) fed by `extended_ilr.py:56-58` from the client's `answers.…date` with no format check. Any string is persisted as the signed date. Display-only, but worth a format guard.

### B-5 · 🟡 Low · `commercial_board` PATCH: two keys map to one column (last-write-wins)
- `enrolment_api/views.py:44,49,50` — `organization`+`reference` both map to `organization`; `username`+`name` both map to `username`. If a client sends both, dict order silently decides the winner.
- **Fix:** reject conflicting keys, or document precedence.

### B-6 · 🔴 High (verify) · No authentication/authorization on any enrolment endpoint
- Every view in `enrolment_api/views.py`, `extended_ilr.py`, `documents.py`, `wizard_bootstrap.py`, and the four `learner_api` document modules is `@csrf_exempt` with **no `login_required`, no permission check, no `request.user` use**. Verified: `config/settings.py` middleware includes `AuthenticationMiddleware` (populates `request.user`) but **nothing requires a login**.
- **Impact:** if no upstream gateway enforces auth, any unauthenticated caller reaching the URL can read/patch a learner's board, sign compliance documents, and issue agreements.
- **Action needed from you:** is there a gateway/proxy in front of Django that enforces auth? If not, this is High and we should add `login_required` / a permission mixin.

---

## 2. Backend — Missing validation

### V-1 · 🟠 Med · `documents` upload trusts client-supplied MIME only
- `enrolment_api/documents.py:153` — gates on `f.content_type not in ALLOWED_TYPES`. `content_type` is set by the client and trivially spoofed; there's no `%PDF` magic-byte check. `learner_name` (line 186) is taken raw with only `.strip()`.
- **Fix:** validate the file header bytes; cap/validate `learner_name`.

### V-2 · 🟠 Med · `commercial_board` PATCH coerces every field with no per-field validation
- `enrolment_api/views.py:162-172` — `programme_status` accepts any string (no allow-list), `email`/`phone` unvalidated, no length caps; `trainingPlan` checked only to be a list, element shapes unvalidated.

### V-3 · 🟡 Low · `extended_ilr` PUT stores `answers`/`draft` jsonb unvalidated (by design)
- `enrolment_api/extended_ilr.py:163-172`, capped at 2 MB (`MAX_ANSWERS_BYTES`). Documented as intentional; noted for completeness.

---

## 3. Backend — Duplication

### D-1 · 🟠 Med · Four document modules are near-identical boilerplate
- `_party_json`, `_learner_kind`, `_error`, `_iso`, `MAX_SIGNATURE_CHARS`, and the **entire `sign_*` endpoint body** (party check, signature length/prefix/name validation, assign, `recalculate_signed()`, `advance_learner`) are copy-pasted across `apprenticeship_agreement.py`, `written_agreement.py`, `training_plan_document.py`, `ilr_document.py` (+ a 5th `_learner_kind` in `learner_progression.py:57`, and `MAX_SIGNATURE_CHARS` again in `documents.py:234`).
- The shared `_group_dates`/`_to_date`/`_weeks_between` are already correctly *imported* from `apprenticeship_agreement` — proving a shared base is feasible; the signing/serialisation layer just wasn't extracted.
- **Impact:** a fix to signature validation must be made in 4+ places and they can drift.
- **Fix:** extract a `document_signing` helper module (base serialise + `sign` handler).

---

## 4. Frontend — Bugs & correctness

### F-1 · 🟠 Med · ILR "reuse personal signature" effect has stale-closure / mount-dirty risk
- `pages/users/wizard/steps/Ilr.tsx:37-47`
- The effect (`exhaustive-deps` disabled) closes over `ilr.learnerSignature`; a concurrent edit to another `learnerSignature` field the same tick can be clobbered by the stale spread. It also mutates the draft **on mount** whenever a personal signature exists, dirtying `lastSavedDraft` and triggering an unintended background save/spinner the first time the ILR step opens.
- **Fix:** use the functional `set` updater form and gate the mount write.

### F-3 · 🟠 Med · CvJob file input clears the CV on cancel / can't re-add same file
- `pages/users/wizard/steps/CvJob.tsx:26` — `set({ cvFile: e.target.files?.[0]?.name })`. Cancelling the dialog yields `undefined` → clears the value. Input is never reset (`e.target.value=''`), so re-selecting the same filename after delete won't fire `onChange`.
- **Fix:** `const name = e.target.files?.[0]?.name; if (name) set({ cvFile: name }); e.target.value = '';`

### F-4 · 🟠 Med · ILR "Saved" badge stays green after edits (misleading)
- `pages/users/wizard/steps/Ilr.tsx:234-238` — shows "Saved" whenever `ilrSavedAt && !ilrSaving && !ilrFiling`. `ilrSavedAt` is set on hydration/prior save and never cleared when the draft becomes dirty, so it reads "Saved" over unsaved edits.
- **Fix:** clear/hide the badge when the current draft differs from `lastSavedDraft`.

### F-5 · 🟠 Med · Finish vs background-save race
- `pages/users/wizard/WizardShell.tsx:115-146, 170-177` — `navigateTo` fires an un-awaited `saveIlr()`; a Finish pressed right after a Next can have the finish-save resolve before an older in-flight draft write, briefly leaving stale server data. Low real-world impact but a genuine ordering gap.

### F-7 · 🟡 Low · Unknown step slug silently falls back to step 0
- `pages/users/wizard/WizardPage.tsx:110-111` and `pages/learner/onboarding/page.tsx:155-156` — `idx === -1 ? 0 : idx`. A typo'd slug renders Introduction at a mismatched URL instead of redirecting/404.

### F-8 · 🟠 Med · Accessibility: labels not associated with inputs
- `pages/users/wizard/steps/fields.tsx:60-80` (systemic) — inputs lack `htmlFor`/`id` pairing (the gating test even notes `getByLabelText` can't reach them). Clicking a label doesn't focus its field; SR announces them separately.
- Also `WizardShell.tsx:229/310`: locked tabs use `aria-disabled` but stay clickable buttons that no-op — focusable controls that do nothing.

---

## 5. Frontend — UX gaps

### U-1 · 🟠 Med · "Uploads" are name-only with no indication
- `pages/users/wizard/steps/SkillsRadar.tsx:302-306` and ILR evidence — file pickers capture only `f.name`; no real upload, no size/type validation, no progress. If this is a deliberate mock, fine — but the learner believes evidence is attached. Recommend a visible "reference only" hint or wiring real upload.

### U-2 · 🟠 Med · No persistent "unsaved changes" indicator
- `WizardShell.tsx` — background navigate-saves and the learner finish path rely on transient toasts; a dropped save leaves only a fleeting message.

### U-3 · 🟡 Low · Silent no-op clicks on the learner compliance page
- `pages/learner/compliance/page.tsx:151-153` — preview/download no-op (`?.`) when the doc is null, giving no feedback.

### A-1 · 🟠 Med · Board fetches swallow all errors as "not issued yet"
- `pages/users/BoardPage.tsx:572-581` — `fetchAgreement/Ilr/TrainingPlan/WrittenAgreement` all `.catch(() => {})`. A real server/network error is indistinguishable from "no document" → the row shows "not issued yet" and offers an Issue button on a doc that may already exist.
- **Fix:** distinguish 404/"absent" from real errors (ties into A-6 below).

---

## 6. Frontend — API-client layer

### A-2 · 🟠 Med · Unguarded `JSON.parse` in 7 of 9 clients
- `extendedIlr.ts:47`, `complianceDocuments.ts:64`, `enrolmentDocuments.ts:45`, `apprenticeshipAgreement.ts:77`, `ilrDocument.ts:47`, `trainingPlanDocument.ts:63`, `writtenAgreement.ts:59`. Only `enrolmentUsers.ts`/`commercialUsers.ts` guard it. A non-JSON 200 (HTML error page, proxy body) throws a raw `SyntaxError` instead of a readable message.

### A-2b · 🟠 Med · Inconsistent network-error UX
- Document clients use bare `fetch()` with no try/catch, so a dropped connection rejects with raw `TypeError: Failed to fetch`, while `extendedIlr`/`enrolmentUsers`/`commercialUsers`/`enrolmentDocuments` produce the friendly "Is the backend running on port 8000?" message.

### A-3 · 🟠 Med · Dead module: `complianceDocuments.ts` (all 6 exports unused)
- `fetchAgreementParticulars`, `fetchComplianceDocuments`, `uploadComplianceDocument`, `signComplianceDocument`, `replaceComplianceDocumentFile`, `documentDownloadUrl` — **zero importers** in `src/` (the board uses `enrolmentDocuments.ts` + the dedicated document clients). This dead file also carries the A-2 boilerplate bugs.
- **Fix:** delete the file. Also `fetchCommercialUsers` (`commercialUsers.ts:92`) has no callers.

### A-4 · 🟠 Med · No cancellation on the board fetch
- `BoardPage.tsx:1119-1128` — `useEffect(load)` calls `.then(setBoard)` with no `cancelled` guard; navigating away mid-flight sets state on an unmounted component. (`WizardPage`/`ComplianceDocuments` already do this correctly — copy that pattern.)

### A-5 · 🟠 Med · `HeroProgrammeStatus.save` doesn't reload the board
- `BoardPage.tsx:228-241` — after save it invalidates the wizard cache and updates only its local `saved` state; the header/`FinishEnrolment` gate elsewhere keep showing pre-save values until a manual reload. `cancelUser` (1217) correctly calls `onReload()`; this path doesn't.

### A-6 · 🟠 Med · "Absent" modelled two different ways
- `extendedIlr.ts` models "nothing saved" as `200 + answers: null`, but the document clients **throw** on non-ok and the board reinterprets *any* throw as "not issued" — the root reason A-1 has to blanket-catch.

### A-7 · 🟠 Med · Request/parse boilerplate duplicated 9× → introduce one `apiFetch`
- Two shapes (`request<T>` in 3 files, `readJson<T>` in 6) diverge on: guarded JSON.parse (A-2), network-error message (A-2b), and error-field extraction. **A single shared `apiFetch` helper fixes A-2, A-2b, A-6, A-7 together** and gives one place to add an auth header later.

### A-8 · 🟡 Low · Type-safety systemic
- Unchecked `return data as T` in every client (no runtime validation); `contacts: Record<string, any>` in `trainingPlanDocument.ts`/`writtenAgreement.ts`; `AptemUserFields.age?: string` but the wizard computes a **number** (`WizardContext.tsx:31`); `CommercialUserRow` fields typed required but backend may omit them.

---

## 7. Frontend — Dead code

### F-2 · 🟠 Med · `completed` / `markComplete` in WizardContext are dead
- `pages/users/wizard/WizardContext.tsx:120-121, 194, 324-325, 371` — leftover from the progress rework (the consumer was removed, the producer remained). Confirmed unused across `frontend/src`. Remove the state, the two interface members, the initializer, the value entries, and drop `completed` from the `useMemo` deps (371) to cut needless re-render churn.

### F-9 · 🟡 Low · `firstIncompleteStep` exported but only used internally
- `pages/users/wizard/validation.ts:219` — used only by `maxReachableStep` in the same file. Drop the `export` or cover it with a test.
- Minor: stale JSDoc on `SkillsRadar.tsx:99` (`commit` says it returns an index but returns void).

---

## 8. Frontend — Duplication

### F-6 · 🟠 Med · BoardPage document rows & parties chips copy-pasted
- `BoardPage.tsx:698-913` — four "not issued yet" placeholders + four "issued document" rows are structurally identical (label/icon/handlers differ). `BoardPage.tsx:378-533` — five near-identical `*Parties` components (~120 lines).
- The **learner side already solved this** with `pages/learner/compliance/DocumentCard.tsx` — the admin side never adopted the pattern.
- **Fix:** a config-driven `<ComplianceDocRow>` + one `<Parties>` component. Also the four `issue*`/`sign*AsProvider` handlers (604-688) are extractable.

---

## 9. Test gaps

### T-1 · 🔴 High · `enrolment_api` has no behavioural tests
- `enrolment_api/tests.py` is the empty stub. Only `tests_document_schema.py` exists (DDL text parsing, not behaviour). **Untested:** `extended_ilr` GET/PUT (upsert, signature-state derivation, 413/400 paths), `commercial_board` GET/PATCH (whitelist + rejection), `documents` POST/GET/download/replace/sign (party routing, completion logic), `wizard_bootstrap` (promote+advance side effects), and — most logic-dense of all — `wizard_steps.project_draft`/`read_projection` (RAG mapping, legacy values, orphan-record deletion, policy-ack timestamps). **Zero coverage.**

### T-2 · 🟠 Med · Frontend `validation.ts` + date helpers untested
- The only wizard test is `learnerStepGating.test.tsx`. Untested: `isStepComplete`/`missingForStep` per step (subtle conditional branches — yearsInUk only when `residentPrev3Years===false`, work-permit only when `ukEeaNational===false`, `completedWhen` only when `attended12m===true`, CV-or-experience alternation, email/tel `badFormat`); `maxReachableStep`/`firstIncompleteStep`/`missingAcrossWizard` (drive the URL guard + Finish backstop); `ageFromDob`/`ddmmToIso` (leap-year, future/out-of-range, DD/MM edge cases); the progress % calc; and the `ComplianceDocuments` `loaded` anti-flicker gate.

### T-3 · 🟠 Med · `learner_api` signing/progression partially covered
- `learner_api/tests.py` covers `advance_learner` transitions and `_as_date`, but **not** the four `sign_*` endpoints, the empty-signature-withdrawal path, or `recalculate_signed` for 3-party docs. The B-1 atomicity bug would not be caught by any existing test.

---

## Suggested sequencing (once you've picked)

1. **Correctness first:** B-1 (atomic DB), then confirm B-6 (auth) and B-3/B-2 (transactions/locks). Small, high-value.
2. **User-facing bugs:** F-3, F-4, A-1/A-5 — visible in the admin UI you were just looking at.
3. **Delete dead code:** A-3, F-2, `fetchCommercialUsers` — reduces surface before refactor.
4. **Consolidate:** A-7 (`apiFetch` helper) → then D-1 and F-6 (extract shared components/modules).
5. **Lock it in:** T-1/T-2/T-3 tests, ideally alongside each fix above.

---

*Tell me the IDs you want done (e.g. "do B-1, F-3, F-4, A-3, F-2") and I'll implement them, or say "do the TL;DR list" for the top 8.*
