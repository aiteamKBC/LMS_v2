"""Read-only PDF download for a coach-owned review instance or Aptem import."""
from django.views.decorators.http import require_GET
from .auth import coach_access_required
from curriculum_api.review_pdf import (
    historical_pdf_response,
    learner_information,
    mcm_pdf_response,
    pdf_availability,
)


@coach_access_required
@require_GET
def coach_mcm_pdf(request, instance_id):
    from django.http import JsonResponse
    from .views import _authorized_review_instance, _imported_review_definition
    from .auth import authenticated_coach_email
    from .models import CoachCalendarEvent
    from learner_api.models import LearnerProfile, EnrolmentUser
    from curriculum_api.review_instances import review_instance_form_definition

    if instance_id.startswith('imported-review:'):
        definition = _imported_review_definition(authenticated_coach_email(request), instance_id)
        if not definition:
            return JsonResponse({'detail': 'Imported review not found for this coach.'}, status=404)
        if definition.get('migratedForm'):
            if not (definition.get('pdf') or {}).get('available'):
                return JsonResponse({'detail': (definition.get('pdf') or {}).get('reason') or 'The LMS-generated migrated PDF is not available yet.'}, status=409)
            from .migrated_completion_views import migrated_review_pdf_response
            return migrated_review_pdf_response(request, instance_id, definition)
        instance = definition['instance']
    else:
        instance, error = _authorized_review_instance(request, instance_id)
        if error:
            return error
        definition = review_instance_form_definition(instance)
    if instance_id.startswith('imported-review:'):
        # Imported definitions use the same camelCase contract returned to
        # the frontend (``learnerId``). Keep the snake_case fallback for any
        # older definition shape so PDF downloads remain backwards compatible.
        profile_id = instance.get('learnerId') or instance.get('learner_id')
        profile = LearnerProfile.objects.filter(pk=profile_id).first() if profile_id else None
        source = EnrolmentUser.all_learners.filter(pk=profile.enrolment_id).first() if profile and profile.enrolment_id else None
        from learner_api.aptem_review_pdf import original_review_pdf
        historical_review = definition.get('historicalReview') or {}
        information = learner_information(
            source,
            name=getattr(profile, 'username', '') or historical_review.get('learnerName', ''),
            programme=getattr(profile, 'programme', ''),
        )
        return historical_pdf_response(
            historical_review,
            information,
            identifier=instance_id.split(':', 1)[-1],
            original_content=original_review_pdf(historical_review),
        )
    if not (pdf_availability(definition) or {}).get('available'):
        return mcm_pdf_response(definition, {})
    profile = LearnerProfile.objects.filter(pk=instance['learner_id']).first()
    source = EnrolmentUser.all_learners.filter(pk=profile.enrolment_id).first() if profile and profile.enrolment_id else None
    record = CoachCalendarEvent.objects.filter(pk=instance.get('calendar_event_id')).first() if instance.get('calendar_event_id') else None
    information = learner_information(
        source,
        name=getattr(profile, 'username', '') or getattr(record, 'learner_name', ''),
        programme=getattr(profile, 'programme', '') or getattr(record, 'programme', ''),
    )
    return mcm_pdf_response(definition, information)
