# LMS Pre-UAT Hardening Report — 2026-08-17

Live database: Neon PostgreSQL 18.4 (`neondb`).

## Legacy progress classification

Every one of the 65 learner progress rows now carries an explicit
`component_link_status`. **Unexplained = 0.**

| Status | Source | Rows |
|---|---|---|
| `resolved_to_current_component` | `learner_training_plan_components.curriculum_component_id` | 45 |
| `resolved_to_current_component` | direct (already valid) | 1 |
| `valid_legacy_non_component_activity` | `quiz_ref` | 16 |
| `resolved_to_deleted_component` | plan lineage (archived live sessions) | 2 |
| `historical_component_no_longer_available` | none | 1 |
| **Total** | | **65** |

### What the 48 orphans actually were

All 48 resolved to just 10 distinct `component_ref` values, and none of them
existed in `curriculum.components` in any state. They were **learner training
plan component ids** — the per-learner plan snapshot in
`Learner.learner_training_plan_components` — not curriculum ids.

That table carries an explicit `curriculum_component_id` mapping column. It is
not referenced anywhere in code or migrations, so it was corroborated
independently before being trusted:

* 108/108 populated mappings point at an existing component;
* 108/108 agree on component **type**;
* 108/108 agree on **week lineage** (plan week's `curriculum_week_id` == target's `week_id`);
* each target is the unique component of its type within its week.

### The one deliberate non-repair

`COMP-202607090937403244390237` satisfies the structural rule but was **not**
repaired. The learner's recorded activity is a *"Workplace evidence upload
tile"*; the mapping's target is the week's *quiz*. No workplace-evidence
component exists anywhere in curriculum, including soft-deleted rows.
Attributing it to the quiz would record a quiz the learner never took and send
its KSB/OTJH attribution to the wrong component. Classified
`historical_component_no_longer_available`.

## Repair mechanics

`learner_api/migrations/0007_classify_and_repair_legacy_component_refs.py`
encodes the determinism rule in SQL, so only rows that provably qualify are
rewritten. It is idempotent and reversible:

* original identifier preserved in `legacy_component_ref`;
* resolution method recorded in `component_link_source`;
* lineage snapshot columns filled **only where blank**;
* `expected_otjh` deliberately left untouched (historical value unknown —
  inventing one would change past OTJH reporting);
* refuses to complete if any row would be left unclassified.

Pre-repair backup: `reports/learner_progress_pre_repair_backup_2026-08-16.csv`.

## Future orphan prevention

`save_progress_record()` is the single chokepoint for all three write paths
(components, videos, quizzes). It now rejects a `componentId` that resolves to
no component with `OrphanComponentReferenceError` → HTTP 400. Activity that is
genuinely not component-based (standalone quizzes) carries no `componentId` and
is unaffected. A lookup that cannot reach any database re-raises rather than
reporting "does not exist", so an outage cannot be turned into a rejected write.

Covered by `learner_api.tests.OrphanComponentReferenceTests` (6 tests).

## Verification

* Backend suite: **183 tests, 0 failures** (was 20 failures + 3 errors).
* PostgreSQL FK integrity suite: **12/12 passed** against real Postgres
  (isolated scratch database, dropped afterwards).
* Frontend `npm run build`: exit 0.
* `manage.py check`: clean. `git diff --check`: clean.
* Live end-to-end run through real HTTP endpoints: **37/37 checks passed**,
  then fully removed.

## Test data state

* **Kept** — `COMP-20260816E2E` (progress 90, K1 50/hard, S2 30/soft,
  B1 20/possible, 1 reflection, 1 evidence). This is the §7 regression
  reference and is intact.
* **Removed** — everything stamped `UATE2E20260817`.
* **Left in place, classified** — reflection `30ee33bf` (learner 36) and
  `7ebb7bff` (learner 19): controlled test data that cannot be linked without
  fabrication. See section G of the delivered report.
