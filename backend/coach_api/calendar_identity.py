"""Canonical identity resolution for Calendar learner links.

``Coach.coach_calendar_event.learner_id`` is a legacy/raw value.  Native
Review code must use the reviewed link row instead of assuming that value is a
``Learner.learners.id``.
"""
from __future__ import annotations

from django.db import DatabaseError, connection


class CalendarLearnerIdentityError(ValueError):
    """The Calendar event cannot be safely attributed to a profile."""


def calendar_learner_link(calendar_event_id, *, for_update=False):
    if calendar_event_id in (None, ""):
        raise CalendarLearnerIdentityError("The Calendar event has no learner identity link.")
    lock = " FOR UPDATE" if for_update and connection.vendor == "postgresql" else ""
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT calendar_event_id, raw_learner_id, identity_kind,
                       learner_profile_id, enrolment_id, verified_profile_id,
                       verification_basis
                  FROM "Coach".coach_calendar_event_learner_link
                 WHERE calendar_event_id = %s
                """ + lock,
                [calendar_event_id],
            )
            row = cursor.fetchone()
            if row is None:
                return None
            columns = [column[0] for column in cursor.description]
    except DatabaseError as exc:
        raise CalendarLearnerIdentityError(
            "The Calendar learner identity link could not be read."
        ) from exc
    return dict(zip(columns, row))


def require_profile_identity(calendar_event_id, *, expected_profile_id=None, for_update=False):
    """Return a verified profile link, refusing raw/enrolment guesses."""
    link = calendar_learner_link(calendar_event_id, for_update=for_update)
    if not link or link.get("identity_kind") != "profile":
        raise CalendarLearnerIdentityError(
            "The Calendar event does not have a verified learner profile identity."
        )
    profile_id = link.get("learner_profile_id") or link.get("verified_profile_id")
    if profile_id in (None, ""):
        raise CalendarLearnerIdentityError(
            "The Calendar learner identity link has no profile reference."
        )
    if expected_profile_id is not None and str(profile_id) != str(expected_profile_id):
        raise CalendarLearnerIdentityError(
            "The Calendar event belongs to a different learner profile."
        )
    return link


def resolve_profile_identity(calendar_event_id, *, expected_profile_id=None,
                             expected_enrolment_id=None, expected_raw_learner_id=None,
                             for_update=False):
    """Resolve a Calendar row to the canonical Learner profile.

    ``coach_calendar_event.learner_id`` is a legacy value and can be either a
    profile id or an enrolment id.  The link table records that namespace.  A
    profile link is accepted directly; an enrolment link is translated only
    through the unique ``learners.enrolment_id`` relationship.  No numeric
    equality or email fallback is allowed here.
    """
    link = calendar_learner_link(calendar_event_id, for_update=for_update)
    if not link:
        raise CalendarLearnerIdentityError(
            "The Calendar event has no learner identity link."
        )
    raw_learner_id = link.get("raw_learner_id")
    if (expected_raw_learner_id is not None and raw_learner_id not in (None, "")
            and str(raw_learner_id) != str(expected_raw_learner_id)):
        raise CalendarLearnerIdentityError(
            "The Calendar learner identity link does not match the stored learner reference."
        )
    identity_kind = link.get("identity_kind")
    if identity_kind not in {"profile", "enrolment"}:
        raise CalendarLearnerIdentityError(
            "The Calendar event learner identity is unresolved."
        )
    enrolment_id = link.get("enrolment_id")
    if (expected_enrolment_id is not None and enrolment_id not in (None, "")
            and str(enrolment_id) != str(expected_enrolment_id)):
        raise CalendarLearnerIdentityError(
            "The Calendar event belongs to a different learner enrolment."
        )
    profile_id = link.get("learner_profile_id") or link.get("verified_profile_id")
    if profile_id in (None, "") and identity_kind == "enrolment":
        from learner_api.models import LearnerProfile

        matches = list(
            LearnerProfile.objects.filter(enrolment_id=enrolment_id)
            .values_list("id", flat=True)[:2]
        )
        if len(matches) != 1:
            raise CalendarLearnerIdentityError(
                "The Calendar enrolment does not resolve to one learner profile."
            )
        profile_id = matches[0]
    if profile_id in (None, ""):
        raise CalendarLearnerIdentityError(
            "The Calendar event learner identity has no profile reference."
        )
    if expected_profile_id is not None and str(profile_id) != str(expected_profile_id):
        raise CalendarLearnerIdentityError(
            "The Calendar event belongs to a different learner profile."
        )
    resolved = dict(link)
    resolved["learner_profile_id"] = profile_id
    return resolved
