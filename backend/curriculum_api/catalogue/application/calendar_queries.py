"""Scoped authored calendar queries over explicit normalized read capabilities."""
from .overview import CurriculumOverviewUnavailable


def relationships(modules, groups, cohorts, holidays=(), *, include_archived=False,
                  build_cohorts_and_groups, serialize_group, serialize_cohort):
    return build_cohorts_and_groups(include_learner_counts=False, include_archived=include_archived, source={
        'modules': modules,
        'groups': [serialize_group(row) for row in groups],
        'cohorts': [serialize_cohort(row, list(holidays)) for row in cohorts],
    })


def build_calendar_snapshot(*, visibility='operational', module_ids=None, programme_id=None,
                            read_inputs, read_holidays, relationships, live_rows,
                            build_snapshot, programme_deleted_row, clean_str):
    """One authoritative calendar for Delivery, programme detail and session GETs."""
    try:
        scopes = {}
        if module_ids is not None:
            scopes['module_ids'] = module_ids
        if programme_id is not None:
            scopes['programme_id'] = programme_id
        modules, groups, cohorts = read_inputs(schedule=True, **scopes)
        if visibility != 'all':
            modules = [row for row in modules if not programme_deleted_row(row)]
        if not modules:
            return {'sessions': [], 'undatedSessionCount': 0}
        holidays = read_holidays()
        cohort_rows, group_rows = relationships(
            modules, groups, cohorts, holidays,
            **({'include_archived': True} if visibility == 'all' else {}),
        )
        ids = list(dict.fromkeys(clean_str(row.get('module_catalogue_id')) for row in modules
                                if clean_str(row.get('module_catalogue_id'))))
        weeks, components = live_rows(ids)
        return build_snapshot(modules, cohort_rows, group_rows, holidays,
                              raw_groups=groups, week_rows=weeks, component_rows=components)
    except CurriculumOverviewUnavailable:
        raise
    except Exception as exc:
        raise CurriculumOverviewUnavailable('Curriculum calendar unavailable. Please retry.') from exc
