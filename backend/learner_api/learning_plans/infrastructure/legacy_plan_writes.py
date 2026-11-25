"""Django persistence adapters for legacy learning-plan compatibility writes."""


def save_legacy_plan(learner, field, entries):
    """Persist the existing JSON compatibility plan using its selected column."""
    setattr(learner, field, entries)
    learner.save(update_fields=[field])

