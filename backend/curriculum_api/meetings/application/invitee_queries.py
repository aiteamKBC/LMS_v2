"""Construct invitation suggestions from normalized assignment sources."""


def module_invitee_payload(module_catalogue_id, *, read_sources, clean_str):
    tutor_email, plan_emails, mirror_emails = read_sources(module_catalogue_id)
    # First spelling wins across normalized sources, independently of email case.
    attendees = {}
    for email in (*plan_emails, *mirror_emails):
        email = clean_str(email)
        if email and email.lower() not in attendees:
            attendees[email.lower()] = email
    return {
        'moduleCatalogueId': module_catalogue_id,
        'presenters': [tutor_email] if tutor_email else [],
        'attendees': sorted(attendees.values(), key=str.casefold),
    }
