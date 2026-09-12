"""Monthly journals: retained transition reports plus live, owner-scoped activity.

Reads never create records. New signatures use the existing signoff table with
an LMS identity namespace and a separate key for each reviewed revision.
"""
import base64
import json
import logging
import re
from collections import defaultdict
from functools import wraps

from django.db import DatabaseError, transaction
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.utils.http import content_disposition_header
from django.utils import timezone
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect

from login.permissions import login_required
from old_otjh import repository as old_repo, service as old, storage
from old_otjh.views import public_detail, public_state
from . import monthly_log_sources as sources
from .subject_content import ContentUnavailable

logger = logging.getLogger(__name__)
VERSION = 'lms-monthly-log-v1'


def endpoint(*methods):
    def decorate(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            try:
                if request.method not in methods:
                    raise old.ServiceError('Method not allowed.', 'method_not_allowed', 405)
                response = view(request, *args, **kwargs)
            except old.ServiceError as error:
                response = JsonResponse({'error': str(error), 'code': error.code}, status=error.status)
            except DatabaseError:
                logger.exception('Monthly logs could not be loaded')
                response = JsonResponse({'error': 'Monthly logs are temporarily unavailable. Please try again.'}, status=503)
            except ContentUnavailable as error:
                response = JsonResponse({'error': str(error)}, status=503)
            response['Cache-Control'] = 'private, no-store'
            response['Vary'] = 'Cookie'
            return response
        return login_required(csrf_protect(wrapped))
    return decorate


def scope(request, learner_id):
    account = request.login_account
    if account.role == 'learner':
        if account.subject_type != 'learner' or str(account.subject_id) != str(learner_id):
            raise old.ServiceError('Learner not found.', 'not_found', 404)
        learner = old.resolve_authenticated_learner(account)
        role = 'learner'
    else:
        actor = old.coach_actor(account)
        if actor['role'] == 'monitor':
            raise old.ServiceError('Coach access is required.', 'forbidden', 403)
        learner = old.resolve_record(learner_id)
        role = actor['role']
    profile = sources.profile(learner_id)
    coach_email = old.normalize((profile or {}).get('coach_email') or learner.get('coach_email'))
    if role == 'coach' and coach_email != actor['email']:
        raise old.ServiceError('Learner not found.', 'not_found', 404)
    # Admin view-as is a read-only narrowing of the real account's permissions.
    from coach_api.auth import _requested_view_as_email
    learner_preview = request.GET.get('perspective') == 'learner' and role != 'learner'
    if learner_preview and request.method != 'GET':
        raise old.ServiceError('The learner preview is read-only.', 'forbidden', 403)
    view_as = _requested_view_as_email(request) if role == 'admin' and not learner_preview else None
    if view_as and (coach_email != old.normalize(view_as) or request.method != 'GET'):
        raise old.ServiceError('This coach workspace is read-only.', 'forbidden', 403)
    return {**learner, '_profile': profile, '_view_as': bool(view_as) or learner_preview}, role


def valid_month(month):
    if not re.fullmatch(r'[0-9]{4}-(0[1-9]|1[0-2])', month or '') or month > timezone.localdate().strftime('%Y-%m'):
        raise old.ServiceError('Choose a valid report month.')


def require_closed_month(month):
    if month >= timezone.localdate().strftime('%Y-%m'):
        raise old.ServiceError('This monthly log will be available after the month ends.', 'month_not_closed', 409)


def legacy_summary(learner):
    if not learner.get('aptem_id'):
        return {'months': []}
    # Include every retained month, without starting/finalizing a transition on GET.
    return public_state(old.summary({**learner, '_read_only': True}))


def signatures(learner):
    return old_repo.query(f'''SELECT report_month, signer_role, signer_name,
        signed_at, snapshot_hash,
        CASE WHEN signature_data LIKE '{{%%' THEN signature_data::jsonb->>'url'
             ELSE signature_data END AS url
        FROM {old_repo.SIGNOFFS} WHERE learner_id=%s AND audit_version=%s
          AND review_confirmed IS TRUE ORDER BY signed_at DESC, id DESC''',
        [f"lms:{learner['id']}", VERSION])


def month_state(month, rows, signs, training_plan_target=None):
    digest = old.digest(rows)
    # As in Previous learning record, source updates never erase a saved
    # signature or revoke completion. Each capture retains its reviewed rows.
    matching = [s for s in signs if s['report_month'] == month]
    def sign(role):
        return next(({k: s[k] for k in ('signed_at', 'signer_name', 'url')}
                     for s in matching if s['signer_role'] == role), None)
    student, coach = sign('learner'), sign('coach')
    return {'month': month, 'source': 'lms', 'is_required': False,
            'status': 'complete' if student else 'awaiting_signature',
            'student_signature': student, 'coach_signature': coach,
            'row_count': len(rows), 'planned_hours': sum(float(r['planned_hours'] or 0) for r in rows),
            'actual_hours': sum(float(r['actual_hours'] or 0) for r in rows if r['accepted']),
            'not_accepted_hours': sum(float(r['actual_hours'] or 0) for r in rows if not r['accepted']),
            'total_actual_hours': sum(float(r['actual_hours'] or 0) for r in rows),
            'training_plan_target': training_plan_target, 'pending_revisions': 0, 'can_complete': False,
            'source_finalization': None, 'snapshot_digest': digest}


def current_months(learner, signs=()):
    grouped = defaultdict(list)
    open_month = timezone.localdate().strftime('%Y-%m')
    # A signed month remains in the journal even if its last source row is
    # subsequently removed, just as retained previous-record months do.
    for signature in signs:
        month = signature['report_month']
        if month < open_month and (not learner.get('aptem_id') or month > old_repo.CUTOFF):
            grouped[month] = []
    for row in sources.activity_rows(learner):
        month = row['activity_date'][:7]
        if month >= open_month:
            continue
        # Historical months continue to use the Previous learning record source.
        if learner.get('aptem_id') and month <= old_repo.CUTOFF:
            continue
        grouped[month].append(row)
    for rows in grouped.values():
        rows.sort(key=lambda row: (row['activity_date'], row['source_ref']))
    return grouped


def summary_data(learner):
    retained = legacy_summary(learner)
    signs = signatures(learner)
    months = [{**m, 'source': 'legacy'} for m in retained['months']]
    months.extend(month_state(month, rows, signs, sources.monthly_target(learner, month))
                  for month, rows in current_months(learner, signs).items())
    months.sort(key=lambda m: m['month'])
    profile = learner.get('_profile') or {}
    return {'learner': {'id': learner['id'], 'aptem_id': learner.get('aptem_id'),
                       'name': learner['name'], 'programme': learner['programme'],
                       'coach_name': profile.get('coach_name') or learner.get('coach_name')},
            'months': months, 'total_months': len(months),
            'completed_months': sum(m['status'] == 'complete' for m in months),
            'read_only': learner['_view_as']}


def detail_data(learner, month):
    valid_month(month)
    if learner.get('aptem_id') and month <= old_repo.CUTOFF:
        return {**public_detail(learner, old.month_detail({**learner, '_read_only': True}, month)), 'source': 'legacy'}
    require_closed_month(month)
    signs = signatures(learner)
    rows = current_months(learner, signs).get(month)
    if rows is None:
        raise old.ServiceError('No activities are recorded for this month.', 'not_found', 404)
    profile = learner.get('_profile') or {}
    report_profile = old_repo.report_profile(learner) if learner.get('aptem_id') else {
        'start_date': profile.get('start_date'), 'planned_end_date': profile.get('end_date'),
        'first_evidence_date': sources.first_evidence_date(learner['id'])}
    return {**month_state(month, rows, signs, sources.monthly_target(learner, month)), 'rows': rows,
            'profile': report_profile}


@endpoint('GET')
def summary(request, learner_id):
    learner, _ = scope(request, learner_id)
    return JsonResponse({**summary_data(learner), 'csrf_token': get_token(request)})


@endpoint('GET')
def detail(request, learner_id, month):
    learner, _ = scope(request, learner_id)
    return JsonResponse(detail_data(learner, month))


@endpoint('GET')
def content(request, learner_id, month, row_id):
    learner, _ = scope(request, learner_id)
    report = detail_data(learner, month)
    if report['source'] == 'legacy':
        return JsonResponse(old.activity_content({**learner, '_read_only': True}, month, row_id))
    row = next((r for r in report['rows'] if r['id'] == row_id), None)
    if row is None:
        raise old.ServiceError('Activity not found.', 'not_found', 404)
    return JsonResponse(sources.activity_content(learner, row))


@endpoint('GET')
def document(request, learner_id, file_id):
    scope(request, learner_id)
    rows = old_repo.query('''SELECT blob_name,original_filename,content_type FROM "Learner".evidence_files
        WHERE id=%s AND learner_id=%s AND status='approved' ''', [str(file_id), str(learner_id)])
    if not rows:
        raise old.ServiceError('Document not found.', 'not_found', 404)
    from .evidence_storage import download_blob_bytes, azure_configured
    if not azure_configured():
        raise old.ServiceError('Document storage is unavailable.', 'storage_unavailable', 503)
    doc = rows[0]
    response = HttpResponse(download_blob_bytes(settings.AZURE_APPROVED_CONTAINER, doc['blob_name']),
                            content_type=doc['content_type'] or 'application/octet-stream')
    response['Content-Disposition'] = content_disposition_header(False, doc['original_filename'])
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "sandbox"
    return response


@endpoint('POST')
def sign(request, learner_id, month):
    learner, role = scope(request, learner_id)
    data = request.POST
    if (set(data) != {'snapshot_digest', 'confirmed', 'capture_method'} or
            set(request.FILES) != {'signature'} or data.get('confirmed') != 'true' or
            data.get('capture_method') not in {'draw', 'upload', 'import'}):
        raise old.ServiceError('Confirm your own signature before saving.')
    image = storage.sanitize(request.FILES['signature'])
    valid_month(month)
    if learner.get('aptem_id') and month <= old_repo.CUTOFF:
        old.start(learner, request.login_account, role)
        return JsonResponse({**public_detail(learner, old.sign(learner, month, request.login_account,
            role, image, data.get('snapshot_digest'), {'capture_method': data['capture_method']})), 'source': 'legacy'})
    require_closed_month(month)
    with transaction.atomic(using='enrolment'):
        # Serialize concurrent sign requests for this learner, including first signatures.
        old_repo.query('SELECT id FROM enrolment."Created_users" WHERE id=%s FOR UPDATE', [learner_id])
        report = detail_data(learner, month)
        signer_role = 'learner' if role == 'learner' else 'coach'
        if report['student_signature' if signer_role == 'learner' else 'coach_signature']:
            return JsonResponse(report)
        if report['snapshot_digest'] != data.get('snapshot_digest'):
            raise old.ServiceError('Activities have changed. Review the updated month before signing.', 'record_changed', 409)
        name = request.login_account.display_name or request.login_account.email
        # Keep the reviewed revision with its capture; later source edits do
        # not overwrite it or require the person to sign the month again.
        key = f"lms-monthly:{learner_id}:{report['snapshot_digest']}"
        capture = json.dumps({'url': 'data:image/png;base64,' + base64.b64encode(image).decode('ascii'),
            'rows': report['rows'], 'profile': report.get('profile'),
            'actor_account_id': request.login_account.id, 'capture_method': data['capture_method']}, default=str)
        old_repo.query(f'''INSERT INTO {old_repo.SIGNOFFS}
            (learner_id, programme_key, report_month, signer_role, signer_name,
             review_confirmed, signature_data, signed_at, snapshot_hash, audit_version)
            VALUES (%s,%s,%s,%s,%s,true,%s,now(),%s,%s)
            ON CONFLICT (learner_id,programme_key,report_month,signer_role) DO NOTHING''',
            [f'lms:{learner_id}', key, month, signer_role, name, capture, report['snapshot_digest'], VERSION])
        return JsonResponse(detail_data(learner, month))


@endpoint('GET')
def learners(request):
    actor = old.coach_actor(request.login_account)
    if actor['role'] == 'monitor':
        raise old.ServiceError('Coach access is required.', 'forbidden', 403)
    from coach_api.auth import _requested_view_as_email
    email = _requested_view_as_email(request) if actor['role'] == 'admin' else actor['email']
    search = (request.GET.get('search') or '').strip()[:100]
    return JsonResponse({'learners': sources.learners(old.normalize(email), search)})
