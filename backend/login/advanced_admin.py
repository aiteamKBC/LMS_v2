"""The Advanced Admin's explicitly scoped learner review endpoints.

An Aptem ID is admitted only when it is in the imported workbook scope. The
browser never supplies a coach identity or an enrolment ID to widen that scope.
"""
from copy import copy
from collections import Counter, defaultdict

import json
import os
import sys
from urllib.parse import quote
from uuid import UUID
from zoneinfo import ZoneInfo

from django.db import DatabaseError, connections
from django.conf import settings
from django.http import JsonResponse, QueryDict
from django.http import HttpResponse, HttpResponseRedirect
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.http import require_GET

from learner_api.constants import ACCESS_ADVANCED_ADMIN
from learner_api.models import EnrolmentUser, LearnerProfile
from login.models import AdvancedAdminLearnerScope
from login.permissions import require_access


def _json_data(value):
    if isinstance(value, (bytes, bytearray, str)):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return None
    return value


def _admin_marking_submission(row, serialize):
    """Expose the saved assignment month without returning the full private draft."""
    item = serialize(row)
    content = _json_data(row.get('full_submission'))
    monthly = content.get('monthlyAssignment') if isinstance(content, dict) else None
    month = monthly.get('month') if isinstance(monthly, dict) else None
    if isinstance(month, str) and len(month) == 7 and month[4] == '-' \
            and month[:4].isdigit() and month[5:].isdigit() and 1 <= int(month[5:]) <= 12:
        item['planMonth'] = month
    else:
        item['planMonth'] = None
    return item


def _coaching_connection_string():
    """The external coaching source is never opened by test/branch runners."""
    if ('test' in sys.argv or getattr(settings, 'RUN_APP_ON_TEST_BRANCH', False)
            or getattr(settings, 'USE_SECURITY_TEST_BRANCH', False)):
        return ''
    value = (os.environ.get('COACHING_SESSIONS_DATABASE_URL') or '').strip()
    if value.lower().startswith('psql '):
        value = value[5:].strip()
    return value.strip('"').strip("'").strip()


def _profile_in_scope(profile_id):
    profile = (LearnerProfile.objects
               .only('id', 'aptem_id', 'enrolment_id', 'uuid', 'full_name', 'email',
                     'programme', 'programme_status', 'learner_type', 'cohort',
                     'group_name', 'coach_name')
               .filter(pk=profile_id)
               .first())
    if profile is None or profile.aptem_id is None:
        return None
    if not AdvancedAdminLearnerScope.objects.filter(aptem_id=str(profile.aptem_id)).exists():
        return None
    return profile


def _learner_row(profile, programme_code):
    return {
        'id': profile.id,
        'name': profile.full_name,
        'programme': profile.programme,
        'programmeCode': programme_code,
        'programmeStatus': profile.programme_status,
        'cohort': profile.cohort,
        'group': profile.group_name,
        'coach': profile.coach_name,
        'lmsLinked': profile.enrolment_id is not None,
    }


def _learner_list_sort_key(profile, programme_code, initial_ids):
    """Keep the first approved learners first, then order new cohorts for review."""
    initial = str(profile.aptem_id) in initial_ids
    cohort = (profile.cohort or '').strip().casefold()
    priority = (
        0 if programme_code == 'ME' and cohort in ('feb 2026', 'february 2026') else
        1 if programme_code == 'PCP' and cohort in ('jun 2026', 'june 2026') else
        2 if programme_code == 'ME' and cohort in ('jun 2026', 'june 2026') else
        3
    )
    return (0 if initial else 1, 0 if initial else priority,
            profile.full_name.casefold(), profile.id)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learners(request):
    try:
        scope = {
            aptem_id: (programme_code, created_at)
            for aptem_id, programme_code, created_at in
            AdvancedAdminLearnerScope.objects.values_list(
                'aptem_id', 'programme_code', 'created_at')
        }
        initial_ids = set(sorted(scope, key=lambda aptem_id:
            (scope[aptem_id][1], aptem_id))[:10])
        ids = [int(value) for value in scope]
        profiles = LearnerProfile.objects.filter(aptem_id__in=ids).only(
            'id', 'aptem_id', 'enrolment_id', 'full_name', 'programme',
            'programme_status', 'cohort', 'group_name', 'coach_name')
        profiles = sorted(profiles, key=lambda profile: _learner_list_sort_key(
            profile, scope[str(profile.aptem_id)][0], initial_ids))
        rows = [_learner_row(profile, scope[str(profile.aptem_id)][0]) for profile in profiles]
        return JsonResponse({'count': len(rows), 'learners': rows})
    except DatabaseError:
        return JsonResponse({'error': 'Learner scope is unavailable.'}, status=503)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_detail(request, profile_id):
    try:
        profile = _profile_in_scope(profile_id)
        if profile is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        scope = AdvancedAdminLearnerScope.objects.get(aptem_id=str(profile.aptem_id))
        row = _learner_row(profile, scope.programme_code)
        row.update(email=profile.email, learnerType=profile.learner_type,
                   enrolmentId=profile.enrolment_id)
        return JsonResponse({'learner': row})
    except DatabaseError:
        return JsonResponse({'error': 'Learner record is unavailable.'}, status=503)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_learning(request, profile_id):
    """Use the same owned WordPress catalogue and progress as My Learning."""
    try:
        profile = _profile_in_scope(profile_id)
        if profile is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        if profile.enrolment_id is None:
            return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)
        from learner_api.learner_detail import build_learner_detail
        from learner_api.student_activity import student_activity
        source = EnrolmentUser.all_learners.get(pk=profile.enrolment_id)
        current = build_learner_detail(source, source.id, compact=True, read_only=True)
        delegated = copy(request)
        delegated.GET = QueryDict('')
        delegated.path = delegated.path_info = (
            f'/learner_api/student-activity/commercial/{profile.enrolment_id}/')
        historical = student_activity(delegated, 'commercial', profile.enrolment_id)
        if historical.status_code != 200:
            return historical
        history = json.loads(historical.content)
        for key, url in (history.get('covers') or {}).items():
            if url.startswith('/curriculum_api/curriculum/uploads/'):
                history['covers'][key] = (
                    f'/login_api/advanced-admin/learners/{profile_id}/learning/covers/'
                    f'{quote(str(key), safe="")}/')
        return JsonResponse({'current': current, 'historical': history})
    except EnrolmentUser.DoesNotExist:
        return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)
    except DatabaseError:
        return JsonResponse({'error': 'Learning record is unavailable.'}, status=503)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_wordpress_courses(request, profile_id):
    """Read verified WordPress memberships and activity results for one learner."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)

    from audit_api.last_audit_ledger_views import _connection, _is_completed
    from learner_api import subject_source

    try:
        with _connection().cursor() as cursor:
            source = subject_source.read_learner(cursor, profile.aptem_id, profile.email)
        if source is None:
            return JsonResponse({'error': 'Verified WordPress courses are unavailable.'}, status=503)
        courses = []
        for group in source['groups']:
            activities = []
            for row in subject_source.source_rows(group):
                completed = _is_completed(row)
                started = completed or str(row.get('status') or '').strip().lower() not in ('', 'not_started', 'not started')
                started = started or any(row.get(flag) is True for flag in (
                    'video_started', 'reading_viewed', 'quiz_attempted'))
                activities.append({
                    'id': row['activity_id'], 'title': row.get('title') or 'Untitled activity',
                    'type': row.get('activity_type') or 'activity',
                    'completed': completed, 'started': started,
                })
            completed_count = sum(row['completed'] for row in activities)
            if completed_count > 5:
                courses.append({
                    'id': group['id'], 'title': group['name'],
                    'activities': activities,
                    'completedActivities': completed_count,
                    'startedActivities': sum(row['started'] for row in activities),
                })
    except (DatabaseError, OSError, ValueError, TypeError, KeyError):
        return JsonResponse({'error': 'Verified WordPress courses are unavailable.'}, status=503)
    return JsonResponse({'courses': courses, 'source': 'wordpress-live'})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_module_progress(request, profile_id):
    """Read the learner's canonical module metrics behind the explicit scope gate."""
    try:
        profile = _profile_in_scope(profile_id)
        if profile is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        if profile.enrolment_id is None:
            return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)
        from learner_api import canonical_learning
        from learner_api.training_plan_dashboard import (
            TRAINING_PLAN_SOURCE_FIELDS, read_dashboard,
        )
        from old_otjh.service import ServiceError

        source = (EnrolmentUser.all_learners.only(*TRAINING_PLAN_SOURCE_FIELDS)
                  .get(pk=profile.enrolment_id))
        source._canonical_profile = canonical_learning.require_profile(profile.enrolment_id)
        progress = read_dashboard(source, section='overview')
        from learner_api.dashboard_metrics import coach_otjh_target_to_date
        metrics = canonical_learning.metrics_bulk([source.pk], learner_workspace=True).get(source.pk)
        target_as_of_today = coach_otjh_target_to_date(source, metrics['otjh']) if metrics else None
        # This screen needs metrics and module identity, not booking links,
        # review records or coach contact details from the full dashboard.
        return JsonResponse({'progress': {
            'modules': progress['modules'],
            'moduleLinks': progress['moduleLinks'],
            'moduleProgress': progress['moduleProgress'],
            'months': progress['months'],
            'programmeStartDate': progress.get('programmeStartDate'),
            'programmeEndDate': progress.get('programmeEndDate'),
            'targetAsOfToday': target_as_of_today,
            'actual': progress['actual'],
            'actualAvailable': progress['actualAvailable'],
            'sessions': [{key: session.get(key) for key in (
                'id', 'moduleId', 'title', 'start', 'end', 'minutes', 'status', 'attended',
            )} for session in progress['sessions']],
        }})
    except EnrolmentUser.DoesNotExist:
        return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)
    except ServiceError as error:
        return JsonResponse({'error': str(error)}, status=error.status)
    except DatabaseError:
        return JsonResponse({'error': 'Module progress is unavailable.'}, status=503)


