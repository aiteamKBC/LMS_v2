# Membership pilot: final review and release readiness

Review date: 2026-11-18. Existing branch: `Architecture`; base HEAD:
`606aca43df97967e8cb1fab45c5a794cc0635246`. Evidence applies to the reviewed
working tree, not a committed release candidate. This assessment supersedes stale
gate conclusions for this bounded pilot; it does not approve broader extraction.

**GO for formal human PR review preparation. NO-GO for merge or deployment.**
No PR, commit, application change, test rerun, database connection or deployment
was performed for this review. Prior modifications were preserved.

## Implementation and scope findings

The architecture integration is one local import in
`curriculum_api.learner_status_counts.module_member_enrolment_ids`:

```python
from learner_api.learning_plans.domain.membership_policy import members_for_lineages
```

The new policy owns membership decisions over materialized facts. It imports only
`collections` and `re`; its package markers introduce no infrastructure imports.
The reader supplies lineage, facts and programme candidates and retains registration
bridging. No new runtime import cycle is introduced by this dependency. Ownership
matches Learning Plans & Membership; Curriculum remains the consuming adapter.
The minimal function contract needs no repository, class hierarchy or DI container.

Results are a mapping of target keys to fact-index frozensets, or `None` for a
missing target. Empty membership is distinct from a missing target. Explicit
normalized rows, direct membership, manual mode, ambiguous facts, Python strip
behavior and exact cohort/group comparisons are retained. Registration bridge
omission, display and HTTP serialization remain outside the policy. There is no
new lifecycle filter, JSON fallback or identity repair.

Blast radius: `_module_payload`, `_module_assigned_payload` and `_module_members`
in `learner_assignments.py` consume the integrated reader. Therefore full GET,
assignedOnly GET, `_assign_module` guards and `_unassign_module` guards are in
scope. Writer implementations and transaction boundaries have not changed.
Batch membership/count consumers still use the original policy; this is a
deliberate limited integration, with temporary duplicate-policy maintenance risk.
No frontend, mobile or provider API contract was changed by the pilot.

Review findings requiring disposition:

1. The new policy's module/function docstrings still say it is not integrated.
   Correct these stale statements in a separately authorized source follow-up;
   no functional defect was established by this review.
2. The earlier KSB projection fix is a separate production bug fix in
   `views.authoring_module_content_counts`. One integration test depends on it.
   Prefer an explicitly reviewed prerequisite fix, then the membership pilot;
   alternatively label it as a separate prerequisite section in one reviewed PR.
   Do not omit it and claim the same 13-test evidence applies unchanged.
3. New policy, snapshot and harness files are currently untracked. A tracked-file
   diff alone omits most of this change. Include the explicit manifest below.
4. The three existing tracked-file modifications contain only the reader import,
   KSB relation replacement and prior frontend fixture correction. The frontend
   correction is independent work and should not be silently bundled.

## Proposed release manifest

Membership pilot files, relative to repository root:

```text
backend/curriculum_api/learner_status_counts.py
backend/learner_api/learning_plans/__init__.py
backend/learner_api/learning_plans/domain/__init__.py
backend/learner_api/learning_plans/domain/membership_policy.py
backend/learner_api/learning_plans/tests/fixtures/legacy_snapshots/membership_preintegration_snapshot.json
backend/learner_api/learning_plans/tests/unit/test_membership_policy_standalone.py
backend/learner_api/learning_plans/tests/parity/test_membership_caller_parity_standalone.py
backend/learner_api/learning_plans/tests/parity/test_membership_integration_standalone.py
backend/learner_api/learning_plans/tests/integration/test_membership_runtime_isolated.py
backend/phase1f_tests/image/.dockerignore
backend/phase1f_tests/image/Dockerfile
backend/phase1f_tests/image/requirements.txt
backend/phase1f_tests/image/constraints.txt
backend/phase1f_tests/image/import_smoke.py
backend/phase1f_tests/image/run_import_smoke.py
backend/phase1f_tests/image/integration.py
backend/phase1f_tests/image/run_integration.py
backend/phase1f_tests/image/validate_image.py
backend/phase1f_tests/image/VERIFICATION.md
backend/phase1f_tests/image/RELEASE_READINESS.md
```

Separate KSB prerequisite:

```text
backend/curriculum_api/views.py
backend/curriculum_api/test_ksb_count_compatibility_standalone.py
```

