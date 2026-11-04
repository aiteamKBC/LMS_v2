"""Which deleted curriculum rows a learner-facing read may still show.

A module shows only its live weeks, components and KSB mappings: rows whose
``deleted_at`` is NULL. A row with a deletion stamp is never shown.

The canonical curriculum.modules table has no deletion marker, so the former
rule that kept a withdrawn module's children visible as the learner's history
(rows "archived with" a module stamped in the same moment) can no longer apply
and has been removed. Whether a withdrawn module should keep showing history is
a business rule still to be defined; until then, deleted rows stay hidden.

``ARCHIVE_EVENT_WINDOW`` (the five minutes inside which one archive writes all
of its rows) is kept for compatibility; no visibility predicate uses it now.
"""

ARCHIVE_EVENT_WINDOW = "interval '5 minutes'"


def visible_child_sql(alias):
    """SQL predicate: this module child row may be shown.

    For any ``curriculum`` table whose rows carry ``deleted_at`` -- weeks,
    components, KSB mappings. ``alias`` is the name the row has in the calling
    query -- its alias, or the bare table name for an unaliased
    ``FROM curriculum.<table>``.

    Only rows without a deletion stamp are shown. The canonical
    curriculum.modules table has no deletion marker (``deleted_at`` and
    ``deleted_via_parent`` were removed), so there is no archived module whose
    stamped children could be shown as its history: the former exception for
    rows "archived with their module" can never apply and is gone. A row with
    ``deleted_at`` set is always hidden, including children stamped by an
    earlier module or programme archive and the stale children of a module
    that was later restored.
    """
    return f"({alias}.deleted_at IS NULL)"


def visible_week_sql(alias):
    """SQL predicate: this ``curriculum.weeks`` row may be shown."""
    return visible_child_sql(alias)
