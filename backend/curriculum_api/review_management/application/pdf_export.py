"""Prepare saved display information and coordinate native signed exports."""
from ..domain.instance_rules import SIGNATURE_ROLES
from ..domain.instance_definitions import meeting_summary_field
from ..domain.pdf_policy import is_mcm_review, pdf_availability
from ..infrastructure.pdf_renderer import render_review_pdf


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
