"""Operator-only setup guards; never imported by learner reward endpoints."""
from django.conf import settings
from django.core.management.base import CommandError
from django.db import connections

PILOT_MODULE = "MOD-KBC-PMP-M01-SMR"

def require_same_database():
    """Both aliases must identify the same PostgreSQL target; never print settings."""
    if "enrolment" not in connections:
        raise CommandError("The canonical enrolment database alias is required.")
    primary, learner = connections["default"], connections["enrolment"]
    if primary.vendor != "postgresql" or learner.vendor != "postgresql":
        raise CommandError("Both default and enrolment must use PostgreSQL.")
    for key in ("NAME", "HOST", "PORT", "USER"):
        left = str(primary.settings_dict.get(key) or ("5432" if key == "PORT" else ""))
        right = str(learner.settings_dict.get(key) or ("5432" if key == "PORT" else ""))
        if left != right:
            raise CommandError("default and enrolment must point to the same approved database target.")
    identities = []
    for connection in (primary, learner):
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            identities.append(cursor.fetchone()[0])
    if identities[0] != identities[1]:
        raise CommandError("Database identity verification failed.")

def require_global_ready():
    if getattr(settings, "KBC_SHARED_REWARDS_READY", False) is not True:
        raise CommandError("KBC_SHARED_REWARDS_READY must be enabled after acceptance checks.")

def operator_reference(value):
    from engagement_api.segment_rules import identifier, RewardError
    try:
        return identifier(value)
    except RewardError:
        raise CommandError("A valid operator reference is required.") from None
