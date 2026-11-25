"""Actual old/new orchestration and PDF outputs, with synthetic inputs only."""
import base64
import binascii
from copy import deepcopy
from datetime import date, datetime, timezone
from html import escape
from io import BytesIO
import json
import logging
from pathlib import Path
import re
from types import SimpleNamespace
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase
from pypdf import PdfReader
from reportlab import rl_config

from curriculum_api.review_management.tests.export_contracts import declared_callable
from curriculum_api.catalogue.domain.values import clean_str, format_date
from curriculum_api.review_management.application import otjh_queries, pdf_export
from curriculum_api.review_management.api import pdf_responses
from curriculum_api.review_management.domain import instance_rules, pdf_policy
from curriculum_api.review_management.domain.instance_definitions import meeting_summary_field
from curriculum_api.review_management.infrastructure import pdf_renderer
from curriculum_api.review_management.tests.otjh_pdf_oracle import ROOT, compile_original
from curriculum_api.review_management.tests.tests_review_pdf import (
    sample_definition, progress_review_definition, saved_snapshot, SAMPLE_INFORMATION,
)


def original_otjh(dependencies):
    return compile_original('review_otjh', {
        'logging': logging, '__name__': 'curriculum_api.review_otjh',
        'review_instances': SimpleNamespace(STATUS_COMPLETED=instance_rules.STATUS_COMPLETED, **dependencies),
        'reviews': SimpleNamespace(**dependencies), 'clean_str': clean_str, 'format_date': format_date,
    })


def original_pdf():
    ns = dict(base64=base64, binascii=binascii, json=json, re=re, datetime=datetime,
              timezone=timezone, escape=escape, BytesIO=BytesIO, Path=Path, ZoneInfo=ZoneInfo,
              __file__=str(ROOT.parent / 'review_pdf_presentation.py'))
    compile_original('review_pdf_presentation', ns)
    ns.update(SIGNATURE_ROLES=instance_rules.SIGNATURE_ROLES,
              required_signature_roles=instance_rules.required_signature_roles,
              meeting_summary_field=meeting_summary_field)
    return compile_original('review_pdf', ns)


