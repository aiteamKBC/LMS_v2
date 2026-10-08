"""Private, month-scoped assignment records owned by Advanced Admin.

These records deliberately do not enter the learner journal, submissions, or
canonical progress tables. They are an administrative record for one learner.
"""
from decimal import Decimal, InvalidOperation
import hashlib
import logging
from pathlib import Path
import re
from uuid import uuid4

from azure.core.exceptions import AzureError
from django.conf import settings
from django.db import DatabaseError, connections, transaction
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from learner_api.constants import ACCESS_ADVANCED_ADMIN
from learner_api.evidence import MAX_BYTES, _evidence_type_allowed, _scan
from learner_api.evidence_storage import (
    azure_configured, delete_blob, get_download_sas, move_blob, upload_to_quarantine,
)
from login.permissions import require_access


log = logging.getLogger(__name__)
TABLE = 'login."Advanced_admin_assignment_uploads"'
MONTH = re.compile(r'^20\d{2}-(0[1-9]|1[0-2])$')


def validate_record(month, hours, file):
    if not MONTH.fullmatch(str(month or '')) or month > timezone.localdate().strftime('%Y-%m'):
        raise ValueError('Choose a current or past month in YYYY-MM format.')
    try:
        amount = Decimal(str(hours))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('Enter a valid number of confirmed OTJ hours.') from None
    if not amount.is_finite() or not 0 < amount <= 1000 or amount.as_tuple().exponent < -2:
        raise ValueError('Enter confirmed OTJ hours between 0 and 1000, to two decimal places.')
    if not file or Path(file.name).name != file.name or not _evidence_type_allowed(file):
        raise ValueError('Choose a PDF, Word, or PowerPoint assignment file.')
    if Path(file.name).suffix.lower() not in {'.pdf', '.doc', '.docx', '.pptx'}:
        raise ValueError('Choose a PDF, Word, or PowerPoint assignment file.')
    if file.size <= 0 or file.size > MAX_BYTES:
        raise ValueError('The assignment file must be between 1 byte and 50 MB.')
    return amount


def file_digest(file):
    checksum = hashlib.sha256()
    file.seek(0)
    for chunk in iter(lambda: file.read(1024 * 1024), b''):
        checksum.update(chunk)
    file.seek(0)
    return checksum.hexdigest()


def _existing(profile, month, checksum):
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''select id, actual_hours from {TABLE}
            where aptem_id=%s and month_key=%s and sha256=%s''',
            [str(profile.aptem_id), month, checksum])
        return cursor.fetchone()


def save_record(profile, month, hours, file, actor):
    """Upload a reviewed file, then insert one idempotent admin-only record."""
    amount = validate_record(month, hours, file)
    if not azure_configured():
        raise RuntimeError('Assignment storage is unavailable.')
    checksum = file_digest(file)
    previous = _existing(profile, month, checksum)
    if previous:
        if previous[1] != amount:
            raise ValueError('This file is already recorded for the month with different hours.')
        return previous[0], False

    record_id = uuid4()
    blob_name = f'advanced-admin/assignments/{profile.aptem_id}/{month}/{record_id}{Path(file.name).suffix.lower()}'
    quarantine = settings.AZURE_QUARANTINE_CONTAINER
    approved = settings.AZURE_APPROVED_CONTAINER
    container = None
    try:
        upload_to_quarantine(file, blob_name, file.content_type)
        container = quarantine
        if _scan(quarantine, blob_name) != 'clean':
            raise ValueError('The assignment file could not be accepted.')
        move_blob(quarantine, approved, blob_name)
        container = approved
        with transaction.atomic(using='enrolment'):
            with connections['enrolment'].cursor() as cursor:
                cursor.execute(f'''insert into {TABLE}
                    (id, aptem_id, learner_profile_id, month_key, title, actual_hours,
                     original_filename, content_type, size_bytes, sha256, container,
                     blob_name, uploaded_by)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (aptem_id, month_key, sha256) do nothing
                    returning id''', [str(record_id), str(profile.aptem_id), profile.pk,
                        month, Path(file.name).stem.replace('_', ' ')[:250], amount,
                        file.name, file.content_type, file.size, checksum, approved,
                        blob_name, actor[:255]])
                inserted = cursor.fetchone()
        if inserted:
            return inserted[0], True
        previous = _existing(profile, month, checksum)
        if not previous or previous[1] != amount:
            raise ValueError('This file was recorded concurrently with different hours.')
        delete_blob(approved, blob_name)
        return previous[0], False
    except Exception:
        if container:
            try:
                delete_blob(container, blob_name)
            except Exception:
                log.warning('Could not remove an incomplete Advanced Admin assignment upload.')
        raise


def list_records(profile):
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''select id, month_key, title, actual_hours, original_filename,
                uploaded_at from {TABLE} where aptem_id=%s and learner_profile_id=%s
                order by month_key desc, uploaded_at desc, id''',
            [str(profile.aptem_id), profile.pk])
        return [{'id': str(row[0]), 'month': row[1], 'title': row[2],
                 'actualHours': float(row[3]), 'filename': row[4],
                 'uploadedAt': row[5].isoformat()} for row in cursor.fetchall()]


@require_access(ACCESS_ADVANCED_ADMIN)
def assignments(request, profile_id):
    if request.method not in {'GET', 'POST'}:
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    from login.advanced_admin import _profile_in_scope
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    try:
        if request.method == 'GET':
            return JsonResponse({'items': list_records(profile)})
        file = request.FILES.get('file')
        actor = (request.login_account.display_name or request.login_account.email or 'Advanced Admin').strip()
        record_id, created = save_record(profile, request.POST.get('month'),
                                         request.POST.get('hours'), file, actor)
        return JsonResponse({'id': str(record_id), 'created': created}, status=201 if created else 200)
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)
    except (DatabaseError, RuntimeError):
        return JsonResponse({'error': 'Advanced Admin assignment records are unavailable.'}, status=503)
    except AzureError:
        return JsonResponse({'error': 'Assignment storage failed. Please retry.'}, status=502)


@require_GET
@require_access(ACCESS_ADVANCED_ADMIN)
def assignment_document(request, profile_id, record_id):
    from login.advanced_admin import _profile_in_scope
    profile = _profile_in_scope(profile_id)
    if profile is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(f'''select container, blob_name, original_filename from {TABLE}
                where id=%s and aptem_id=%s and learner_profile_id=%s''',
                [str(record_id), str(profile.aptem_id), profile.pk])
            row = cursor.fetchone()
    except DatabaseError:
        return JsonResponse({'error': 'Advanced Admin assignment records are unavailable.'}, status=503)
    if not row:
        return JsonResponse({'error': 'Assignment file not found.'}, status=404)
    if not azure_configured() or row[0] != settings.AZURE_APPROVED_CONTAINER:
        return JsonResponse({'error': 'Assignment storage is unavailable.'}, status=503)
    response = HttpResponseRedirect(get_download_sas(row[0], row[1], row[2]))
    response['Cache-Control'] = 'private, no-store'
    response['Referrer-Policy'] = 'no-referrer'
    return response