Exclude the unrelated frontend fixture change, bytecode, local configuration,
credentials and raw `integration-last.log` from the pilot PR; retain sanitized
test output as a review/CI artifact. Do not stage everything indiscriminately.
The branch's existing history is not a proposed release manifest: compare the
eventual candidate against the actual merge base before PR creation.

Architecture documents under `docs/architecture` are ignored by `.gitignore:313`
(`/*`). They are not automatically available to reviewers. Approve a sanitized,
explicit documentation allowlist for tracking, or attach approved documents to
the review. This review changes neither ignore rules nor the index and does not
force-add documentation.

## Evidence and coverage limits

The existing VERIFICATION.md records 15 pure-policy, 10 caller-parity, 6 integration
guard and 8 isolated-runtime tests: **39 PASS**. Its Docker result and retained
log record **13 PASS, 0 FAIL, 0 SKIPPED**, 1.401 seconds; combined **52 PASS**.
These are prior executions, not new results from this review. Phase 1E's supplied
real-data evidence covers one approved module: 38 effective profiles, 34 direct,
4 inherited and zero missing bridges. It is not full endpoint equivalence.

The actual 13-test implementation supports the principal claims:

| Evidence | What is verified | Limit |
| --- | --- | --- |
| Real ORM old/new reader comparisons | Inherited/manual/direct/sibling decisions; registration separation; missing/zero bridges; missing/empty targets | Synthetic fixtures and selected cases |
| Full GET and assignedOnly | Equal JSON, status, assigned registration IDs and name ordering | No same-name tie-order stress case or complete serializer matrix |
| POST/DELETE comparisons | Changed/skip counts, persisted normalized module rows and retained sibling rows | Not all week/component cascades or concurrent writers |
| First assignment and inherited removal | Normalized rows plus JSON/title mirror parity | Empty retained-plan removal preserves existing 503 refusal |
| Injected failure after real INSERT | Actual request transaction rollback restores rows and JSON/title fields | One controlled failure point |
| Authorization | Real stored sessions; anonymous 401 and learner 403 | Not all staff roles, expiry/renewal, api_gate or production middleware |
| Legacy/KSB | Catalogue-prefix reader parity; actual source-alias resolver; normalized joins, duplicate/status cases | Not exhaustive alias collision/ranking or full legacy HTTP parity |

Old reader/policy implementations are compiled from the immutable snapshot, not
an independently rewritten expectation. Snapshot SHA256 verified in this review:
`24c360f42bbc158624275b853222d2fe2476cdb201b89fe264bea6764c593e51`.
Both variants share current infrastructure and the KSB fix: this isolates the
membership integration; it is not a complete old-application replay.

Isolation evidence is material: PostgreSQL starts as sleep in `network=none`;
the application shares that namespace, and loopback/routes are checked before
initdb or Django. No published ports or host mounts are supplied. Source is
allowlisted into tmpfs, production settings/.env excluded, all six aliases point
to the disposable local database, and containers are removed in `finally`.
No external network route exists for direct PostgreSQL drivers either.

This proves the bounded disposable test environment, not production alias
topology. Base AppConfig suppresses production ready hooks; caches are local and
outbox disabled. Home Summary and Programme List imports were checked, not their
complete HTTP payloads. Provider, queue, shared-cache, production signal behavior,
large-data load and concurrency remain unverified. Suite duration and PostgreSQL
estimated costs are not production latency baselines.

The image can be rebuilt using the documented commands, exact application pins
and reviewed source bundle. This is procedural reproducibility, not bit-for-bit
reproducibility: Docker tags are mutable and dependency artifacts lack hash locks.
Record image/base/PostgreSQL digests and candidate SHA in future CI evidence.

## G01–G06 reassessment

| Gate | Status | Evidence and exact remainder |
| --- | --- | --- |
| G01 environment/database safety | PARTIAL | PASS for explicitly authorized disposable integration isolation and synthetic writes. Approved bounded Neon identity/read checks do not certify all production aliases/direct sources, least-privilege access or general HTTP side effects. Establish the actual release environment topology and permitted operational effects; no more live access is implied. |
| G02 ownership/review | BLOCKED | Context ownership is documented, but actual named Plans/Membership, Registry, Curriculum, security/auth, QA and engineering reviewers and their approvals are not recorded. One person may explicitly hold multiple roles. |
| G03 behavioral/performance baseline | PARTIAL | 52 passing tests and one-module real-data parity materially satisfy selected behavioral evidence. Agree the regression/performance budget or explicitly approve a scoped deferral; record candidate-SHA checks and remaining coverage disposition. No measured production endpoint performance claim. |
| G04 dependency/side-effect boundary | PARTIAL | PASS for pure policy independence, one-reader edge and tested local transaction behavior. Broader original roster read-closure certification is not complete: production auth/session, schema/bootstrap, cache/outbox and ready-hook boundaries need reviewer disposition. Existing write guards are intentionally affected; do not label the whole HTTP path zero-write. |
| G05 scoped implementation authorization | PASS | Later explicit Phase 1A–1F instructions authorize pure extraction, conditional caller integration and isolated validation. This passes only the implemented one-reader pilot; no broader roster extraction, merge or deployment approval. |
| G06 CI/protections/release owner | BLOCKED | Local YAML inspected; no required remote context/ruleset evidence, candidate run or named release owner established. Required reviews/checks cannot be inferred from workflow files. |

