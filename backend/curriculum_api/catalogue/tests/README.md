# Catalogue regression tests

`parity/` contains the 43 standalone source-contract and synthetic-behavior test
modules. `fixtures/legacy_snapshots/` contains 46 frozen source baselines,
also used by the isolated Django/HTTP regression tests. These are test fixtures,
not application data or runtime fallback implementations.

From the repository root, run the standalone tests without Django or a database:

```powershell
python -B -m unittest discover -s backend/curriculum_api/catalogue/tests/parity -p "test_*standalone.py" -v
```

Run the existing explicit integration selection in disposable, network-isolated
Docker PostgreSQL/Django:

```powershell
python -B backend/phase1f_tests/image/run_integration.py
```

Run file-delivery HTTP contracts and real synthetic PPTX/PDF rendering parity
in Docker with networking and database access disabled:

```powershell
python -B backend/phase1f_tests/image/run_media_contracts.py
```

Run schema/KSB read contracts with database access blocked (the PostgreSQL
counterparts are included in `run_integration.py` above):

```powershell
python -B backend/phase1f_tests/image/run_schema_contracts.py
```

When code ownership changes, update test paths and verify the new owner and its
caller bindings. Keep comparing the actual implementation with the frozen source;
do not regenerate baselines or drop assertions just to make a test pass. Do not
add runtime imports of this package. Historical tracker entries retain the paths
used at the time; current commands and consumers use this layout.

The cache ownership contracts compare 24 actual frozen functions, shared state
identity, callback ordering and live memo/cache bindings. PostgreSQL cases cover
epoch commit, outer rollback and failed-SQL savepoints in the disposable runner.

The hierarchy command contracts compare 31 frozen function bodies and their
public bindings. The tree transaction moves into application orchestration;
HTTP exception mapping and final deduplication remain in the API. Fixture cases
cover partial trees, scoped removals, create/read-back failures, restoration,
attachment revisions and POST/PATCH differences. PostgreSQL cases execute real
row-adapter SQL and tree transaction/rollback checks with synthetic storage ports;
they do not claim complete provider or whole-hierarchy end-to-end coverage.

The module command contracts compare seven frozen implementations, public
signatures/decorators, explicit capabilities, exact SQL and transaction order.
Cases cover full/changed-only/light saves, component settings and assurance
flags, collection reuse/duplication, partial saves, stale revisions, narrow
renames and permission refusals. PostgreSQL checks exercise real transactions
with synthetic content persistence ports, nested/outer rollback and the actual
artwork UPDATE. Artwork validation/storage and provider capabilities are fixture
ports; this is not a complete module writer/schema/provider acceptance baseline.
Historical snapshots remain immutable; restoration chains preserve earlier
whole-file assertions while checking the actual new owner separately.

The lifecycle contracts compare 18 frozen implementations and every unrelated
views statement. They cover cascade ownership, archive/restore errors, content
refusals, reusable quiz/template detachment, ordered deletion, optimistic guards
and post-commit HTTP outcomes. The unused older programme hard-delete helper was
removed; a repository source check guards against remaining callers.
PostgreSQL cases execute lifecycle DELETE/RETURNING and quiz ownership SQL on
synthetic tables, verify rollback, status predicates and bounded legacy restores.
Generic read/update ports target the fixture schema; revision/cache/provider
capabilities are mocked. The original-source characterization preserves the
42703 / 409 failure from applying module_catalogue_id to normalized KSB mappings.
The corrected implementation scopes mappings through the existing component
placement predicate. PostgreSQL tests verify successful scoped deletion, another
module remaining untouched, late-FK failure rollback and caller rollback.

The authoring storage contracts compare 17 frozen implementations: row upserts,
bulk updates, changed-content persistence, parent-link repair, free-programme
save/conversion, week-template writes and their HTTP adapters. Schema provisioning
SQL is compared through fake cursors only; ready flags and existing opt-in gates
remain at the legacy composition seam. No live provisioning is validated here.
Cases preserve adopted-course refusal, canonical-store selection, clone/move
ordering, missing versus empty component lists, stale revisions, CSRF and access
gates. PostgreSQL cases exercise actual row-writer SQL and free-programme atomic
boundaries with synthetic persistence ports; they do not establish full free-course
schema, provider or concurrency acceptance. Source guards follow the new owners
without changing historical snapshots or removing previous assertions.

Content command contracts compare 25 frozen implementations and public bindings.
Two deliberate changes are tested separately from relocation parity: unresolved
training-alias GET no longer creates placeholder lessons/KSB weights or writes
identity links; missing KSB readback no longer returns successful empty data.
The first preserves stored-alias payloads and returns 404 for missing content.
The second reads inside the write transaction and rolls back on missing identity.
The frozen originals still demonstrate the former behavior using synthetic ports.
PostgreSQL cases cover upload row locks, field preservation, rollback, programme
source scoping, module locks and failed mapping readback. Media contracts also
run the existing AI-material upload/replace/remove/preview cases using temporary
files and mocked Azure SDK calls. No live provider or full writer-schema coverage
is implied. Removed placeholder helpers have a repository runtime-reference guard.

Holiday contracts compare 26 frozen implementations, HTTP bindings, SQL and the
cohort preview computation. Synthetic PostgreSQL cases cover both supported
storage shapes, partial updates, archive/rollback, cohort choices and referenced
official withdrawals. Provider dispatch is mocked. Malformed/non-object refresh
JSON now returns 400 before synchronization; that deliberate correction is tested
separately from preserved behavior and the frozen original fallback.

Session-editing contracts compare 12 frozen implementations and reconstruct the
planner/domain and application/storage splits. Required staffing module reads now
precede writes and return 503 on failure; the frozen original demonstrates the
former false-success/partial-coach-save path. Synthetic PostgreSQL covers scoped
assignment updates, unbooked session dates, no-op saves and caller-owned rollback.
These checks do not establish new transaction guarantees or live provider parity.

Read-dependency contracts verify 177 direct owner exports, 157 reduced read
wrappers and their concrete defaults. They compare every affected function body
and unrelated views statement with the frozen pre-change source, and exercise
102 normalization/identity/projection cases against actual original functions.
Historical source guards restore only the earlier layout; the new contracts
separately verify actual exports, imports, defaults and untouched bodies.
Runtime parity spies follow direct aliases to their public lookup site, and
synthetic capability overrides bind to the owning function. Existing assertions
and frozen historical baselines are retained. No Django or database is imported
by the standalone read closure; integration checks use the disposable runner.


Database-read composition contracts preserve 13 actual moved functions and the
unchanged surrounding source. Standalone tests compare frozen original SQL,
parameters, exceptions, cache reuse/expiry, request memoization and storage
context isolation using explicit fake connections. Django fixture tests verify
actual owner aliases and KSB/schema adapters; existing isolated PostgreSQL tests
execute the joins and schema queries. Historical layout restoration removes only
exact reviewed new AST nodes, leaving unexpected edits visible. Synthetic test
ports are shared between old facades and new owners; assertions are retained.


Authoring composition contracts keep the SQL/completion/prefetch bodies exact
and move concrete KSB reads/cache out of the mixed writer facade. Actual Django
fixture tests compare 30 SQL projection combinations with frozen original source,
exercise completion, memo reuse, batch failure/mismatched result sets, schema
failure ordering and transaction/vendor guards. Standalone import guards still
forbid Django/network/filesystem writes. Existing assertions remain unchanged;
synthetic read ports are bound at both legacy and concrete lookup sites. Earlier
snapshots remain immutable; exact-node layout restoration is used only by source
history checks, never as a substitute for current runtime parity.
