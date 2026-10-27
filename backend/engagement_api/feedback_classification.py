"""Deterministic score classifications. No AI, writes, notifications or risk cases."""
from collections import defaultdict
from datetime import datetime

from .feedback_insights import BUSINESS_ZONE
from .feedback_scoring import answer_score, has_answer, response_key, score_classification


def _counts():
    return {'positive': 0, 'neutral': 0, 'negative': 0, 'unscored': 0}


def response_classifications(rows, question_answers, completed_responses=()):
    by_question = {row['questionId']: row for row in rows}
    responses = {}

    def remember(response, form):
        # Event/RSVP tokens can serve several forms; they are distinct responses.
        key = (response.form_id, response_key(response))
        if key not in responses:
            responses[key] = {'response': response, 'form': form, 'scores': {}}
        return responses[key]

    for response in completed_responses:
        if response.status == 'completed':
            remember(response, response.form)
    for question, answers in question_answers:
        row = by_question[question.id]
        seen = set()
        for answer in answers:
            if answer.response.status != 'completed':
                continue
            bucket = remember(answer.response, question.section.form)
            key = (answer.response.form_id, response_key(answer.response))
            if not has_answer(answer.answer) or key in seen:
                continue
            seen.add(key)
            score = answer_score(question.question_type, question.config or {}, answer.answer)
            if row['includedInOverall'] and score is not None:
                bucket['scores'].setdefault(question.id, (score, row['weight']))

    totals = _counts()
    by_type, by_month, records = defaultdict(_counts), defaultdict(_counts), []
    for bucket in responses.values():
        response, form, values = bucket['response'], bucket['form'], list(bucket['scores'].values())
        weight = sum(value[1] for value in values)
        score = sum(value * importance for value, importance in values) / weight if weight else None
        classification = score_classification(score)
        kind = getattr(form, 'form_type', 'general')
        totals[classification] += 1
        by_type[kind][classification] += 1
        submitted = getattr(response, 'submitted_at', None)
        if isinstance(submitted, datetime) and submitted.tzinfo is not None:
            by_month[submitted.astimezone(BUSINESS_ZONE).strftime('%Y-%m')][classification] += 1
        identifier = getattr(response, 'id', None)
        if identifier is not None:
            delivery = getattr(response, 'delivery', None)
            records.append({
                'responseId': identifier, 'formId': response.form_id, 'formTitle': form.title,
                'formType': kind, 'version': form.version,
                'respondent': 'Anonymous learner' if getattr(form, 'anonymous_responses', False) else getattr(response, 'learner_name', ''),
                'score': round(score, 2) if score is not None else None, 'classification': classification,
                'scoredQuestions': len(values), 'submittedAt': submitted.isoformat() if submitted else None,
                'contextTitle': (getattr(delivery, 'session_title', '') or getattr(delivery, 'module_name', '') or form.title),
                'groupName': getattr(delivery if delivery is not None else form, 'group_name', ''),
                '_submittedOrder': submitted.timestamp() if isinstance(submitted, datetime) and submitted.tzinfo is not None else float('-inf'),
            })
    records.sort(key=lambda item: (item['_submittedOrder'], item['responseId']), reverse=True)
    for record in records:
        record.pop('_submittedOrder')
    return {
        'total': sum(totals.values()), **totals,
        'byType': [{'formType': kind, **counts} for kind, counts in sorted(by_type.items())],
        'trend': [{'month': month, **counts} for month, counts in sorted(by_month.items())],
        'responses': records,
    }