Do not retain historical statements that implementation is unapproved or isolated
mutating tests remain blocked: later scoped authorization and completed tests
supersede those statements. Conversely, no gate passes solely because tests pass.

## CI proposal and named approvals

Four tracked workflows exist. `deploy-aws.yml` runs on main push/manual dispatch,
not pull requests; its existing backend selections do not establish execution of
this new harness. Calendar PR checks are deployment-guard checks; Teams and Aptem
workflows are not substitutes for membership checks. Remote required checks,
rulesets, merge queue and environment approvals remain unverified.

Propose two stable PR checks, without changing workflows here:

1. Membership standalone/runtime: Python 3.14.3 and reviewed test dependencies;
   execute the four exact scripts in VERIFICATION.md independently, never broad
   Django discovery. Expected current total: 39.
2. Membership isolated PostgreSQL: Docker-capable runner; acquire images/build
   from the sanitized context, validate dependencies, run import smoke, then
   run_integration.py. Expected current total: 13, no skips. Preserve network
   isolation before initialization and hard-fail on any isolation/test error.

Use candidate-SHA artifacts, image digests, job timeouts, bounded container
resources and cleanup checks, no LMS secrets, no deployment privileges, and no
untrusted-code privileged workflow. Pin reviewed image/action versions for stable
reproduction. Select these checks as required only through an approved settings
change. Do not bypass existing remote checks or reinterpret local Teams exclusion
as permission to disable mandatory CI. KSB prerequisite needs its own evidence.

Actual names remain unassigned: engineering/code owner; Plans/Membership business
owner; Registry identity reviewer; Curriculum/legacy-alias reviewer; security/auth
reviewer; QA baseline owner; operations/release owner. Their approval must cover
the proposed scope, intentional POST/DELETE guard impact, prerequisite KSB fix,
test limitations, gate dispositions and rollback. No approval is supplied by this
document on their behalf.

## Release and rollback proposal — not execution authorization

Before merge: resolve named reviews, approve prerequisite composition, correct
stale integration comments, review the exact candidate diff, run required checks
on that candidate and verify actual branch protections. Obtain explicit disposition
of G01/G03/G04 remaining scope; broad production certification is not implied.

Before deployment: release owner verifies merged main revision, target, clean
deployment state, last-good artifact, approved pipeline/environment and rollback
responsibility. The pilot requires no migration, environment or privilege change.
Existing deployment YAML also contains calendar schema operations: review their
applicability separately; this pilot does not authorize those operations. Reconcile
the deployment mechanism with operations rather than mixing local server and AWS
procedures or executing an unreviewed workflow.

After an independently approved deployment: verify health, authorized full/compact
GET behavior, authorization and ordering without exporting learner information;
monitor errors and latency against the agreed budget. Exercise mutating canaries
only in approved synthetic environments, not on real learner assignments by default.
Record deployed SHA/artifact and observations. No live smoke operations occurred here.

Minimal code rollback: remove the local policy import from
`module_member_enrolment_ids`; the unchanged module-level legacy function becomes
authoritative again. Review/test/release that revert normally, or use an approved
last-good artifact. Keep the separately accepted KSB fix. No schema reversal is
needed, and rollback does not undo legitimate assignments made during operation.

## Next bounded slice

After this pilot is accepted, extract the read-only module membership query
orchestration behind `module_member_enrolment_ids` into Learning Plans application
code with explicit small inputs/read collaborators for lineage, profile facts and
registration bridging. Retain the legacy wrapper and current adapters initially;
keep HTTP/authorization, registration display and all writers unchanged. Reuse
the snapshot parity and isolated ORM/HTTP harness. Inventory the exact read closure
and approve the file/consumer allowlist before implementation. This is a proposed
next slice, not permission to replace the full Module Roster or rewrite views.py.
