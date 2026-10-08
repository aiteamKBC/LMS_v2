"""Read-only quiz review for a learner already admitted to Advanced Admin."""

import re
import urllib.error
import urllib.request
from urllib.parse import parse_qs, unquote, urlsplit

from django.conf import settings
from django.core.handlers.asgi import ASGIRequest
from django.http import FileResponse, HttpResponse

from audit_api.last_audit_ledger_views import _connection
from learner_api.models import EnrolmentUser, LearnerProgressEntry, LearnerQuizAnswer
from learner_api.source_material_content import object_value
from learner_api.student_activity_data import read_student_material
from learner_api.subject_content import _SameHostRedirect, _attachment_id, as_list, quiz_definition, safe_url
from learner_api.subject_quiz import imported_quiz
from quiz_api.models import QuizPackage, QuizQuestion


def _same_email(first, second):
    first, second = str(first or '').strip().casefold(), str(second or '').strip().casefold()
    return not first or not second or first == second


def saved_office_embed(stored):
    """Use the exact authored Office iframe, without nesting Office viewers."""
    url = safe_url(stored.get('reading_url'))
    parsed = urlsplit(url)
    if parsed.scheme == 'https' and parsed.hostname == 'view.officeapps.live.com' \
            and parsed.path == '/op/embed.aspx' and parse_qs(parsed.query).get('src'):
        return url
    return ''


def saved_google_drive_file_id(url):
    """Identify a Drive video or audio from the saved material URL only."""
    parsed = urlsplit(url or '')
    if parsed.scheme != 'https' or parsed.hostname != 'drive.google.com' or parsed.username:
        return ''
    match = re.fullmatch(r'/file/d/([A-Za-z0-9_-]{10,})/(?:preview|view)?/?', parsed.path)
    return match.group(1) if match else ''


def saved_google_drive_response(request, file_id):
    """Stream a scoped Drive file in both the local WSGI and deployed ASGI server."""
    from learner_api.media_proxy import _open_google_drive_file, google_drive_media

    if isinstance(request, ASGIRequest):
        response = google_drive_media(request, file_id)
    else:
        try:
            upstream = _open_google_drive_file(file_id, request.headers.get('Range'))
        except urllib.error.HTTPError as exc:
            return HttpResponse('The saved video is unavailable.', status=exc.code)
        except (urllib.error.URLError, TimeoutError, OSError):
            return HttpResponse('The saved video is temporarily unavailable.', status=502)
        if upstream is None:
            return HttpResponse('The saved video is unavailable.', status=502)
        response = FileResponse(upstream, status=upstream.status,
                                content_type=upstream.headers.get('Content-Type') or 'application/octet-stream')
        for header in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
            if upstream.headers.get(header):
                response[header] = upstream.headers[header]
        response['Accept-Ranges'] = 'bytes'
    response['Cache-Control'] = 'private, no-store'
    response['Referrer-Policy'] = 'no-referrer'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


def _saved_pdf_source(stored, activity_id, attachment_id):
    """Accept only this material's signed file URL from the stored iframe."""
    iframe = safe_url(stored.get('reading_url') or stored['_source'].get('material_source_url'))
    viewer = urlsplit(iframe)
    source = (parse_qs(viewer.query).get('src') or [''])[0] \
        if viewer.hostname == 'view.officeapps.live.com' and viewer.path == '/op/embed.aspx' else iframe
    source = safe_url(source)
    target = urlsplit(source)
    origin = urlsplit(getattr(settings, 'KBC_LMS_SCHEMA_URL', ''))
    if (target.scheme != 'https' or (target.scheme, target.netloc) != (origin.scheme, origin.netloc)
            or target.username or not re.fullmatch(
                rf'/wp-json/kbc-lms/v1/material/{int(activity_id)}/view', target.path)
            or _attachment_id(source) != str(attachment_id)):
        return ''
    return source


def saved_extra_pdf_source(stored, attachment_id):
    """Find a stable original PDF listed after the primary Office player."""
    schema = stored['_source'].get('_material_schema') or {}
    source = schema.get('source') if isinstance(schema.get('source'), dict) else {}
    attachments = as_list(source.get('attachments'))
    if len(attachments) < 2 or not saved_office_embed(stored):
        return ''
    origin = urlsplit(getattr(settings, 'KBC_LMS_SCHEMA_URL', ''))
    for attachment in attachments[1:]:
        if not isinstance(attachment, dict) or str(attachment.get('attachment_id') or '') != str(attachment_id):
            continue
        if (str(attachment.get('mime_type') or '').lower() != 'application/pdf'
                or attachment.get('is_temporary') is not False or attachment.get('expires_at')):
            return ''
        url = safe_url(attachment.get('file_url'))
        target = urlsplit(url)
        path = unquote(target.path)
        if (target.scheme == 'https' and (target.scheme, target.netloc) == (origin.scheme, origin.netloc)
                and not target.username and not target.query and not target.fragment
                and path.startswith('/wp-content/uploads/') and path.lower().endswith('.pdf')
                and '\\' not in path and all(part not in ('', '.', '..') for part in path[1:].split('/'))):
            return url
        return ''
    return ''


