"""Identity shared by feedback ticket creation and email follow-up."""
import uuid

from learner_api import support_tickets


def quality_ticket_id(response_id):
    return uuid.uuid5(uuid.NAMESPACE_URL, f'lms-feedback-quality:{response_id}')


def close_response_ticket(response, *, actor_name):
    learner_id = str(response.learner_id or '')
    if not learner_id.isdecimal():
        return 'not_required'
    return support_tickets.close_feedback_ticket(
        ticket_id=str(quality_ticket_id(response.pk)), learner_id=int(learner_id), actor_name=actor_name,
    )
