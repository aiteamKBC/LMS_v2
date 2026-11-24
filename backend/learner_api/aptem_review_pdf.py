"""Shared lookup for read-only PDFs of imported Aptem reviews."""

import hashlib
import json
import logging
import re
from datetime import datetime
from urllib.parse import urlparse

from django.conf import settings
from django.db import DatabaseError, connections

from .review_history import (
    _learner_profile_id,
    _sections_by_review,
    _serialize_review,
)

logger = logging.getLogger(__name__)


def imported_review_for_source(source, aptem_review_id, *, kind):
    """Return one imported review owned by ``source``.

    The learner schema is queried by the stable Aptem review id and the
    resolved Learner mirror id.  Matching by date or display name would allow
    two old reviews to be mixed together, so both identifiers are required.
    """
    if source is None or not str(aptem_review_id or '').strip():
        return None
    from coach_api.views import get_learner_db_alias

    connection = connections[get_learner_db_alias()]
    with connection.cursor() as cursor:
        learner_id = _learner_profile_id(cursor, source, kind)
        if learner_id is None:
            return None
        cursor.execute(
            '''
            SELECT id, aptem_review_id, review_name, review_type, reviewer_name,
                   learner_name, planned_scheduled_date, completed_date, status,
                   review_data, source_url, extraction_status, last_error
            FROM "Learner".reviews
            WHERE learner_id = %s AND aptem_review_id = %s
            ORDER BY id
            LIMIT 2
            ''',
            [learner_id, str(aptem_review_id).strip()],
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        if len(rows) != 1:
            return None
        row = rows[0]
        sections = _sections_by_review(cursor, [row['id']])
    review = _serialize_review(row, sections)
    # ``sourceUrl`` is retained as provenance only.  It is an authenticated
    # Aptem review page in the current import, not an untrusted URL to fetch as
    # a server-side PDF.
    review['learnerId'] = learner_id
    return review


def _clean(value):
    return str(value or '').strip()


def _direct_blob_location(row):
    """Return a configured-account blob location, or reject the reference."""
    account_url = _clean(row.get('azure_account_url')).rstrip('/')
    expected_host = f"{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net".lower()
    parsed = urlparse(account_url)
    if parsed.scheme != 'https' or (parsed.hostname or '').lower() != expected_host:
        return None
    container = _clean(row.get('azure_container')).strip('/')
    blob = _clean(row.get('azure_blob_name'))
    return (container, blob) if container and blob else None


def _pdf_sha256(value):
    value = _clean(value).lower()
    return value if re.fullmatch(r'[0-9a-f]{64}', value) else None


def _valid_sha256_proof(row, review):
    metadata = row.get('pdf_metadata')
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, RecursionError):
            return False
    proof = metadata.get('review_link_proof') if isinstance(metadata, dict) else None
    if not isinstance(proof, dict) or proof.get('method') != 'aptem_review_document_sha256_v1':
        return False
    expected = {
        'learner_id': review.get('learnerId'),
        'aptem_learner_id': review.get('aptemLearnerId'),
        'review_id': review.get('id'),
        'aptem_review_id': review.get('aptemReviewId'),
        'aptem_document_id': row.get('aptem_document_id'),
        'file_size': row.get('file_size'),
    }
    if any(not _clean(value) or _clean(proof.get(key)) != _clean(value)
           for key, value in expected.items()):
        return False
    digest = _pdf_sha256(row.get('sha256'))
    if not digest or _pdf_sha256(proof.get('sha256')) != digest:
        return False
    try:
        checked = datetime.fromisoformat(_clean(proof.get('checked_at')).replace('Z', '+00:00'))
        return checked.utcoffset() is not None
    except (TypeError, ValueError):
        return False


