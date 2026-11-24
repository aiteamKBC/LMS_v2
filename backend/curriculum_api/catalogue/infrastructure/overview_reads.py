"""Required overview source reads, preserving schema guards and rejecting incomplete sources."""
from ..application.overview import CurriculumOverviewUnavailable


def read_curriculum_source(compact=False, *, prefetch_authoring_reads,
                           training_index_reads, module_index_rows, authoring_fetch_all,
                           groups_table, groups_order, cohorts_table, cohorts_order,
                           weeks_table, week_columns, get_ksb_profile_rows,
                           get_program_config_rows, get_holiday_rows,
                           read_staff_profile_rows, get_tutor_module_rows):
    try:
        # Preserve the existing batched-read optimization. The required reads
        # below still run if prefetch declines or fails; they must all succeed.
        # Keep the existing default schema guard and memo keys so downstream
        # overview consumers reuse these reads instead of repeating them.
        prefetch_authoring_reads([
            *training_index_reads(),
            ((weeks_table,), {'columns': week_columns}),
        ])
        source = {
            'authoring_modules': module_index_rows(),
            'group_rows': authoring_fetch_all(groups_table, order_sql=groups_order),
            'cohort_rows': authoring_fetch_all(cohorts_table, order_sql=cohorts_order),
            'week_rows': authoring_fetch_all(weeks_table, columns=week_columns),
            'ksb_profiles': get_ksb_profile_rows(),
            'program_configs': get_program_config_rows(),
        }
        if compact:
            return {**source, 'holidays': [], 'tutors': [], 'coaches': [], 'tutor_modules': []}
        return {
            **source,
            'holidays': get_holiday_rows(),
            'tutors': read_staff_profile_rows('tutor'),
            'coaches': read_staff_profile_rows('coach'),
            'tutor_modules': get_tutor_module_rows(),
        }
    except Exception as exc:
        raise CurriculumOverviewUnavailable('Curriculum overview unavailable. Please retry.') from exc
