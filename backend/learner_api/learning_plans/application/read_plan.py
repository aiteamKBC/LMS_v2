"""Learning-plan read use cases with all persistence supplied by callers."""


def read_learning_plan(learner, *, serialize):
    """Return the existing serialized plan without owning HTTP or persistence."""
    return serialize(learner)

