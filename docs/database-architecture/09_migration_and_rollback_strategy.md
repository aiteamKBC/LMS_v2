# Migration and rollback strategy

This execution applied no migration and created no executable mutation scripts. [Migration sequence](evidence/migration_sequence.csv) and SQL sketches in report 08 are proposals. Implementation requires later task approval, one task at a time, only on the independently verified `lms-ideal-architecture` branch. Production remains out of scope.

## Preparation for each task

1. Reverify project, branch ID/name and URL endpoint using authoritative Neon metadata; confirm server-side `neon.branch_id`. Stop on mismatch. Do not repoint production/application environment settings.
2. Capture definitions, validation/index flags, affected counts, plans and repository/migration revision. Keep affected learner/record identifiers in a protected operational record, not public Git.
3. Confirm a usable restore point, retention and tested restore procedure. Catalog exports are not data backups. No restore point was created or restoration tested during this audit.
4. Identify all writers: aliases/routers, unmanaged ORM, raw SQL, runtime setup, workers, integrations and FDW. Tests require verified isolation and mocked external effects before startup.
5. Agree pre/postconditions, lock/time/storage budgets, owner approval, stop conditions and rollback limits. Preserve unknown consumers.

## Incremental execution

Use the established migration mechanism for the object's owner. Mixed Django/raw-SQL ownership needs an explicit decision, not competing authorities. Add one scoped version-controlled migration per independently testable task, with finding ID and evidence links.

For contract changes, prefer additive expand/contract: introduce compatible structures; backfill only approved records with restartable progress; verify equivalence; switch readers/writers deliberately; retain originals until removal is separately approved. Do not introduce dual writes without reconciliation and retry rules.

For existing NOT VALID constraints, recheck the exact predicate/relationship and definition. Validation changes catalog state and can lock/scan tables; budget it explicitly. A CHECK permits NULL unless a separate rule forbids it. Do not rewrite history merely to force validation success.

For indexes, retain valid existing paths while testing a replacement. Concurrent builds have transaction and failed-build recovery requirements; the migration must handle them explicitly. Do not combine a concurrent index build with unrelated data remediation in one atomic migration. Check constraint ownership before any drop. No drop is approved here.

## Honest rollback boundaries

- **Data repair:** preserve original approved values, stable key/version and provenance. Restore only if later writes do not conflict. Derived events may need reconciliation; an inverse UPDATE alone may be insufficient.
- **Constraint validation:** rolling back application code usually need not weaken a valid constraint. VALID → NOT VALID has no simple toggle; restoring that state can require reviewed drop/re-add and locks. Do not describe it as automatically reversible.
- **New index:** remove only an approved replacement with no dependent constraint. Rebuilding a removed index costs time and storage; it is not instant rollback.
- **Projection/query change:** preserve canonical history, rebuild/freshness contracts and a tested old reader path. Distinguish disposable cache state from durable facts.
- **State-only Django migration:** reverse state through a reviewed graph; preserve existing physical columns and data.

No rollback implies dropping/truncating tables, deleting historical learner records, discarding teammate files, resetting production or bypassing explicit approval.

## Acceptance and later deployment

Require fresh integrity checks, intended row-count preservation, scope isolation, migration-ledger consistency, model/API compatibility, affected role variants and measured results for performance work. A future Teams-listed file or imported contract change triggers the repository Teams baseline plus applicable backend tests; this documentation-only phase does not.

Any future production release requires separate authorization, PR review/required checks, merge into main and the repository's verified deployment process. Record restore readiness, exact merge/deployed commits and workflow health for that release. No production merge or deployment occurred in this audit.