def _direct_pdf_locations(review):
    """Find safe direct archive locations for this exact imported review.

    ``review_id`` is only the candidate relationship. Every identity,
    provenance and storage field is checked again before a location is
    returned. A set deliberately collapses duplicate rows for one blob while
    preserving ambiguity when different blobs are attached to the review.
    """
    try:
        review_id = int(_clean(review.get('id')))
        learner_id = _clean(review.get('learnerId'))
    except (TypeError, ValueError):
        return set()
    aptem_learner_id = _clean(review.get('aptemLearnerId'))
    review_type = _clean(review.get('type')).casefold()
    if not learner_id or not aptem_learner_id or not review_type:
        return set()

    connection = connections['enrolment']
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                SELECT learner_id, aptem_learner_id, document_type, status,
                       mapping_status, review_match_status, original_filename, source_url,
                       source_hash, verified_at, azure_account_url,
                       azure_container, azure_blob_name, file_size,
                       sha256, pdf_metadata, aptem_document_id, review_id
                FROM "Learner".review_documents
                WHERE review_id = %s
                ''',
                [review_id],
            )
            rows = cursor.fetchall()
    except DatabaseError:
        logger.warning('Could not resolve a direct imported Aptem PDF.', exc_info=True)
        return set()

    locations = set()
    for values in rows:
        row = dict(zip(
            (
                'learner_id', 'aptem_learner_id', 'document_type', 'status',
                'mapping_status', 'review_match_status', 'original_filename', 'source_url',
                'source_hash', 'verified_at', 'azure_account_url',
                'azure_container', 'azure_blob_name', 'file_size',
                'sha256', 'pdf_metadata', 'aptem_document_id', 'review_id',
            ),
            values,
        ))
        source_url = _clean(row['source_url'])
        source_url_parts = urlparse(source_url)
        try:
            file_size = int(row['file_size'])
        except (TypeError, ValueError):
            continue
        if (
            _clean(row['learner_id']) != learner_id
            or _clean(row['aptem_learner_id']) != aptem_learner_id
            or _clean(row['document_type']).casefold() != review_type
            or _clean(row['status']).casefold() != 'uploaded'
            or _clean(row['mapping_status']).casefold() != 'aptem_id'
            or _clean(row['review_id']) != str(review_id)
            or _clean(row['review_match_status']).casefold() not in {
                'matched_pdf_type_dates', 'matched_aptem_document_sha256',
            }
            or not _clean(row['original_filename']).casefold().endswith('.pdf')
            or source_url_parts.scheme not in {'http', 'https'}
            or not source_url_parts.netloc
            or not _clean(row['source_hash'])
            or row['verified_at'] is None
            or file_size <= 0
        ):
            continue
        if (_clean(row['review_match_status']).casefold() == 'matched_aptem_document_sha256'
                and not _valid_sha256_proof(row, review)):
            continue
        digest = _pdf_sha256(row['sha256'])
        if _clean(row['sha256']) and not digest:
            continue
        location = _direct_blob_location(row)
        if location:
            locations.add((*location, digest, file_size))
    return locations


def _probe_pdf_locations(aptem_learner_id, aptem_review_id):
    """Resolve the existing exact Aptem learner/reviewGroupId probe link."""
    from .evidence_storage import parse_blob_url

    connection = connections['enrolment']
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                SELECT DISTINCT link->>'url'
                FROM fetching_evidence.aptem_cv_contracts_probe probe
                CROSS JOIN LATERAL jsonb_array_elements(
                    COALESCE(probe.progress_review_links, '[]'::jsonb)
                    || COALESCE(probe.monthly_coaching_review_links, '[]'::jsonb)
                    || COALESCE(probe.gateway_review_links, '[]'::jsonb)
                ) AS link
                WHERE probe.learner_id::text = %s
                  AND link->>'reviewGroupId' = %s
                  AND lower(COALESCE(link->>'contentType', '')) = 'application/pdf'
                LIMIT 2
                ''',
                [aptem_learner_id, aptem_review_id],
            )
            links = [row[0] for row in cursor.fetchall() if row[0]]
    except DatabaseError:
        logger.warning('Could not resolve an imported Aptem PDF link.', exc_info=True)
        return set()
    if len(links) != 1:
        return set()
    location = parse_blob_url(links[0])
    return {location} if location is not None else set()


def _read_verified_pdf(location):
    from .evidence_storage import download_blob_bytes

    try:
        container, blob = location[:2]
        digest, expected_size = location[2:] if len(location) == 4 else (None, None)
        content = download_blob_bytes(container, blob, max_bytes=25 * 1024 * 1024)
        if not content or not content.startswith(b'%PDF-'):
            return None
        if expected_size is not None and len(content) != expected_size:
            return None
        if digest is not None and hashlib.sha256(content).hexdigest() != digest:
            return None
        return content
    except Exception:
        logger.warning('Could not read the original imported Aptem PDF blob.', exc_info=True)
        return None


def original_review_pdf(review):
    """Read one original Aptem PDF using direct archive, then probe fallback.

    Historical records never fall back to an LMS-generated document. Direct
    rows are used only when exactly one distinct, verified blob remains. An
    ambiguous direct mapping is deliberately handed to the canonical probe
    lookup instead of selecting an arbitrary row.
    """
    aptem_learner_id = _clean(review.get('aptemLearnerId'))
    aptem_review_id = _clean(review.get('aptemReviewId'))
    if not aptem_learner_id or not aptem_review_id:
        return None

    direct_locations = _direct_pdf_locations(review)
    if len(direct_locations) == 1:
        content = _read_verified_pdf(next(iter(direct_locations)))
        if content is not None:
            logger.info('historical_pdf_source=direct historical_pdf_result=available')
            return content
    elif len(direct_locations) > 1:
        logger.info('historical_pdf_source=direct historical_pdf_result=ambiguous')

    probe_locations = _probe_pdf_locations(aptem_learner_id, aptem_review_id)
    if len(probe_locations) != 1:
        logger.info('historical_pdf_source=probe historical_pdf_result=unavailable')
        return None
    probe_location = next(iter(probe_locations))
    # A probe pointing to the same blob must not bypass archive integrity checks.
    archived = {location for location in direct_locations if location[:2] == probe_location}
    if len(archived) > 1:
        return None
    content = _read_verified_pdf(next(iter(archived)) if archived else probe_location)
    if content is None:
        logger.info('historical_pdf_source=probe historical_pdf_result=missing')
        return None
    logger.info('historical_pdf_source=probe historical_pdf_result=available')
    return content
