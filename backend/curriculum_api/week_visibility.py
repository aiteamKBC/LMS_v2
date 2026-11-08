"""Current-content visibility for normalised Curriculum child rows.

Weeks, components and KSB mappings now use ``status`` rather than physical
deletion columns.  Only the explicitly inactive state is hidden.  Historical
readers must keep using their own lineage and must not apply this current-list
predicate merely because a parent module is inactive.
"""

from .canonical_read_sql import current_status_sql

def visible_child_sql(alias):
    """SQL predicate for a child row in a current learning/content read."""
    return f"({current_status_sql(alias)})"


def visible_week_sql(alias):
    """SQL predicate: this ``curriculum.weeks`` row may be shown."""
    return visible_child_sql(alias)
