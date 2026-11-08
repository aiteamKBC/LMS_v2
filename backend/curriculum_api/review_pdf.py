"""A signed MCM export, using the supplied Aptem PDF as the layout reference.

The saved instance supplies the questions, answers and original signatures.
Source PDFs and their learners' answers/signatures are never used as content.
"""
import re

from .review_instances import SIGNATURE_ROLES, meeting_summary_field, required_signature_roles

from .review_pdf_presentation import (
    EXPORTABLE_REVIEW_TYPES, IMAGE_PATTERN, ROLE_LABELS,
    REVIEW_TYPE_MCM, REVIEW_TYPE_APTEM_MCM, REVIEW_TYPE_PROGRESS_REVIEW,
    display_date, imported_table_rows, is_mcm_review,
    percent_text, programme_dates, render_review_pdf, review_type_code,
    variance_text, visible_fields, _signature_image,
)


def pdf_availability(definition):
    if review_type_code(definition) not in EXPORTABLE_REVIEW_TYPES:
        return None
    signatures = definition.get('signatures', {})
    required = required_signature_roles(signatures)
    if (definition.get('instance') or {}).get('status') != 'completed' or any(
        not signatures.get(role, {}).get('signed') for role in required
    ):
        return {'available': False, 'reason': 'The PDF is available after the review is completed and all required parties have signed.'}
    for role in required:
        state = signatures[role]
        if not state.get('signedName') or not state.get('signedAt') or not IMAGE_PATTERN.fullmatch(state.get('signature') or ''):
            return {'available': False, 'reason': 'A saved signature image, name or date is missing. The signed PDF cannot be generated.'}
    return {'available': True, 'reason': ''}


def learner_information(source, *, name='', programme=''):
    return {
        'name': getattr(source, 'username', '') or name,
        'programme': getattr(source, 'programme', '') or programme,
        'startDate': getattr(source, 'start_date', None),
        'endDate': getattr(source, 'end_date', None),
        # The learner's OWN programme dates, as distinct from the two above --
        # "Created_users"."Start_date"/"End_date" carry the cohort delivery
        # window (active_users.mirror_learner_placement stamps the profile
        # mirror with it), which is shared by everyone placed in that cohort.
        # Carried separately rather than substituted, so the existing MCM
        # export keeps reading exactly the dates it always has.
        'learnerStartDate': getattr(source, 'learner_start_date', None),
        'learnerEndDate': getattr(source, 'learner_end_date', None),
        'employer': getattr(source, 'employer', ''),
        'manager': getattr(source, 'line_manager', ''),
    }


def build_mcm_pdf(definition, information):
    """Native adapter: keep Native availability and semantic-summary policy."""
    availability = pdf_availability(definition)
    if not availability or not availability['available']:
        raise ValueError((availability or {}).get('reason') or 'A signed review is required.')
    return render_review_pdf(
        definition, information, signature_roles=SIGNATURE_ROLES,
        formal_meeting_summary=meeting_summary_field(definition) if is_mcm_review(definition) else None,
    )


def mcm_pdf_response(definition, information):
    from django.http import HttpResponse, JsonResponse
    availability = pdf_availability(definition)
    if availability is None:
        return JsonResponse({'detail': 'This review type has no signed PDF export.'}, status=404)
    if not availability['available']:
        return JsonResponse({'detail': availability['reason']}, status=409)
    try:
        content = build_mcm_pdf(definition, information)
    except ValueError as exc:
        return JsonResponse({'detail': str(exc)}, status=409)
    response = HttpResponse(content, content_type='application/pdf')
    identifier = re.sub(r'[^A-Za-z0-9_-]', '', str(definition['instance']['id']))
    prefix = EXPORTABLE_REVIEW_TYPES[review_type_code(definition)]
    response['Content-Disposition'] = f'attachment; filename="{prefix}-{identifier}.pdf"'
    response['Cache-Control'] = 'private, no-store'
    return response


def historical_pdf_response(review, information, *, identifier, original_content=None):
    """Return the verified original PDF for an imported Aptem review.

    Aptem reviews are historical records.  The LMS must return the exact PDF
    stored by Aptem when one is available; it must not silently create a new
    document that could differ from the source record.
    """
    from django.http import HttpResponse, JsonResponse

    if not original_content:
        return JsonResponse(
            {'detail': 'The original Aptem PDF is unavailable for this review.'},
            status=404,
        )
    content = original_content
    safe_identifier = re.sub(r'[^A-Za-z0-9_-]', '', str(identifier)) or 'review'
    response = HttpResponse(content, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="Aptem-Review-{safe_identifier}.pdf"'
    response['X-Review-PDF-Source'] = 'aptem-original'
    response['Cache-Control'] = 'private, no-store'
    return response
