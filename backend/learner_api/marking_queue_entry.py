"""Put a completed activity in front of its coach.

Some components are authored with ``tutor_validation_required`` -- assignments,
mostly. The learner finishes them like any other activity, but finishing is a
hand-in rather than a completion: the work is only done once a coach has looked
at it and accepted it.

The marking queue reads ``Learner.learning_reflection_submissions``, so that is
what has to exist for the coach to see anything. A reflection flow writes one of
those when the learner fills it in, but an assignment authored with
``reflection_required = false`` has no such flow -- so completing it left the
learner with a green tick and the coach with an empty queue.

This writes the row directly from the completion, carrying the evidence the
learner uploaded. It is deliberately minimal: no reflection text, no KSB
explanations, because the learner was never asked for them. What the coach needs
is the work, which is the evidence file.

Upserted on the same key the reflection flow uses
(learner_kind, learner_id, activity_type, activity_id), so a learner who
re-completes an activity updates their submission rather than creating a second
one -- and a coach who has already accepted it is not silently reset, since an
accepted submission is left alone.
"""
import json
import logging
import uuid

from django.db import DatabaseError, connections

logger = logging.getLogger(__name__)

#: A coach decision that must not be undone by the learner re-completing the
#: activity. Anything else is reopened for review.
TERMINAL_STATUSES = ("accepted",)


def requires_tutor_validation(component_id):
    """Whether the author said this activity must be validated by a coach."""
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "select coalesce(tutor_validation_required, false) "
                "from curriculum.components where id = %s",
                [component_id],
            )
            row = cur.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not read tutor validation flag for %s: %s", component_id, exc)
        return False
    return bool(row[0]) if row else False


def _evidence_filenames(kind, learner_id, component_id):
    """Names of the approved files the learner submitted for this activity."""
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'select original_filename from "Learner"."evidence_files" '
                "where section_ref = %s and learner_kind = %s and learner_id = %s "
                "and status = 'approved' order by uploaded_at",
                [component_id, kind, str(learner_id)],
            )
            return [str(row[0]) for row in cur.fetchall() if row and row[0]]
    except DatabaseError as exc:
        logger.warning("Could not list evidence for %s: %s", component_id, exc)
        return []


def queue_for_marking(*, component_id, kind, learner_id, context):
    """Create or refresh this activity's marking submission. Best-effort.

    ``context`` carries what the completion already knows -- learner name,
    programme, titles, planned and actual time -- so the coach's queue row reads
    like any other. Returns the submission id, or None when nothing was written.

    Never raises: the learner has completed their work, and a queue row that
    could not be written must not turn that into an error they see.
    """
    try:
        with connections["enrolment"].cursor() as cur:
            # An accepted submission is a coach's decision; re-completing the
            # activity must not quietly reopen it.
            cur.execute(
                'select id, status from "Learner"."learning_reflection_submissions" '
                "where learner_kind = %s and learner_id = %s and activity_type = %s "
                "and activity_id = %s",
                [kind, str(learner_id), context.get("activityType") or "", component_id],
            )
            existing = cur.fetchone()
            if existing and str(existing[1] or "") in TERMINAL_STATUSES:
                return existing[0]

            evidence = _evidence_filenames(kind, learner_id, component_id)
            cur.execute(
                """
                insert into "Learner"."learning_reflection_submissions" (
                    id, learner_kind, learner_id, learner_name, programme_name,
                    activity_type, activity_id, activity_title, module_title,
                    week_title, planned_otjh, learning_reflection,
                    evidence_files, actual_time_hours, quality_score,
                    progress_entry_id, component_ref, status
                ) values (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s::jsonb, %s, %s,
                    %s, %s, 'submitted_for_tutor_review'
                )
                on conflict (learner_kind, learner_id, activity_type, activity_id)
                do update set
                    activity_title = excluded.activity_title,
                    module_title = excluded.module_title,
                    week_title = excluded.week_title,
                    planned_otjh = excluded.planned_otjh,
                    evidence_files = excluded.evidence_files,
                    actual_time_hours = excluded.actual_time_hours,
                    progress_entry_id = excluded.progress_entry_id,
                    component_ref = excluded.component_ref,
                    status = 'submitted_for_tutor_review',
                    submitted_at = now()
                returning id
                """,
                [
                    str(uuid.uuid4()),
                    kind,
                    str(learner_id),
                    context.get("learnerName") or "",
                    context.get("programmeName") or "",
                    context.get("activityType") or "",
                    component_id,
                    context.get("activityTitle") or "",
                    context.get("moduleTitle") or "",
                    context.get("weekTitle") or "",
                    context.get("plannedOtjh") or "",
                    # The learner was not asked to write one; the evidence is
                    # the submission. Said plainly so the coach knows why the
                    # reflection panel is empty rather than assuming it was
                    # skipped.
                    "Submitted for marking from the activity. No written "
                    "reflection was requested for this component.",
                    json.dumps(evidence),
                    context.get("actualTimeHours") or "",
                    100,
                    context.get("progressEntryId"),
                    component_id,
                ],
            )
            row = cur.fetchone()
            return row[0] if row else None
    except DatabaseError as exc:
        logger.warning("Could not queue %s for marking: %s", component_id, exc)
        return None
