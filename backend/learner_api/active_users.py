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
import json
import logging
from datetime import timedelta

from django.db import DatabaseError, connections

from .mappers import get_training_plan
from .models import ActiveUser, SafeJSONField, UnactiveUser

logger = logging.getLogger(__name__)

ACTIVE_STATUS = "active"  # compared case-insensitively
JSON_FIELDS = {"training_plan", "ksbs", "training_plan_progress", "activity_feed"}


def _s(value):
    return "" if value is None else str(value).strip()


def _reported_minutes(reported_time):
    """Parse a record's reportedTime into minutes.

    Handles the two formats the reflection window produces:
      - "MM:SS" (e.g. "23:16")   -> 23 + 16/60 minutes
      - "N ..." (e.g. "60 minutes", "9 min", "1.5 hours") -> N, treated as
        minutes UNLESS the text mentions hours, in which case N*60.
    Returns 0.0 if nothing parseable.
    """
    text = _s(reported_time)
    if not text:
        return 0.0
    if ":" in text:  # MM:SS
        parts = text.split(":")
        try:
            mm = float(parts[0])
            ss = float(parts[1]) if len(parts) > 1 else 0.0
            return mm + ss / 60.0
        except (ValueError, IndexError):
            return 0.0
    import re
    m = re.search(r"\d+(\.\d+)?", text)
    if not m:
        return 0.0
    n = float(m.group(0))
    return n * 60.0 if "hour" in text.lower() or "hr" in text.lower() else n


def fmt_hours(hours):
    """A numeric hours value -> the text form these columns store (1 dp, e.g.
    "48.0" -> "48", "1.5" -> "1.5"). None/invalid -> "0"."""
    try:
        h = round(float(hours), 1)
    except (TypeError, ValueError):
        return "0"
    return str(int(h)) if h == int(h) else str(h)


def completed_hours_from_progress(progress):
    """Total the reportedTime across ALL progress records -> hours string (1 dp).

    OTJ hours count EVERY attempt/record: a retake of a quiz or a re-watch of a
    video each add their logged time. Sums every record's reportedTime across all
    activity kinds, converts to hours, returns e.g. "1.4". "0" when empty.
    (KSBs, by contrast, count only the best attempt — see quizAggregateStats.)
    """
    if not isinstance(progress, list):
        return "0"
    total_minutes = sum(_reported_minutes(r.get("reportedTime")) for r in progress if isinstance(r, dict))
    return fmt_hours(total_minutes / 60.0)


def append_activity_entry(active, entry):
    """Append one activity entry to an ActiveUser's activity_feed list (in place)
    and return the updated list. Does NOT save — the caller persists it (usually
    in the same save as the progress append). `active` may be None (returns [])."""
    if active is None:
        return []
    feed = active.activity_feed if isinstance(active.activity_feed, list) else []
    feed.append(entry)
    active.activity_feed = feed
    return feed


def recompute_completed_hours(learner_id):
    """Recompute Completed_hours for an Active_users learner from their current
    training_plan_progress, and persist it. Best-effort; errors are logged.
    Returns the stored string, or None if there's no active row / on error."""
    try:
        active = ActiveUser.objects.filter(id=learner_id).first()
        if active is None:
            return None
        value = completed_hours_from_progress(active.training_plan_progress)
        active.completed_hours = value
        active.save(update_fields=["completed_hours"])
        return value
    except DatabaseError as exc:
        logger.warning("Could not recompute Completed_hours for %s: %s", learner_id, exc)
        return None


def cohort_dates(programme, cohort):
    """(start_date, end_date) for a learner's cohort, or (None, None).

    Looked up from curriculum."cohort_authoring_details" by matching the learner's
    free-text Programme + Cohort against the authored cohort's programme_name +
    cohort_name (case-insensitive, trimmed) — the learner tables have no cohort_id
    to join on. Newest updated_at wins if a (programme, cohort) pair repeats.
    Best-effort: any DB/lookup error returns (None, None) so it never breaks a
    learner create or mirror sync.
    """
    prog = _s(programme)
    coh = _s(cohort)
    if not prog or not coh:
        return None, None
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'SELECT start_date, end_date FROM curriculum."cohort_authoring_details" '
                "WHERE lower(btrim(programme_name)) = lower(%s) "
                "AND lower(btrim(cohort_name)) = lower(%s) "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [prog, coh],
            )
            row = cur.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not look up cohort dates for %r / %r: %s", prog, coh, exc)
        return None, None
    if not row:
        return None, None
    return row[0], row[1]


