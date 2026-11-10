"""Errors a learner-progress read raises instead of answering with nothing."""


class LearnerProgressUnavailable(RuntimeError):
    """Learner progress could not be read, so achievement cannot be reported.

    Raised instead of returning empty totals: an empty answer was shown as
    every learner having achieved nothing (a statement timeout on a large
    programme looked exactly like a cohort with no progress). The curriculum
    middleware turns it into a 503 that says what is missing.
    """

    message = (
        'Learner progress could not be loaded, so achievement and off-the-job '
        'figures are not shown. Please try again in a moment.'
    )

    def __init__(self, message=None):
        super().__init__(message or self.message)