def _legacy_material_response(request, profile, group_id, activity_id):
    from learner_api.student_activity import _material_response, _owned_material
    from login.advanced_admin_activity import _saved_pdf_source, saved_extra_pdf_source, saved_office_embed

    try:
        aptem_id, stored = _owned_material('commercial', profile.enrolment_id, group_id, activity_id)
    except LookupError:
        return JsonResponse({'error': 'Activity not found.'}, status=404)
    except DatabaseError:
        return JsonResponse({'error': 'Activity is temporarily unavailable.'}, status=503)

    row = stored['_source']
    schema = row.get('_material_schema') or {}
    source = schema.get('source') if isinstance(schema.get('source'), dict) else {}
    attachments = source.get('attachments') or []
    # A saved iframe without separate attachments is already the material's
    # source. Avoid scanning the legacy archive tables before returning it.
    # A verified, single pending PDF can use its scoped source for the same
    # reason; keep archive recovery for any other listed attachments.
    fast_pdf = (not row.get('_material_blob_ready') and schema.get('content_type') == 'pdf'
                and len(attachments) == 1 and isinstance(attachments[0], dict)
                and bool(_saved_pdf_source(stored, activity_id,
                                           str(attachments[0].get('attachment_id') or ''))))
    fast_office = (not row.get('_material_blob_ready') and len(attachments) == 1
                   and bool(saved_office_embed(stored)))
    extra_pdfs = []
    if (not row.get('_material_blob_ready') and len(attachments) > 1 and saved_office_embed(stored)):
        for attachment in attachments[1:]:
            if not isinstance(attachment, dict):
                break
            reference = str(attachment.get('attachment_id') or '')
            if not saved_extra_pdf_source(stored, reference):
                break
            extra_pdfs.append((reference, str(attachment.get('filename') or
                                              attachment.get('file_title') or 'Attached PDF')))
    fast_extra_pdfs = len(extra_pdfs) == len(attachments) - 1 and bool(extra_pdfs)
    response = _material_response(request, profile.enrolment_id, aptem_id, stored,
                                  kind='commercial', group_id=group_id,
                                  attachment_resolver=(lambda _reference: '')
                                  if not attachments or fast_pdf or fast_office or fast_extra_pdfs else None)
    if response.status_code == 200:
        response['X-Has-Quiz-Review'] = '1' if row.get('quiz_id') or schema.get('quiz') else '0'
        if fast_extra_pdfs:
            payload = json.loads(response.content)
            unavailable = list(payload.get('unavailable_attachments') or [])
            for reference, title in extra_pdfs:
                if not any(str(item.get('attachment_id') or '') == reference or
                           (item.get('url') or '').endswith(f'/files/{reference}/')
                           for item in payload['media']):
                    payload['media'].append({
                        'kind': 'pdf',
                        'url': (f'/login_api/advanced-admin/learners/{profile.id}/learning/material/'
                                f'{group_id}/{activity_id}/files/{reference}/'),
                        'title': title, 'file_name': title, 'can_embed': True,
                    })
                if title in unavailable:
                    unavailable.remove(title)
            payload['unavailable_attachments'] = unavailable
            response.content = json.dumps(payload)
    return response


