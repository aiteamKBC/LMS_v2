"""Synthetic evidence only. External calls mocked; cache SQL uses isolated memory SQLite."""
import copy
import json
import unittest
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.core import signing
from django.db import connections
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.utils import timezone as django_timezone

from . import recordings_quality as quality
from . import recordings_quality_api as api
from .models import CoachingQualitySuggestion
from . import recordings_api
from login import permissions
from login.identity import accesses_for_staff

START = datetime(2026, 10, 20, 9, tzinfo=timezone.utc)
END = START + timedelta(hours=1)


def record(**changes):
    return SimpleNamespace(**{'event_key': 'mcr:1', 'learner_id': 1, 'review_template_id': 'mcm-template',
        'scheduled_date': date(2026, 10, 20), 'scheduled_time': time(10), 'duration_minutes': 60,
        'status': 'scheduled', 'sync_state': 'synced', 'graph_event_id': 'graph-1', **changes})


def context(**changes):
    return signing.dumps({'eventKey': 'mcr:1', 'startsAt': START.isoformat(), 'endsAt': END.isoformat(),
                         'title': 'MCM and review', 'graphEventId': 'graph-1', **changes}, salt=quality.SALT)


def analysis(**changes):
    return {'fingerprint': 'a' * 64, 'title': 'MCM and review', 'model': 'configured-model',
        'transcript': 'We reviewed the learning goals. Then we agreed the next progress actions.',
        'references': [{'id': 'mcm-template', 'name': 'Monthly', 'family': 'MCM', 'linked': True, 'prompts': ['Learning goals']},
                       {'id': 'pr-template', 'name': 'Progress', 'family': 'PR', 'linked': False, 'prompts': ['Progress actions']}],
        'sampled': False, 'unlinkedTranscriptExcluded': False, **changes}


def payload():
    return {'types': [
        {'type': 'MCM', 'confidence': 'medium', 'reason': 'Learning goals were discussed.',
         'referenceIds': ['mcm-template'], 'evidence': ['We reviewed the learning goals.']},
        {'type': 'PR', 'confidence': 'low', 'reason': 'Progress actions were discussed.',
         'referenceIds': ['pr-template'], 'evidence': ['Then we agreed the next progress actions.']},
    ], 'uncertainty': 'A quality reviewer must confirm the context.'}


class QualityEvidenceTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))

    def test_title_requires_signed_current_session_context(self):
        self.assertEqual(quality.calendar_context(record(), context()), 'MCM and review')
        for value in ('tampered', context(eventKey='mcr:2'), context(graphEventId='old-graph-id'),
                      context(startsAt='2026-10-19T09:00:00+00:00')):
            with self.assertRaises(quality.QualityUnavailable):
                quality.calendar_context(record(), value)

    def test_expired_title_context_is_rejected(self):
        with patch('django.core.signing.time.time', return_value=1):
            expired = context()
        with self.assertRaises(quality.QualityUnavailable):
            quality.calendar_context(record(), expired)

    def test_transcript_query_requires_current_graph_identity_in_addition_to_time(self):
        with self.assertRaises(quality.QualityUnavailable):
            quality.transcript_rows(record(graph_event_id=''))
        cursor = unittest.mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = []
        with patch.object(quality, 'connections', {'default': SimpleNamespace(cursor=lambda: cursor)}), \
                patch.object(quality.router, 'db_for_read', return_value='default'):
            self.assertEqual(quality.transcript_rows(record()), [])
        sql, parameters = cursor.execute.call_args.args
        self.assertIn('graph_event_id=%s', sql)
        self.assertEqual(parameters, ['mcr:1', 'graph-1'])

    def test_transcript_excludes_other_occurrences_and_duplicate_ids(self):
        rows = [{'id': 'one', 'text': 'Current meeting.', 'start': START, 'end': END},
                {'id': 'one', 'text': 'Duplicate', 'start': START, 'end': END},
                {'id': 'old', 'text': 'Another week', 'start': START - timedelta(days=7), 'end': END - timedelta(days=7)},
                {'id': 'unknown', 'text': 'Undated', 'start': None, 'end': None}]
        text, unknown = quality.scoped_transcript(record(), rows)
        self.assertEqual(text, 'Current meeting.')
        self.assertTrue(unknown)
        with self.assertRaises(quality.QualityUnavailable):
            quality.scoped_transcript(record(), rows[2:])

    def test_sample_covers_beginning_and_end_and_is_explicitly_partial(self):
        text = 'BEGIN' + 'x' * 60_000 + 'END'
        excerpt, partial = quality.sample_transcript(text)
        self.assertTrue(partial)
        self.assertTrue(excerpt.startswith('BEGIN'))
        self.assertTrue(excerpt.endswith('END'))
        self.assertLess(len(excerpt), 48_200)
        self.assertEqual(quality.sample_transcript('short'), ('short', False))

    def test_mixed_suggestion_requires_actual_transcript_quotes_and_template_ids(self):
        result = quality.validate_suggestion(payload(), analysis())
        self.assertTrue(result['mixed'])
        self.assertTrue(result['reviewOnly'])
        self.assertEqual([row['type'] for row in result['types']], ['MCM', 'PR'])
        for changes in ({'evidence': ['This quotation was invented.']}, {'type': 'SANCTION'},
                        {'referenceIds': ['unknown']}, {'referenceIds': ['pr-template']},
                        {'confidence': 0.9}, {'evidence': []}, {'referenceIds': []}):
            bad = payload(); bad['types'][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                quality.validate_suggestion(bad, analysis())

    def test_support_without_template_is_only_low_confidence_topic(self):
        data = payload(); data['types'] = [dict(data['types'][0], type='SUPPORT', referenceIds=[], confidence='high')]
        result = quality.validate_suggestion(data, analysis())
        self.assertEqual(result['types'][0]['confidence'], 'low')
        self.assertFalse(result['types'][0]['templateBased'])

    def test_insufficient_evidence_and_duplicate_types(self):
        result = quality.validate_suggestion({'types': [], 'uncertainty': 'Not enough context.'}, analysis())
        self.assertTrue(result['insufficientEvidence'])
        bad = payload(); bad['types'].append(bad['types'][0])
        with self.assertRaises(ValueError):
            quality.validate_suggestion(bad, analysis())

    def test_template_references_are_programme_scoped_question_labels_only(self):
        from curriculum_api import reviews, review_types
        with patch.object(quality.LearnerProfile.objects, 'filter') as learner, \
                patch.object(review_types, 'review_type_index', return_value={'m': {'code': 'mcm'}, 'p': {'code': 'progress_review'}}), \
                patch.object(reviews, 'get_review_template_rows', return_value=[
                    {'id': 'mcm-template', 'name': 'Monthly', 'review_type_id': 'm'},
                    {'id': 'pr-template', 'name': 'Progress', 'review_type_id': 'p'}]) as templates, \
                patch.object(reviews, 'get_review_section_rows', return_value=[{'id': 's', 'title': 'Goals', 'enabled': True}]), \
                patch.object(reviews, 'get_review_field_rows', return_value=[{'section_id': 's', 'title': 'Discuss progress?', 'private_value': 'never send'}]):
            learner.return_value.values.return_value.first.return_value = {'programme_id': 'programme-one'}
            result = quality.template_references(record())
        templates.assert_called_once_with('programme_id = %s and enabled = true', ['programme-one'])
        self.assertNotIn('never send', json.dumps(result))
        self.assertEqual({row['family'] for row in result}, {'MCM', 'PR'})

    @override_settings(OPENAI_API_KEY='synthetic-test-key')
    def test_one_bounded_provider_call_validated_without_hidden_retries(self):
        completion = SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content=json.dumps(payload()), refusal=None))])
        with patch('openai.OpenAI') as client:
            create = client.return_value.__enter__.return_value.chat.completions.create
            create.return_value = completion
            self.assertTrue(quality.analyse(analysis())['mixed'])
            client.assert_called_once_with(api_key='synthetic-test-key', max_retries=0, timeout=45.0)
            self.assertEqual(create.call_args.kwargs['model'], 'configured-model')
            self.assertFalse(create.call_args.kwargs['store'])
            self.assertEqual(create.call_count, 1)
            completion.choices[0].finish_reason = 'length'
            with self.assertRaises(ValueError):
                quality.analyse(analysis())
            self.assertEqual(create.call_count, 2)  # one attempt per explicit invocation

    def test_input_fingerprint_changes_with_title_transcript_templates_or_model(self):
        from . import views
        with patch.object(quality, 'transcript_rows', return_value=[]), \
                patch.object(quality, 'scoped_transcript', return_value=('transcript', False)) as transcript, \
                patch.object(quality, 'template_references', return_value=analysis()['references']) as templates:
            original = quality.prepare_analysis(record(), context())['fingerprint']
            self.assertEqual(quality.prepare_analysis(record(), context())['fingerprint'], original)
            self.assertNotEqual(quality.prepare_analysis(record(), context(title='Changed'))['fingerprint'], original)
            transcript.return_value = ('changed transcript', False)
            self.assertNotEqual(quality.prepare_analysis(record(), context())['fingerprint'], original)
            transcript.return_value = ('transcript', False)
            templates.return_value = [dict(row, name='Changed reference') for row in analysis()['references']]
            self.assertNotEqual(quality.prepare_analysis(record(), context())['fingerprint'], original)
            templates.return_value = analysis()['references']
            with patch.object(views, 'COACH_MEETING_SUMMARY_MODEL', 'another-model'):
                self.assertNotEqual(quality.prepare_analysis(record(), context())['fingerprint'], original)

    def test_migration_graph_and_cache_fields_match_without_connecting_to_a_database(self):
        from django.conf import settings
        from django.db.migrations.loader import MigrationLoader
        with override_settings(MIGRATION_MODULES={**settings.MIGRATION_MODULES, 'coach_api': 'coach_api.migrations'}):
            loader = MigrationLoader(None)
            loader.graph.validate_consistency()
            state = loader.project_state([('coach_api', '0027_coaching_quality_suggestion')])
            migrated = state.apps.get_model('coach_api', 'CoachingQualitySuggestion')
        self.assertEqual([field.deconstruct()[1:] for field in migrated._meta.fields],
                         [field.deconstruct()[1:] for field in CoachingQualitySuggestion._meta.fields])
        self.assertEqual(migrated._meta.db_table, 'Coach"."coaching_quality_suggestion')


class QualityApiTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.object(api, '_authorised_record', return_value=(record(), None)))
        self.prepare = self.enterContext(patch.object(api, 'prepare_analysis', return_value=analysis()))
        self.suggest = self.enterContext(patch.object(api, 'suggestion', return_value={'state': 'not-analysed', 'result': None}))
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))

    def call(self, method='get', csrf=True):
        request = getattr(self.factory, method)('/coach_api/coaching-recordings/quality?eventKey=mcr:1', HTTP_X_COACHING_CONTEXT='signed-title')
        if csrf:
            request._dont_enforce_csrf_checks = True
        # Skip only the outer auth wrapper here; actual role/ownership tests
        # exercise the shared gate in test_recordings_api.
        return api.coaching_quality_suggestion.__wrapped__.__wrapped__(request)

    def test_get_reads_only_and_post_is_explicit_generation(self):
        self.assertEqual(self.call().status_code, 200)
        self.suggest.assert_called_once_with(unittest.mock.ANY, analysis(), generate=False)
        self.assertEqual(self.call('post').status_code, 200)
        self.assertTrue(self.suggest.call_args.kwargs['generate'])
        self.assertEqual(self.prepare.call_args.args[1], 'signed-title')

    def test_post_requires_csrf_before_any_ai_or_evidence_read(self):
        self.assertEqual(self.call('post', csrf=False).status_code, 403)
        self.prepare.assert_not_called(); self.suggest.assert_not_called()

    def test_cancelled_upcoming_and_missing_evidence_refuse_analysis(self):
        for value in (record(sync_state='cancelled'), record(scheduled_date=date(2099, 1, 1)), record(scheduled_date=None)):
            with patch.object(api, '_authorised_record', return_value=(value, None)):
                self.assertEqual(self.call('post').status_code, 409)
        self.prepare.assert_not_called(); self.suggest.assert_not_called()

    def test_unavailable_evidence_does_not_issue_request(self):
        self.prepare.side_effect = quality.QualityUnavailable('No verified transcript.')
        self.assertEqual(self.call('post').status_code, 409)
        self.suggest.assert_not_called()

    def test_missing_cache_schema_is_reported_without_claiming_success(self):
        from django.db import DatabaseError
        self.suggest.side_effect = DatabaseError('private database details')
        response = self.call('post')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private database details', response.content.decode())

    @override_settings(OPENAI_API_KEY='')
    def test_keyword_get_reads_saved_evidence_without_ai_or_quality_cache_schema(self):
        text = 'Learning goals were reviewed. Study barriers were explored.'
        refs = analysis()['references']
        refs[0]['prompts'] = ['Learning goals', 'Study barriers']
        request = self.factory.get('/coach_api/coaching-recordings/quality?eventKey=mcr:1&method=keywords',
                                   HTTP_X_COACHING_CONTEXT=context())
        with patch.object(quality, 'transcript_rows', return_value=[{'id': 't', 'text': text, 'start': START, 'end': END}]), \
                patch.object(quality, 'template_references', return_value=refs) as read_templates, \
                patch.object(quality.CoachingQualitySuggestion.objects, 'filter', side_effect=AssertionError('Cache must not be used')), \
                patch('openai.OpenAI', side_effect=AssertionError('AI must not be used')):
            response = api.coaching_quality_suggestion.__wrapped__.__wrapped__(request)
        data = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(data['method'], 'keywords')
        self.assertEqual(data['state'], 'complete')
        self.assertEqual(data['result']['analysedCharacters'], len(text))
        self.assertEqual([row['type'] for row in data['result']['types']], ['MCM'])
        self.assertFalse(data['sampled'])
        read_templates.assert_called_once_with(unittest.mock.ANY, bounded=False)
        self.prepare.assert_not_called(); self.suggest.assert_not_called()

    def test_keyword_method_cannot_generate_ai_or_accept_unknown_modes(self):
        for method, mode in [('post', 'keywords'), ('get', 'unknown')]:
            request = getattr(self.factory, method)(f'/coach_api/coaching-recordings/quality?eventKey=mcr:1&method={mode}')
            request._dont_enforce_csrf_checks = True
            response = api.coaching_quality_suggestion.__wrapped__.__wrapped__(request)
            self.assertEqual(response.status_code, 400)
        self.prepare.assert_not_called(); self.suggest.assert_not_called()

    def test_missing_dated_transcript_is_not_invented_for_keywords(self):
        request = self.factory.get('/coach_api/coaching-recordings/quality?eventKey=mcr:1&method=keywords',
                                   HTTP_X_COACHING_CONTEXT=context())
        with patch.object(quality, 'transcript_rows', return_value=[]), \
                patch.object(api, 'source_details', return_value=None), \
                patch.object(api, '_saved_session_evidence', return_value={'transcript': None}):
            self.assertEqual(api.coaching_quality_suggestion.__wrapped__.__wrapped__(request).status_code, 409)
        self.prepare.assert_not_called(); self.suggest.assert_not_called()

    def test_keywords_reuse_the_same_verified_transcript_as_the_drawer(self):
        request = self.factory.get('/coach_api/coaching-recordings/quality?eventKey=mcr:1&method=keywords',
            HTTP_X_COACHING_CONTEXT=context())
        text = 'Learning goals were reviewed. Study barriers were explored.'
        refs = analysis()['references']
        refs[0]['prompts'] = ['Learning goals', 'Study barriers']
        with patch.object(quality, 'transcript_rows', return_value=[]), \
                patch.object(api, 'source_details', return_value=None), \
                patch.object(api, '_saved_session_evidence', return_value={'transcript': {'content': text}}) as saved, \
                patch.object(quality, 'template_references', return_value=refs), \
                patch('openai.OpenAI', side_effect=AssertionError('No AI call')):
            response = api.coaching_quality_suggestion.__wrapped__.__wrapped__(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['result']['analysedCharacters'], len(text))
        self.assertEqual(saved.call_args.kwargs['part'], 'evidence')
        self.prepare.assert_not_called(); self.suggest.assert_not_called()


