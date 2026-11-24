"""Admin-only corrections to individual learner certificates, with retained copies.

Uses the existing certificate snapshot and audit log; never edits learner profiles,
templates, completion records or the original award date/token.
"""
from copy import deepcopy
import json

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt

from .permissions import require_role
from .platform_admin import _reject_cross_site
from learner_api.certificates import _certificate_dict, _current_certificate, _json_dict
from learner_api.certificate_display import editable_values


FIELDS = {'learnerName': 255, 'courseTitle': 255, 'title': 200, 'bodyText': 2000,
          'instructorName': 255, 'instructorLabel': 100}
REQUIRED = {'learnerName', 'courseTitle', 'title', 'bodyText'}
SELECT = '''SELECT lc.id,lc.certificate_number,lc.template_id,lc.template_version,
    lc.progress_percent,lc.snapshot,lc.issued_at,lc.pdf_blob_url,lc.verification_token,
    lc.module_ref,lc.module_title,lc.status,lc.learner_kind,
    ct.title,ct.body_text,ct.layout_config,lc.revoked_at,lc.revoke_reason,lc.learner_id
    FROM "Learner".learner_certificates lc
    JOIN "Learner".certificate_templates ct ON ct.id=lc.template_id'''


def _error(message, status=400):
    return JsonResponse({'error': message}, status=status)


def _record(row):
    result = _certificate_dict(row)
    snapshot = result['snapshot']
    layout = _json_dict(snapshot.get('layoutConfig')) or _json_dict(row[15])
    learner = _json_dict(snapshot.get('learner'))
    result.update(status=row[11], learnerKind=row[12], learnerId=row[18],
                  revokedAt=row[16].isoformat() if row[16] else None, revokeReason=row[17] or '',
                  editable={
                      'learnerName': learner.get('name') or '',
                      'courseTitle': snapshot.get('moduleTitle') or row[10] or learner.get('programme') or snapshot.get('programme') or '',
                      'title': snapshot.get('certificateTitle') or row[13],
                      'bodyText': snapshot.get('bodyText') or row[14],
                      'instructorName': layout.get('instructorName', ''),
                      'instructorLabel': layout.get('instructorLabel', 'Instructor'),
                  }, layoutConfig=layout)
    return result


def _display_record(cursor, record):
    if record['status'] != 'issued':
        return record
    result = _current_certificate(cursor, record, record['learnerKind'], record['learnerId'])
    result['editable'] = editable_values(result)
    result['layoutConfig'] = _json_dict(result['snapshot'].get('layoutConfig'))
    return result


def _read(cursor, certificate_id, lock=False):
    cursor.execute(SELECT + ' WHERE lc.id=%s' + (' FOR UPDATE OF lc' if lock else ''), [certificate_id])
    row = cursor.fetchone()
    return _record(row) if row else None


def _history(cursor, certificate_id):
    cursor.execute('''SELECT id,action,actor_email,created_at,details
        FROM "Learner".certificate_audit_logs WHERE certificate_id=%s
        ORDER BY created_at DESC,id DESC''', [certificate_id])
    return [dict(id=row[0], action=row[1], actor=row[2], at=row[3].isoformat(), details=_json_dict(row[4]))
            for row in cursor.fetchall()]


@never_cache
@require_role('admin')
def issued_certificates(request):
    if request.method != 'GET':
        return _error('Method not allowed.', 405)
    try:
        page = max(1, min(100000, int(request.GET.get('page', 1))))
        page_size = max(1, min(100, int(request.GET.get('pageSize', 20))))
    except (TypeError, ValueError):
        return _error('Invalid page.')
    status = request.GET.get('status', '')
    if status not in ('', 'issued', 'revoked', 'superseded'):
        return _error('Unknown certificate status.')
    query = request.GET.get('q', '').strip()[:255]
    where, params = [], []
    if status:
        where.append('lc.status=%s')
        params.append(status)
    if query:
        pattern = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        where.append("(lc.certificate_number ILIKE %s OR lc.snapshot->'learner'->>'name' ILIKE %s OR lc.module_title ILIKE %s)")
        params.extend([pattern] * 3)
    condition = ' WHERE ' + ' AND '.join(where) if where else ''
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('SELECT count(*) FROM "Learner".learner_certificates lc' + condition, params)
            count = cursor.fetchone()[0]
            # Never transfer the embedded background/logo for every table row.
            cursor.execute('''SELECT lc.id,lc.certificate_number,lc.snapshot->'learner'->>'name',
                COALESCE(NULLIF(lc.module_title,''),lc.snapshot->'learner'->>'programme',lc.snapshot->>'programme'),
                lc.learner_kind,lc.status,lc.progress_percent,lc.issued_at,lc.verification_token,
                lc.snapshot->>'certificateRevision',lc.snapshot->>'correctedAt'
                FROM "Learner".learner_certificates lc''' + condition +
                ' ORDER BY lc.issued_at DESC,lc.id DESC LIMIT %s OFFSET %s',
                [*params, page_size, (page - 1) * page_size])
            results = [dict(id=r[0], certificateNumber=r[1], learnerName=r[2] or '', courseTitle=r[3] or '',
                            learnerKind=r[4], status=r[5], progressPercent=float(r[6]),
                            issuedAt=r[7].isoformat() if r[7] else None,
                            verificationUrl=f'/verify-certificate/{r[8]}', revision=int(r[9] or 1), correctedAt=r[10])
                       for r in cursor.fetchall()]
    except DatabaseError:
        return _error('Issued certificates are temporarily unavailable.', 503)
    return JsonResponse(dict(results=results, count=count, page=page, pageSize=page_size))


