"""Pure, reporting-only summaries of saved feedback answers. No I/O or writes."""
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from math import isfinite
from zoneinfo import ZoneInfo

from .feedback_scoring import answer_score, has_answer, overall_metrics, response_key


BUSINESS_ZONE = ZoneInfo('Europe/London')


def submission_period(start, end):
    """Inclusive UK calendar dates represented by an exclusive next-day boundary."""
    def parse(value):
        if not value:
            return None
        if len(value) != 10:
            raise ValueError('Use YYYY-MM-DD for submission dates.')
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError('Use YYYY-MM-DD for submission dates.')
        return parsed
    try:
        first, last = parse(start), parse(end)
        if first and last and first > last:
            raise ValueError('Submission start date must not be after the end date.')
        return {**({'submitted_from': datetime.combine(first, time.min, BUSINESS_ZONE)} if first else {}),
                **({'submitted_until': datetime.combine(last + timedelta(days=1), time.min, BUSINESS_ZONE)} if last else {})}
    except (ValueError, OverflowError) as error:
        raise ValueError('Enter a valid submission date range (YYYY-MM-DD).') from error


def answer_in_period(answer, submitted_from=None, submitted_until=None):
    if submitted_from is None and submitted_until is None:
        return True
    moment = getattr(answer.response, 'submitted_at', None)
    return (isinstance(moment, datetime) and moment.tzinfo is not None
            and (submitted_from is None or moment >= submitted_from)
            and (submitted_until is None or moment < submitted_until))


def report_insights(rows, question_answers):
    categories = defaultdict(list)
    for row in rows:
        categories[(row['formId'], row['version'], row['category'])].append(row)
    category_scores = []
    for (form_id, version, category), members in categories.items():
        category_scores.append({
            'formId': form_id, 'formTitle': members[0]['formTitle'], 'version': version,
            'category': category, **overall_metrics(members),
            'scoredAnswers': sum(row['scoredResponses'] for row in members if row['includedInOverall']),
        })
    by_id = {row['questionId']: row for row in rows}
    stars = Counter()
    months = defaultdict(lambda: defaultdict(list))
    undated = 0
    for question, answers in question_answers:
        row = by_id[question.id]
        config = question.config or {}
        star_question = (question.question_type == 'rating' and config.get('display') == 'stars'
                         and config.get('min', 1) == 1 and config.get('max', 5) == 5)
        seen = set()
        for answer in answers:
            key = response_key(answer.response)
            if answer.response.status != 'completed' or not has_answer(answer.answer) or key in seen:
                continue
            seen.add(key)
            value = answer.answer
            if star_question and type(value) in (int, float) and isfinite(value) and value in (1, 2, 3, 4, 5):
                stars[int(value)] += 1
            score = answer_score(question.question_type, config, value)
            if score is None or not row['includedInOverall']:
                continue
            moment = getattr(answer.response, 'submitted_at', None)
            if not isinstance(moment, datetime) or moment.tzinfo is None:
                undated += 1
                continue
            months[moment.astimezone(BUSINESS_ZONE).strftime('%Y-%m')][question.id].append(score)
    trend = []
    for month, questions in sorted(months.items()):
        members = [{**by_id[identifier], '_score': sum(values) / len(values)}
                   for identifier, values in questions.items()]
        trend.append({'month': month, **overall_metrics(members),
                      'scoredAnswers': sum(map(len, questions.values()))})
    count = sum(stars.values())
    return {
        'stars': {'average': round(sum(value * number for value, number in stars.items()) / count, 2) if count else None,
                  'answers': count, 'distribution': [{'stars': value, 'count': stars[value]} for value in range(1, 6)]},
        'categories': category_scores, 'trend': trend, 'undatedScoredAnswers': undated,
    }