class QualityCacheSqlTests(unittest.TestCase):
    """Only the new cache table on a newly created in-memory database alias."""
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if any(row['ENGINE'] != 'django.db.backends.sqlite3' for row in connections.databases.values()):
            raise RuntimeError('This suite requires the verified SQLite runner.')
        cls.alias = 'coaching_quality_isolated'
        config = copy.deepcopy(connections.databases['default'])
        config['NAME'] = ':memory:'
        connections.databases[cls.alias] = config
        cls.connection = connections[cls.alias]
        assert cls.connection.settings_dict['NAME'] == ':memory:'
        with cls.connection.schema_editor() as editor:
            editor.create_model(CoachingQualitySuggestion)

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()
        del connections[cls.alias]
        del connections.databases[cls.alias]
        super().tearDownClass()

    def setUp(self):
        self.manager = CoachingQualitySuggestion.objects.db_manager(self.alias)
        self.manager.all().delete()
        self.patch = patch.object(quality, 'CoachingQualitySuggestion', SimpleNamespace(objects=self.manager))
        self.patch.start(); self.addCleanup(self.patch.stop)
        self.network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.network.start(); self.addCleanup(self.network.stop)

    def test_get_is_read_only_and_post_reuses_saved_result(self):
        with patch.object(quality, 'analyse', return_value={'reviewOnly': True}) as provider:
            self.assertEqual(quality.suggestion(record(), analysis())['state'], 'not-analysed')
            self.assertEqual(self.manager.count(), 0)
            first = quality.suggestion(record(), analysis(), generate=True)
            second = quality.suggestion(record(), analysis(), generate=True)
            self.assertEqual(first['state'], 'complete')
            self.assertEqual(first['result'], second['result'])
            provider.assert_called_once()

    def test_concurrent_request_observes_lease_without_a_second_provider_request(self):
        def provider(value):
            self.assertEqual(quality.suggestion(record(), value, generate=True)['state'], 'running')
            return {'reviewOnly': True}
        with patch.object(quality, 'analyse', side_effect=provider) as call:
            self.assertEqual(quality.suggestion(record(), analysis(), generate=True)['state'], 'complete')
            call.assert_called_once()

    def test_failure_is_visible_cooldown_and_explicit_retry(self):
        with patch.object(quality, 'analyse', side_effect=RuntimeError('private provider error')) as provider:
            self.assertEqual(quality.suggestion(record(), analysis(), generate=True)['state'], 'failed')
            self.assertEqual(quality.suggestion(record(), analysis(), generate=True)['state'], 'failed')
            provider.assert_called_once()
        self.manager.update(lease_until=django_timezone.now() - timedelta(seconds=1))
        with patch.object(quality, 'analyse', return_value={'reviewOnly': True}) as provider:
            self.assertEqual(quality.suggestion(record(), analysis(), generate=True)['state'], 'complete')
            provider.assert_called_once()

    def test_changed_input_and_other_session_never_reuse_a_different_result(self):
        with patch.object(quality, 'analyse', return_value={'reviewOnly': True}) as provider:
            quality.suggestion(record(), analysis(), generate=True)
            quality.suggestion(record(), analysis(fingerprint='b' * 64), generate=True)
            quality.suggestion(record(event_key='mcr:2'), analysis(), generate=True)
            self.assertEqual(provider.call_count, 3)
            self.assertEqual(self.manager.count(), 3)

    def test_expired_claim_cannot_overwrite_result_of_new_owner(self):
        nested = False
        def provider(value):
            nonlocal nested
            if nested:
                return {'winner': 'new claim'}
            nested = True
            self.manager.update(lease_until=django_timezone.now() - timedelta(seconds=1))
            quality.suggestion(record(), value, generate=True)
            return {'winner': 'stale claim'}
        with patch.object(quality, 'analyse', side_effect=provider):
            result = quality.suggestion(record(), analysis(), generate=True)
        self.assertEqual(result['result'], {'winner': 'new claim'})


