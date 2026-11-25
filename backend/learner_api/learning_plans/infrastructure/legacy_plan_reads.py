"""Django read adapters for legacy Learning Plan HTTP compatibility."""


def load_enrolment_learner(enrolment_model, pk):
    """Load one learner through the existing all-learners manager."""
    return enrolment_model.all_learners.get(pk=pk)

