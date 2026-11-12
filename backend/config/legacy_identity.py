"""Temporary attribute aliases for renamed learner identity fields.

The identity normalisation renamed every model field called ``learner_id`` to
the namespace it actually holds (``learner_profile_id`` or ``enrolment_id``).
Callers that still read or assign ``obj.learner_id``, or pass ``learner_id=``
to a model constructor, keep working through this alias until they move.

Only attribute access is aliased. ORM lookups (``filter(learner_id=...)``,
``values("learner_id")``) must use the real field name; Django has no field
alias for queries, so those raise FieldError instead of silently misreading.

Remove each alias once a repository-wide search shows no ``.learner_id``
reader of that model remains.
"""


def legacy_field_alias(field_name):
    """Read/write ``learner_id`` as an alias of ``field_name`` on one model."""
    return property(
        lambda self: getattr(self, field_name),
        lambda self, value: setattr(self, field_name, value),
        doc=f"Temporary alias of {field_name}; see config.legacy_identity.",
    )