class OtjhPdfContractTests(SimpleTestCase):
    def test_planned_totals_itemisation_cache_and_failure_behavior_match(self):
        rows = [dict(id='T1', name=' Synthetic Review ', counts_towards_otjh=True, expected_otjh='2.5'),
                dict(id='T2', name='Quarterly', counts_towards_otjh=True, expected_otjh=1),
                dict(id='OFF', counts_towards_otjh=False, expected_otjh=99)]
        for failure in ('none', 'templates', 'one-occurrence'):
            outcomes = []
            for old in (True, False):
                def resolve(row, *args):
                    if failure == 'one-occurrence' and row['id'] == 'T2':
                        raise ValueError('Synthetic recurrence unavailable')
                    return [{'targetDate': date(2026, 3, 1), 'recurrenceLabel': 'Monthly'},
                            {'targetDate': date(2026, 2, 1), 'recurrenceLabel': 'Monthly'}]
                dependencies = dict(list_enabled_review_templates=Mock(return_value=deepcopy(rows),
                                    side_effect=ValueError('Synthetic templates unavailable') if failure == 'templates' else None),
                                    resolve_learner_occurrences=Mock(side_effect=resolve))
                cache = {}
                args = ('P', 100, 'Active', date(2026, 1, 1), date(2026, 1, 1), date(2026, 12, 31))
                if old:
                    ns = original_otjh(dependencies)
                    with self.assertLogs('curriculum_api.review_otjh', level='WARNING') if failure != 'none' else patch('logging.Logger.warning'):
                        meetings = ns['planned_meetings'](*args, template_cache=cache)
                        total = ns['planned_hours'](*args, template_cache=cache)
                else:
                    with patch.multiple(otjh_queries, **dependencies), patch('logging.Logger.warning'):
                        meetings = otjh_queries.planned_meetings(*args, template_cache=cache)
                        total = otjh_queries.planned_hours(*args, template_cache=cache)
                outcomes.append((meetings, total, cache, [mock.call_args_list for mock in dependencies.values()]))
            self.assertEqual(outcomes[0], outcomes[1])
            self.assertEqual(outcomes[1][1], round(sum(m['hours'] for m in outcomes[1][0]), 2))
        with patch.object(otjh_queries, 'list_enabled_review_templates') as read:
            self.assertEqual(otjh_queries.planned_meetings('', 100, 'Active', None, None, None), [])
            read.assert_not_called()

    def test_completed_hours_live_template_deduplication_and_error_behavior_match(self):
        instances = [dict(status=' completed ', review_template_id='T1'),
                     dict(status='completed', review_template_id='T1'),
                     dict(status='completed', review_template_id='T2'),
                     dict(status='in-progress', review_template_id='T1'),
                     dict(status='completed', review_template_id='')]
        for failure in ('none', 'instances', 'template'):
            results = []
            for old in (True, False):
                dependencies = dict(list_review_instances_for_learner=Mock(return_value=deepcopy(instances),
                    side_effect=ValueError('Synthetic read failure') if failure == 'instances' else None),
                    get_review_template_row=Mock(return_value={'counts_towards_otjh': True, 'expected_otjh': 2.5},
                    side_effect=ValueError('Synthetic template failure') if failure == 'template' else None))
                with patch('logging.Logger.warning'):
                    if old:
                        total = original_otjh(dependencies)['completed_hours'](100, window_start='2026-01-01', window_end='2026-12-31')
                    else:
                        with patch.multiple(otjh_queries, **dependencies):
                            total = otjh_queries.completed_hours(100, window_start='2026-01-01', window_end='2026-12-31')
                results.append((total, [mock.call_args_list for mock in dependencies.values()]))
            self.assertEqual(results[0], results[1])
            if failure == 'none':
                self.assertEqual(results[1][0], 7.5)
                self.assertEqual(dependencies['get_review_template_row'].call_count, 2)
                dependencies['get_review_template_row'].assert_any_call('T1', include_deleted=True)

    def test_native_pdf_bytes_and_http_headers_match_with_invariant_metadata(self):
        old = original_pdf()
        definitions = [sample_definition(), progress_review_definition()]
        definitions[1]['progressSnapshot'] = saved_snapshot()
        for definition in definitions:
            untouched = deepcopy(definition)
            with patch.object(rl_config, 'invariant', 1):
                original = old['mcm_pdf_response'](definition, SAMPLE_INFORMATION)
                actual = pdf_responses.mcm_pdf_response(definition, SAMPLE_INFORMATION)
            self.assertEqual(actual.status_code, original.status_code)
            self.assertEqual(dict(actual.items()), dict(original.items()))
            self.assertEqual(actual.content, original.content)
            self.assertEqual(definition, untouched)
            pages = PdfReader(BytesIO(actual.content)).pages
            self.assertGreaterEqual(len(pages[-1].images), 2)

    def test_native_pdf_errors_and_historical_original_only_contract_match(self):
        old = original_pdf()
        for kind, status, mark in (('induction', 'completed', None), ('mcm', 'in-progress', None),
                                 ('mcm', 'completed', 'https://example.invalid/signature'),
                                 ('mcm', 'completed', 'data:image/png;base64,bm90LWFuLWltYWdl')):
            definition = sample_definition()
            definition['template']['reviewTypeCode'] = kind
            definition['instance']['status'] = status
            if mark:
                definition['signatures']['advisor']['signature'] = mark
            actual = pdf_responses.mcm_pdf_response(definition, {})
            original = old['mcm_pdf_response'](definition, {})
            self.assertEqual((actual.status_code, actual.content, dict(actual.items())),
                             (original.status_code, original.content, dict(original.items())))
        for content in (None, b'', b'%PDF-synthetic-original-bytes'):
            for identifier in ('../unsafe?42', ''):
                with patch.object(pdf_responses, 'build_mcm_pdf', side_effect=AssertionError('Historical regeneration')):
                    actual = pdf_responses.historical_pdf_response({}, {}, identifier=identifier, original_content=content)
                original = old['historical_pdf_response']({}, {}, identifier=identifier, original_content=content)
                self.assertEqual((actual.status_code, actual.content, dict(actual.items())),
                                 (original.status_code, original.content, dict(original.items())))

    def test_facades_export_actual_owners_and_inner_serialization_uses_domain_policy(self):
        from curriculum_api.review_management.domain.otjh_rules import template_otjh_hours
        for name in ('planned_hours', 'planned_meetings', 'completed_hours', 'otjh_template_rows'):
            self.assertIs(declared_callable('review_otjh', name), getattr(otjh_queries, name))
        self.assertIs(declared_callable('review_otjh', 'template_otjh_hours'), template_otjh_hours)
        self.assertIs(declared_callable('review_pdf', 'pdf_availability'), pdf_policy.pdf_availability)
        self.assertIs(declared_callable('review_pdf', 'build_mcm_pdf'), pdf_export.build_mcm_pdf)
        self.assertIs(declared_callable('review_pdf', 'mcm_pdf_response'), pdf_responses.mcm_pdf_response)
        self.assertIs(declared_callable('review_pdf', 'historical_pdf_response'), pdf_responses.historical_pdf_response)
        self.assertIs(declared_callable('review_pdf_presentation', 'render_review_pdf'), pdf_renderer.render_review_pdf)
        for name in ('review_otjh', 'review_pdf', 'review_pdf_presentation'):
            self.assertFalse((ROOT.parent / (name + '.py')).exists())
        self.assertIn('from ..domain.pdf_policy import pdf_availability',
                      (ROOT / 'application/instance_definitions.py').read_text())