def _fetch_ksb_items(programme):
    """The KSBs for `programme`, from curriculum.ksb_profiles.ksb_items.

    Matched the same tolerant way curriculum.modules() matches Training_plan to
    modules: an exact programme_name match, or `programme`
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


# Fields whose VALUES are learner-owned progress/state (not rebuildable from the
# source enrolment tables). These must survive the Active <-> Unactive round-trip
# so a learner keeps their coach, hours, and progress when re-activated.
PRESERVED_FIELDS = (
    "coach_name", "coach_email", "coach_rag", "completed_hours",
    "training_plan", "ksbs", "training_plan_progress", "activity_feed",
)


def _archive_active_user(learner_id, new_status):
    """Move a learner's Active_users row into Unactive_users (stamped with the
    non-Active status they're moving to), then remove it from Active_users.
    No-op if there is no Active_users row. Best-effort; errors are logged."""
    try:
        active = ActiveUser.objects.filter(id=learner_id).first()
        if active is None:
            return
        # Snapshot only the fields Unactive_users ALSO has (ActiveUser has extra
        # columns — planned/target/progress hours — that the archive table lacks;
        # copying those would raise FieldDoesNotExist and abort the whole archive,
        # which is exactly how Training_plan_progress was getting lost).
        unactive_attrs = {
            f.name for f in UnactiveUser._meta.get_fields()
            if getattr(f, "concrete", False) and not f.primary_key
        }
        # JSON-typed archive columns, so their Python list/dict values are encoded.
        json_cols = {
            f.name for f in UnactiveUser._meta.get_fields()
            if isinstance(f, SafeJSONField)
        }
        fields = {}
        for f in ActiveUser._meta.get_fields():
            if not getattr(f, "concrete", False) or f.primary_key:
                continue
            if f.name in unactive_attrs:
                fields[f.name] = getattr(active, f.name)
        fields["status"] = new_status  # the status the learner is moving OUT under

        # Upsert into Unactive_users keyed on the same id.
        set_cols, values = [], []
        for attr, value in fields.items():
            col = UnactiveUser._meta.get_field(attr).column
            set_cols.append((col, attr))
            values.append(json.dumps(value) if attr in json_cols else value)

        with connections["enrolment"].cursor() as cur:
            exists = UnactiveUser.objects.filter(id=learner_id).exists()
            if exists:
                assignments = ", ".join(f'"{c}" = %s' for c, _ in set_cols)
                cur.execute(
                    f'UPDATE "Learner"."Unactive_users" SET {assignments} WHERE "id" = %s',
                    values + [learner_id],
                )
            else:
                cols = ", ".join(['"id"'] + [f'"{c}"' for c, _ in set_cols])
                marks = ", ".join(["%s"] * (len(set_cols) + 1))
                cur.execute(
                    f'INSERT INTO "Learner"."Unactive_users" ({cols}) '
                    f"OVERRIDING SYSTEM VALUE VALUES ({marks})",
                    [learner_id] + values,
                )
        ActiveUser.objects.filter(id=learner_id).delete()
    except Exception as exc:  # noqa: BLE001 — never let an archive error break the caller's save, and never delete the Active row unless the archive write above succeeded
        logger.warning("Could not archive learner %s into Unactive_users: %s", learner_id, exc)


def _restore_preserved(learner_id):
    """Pull a learner's preserved fields out of the Unactive_users archive (if
    any) and delete the archive row. Returns a dict of {attr: value} for the
    PRESERVED_FIELDS that had a stored value, or {} if there's no archive."""
    try:
        archived = UnactiveUser.objects.filter(id=learner_id).first()
        if archived is None:
            return {}
        preserved = {}
        for attr in PRESERVED_FIELDS:
            value = getattr(archived, attr, None)
            if value not in (None, "", [], {}):
                preserved[attr] = value
        UnactiveUser.objects.filter(id=learner_id).delete()
        return preserved
    except DatabaseError as exc:
        logger.warning("Could not restore learner %s from Unactive_users: %s", learner_id, exc)
        return {}


def sync_active_user(source):
    """Upsert `source` in Active_users to match its programme status, MOVING the
    row to/from the Unactive_users archive so no learner data is lost.

    `source` is an EnrolmentUser or CommercialUser instance.
      - status != Active: archive the Active_users row into Unactive_users
        (preserving coach/progress/hours/etc.), remove it from Active_users,
        return None.
      - status == Active: upsert into Active_users; if the learner has an
        archived row, its preserved fields are restored (and the archive
        deleted) so a re-activated learner keeps everything.
    Swallows DatabaseError so a sync problem never fails the caller's own save.
    """
    status = _s(getattr(source, "programme_status", ""))
    if status.lower() != ACTIVE_STATUS:
        _archive_active_user(source.id, status)
        return None

    start_date, end_date = cohort_dates(
        getattr(source, "programme", None), getattr(source, "cohort", None)
    )
    fields = {
        "username": _s(getattr(source, "username", "")) or None,
        "email": _s(getattr(source, "email", "")) or None,
        "phone_number": _s(getattr(source, "phone_number", "")) or None,
        "programme": _s(getattr(source, "programme", "")) or None,
        "programme_status": status,
        "cohort": _s(getattr(source, "cohort", "")) or None,
        "group": _s(getattr(source, "group", "")) or None,
        # Cohort delivery window, looked up from the authored cohort table.
        "start_date": start_date,
        "end_date": end_date,
        "gateway_review_date": end_date - timedelta(days=90) if end_date else None,
        # The learner's structured plan, copied through as-is: modules contain
        # weeks, weeks contain components (Commercial_users.Training_plan /
        # Enrolment_Users.Learning_plan — same shape, see mappers.py).
        "training_plan": get_training_plan(source),
        # Looked up live from curriculum.ksb_profiles for the learner's programme.
        "ksbs": _fetch_ksb_items(getattr(source, "programme", None)),
    }

    # If the learner is returning from a non-Active spell, restore the fields we
    # can't rebuild from source (coach/hours/progress). Restored values win over
    # the freshly-derived ones so nothing the learner did is lost.
    fields.update(_restore_preserved(source.id))

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
