"""Reusable feedback-form HTTP API.

The route happens to be mounted by engagement_api, while form validation,
assignment and response ownership are kept independent from any frontend page.
Structural edits are locked as soon as a response exists so historical answers
always retain the question wording and configuration they were submitted for.
"""
from __future__ import annotations

from copy import deepcopy
from io import BytesIO
import logging
from pathlib import PurePath
import uuid

from azure.core.exceptions import AzureError, ResourceExistsError
from azure.storage.blob import ContentSettings
from django.conf import settings
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.db import DatabaseError, connection, transaction
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.middleware.csrf import get_token

from learner_api.models import EnrolmentUser
from learner_api import evidence_storage
from learner_api.profile_photo import normalize_photo

from .helpers import json_body, json_error
from .models import (
    FeedbackAnswer, FeedbackAssignment, FeedbackForm, FeedbackQuestion,
    FeedbackResponse, FeedbackSection, FeedbackUpload,
)
from .permissions import actor_name, require_learner_identity, require_self_or_staff, require_staff

QUESTION_TYPES = {
    'short_text', 'long_text', 'yes_no', 'single_choice', 'multiple_choice',
    'dropdown', 'rating', 'likert', 'number', 'date',
    'name', 'email', 'photo_upload',
}
CHOICE_TYPES = {'single_choice', 'multiple_choice', 'dropdown', 'likert'}
FORM_TYPES = {'general', 'post_lecture'}
EMPTY_ANSWERS = (None, '', [])
logger = logging.getLogger(__name__)


class CurriculumScopeUnavailable(RuntimeError):
    pass


def csrf_token(request):
    """Issue a same-origin CSRF token for staff and learner feedback writes."""
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    return JsonResponse({'csrfToken': get_token(request)})


def _dt(value):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        raise ValueError('Dates must be ISO-8601 date/time values.')
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _iso(value):
    return value.isoformat() if value else None


def _question_dict(question):
    return {
        'id': question.id, 'type': question.question_type,
        'text': question.question_text, 'required': question.required,
        'helpText': question.help_text, 'config': question.config or {},
        'sortOrder': question.sort_order,
    }


def _section_dict(section):
    return {
        'id': section.id, 'title': section.title, 'description': section.description,
        'sortOrder': section.sort_order,
        'questions': [_question_dict(q) for q in section.questions.all()],
    }


def _assigned_count(form):
    assignments = list(form.assignments.all())
    if any(a.target_type == 'all_learners' for a in assignments):
        return EnrolmentUser.all_learners.count()
    return len({a.target_id for a in assignments if a.target_type == 'learner'})


def form_dict(form, *, include_structure=False):
    responses = list(form.responses.all())
    completed = sum(r.status == 'completed' for r in responses)
    data = {
        'id': form.id, 'title': form.title, 'formType': form.form_type,
        'description': form.description,
        'instructions': form.instructions, 'status': form.status,
        'curriculumScope': {
            'programmeId': form.programme_id, 'programmeName': form.programme_name,
            'cohortId': form.cohort_id, 'cohortName': form.cohort_name,
            'groupId': form.group_id, 'groupName': form.group_name,
            'moduleCatalogueId': form.module_catalogue_id, 'moduleName': form.module_name,
        },
        'startDate': _iso(form.start_date), 'dueDate': _iso(form.due_date),
        'anonymousResponses': form.anonymous_responses,
        'allowSaveContinue': form.allow_save_continue,
        'allowEditAfterSubmission': form.allow_edit_after_submission,
        'createdBy': form.created_by, 'createdAt': _iso(form.created_at),
        'updatedAt': _iso(form.updated_at), 'publishedAt': _iso(form.published_at),
        'assignedCount': _assigned_count(form), 'responseCount': completed,
        'startedCount': len(responses), 'structureLocked': bool(responses),
    }
    if include_structure:
        data['sections'] = [_section_dict(s) for s in form.sections.all()]
    return data


def _forms_queryset():
    return FeedbackForm.objects.prefetch_related(
        'assignments', 'responses', 'sections__questions',
    ).order_by('-updated_at')


def _clean(value):
    return str(value or '').strip()


def _same_identifier(left, right):
    return _clean(left).casefold() == _clean(right).casefold()


