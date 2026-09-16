"""Read-only download for the coach who owns a signed MCM instance."""
from django.views.decorators.http import require_GET
from .auth import coach_access_required
from curriculum_api.review_pdf import learner_information, mcm_pdf_response, pdf_availability


@coach_access_required
@require_GET
def coach_mcm_pdf(request, instance_id):
    from .views import _authorized_review_instance
    from .models import CoachCalendarEvent
    from learner_api.models import LearnerProfile, EnrolmentUser
    from curriculum_api.review_instances import review_instance_form_definition

    instance, error = _authorized_review_instance(request, instance_id)
    if error:
        return error
    definition = review_instance_form_definition(instance)
    if not (pdf_availability(definition) or {}).get('available'):
        return mcm_pdf_response(definition, {})
    profile = LearnerProfile.objects.filter(pk=instance['learner_id']).first()
    source = EnrolmentUser.all_learners.filter(pk=profile.enrolment_id).first() if profile and profile.enrolment_id else None
    record = CoachCalendarEvent.objects.filter(pk=instance.get('calendar_event_id')).first()
    information = learner_information(
        source,
        name=getattr(profile, 'username', '') or getattr(record, 'learner_name', ''),
        programme=getattr(profile, 'programme', '') or getattr(record, 'programme', ''),
    )
    return mcm_pdf_response(definition, information)
