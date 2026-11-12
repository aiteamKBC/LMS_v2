# Evidence identity (H1): findings

Read-only investigation, 2026-11-12, Development snapshot (`NEW_ENDPOINT_URL`).
Reproduce it with `00_verify_readonly.sql`. Nothing here changes data.

## `learner_record_id` is not a profile ID

| Column | Holds | Proof |
| --- | --- | --- |
| `learner_id` | Aptem learner ID | equals the raw Aptem payload `LearnerId` on 55,254 of 55,287 rows |
| `learner_record_id` | `fetching_evidence.learner_evidence.id`, the fetcher's own per-learner row | 630 of 630 values are rows there, with the same Aptem ID; one value per learner, never shared |

The earlier finding ("24,578 cross-learner conflicts") compared `learner_record_id`
with profile IDs. Both are small integers from unrelated sequences, so they collide by
coincidence: only 213 rows equal the learner's real profile ID. **The stored values
are correct, and no correction SQL is needed or safe.** Rewriting them would break the
link to `learner_evidence`.

The risk was on the LMS read side. `reconcile_monthly_logs` also selected evidence
`WHERE learner_record_id = ANY(<profile ids>)`, which could pull another learner's
evidence into a learner's KSB mapping. Fixed in code: evidence is now read by Aptem ID
only, and an item owned by a different Aptem learner is treated as unavailable (the
row goes to manual review, and existing hours are preserved).

## The two tables

`Learner.evidence_items` is an older copy of `fetching_evidence.evidence_items`:
identical columns, all 54,209 of its rows also exist in `fetching_evidence` with the
same identity values, and it stopped updating on 2026-09-28. `fetching_evidence` has
1,078 more rows and is the live table (last update 2026-10-17); 877 shared rows have
different content since then. The LMS reads only `fetching_evidence` (`audit_api`,
`learner_api/legacy_assignments.py`). Keep the copy (no deletion); don't read it.

## The writer

Not API-for-aptem: that repository writes only aggregate rows (`"LMS"."MCR"`,
`"LMS"."PR"`, `"LMS".<users table>`). Not evidence-content-fetch either: it only
reads `evidence_items` to process PDFs. The writer is the external "fetch service"
that owns `fetching_evidence.learner_evidence`. It wasn't found among the
organisation's public repositories, so its owner needs to confirm it. If the column is
ever renamed under the naming standard, it describes a fetcher-local key, not a
profile, so a name such as `fetch_learner_record_id` fits. That needs the writer's
team, because the writer inserts it.
