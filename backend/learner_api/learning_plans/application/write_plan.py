"""Application-level normalized Training Plan write orchestration."""


def write_normalized_plan(
    learner_id,
    requested_plan,
    *,
    authorization,
    reconcile,
    expected_version=None,
    reorder=False,
    using="enrolment",
):
    """Delegate one complete desired plan to the sole persistence writer."""
    return reconcile(
        learner_id,
        requested_plan,
        authorization=authorization,
        expected_version=expected_version,
        reorder=reorder,
        using=using,
    )

