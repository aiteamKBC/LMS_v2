"""Reporting-only question scoring. Never selects questions or changes delivery dates."""
from collections import Counter
from math import isfinite


IMPORTANCE_WEIGHTS = {'critical': 4, 'high': 3, 'medium': 2, 'low': 1}
OPTION_TYPES = {'yes_no', 'single_choice', 'dropdown', 'likert', 'multiple_choice'}
SCORABLE_TYPES = {'rating', 'number', *OPTION_TYPES}
POSITIVE_SCORE_MIN = 75
NEUTRAL_SCORE_MIN = 50


def analytics_settings(kind, config):
    raw = config.get('analytics') or {}
    settings = {
        'importance': raw.get('importance', 'medium'),
        'scoring': raw.get('scoring', 'higher' if kind == 'rating' else 'none'),
        'includeInOverall': raw.get('includeInOverall', True),
        'optionScores': raw.get('optionScores', {}),
    }
    if kind == 'number':
        settings.update(scoreMin=raw.get('scoreMin'), scoreMax=raw.get('scoreMax'))
    return settings


def validate_analytics_settings(kind, config, *, require_complete=False):
    """Validate only the additive settings; old question configuration stays intact."""
    if 'analytics' not in config and not require_complete:
        return
    raw = config.get('analytics', {})
    if not isinstance(raw, dict):
        raise ValueError('Analytics settings must be an object.')
    settings = analytics_settings(kind, config)
    if not isinstance(settings['importance'], str) or settings['importance'] not in IMPORTANCE_WEIGHTS:
        raise ValueError('Importance must be Critical, High, Medium or Low.')
    if type(settings['includeInOverall']) is not bool:
        raise ValueError('Include in Overall Score must be true or false.')
    allowed = {'none'}
    if kind in {'rating', 'number'}:
        allowed |= {'higher', 'lower'}
    elif kind in OPTION_TYPES:
        allowed.add('options')
    if not isinstance(settings['scoring'], str) or settings['scoring'] not in allowed:
        raise ValueError('This scoring method is not supported for this question type.')
    if require_complete and kind in SCORABLE_TYPES and settings['scoring'] == 'none':
        raise ValueError('Scoring is required for this question before publishing.')
    scores = settings['optionScores']
    if not isinstance(scores, dict):
        raise ValueError('Answer scores must be an object.')
    options = ['yes', 'no'] if kind == 'yes_no' else config.get('options', [])
    if not isinstance(options, list):
        raise ValueError('Answer options must be a list.')
    if any(key not in options or type(value) not in (int, float)
           or not isfinite(value) or not 0 <= value <= 100 for key, value in scores.items()):
        raise ValueError('Each answer score must match an option and be between 0 and 100.')
    if require_complete and settings['scoring'] == 'options':
        if (len(options) < 2 or any(not isinstance(option, str) or not option.strip() for option in options)
                or len(set(options)) != len(options) or set(scores) != set(options)):
            raise ValueError('Give every distinct answer option a score from 0 to 100.')
    if kind == 'number' and settings['scoring'] in {'higher', 'lower'}:
        minimum, maximum = settings['scoreMin'], settings['scoreMax']
        if any(value is not None and (type(value) not in (int, float) or not isfinite(value)) for value in (minimum, maximum)):
            raise ValueError('Number scoring requires finite minimum and maximum values.')
        if ((require_complete and (minimum is None or maximum is None))
                or (minimum is not None and maximum is not None and maximum <= minimum)):
            raise ValueError('Number scoring requires finite minimum and maximum values, with maximum greater than minimum.')
    if require_complete and kind == 'rating':
        minimum, maximum = config.get('min', 1), config.get('max', 5)
        if any(type(value) not in (int, float) or not isfinite(value) for value in (minimum, maximum)) or maximum <= minimum:
            raise ValueError('Rating scoring requires a valid increasing scale.')


def has_answer(value):
    if value is None or value == '' or value == []:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return any(has_answer(item) for item in value.values())
    return True  # False and zero are real answers.


def answer_score(kind, config, value):
    settings = analytics_settings(kind, config)
    if kind == 'rating' and settings['scoring'] in {'higher', 'lower'}:
        minimum, maximum = config.get('min', 1), config.get('max', 5)
        if (type(value) not in (int, float) or not isfinite(value)
                or type(minimum) not in (int, float) or type(maximum) not in (int, float)
                or not isfinite(minimum) or not isfinite(maximum)
                or maximum <= minimum or not minimum <= value <= maximum):
            return None
        score = (value - minimum) / (maximum - minimum) * 100
        return 100 - score if settings['scoring'] == 'lower' else score
    if kind == 'number' and settings['scoring'] in {'higher', 'lower'}:
        minimum, maximum = settings['scoreMin'], settings['scoreMax']
        if any(type(item) not in (int, float) or not isfinite(item) for item in (value, minimum, maximum)) or maximum <= minimum:
            return None
        score = max(0, min(100, (value - minimum) / (maximum - minimum) * 100))
        return 100 - score if settings['scoring'] == 'lower' else score
    if kind in OPTION_TYPES and settings['scoring'] == 'options':
        if kind == 'multiple_choice':
            if not isinstance(value, list) or not value or any(not isinstance(item, str) for item in value):
                return None
            selected = list(dict.fromkeys(value))
            scores = [settings['optionScores'].get(item) for item in selected]
            if any(type(item) not in (int, float) or not isfinite(item) or not 0 <= item <= 100 for item in scores):
                return None
            return sum(scores) / len(scores)
        key = ('yes' if value else 'no') if kind == 'yes_no' and type(value) is bool else value
        score = settings['optionScores'].get(key) if isinstance(key, str) else None
        return score if type(score) in (int, float) and isfinite(score) and 0 <= score <= 100 else None
    return None


