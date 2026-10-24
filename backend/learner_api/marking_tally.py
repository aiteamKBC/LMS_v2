"""Per-learner counts of what a coach has accepted and rejected.

Four columns on ``Learner.learners`` -- accepted/rejected assignments and
accepted/rejected reflections -- so a learner's marking record can be read
without aggregating the submissions table on every screen that wants it.

Recomputed, never incremented
-----------------------------
Each recount reads the current state of ``learning_reflection_submissions`` and
writes the totals. A coach can change a decision, a submission can be resubmitted
and marked again, and rows are edited outside this path; a counter that was
nudged up on each decision would drift away from the truth and there would be no
way to tell that it had. Recomputing is a few rows per learner and always agrees
with the submissions themselves.

Assignment or reflection is decided by the component's authored type, matching
``coach_api.views.ASSIGNMENT_ACTIVITY_TYPES`` and the SPA's
``frontend/src/lib/markingKind.ts`` -- keep the three in step.
"""
import logging
from collections.abc import Mapping

from django.db import DatabaseError, connections

from learner_api.selectors.identity import (
    EnrolmentId,
    ResolutionStatus,
    resolve_many_for_enrolments,
)

logger = logging.getLogger(__name__)

#: Component types assessed as a work product. Mirrors
#: coach_api.views.ASSIGNMENT_ACTIVITY_TYPES.
ASSIGNMENT_TYPES = ("assignment",)

#: Coach decisions that count as accepted, and as rejected. 'partial' counts as
#: accepted because the learner was awarded something; 'escalated' and
#: 'submitted_for_tutor_review' are neither -- nobody has decided yet.
ACCEPTED_STATUSES = ("accepted", "partial")
REJECTED_STATUSES = ("rejected", "referred")

TALLY_COLUMNS = (
    "accepted_assignments",
    "rejected_assignments",
    "accepted_reflections",
    "rejected_reflections",
)


def _learner_ids_for_profile(cur, profile_id):
    """Every id a learner's submissions might be filed under.

    Submissions are keyed on the enrolment id the learner page uses, but older
    rows carry the profile id, so both are searched -- otherwise a learner's
    earlier marked work would not be counted.
    """
    cur.execute(
        'select id::text, enrolment_id::text from "Learner".learners where id = %s',
        [profile_id],
    )
    row = cur.fetchone()
    if not row:
        return []
    return sorted({value for value in row if value})


def compute_tally(profile_id):
    """The learner's marking counts, read from the submissions themselves.

    Returns a dict keyed by TALLY_COLUMNS, or None when the counts could not be
    read -- the caller then leaves the stored values alone rather than writing
    zeroes over a real record.
    """
    try:
        with connections["enrolment"].cursor() as cur:
            learner_ids = _learner_ids_for_profile(cur, profile_id)
            if not learner_ids:
                return None

            cur.execute(
                """
                select coalesce(lower(btrim(c.type)), lower(btrim(s.activity_type))) as kind,
                       s.status,
                       count(*)
                  from "Learner"."learning_reflection_submissions" s
                  left join curriculum.components c on c.id = s.activity_id
                 where s.learner_id::text = any(%s)
                 group by 1, 2
                """,
                [learner_ids],
            )
            rows = cur.fetchall()
    except DatabaseError:
        logger.warning("marking_tally_refresh_skipped reason=aggregate_unavailable")
        return None

    tally = {column: 0 for column in TALLY_COLUMNS}
    for activity_kind, status, count in rows:
        status = str(status or "").strip().lower()
        is_assignment = str(activity_kind or "").strip().lower() in ASSIGNMENT_TYPES
        if status in ACCEPTED_STATUSES:
            key = "accepted_assignments" if is_assignment else "accepted_reflections"
        elif status in REJECTED_STATUSES:
            key = "rejected_assignments" if is_assignment else "rejected_reflections"
        else:
            # Still waiting on a coach; counted in neither.
            continue
        tally[key] += int(count or 0)
    return tally


def refresh_tally(profile_id):
    """Recompute and store one learner's counts. Returns the tally, or None.

    Never raises: this runs after a coach has already saved their decision, and
    a counter that could not be updated must not turn a successful marking into
    an error the coach sees.
    """
    tally = compute_tally(profile_id)
    if tally is None:
        return None
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'update "Learner".learners set '
                + ", ".join(f"{column} = %s" for column in TALLY_COLUMNS)
                + " where id = %s",
                [*(tally[column] for column in TALLY_COLUMNS), profile_id],
            )
    except DatabaseError:
        logger.warning("marking_tally_refresh_skipped reason=counter_write_unavailable")
        return None
    return tally


def _read_identity_rows(cursor, sql, params):
    """Execute the typed selector through the existing enrolment connection."""
    cursor.execute(sql, params)
    rows = list(cursor.fetchall())
    if not rows:
        return []
    if isinstance(rows[0], Mapping):
        return [dict(row) for row in rows]
    columns = [
        getattr(column, "name", None) or column[0]
        for column in (cursor.description or ())
    ]
    if not columns:
        return []
    return [dict(zip(columns, row)) for row in rows]


def _canonical_enrolment_id(value):
    """Return a typed positive decimal ID without widening legacy inputs."""
    supplied = str(value or "")
    raw = supplied.strip()
    try:
        normalized = int(raw)
    except (TypeError, ValueError):
        return None
    if normalized <= 0 or supplied != raw or raw != str(normalized):
        return None
    return EnrolmentId(normalized)


def _resolve_tally_profile(learner_kind, learner_id):
    """Resolve a submission's verified enrolment ID to one canonical profile."""
    enrolment_id = _canonical_enrolment_id(learner_id)
    expected_kind = str(learner_kind or "").strip().casefold()
    if enrolment_id is None or expected_kind not in {"commercial", "apprenticeship"}:
        return None, "invalid_submission_identity"

    try:
        with connections["enrolment"].cursor() as cur:
            def query(sql, params):
                return _read_identity_rows(cur, sql, params)

            resolution = resolve_many_for_enrolments(
                [enrolment_id],
                query=query,
            )[enrolment_id]
    except DatabaseError:
        return None, "identity_lookup_unavailable"

    if resolution.status is not ResolutionStatus.RESOLVED:
        return None, f"identity_{resolution.status.value}"
    if resolution.identity.learner_kind.strip().casefold() != expected_kind:
        return None, "identity_kind_mismatch"
    return resolution.identity.profile_id, None


def refresh_tally_for_submission(learner_kind, learner_id):
    """Recompute for whichever profile a submission's learner_id refers to.

    Coach and Advanced Admin decision paths both scope submissions by the
    explicit enrolment id. The counters live on the profile, so the typed B4B
    bridge resolves that namespace here. Equal numeric profile ids never count
    as identity; ambiguity or mismatch skips only this derived refresh.
    """
    profile_id, reason = _resolve_tally_profile(learner_kind, learner_id)
    if profile_id is None:
        logger.warning("marking_tally_refresh_skipped reason=%s", reason)
        return None
    return refresh_tally(profile_id)
