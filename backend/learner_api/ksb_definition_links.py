"""Preserve and resolve Progress KSB definition identities.

Definitions are scoped by the learner's immutable KSB profile assignment.  A
code is never resolved globally: the same code exists in multiple programmes
and profile versions.  Existing identities take precedence for an unchanged
mapping so historical progress does not silently move to a learner's current
profile version during a rebuild.
"""
from collections import defaultdict


DEFINITION_ID_KEYS = ("ksb_definition_id", "ksbDefinitionId")


def _text(value):
    return str(value or "").strip()


def _code(value):
    return _text(value).upper()


def _integer(value):
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _value(row, key, default=None):
    return row.get(key, default) if isinstance(row, dict) else getattr(row, key, default)


def _identity(row):
    return (
        _code(_value(row, "ksb_code", _value(row, "code", _value(row, "ksbCode")))),
        _text(_value(row, "source_type", _value(row, "sourceType"))),
        _text(_value(row, "source_id", _value(row, "sourceId"))),
    )


def _definition_value(row):
    for key in DEFINITION_ID_KEYS:
        if isinstance(row, dict) and key in row:
            return True, _integer(row.get(key))
        if not isinstance(row, dict) and hasattr(row, key):
            return True, _integer(getattr(row, key))
    return False, None


def assigned_definition_ids(cursor, learner_ids, mappings):
    """Return only unambiguous ``(learner_id, code) -> definition id`` pairs.

    The assignment join provides both programme/profile compatibility and the
    definition identity.  Duplicate assignments or case-variant definitions
    deliberately produce no result for that learner/code rather than a guess.
    """
    learners = sorted({_integer(value) for value in learner_ids if _integer(value) is not None})
    codes = sorted({_identity(row)[0] for row in mappings if _identity(row)[0]})
    if not learners or not codes:
        return {}
    connection = getattr(cursor, "db", None)
    if connection is not None and getattr(connection, "vendor", "postgresql") != "postgresql":
        return {}
    cursor.execute(
        '''SELECT a.learner_id,upper(btrim(d.code)),d.id
             FROM "Learner".learner_ksb_assignments a
             JOIN curriculum.ksb_definitions d ON d.profile_version_id=a.profile_version_id
            WHERE a.learner_id=ANY(%s) AND upper(btrim(d.code))=ANY(%s)
            ORDER BY a.learner_id,upper(btrim(d.code)),d.id''',
        [learners, codes],
    )
    candidates = defaultdict(set)
    for learner_id, code, definition_id in cursor.fetchall():
        candidates[(int(learner_id), _code(code))].add(int(definition_id))
    return {key: next(iter(values)) for key, values in candidates.items() if len(values) == 1}


def attach_definition_ids(mappings, learner_id, assigned_ids, *, existing=()):
    """Copy mappings and attach a safe definition id to every row.

    An explicit payload identity must equal the definition resolved through the
    learner's assigned profile version.  Without an explicit identity, an
    unchanged stored mapping preserves its exact historical value, including
    NULL.  Only a genuinely new/changed mapping falls back to the assigned
    profile's unambiguous definition.
    """
    learner_id = _integer(learner_id)
    existing_by_position = defaultdict(list)
    existing_by_identity = defaultdict(list)
    for row in existing or ():
        identity = _identity(row)
        existing_by_identity[identity].append(row)
        existing_by_position[(_integer(_value(row, "position")), *identity)].append(row)

    result = []
    for row in mappings or ():
        item = dict(row)
        identity = _identity(item)
        supplied, explicit_id = _definition_value(item)
        assigned_id = assigned_ids.get((learner_id, identity[0]))
        if supplied:
            definition_id = explicit_id if explicit_id is not None and explicit_id == assigned_id else None
        else:
            matches = existing_by_position.get((_integer(item.get("position")), *identity), [])
            if not matches:
                matches = existing_by_identity.get(identity, [])
            if matches:
                stored = {_definition_value(match)[1] for match in matches}
                definition_id = next(iter(stored)) if len(stored) == 1 else None
            else:
                definition_id = assigned_id
        item["ksb_definition_id"] = definition_id
        result.append(item)
    return result
