"""Slice 02: learner detail and summary never return database text.

Database and network are prohibited; the source model and every builder are
mocked. The views are called unwrapped, so ownership gating is covered by the
login gate suites, not here.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

import psycopg
import psycopg.errors
from django.db import DatabaseError, IntegrityError, InterfaceError, OperationalError, ProgrammingError
from django.test import RequestFactory, SimpleTestCase
from old_otjh.service import ServiceError

from . import learner_detail as reader

SECRETS = ('SELECT', 'Created_users', 'learners', 'db.internal', '5432', 'synthetic-secret',
           'person@example.test', 'private/path')
LEAKY = 'SELECT * FROM "Learner".learners JOIN "Created_users" host=db.internal port=5432 ' \
        'password=synthetic-secret person@example.test /private/path'
KINDS = ('commercial', 'apprenticeship')
DETAIL = {'error': 'Could not load learner details. Please try again.'}
SUMMARY = {'error': 'Could not load learner summary. Please try again.'}


def database_failures():
    wrapped = OperationalError(LEAKY)
    wrapped.__cause__ = psycopg.errors.UndefinedColumn(LEAKY)
    return [OperationalError(LEAKY), ProgrammingError(LEAKY), IntegrityError(LEAKY), DatabaseError(LEAKY),
            InterfaceError(LEAKY), psycopg.OperationalError(LEAKY), wrapped]


class Manager:
    def __init__(self, source=None, failure=None):
        self.source, self.failure = source, failure

    def only(self, *fields):
        return self

    def get(self, **kwargs):
        if self.failure is not None:
            raise self.failure
        if self.source is None:
            raise LookupError
        return self.source


def model(**kwargs):
    return SimpleNamespace(all_learners=Manager(**kwargs), DoesNotExist=LookupError)


class LearnerErrorAssertions(SimpleTestCase):
    factory = RequestFactory()

    def assert_safe_failure(self, call, operation, kind, body):
        with self.assertLogs('learner_api.learner_detail', level='ERROR') as logs:
            response = call()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(json.loads(response.content), body)
        [record] = logs.records
        self.assertIsNone(record.exc_info)
        self.assertRegex(record.getMessage(), rf'^Learner database failure: operation={operation} type=\w+ '
                                              rf'sqlstate=([0-9A-Z]{{5}}|unknown) kind={kind} learner_id=7$')
        for text in (response.content.decode(), record.getMessage()):
            for secret in SECRETS:
                self.assertNotIn(secret, text)


class LearnerDetailTests(LearnerErrorAssertions):
    def detail(self, kind, content=None, **params):
        query = {'content': content, **params} if content else params
        return reader.learner_detail.__wrapped__(self.factory.get('/', query), kind, 7)

    def test_a_failed_source_read_is_a_safe_502_for_both_kinds(self):
        for kind in KINDS:
            for failure in database_failures():
                with self.subTest(kind=kind, failure=type(failure).__name__), \
                     patch.dict(reader.SOURCE_MODELS, {kind: model(failure=failure)}):
                    self.assert_safe_failure(lambda: self.detail(kind), 'learner_detail.source', kind, DETAIL)

    def test_every_content_path_fails_safely_for_both_kinds(self):
        paths = (
            (None, {}, 'build_learner_detail'),
            ('summary', {}, 'build_learner_detail'),
            ('quiz', {}, 'build_learner_detail'),
            ('activity', {'component_id': 'C1'}, 'build_learner_detail'),
            ('reading', {'component_id': 'C1'}, '_reading_content'),
        )
        for kind in KINDS:
            for content, params, target in paths:
                for failure in (OperationalError(LEAKY), ProgrammingError(LEAKY), InterfaceError(LEAKY)):
                    with self.subTest(kind=kind, content=content, failure=type(failure).__name__), \
                         patch.dict(reader.SOURCE_MODELS, {kind: model(source=SimpleNamespace())}), \
                         patch.object(reader, target, side_effect=failure):
                        self.assert_safe_failure(lambda: self.detail(kind, content, **params),
                                                 'learner_detail.build', kind, DETAIL)

    def test_missing_learner_unknown_kind_and_service_errors_are_unchanged(self):
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model()}):
            missing = self.detail('commercial')
        self.assertEqual((missing.status_code, json.loads(missing.content)), (404, {'error': 'Learner not found.'}))
        unknown = self.detail('nonsense')
        self.assertEqual(unknown.status_code, 404)
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model(source=SimpleNamespace())}), \
             patch.object(reader, 'build_learner_detail',
                          side_effect=ServiceError('Identity needs review.', 'identity_review_required', 409)):
            refused = self.detail('commercial', 'summary')
        self.assertEqual((refused.status_code, json.loads(refused.content)), (409, {'error': 'Identity needs review.'}))

    def test_successful_payload_and_method_check_are_unchanged(self):
        payload = {'id': '7', 'plannedHours': '240', 'components': []}
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model(source=SimpleNamespace())}), \
             patch.object(reader, 'build_learner_detail', return_value=payload) as build:
            response = self.detail('commercial', 'summary')
        self.assertEqual((response.status_code, json.loads(response.content)), (200, payload))
        # Slice 01 call shape is preserved.
        self.assertEqual(build.call_args.kwargs, {'compact': True})
        post = reader.learner_detail.__wrapped__(self.factory.post('/'), 'commercial', 7)
        self.assertEqual(post.status_code, 405)

    def test_programming_defects_still_propagate(self):
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model(source=SimpleNamespace())}), \
             patch.object(reader, 'build_learner_detail', side_effect=TypeError('bug')):
            with self.assertRaisesRegex(TypeError, 'bug'):
                self.detail('commercial', 'summary')


class LearnerSummaryTests(LearnerErrorAssertions):
    def summary(self, kind):
        return reader.learner_summary.__wrapped__(self.factory.get('/'), kind, 7)

    def test_a_failed_source_read_keeps_the_existing_safe_body_for_both_kinds(self):
        for kind in KINDS:
            for failure in database_failures():
                with self.subTest(kind=kind, failure=type(failure).__name__), \
                     patch.dict(reader.SOURCE_MODELS, {kind: model(failure=failure)}):
                    self.assert_safe_failure(lambda: self.summary(kind), 'learner_summary.source', kind, SUMMARY)

    def test_a_failed_payload_read_keeps_the_existing_safe_body_for_both_kinds(self):
        for kind in KINDS:
            with self.subTest(kind=kind), \
                 patch.dict(reader.SOURCE_MODELS, {kind: model(source=SimpleNamespace())}), \
                 patch.object(reader, 'programme_status', return_value='Active'), \
                 patch('learner_api.apprenticeship_agreement._group_dates', side_effect=ProgrammingError(LEAKY)):
                self.assert_safe_failure(lambda: self.summary(kind), 'learner_summary.payload', kind, SUMMARY)

    def test_missing_learner_is_still_404(self):
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model()}):
            response = self.summary('commercial')
        self.assertEqual((response.status_code, json.loads(response.content)), (404, {'error': 'Learner not found.'}))
