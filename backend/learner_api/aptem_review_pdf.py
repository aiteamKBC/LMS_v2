"""Shared lookup for read-only PDFs of imported Aptem reviews."""

import logging

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


def original_review_pdf(review):
    """Read a verified original Aptem PDF when the import kept its blob link.

    The review import stores those links in the contracts probe as a review
    group id mapped to an Azure PDF. The match is deliberately exact; a
    learner/date/name match is not enough when a learner has several reviews.
    """
    aptem_learner_id = str(review.get('aptemLearnerId') or '').strip()
    aptem_review_id = str(review.get('aptemReviewId') or '').strip()
    if not aptem_learner_id or not aptem_review_id:
        return None

    from .evidence_storage import download_blob_bytes, parse_blob_url

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
        return None
    if len(links) != 1:
        return None
    location = parse_blob_url(links[0])
    if not location:
        return None
    try:
        content = download_blob_bytes(*location, max_bytes=25 * 1024 * 1024)
        return content if content.startswith(b'%PDF-') else None
    except Exception:
        logger.warning('Could not read the original imported Aptem PDF blob.', exc_info=True)
        return None
