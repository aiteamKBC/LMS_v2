"""Identity shared by feedback ticket creation and email follow-up."""
import uuid

from learner_api import support_tickets


def quality_ticket_id(response_id):
    return uuid.uuid5(uuid.NAMESPACE_URL, f'lms-feedback-quality:{response_id}')


def close_response_ticket(response, *, actor_name):
    enrolment_id = str(response.enrolment_id or '')
    if not enrolment_id.isdecimal():
        return 'not_required'
    return support_tickets.close_feedback_ticket(
        ticket_id=str(quality_ticket_id(response.pk)), enrolment_id=int(enrolment_id), actor_name=actor_name,
    )
