# Review feedback production prerequisites

The graph-only migration `0016_merge_engagement_outbox` joins
`0015_merge_engagement_heads` and `0015_review_feedback_outbox`. It has no
operations and does not enable a consumer or scheduler.

Before installing the producer, review the complete migration plan against the
target's recorded history. Earlier unapplied migrations have their own schema
effects; do not infer that the entire plan is empty because the final merge is.
Verify the canonical PostgreSQL `default` target, backup/restore point, existing
`Feedback` schema, and `Learner.reviews` columns `id`, `status`, `completed_date`.
The migration role needs rights to create the Outbox objects and attach triggers
to the source table. Retain the SECURITY DEFINER function owner and its queue
write privileges. A queue-write failure also rejects the originating review
write. Installation performs no historical backfill.

The bundled `process_review_feedback_outbox` command is deliberately restricted
to a marked local test database. Production operation requires a separate reviewed
implementation and release; do not remove its sandbox checks as a workaround.
That release must define:

- The production worker identity, narrowly scoped database grants, deployment
  configuration, monitoring, and an explicit enable/disable procedure.
- A bounded drain after the review importer's final commit, startup recovery of
  pending work, and an agreed periodic wake-up for work left while the importer
  is stopped. The importer has not been identified in this repository.
- Retry timing/backoff, limits, reporting and recovery for blocked identities or
  errors, backlog age alerts, and retention of acknowledged rows.
- Concurrency protection, atomic delivery/acknowledgement, and acknowledgement
  of only the version evaluated so concurrent source changes remain pending.
- Targeted reconciliation for historical reviews and changes to identity links,
  templates or review types, which the status/completed-date triggers do not
  capture. Preserve historical assignments and responses.
- Validation of the actual importer and any notification transports in an
  explicitly approved environment before production activation.

Reversing the producer migration disables capture but retains its queue, index,
function and triggers. Changes made while disabled need separately scoped
recovery. Consumer deployment, scheduling, backfill, and retention are not enabled
by the merge migration. See [producer and local consumer details](REVIEW_FEEDBACK_OUTBOX.md).
