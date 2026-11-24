"""Compose staff assignment projections from one complete request-local source.

The existing catalogue and group builders still own selection semantics. Coach
profiles expose group IDs/counts only: their unused cohort/calendar/learner totals
need no reads. Tutor summaries keep the existing training/catalogue projections.
"""


def assignment_readers(*, read_source, project_training, project_catalogue,
                       build_cohorts_and_groups, serialize_group):
    source = None

    def rows():
        nonlocal source
        if source is None:
            source = read_source()
        return source

    def training():
        data = rows()
        return project_training(
            ensure_tables=False, module_rows=data['modules'],
            group_rows=data['groups'], cohort_rows=data['cohorts'],
        )

    def catalogue(*, week_rows):
        return project_catalogue(module_rows=rows()['modules'], week_rows=week_rows)

    def groups(training_rows, program_configs, *, include_archived=False):
        data = rows()
        return build_cohorts_and_groups(
            training_rows, program_configs, include_archived=include_archived,
            include_learner_counts=False,
            source={'modules': data['modules'], 'cohorts': [],
                    'groups': [serialize_group(row) for row in data['groups']]},
        )

    return {
        'get_training_rows': training,
        'get_program_config_rows': lambda: rows()['programmes'],
        'authoring_modules_as_catalogue_rows': catalogue,
        'build_cohorts_and_groups': groups,
    }
