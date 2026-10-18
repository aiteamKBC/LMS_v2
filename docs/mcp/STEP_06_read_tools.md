# Step 6 — Read-only tools (Phase A)

## Goal
The AI can find exactly where content goes and what KSBs are allowed, without guessing.

## Common rules for every read tool
- Implemented via `dispatch.call_api` against existing GET endpoints; shape the output down to the listed fields.
- Exclude archived / deleted / trashed items by default (`include_archived=false` arg).
- Name queries: case-insensitive contains; max 20 results; return `total` so the model knows if it's truncated.
- Output passes `assert_no_pii`. Only ids, names, codes, counts, statuses, dates.
- Text summary first line answers the question in plain English.

## Tasks (one sub-task per tool; write tests per tool before the next)
6.1 `find_programmes(query?)` → `[{programme_id, name, level, status, applied_standard:{source_id, title}|null}]`.
    Source: curriculum programmes collection endpoint. Flag `applied_standard=null` clearly ("quizzes can't be
    KSB-mapped until a standard is applied").
6.2 `find_cohorts_groups(programme_id)` → cohorts `[{cohort_id, name, start_date, end_date, status,
    groups:[{group_id, name, coach_name, weekday, status}]}]`. Coach NAME only, no email.
6.3 `find_modules(programme_id?, query?)` → `[{module_id (module_catalogue_id), name, programme_name, status,
    week_count}]`.
6.4 `get_module_structure(module_id)` → `{module, weeks:[{week_id, title, order, components:[{component_id,
    title, type, linked_quiz:{quiz_id,title,status}|null, ksb_codes:[…]}]}]}` from
    `curriculum/modules/<id>/structure/`. Resolve linked quiz using the same logic as
    `quiz_api/key_readiness.LINKED_QUIZ_IDS_SQL` (read-only).
6.5 `list_standard_ksbs(programme_id)` → `{standard:{source_id,title}, ksbs:[{code, type K|S|B, description}]}`
    via `learner_api/ksb_sources.parse_source/resolve_source` using the programme's `ksb_profile_source_id`
    read SERVER-side. Optional `type` filter, `query` filter on description.
6.6 `ksb_coverage(programme_id | module_id)` → `{covered:[{code, count}], gaps:[{code, description}]}` from the
    existing `.../ksb-coverage/` endpoints.
6.7 `get_quiz(quiz_id)` → `{quiz_id, title, status, version, passing_grade, linked_to:[…], question_count,
    attempt_count, questions:[{question_id, type, text, answers:[{text,is_correct}], explanation}]}`.
    `attempt_count` from `learner_progress_entries` (count only — never learner ids).
6.8 `list_books(query?)` → knowledge_base books `[{book_id, title, status, pages}]` (only accepted builds).
6.9 `search_books(book_ids[], topic, k=8)` → passages `[{book_id, title, pages, text (≤1200 chars)}]` via
    `knowledge_base/retrieval.py` (topic candidate path). Respect `PaidCallsDisabled` / KnowledgeBaseUnavailable →
    friendly error. Count against the book-search rate limit.

## Tests (per tool)
Permission: token for account without curriculum grant → refused. Not found id → friendly error.
Ambiguous query → multiple results, no guess. Archived excluded. PII guard passes on real branch data.

## Acceptance checklist
- [ ] Inspector: ask Claude "which modules are in <programme>?" and "which KSBs does it use?" → correct answers on branch.
- [ ] No writes performed by any tool (assert no revisions created during test run).
