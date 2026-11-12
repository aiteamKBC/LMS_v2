"""Keep files referenced by submitted attempts, including earlier revisions."""
import json


def _document(value):
    if isinstance(value, str):
        value = json.loads(value)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError('Invalid saved submission.')
    return value


def retained_by_submission(rows, file_id, filename, section_ref):
    """Rows are server-owned submissions for this file's learner, across activities.

    Names preserve older attempts that predate attachment IDs. An ambiguous or
    malformed saved document must not authorize destruction of its evidence.
    """
    for activity_id, status, payload, evidence_names in rows:
        document = _document(payload)
        history = document.get('assignmentAttemptHistory') or []
        if not isinstance(history, list):
            raise ValueError('Invalid saved attempt history.')
        attempts = []
        if status and status != 'draft':
            attempts.append({**document, 'evidenceFiles': document.get('evidenceFiles', evidence_names)})
        for attempt in history:
            attempt = _document(attempt)
            if 'content' not in attempt or not isinstance(attempt.get('status'), str):
                raise ValueError('Invalid saved attempt.')
            if attempt.get('status') != 'draft':
                attempts.append(_document(attempt.get('content')))
        for attempt in attempts:
            monthly = _document(attempt.get('monthlyAssignment'))
            attachments = monthly.get('evidence') or []
            if not isinstance(attachments, list):
                raise ValueError('Invalid saved attachments.')
            presentation = _document(monthly.get('uploadedPresentation'))
            if any(str(_document(item).get('id') or '') == str(file_id)
                   for item in [*attachments, presentation]):
                return True
            names = attempt.get('evidenceFiles') or []
            if isinstance(names, str):
                names = json.loads(names)
            if not isinstance(names, list):
                raise ValueError('Invalid saved evidence names.')
            if str(activity_id) == str(section_ref) and filename in names:
                return True
    return False
