"""Translate a missing-schema condition into a controlled API error.

``SchemaNotProvisioned`` means required Curriculum tables are absent. Before the
schema-ownership refactor, request handlers would have silently created them;
now they refuse and say so. Surfacing that as a 503 with the missing relations
named makes it an obvious deployment/configuration problem rather than an opaque
500 that looks like a code bug.
"""
from __future__ import annotations

import logging

from django.http import JsonResponse

from .schema_gate import SchemaNotProvisioned

logger = logging.getLogger(__name__)


class SchemaNotProvisionedMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        if not isinstance(exception, SchemaNotProvisioned):
            return None
        logger.error(
            'Curriculum schema not provisioned while serving %s: %s',
            request.path, exception,
        )
        return JsonResponse(
            {
                'error': 'Curriculum schema is not provisioned.',
                'detail': str(exception),
                'missing_tables': exception.missing,
            },
            status=503,
        )
