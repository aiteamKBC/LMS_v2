"""Read original quiz content and one saved attempt without changing progress."""
import json

from django.db import connections
from old_otjh import repository
from . import canonical_learning
from .subject_content import public_quiz, quiz_definition
from .subject_quiz import imported_quiz


def read_review(owner, group_id, quiz_id):
    # Reuse the learner catalogue's membership, exclusion and completion rules.
    # Numeric quiz IDs alone are not unique across courses or component kinds.
    catalogue = canonical_learning.source_subjects(owner['enrolment_id'],
        lambda items: {'activities': items}, owner=owner)
    matches = [item for item in catalogue['activities']
        if str(item.get('group_id')) == str(group_id)
        and str(item.get('source_activity_id')) == str(quiz_id)
        and item.get('catalogue_kind') == 'quiz' and item.get('completed') is True]
    if len(matches) != 1:
        raise canonical_learning.ServiceError('Completed quiz not found.', 'not_found', 404)

    with connections[repository._query_alias.get() or repository.DB].cursor() as cursor:
        original = imported_quiz(cursor, group_id, quiz_id, for_review=True)
    attempts = repository.query('''SELECT history.quiz_score AS score,
            history.quiz_maximum_score AS maximum_score, history.quiz_passed AS passed,
            history.quiz_attempt_number AS attempt_number, history.status,
            history.quiz_answers AS answers
        FROM "Learner".learner_external_identities identity
        JOIN "Last_audit".activity_results history
          ON history.learner_id::text=identity.source_learner_id
        WHERE identity.learner_id=%s AND identity.source_system='old_lms'
          AND identity.deleted_at IS NULL AND history.group_id=%s AND history.activity_id=%s
        ORDER BY history.quiz_score / nullif(history.quiz_maximum_score,0) DESC NULLS LAST,
                 (history.quiz_answers IS NOT NULL AND history.quiz_answers<>'[]'::jsonb) DESC,
                 history.quiz_attempt_number DESC NULLS LAST, identity.id
        LIMIT 1''', [owner['id'], group_id, quiz_id])
    # Score, status and answers always belong to the same retained attempt.
    attempt = attempts[0] if attempts else {}
    answers = attempt.get('answers')
    if answers is None:
        answers = []
    if isinstance(answers, str):
        try:
            answers = json.loads(answers)
        except ValueError:
            answers = None
    if not isinstance(answers, list) or any(not isinstance(answer, dict) for answer in answers):
        raise canonical_learning.ServiceError(
            'The saved quiz answers need review.', 'quiz_history_invalid', 409)
    historical = {key: attempt.get(key)
        for key in ('score', 'maximum_score', 'passed', 'attempt_number', 'status')}
    historical['answers'] = [{key: answer.get(key) for key in
        ('question_id', 'question_body', 'learner_answer', 'is_correct')} for answer in answers]
    quiz = public_quiz(quiz_definition(original)) if original else None
    return {'title': matches[0].get('activity') or '', 'reading_html': '', 'media': [],
        'has_reading': False, 'source_live': False, 'quiz': quiz,
        'available': bool(quiz or answers or historical['score'] is not None),
        'completed': True, 'can_attempt': False, 'persistence_ready': False,
        'csrf_token': '', 'history': [], 'historical': historical}
