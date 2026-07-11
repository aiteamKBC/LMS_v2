"""Keep "Learner"."Active_users" in sync with programme status changes.

Whenever an apprenticeship (EnrolmentUser) or commercial (CommercialUser)
learner's programme status is set to "Active", a matching row is upserted into
"Learner"."Active_users" so downstream phases can work from a single
active-learner table. If the status is later changed away from "Active", the
mirrored row is removed again — Active_users should only ever hold currently
active learners.

The upsert/removal is keyed on the learner's id, which is globally unique across
both enrolment tables (they share enrolment.learner_id_seq) and is carried
forward here as the Active_users id — so a learner keeps one id across every
phase. Re-saving an already-active learner refreshes their row rather than
duplicating.

Called for its side effect from the enrolment/commercial PATCH handlers. A sync
failure is logged but never breaks the primary update — the status change itself
has already been committed by the caller.
"""
import logging

from django.db import DatabaseError, connections

from .mappers import get_training_plan
from .models import ActiveUser

logger = logging.getLogger(__name__)

ACTIVE_STATUS = "active"  # compared case-insensitively
JSON_FIELDS = {"training_plan", "ksbs"}


def _s(value):
    return "" if value is None else str(value).strip()


def _fetch_ksb_items(programme):
    """The KSBs for `programme`, from curriculum.ksb_profiles.ksb_items.

    Matched the same tolerant way curriculum.modules() matches Training_plan to
    module_authoring_modules: an exact programme_name match, or `programme`
    prefixed with the profile's programme_name (Training_plan.Program sometimes
    doubles the level suffix, e.g. 'ME L4 L4' for profile programme_name 'ME L4').
    """
    programme = _s(programme)
    if not programme:
        return []
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT ksb_items FROM curriculum.ksb_profiles "
                "WHERE is_active AND (programme_name = %s OR %s LIKE programme_name || ' %%') "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme, programme],
            )
            row = cur.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not look up KSB profile for %r: %s", programme, exc)
        return []
    if not row or row[0] is None:
        return []
    items = row[0]
    if isinstance(items, str):  # tolerate a raw-string jsonb value
        import json

        try:
            items = json.loads(items)
        except (TypeError, ValueError):
            return []
    return items if isinstance(items, list) else []


def _insert_with_id(source_id, fields):
    """INSERT a brand-new Active_users row carrying an explicit id.

    Active_users.id may still be GENERATED ALWAYS AS IDENTITY (before the
    one-off shared-sequence migration is applied), which rejects a plain INSERT
    that supplies its own id. OVERRIDING SYSTEM VALUE allows it regardless —
    it's accepted (and a no-op) once the column is just a sequence-defaulted
    column post-migration too, so this works in both states.
    """
    import json

    columns = ["id"]
    placeholders = ["%s"]
    values = [source_id]
    for attr, value in fields.items():
        columns.append(ActiveUser._meta.get_field(attr).column)
        placeholders.append("%s")
        values.append(json.dumps(value) if attr in JSON_FIELDS else value)

    col_sql = ", ".join(f'"{c}"' for c in columns)
    sql = (
        f'INSERT INTO "Learner"."Active_users" ({col_sql}) '
        f"OVERRIDING SYSTEM VALUE VALUES ({', '.join(placeholders)})"
    )
    with connections["enrolment"].cursor() as cur:
        cur.execute(sql, values)


def sync_active_user(source):
    """Upsert or remove `source` in Active_users to match its programme status.

    `source` is an EnrolmentUser or CommercialUser instance. When its status is
    Active, the row is upserted (keyed on the learner's id) and returned;
    otherwise any existing mirrored row is deleted and None is returned.
    Swallows DatabaseError so a sync problem never fails the caller's own save.
    """
    status = _s(getattr(source, "programme_status", ""))
    if status.lower() != ACTIVE_STATUS:
        try:
            ActiveUser.objects.filter(id=source.id).delete()
        except DatabaseError as exc:
            logger.warning("Could not remove learner from Active_users: %s", exc)
        return None

    fields = {
        "username": _s(getattr(source, "username", "")) or None,
        "email": _s(getattr(source, "email", "")) or None,
        "phone_number": _s(getattr(source, "phone_number", "")) or None,
        "programme": _s(getattr(source, "programme", "")) or None,
        "programme_status": status,
        "cohort": _s(getattr(source, "cohort", "")) or None,
        "group": _s(getattr(source, "group", "")) or None,
        # The learner's structured plan, copied through as-is: modules contain
        # weeks, weeks contain components (Commercial_users.Training_plan /
        # Enrolment_Users.Learning_plan — same shape, see mappers.py).
        "training_plan": get_training_plan(source),
        # Looked up live from curriculum.ksb_profiles for the learner's programme.
        "ksbs": _fetch_ksb_items(getattr(source, "programme", None)),
    }

    try:
        # Carry the learner's id forward as the Active_users id (key on it).
        # UPDATE never touches the identity column, so it works pre-migration;
        # only a brand-new row needs the OVERRIDING SYSTEM VALUE insert path.
        updated = ActiveUser.objects.filter(id=source.id).update(**fields)
        if not updated:
            _insert_with_id(source.id, fields)
        return ActiveUser.objects.get(id=source.id)
    except DatabaseError as exc:
        logger.warning("Could not mirror learner into Active_users: %s", exc)
        return None
