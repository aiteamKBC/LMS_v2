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