def _inline_admin_pdf(response):
    """Permit only a scoped PDF response to load in this page's same-origin iframe."""
    content_type = response.get('Content-Type', '').split(';', 1)[0].strip().lower()
    if response.status_code in (200, 206) and content_type == 'application/pdf':
        response['X-Frame-Options'] = 'SAMEORIGIN'
        if response.get('Content-Disposition', '').lower().startswith('attachment'):
            response['Content-Disposition'] = 'inline; filename="material.pdf"'
        response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_cover(request, profile_id, cover_key):
    """Serve only a cover named in this learner's course catalogue."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Course cover not found.'}, status=404)
    from learner_api.student_activity import student_activity

    delegated = copy(request)
    delegated.GET = QueryDict('')
    delegated.path = delegated.path_info = (
        f'/learner_api/student-activity/commercial/{profile.enrolment_id}/')
    response = student_activity(delegated, 'commercial', profile.enrolment_id)
    if response.status_code != 200:
        return response
    url = (json.loads(response.content).get('covers') or {}).get(cover_key) or ''
    marker = '/curriculum_api/curriculum/uploads/'
    if not url.startswith(marker):
        return JsonResponse({'error': 'Course cover not found.'}, status=404)
    from curriculum_api.views import curriculum_uploaded_file

    return curriculum_uploaded_file(request, url[len(marker):])


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_material(request, profile_id, group_id, activity_id):
    """Read the learner's original activity player without granting learner APIs."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Activity not found.'}, status=404)
    response = _legacy_material_response(request, profile, group_id, activity_id)
    if response.status_code != 200:
        return response
    payload = json.loads(response.content)
    # The player may display the historical quiz and media, but cannot start
    # an attempt or receive a learner CSRF token through this review route.
    payload['can_attempt'] = False
    payload['csrf_token'] = ''
    payload['has_quiz_review'] = response.get('X-Has-Quiz-Review') == '1'
    original = (f'/learner_api/student-activity/commercial/{profile.enrolment_id}/'
                f'{group_id}/{activity_id}/')
    scoped = (f'/login_api/advanced-admin/learners/{profile_id}/learning/material/'
              f'{group_id}/{activity_id}/')
    for index, item in enumerate(payload.get('media') or []):
        url = item.get('url') or ''
        if url.startswith(original):
            item['url'] = scoped + url[len(original):]
        elif url.startswith('/curriculum_api/curriculum/uploads/'):
            item['url'] = f'{scoped}media/{index}/'
        elif item.get('kind') in ('video', 'audio'):
            from login.advanced_admin_activity import saved_google_drive_file_id
            if saved_google_drive_file_id(url):
                item['url'] = f'{scoped}media/{index}/'
    # The imported manifest may list the same PDF as both the playable reading
    # and a later attachment. Do not label that playable file unavailable.
    if 'unavailable_attachments' in payload:
        unavailable = list(payload['unavailable_attachments'] or [])
        for item in payload.get('media') or []:
            if (item.get('kind') == 'pdf' and item.get('attachment_id')
                    and item.get('url') == f'{scoped}files/{item["attachment_id"]}/'
                    and item.get('file_name') in unavailable):
                unavailable.remove(item['file_name'])
        payload['unavailable_attachments'] = unavailable
    # Stored Office embeds remain usable even when a PPT backup has not been
    # copied yet. Never wrap an Office iframe inside another Office iframe.
    if any(item.get('kind') == 'document' and
           (item.get('url') or '') == scoped + 'source-file/' for item in payload.get('media') or []):
        from learner_api.student_activity import _owned_material
        from login.advanced_admin_activity import saved_office_embed

        try:
            _aptem_id, stored = _owned_material('commercial', profile.enrolment_id, group_id, activity_id)
        except LookupError:
            return JsonResponse({'error': 'Activity not found.'}, status=404)
        except DatabaseError:
            return JsonResponse({'error': 'Activity file is unavailable.'}, status=503)
        office = saved_office_embed(stored)
        if office:
            for item in payload.get('media') or []:
                if item.get('kind') == 'document' and item.get('url') == scoped + 'source-file/':
                    item['url'] = office
    result = JsonResponse(payload)
    result['Cache-Control'] = 'private, no-store'
    return result


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_legacy_quiz_review(request, profile_id, group_id, activity_id, kind):
    """Reveal saved answer keys only inside an approved Advanced Admin review."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Quiz not found.'}, status=404)
    from login.advanced_admin_activity import legacy_quiz_review

    try:
        quiz = legacy_quiz_review(profile, group_id, activity_id, kind)
    except (LookupError, EnrolmentUser.DoesNotExist):
        return JsonResponse({'error': 'Quiz not found.'}, status=404)
    except (DatabaseError, ValueError, TypeError, KeyError):
        return JsonResponse({'error': 'Quiz review is unavailable.'}, status=503)
    response = JsonResponse({'quiz': quiz})
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_component_quiz_review(request, profile_id, component_id):
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Quiz not found.'}, status=404)
    from login.advanced_admin_activity import native_quiz_review

    try:
        _source, component = _scoped_component(profile, component_id)
        if component is None:
            return JsonResponse({'error': 'Quiz not found.'}, status=404)
        quiz = native_quiz_review(profile, component_id, component)
    except (LookupError, EnrolmentUser.DoesNotExist):
        return JsonResponse({'error': 'Quiz not found.'}, status=404)
    except (DatabaseError, ValueError, TypeError, KeyError):
        return JsonResponse({'error': 'Quiz review is unavailable.'}, status=503)
    response = JsonResponse({'quiz': quiz})
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_material_media(request, profile_id, group_id, activity_id, media_index):
    """Stream a private archived upload only when that activity lists it."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Activity file not found.'}, status=404)
    response = _legacy_material_response(request, profile, group_id, activity_id)
    if response.status_code != 200:
        return response
    media = json.loads(response.content).get('media') or []
    url = media[media_index].get('url') or '' if media_index < len(media) else ''
    if media_index < len(media) and media[media_index].get('kind') in ('video', 'audio'):
        from login.advanced_admin_activity import saved_google_drive_file_id
        file_id = saved_google_drive_file_id(url)
        if file_id:
            from login.advanced_admin_activity import saved_google_drive_response
            return saved_google_drive_response(request, file_id)
    marker = '/curriculum_api/curriculum/uploads/'
    if not url.startswith(marker):
        return JsonResponse({'error': 'Activity file not found.'}, status=404)
    from curriculum_api.views import curriculum_uploaded_file

    return _inline_admin_pdf(curriculum_uploaded_file(request, url[len(marker):]))


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_material_file(request, profile_id, group_id, activity_id, attachment_id=None):
    """Serve only a file owned by one approved learner and activity."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Activity file not found.'}, status=404)
    from learner_api.student_activity import _owned_material, source_material_file, subject_file

    if attachment_id is None:
        return _inline_admin_pdf(source_material_file(request, 'commercial', profile.enrolment_id,
                                                      group_id, activity_id))
    from login.advanced_admin_activity import _saved_pdf_source, saved_extra_pdf_response, saved_pdf_response

    try:
        _aptem_id, stored = _owned_material('commercial', profile.enrolment_id, group_id, activity_id)
    except LookupError:
        return JsonResponse({'error': 'Activity file not found.'}, status=404)
    except DatabaseError:
        return JsonResponse({'error': 'Activity file is unavailable.'}, status=503)
    pending_pdf = (not stored['_source'].get('_material_blob_ready')
                   and bool(_saved_pdf_source(stored, activity_id, attachment_id)))
    early_result = saved_pdf_response(request, stored, activity_id, attachment_id) if pending_pdf else None
    if early_result is not None and early_result.status_code in (200, 206):
        return _inline_admin_pdf(early_result)

    extra_result = saved_extra_pdf_response(request, stored, attachment_id)
    if extra_result is not None and extra_result.status_code in (200, 206):
        return _inline_admin_pdf(extra_result)

    response = subject_file(request, 'commercial', profile.enrolment_id,
                            group_id, activity_id, attachment_id)
    location = response.get('Location', '')
    marker = '/curriculum_api/curriculum/uploads/'
    if response.status_code in (301, 302) and location.startswith(marker):
        from curriculum_api.views import curriculum_uploaded_file
        served = curriculum_uploaded_file(request, location[len(marker):])
        if served.status_code != 404:
            return _inline_admin_pdf(served)
        response = served
    if response.status_code == 404:
        fallback = early_result if early_result is not None else saved_pdf_response(
            request, stored, activity_id, attachment_id)
        if fallback is not None:
            return _inline_admin_pdf(fallback)
        if extra_result is not None:
            return _inline_admin_pdf(extra_result)
    return _inline_admin_pdf(response)


def _scoped_component(profile, component_id):
    from learner_api.learner_detail import build_learner_detail

    source = EnrolmentUser.all_learners.get(pk=profile.enrolment_id)
    detail = build_learner_detail(source, source.id, compact=True, read_only=True)
    matches = [item for item in detail.get('components') or []
               if str(item.get('componentId') or '') == component_id]
    return (source, matches[0]) if len(matches) == 1 else (source, None)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_component(request, profile_id, component_id):
    """Read authored current activity content under the same learner scope."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Activity not found.'}, status=404)
    try:
        source, component = _scoped_component(profile, component_id)
        if component is None:
            return JsonResponse({'error': 'Activity not found.'}, status=404)
        if component.get('hasReadingContent') and not component.get('contentHtml'):
            from learner_api.learner_detail import _reading_content
            reading = _reading_content(source, component_id)
            if reading:
                component['contentHtml'] = reading['contentHtml']
        response = JsonResponse({'component': component})
        response['Cache-Control'] = 'private, no-store'
        return response
    except (EnrolmentUser.DoesNotExist, DatabaseError):
        return JsonResponse({'error': 'Activity is unavailable.'}, status=503)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_component_file(request, profile_id, component_id, slot):
    """Open only a URL authored on this learner's assigned component."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Activity file not found.'}, status=404)
    try:
        _source, component = _scoped_component(profile, component_id)
        if component is None:
            return JsonResponse({'error': 'Activity file not found.'}, status=404)
        if slot in {'resource', 'video', 'audio'}:
            url = component.get({'resource': 'resourceUrl', 'video': 'videoUrl',
                                 'audio': 'audioUrl'}[slot]) or ''
        elif slot.startswith('file-') and slot[5:].isdigit():
            files = component.get('files') or []
            index = int(slot[5:])
            url = (files[index].get('url') or '') if index < len(files) and isinstance(files[index], dict) else ''
        else:
            url = ''
        marker = '/curriculum_api/curriculum/uploads/'
        if url.startswith(marker):
            from curriculum_api.views import curriculum_uploaded_file
            return curriculum_uploaded_file(request, url[len(marker):])
        if url.startswith(('https://', 'http://')):
            response = HttpResponseRedirect(url)
            response['Cache-Control'] = 'private, no-store'
            return response
        return JsonResponse({'error': 'Activity file not found.'}, status=404)
    except (EnrolmentUser.DoesNotExist, DatabaseError):
        return JsonResponse({'error': 'Activity file is unavailable.'}, status=503)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def csrf_token(request):
    return JsonResponse({'csrfToken': get_token(request)})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_attendance(request, profile_id):
    """The existing AiTeamKBC register history for one approved Aptem ID."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    from learner_api.attendance import fetch_kbc_attendance_rows
    try:
        rows = fetch_kbc_attendance_rows(
            aptem_id=profile.aptem_id, learner_id=profile.id,
            learner_name=profile.full_name, learner_email=profile.email,
        )
    except (DatabaseError, RuntimeError, OSError):
        return JsonResponse({'error': 'Attendance source is unavailable.'}, status=503)
    return JsonResponse({'items': [
        {'date': row['session_date'].isoformat() if row['session_date'] else None,
         'status': row['attendance_status'], 'title': row['session_title'],
         'module': row['module_title'], 'sessionId': row['session_id'],
         'source': 'kbc_attendance'}
        for row in rows
    ]})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_lecture_workspace(request, profile_id):
    """Read the scoped learner's lecture workspace without learner actions or links."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)

    import psycopg
    from learner_api.attendance_lectures import ATTENDANCE_SOURCE_FIELDS, read_workspace

    try:
        source = (EnrolmentUser.all_learners.only(*ATTENDANCE_SOURCE_FIELDS)
                  .filter(pk=profile.enrolment_id).first())
        if source is None:
            return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)
        workspace = read_workspace(source, 'commercial')
    except (DatabaseError, psycopg.Error, RuntimeError, ValueError, OSError):
        return JsonResponse({'error': 'Lecture workspace is unavailable.'}, status=503)

    lecture_fields = (
        'id', 'sessionId', 'date', 'title', 'moduleId', 'module', 'source',
        'startTime', 'endTime', 'durationMinutes', 'tutor', 'coach',
        'contentSummary', 'ksbs', 'status', 'catchupStatus',
    )
    activity_fields = ('id', 'title', 'type', 'completed')
    lectures = [{**{key: lecture.get(key) for key in lecture_fields},
                 'activities': [{key: activity.get(key) for key in activity_fields}
                                for activity in lecture.get('activities') or []]}
                for lecture in workspace['lectures']]
    mode = workspace['mode']
    response = JsonResponse({
        'lectures': lectures,
        'modules': workspace['modules'],
        'mode': {key: mode.get(key) for key in (
            'available', 'mode', 'requestedMode', 'status',
            'plannedLiveHours', 'plannedRecordedHours',
        )},
        'recentActivity': workspace['recentActivity'],
        'timeZone': workspace['timeZone'],
    })
    response['Cache-Control'] = 'private, no-store'
    return response


def _preview_document(value):
    """Keep saved enrolment answers readable without embedding signature images."""
    if isinstance(value, dict):
        return {key: _preview_document(item) for key, item in value.items()
                if 'signature' not in key.casefold()}
    if isinstance(value, list):
        return [_preview_document(item) for item in value]
    if isinstance(value, str) and value.startswith('data:image/'):
        return '[Image on file]'
    return value


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_enrolment(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'summary': {}, 'answers': {}, 'wizardDraft': {}, 'completed': False})
    from enrolment_api.models import ExtendedIlr
    try:
        source = EnrolmentUser.all_learners.get(pk=profile.enrolment_id)
        ilr = (ExtendedIlr.objects.filter(learner_kind='commercial',
                                          learner_id=source.id).order_by('-updated_at').first())
    except (EnrolmentUser.DoesNotExist, DatabaseError):
        return JsonResponse({'error': 'Enrolment record is unavailable.'}, status=503)
    return JsonResponse({
        'summary': {'programme': source.programme, 'cohort': source.cohort,
                    'group': source.group, 'organisation': source.organization,
                    'employer': source.employer, 'startDate': source.start_date,
                    'endDate': source.end_date, 'status': source.programme_status,
                    'onboardingStatus': source.onboarding_status},
        'answers': _preview_document(_json_data(ilr.answers) or {}) if ilr else {},
        'wizardDraft': _preview_document(_json_data(ilr.wizard_draft) or {}) if ilr else {},
        'completed': bool(ilr.completed) if ilr else False,
    })


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_compliance(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'items': []})
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''select id, "Doc_type", "Doc_name", "Signed", "Generated_at"
                from enrolment."Enrolment_Documents"
                where "Learner_kind"=%s and "Learner_id"=%s
                order by "Generated_at" desc''', ['commercial', profile.enrolment_id])
            rows = cursor.fetchall()
    except DatabaseError:
        return JsonResponse({'error': 'Compliance documents are unavailable.'}, status=503)
    from enrolment_api.documents import DOC_TYPES
    return JsonResponse({'items': [
        {'id': str(row[0]), 'type': DOC_TYPES.get(row[1], row[1]),
         'filename': row[2], 'signed': bool(row[3]),
         'generatedAt': row[4].isoformat() if row[4] else None}
        for row in rows
    ]})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_compliance_file(request, profile_id, document_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'error': 'Document not found.'}, status=404)
    try:
        document_id = UUID(str(document_id))
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''select "Container", "Blob_name"
                from enrolment."Enrolment_Documents"
                where id=%s and "Learner_kind"=%s and "Learner_id"=%s''',
                [str(document_id), 'commercial', profile.enrolment_id])
            row = cursor.fetchone()
    except (ValueError, DatabaseError):
        return JsonResponse({'error': 'Document not found.'}, status=404)
    if row is None:
        return JsonResponse({'error': 'Document not found.'}, status=404)
    from learner_api.evidence_storage import azure_configured, get_download_sas
    if not azure_configured():
        return JsonResponse({'error': 'Document storage is unavailable.'}, status=503)
    return JsonResponse({'url': get_download_sas(row[0], row[1])})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_messages(request, profile_id):
    """Isolated read-only history; never invokes the disabled chat bootstrap."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    from chat.models import Conversation, Message, MessageDeletion
    try:
        conversations = list(Conversation.objects.filter(learner_id=profile.id)
                             .select_related('coach').order_by('-updated_at')[:30])
        items = []
        for conversation in conversations:
            hidden = MessageDeletion.objects.filter(
                participant_type='learner', participant_id=str(profile.id)).values('message_id')
            messages = list(Message.objects.filter(conversation_id=conversation.id,
                                                    is_deleted=False).exclude(id__in=hidden)
                            .order_by('-created_at')[:200])
            items.append({'id': conversation.id, 'coach': conversation.coach.name,
                          'messages': [{'id': item.id, 'sender': item.sender_type,
                                        'body': item.body,
                                        'createdAt': item.created_at.isoformat()}
                                       for item in reversed(messages)]})
    except DatabaseError:
        return JsonResponse({'error': 'Message history is unavailable.'}, status=503)
    response = JsonResponse({'items': items})
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_monthly_logs(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'months': [], 'totalMonths': 0, 'completedMonths': 0})
    from learner_api import canonical_learning, monthly_logs
    from old_otjh import service as old_service
    try:
        owner = canonical_learning.require_profile(profile.enrolment_id)
        learner = {**owner, 'id': profile.enrolment_id,
                   'aptem_id': profile.aptem_id, 'name': profile.full_name,
                   'programme': profile.programme,
                   '_canonical_profile': owner, '_profile': owner, '_view_as': True}
        result = monthly_logs.summary_data(learner, include_open=True)
    except old_service.ServiceError as error:
        return JsonResponse({'error': str(error)}, status=error.status)
    except DatabaseError:
        return JsonResponse({'error': 'Monthly logs are unavailable.'}, status=503)
    return JsonResponse({'months': result['months'], 'totalMonths': result['total_months'],
                         'completedMonths': result['completed_months'],
                         'trainingPlanTotals': result['training_plan_totals']})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_evidence(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'items': []})
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''select id, original_filename, content_type, size_bytes,
                status, scan_result, section_ref, uploaded_at
                from "Learner".evidence_files
                where learner_kind=%s and learner_id=%s
                order by uploaded_at desc''', ['commercial', str(profile.enrolment_id)])
            rows = cursor.fetchall()
    except DatabaseError:
        return JsonResponse({'error': 'Evidence records are unavailable.'}, status=503)
    return JsonResponse({'items': [
        {'id': str(row[0]), 'filename': row[1], 'contentType': row[2],
         'sizeBytes': row[3], 'status': row[4], 'scanResult': row[5],
         'sectionRef': row[6], 'uploadedAt': row[7].isoformat() if row[7] else None}
        for row in rows
    ]})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_monthly_reports(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'items': []})
    from learner_api.monthly_reports import _json_column
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''select id, month_key, month_label, status,
                learned_summary, attachments, submitted_at, signed_name
                from "Learner".learner_monthly_reports
                where learner_kind=%s and learner_id=%s
                order by month_key desc''', ['commercial', str(profile.enrolment_id)])
            rows = cursor.fetchall()
    except DatabaseError:
        return JsonResponse({'error': 'Monthly reports are unavailable.'}, status=503)
    return JsonResponse({'items': [
        {'id': str(row[0]), 'month': row[1], 'monthLabel': row[2],
         'status': row[3], 'learnedSummary': row[4],
         'attachments': _json_column(row[5], []),
         'submittedAt': row[6].isoformat() if row[6] else None,
         'signedName': row[7]}
        for row in rows
    ]})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_legacy_assignments(request, profile_id):
    """Classified Aptem assessments remain in their original Azure source."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'items': []})
    from learner_api.legacy_assignments import classified_rows, classified_submission
    from learner_api.legacy_marking import reviews_for_evidence

    try:
        rows = classified_rows('commercial', profile.enrolment_id)
        marks = reviews_for_evidence(profile.aptem_id, [row['evidence_id'] for row in rows])
    except DatabaseError:
        return JsonResponse({'error': 'Historical assessments are unavailable.'}, status=503)
    items = []
    for row in rows:
        item = classified_submission(row, 'commercial', profile.enrolment_id)
        item['legacyAssignment']['lmsReviews'] = marks.get(int(row['evidence_id']), [])
        items.append(item)
    response = JsonResponse({'items': items})
    response['Cache-Control'] = 'private, no-store'
    return response


_FILE_ASSIGNMENT_EVIDENCE_SQL = "lower(btrim(e.evidence_kind)) = 'file'"
_MISC_ASSIGNMENT_EVIDENCE_SQL = (
    "lower(btrim(coalesce(e.component_name, ''))) ~ "
    "'(additional|additioinal)[[:space:]]+job[[:space:]]+activit(y|ies)|miscellan'"
)
_ASSIGNMENT_CHECK_SQL = '''a.record_kind = 'record'
    and lower(coalesce(a.source_data->>'categoryCode', '')) in ('', 'a')
    and (
    lower(coalesce(a.source_data->>'categoryCode', '')) = 'a'
    or coalesce(a.source_data->>'Category', a.source_data->>'category',
                a.source_data->>'type', a.source_data->>'kind', '') ~* 'assignment'
    or a.title ~* 'assignment')'''


def _assignment_evidence(profile, evidence_id):
    """Resolve a checked assignment or Misc File for this learner."""
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''select e.evidence_id, e.evidence_name, e.file_blob,
                   e.report_blob, e.component_id
            from fetching_evidence.evidence_items e
            where e.learner_id = %s and e.evidence_id = %s
              and {_FILE_ASSIGNMENT_EVIDENCE_SQL}
              and (exists (select 1 from "Last_audit".assigments_check a
                    where a.aptem_id = e.learner_id and {_ASSIGNMENT_CHECK_SQL}
                      and (a.source_data->>'activityId' = e.component_id::text
                           or a.source_data->>'evidence_id' = e.evidence_id::text
                           or a.source_data->>'EvidenceId' = e.evidence_id::text))
                   or {_MISC_ASSIGNMENT_EVIDENCE_SQL})
            limit 1''', [profile.aptem_id, evidence_id])
        return cursor.fetchone()


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_audit_assignments(request, profile_id):
    """Assignment check records and Misc File uploads grouped by month."""
    try:
        profile = _profile_in_scope(profile_id)
        if profile is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(f'''select a.id, a.title, a.assignment_month,
                       a.source_due_date,
                       coalesce(a.source_data->>'Category', a.source_data->>'category',
                                a.source_data->>'type', a.source_data->>'kind'),
                       a.source_data->>'categoryCode', a.source_data->>'activityId',
                       coalesce(a.source_data->>'evidence_id', a.source_data->>'EvidenceId'),
                       a.source_data->>'calendar_month', a.evidence_links
                from "Last_audit".assigments_check a
                where a.aptem_id = %s and {_ASSIGNMENT_CHECK_SQL}
                order by a.id''', [profile.aptem_id])
            check_rows = [{
                'id': row[0], 'title': row[1], 'assignment_month': row[2],
                'source_due_date': row[3], 'category': row[4],
                'category_code': row[5], 'activity_id': row[6],
                'evidence_id': row[7], 'calendar_month': row[8],
                'evidence_links': _json_data(row[9]),
            } for row in cursor.fetchall()]
            cursor.execute(f'''select e.evidence_id, e.component_id
                    from fetching_evidence.evidence_items e
                    where e.learner_id = %s and {_FILE_ASSIGNMENT_EVIDENCE_SQL}''',
                           [profile.aptem_id])
            component_by_evidence = {
                evidence_id: component_id for evidence_id, component_id
                in cursor.fetchall()
            }
            from login.assignment_check import group_assignment_records
            check_groups = group_assignment_records(check_rows, component_by_evidence)
            component_ids = sorted({group['linkedComponentId'] for group in check_groups
                                    if group['linkedComponentId'] is not None})
            evidence_ids = sorted({evidence_id for group in check_groups
                                   for evidence_id in group['evidenceIds']})
            cursor.execute(f'''select e.evidence_id, e.component_id, e.evidence_name,
                           e.evidence_status, e.submission_date, e.completed_date,
                           e.feedbacks, nullif(btrim(e.file_blob), '') is not null,
                           nullif(btrim(e.report_blob), '') is not null, e.note_content,
                           coalesce(v.admin_verified_ksb_codes, k.verified_ksb_codes, '[]'::jsonb),
                           e.spent_time, e.component_name,
                           ({_MISC_ASSIGNMENT_EVIDENCE_SQL}),
                           h.seconds, h.extraction_status
                    from fetching_evidence.evidence_items e
                    left join login."Advanced_admin_report_hours" h
                      on h.evidence_id = e.evidence_id
                     and h.report_hash = md5(e.report_blob)
                    left join lateral (
                        select r.verified_ksb_codes
                        from fetching_evidence.assignment_classification_results r
                        where r.learner_id = e.learner_id
                          and r.component_id = e.component_id
                          and r.evidence_id = e.evidence_id
                        order by r.run_id desc limit 1
                    ) k on true
                    left join lateral (
                        select evaluation->'admin_verified_ksb_codes' as admin_verified_ksb_codes
                        from fetching_evidence.assignment_classification_evaluations v
                        where v.learner_id = e.learner_id
                          and v.component_id = e.component_id
                          and v.evidence_id = e.evidence_id
                        order by v.run_id desc, v.id desc limit 1
                    ) v on true
                    where e.learner_id = %s
                      and {_FILE_ASSIGNMENT_EVIDENCE_SQL}
                      and (e.component_id = any(%s::bigint[])
                           or e.evidence_id = any(%s::bigint[])
                           or {_MISC_ASSIGNMENT_EVIDENCE_SQL})
                    order by e.submission_date desc nulls last, e.evidence_id desc''',
                    [profile.aptem_id, component_ids, evidence_ids])
            evidence_rows = cursor.fetchall()
            cursor.execute('''select component_id, planned_hours, actual_hours,
                                  assignment_month
                    from "Last_audit".learner_assignments
                    where aptem_id = %s and component_id = any(%s::bigint[])''',
                           [profile.aptem_id, component_ids])
            hours_by_component = {row[0]: row[1:] for row in cursor.fetchall()}
            check_ids = sorted({record_id for group in check_groups
                                for record_id in group['sourceRecordIds']})
            cursor.execute('''select check_record_id, decision, feedback, reviewed_by, reviewed_at
                from login."Advanced_admin_assignment_check_marks"
                where aptem_id=%s and check_record_id=any(%s::bigint[])
                order by reviewed_at, id''', [str(profile.aptem_id), check_ids])
            source_mark_rows = cursor.fetchall()
        from learner_api.legacy_marking import reviews_for_evidence
        marks = reviews_for_evidence(profile.aptem_id, [row[0] for row in evidence_rows])
    except (KeyError, DatabaseError):
        return JsonResponse({'error': 'Assignment records are unavailable.'}, status=503)

    evidence_by_component = {}
    evidence_by_id = {}
    misc_files = []
    source_marks = {}
    for record_id, decision, feedback, reviewed_by, reviewed_at in source_mark_rows:
        source_marks.setdefault(record_id, []).append({
            'decision': decision, 'feedback': feedback,
            'reviewedBy': reviewed_by, 'reviewedAt': reviewed_at.isoformat(),
        })
    for (evidence_id, component_id, name, status, submitted, completed,
         feedbacks, has_file, has_report, note, verified_codes,
         spent_time, component_name, is_misc, report_seconds, report_status) in evidence_rows:
        codes = _json_data(verified_codes)
        original_feedbacks = _json_data(feedbacks)
        evidence = {
            'id': evidence_id, 'name': name or '', 'status': status or '',
            'submittedAt': submitted.isoformat() if submitted else None,
            'completedAt': completed.isoformat() if completed else None,
            'feedbacks': original_feedbacks if isinstance(original_feedbacks, list) else [],
            'hasFile': has_file, 'hasReport': has_report, 'note': note or '',
            'verifiedKsbCodes': [code for code in codes if isinstance(code, str)] if isinstance(codes, list) else [],
            'reviews': marks.get(evidence_id, []),
        }
        evidence_by_component.setdefault(component_id, []).append((evidence, spent_time))
        evidence_by_id[evidence_id] = (evidence, spent_time)
        if is_misc:
            misc_files.append((evidence, component_id, component_name, submitted or completed,
                               report_seconds, report_status))
    items = []
    for group in check_groups:
        linked_component = group['linkedComponentId']
        linked = list(evidence_by_component.get(linked_component, [])) if linked_component else []
        known_ids = {evidence['id'] for evidence, _ in linked}
        for evidence_id in group['evidenceIds']:
            if evidence_id in evidence_by_id and evidence_id not in known_ids:
                linked.append(evidence_by_id[evidence_id])
                known_ids.add(evidence_id)
        accepted = [(evidence, minutes) for evidence, minutes in linked
                    if evidence['status'].strip().lower() == 'accepted']
        planned, actual, old_month = hours_by_component.get(linked_component, (None, None, None))
        if actual is None:
            recorded_minutes = [float(minutes) for _, minutes in accepted if minutes is not None]
            actual = sum(recorded_minutes) / 60 if recorded_minutes else None
        month = old_month.strftime('%Y-%m') if old_month else group['month']
        source_reviews = [review for record_id in group['sourceRecordIds']
                          for review in source_marks.get(record_id, [])]
        source_accepted = bool(source_reviews and
                               source_reviews[-1]['decision'] == 'accepted' and
                               group['sourceMarkId'] is not None)
        items.append({
            'componentId': group['componentId'], 'rowId': group['rowId'],
            'name': group['name'], 'type': 'Assignment', 'month': month,
            'monthSource': 'audit',
            'status': 'Completed' if accepted or source_accepted else
                      linked[0][0]['status'] if linked else 'Planned',
            'plannedHours': float(planned) if planned is not None else None,
            'actualHours': float(actual) if actual is not None else None,
            'evidence': [evidence for evidence, _ in linked],
            'sourceFiles': group['sourceFiles'],
            'sourceMarkId': group['sourceMarkId'],
            'sourceReviews': source_reviews,
        })
    linked_ids = {evidence['id'] for item in items for evidence in item['evidence']}
    misc_groups = {}
    for evidence, component_id, component_name, upload_date, report_seconds, report_status in misc_files:
        if evidence['id'] in linked_ids:
            continue
        month = (upload_date.astimezone(ZoneInfo('Europe/London')).strftime('%Y-%m')
                 if upload_date else None)
        title = (component_name or '').strip() or 'Miscellaneous'
        key = (month, title.casefold())
        group = misc_groups.setdefault(key, {
            'componentId': component_id or evidence['id'],
            'rowId': f'misc:{month or "undated"}:{component_id or evidence["id"]}',
            'name': title, 'type': 'Miscellaneous', 'month': month,
            'monthSource': 'upload', 'plannedHours': None,
            'evidence': [], '_reportSeconds': [], '_missingHours': 0,
            '_missingStatus': None,
        })
        group['evidence'].append(evidence)
        if evidence['status'].strip().lower() == 'accepted':
            if report_seconds is not None:
                group['_reportSeconds'].append(report_seconds)
            else:
                group['_missingHours'] += 1
                group['_missingStatus'] = group['_missingStatus'] or report_status or (
                    'missing_report' if not evidence['hasReport'] else 'not_synced')
    for group in misc_groups.values():
        reports = group.pop('_reportSeconds')
        group['missingReportHours'] = group.pop('_missingHours')
        group['reportHoursStatus'] = group.pop('_missingStatus') or 'parsed'
        group['actualHours'] = sum(reports) / 3600 if reports else None
        group['status'] = ('Completed' if group['evidence'] and all(
            evidence['status'].strip().lower() == 'accepted' for evidence in group['evidence'])
            else group['evidence'][0]['status'] or 'PendingAssessment')
        items.append(group)
    response = JsonResponse({'items': items})
    response['Cache-Control'] = 'private, no-store'
    return response


@require_access(ACCESS_ADVANCED_ADMIN)
def learner_audit_assignment_source_mark(request, profile_id, record_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    try:
        profile = _profile_in_scope(profile_id)
        if profile is None:
            return JsonResponse({'error': 'Assignment not found.'}, status=404)
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(f'''select a.id, a.title, a.evidence_links,
                       coalesce(a.source_data->>'Category', a.source_data->>'category',
                                a.source_data->>'type', a.source_data->>'kind'),
                       a.source_data->>'categoryCode', a.source_data->>'activityId'
                from "Last_audit".assigments_check a
                where a.id=%s and a.aptem_id=%s and {_ASSIGNMENT_CHECK_SQL}''',
                [record_id, profile.aptem_id])
            row = cursor.fetchone()
        from login.assignment_check import _source_files, assignment_record
        if row is None or not assignment_record({
                'title': row[1], 'category': row[3],
                'category_code': row[4], 'activity_id': row[5],
        }) or not any(file['url'] for file in _source_files(_json_data(row[2]))):
            return JsonResponse({'error': 'Assignment file not found.'}, status=404)
    except DatabaseError:
        return JsonResponse({'error': 'Assignment record is unavailable.'}, status=503)
    if request.content_type != 'application/json':
        return JsonResponse({'error': 'JSON is required.'}, status=400)
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)
    from learner_api.legacy_marking import DECISIONS
    decision = str(payload.get('decision') or '').strip().lower() if isinstance(payload, dict) else ''
    feedback = payload.get('feedback') if isinstance(payload, dict) else None
    if decision not in DECISIONS or not isinstance(feedback, str) or not feedback.strip() or len(feedback) > 20000:
        return JsonResponse({'error': 'Choose a valid decision and write feedback.'}, status=400)
    actor = request.login_account
    reviewed_by = f"{(actor.display_name or actor.email or 'Advanced Admin').strip()} (Advanced Admin)"[:255]
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''insert into login."Advanced_admin_assignment_check_marks"
                (aptem_id, check_record_id, decision, feedback, reviewed_by, reviewer_account_id)
                values (%s,%s,%s,%s,%s,%s) returning id, reviewed_at''',
                [str(profile.aptem_id), record_id, decision, feedback.strip(), reviewed_by, actor.id])
            mark_id, reviewed_at = cursor.fetchone()
    except DatabaseError:
        return JsonResponse({'error': 'Assignment marking is unavailable.'}, status=503)
    response = JsonResponse({'id': mark_id, 'status': decision,
                             'reviewedAt': reviewed_at.isoformat()}, status=201)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_access(ACCESS_ADVANCED_ADMIN)
def learner_audit_assignment_mark(request, profile_id, evidence_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    try:
        profile = _profile_in_scope(profile_id)
        if profile is None or _assignment_evidence(profile, evidence_id) is None:
            return JsonResponse({'error': 'Assignment evidence not found.'}, status=404)
    except DatabaseError:
        return JsonResponse({'error': 'Assignment evidence is unavailable.'}, status=503)
    if request.content_type != 'application/json':
        return JsonResponse({'error': 'JSON is required.'}, status=400)
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)
    from learner_api.legacy_marking import DECISIONS
    decision = str(payload.get('decision') or '').strip().lower() if isinstance(payload, dict) else ''
    feedback = payload.get('feedback') if isinstance(payload, dict) else None
    if decision not in DECISIONS or not isinstance(feedback, str) or not feedback.strip() or len(feedback) > 20000:
        return JsonResponse({'error': 'Choose a valid decision and write feedback.'}, status=400)
    actor = request.login_account
    reviewed_by = f"{(actor.display_name or actor.email or 'Advanced Admin').strip()} (Advanced Admin)"[:255]
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''insert into login."Advanced_admin_legacy_marks"
                (aptem_id, evidence_id, decision, feedback, reviewed_by, reviewer_account_id)
                values (%s,%s,%s,%s,%s,%s) returning id, reviewed_at''',
                [str(profile.aptem_id), evidence_id, decision, feedback.strip(), reviewed_by, actor.id])
            mark_id, reviewed_at = cursor.fetchone()
    except DatabaseError:
        return JsonResponse({'error': 'Assignment marking is unavailable.'}, status=503)
    return JsonResponse({'id': mark_id, 'status': decision,
                         'reviewedAt': reviewed_at.isoformat()}, status=201)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_audit_assignment_document(request, profile_id, evidence_id, part):
    if part not in {'file', 'report'}:
        return JsonResponse({'error': 'Invalid assignment document request.'}, status=400)
    try:
        profile = _profile_in_scope(profile_id)
        row = _assignment_evidence(profile, evidence_id) if profile else None
    except DatabaseError:
        return JsonResponse({'error': 'Assignment document is unavailable.'}, status=503)
    if row is None or not row[2 if part == 'file' else 3]:
        return JsonResponse({'error': 'Assignment document not found.'}, status=404)
    from learner_api.evidence_storage import azure_configured, get_read_sas
    if not azure_configured():
        return JsonResponse({'error': 'Document storage is not configured.'}, status=503)
    try:
        return JsonResponse({'url': get_read_sas('fetch-aptem-evidences',
                            row[2 if part == 'file' else 3])})
    except Exception:
        return JsonResponse({'error': 'Could not open the assignment document.'}, status=503)


@require_access(ACCESS_ADVANCED_ADMIN)
def learner_legacy_marking(request, profile_id, evidence_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    if profile.enrolment_id is None:
        return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)
    if request.content_type != 'application/json':
        return JsonResponse({'error': 'JSON is required.'}, status=400)
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)
    from learner_api.legacy_marking import DECISIONS
    decision = str(payload.get('decision') or '').strip().lower() if isinstance(payload, dict) else ''
    feedback = payload.get('feedback') if isinstance(payload, dict) else None
    # The coach marking workspace requires written feedback for every decision.
    if decision not in DECISIONS or not isinstance(feedback, str) or not feedback.strip() or len(feedback) > 20000:
        return JsonResponse({'error': 'Choose a valid decision and write feedback.'}, status=400)
    from learner_api.legacy_assignments import classified_rows
    activity_id = f'aptem:{profile.aptem_id}:evidence:{evidence_id}'
    try:
        rows = classified_rows('commercial', profile.enrolment_id, activity_id)
        if len(rows) != 1 or int(rows[0]['evidence_id']) != evidence_id:
            return JsonResponse({'error': 'Assessment not found.'}, status=404)
        actor = request.login_account
        reviewed_by = f"{(actor.display_name or actor.email or 'Advanced Admin').strip()} (Advanced Admin)"[:255]
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''insert into login."Advanced_admin_legacy_marks"
                (aptem_id, evidence_id, decision, feedback, reviewed_by, reviewer_account_id)
                values (%s,%s,%s,%s,%s,%s) returning id, reviewed_at''',
                [str(profile.aptem_id), evidence_id, decision, feedback.strip(), reviewed_by, actor.id])
            mark_id, reviewed_at = cursor.fetchone()
    except DatabaseError:
        return JsonResponse({'error': 'Historical marking is unavailable.'}, status=503)
    response = JsonResponse({'id': mark_id, 'status': decision, 'reviewedAt': reviewed_at.isoformat()}, status=201)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_legacy_assignment_document(request, profile_id, evidence_id, part):
    """Issue a short-lived URL only after checking both learner and evidence."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Assignment document not found.'}, status=404)
    if part not in {'file', 'report'}:
        return JsonResponse({'error': 'Invalid assignment document request.'}, status=400)
    from learner_api.legacy_assignments import classified_rows
    from learner_api.evidence_storage import azure_configured, get_download_sas, get_read_sas

    activity_id = f'aptem:{profile.aptem_id}:evidence:{evidence_id}'
    try:
        rows = classified_rows('commercial', profile.enrolment_id, activity_id)
    except DatabaseError:
        return JsonResponse({'error': 'Assignment document is unavailable.'}, status=503)
    if len(rows) != 1 or rows[0]['evidence_id'] != evidence_id:
        return JsonResponse({'error': 'Assignment document not found.'}, status=404)
    blob = rows[0].get(f'{part}_blob')
    if not blob:
        return JsonResponse({'error': 'Assignment document not found.'}, status=404)
    if not azure_configured():
        return JsonResponse({'error': 'Document storage is not configured.'}, status=503)
    filename = rows[0]['evidence_name'] if part == 'file' else 'Assessment report.pdf'
    try:
        response = JsonResponse({
            'url': get_read_sas('fetch-aptem-evidences', blob),
            'downloadUrl': get_download_sas('fetch-aptem-evidences', blob, filename=filename),
        })
    except Exception:
        return JsonResponse({'error': 'Could not open the assignment document.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_evidence_download(request, profile_id, file_id):
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Evidence not found.'}, status=404)
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''select blob_name from "Learner".evidence_files
                where id=%s and learner_kind=%s and learner_id=%s and status='approved' ''',
                [str(file_id), 'commercial', str(profile.enrolment_id)])
            row = cursor.fetchone()
    except DatabaseError:
        return JsonResponse({'error': 'Evidence record is unavailable.'}, status=503)
    if not row:
        return JsonResponse({'error': 'Evidence not found.'}, status=404)
    from learner_api.evidence_storage import azure_configured, get_download_sas
    if not azure_configured():
        return JsonResponse({'error': 'Evidence storage is not configured.'}, status=503)
    return JsonResponse({'url': get_download_sas(settings.AZURE_APPROVED_CONTAINER, row[0])})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_inclusion(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    from coach_api.support_tickets import (
        SupportTicketsUnavailable, TICKET_COLUMNS, _connect,
        _serialize_evidence, _serialize_notes, serialize_ticket,
    )
    import psycopg
    try:
        with _connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute('''select id, status, overall_risk_level, progress_tier,
                    programme, organization_name, coach_name, created_at, updated_at, master_report,
                    technology_report, visual_hearing_report, dyslexia_report,
                    adhd_report, social_anxiety_report, mood_learning_capacity_report,
                    notes, evidence, is_archived from public.learner_inclusiveness_reports
                    where learner_id=%s order by created_at desc''', [profile.aptem_id])
                reports = cursor.fetchall()
                cursor.execute('''select id, source_report_id, subject, details,
                    category, risk_level, status, progress_tier, created_at,
                    updated_at, notes, evidence, is_archived from public.inclusion_tickets
                    where learner_id=%s order by created_at desc''', [profile.aptem_id])
                tickets = cursor.fetchall()
                identity_email = (profile.email or '').strip().lower()
                if identity_email:
                    cursor.execute(f'''select {TICKET_COLUMNS} from public.support_tickets
                        where lower(trim(email))=%s order by created_at desc''',
                        [identity_email])
                    support_tickets = cursor.fetchall()
                else:
                    support_tickets = []
    except (SupportTicketsUnavailable, psycopg.Error):
        return JsonResponse({'error': 'Inclusion source is unavailable.'}, status=503)
    def iso(value):
        return value.isoformat() if value else None

    report_items = []
    for row in reports:
        master = _json_data(row['master_report'])
        master = master if isinstance(master, dict) else {}
        report_items.append({
            'id': str(row['id']), 'status': row['status'],
            'riskLevel': row['overall_risk_level'], 'progressTier': row['progress_tier'],
            'programme': row['programme'], 'organisation': row['organization_name'],
            'coach': row['coach_name'], 'archived': bool(row['is_archived']),
            'createdAt': iso(row['created_at']), 'updatedAt': iso(row['updated_at']),
            'reportHeader': master.get('reportHeader'),
            'overview': master.get('overview'),
            'executiveSummary': master.get('executiveSummary'),
            'keyFindings': master.get('keyFindings'),
            'supportPlan': master.get('supportPlan'),
            'priorityActions': master.get('priorityActions'),
            'riskRoadmap': master.get('riskRoadmap'),
            'reviewTimeline': master.get('reviewTimeline'),
            'managerBrief': master.get('managerBrief'),
            'professionalNote': master.get('professionalNote'),
            'sections': {
                'Technology': _json_data(row['technology_report']),
                'Visual and hearing': _json_data(row['visual_hearing_report']),
                'Dyslexia': _json_data(row['dyslexia_report']),
                'ADHD': _json_data(row['adhd_report']),
                'Social anxiety': _json_data(row['social_anxiety_report']),
                'Mood and learning': _json_data(row['mood_learning_capacity_report']),
            },
            'notes': _serialize_notes(row['notes']),
            'evidence': _serialize_evidence(row['evidence']),
        })
    ticket_items = [
        {'id': str(row['id']), 'sourceReportId': row['source_report_id'],
         'subject': row['subject'], 'details': row['details'],
         'category': row['category'], 'riskLevel': row['risk_level'],
         'status': row['status'], 'progressTier': row['progress_tier'],
         'archived': bool(row['is_archived']),
         'createdAt': iso(row['created_at']), 'updatedAt': iso(row['updated_at']),
         'notes': _serialize_notes(row['notes']),
         'evidence': _serialize_evidence(row['evidence'])}
        for row in tickets
    ]
    response = JsonResponse({
        'reports': report_items, 'tickets': ticket_items,
        'supportTickets': [
            {**serialize_ticket(row, read_only=True), 'archived': bool(row['is_archived'])}
            for row in support_tickets
        ],
    })
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_inclusion_report_pdf(request, profile_id, report_id):
    """Download only a saved screening report belonging to the scoped learner."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    from coach_api.support_tickets import SupportTicketsUnavailable, _connect
    from login.inclusion_report_pdf import build_inclusion_report_pdf
    import psycopg

    try:
        with _connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute('''select master_report, learner_name, learner_email,
                    programme, organization_name, created_at
                    from public.learner_inclusiveness_reports
                    where id=%s and learner_id=%s''', [report_id, profile.aptem_id])
                row = cursor.fetchone()
    except (SupportTicketsUnavailable, psycopg.Error):
        return JsonResponse({'error': 'Inclusion source is unavailable.'}, status=503)
    if not row:
        return JsonResponse({'error': 'Report not found for this learner.'}, status=404)
    master = _json_data(row['master_report'])
    if not isinstance(master, dict) or not master:
        return JsonResponse({'error': 'Saved report is unavailable.'}, status=404)
    try:
        pdf = build_inclusion_report_pdf(
            master, fallback_name=row['learner_name'],
            fallback_email=row['learner_email'], fallback_programme=row['programme'],
            fallback_organisation=row['organization_name'],
            fallback_date=row['created_at'],
        )
    except (ValueError, TypeError, RuntimeError):
        return JsonResponse({'error': 'Could not render the saved report.'}, status=503)
    date = row['created_at'].date().isoformat() if row['created_at'] else 'undated'
    response = HttpResponse(pdf, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="inclusiveness-report-{profile_id}-{date}.pdf"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_coaching_sessions(request, profile_id):
    """AI reports from the external coaching app, joined by exact Aptem ID."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    dsn = _coaching_connection_string()
    if not dsn:
        return JsonResponse({'error': 'Coaching session source is unavailable.'}, status=503)
    import psycopg
    from psycopg.rows import dict_row

    try:
        with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10,
                             options='-c default_transaction_read_only=on') as connection:
            with connection.cursor() as cursor:
                cursor.execute('''select c.id, c.component_id, c.component_type,
                    c.planned_date, c.actual_start_at, c.session_status,
                    c.ai_status, r.ai_status as report_status, r.report
                    from public.all_sessions_cache c
                    left join public.report_ai r on r.session_id=c.id
                    where c.learner_id=%s and c.component_type=any(%s)
                    order by coalesce(c.actual_start_at::date,c.planned_date) desc nulls last,
                             c.id desc''', [profile.aptem_id,
                                          ['monthly_coaching', 'progress_review']])
                rows = cursor.fetchall()
    except (psycopg.Error, OSError):
        return JsonResponse({'error': 'Coaching session source is unavailable.'}, status=503)
    response = JsonResponse({'items': [
        {'id': str(row['id']), 'componentId': row['component_id'],
         'family': 'mcm' if row['component_type'] == 'monthly_coaching' else 'pr',
         'plannedDate': row['planned_date'].isoformat() if row['planned_date'] else None,
         'actualStartAt': row['actual_start_at'].isoformat() if row['actual_start_at'] else None,
         'status': row['session_status'], 'aiStatus': row['report_status'] or row['ai_status'],
         'report': _json_data(row['report']) if row['report_status'] == 'completed' else None}
        for row in rows
    ]})
    response['Cache-Control'] = 'private, no-store'
    return response


def _review_day(value):
    if value is None:
        return None
    if hasattr(value, 'date'):
        value = value.date()
    text = str(value)
    return text[:10] if len(text) >= 10 else None


def _attach_archived_review_ids(groups, archive_rows, aptem_learner_id):
    """Link Aptem PDFs only for a unique learner/family/completed/planned day."""
    from learner_api.review_history import REVIEW_TYPES

    archived = defaultdict(list)
    for row in archive_rows:
        data = _json_data(row.get('review_data')) or {}
        if not isinstance(data, dict):
            continue
        learner_id = str(data.get('aptem_learner_id') or '').strip()
        if learner_id and learner_id != str(aptem_learner_id):
            continue
        family = 'mcm' if row['review_type'] in REVIEW_TYPES['monthly-coaching'] else 'pr'
        completed = _review_day(row.get('completed_date'))
        planned = _review_day(row.get('planned_scheduled_date'))
        aptem_review_id = str(row.get('aptem_review_id') or '').strip()
        if completed and aptem_review_id:
            archived[(family, completed, planned)].append(aptem_review_id)

    source_counts = Counter((family, row['completedDate'], row['plannedDate'])
                            for family in ('pr', 'mcm') for row in groups[family])
    for family in ('pr', 'mcm'):
        for row in groups[family]:
            key = (family, row['completedDate'], row['plannedDate'])
            if source_counts[key] == 1 and len(archived[key]) == 1:
                row['aptemReviewId'] = archived[key][0]


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_coaching_reviews(request, profile_id):
    """Aptem PR and MCM components from the configured coaching database."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    dsn = _coaching_connection_string()
    if not dsn:
        return JsonResponse({'error': 'Coaching review source is unavailable.'}, status=503)
    import psycopg
    from psycopg.rows import dict_row

    try:
        with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10,
                             options='-c default_transaction_read_only=on') as connection:
            with connection.cursor() as cursor:
                cursor.execute('''select id, component_type, component_name,
                    status, planned_date, completed_date, case_owner, manager_name,
                    learner_name, learner_email, program_name, group_name
                    from public.aptem_session_components
                    where learner_id=%s and (
                        (component_type='monthly_coaching' and status='Completed')
                        or (component_type='progress_review'
                            and status=any(%s)))
                    order by completed_date desc nulls last, id desc''',
                               [profile.aptem_id, ['Completed', 'Awaiting Signature']])
                rows = cursor.fetchall()
    except (psycopg.Error, OSError):
        return JsonResponse({'error': 'Coaching review source is unavailable.'}, status=503)

    groups = {'pr': [], 'mcm': []}
    for row in rows:
        family = 'mcm' if row['component_type'] == 'monthly_coaching' else 'pr'
        groups[family].append({
            'id': str(row['id']), 'componentId': row['id'],
            'aptemReviewId': '',
            'name': row['component_name'] or ('MCM' if family == 'mcm' else 'Progress Review'),
            'type': 'Monthly Coaching Meeting' if family == 'mcm' else 'Progress Review',
            'status': 'completed' if row['status'] == 'Completed' else 'awaiting-signature',
            'plannedDate': row['planned_date'].isoformat() if row['planned_date'] else None,
            'completedDate': row['completed_date'].isoformat() if row['completed_date'] else None,
            'coachName': row['case_owner'], 'managerName': row['manager_name'],
            'learnerName': row['learner_name'], 'learnerEmail': row['learner_email'],
            'programme': row['program_name'], 'group': row['group_name'],
            'sections': [], 'aiCoachingReport': None,
        })
    from learner_api.review_history import REVIEW_TYPES, _review_rows
    try:
        with connections['default'].cursor() as cursor:
            archive_rows = (_review_rows(cursor, profile.id, REVIEW_TYPES['monthly-coaching'])
                            + _review_rows(cursor, profile.id, None))
        _attach_archived_review_ids(groups, archive_rows, profile.aptem_id)
    except DatabaseError:
        groups['documentLookupError'] = 'Original Aptem PDF lookup is unavailable.'
    response = JsonResponse(groups)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_coaching_session_detail(request, profile_id, session_id):
    """Read one learner's meeting evidence, without exposing other attendees."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    dsn = _coaching_connection_string()
    if not dsn:
        return JsonResponse({'error': 'Coaching session source is unavailable.'}, status=503)
    import psycopg
    from psycopg.rows import dict_row

    try:
        with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10,
                             options='-c default_transaction_read_only=on') as connection:
            with connection.cursor() as cursor:
                cursor.execute('''select c.id, c.meeting_id, c.learner_name,
                    c.learner_email, c.program_name, c.group_name, c.coach_name,
                    c.manager_name, c.manager_email, c.component_type,
                    c.planned_date, c.actual_start_at, c.actual_end_at,
                    c.session_status, c.learner_attended, c.manager_attended_raw,
                    c.has_transcript, c.ai_status, r.ai_status as report_status,
                    r.report
                    from public.all_sessions_cache c
                    left join public.report_ai r on r.session_id=c.id
                    where c.id=%s and c.learner_id=%s
                    and c.component_type=any(%s)''',
                               [session_id, profile.aptem_id,
                                ['monthly_coaching', 'progress_review']])
                row = cursor.fetchone()
                if row is None:
                    return JsonResponse({'error': 'Meeting not found.'}, status=404)
                transcript = None
                attendance = None
                attendees = []
                if row['meeting_id']:
                    cursor.execute('''select content, duration_seconds, status
                        from public.meeting_transcripts where meeting_id=%s
                        order by updated_at desc limit 1''', [row['meeting_id']])
                    transcript = cursor.fetchone()
                    cursor.execute('''select id, status, total_participant_count,
                        meeting_start_at, meeting_end_at
                        from public.attendance_reports where meeting_id=%s
                        order by updated_at desc limit 1''', [row['meeting_id']])
                    attendance = cursor.fetchone()
                    if attendance:
                        cursor.execute('''select email, total_attendance_seconds,
                            intervals from public.attendance_records
                            where report_id=%s and (lower(email)=lower(%s)
                                or lower(email)=lower(%s))''',
                                       [attendance['id'], row['learner_email'],
                                        row['manager_email']])
                        attendees = cursor.fetchall()
    except (psycopg.Error, OSError):
        return JsonResponse({'error': 'Coaching session source is unavailable.'}, status=503)

    def attendee(email):
        return next(({'attended': True, 'durationSeconds': item['total_attendance_seconds'],
                      'intervals': _json_data(item['intervals'])}
                     for item in attendees if email and item['email'] and
                     item['email'].casefold() == email.casefold()), None)

    response = JsonResponse({
        'id': str(row['id']), 'learnerName': row['learner_name'],
        'learnerEmail': row['learner_email'], 'programme': row['program_name'],
        'group': row['group_name'], 'coachName': row['coach_name'],
        'managerName': row['manager_name'], 'managerEmail': row['manager_email'],
        'family': 'mcm' if row['component_type'] == 'monthly_coaching' else 'pr',
        'plannedDate': row['planned_date'].isoformat() if row['planned_date'] else None,
        'actualStartAt': row['actual_start_at'].isoformat() if row['actual_start_at'] else None,
        'actualEndAt': row['actual_end_at'].isoformat() if row['actual_end_at'] else None,
        'status': row['session_status'], 'meetingId': str(row['meeting_id']) if row['meeting_id'] else None,
        'learnerAttended': row['learner_attended'],
        'managerAttended': row['manager_attended_raw'],
        'transcript': {'content': transcript['content'], 'status': transcript['status'],
                       'durationSeconds': transcript['duration_seconds']} if transcript else None,
        'attendance': {'status': attendance['status'],
                       'participantCount': attendance['total_participant_count'],
                       'startAt': attendance['meeting_start_at'].isoformat()
                       if attendance['meeting_start_at'] else None,
                       'endAt': attendance['meeting_end_at'].isoformat()
                       if attendance['meeting_end_at'] else None,
                       'learner': attendee(row['learner_email']),
                       'manager': attendee(row['manager_email'])} if attendance else None,
        'aiStatus': row['report_status'] or row['ai_status'],
        'report': _json_data(row['report']) if row['report_status'] == 'completed' else None,
    })
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_quality(request, profile_id):
    """Match both QA sources by the learner roster ID and lecture date."""
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    import psycopg
    from psycopg.rows import dict_row
    from learner_api.attendance import _kbc_attendance_connection_string
    dsn = _kbc_attendance_connection_string()
    if not dsn:
        return JsonResponse({'error': 'Lecture quality source is not configured.'}, status=503)
    roster = '''exists (select 1 from jsonb_array_elements(
        case when jsonb_typeof(q.lms_students->'students')='array'
             then q.lms_students->'students' else '[]'::jsonb end
        ) student where student->>'ID'=%s)'''
    try:
        with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10) as connection:
            with connection.cursor() as cursor:
                cursor.execute(f'''select session_id, date as session_date, subject,
                    trainer, teaching_quality_rating, teaching_quality_comments,
                    overall_judgement, lms_module, duration_score,
                    engagement_score, met_count, partial_count, not_met_count,
                    strengths, areas_for_development, ksb_coverage,
                    duration, lms_students_count, null::integer as attended_count,
                    null::text as observation_state,
                    coalesce((select jsonb_agg(jsonb_build_object(
                        'order', i.checklist_order, 'item', i.checklist_item,
                        'status', i.status, 'evidence', i.evidence
                    ) order by i.checklist_order)
                    from public.qa_doctors_checklist_items i
                    where i.session_id=q.session_id), '[]'::jsonb) as checklist
                    from public.qa_doctors_sessions q where {roster} and date is not null
                    order by date desc''', [str(profile.aptem_id)])
                tutor = cursor.fetchall()
                cursor.execute(f'''select session_id, canonical_session_date as session_date,
                    subject, trainer, teaching_quality_rating,
                    teaching_quality_comments, overall_judgement, lms_module,
                    duration_score, engagement_score, met_count, partial_count,
                    not_met_count, strengths, areas_for_development, ksb_coverage,
                    duration, lms_students_count, attended_count,
                    case when render_status='RENDERED' then 'Observed'
                         when render_status='RENDERED_NON_DELIVERED' then 'Not delivered'
                         else null end as observation_state,
                    coalesce((select jsonb_agg(jsonb_build_object(
                        'order', i.checklist_order, 'item', i.checklist_item,
                        'status', i.status, 'evidence', i.evidence
                    ) order by i.checklist_order)
                    from public.lecture_qa_rendered_checklist_items i
                    where i.rendered_session_id=q.rendered_session_id), '[]'::jsonb) as checklist
                    from public.lecture_qa_rendered_sessions q where {roster}
                    and canonical_session_date is not null
                    order by canonical_session_date desc''', [str(profile.aptem_id)])
                lecture = cursor.fetchall()
    except (psycopg.Error, OSError):
        return JsonResponse({'error': 'Lecture quality source is unavailable.'}, status=503)
    def serialize(row, source):
        return {'source': source, 'sessionId': row['session_id'],
                'date': row['session_date'].isoformat(), 'subject': row['subject'],
                'trainer': row['trainer'], 'rating': row['teaching_quality_rating'],
                'comments': row['teaching_quality_comments'],
                'judgement': row['overall_judgement'], 'module': row['lms_module'],
                'durationScore': row['duration_score'],
                'engagementScore': row['engagement_score'],
                'metCount': row['met_count'], 'partialCount': row['partial_count'],
                'notMetCount': row['not_met_count'],
                'duration': row.get('duration'),
                'learnersEnrolled': row.get('lms_students_count'),
                'learnersAttended': row.get('attended_count'),
                'observationState': row.get('observation_state'),
                'checklist': _json_data(row.get('checklist')) or [],
                'strengths': _json_data(row['strengths']),
                'areasForDevelopment': _json_data(row['areas_for_development']),
                'ksbCoverage': _json_data(row['ksb_coverage'])}
    return JsonResponse({'tutor': [serialize(row, 'tutor') for row in tutor],
                         'lecture': [serialize(row, 'lecture') for row in lecture]})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_reviews(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    from learner_api.review_history import REVIEW_TYPES, _review_rows, _sections_by_review, _serialize_review
    from coach_api.models import ImportedReviewInstance, MigratedReviewSignature
    try:
        with connections['default'].cursor() as cursor:
            groups = {}
            for family, category in (('pr', 'progress-review'), ('mcm', 'monthly-coaching')):
                rows = _review_rows(cursor, profile.id, REVIEW_TYPES[category])
                sections = _sections_by_review(cursor, [row['id'] for row in rows])
                groups[family] = [_serialize_review(row, sections, historical_presentation=True)
                                  for row in rows]
    except DatabaseError:
        return JsonResponse({'error': 'Review history is unavailable.'}, status=503)
    # A review is displayed only when its imported Aptem identity belongs to
    # this exact scoped learner, never on a name/date similarity.
    for family in groups:
        groups[family] = [row for row in groups[family]
                          if not row.get('aptemLearnerId') or row['aptemLearnerId'] == str(profile.aptem_id)]
    review_ids = [int(row['id']) for rows in groups.values() for row in rows]
    try:
        overlays = list(ImportedReviewInstance.objects.filter(
            learner_id=profile.id, source_review_id__in=review_ids,
        ).only('id', 'source_review_id', 'meeting_intelligence', 'signature_requirements'))
        signed = {}
        for signature in MigratedReviewSignature.objects.filter(
            overlay_id__in=[item.id for item in overlays],
        ).values('overlay_id', 'role', 'signed_at'):
            signed.setdefault(signature['overlay_id'], {})[signature['role']] = signature['signed_at']
    except DatabaseError:
        return JsonResponse({'error': 'Review details are unavailable.'}, status=503)
    by_source = {item.source_review_id: item for item in overlays}
    for family, rows in groups.items():
        for row in rows:
            overlay = by_source.get(int(row['id']))
            intelligence = (overlay.meeting_intelligence or {}) if overlay else {}
            row['aiCoachingReport'] = intelligence.get('summary') or intelligence.get('aiSummaryOriginal')
            row['signatures'] = _review_signature_summary(
                family, overlay.signature_requirements if overlay else None,
                signed.get(overlay.id, {}) if overlay else None,
            )
    return JsonResponse(groups)


def _review_signature_summary(family, requirements, signed):
    """Expose confirmed sign-off dates only, never signature images or inferred Aptem sign-offs."""
    defaults = {'advisor': True, 'participant': True, 'employer': family == 'pr'}
    rules = {**defaults, **(requirements or {})}
    result = {}
    for label, role in (('coach', 'advisor'), ('student', 'participant'), ('manager', 'employer')):
        signed_at = (signed or {}).get(role)
        result[label] = {
            'required': rules.get(role) is True,
            'signed': signed_at is not None if signed is not None else None,
            'signedAt': signed_at.isoformat() if signed_at else None,
        }
    return result


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_review_pdf(request, profile_id, aptem_review_id):
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Review document not found.'}, status=404)
    from learner_api.aptem_review_pdf import imported_review_for_source, original_review_pdf
    from login.aptem_signed_reviews import read_synced_review_pdf
    from coach_api.models import MigratedReviewDocument
    try:
        source = EnrolmentUser.all_learners.get(pk=profile.enrolment_id)
        review = imported_review_for_source(source, aptem_review_id, kind='commercial')
        if review is None or (review.get('aptemLearnerId') and
                              review['aptemLearnerId'] != str(profile.aptem_id)):
            return JsonResponse({'error': 'Review document not found.'}, status=404)
        local_pdf = MigratedReviewDocument.objects.filter(
            overlay__learner_id=profile.id,
            overlay__source_review_id=int(review['id']),
        ).values_list('pdf_bytes', flat=True).first()
        content = (bytes(local_pdf) if local_pdf else
                   read_synced_review_pdf(review) or original_review_pdf(review))
    except (EnrolmentUser.DoesNotExist, DatabaseError):
        return JsonResponse({'error': 'Review document is unavailable.'}, status=503)
    if content is None:
        return JsonResponse({'error': 'Original review PDF is unavailable.'}, status=404)
    response = HttpResponse(content, content_type='application/pdf')
    response['Content-Disposition'] = 'inline; filename="review.pdf"'
    response['Cache-Control'] = 'private, no-store'
    return response


def _scoped_aptem_pdf(profile, aptem_review_id):
    from learner_api.aptem_review_pdf import imported_review_for_source, original_review_pdf
    from login.aptem_signed_reviews import read_synced_review_pdf

    source = EnrolmentUser.all_learners.get(pk=profile.enrolment_id)
    review = imported_review_for_source(source, aptem_review_id, kind='commercial')
    if review is None or (review.get('aptemLearnerId') and
                          review['aptemLearnerId'] != str(profile.aptem_id)):
        return None, None
    return review, read_synced_review_pdf(review) or original_review_pdf(review)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_original_review_pdf(request, profile_id, aptem_review_id):
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Review document not found.'}, status=404)
    try:
        review, content = _scoped_aptem_pdf(profile, aptem_review_id)
    except (EnrolmentUser.DoesNotExist, DatabaseError):
        return JsonResponse({'error': 'Original review PDF is unavailable.'}, status=503)
    if review is None or content is None:
        return JsonResponse({'error': 'Original review PDF is unavailable.'}, status=404)
    response = HttpResponse(content, content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="aptem-review.pdf"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_review_pdf_signatures(request, profile_id, aptem_review_id):
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Review document not found.'}, status=404)
    try:
        review, content = _scoped_aptem_pdf(profile, aptem_review_id)
    except (EnrolmentUser.DoesNotExist, DatabaseError):
        return JsonResponse({'error': 'Original review PDF is unavailable.'}, status=503)
    if review is None or content is None:
        return JsonResponse({'error': 'Original review PDF is unavailable.'}, status=404)
    from login.aptem_review_signatures import progress_review_pdf_signatures
    response = JsonResponse({'signatures': progress_review_pdf_signatures(content)})
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_eligibility(request, profile_id):
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    from learner_api.models import EnrolmentReview
    from learner_api.review_history import _review_rows, _sections_by_review, _serialize_review
    try:
        native = EnrolmentReview.objects.filter(
            learner_kind='commercial', learner_id=profile.enrolment_id,
            review_type='eligibility-review',
        ).only('event_key', 'review_label', 'scheduled_date', 'status',
               'form_answers', 'section_status', 'form_completed').order_by('-scheduled_date')
        native_rows = [{
            'eventKey': row.event_key, 'label': row.review_label,
            'date': row.scheduled_date.isoformat() if row.scheduled_date else None,
            'status': row.status, 'answers': row.form_answers or {},
            'sectionStatus': row.section_status or {}, 'completed': row.form_completed,
        } for row in native]
        with connections['default'].cursor() as cursor:
            all_imported = _review_rows(cursor, profile.id, None)
            imported = [row for row in all_imported
                        if 'eligibility' in (row['review_type'] or '').casefold()]
            sections = _sections_by_review(cursor, [row['id'] for row in imported])
        imported_rows = [_serialize_review(row, sections, historical_presentation=True)
                         for row in imported]
        imported_rows = [row for row in imported_rows
                         if not row.get('aptemLearnerId') or row['aptemLearnerId'] == str(profile.aptem_id)]
    except DatabaseError:
        return JsonResponse({'error': 'Eligibility records are unavailable.'}, status=503)
    return JsonResponse({'native': native_rows, 'imported': imported_rows})


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def learner_eligibility_form(request, profile_id, event_key):
    """Read one native eligibility form for the scoped learner without starting it."""
    profile = _profile_in_scope(profile_id)
    if profile is None or profile.enrolment_id is None:
        return JsonResponse({'error': 'Eligibility review not found.'}, status=404)
    from learner_api.models import EnrolmentReview
    from learner_api.review_form import _serialize_form

    try:
        review = EnrolmentReview.objects.filter(
            learner_kind='commercial', learner_id=profile.enrolment_id,
            review_type='eligibility-review', event_key=event_key,
        ).first()
        if review is None:
            return JsonResponse({'error': 'Eligibility review not found.'}, status=404)
        learner = EnrolmentUser.all_learners.get(pk=profile.enrolment_id)
        response = JsonResponse(_serialize_form(review, learner, None))
    except (EnrolmentUser.DoesNotExist, DatabaseError):
        return JsonResponse({'error': 'Eligibility review is unavailable.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_access(ACCESS_ADVANCED_ADMIN)
def learner_submissions(request, profile_id, submission_id=None):
    """The coach's submission/decision contract, limited to one approved learner."""
    if request.method not in {'GET', 'PATCH'}:
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    try:
        profile = _profile_in_scope(profile_id)
        if profile is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        if profile.enrolment_id is None:
            return JsonResponse({'error': 'Learner LMS link is unavailable.'}, status=409)
        from coach_api.views import (
            MARKING_QUEUE_COLUMNS, MARKING_QUEUE_EXCLUDE_DRAFTS_SQL,
            serialize_marking_submission,
        )
        from learner_api.submission_audit import (
            SUBMISSION_AUDIT_COLUMNS, SUBMISSION_AUDIT_SQL, record_submission_row,
        )
        if request.method == 'GET':
            with connections['enrolment'].cursor() as cursor:
                clause = ' and id = %s' if submission_id else ''
                args = [str(profile.enrolment_id), *([str(submission_id)] if submission_id else [])]
                cursor.execute(f'''select {MARKING_QUEUE_COLUMNS}
                    from "Learner".learning_reflection_submissions
                    where learner_id = %s and {MARKING_QUEUE_EXCLUDE_DRAFTS_SQL}{clause}
                    order by submitted_at desc nulls last, id desc''', args)
                columns = [column[0] for column in cursor.description]
                rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            if submission_id:
                return JsonResponse({'item': _admin_marking_submission(rows[0], serialize_marking_submission)}, status=200) if rows else JsonResponse({'error': 'Submission not found.'}, status=404)
            return JsonResponse({'items': [_admin_marking_submission(row, serialize_marking_submission) for row in rows]})

        if submission_id is None:
            return JsonResponse({'error': 'Choose a submission.'}, status=400)
        if request.content_type != 'application/json':
            return JsonResponse({'error': 'JSON is required.'}, status=400)
        try:
            payload = json.loads(request.body)
        except (ValueError, UnicodeDecodeError):
            return JsonResponse({'error': 'Invalid JSON.'}, status=400)
        if not isinstance(payload, dict):
            return JsonResponse({'error': 'Invalid decision.'}, status=400)
        decision = str(payload.get('decision') or '').strip().lower()
        feedback = payload.get('feedback', '')
        if (decision not in {'accepted', 'partial', 'referred', 'escalated', 'rejected'}
                or not isinstance(feedback, str) or len(feedback) > 20000
                or (decision != 'accepted' and not feedback.strip())):
            return JsonResponse({'error': 'Choose a valid decision and provide required feedback.'}, status=400)
        account = request.login_account
        actor = (account.display_name or account.email or 'Advanced Admin').strip()
        reviewed_by = f'{actor} (Advanced Admin)'[:255]
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(f'''update "Learner".learning_reflection_submissions
                set status=%s, coach_feedback=%s, reviewed_by=%s, reviewed_at=%s
                where id=%s and learner_id=%s and {MARKING_QUEUE_EXCLUDE_DRAFTS_SQL}
                returning {SUBMISSION_AUDIT_SQL}''',
                [decision, feedback, reviewed_by, timezone.now(), str(submission_id), str(profile.enrolment_id)])
            updated = cursor.fetchone()
        if not updated:
            return JsonResponse({'error': 'Submission not found.'}, status=404)
        record_submission_row(updated)
        row = dict(zip(SUBMISSION_AUDIT_COLUMNS, updated))
        from learner_api.marking_tally import refresh_tally_for_submission
        refresh_tally_for_submission(row['learner_kind'], row['learner_id'])
        return JsonResponse({'id': str(row['id']), 'status': row['status'],
                             'reviewedAt': row['reviewed_at'].isoformat() if row['reviewed_at'] else None})
    except DatabaseError:
        return JsonResponse({'error': 'Marking records are unavailable.'}, status=503)