def saved_extra_pdf_response(request, stored, attachment_id):
    """Stream a listed PDF without exposing its direct file URL in the browser."""
    source = saved_extra_pdf_source(stored, attachment_id)
    if not source:
        return None
    headers = {'Accept': 'application/pdf', 'User-Agent': 'KBC-LearningOS/1.0'}
    byte_range = request.headers.get('Range', '').strip()
    if re.fullmatch(r'bytes=\d+-\d*', byte_range):
        headers['Range'] = byte_range
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _SameHostRedirect())
        upstream = opener.open(urllib.request.Request(source, headers=headers), timeout=30)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return HttpResponse('The saved PDF is temporarily unavailable.', status=502)
    if upstream.status not in (200, 206) or upstream.headers.get_content_type() != 'application/pdf':
        upstream.close()
        return HttpResponse('The saved source did not return a PDF.', status=502)
    response = FileResponse(upstream, status=upstream.status, content_type='application/pdf',
                            as_attachment=False, filename='material.pdf')
    for header in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
        if upstream.headers.get(header):
            response[header] = upstream.headers[header]
    response['Cache-Control'] = 'private, no-store'
    response['Referrer-Policy'] = 'no-referrer'
    response['X-Content-Type-Options'] = 'nosniff'
    response['X-Frame-Options'] = 'SAMEORIGIN'
    return response


def saved_pdf_response(request, stored, activity_id, attachment_id):
    """Stream a verified original PDF on the LMS origin when its backup is pending."""
    source = _saved_pdf_source(stored, activity_id, attachment_id)
    if not source:
        return None
    headers = {'Accept': 'application/pdf', 'User-Agent': 'KBC-LearningOS/1.0'}
    byte_range = request.headers.get('Range', '').strip()
    if re.fullmatch(r'bytes=\d+-\d*', byte_range):
        headers['Range'] = byte_range
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _SameHostRedirect())
        upstream = opener.open(urllib.request.Request(source, headers=headers), timeout=30)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return HttpResponse('The saved PDF is temporarily unavailable.', status=502)
    if upstream.status not in (200, 206) or upstream.headers.get_content_type() != 'application/pdf':
        upstream.close()
        return HttpResponse('The saved source did not return a PDF.', status=502)
    response = FileResponse(upstream, status=upstream.status, content_type='application/pdf',
                            as_attachment=False, filename='material.pdf')
    for header in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
        if upstream.headers.get(header):
            response[header] = upstream.headers[header]
    response['Cache-Control'] = 'private, no-store'
    response['Referrer-Policy'] = 'no-referrer'
    response['X-Content-Type-Options'] = 'nosniff'
    response['X-Frame-Options'] = 'SAMEORIGIN'
    return response


def _stored_quiz(payload):
    payload = object_value(payload)
    nested = object_value(payload.get('quiz'))
    return nested or {
        'quiz_id': payload.get('quiz_id'),
        'quiz_body': payload.get('quiz_body') or '',
        'questions': payload.get('quiz_questions') or [],
        'solutions': payload.get('quiz_solutions') or [],
        'passing_score': payload.get('quiz_passing_score'),
        'maximum_score': payload.get('quiz_maximum_score'),
    }


def _review(quiz, recorded=()):
    definition = quiz_definition(quiz)
    if definition is None:
        return None
    by_question = {}
    for answer in as_list(recorded):
        if not isinstance(answer, dict):
            continue
        key = str(answer.get('question_id') or '')
        if key and key not in by_question:
            selected = answer.get('learner_answer')
            by_question[key] = [str(value) for value in selected] if isinstance(selected, list) else (
                [str(selected)] if selected is not None else [])
    return {
        'body': definition['body'],
        'questions': [{
            'id': question['id'], 'text': question['text'],
            'options': [option['text'] for option in question['options']],
            'correctAnswers': [option['text'] for option in question['options']
                               if option['id'] in question['solution_ids']],
            'learnerAnswers': by_question.get(question['id'], []),
        } for question in definition['questions']],
    }