def _curriculum_scope_changed(form, payload):
    fields = {
        'formType': form.form_type,
        'programmeId': form.programme_id,
        'cohortId': form.cohort_id,
        'groupId': form.group_id,
        'moduleCatalogueId': form.module_catalogue_id,
    }
    return any(key in payload and not _same_identifier(payload[key], current) for key, current in fields.items())


def _curriculum_scope_options():
    """Return the active curriculum hierarchy without building the full bundle.

    The curriculum overview also calculates reporting, learner, KSB and session
    data. Feedback only needs four identifiers and labels, so using that payload
    here made this small dropdown request wait for unrelated curriculum work.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute('''
                select
                    p.programme_id,
                    p.name,
                    c.cohort_id,
                    c.cohort_name,
                    g.group_id,
                    g.group_name,
                    m.module_catalogue_id,
                    m.title
                from "curriculum"."modules" m
                inner join "curriculum"."groups" g
                    on g.group_id = m.group_id
                inner join "curriculum"."cohorts" c
                    on c.cohort_id = g.cohort_id
                inner join "curriculum"."programmes" p
                    on p.programme_id = c.programme_id
                where p.deleted_at is null
                  and c.deleted_at is null
                  and g.deleted_at is null
                  and m.deleted_at is null
                  and coalesce(p.is_archived, false) = false
                  and coalesce(g.is_programme_deleted, false) = false
                  and coalesce(m.is_programme_deleted, false) = false
                  and lower(coalesce(p.status, 'active')) <> 'archived'
                  and lower(coalesce(c.status, 'active')) <> 'archived'
                order by p.name, c.cohort_name, g.group_name, m.title
            ''')
            rows = cursor.fetchall()
    except DatabaseError as exc:
        raise CurriculumScopeUnavailable from exc

    options = {'programmes': [], 'cohorts': [], 'groups': [], 'modules': []}
    seen = {key: set() for key in options}
    for programme_id, programme_name, cohort_id, cohort_name, group_id, group_name, module_id, module_name in rows:
        programme_id, cohort_id = _clean(programme_id), _clean(cohort_id)
        group_id, module_id = _clean(group_id), _clean(module_id)
        if not all((programme_id, cohort_id, group_id, module_id)):
            continue
        keys = {
            'programmes': programme_id.casefold(),
            'cohorts': cohort_id.casefold(),
            'groups': group_id.casefold(),
            'modules': (group_id.casefold(), module_id.casefold()),
        }
        values = {
            'programmes': {'id': programme_id, 'name': _clean(programme_name)},
            'cohorts': {'id': cohort_id, 'name': _clean(cohort_name), 'programmeId': programme_id},
            'groups': {
                'id': group_id, 'name': _clean(group_name),
                'programmeId': programme_id, 'cohortId': cohort_id,
            },
            'modules': {
                'id': module_id, 'name': _clean(module_name), 'programmeId': programme_id,
                'cohortId': cohort_id, 'groupId': group_id,
            },
        }
        for kind in options:
            if keys[kind] not in seen[kind]:
                seen[kind].add(keys[kind])
                options[kind].append(values[kind])
    return options


def _apply_curriculum_scope(form, payload):
    requested_type = _clean(payload.get('formType', form.form_type or 'general'))
    if requested_type not in FORM_TYPES:
        raise ValueError('Unsupported feedback form type.')
    form.form_type = requested_type
    if requested_type == 'general':
        for field in (
            'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
            'group_id', 'group_name', 'module_catalogue_id', 'module_name',
        ):
            setattr(form, field, '')
        return

    scope_changed = form.pk is None or _curriculum_scope_changed(form, payload)
    if not scope_changed:
        return
    selected = {
        'programmeId': _clean(payload.get('programmeId')),
        'cohortId': _clean(payload.get('cohortId')),
        'groupId': _clean(payload.get('groupId')),
        'moduleCatalogueId': _clean(payload.get('moduleCatalogueId')),
    }
    if not all(selected.values()):
        raise ValueError('Choose a programme, cohort, group, and module for post-lecture feedback.')
    options = _curriculum_scope_options()
    programme = next((item for item in options['programmes'] if _same_identifier(item['id'], selected['programmeId'])), None)
    cohort = next((item for item in options['cohorts'] if _same_identifier(item['id'], selected['cohortId']) and _same_identifier(item['programmeId'], selected['programmeId'])), None)
    group = next((item for item in options['groups'] if _same_identifier(item['id'], selected['groupId']) and _same_identifier(item['cohortId'], selected['cohortId'])), None)
    module = next((item for item in options['modules'] if _same_identifier(item['id'], selected['moduleCatalogueId']) and _same_identifier(item['groupId'], selected['groupId'])), None)
    if not all((programme, cohort, group, module)):
        raise ValueError('The selected curriculum hierarchy is no longer valid. Refresh the options and try again.')
    form.programme_id, form.programme_name = programme['id'], programme['name']
    form.cohort_id, form.cohort_name = cohort['id'], cohort['name']
    form.group_id, form.group_name = group['id'], group['name']
    form.module_catalogue_id, form.module_name = module['id'], module['name']


@require_staff
def curriculum_scope_options(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    try:
        return JsonResponse(_curriculum_scope_options())
    except CurriculumScopeUnavailable:
        return json_error('Curriculum options are temporarily unavailable.', status=503)


def _validated_sections(raw_sections):
    if not isinstance(raw_sections, list) or not raw_sections:
        raise ValueError('Add at least one section.')
    cleaned = []
    for section_index, raw_section in enumerate(raw_sections):
        title = str(raw_section.get('title') or '').strip()
        if not title:
            raise ValueError(f'Section {section_index + 1} needs a title.')
        questions = raw_section.get('questions')
        if not isinstance(questions, list):
            raise ValueError(f'{title} must contain a questions list.')
        clean_questions = []
        for question_index, raw_question in enumerate(questions):
            kind = str(raw_question.get('type') or '').strip()
            text = str(raw_question.get('text') or '').strip()
            config = raw_question.get('config') or {}
            if kind not in QUESTION_TYPES:
                raise ValueError(f'Question {question_index + 1} has an unsupported type.')
            if not text:
                raise ValueError(f'Question {question_index + 1} in {title} needs text.')
            if not isinstance(config, dict):
                raise ValueError(f'Question {question_index + 1} has invalid configuration.')
            if kind in CHOICE_TYPES:
                options = config.get('options')
                if not isinstance(options, list) or len([x for x in options if str(x).strip()]) < 2:
                    raise ValueError(f'Question "{text}" needs at least two options.')
                config['options'] = [str(x).strip() for x in options if str(x).strip()]
            if kind == 'rating':
                maximum = int(config.get('max', 5))
                if maximum not in (5, 10):
                    raise ValueError('Rating scales must be 1–5 or 1–10.')
                config = {**config, 'min': 1, 'max': maximum}
            clean_questions.append({
                'type': kind, 'text': text, 'required': bool(raw_question.get('required')),
                'helpText': str(raw_question.get('helpText') or '').strip(), 'config': config,
            })
        cleaned.append({
            'title': title, 'description': str(raw_section.get('description') or '').strip(),
            'questions': clean_questions,
        })
    return cleaned


def _replace_structure(form, raw_sections):
    sections = _validated_sections(raw_sections)
    form.sections.all().delete()
    for section_index, section_data in enumerate(sections):
        section = FeedbackSection.objects.create(
            form=form, title=section_data['title'], description=section_data['description'],
            sort_order=section_index,
        )
        FeedbackQuestion.objects.bulk_create([
            FeedbackQuestion(
                section=section, question_type=q['type'], question_text=q['text'],
                required=q['required'], help_text=q['helpText'], config=q['config'],
                sort_order=question_index,
            )
            for question_index, q in enumerate(section_data['questions'])
        ])


def _apply_metadata(form, payload):
    title = str(payload.get('title', form.title) or '').strip()
    if not title:
        raise ValueError('Form name is required.')
    form.title = title
    form.description = str(payload.get('description', form.description) or '').strip()
    form.instructions = str(payload.get('instructions', form.instructions) or '').strip()
    _apply_curriculum_scope(form, payload)
    if 'startDate' in payload:
        form.start_date = _dt(payload.get('startDate'))
    if 'dueDate' in payload:
        form.due_date = _dt(payload.get('dueDate'))
    if form.start_date and form.due_date and form.due_date < form.start_date:
        raise ValueError('Due date must be after the start date.')
    if 'anonymousResponses' in payload:
        form.anonymous_responses = bool(payload['anonymousResponses'])
    if 'allowSaveContinue' in payload:
        form.allow_save_continue = bool(payload['allowSaveContinue'])
    if 'allowEditAfterSubmission' in payload:
        form.allow_edit_after_submission = bool(payload['allowEditAfterSubmission'])


@require_staff
def forms_collection(request):
    if request.method == 'GET':
        forms = list(_forms_queryset())
        return JsonResponse({
            'forms': [form_dict(f) for f in forms],
            'summary': {
                'totalForms': len(forms),
                'publishedForms': sum(f.status == 'published' for f in forms),
                'draftForms': sum(f.status == 'draft' for f in forms),
                'totalResponses': sum(sum(r.status == 'completed' for r in f.responses.all()) for f in forms),
            },
        })
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        with transaction.atomic():
            form = FeedbackForm(created_by=actor_name(request) or 'Staff')
            _apply_metadata(form, payload)
            form.save()
            _replace_structure(form, payload.get('sections') or [{'title': 'Section 1', 'questions': []}])
        form = _forms_queryset().get(pk=form.pk)
        return JsonResponse({'form': form_dict(form, include_structure=True)}, status=201)
    except ValueError as exc:
        return json_error(str(exc))
    except CurriculumScopeUnavailable:
        return json_error('Curriculum options are temporarily unavailable.', status=503)


@require_staff
def form_detail(request, pk):
    try:
        form = _forms_queryset().get(pk=pk)
    except FeedbackForm.DoesNotExist:
        return json_error('Feedback form not found.', status=404)
    if request.method == 'GET':
        return JsonResponse({'form': form_dict(form, include_structure=True)})
    if request.method == 'DELETE':
        if form.responses.exists():
            return json_error('Forms with responses cannot be deleted. Close the form instead.', status=409)
        form.delete()
        return JsonResponse({'ok': True})
    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if 'sections' in payload and form.responses.exists():
        return json_error('Form structure is locked because a learner has started responding.', status=409)
    if _curriculum_scope_changed(form, payload) and form.responses.exists():
        return json_error('The form type and curriculum scope are locked because a learner has started responding.', status=409)
    try:
        with transaction.atomic():
            _apply_metadata(form, payload)
            form.save()
            if 'sections' in payload:
                _replace_structure(form, payload['sections'])
        form = _forms_queryset().get(pk=pk)
        return JsonResponse({'form': form_dict(form, include_structure=True)})
    except ValueError as exc:
        return json_error(str(exc))
    except CurriculumScopeUnavailable:
        return json_error('Curriculum options are temporarily unavailable.', status=503)


@require_staff
def form_status(request, pk):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    try:
        form = _forms_queryset().get(pk=pk)
    except FeedbackForm.DoesNotExist:
        return json_error('Feedback form not found.', status=404)
    payload = json_body(request) or {}
    status = payload.get('status')
    if status not in {'draft', 'published', 'closed'}:
        return json_error('Invalid form status.')
    if status == 'published':
        if not form.sections.exists() or not FeedbackQuestion.objects.filter(section__form=form).exists():
            return json_error('Add at least one question before publishing.')
        form.published_at = form.published_at or timezone.now()
    elif status == 'draft' and form.responses.exists():
        return json_error('A form with responses cannot be returned to draft. Close it instead.', status=409)
    form.status = status
    form.save(update_fields=['status', 'published_at', 'updated_at'])
    return JsonResponse({'form': form_dict(form, include_structure=True)})


@require_staff
def form_duplicate(request, pk):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    try:
        source = _forms_queryset().get(pk=pk)
    except FeedbackForm.DoesNotExist:
        return json_error('Feedback form not found.', status=404)
    payload = {
        'title': f'{source.title} (Copy)', 'description': source.description,
        'formType': source.form_type,
        'programmeId': source.programme_id, 'cohortId': source.cohort_id,
        'groupId': source.group_id, 'moduleCatalogueId': source.module_catalogue_id,
        'instructions': source.instructions, 'anonymousResponses': source.anonymous_responses,
        'allowSaveContinue': source.allow_save_continue,
        'allowEditAfterSubmission': source.allow_edit_after_submission,
        'sections': [
            {'title': s.title, 'description': s.description, 'questions': [
                {'type': q.question_type, 'text': q.question_text, 'required': q.required,
                 'helpText': q.help_text, 'config': deepcopy(q.config or {})}
                for q in s.questions.all()
            ]} for s in source.sections.all()
        ],
    }
    try:
        with transaction.atomic():
            duplicate = FeedbackForm(created_by=actor_name(request) or 'Staff')
            _apply_metadata(duplicate, payload)
            duplicate.save()
            _replace_structure(duplicate, payload['sections'])
    except (ValueError, CurriculumScopeUnavailable) as exc:
        message = 'Curriculum options are temporarily unavailable.' if isinstance(exc, CurriculumScopeUnavailable) else str(exc)
        return json_error(message, status=503 if isinstance(exc, CurriculumScopeUnavailable) else 400)
    duplicate = _forms_queryset().get(pk=duplicate.pk)
    return JsonResponse({'form': form_dict(duplicate, include_structure=True)}, status=201)


@require_staff
def learner_options(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    search = (request.GET.get('search') or '').strip()
    learners = EnrolmentUser.all_learners.all().order_by('username')
    if search:
        learners = learners.filter(Q(username__icontains=search) | Q(email__icontains=search))
    return JsonResponse({'learners': [
        {'id': str(l.id), 'name': l.username or l.email or f'Learner {l.id}',
         'email': l.email or '', 'programme': l.programme or '', 'cohort': l.cohort or ''}
        for l in learners[:100]
    ]})


@require_staff
def form_assignments(request, pk):
    try:
        form = FeedbackForm.objects.prefetch_related('assignments').get(pk=pk)
    except FeedbackForm.DoesNotExist:
        return json_error('Feedback form not found.', status=404)
    if request.method == 'GET':
        return JsonResponse({'assignments': [assignment_dict(a) for a in form.assignments.all()]})
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    if form.status != 'published':
        return json_error('Only published forms can be assigned.', status=409)
    payload = json_body(request) or {}
    target_type = payload.get('targetType')
    target_ids = payload.get('targetIds') or []
    if target_type == 'all_learners':
        target_ids = [None]
    elif target_type == 'learner':
        if not isinstance(target_ids, list) or not target_ids:
            return json_error('Select at least one learner.')
        existing = set(str(x) for x in EnrolmentUser.all_learners.filter(id__in=target_ids).values_list('id', flat=True))
        if existing != {str(x) for x in target_ids}:
            return json_error('One or more learner IDs are invalid.')
    else:
        return json_error('Unsupported assignment target type.')
    try:
        due_date = _dt(payload.get('dueDate')) if 'dueDate' in payload else form.due_date
    except ValueError as exc:
        return json_error(str(exc))
    created = []
    for target_id in target_ids:
        assignment, _ = FeedbackAssignment.objects.update_or_create(
            form=form, target_type=target_type, target_id=str(target_id) if target_id is not None else None,
            defaults={'assigned_by': actor_name(request) or 'Staff', 'due_date': due_date},
        )
        created.append(assignment_dict(assignment))
    return JsonResponse({'assignments': created}, status=201)


def assignment_dict(assignment):
    return {
        'id': assignment.id, 'targetType': assignment.target_type,
        'targetId': assignment.target_id, 'assignedBy': assignment.assigned_by,
        'assignedAt': _iso(assignment.assigned_at), 'dueDate': _iso(assignment.due_date),
    }


def _response_dict(response, *, include_answers=False):
    anonymous = response.form.anonymous_responses
    data = {
        'id': response.id, 'formId': response.form_id, 'formTitle': response.form.title,
        'learnerId': None if anonymous else response.learner_id,
        'learnerName': 'Anonymous learner' if anonymous else response.learner_name,
        'programme': '' if anonymous else response.programme,
        'status': response.status, 'startedAt': _iso(response.started_at),
        'updatedAt': _iso(response.updated_at), 'submittedAt': _iso(response.submitted_at),
    }
    if include_answers:
        by_question = {a.question_id: a.answer for a in response.answers.all()}
        data['sections'] = [{
            'id': s.id, 'title': s.title,
            'questions': [{**_question_dict(q), 'answer': by_question.get(q.id)} for q in s.questions.all()],
        } for s in response.form.sections.all()]
    return data


@require_staff
def responses_collection(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    responses = FeedbackResponse.objects.select_related('form').order_by('-updated_at')
    if request.GET.get('formId'):
        responses = responses.filter(form_id=request.GET['formId'])
    if request.GET.get('status'):
        responses = responses.filter(status=request.GET['status'])
    if request.GET.get('learner'):
        responses = responses.filter(learner_name__icontains=request.GET['learner'])
    return JsonResponse({'responses': [_response_dict(r) for r in responses]})


@require_staff
def response_detail(request, pk):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    try:
        response = FeedbackResponse.objects.select_related('form').prefetch_related(
            'answers', 'form__sections__questions',
        ).get(pk=pk)
    except FeedbackResponse.DoesNotExist:
        return json_error('Feedback response not found.', status=404)
    return JsonResponse({'response': _response_dict(response, include_answers=True)})


@require_staff
def analytics(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    form_id = request.GET.get('formId')
    forms = _forms_queryset()
    if form_id:
        forms = forms.filter(pk=form_id)
    assigned = sum(_assigned_count(f) for f in forms)
    responses = FeedbackResponse.objects.all()
    if form_id:
        responses = responses.filter(form_id=form_id)
    in_progress = responses.filter(status='in_progress').count()
    completed = responses.filter(status='completed').count()
    rating_questions = FeedbackQuestion.objects.filter(question_type='rating')
    if form_id:
        rating_questions = rating_questions.filter(section__form_id=form_id)
    ratings = []
    for question in rating_questions:
        values = [a.answer for a in question.answers.filter(response__status='completed')]
        numeric = [float(v) for v in values if isinstance(v, (int, float))]
        if numeric:
            ratings.append({'questionId': question.id, 'question': question.question_text, 'average': round(sum(numeric) / len(numeric), 2), 'responses': len(numeric)})
    return JsonResponse({'analytics': {
        'totalAssigned': assigned, 'notStarted': max(assigned - in_progress - completed, 0),
        'inProgress': in_progress, 'completed': completed,
        'completionRate': round((completed / assigned * 100), 1) if assigned else 0,
        'ratingAverages': ratings,
    }})


def _assignment_for(form, learner_id):
    return form.assignments.filter(
        Q(target_type='all_learners') | Q(target_type='learner', target_id=str(learner_id)),
    ).order_by('assigned_at').first()


def learner_forms(request):
    learner_id, _learner_name, error = require_learner_identity(request)
    if error:
        return error
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    now = timezone.now()
    forms = _forms_queryset().filter(status='published').filter(
        Q(assignments__target_type='all_learners') |
        Q(assignments__target_type='learner', assignments__target_id=learner_id),
    ).distinct()
    forms = forms.filter(Q(start_date__isnull=True) | Q(start_date__lte=now))
    responses = {r.form_id: r for r in FeedbackResponse.objects.filter(learner_id=learner_id)}
    items = []
    for form in forms:
        assignment = _assignment_for(form, learner_id)
        response = responses.get(form.id)
        items.append({
            'id': form.id, 'title': form.title, 'description': form.description,
            'assignedAt': _iso(assignment.assigned_at if assignment else None),
            'dueDate': _iso((assignment.due_date if assignment else None) or form.due_date),
            'status': 'completed' if response and response.status == 'completed' else ('in_progress' if response else 'not_started'),
            'responseId': response.id if response else None,
        })
    return JsonResponse({'forms': items})


def learner_form_detail(request, pk):
    learner_id, learner_name, error = require_learner_identity(request)
    if error:
        return error
    try:
        form = _forms_queryset().get(pk=pk, status='published')
    except FeedbackForm.DoesNotExist:
        return json_error('Feedback form not found.', status=404)
    if form.start_date and form.start_date > timezone.now():
        return json_error('Feedback form not found.', status=404)
    if not _assignment_for(form, learner_id):
        return json_error('Feedback form not found.', status=404)
    response = FeedbackResponse.objects.filter(form=form, learner_id=learner_id).prefetch_related('answers').first()
    answers = {str(a.question_id): a.answer for a in response.answers.all()} if response else {}
    data = form_dict(form, include_structure=True)
    data['response'] = {
        'id': response.id if response else None,
        'status': response.status if response else 'not_started',
        'answers': answers, 'submittedAt': _iso(response.submitted_at) if response else None,
    }
    return JsonResponse({'form': data})


def _valid_answer(question, value):
    if value in EMPTY_ANSWERS:
        return True
    config = question.config or {}
    if question.question_type in {'short_text', 'long_text', 'date'}:
        return isinstance(value, str) and (question.question_type != 'date' or parse_date(value) is not None)
    if question.question_type == 'name':
        return isinstance(value, dict) and all(isinstance(value.get(key, ''), str) for key in ('firstName', 'lastName'))
    if question.question_type == 'email':
        if not isinstance(value, str):
            return False
        try:
            validate_email(value)
            return True
        except ValidationError:
            return False
    if question.question_type == 'photo_upload':
        return isinstance(value, dict) and isinstance(value.get('uploadId'), str)
    if question.question_type == 'yes_no':
        return value in (True, False, 'yes', 'no')
    if question.question_type in {'single_choice', 'dropdown', 'likert'}:
        return isinstance(value, str) and value in config.get('options', [])
    if question.question_type == 'multiple_choice':
        return isinstance(value, list) and all(isinstance(v, str) and v in config.get('options', []) for v in value)
    if question.question_type == 'number':
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if question.question_type == 'rating':
        return isinstance(value, (int, float)) and config.get('min', 1) <= value <= config.get('max', 5)
    return False


def _answer_empty(question, value):
    if value in EMPTY_ANSWERS:
        return True
    if question.question_type == 'name':
        return not str(value.get('firstName', '')).strip() or not str(value.get('lastName', '')).strip()
    if question.question_type == 'email':
        return not str(value).strip()
    if question.question_type == 'photo_upload':
        return not value.get('uploadId')
    return False


def learner_response_save(request, pk):
    learner_id, learner_name, error = require_learner_identity(request)
    if error:
        return error
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    try:
        form = _forms_queryset().get(pk=pk, status='published')
    except FeedbackForm.DoesNotExist:
        return json_error('Feedback form not found.', status=404)
    if form.start_date and form.start_date > timezone.now():
        return json_error('Feedback form not found.', status=404)
    if not _assignment_for(form, learner_id):
        return json_error('Feedback form not found.', status=404)
    payload = json_body(request) or {}
    answers = payload.get('answers')
    submit = bool(payload.get('submit'))
    if not submit and not form.allow_save_continue:
        return json_error('This form does not allow saving before submission.', status=409)
    if not isinstance(answers, dict):
        return json_error('Answers must be an object keyed by question ID.')
    questions = {str(q.id): q for q in FeedbackQuestion.objects.filter(section__form=form)}
    if any(str(question_id) not in questions for question_id in answers):
        return json_error('One or more question IDs do not belong to this form.')
    for question_id, value in answers.items():
        if not _valid_answer(questions[str(question_id)], value):
            return json_error(f'Invalid answer for question {question_id}.')
    existing_response = FeedbackResponse.objects.filter(form=form, learner_id=learner_id).prefetch_related('answers').first()
    if existing_response and existing_response.status == 'completed' and not form.allow_edit_after_submission:
        return json_error('This response has already been submitted.', status=409)
    effective_answers = {str(a.question_id): a.answer for a in existing_response.answers.all()} if existing_response else {}
    effective_answers.update(answers)
    for question_id, value in answers.items():
        question = questions[str(question_id)]
        if question.question_type == 'photo_upload' and not FeedbackUpload.objects.filter(
            id=value['uploadId'], response=existing_response, question=question,
        ).exists():
            return json_error(f'Invalid photo upload for question {question_id}.')
    if submit:
        missing = [q.id for q in questions.values() if q.required and _answer_empty(q, effective_answers.get(str(q.id)))]
        if missing:
            return json_error('Complete all required questions before submitting.', fields=missing)
    try:
        learner = EnrolmentUser.all_learners.get(pk=learner_id)
    except EnrolmentUser.DoesNotExist:
        return json_error('Learner account not found.', status=404)
    with transaction.atomic():
        response, _ = FeedbackResponse.objects.select_for_update().get_or_create(
            form=form, learner_id=learner_id,
            defaults={'learner_name': learner_name or learner.username or '', 'programme': learner.programme or ''},
        )
        if response.status == 'completed' and not form.allow_edit_after_submission:
            return json_error('This response has already been submitted.', status=409)
        for question_id, value in answers.items():
            FeedbackAnswer.objects.update_or_create(
                response=response, question_id=int(question_id), defaults={'answer': value},
            )
        if submit:
            response.status = 'completed'
            response.submitted_at = timezone.now()
            response.save(update_fields=['status', 'submitted_at', 'updated_at'])
        else:
            response.save(update_fields=['updated_at'])
    return JsonResponse({'response': {
        'id': response.id, 'status': response.status,
        'submittedAt': _iso(response.submitted_at), 'updatedAt': _iso(response.updated_at),
    }})


def learner_photo_upload(request, pk, question_id):
    """Store one normalised, private image answer for the signed-in learner."""
    learner_id, learner_name, error = require_learner_identity(request)
    if error:
        return error
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    try:
        form = _forms_queryset().get(pk=pk, status='published')
        question = FeedbackQuestion.objects.get(pk=question_id, section__form=form, question_type='photo_upload')
    except (FeedbackForm.DoesNotExist, FeedbackQuestion.DoesNotExist):
        return json_error('Feedback form or photo question not found.', status=404)
    if not _assignment_for(form, learner_id) or (form.start_date and form.start_date > timezone.now()):
        return json_error('Feedback form not found.', status=404)
    if not evidence_storage.azure_configured():
        return json_error('Photo storage is not configured.', status=503)
    upload = request.FILES.get('photo')
    if upload is None:
        return json_error('Choose a photo to upload.')
    try:
        content = normalize_photo(upload)
        learner = EnrolmentUser.all_learners.get(pk=learner_id)
    except ValueError as exc:
        return json_error(str(exc))
    except EnrolmentUser.DoesNotExist:
        return json_error('Learner account not found.', status=404)
    response, _ = FeedbackResponse.objects.get_or_create(
        form=form, learner_id=learner_id,
        defaults={'learner_name': learner_name or learner.username or '', 'programme': learner.programme or ''},
    )
    if response.status == 'completed' and not form.allow_edit_after_submission:
        return json_error('This response has already been submitted.', status=409)
    container = getattr(settings, 'AZURE_FEEDBACK_UPLOADS_CONTAINER', 'feedback-uploads')
    blob_name = f'responses/{response.id}/questions/{question.id}/{uuid.uuid4()}.jpg'
    old_upload = FeedbackUpload.objects.filter(response=response, question=question).first()
    try:
        with evidence_storage._service_client(retry_total=0) as service:
            try:
                service.get_container_client(container).create_container()
            except ResourceExistsError:
                pass
            service.get_blob_client(container=container, blob=blob_name).upload_blob(
                BytesIO(content), overwrite=False, max_concurrency=1,
                content_settings=ContentSettings(content_type='image/jpeg', cache_control='private, no-store'),
                connection_timeout=10, read_timeout=30,
            )
        with transaction.atomic():
            if old_upload:
                old_blob_name = old_upload.blob_name
                old_upload.blob_name = blob_name
                old_upload.original_name = PurePath(upload.name or 'photo').name[:255]
                old_upload.content_type = 'image/jpeg'
                old_upload.size = len(content)
                old_upload.save(update_fields=['blob_name', 'original_name', 'content_type', 'size'])
                saved_upload = old_upload
            else:
                old_blob_name = None
                saved_upload = FeedbackUpload.objects.create(
                    response=response, question=question, blob_name=blob_name,
                    original_name=PurePath(upload.name or 'photo').name[:255],
                    content_type='image/jpeg', size=len(content),
                )
            answer_value = {'uploadId': str(saved_upload.id), 'filename': saved_upload.original_name}
            FeedbackAnswer.objects.update_or_create(
                response=response, question=question, defaults={'answer': answer_value},
            )
        if old_blob_name:
            try:
                evidence_storage.delete_blob(container, old_blob_name)
            except AzureError:
                logger.warning('Could not remove replaced feedback upload %s', old_blob_name)
    except (AzureError, RuntimeError, DatabaseError):
        try:
            evidence_storage.delete_blob(container, blob_name)
        except Exception:  # noqa: BLE001 - cleanup must not hide the safe API response
            pass
        logger.warning('Feedback photo storage unavailable for response %s', response.id)
        return json_error('Your photo could not be saved. Please try again.', status=503)
    return JsonResponse({'answer': answer_value}, status=201)


def feedback_upload_content(request, upload_id):
    """Serve a private upload only to its owner or an authorised staff user."""
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    try:
        upload = FeedbackUpload.objects.select_related('response').get(pk=upload_id)
    except FeedbackUpload.DoesNotExist:
        return json_error('Photo not found.', status=404)
    error = require_self_or_staff(request, upload.response.learner_id)
    if error:
        return error
    if not evidence_storage.azure_configured():
        return json_error('Photo storage is not configured.', status=503)
    container = getattr(settings, 'AZURE_FEEDBACK_UPLOADS_CONTAINER', 'feedback-uploads')
    try:
        content = evidence_storage.download_blob_bytes(container, upload.blob_name, max_bytes=1024 * 1024)
    except (AzureError, ValueError):
        return json_error('Photo could not be loaded.', status=503)
    response = HttpResponse(content, content_type='image/jpeg')
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