class QualityPermissionTests(SimpleTestCase):
    def setUp(self):
        self.staff = SimpleNamespace(email='coach@example.invalid', access='coach', access_extra='')
        self.account = SimpleNamespace(role='staff', subject_type='staff', subject_id=7)
        def authenticate(request):
            request.login_account = self.account
            return self.account
        self.enterContext(patch.object(permissions, 'authenticate_request', side_effect=authenticate))
        self.enterContext(patch.object(permissions, '_accesses_of', side_effect=lambda account: accesses_for_staff(self.staff)))
        self.enterContext(patch.object(recordings_api, '_staff', side_effect=lambda account: self.staff))
        self.roster = self.enterContext(patch.object(recordings_api, '_learners', return_value=[{'id': 1}]))
        self.query = self.enterContext(patch.object(recordings_api.CoachCalendarEvent.objects, 'filter'))
        self.query.return_value.first.return_value = record(owner_email='coach@example.invalid')
        self.prepare = self.enterContext(patch.object(api, 'prepare_analysis', return_value=analysis()))
        self.generate = self.enterContext(patch.object(api, 'suggestion', return_value={'state': 'complete', 'result': {}}))
        self.keywords = self.enterContext(patch.object(api, 'keyword_suggestion', return_value={'state': 'complete', 'result': {}, 'method': 'keywords'}))
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))

    def call(self, keywords=False):
        factory = RequestFactory()
        request = factory.get('/coach_api/coaching-recordings/quality?eventKey=mcr:1&method=keywords') if keywords else factory.post('/coach_api/coaching-recordings/quality?eventKey=mcr:1')
        request._dont_enforce_csrf_checks = True
        return api.coaching_quality_suggestion(request)

    def test_primary_secondary_and_curriculum_grants_keep_same_server_scope(self):
        for primary, extra in [('coach', ''), ('tutor', 'coach'), ('curriculum', ''), ('super-admin', '')]:
            self.staff.access, self.staff.access_extra = primary, extra
            self.assertEqual(self.call().status_code, 200)
            self.assertEqual(self.call(keywords=True).status_code, 200)

    def test_forbidden_roles_and_unknown_learner_never_analyse(self):
        self.staff.access = 'tutor'
        self.assertEqual(self.call().status_code, 403)
        self.assertEqual(self.call(keywords=True).status_code, 403)
        self.staff.access = 'coach'
        self.roster.return_value = [{'id': 2}]
        self.assertEqual(self.call().status_code, 404)
        self.assertEqual(self.call(keywords=True).status_code, 404)
        self.prepare.assert_not_called(); self.generate.assert_not_called()
        self.keywords.assert_not_called()

    def test_other_coachs_record_is_inaccessible_even_with_a_valid_context(self):
        self.query.return_value.first.return_value = record(owner_email='other@example.invalid')
        self.assertEqual(self.call().status_code, 404)
        self.assertEqual(self.call(keywords=True).status_code, 404)
        self.prepare.assert_not_called(); self.generate.assert_not_called()
        self.keywords.assert_not_called()