def legacy_quiz_review(profile, group_id, activity_id, kind):
    """Use an exact owned catalogue route; never trust a browser Aptem ID."""
    if kind not in {'material', 'quiz'}:
        raise LookupError('Activity not found.')
    source = EnrolmentUser.all_learners.only('aptem_id', 'email').get(pk=profile.enrolment_id)
    if str(source.aptem_id) != str(profile.aptem_id):
        raise LookupError('Activity not found.')
    with _connection().cursor() as cursor:
        if kind == 'material':
            stored = read_student_material(cursor, profile.aptem_id, group_id, activity_id,
                                           include_source=True)
            if stored is None or not _same_email(source.email, stored['_source'].get('learner_email')):
                raise LookupError('Activity not found.')
            row = stored['_source']
            quiz_id = str(row.get('quiz_id') or '')
            archived = imported_quiz(cursor, group_id, int(quiz_id)) if quiz_id.isdigit() else None
            return _review(archived or row.get('_material_schema', {}).get('quiz'),
                           row.get('quiz_answers'))

        cursor.execute('''SELECT l.email,c.id FROM "Learner".learners l
            JOIN "Learner".learner_source_course_memberships member
              ON member.learner_id=l.id AND member.deleted_at IS NULL
            JOIN curriculum.source_courses c ON c.id=member.source_course_id
              AND c.source_system='old_lms' AND c.deleted_at IS NULL
            JOIN curriculum.source_activities a ON a.source_course_id=c.id
              AND a.source_system='old_lms' AND a.source_activity_kind='quiz'
              AND a.deleted_at IS NULL
            WHERE l.aptem_id=%s AND c.source_course_ref=%s
              AND a.source_activity_id=%s LIMIT 2''',
            [profile.aptem_id, str(group_id), f'quiz:{activity_id}'])
        routes = cursor.fetchall()
        if len(routes) != 1 or not _same_email(source.email, routes[0][0]):
            raise LookupError('Activity not found.')
        archived = imported_quiz(cursor, group_id, activity_id)
        if archived:
            return _review(archived)
        cursor.execute('''SELECT DISTINCT m.payload FROM curriculum.source_activities a
            JOIN curriculum.source_materials m ON m.material_id=a.source_material_id
              AND m.source_system=a.source_system AND m.deleted_at IS NULL
            WHERE a.source_course_id=%s AND a.source_system='old_lms'
              AND a.source_activity_kind='material' AND a.deleted_at IS NULL
              AND m.payload->>'quiz_id'=%s LIMIT 2''',
            [routes[0][1], str(activity_id)])
        candidates = cursor.fetchall()
        return _review(_stored_quiz(candidates[0][0])) if len(candidates) == 1 else None


def native_quiz_review(profile, component_id, component):
    """Return the assigned current component's authored quiz and latest answers."""
    quiz_id = (component.get('quizMeta') or {}).get('quizId')
    if not isinstance(quiz_id, int) or quiz_id <= 0:
        raise LookupError('Quiz not found.')
    quiz = QuizPackage.objects.using('enrolment').filter(pk=quiz_id).first()
    if quiz is None:
        raise LookupError('Quiz not found.')
    attempt = (LearnerProgressEntry.objects.using('enrolment')
               .filter(learner_id=profile.id, component_ref=component_id,
                       quiz_ref=str(quiz_id))
               .order_by('-submitted_at', '-id').first())
    selections = {}
    if attempt:
        answers = (LearnerQuizAnswer.objects.using('enrolment').filter(progress=attempt)
                   .prefetch_related('chosen_answers'))
        for answer in answers:
            selected = {str(value.answer_ref) for value in answer.chosen_answers.all()}
            if answer.chosen_answer_ref is not None:
                selected.add(str(answer.chosen_answer_ref))
            selections[str(answer.question_ref)] = selected
    questions = []
    for question in (QuizQuestion.objects.using('enrolment').filter(quiz_id=quiz_id,
                    is_archived=False).prefetch_related('answers').order_by('sort_order', 'id')):
        options = list(question.answers.all())
        questions.append({
            'id': str(question.id), 'text': question.question_text,
            'options': [option.answer_text for option in options],
            'correctAnswers': [option.answer_text for option in options if option.is_correct],
            'learnerAnswers': [option.answer_text for option in options
                               if str(option.id) in selections.get(str(question.id), set())],
        })
    return {'body': quiz.lesson_content or quiz.short_description or '', 'questions': questions}
