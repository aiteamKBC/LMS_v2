"""Bounded Question Bank reads; quiz content and learner history are unchanged."""
import math
from functools import reduce
from operator import or_

from django.db.models import CharField, Count, F, Func, Q, TextField, Value
from django.db.models.functions import Coalesce, Lower, NullIf, Trim
from django.http import JsonResponse

from .models import QuizPackage, QuizQuestion


QUIZ_FIELDS = ('id', 'title', 'module', 'programme', 'programme_id', 'questions', 'status')
QUESTION_FIELDS = ('id', 'quiz_id', 'question_text', 'question_type', 'image_url',
                   'explanation', 'sort_order')
# Same explanation-text heuristic used by the existing Question Bank badge.
KSB_PATTERN = r'(^|[^a-zA-Z0-9_])ksb([^a-zA-Z0-9_]|$)|knowledge|skill|behaviour|behavior|k[0-9]|s[0-9]|b[0-9]'


def programme_key(quiz):
    return quiz.programme or quiz.programme_id or '__unassigned__'


def positive_int(value, default):
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return default


def question_bank_page(request, programme_options):
    page_size = min(100, positive_int(request.GET.get('pageSize'), 25))
    programme = request.GET.get('programme', 'all').strip()
    search = request.GET.get('search', '').strip()
    question_type = request.GET.get('type', 'all').strip()
    status = request.GET.get('status', 'all').strip()
    base = QuizQuestion.objects.filter(is_archived=False).exclude(quiz__status='trash').annotate(
        bank_programme=Coalesce(NullIf('quiz__programme', Value('')),
            NullIf('quiz__programme_id', Value('')), Value('__unassigned__'), output_field=CharField()),
    )
    if search:
        base = base.filter(question_text__icontains=search)

    programmes = {item['name']: {
        'name': item['name'], 'key': item['name'], 'questionCount': 0, 'quizCount': 0,
        'moduleRows': item.get('moduleRows', item.get('moduleCount', 0)),
        'trainingPlanRows': item.get('trainingPlanRows', 0),
    } for item in programme_options}
    total_questions = 0
    for row in base.order_by().values('bank_programme').annotate(
        question_count=Count('id'), quiz_count=Count('quiz_id', distinct=True),
    ):
        key = row['bank_programme']
        name = 'Unassigned' if key == '__unassigned__' else key
        item = programmes.setdefault(key, {'name': name, 'key': key, 'moduleRows': 0, 'trainingPlanRows': 0})
        item.update(questionCount=row['question_count'], quizCount=row['quiz_count'])
        total_questions += row['question_count']

    filtered = base if programme == 'all' else base.filter(bank_programme=programme)
    statuses = list(filtered.order_by().values_list('quiz__status', flat=True).distinct())
    if question_type != 'all':
        filtered = filtered.filter(question_type=question_type)
    if status != 'all':
        filtered = filtered.filter(quiz__status=status)
    totals = filtered.aggregate(total=Count('id'), tagged=Count('id', filter=Q(explanation__iregex=KSB_PATTERN)))
    total_pages = max(1, math.ceil(totals['total'] / page_size))
    page = min(positive_int(request.GET.get('page'), 1), total_pages)
    start = (page - 1) * page_size
    # A joined QuizPackage also contains uploaded lesson content. Do not copy
    # those large fields into every question or load every answer in the bank.
    questions = list(filtered.select_related('quiz').only(
        *QUESTION_FIELDS, *(f'quiz__{field}' for field in QUIZ_FIELDS),
    ).order_by('quiz__programme_id', 'quiz__module', 'quiz__title', 'sort_order', 'id')
        .prefetch_related('answers')[start:start + page_size])

    def signature(question):
        return (programme_key(question.quiz), question.question_type,
                ' '.join((question.question_text or '').split()).lower(), question.image_url)

    linked = {}
    if questions:
        candidates = base.annotate(normal_text=Lower(Trim(Func(
            F('question_text'), Value(r'\s+'), Value(' '), Value('g'),
            function='REGEXP_REPLACE', output_field=TextField(),
        ))))
        signatures = {signature(question) for question in questions}
        predicate = reduce(or_, (Q(bank_programme=key, question_type=kind, normal_text=text, image_url=image)
                                for key, kind, text, image in signatures))
        for row in candidates.filter(predicate).order_by(
            'quiz__programme_id', 'quiz__module', 'quiz__title', 'quiz_id',
        ).values('bank_programme', 'question_type', 'normal_text', 'image_url',
                 'quiz_id', 'quiz__title', 'quiz__module', 'quiz__status').distinct():
            key = (row['bank_programme'], row['question_type'], row['normal_text'], row['image_url'])
            linked.setdefault(key, {})[row['quiz_id']] = {
                'id': row['quiz_id'], 'title': row['quiz__title'],
                'module': row['quiz__module'], 'status': row['quiz__status'],
            }

    serialized = []
    for question in questions:
        key = programme_key(question.quiz)
        serialized.append({
            'id': question.id, 'text': question.question_text, 'questionType': question.question_type,
            'imageUrl': question.image_url, 'explanation': question.explanation,
            'programme': 'Unassigned' if key == '__unassigned__' else key, 'programmeKey': key,
            'module': question.quiz.module, 'quizId': question.quiz_id,
            'quizTitle': question.quiz.title, 'quizStatus': question.quiz.status,
            'linkedQuizzes': list(linked.get(signature(question), {}).values()),
            'answers': [{'id': answer.id, 'text': answer.answer_text, 'isCorrect': answer.is_correct}
                        for answer in question.answers.all()],
        })

    quizzes = []
    for quiz in QuizPackage.objects.exclude(status='trash').only(*QUIZ_FIELDS).order_by('programme_id', 'title'):
        key = programme_key(quiz)
        quizzes.append({'id': quiz.id, 'title': quiz.title, 'module': quiz.module,
            'programme': 'Unassigned' if key == '__unassigned__' else key, 'programmeKey': key,
            'questions': quiz.questions, 'status': quiz.status})
    return JsonResponse({
        'programmes': sorted(programmes.values(), key=lambda item: (item['name'] == 'Unassigned', item['name'].lower())),
        'questions': serialized, 'quizzes': quizzes, 'totalQuestions': total_questions,
        'statuses': sorted(value for value in statuses if value), 'ksbTaggedCount': totals['tagged'],
        'pagination': {'page': page, 'pageSize': page_size, 'total': totals['total'], 'totalPages': total_pages},
    })