def _payload(request):
    try:
        body = json.loads(request.body or b'{}')
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Invalid JSON.')
    if not isinstance(body, dict) or set(body) - {'action', 'revision', 'reason', 'changes'}:
        raise ValueError('Unknown certificate fields.')
    if body.get('action') not in ('correct', 'revoke'):
        raise ValueError('Choose correct or revoke.')
    if type(body.get('revision')) is not int or body['revision'] < 1:
        raise ValueError('The current certificate revision is required.')
    reason = body.get('reason')
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 1000:
        raise ValueError('Provide a reason of 1 to 1000 characters.')
    body['reason'] = reason.strip()
    changes = body.get('changes', {})
    if not isinstance(changes, dict) or set(changes) - FIELDS.keys():
        raise ValueError('Only the certificate display fields can be corrected.')
    if body['action'] == 'revoke' and changes:
        raise ValueError('Revocation cannot also change certificate details.')
    for key, value in changes.items():
        if not isinstance(value, str) or len(value) > FIELDS[key] or (key in REQUIRED and not value.strip()):
            raise ValueError(f'Invalid {key}.')
    body['changes'] = {key: value.strip() for key, value in changes.items()}
    return body


@never_cache
@csrf_exempt
@require_role('admin')
def issued_certificate(request, certificate_id):
    if request.method not in ('GET', 'POST'):
        return _error('Method not allowed.', 405)
    if request.method == 'POST':
        rejected = _reject_cross_site(request)
        if rejected:
            return rejected
        try:
            body = _payload(request)
        except ValueError as exc:
            return _error(str(exc))
    try:
        if request.method == 'GET':
            with connections['enrolment'].cursor() as cursor:
                record = _read(cursor, certificate_id)
                if not record:
                    return _error('Certificate not found.', 404)
                return JsonResponse({'certificate': _display_record(cursor, record), 'history': _history(cursor, certificate_id)})
        with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
            record = _read(cursor, certificate_id, lock=True)
            if not record:
                return _error('Certificate not found.', 404)
            if record['revision'] != body['revision']:
                return _error('This certificate changed. Reload it and review the latest copy before saving.', 409)
            if record['status'] != 'issued':
                return _error('Only an active certificate can be corrected or revoked.', 409)
            stored_before = deepcopy(record)
            before = _display_record(cursor, record) if body['action'] == 'correct' else deepcopy(record)
            snapshot = deepcopy(record['snapshot'])
            changed = {key: value for key, value in body['changes'].items() if value != before['editable'][key]}
            if body['action'] == 'correct' and not changed:
                return _error('Change at least one certificate field before saving.')
            now = timezone.now()
            actor = request.login_account.email
            if body['action'] == 'correct':
                snapshot['certificateRevision'] = record['revision'] + 1
                snapshot['certificateOverrides'] = {**before['snapshot']['certificateOverrides'], **changed}
                if 'learnerName' in changed:
                    snapshot['learner'] = {**_json_dict(snapshot.get('learner')), 'name': changed['learnerName']}
                if 'courseTitle' in changed:
                    if record['moduleRef']:
                        snapshot['moduleTitle'] = changed['courseTitle']
                    else:
                        snapshot['programme'] = changed['courseTitle']
                        snapshot['learner'] = {**_json_dict(snapshot.get('learner')), 'programme': changed['courseTitle']}
                for key, target in (('title', 'certificateTitle'), ('bodyText', 'bodyText')):
                    if key in changed:
                        snapshot[target] = changed[key]
                if {'instructorName', 'instructorLabel'} & changed.keys():
                    snapshot['layoutConfig'] = {**record['layoutConfig'],
                        **{key: changed[key] for key in ('instructorName', 'instructorLabel') if key in changed}}
                snapshot['correctedAt'] = now.isoformat()
                cursor.execute('''UPDATE "Learner".learner_certificates
                    SET snapshot=%s::jsonb,module_title=%s,pdf_blob_url='' WHERE id=%s''',
                    [json.dumps(snapshot), changed.get('courseTitle', record['moduleTitle']) if record['moduleRef'] else record['moduleTitle'], certificate_id])
            else:
                cursor.execute('''UPDATE "Learner".learner_certificates
                    SET status='revoked',revoked_by=%s,revoked_at=%s,revoke_reason=%s
                    WHERE id=%s''', [actor, now, body['reason'], certificate_id])
            record = _read(cursor, certificate_id)
            record = _display_record(cursor, record)
            cursor.execute('''INSERT INTO "Learner".certificate_audit_logs
                (actor_email,action,template_id,certificate_id,details)
                VALUES (%s,%s,%s,%s,%s::jsonb)''',
                [actor, 'certificate-corrected' if body['action'] == 'correct' else 'certificate-revoked',
                 record['templateId'], certificate_id, json.dumps(dict(reason=body['reason'], before=before, after=record,
                     storedBefore=stored_before, changedFields=list(changed)))])
            history = _history(cursor, certificate_id)
        return JsonResponse({'certificate': record, 'history': history})
    except DatabaseError:
        return _error('The certificate could not be read or saved. Please retry.', 503)
