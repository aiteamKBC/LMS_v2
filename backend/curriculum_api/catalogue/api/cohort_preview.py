"""Cohort date preview HTTP contract.

No legacy views or provider imports.
"""


from ..application.cohort_calendar import cohort_end_preview


def curriculum_preview_cohort_end_date(
    request, *, JsonResponse, calculate_cohort_end_date, cohort_apprenticeship_end_date,
    format_date, infer_duration_months, json_body, json_error, parse_date, parse_int,
    payload_apprenticeship_end_override, payload_epa_months,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    return JsonResponse(cohort_end_preview(
        payload, calculate_cohort_end_date=calculate_cohort_end_date,
        cohort_apprenticeship_end_date=cohort_apprenticeship_end_date, format_date=format_date,
        infer_duration_months=infer_duration_months, parse_date=parse_date, parse_int=parse_int,
        payload_apprenticeship_end_override=payload_apprenticeship_end_override,
        payload_epa_months=payload_epa_months,
    ))
