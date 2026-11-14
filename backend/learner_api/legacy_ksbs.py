"""Read the retained per-learner KSB self-assessment snapshot.

The current ``Learner.learner_ksbs`` relation is not the old normalized KSB
definition table represented by :class:`learner_api.models.LearnerKsb`.  It is
an onboarding/Skills Radar snapshot keyed by ``(learner_id, category, code)``:

* ``category`` is the saved Knowledge/Skill/Behaviour label;
* ``code`` is the KSB identity;
* ``title`` is the saved KSB description; and
* ``level`` is the learner's self-assessment, not a standard definition level.

Keep this adapter read-only and learner-scoped.  Canonical assigned profile
versions remain authoritative whenever a learner has one.
"""

from django.db import connections


LEGACY_KSB_READ_SQL = '''
    SELECT category, code, title, level
    FROM "Learner".learner_ksbs
    WHERE learner_id = %s
    ORDER BY category, code
'''


def _text(value):
    return "" if value is None else str(value).strip()


def _api_row(category, code, title, level):
    """Preserve the established fields without inventing missing semantics."""
    return {
        "code": _text(code),
        # The retained snapshot has no separate numeric definition field.
        "number": "",
        # Preserve unknown categories verbatim rather than guessing a mapping.
        "type": _text(category),
        "description": _text(title),
        # This learner-owned assessment has no canonical equivalent, so expose
        # it under its real name instead of folding it into description/type.
        "level": _text(level),
    }


def read_legacy_learner_ksbs(learner_id, *, using="enrolment"):
    """Return this learner's retained KSB rows in the existing API shape.

    No rows is valid missing data and returns ``[]``.  Database/schema errors
    deliberately propagate so callers can return an unavailable response rather
    than silently presenting data loss as an empty KSB list.
    """
    if learner_id is None:
        return []

    with connections[using].cursor() as cursor:
        cursor.execute(LEGACY_KSB_READ_SQL, [learner_id])
        rows = cursor.fetchall()

    # The database primary key already guarantees this identity.  Retain the
    # guard so a malformed compatibility fixture cannot duplicate API rows.
    seen = set()
    result = []
    for category, code, title, level in rows:
        identity = (_text(category), _text(code))
        if identity in seen:
            continue
        seen.add(identity)
        result.append(_api_row(category, code, title, level))
    return result
