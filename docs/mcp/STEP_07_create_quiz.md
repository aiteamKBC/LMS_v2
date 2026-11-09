# Step 7 — `create_quiz_draft` (Phase B, the core feature)

## Goal
One preview → apply creates a draft quiz, links it to the right component, and maps its KSBs as real data.

## Input schema
```
{ module_id, week_id,
  component_id?  |  new_component?: {title, expected_otjh_minutes?},
  title, passing_grade?: 65, duration_minutes?, randomize_questions?: false,
  source_book_id?,
  questions: [ { type: "single_choice"|"multiple_choice"|"true_false"|"fill_gap"|"keywords"|"ordering"|"matching",
                 text, explanation, points?: 1, ksb_codes: [string],
                 answers: [ {text, is_correct} ] } ]   (1..100 questions) }
```
Exactly one of `component_id` / `new_component`.

## Validation (in `validate`, all errors returned together, each naming the question number)
7.1 Target: module exists, not archived; week belongs to module; component belongs to week; component has no
    linked quiz already (else error: "Component X already has quiz Y — use a new component or clone").
7.2 Programme of the module has an applied standard (else refuse).
7.3 KSB codes: normalise (trim, upper); must be in `list_standard_ksbs` set. Unknown → error with up to 3
    suggestions (same code prefix, then description similarity). Legacy dotted (`K4.2`) → specific message
    "K4.2 is an old manual code; this programme uses <standard>. Did you mean K4?".
7.4 Question rules — reuse `quiz_api/intake.py` and `answer_keys.py` (call their functions; do not reimplement):
    single_choice & true_false exactly 1 correct; true_false exactly 2 answers; multiple_choice ≥2 correct and
    ≥1 wrong; ≥2 answers; no duplicate answers; fill_gap/keywords/ordering per existing intake rules.
7.5 Duplicates: normalised stem (lowercase, collapse whitespace, strip punctuation, Arabic: remove diacritics
    U+064B–U+0652 and tatweel U+0640, unify alef forms) — duplicate within payload → error; match in question
    bank (`/quiz_api/question-bank/` search) → warning only.
7.6 Content: Markdown only; reject `<script`, `<iframe`, `on*=` attributes, raw HTML tags (A8). Length caps:
    question 2,000 chars, answer 500, explanation 4,000.
7.7 If `source_book_id`: must exist and be accepted.

## Preview
"Create DRAFT quiz '<title>' — 12 questions (8 single, 4 multiple) in <Programme> › <Module> › <Week> ›
<Component or 'new component <title>'>. KSBs: K4 (5 questions), S2 (3), B1 (1). New KSB mappings to add to the
component: S2, B1 (K4 already mapped). Warnings: Q3 is similar to an existing bank question."

## Apply (sequence, record each sub-step for partial-failure reporting)
7.8 If `new_component`: create component via existing components endpoint (draft).
7.9 `POST /quiz_api/quizzes/create-with-questions/` with `initialQuestions` (mapping: type→questionType,
    text, explanation (append "KSBs: …" line for human readers), answers[{text,isCorrect}]), status draft,
    programme/module ids explicitly (avoid the free-text guessers `_match_programme_catalogue_id`).
7.10 Link ONE canonical way: component `settings_json.linkedQuizId` via component update endpoint AND
    `quiz_component_links` (follow exactly what the Module Builder does when a user selects a quiz on a
    component — find that code path and call the same endpoint).
7.11 KSB mapping: for codes not already on the component, POST to `curriculum/components/<id>/ksb-mappings/`
    with `classification:"secondary", weight_class:"soft", weight:1, source_type` from the programme standard.
    Existing mappings untouched. (Check `ensure_authoring_mapping_unique`.)
7.12 Return quiz_id, component_id, deep links to Quiz Builder edit page and Module Builder week.

## Tests
Happy path (existing component and new component); each validation rule; component already has quiz;
programme without standard; legacy code suggestion; Arabic duplicate detection; HTML rejected; partial failure
at 7.10 reported correctly; result visible via `get_module_structure`; revisions show actor + mcp source.

## Acceptance checklist
- [ ] On branch, from Claude: "Create a 5-question quiz on <topic> from <book> for <module> week 2" → preview →
      confirm → quiz appears as draft, linked, KSBs visible in the Module Builder.
