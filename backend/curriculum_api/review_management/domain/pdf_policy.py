"""Signed export eligibility and authoritative programme-date selection."""
import re

from .instance_rules import required_signature_roles


IMAGE_PATTERN = re.compile(r'^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$', re.I)


REVIEW_TYPE_MCM = 'mcm'


REVIEW_TYPE_APTEM_MCM = 'aptem_mcm'


REVIEW_TYPE_PROGRESS_REVIEW = 'progress_review'


# Exportability follows the stable Review Type code, never a template name.
EXPORTABLE_REVIEW_TYPES = {
    REVIEW_TYPE_MCM: 'Monthly-Coaching-Meeting',
    REVIEW_TYPE_APTEM_MCM: 'Monthly-Coaching-Meeting',
    REVIEW_TYPE_PROGRESS_REVIEW: 'Progress-Review',
}


def review_type_code(definition):
    return definition.get('template', {}).get('reviewTypeCode')


def is_mcm_review(definition):
    return review_type_code(definition) in {REVIEW_TYPE_MCM, REVIEW_TYPE_APTEM_MCM}


def programme_dates(definition, information):
    """(start, end) for the Information block.

    A Progress Review states the individual learner's own programme start date
    -- the same date its progress snapshot was calculated from -- so the two
    can never disagree inside one document. Everything else keeps the enrolment
    window it already showed.
    """
    if review_type_code(definition) != REVIEW_TYPE_PROGRESS_REVIEW:
        return information.get('startDate'), information.get('endDate')
    snapshot = definition.get('progressSnapshot') or {}
    start = snapshot.get('calculatedFrom') or information.get('learnerStartDate') or information.get('startDate')
    return start, information.get('learnerEndDate') or information.get('endDate')


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
