# Step 8 — `edit_quiz_draft` and `clone_quiz_version`

## Goal
Safe changes to AI-made quizzes without ever damaging learner attempt history.

## Tasks
8.1 Shared check `quiz_is_editable(quiz_id) -> (bool, reason)`: status must be draft AND attempt_count == 0
    AND not trashed. Reasons in plain English.
8.2 `edit_quiz_draft(quiz_id, changes)` where changes =
    `{title?, passing_grade?, duration_minutes?, add_questions?:[…same schema as Step 7…],
      update_questions?:[{question_id, text?, explanation?, ksb_codes?, answers?}],
      archive_question_ids?:[…]}`.
    - Not editable → error offering `clone_quiz_version`.
    - Same validation as Step 7 for new/updated questions.
    - Apply via existing quiz/question PATCH endpoints. NEVER send `removeMissing`; archive via `is_archived`.
    - If ksb_codes change → add missing component mappings (additive only, as Step 7.11).
    - Preview shows a before/after diff per question.
8.3 `clone_quiz_version(quiz_id, changes?)`:
    - Copies quiz + non-archived questions into a NEW draft quiz, title "<title> (v<n+1>)", version incremented.
    - Applies `changes` to the copy.
    - Does NOT relink the component (live learners keep the old quiz). Preview + result text tell the user to
      switch the component link in the Module Builder after review.
8.4 Neither tool ever changes a published quiz in place.

## Tests
Edit draft with 0 attempts OK; edit with attempts refused; edit published refused; archive not delete;
clone keeps original untouched (question/answer ids unchanged); clone not linked.

## Acceptance checklist
- [ ] Attempted quiz edit refused with clone suggestion; clone created as unlinked draft.

## Implementation notes (2026-11-11)

Implemented in `mcp_api/tools/quiz_edit.py`, behind `MCP_QUIZ_CREATION_ENABLED`. Tests:
`mcp_api/tests/test_quiz_edit.py`.

**`quiz_is_editable` (8.1)**
- A quiz is editable only when it is a draft, not in the trash, and has 0 attempts. The attempt count comes
  from `learner_progress_entries`, as `get_quiz` uses.

**`edit_quiz_draft` (8.2)**
- **Questions.** Changes go through `PATCH /quiz_api/quizzes/<id>/questions/` (now on the allowlist):
  - Every current question is sent in its current order, so the order is kept.
  - Archived questions are sent with `isArchived: true` and are never deleted. `removeMissing` is never sent.
  - Answers are sent only when they change, because the endpoint replaces changed answer rows. That is safe
    only because the quiz has no attempts.
- **Title, pass mark, duration.** These go through `PATCH /quiz_api/quizzes/<id>/`. A title change always
  sends the quiz's `weekId`; without it the LMS rebuilds the quiz's week link.
- **KSB codes.** These need the linked `module_id` and `component_id`, and that component must link this quiz.
  New codes are added to the component additively, and the "KSBs: …" line in the explanation is rewritten.
- **Preview.** It shows each updated question before and after, plus what was added and archived.
- **Concurrency.** The quiz's `updatedAt` is in the preview payload, so a quiz changed after the preview is
  refused before anything is written.

**`clone_quiz_version` (8.3)**
- **Copy.** Non-archived questions, with any changes applied, go to `create-with-questions` as a new draft
  titled "<title> (vN)" with version `vN.0`. Pass mark, duration and randomisation are copied.
- **No relinking.** The copy is not linked to any component, and the original is untouched.
- **KSB codes are refused in a copy.** It has no component to map them to.
- **Legacy ids.** A quiz with a numeric (legacy) programme id is refused, as in Step 7.
- **Not checked.** A real-database run of the questions endpoint, and "Untitled question" fallbacks in the
  read-back.
- [ ] Acceptance: not yet run against a real database.
