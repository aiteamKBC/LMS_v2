"""Existing signed and original-historical PDF HTTP response contracts."""
import re

from ..application.pdf_export import build_mcm_pdf
from ..domain.pdf_policy import EXPORTABLE_REVIEW_TYPES, pdf_availability, review_type_code


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