def score_classification(score):
    if type(score) not in (int, float) or not isfinite(score) or not 0 <= score <= 100:
        return 'unscored'
    return 'positive' if score >= POSITIVE_SCORE_MIN else 'neutral' if score >= NEUTRAL_SCORE_MIN else 'negative'


def response_key(response):
    if response.delivery_id is not None:
        return ('delivery', response.delivery_id, str(response.learner_id))
    for field, source in [('event_recipient_id', 'event'), ('rsvp_recipient_id', 'rsvp'), ('review_delivery_id', 'review')]:
        identifier = getattr(response, field, None)
        if identifier is not None:
            return (source, identifier)
    return ('manual', response.form_id, str(response.learner_id))


def question_metrics(question, opportunities, *, denominator_known=True, answers=None):
    """One row per immutable question/version; missing answers never score zero."""
    kind, config = question.question_type, question.config or {}
    settings = analytics_settings(kind, config)
    opportunities = set(opportunities)
    answered, scores, values = set(), [], []
    classification = {'positive': 0, 'neutral': 0, 'negative': 0, 'unscored': 0}
    # Include historical submitted recipients, even if their assignment was later revoked.
    for answer in question.submitted_answers if answers is None else answers:
        if answer.response.status != 'completed':
            continue
        key = response_key(answer.response)
        opportunities.add(key)
        if not has_answer(answer.answer) or key in answered:
            continue
        answered.add(key)
        values.append(answer.answer)
        score = answer_score(kind, config, answer.answer)
        classification[score_classification(score)] += 1
        if score is not None:
            scores.append(score)
    score = sum(scores) / len(scores) if scores else None
    can_score = (kind in {'rating', 'number'} and settings['scoring'] in {'higher', 'lower'}
                 or kind in OPTION_TYPES and settings['scoring'] == 'options')
    distribution = Counter()
    if kind == 'rating':
        for value in values:
            if type(value) in (int, float) and isfinite(value):
                distribution[str(value)] += 1
    elif kind == 'yes_no':
        for value in values:
            if type(value) is bool:
                distribution['Yes' if value else 'No'] += 1
    elif kind in {'single_choice', 'dropdown', 'likert', 'multiple_choice'}:
        for value in values:
            for option in dict.fromkeys(value if isinstance(value, list) else [value]):
                if isinstance(option, str):
                    distribution[option] += 1
    rating_values = [value for value in values if kind == 'rating'
                     and type(value) in (int, float) and isfinite(value)]
    status = ('no_data' if not answered else 'not_scored' if not can_score else 'no_data' if score is None
              else 'good' if score >= POSITIVE_SCORE_MIN else 'watch' if score >= NEUTRAL_SCORE_MIN else 'needs_attention')
    return {
        'questionId': question.id, 'question': question.question_text, 'type': kind,
        'formId': question.section.form_id, 'formTitle': question.section.form.title,
        'version': question.section.form.version, 'category': question.section.title,
        'importance': settings['importance'], 'weight': IMPORTANCE_WEIGHTS[settings['importance']],
        'includedInOverall': bool(can_score and settings['includeInOverall']),
        'assignedCount': len(opportunities) if denominator_known else None,
        'answeredCount': len(answered),
        'answerRate': round(len(answered) / len(opportunities) * 100, 1) if denominator_known and opportunities else None,
        'score': round(score, 2) if score is not None else None,
        'scoredResponses': len(scores), 'status': status,
        'averageRating': round(sum(rating_values) / len(rating_values), 2) if rating_values else None,
        'scaleMax': config.get('max', 5) if kind == 'rating' else None,
        'distribution': [{'label': label, 'count': count} for label, count in distribution.items()],
        'classification': classification,
        # Unrounded value is used only while aggregating, not exposed by the API.
        '_score': score,
    }


def overall_metrics(rows):
    included = [row for row in rows if row['includedInOverall']]
    scored = [row for row in included if row['_score'] is not None]
    weight = sum(row['weight'] for row in scored)
    return {
        'score': round(sum(row['_score'] * row['weight'] for row in scored) / weight, 2) if weight else None,
        'scoredQuestions': len(scored), 'includedQuestions': len(included),
    }
