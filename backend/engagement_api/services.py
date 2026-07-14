from django.db import IntegrityError

from .models import PointsGrant, PointsRule


def grant_points(rule_key, learner_id, learner_name, points=None, event_reference=None):
    """Award points to a learner under the active PointsRule identified by `rule_key`.

    This is the single entry point another app should call the moment a
    grant-worthy event happens (attendance marked, quiz passed, evidence
    approved, ...) — see the Points Rules + Grants section of the
    engagement backend plan. Not wired into any other app yet; this is
    just the ready-to-call function.

    `event_reference` should uniquely identify *this specific occurrence*
    of the event (e.g. an attendance record id, a quiz attempt id). Pass
    it whenever the caller's code could plausibly run twice for the same
    occurrence (a retry, a duplicate webhook, ...) — a repeat call with the
    same (rule_key, event_reference) returns the existing grant instead of
    creating a second one. Omit it only for events that can't double-fire.

    Raises PointsRule.DoesNotExist if `rule_key` doesn't match an active
    rule. Callers are expected to catch exceptions from this function —
    a points-granting failure must never block the real feature (the
    attendance/quiz/evidence save) that triggered it.
    """
    rule = PointsRule.objects.get(key=rule_key, active=True)

    if event_reference is not None:
        existing = PointsGrant.objects.filter(rule=rule, event_reference=event_reference).first()
        if existing is not None:
            return existing

    try:
        return PointsGrant.objects.create(
            rule=rule,
            learner_id=learner_id,
            learner_name=learner_name,
            points=rule.points if points is None else points,
            event_reference=event_reference,
        )
    except IntegrityError:
        # Another call for the same (rule, event_reference) won the race —
        # treat it the same as the pre-check above finding it.
        return PointsGrant.objects.get(rule=rule, event_reference=event_reference)
