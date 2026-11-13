"""Module Overview: validation, instructor resolution, duplication and endpoints.

    python manage.py test curriculum_api.tests_module_overview --settings=config.settings_sqlite_test

No database. The module row is a two-function seam (``read_module_row`` /
``write_overview``) stubbed with a dict, in line with the repository's standing
restriction on database-provisioning test runs.
"""
from __future__ import annotations

import json
from contextlib import ExitStack, nullcontext
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import Client, SimpleTestCase

from curriculum_api import module_overview as mo
from curriculum_api import views

MODULE = 'MOD-OVERVIEW-1'
COPY = 'MOD-OVERVIEW-2'
URL = f'/curriculum_api/curriculum/modules/{MODULE}/overview/'
COPY_URL = f'/curriculum_api/curriculum/modules/{COPY}/overview/copy/'
NOW = datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
RAY = mo.KNOWN_INSTRUCTOR_PHOTOS['ray mead']
ANDREW = mo.KNOWN_INSTRUCTOR_PHOTOS['andrew millington']
CUSTOM = 'https://images.example.org/people/tutor.png'


def editor_input(**overrides):
    value = {
        'summary': 'Plan and lead small digital projects.',
        'description': 'Paragraph one.\n\nParagraph two.',
        'targetAudience': ['Apprentices new to project roles'],
        'prerequisites': [],
        'requirements': ['A laptop with Microsoft Teams'],
        'instructorBio': '',
        'instructorPhotoUrl': '',
    }
    value.update(overrides)
    return value


class ValidationTests(SimpleTestCase):
    def test_clean_input_is_trimmed_deduplicated_and_kept_plain(self):
        cleaned = mo.validate_input(editor_input(
            summary='  Plan\n and   lead  ', targetAudience=['  A ', 'a', '', 'B'],
            description='Line\r\n\r\n\r\n\r\nNext\x07'))
        self.assertEqual(cleaned['summary'], 'Plan and lead')
        self.assertEqual(cleaned['targetAudience'], ['A', 'B'])
        self.assertEqual(cleaned['description'], 'Line\n\nNext')

    def test_html_is_refused_everywhere(self):
        for field, value in (('summary', '<b>bold</b>'), ('description', 'x <script>alert(1)</script>'),
                             ('instructorBio', '<img src=x onerror=alert(1)>'), ('prerequisites', ['<a href=x>'])):
            with self.subTest(field=field), self.assertRaises(mo.OverviewValidationError) as caught:
                mo.validate_input(editor_input(**{field: value}))
            self.assertIn('HTML is not allowed', str(caught.exception))
        # A plain "less than" is text, not markup.
        self.assertEqual(mo.validate_input(editor_input(summary='Scores < 40% need support'))['summary'],
                         'Scores < 40% need support')

    def test_limits_types_and_unknown_keys(self):
        cases = [
            editor_input(summary='x' * (mo.MAX_SUMMARY + 1)),
            editor_input(description='x' * (mo.MAX_DESCRIPTION + 1)),
            editor_input(requirements=[f'item {i}' for i in range(mo.MAX_LIST_ITEMS + 1)]),
            editor_input(requirements='not a list'),
            editor_input(summary=5),
            {**editor_input(), 'tutorName': 'Someone else'},
            {**editor_input(), 'schemaVersion': 9},
        ]
        for payload in cases:
            with self.subTest(payload=str(payload)[:60]), self.assertRaises(mo.OverviewValidationError):
                mo.validate_input(payload)

    def test_photo_urls_must_be_public_https_images(self):
        refused = [
            'http://images.example.org/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
            'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://10.0.0.5/a.png',
            'https://user:pass@images.example.org/a.png', 'https://images.example.org/a.svg',
            'https://images.example.org/page', 'https://images.example.org:8443/a.png',
            'https://images.example.org/a b.png', 'https://images.example.org/a.png"onerror="x',
            'https://intranet.local/a.png', 'https://' + 'a' * mo.MAX_URL + '.org/a.png',
        ]
        for url in refused:
            with self.subTest(url=url[:60]):
                self.assertTrue(mo.photo_url_error(url))
        for url in (*mo.KNOWN_INSTRUCTOR_PHOTOS.values(), CUSTOM, 'https://cdn.example.org/a.JPG?v=2'):
            with self.subTest(url=url[:60]):
                self.assertEqual(mo.photo_url_error(url), '')


class InstructorResolutionTests(SimpleTestCase):
    def test_the_five_known_instructors_resolve_by_exact_normalised_name(self):
        for name, url in (('Andrew Millington', ANDREW), ('  ray   MEAD ', RAY),
                          ('Stephen Jenner', mo.KNOWN_INSTRUCTOR_PHOTOS['stephen jenner']),
                          ('Amgad Badewi', mo.KNOWN_INSTRUCTOR_PHOTOS['amgad badewi']),
                          ('Steven Wake', mo.KNOWN_INSTRUCTOR_PHOTOS['steven wake'])):
            with self.subTest(name=name):
                self.assertEqual(mo.resolve_instructor(name, None)['photoUrl'], url)

    def test_no_partial_or_fuzzy_matches(self):
        # 'Dr Andrew Millington' moved to TitleAndAliasPhotoTests: leading titles are now ignored for photo lookup.
        for name in ('Andrew', 'Andrew Millington-Smith', 'Stephen Wake',
                     'Steven Jenner', 'Ray Meade', 'Someone New'):
            with self.subTest(name=name):
                resolved = mo.resolve_instructor(name, None)
                self.assertEqual(resolved['name'], name)
                self.assertEqual(resolved['photoUrl'], '')
                self.assertEqual(resolved['bio'], '')

    def test_unassigned_tutor_shows_no_instructor(self):
        for name in (None, '', '   ', 'Unassigned', 'To be assigned', 'TBA'):
            with self.subTest(name=name):
                self.assertIsNone(mo.resolve_instructor(name, {'instructor': {
                    'tutorName': 'Ray Mead', 'bio': 'Bio', 'photoUrl': CUSTOM}}))

    def test_saved_override_wins_only_for_its_own_tutor(self):
        stored = {'instructor': {'tutorName': 'Ray Mead', 'bio': 'Ray teaches projects.', 'photoUrl': CUSTOM}}
        self.assertEqual(mo.resolve_instructor('ray mead', stored),
                         {'name': 'ray mead', 'bio': 'Ray teaches projects.', 'photoUrl': CUSTOM})
        # Tutor changed: never the previous tutor's biography or photo.
        self.assertEqual(mo.resolve_instructor('Andrew Millington', stored),
                         {'name': 'Andrew Millington', 'bio': '', 'photoUrl': ANDREW})
        self.assertEqual(mo.resolve_instructor('Someone New', stored),
                         {'name': 'Someone New', 'bio': '', 'photoUrl': ''})

    def test_a_bio_without_a_photo_keeps_the_known_default(self):
        stored = {'instructor': {'tutorName': 'Ray Mead', 'bio': 'Bio only', 'photoUrl': ''}}
        self.assertEqual(mo.resolve_instructor('Ray Mead', stored)['photoUrl'], RAY)

    def test_an_unsafe_stored_photo_is_never_returned(self):
        stored = {'instructor': {'tutorName': 'Someone New', 'bio': 'Bio', 'photoUrl': 'javascript:alert(1)'}}
        self.assertEqual(mo.resolve_instructor('Someone New', stored)['photoUrl'], '')


class StoredShapeTests(SimpleTestCase):
    def test_nothing_authored_stores_null(self):
        empty = mo.validate_input(editor_input(summary='', description='', targetAudience=[], requirements=[]))
        self.assertIsNone(mo.build_stored(empty, current_tutor='Ray Mead', now=NOW))

    def test_instructor_details_are_bound_to_the_tutor_on_the_module_row(self):
        cleaned = mo.validate_input(editor_input(instructorBio='Bio', instructorPhotoUrl=CUSTOM))
        stored = mo.build_stored(cleaned, current_tutor='  Ray  Mead ', now=NOW)
        self.assertEqual(stored['instructor'], {'tutorName': 'Ray Mead', 'bio': 'Bio', 'photoUrl': CUSTOM})
        self.assertEqual(stored['schemaVersion'], 2)
        self.assertEqual(stored['updatedAt'], '2026-11-12T10:00:00.000000Z')

    def test_instructor_details_need_an_assigned_tutor(self):
        cleaned = mo.validate_input(editor_input(instructorBio='Bio'))
        with self.assertRaises(mo.OverviewValidationError):
            mo.build_stored(cleaned, current_tutor='Unassigned')

    def test_a_previous_tutors_override_is_kept_but_never_shown(self):
        previous = {'summary': 'Old', 'instructor': {'tutorName': 'Ray Mead', 'bio': 'Ray bio', 'photoUrl': CUSTOM}}
        stored = mo.build_stored(mo.validate_input(editor_input()), current_tutor='Andrew Millington', previous=previous)
        self.assertEqual(stored['instructor']['tutorName'], 'Ray Mead')
        self.assertEqual(mo.learner_view(stored, 'Andrew Millington')['instructor'],
                         {'name': 'Andrew Millington', 'bio': '', 'photoUrl': ANDREW})
        # Entering new details for the current tutor replaces it.
        replaced = mo.build_stored(mo.validate_input(editor_input(instructorBio='Andrew bio')),
                                   current_tutor='Andrew Millington', previous=previous)
        self.assertEqual(replaced['instructor'], {'tutorName': 'Andrew Millington', 'bio': 'Andrew bio', 'photoUrl': ''})

    def test_clearing_the_current_tutors_details_removes_them(self):
        previous = {'summary': 'S', 'instructor': {'tutorName': 'Ray Mead', 'bio': 'Ray bio', 'photoUrl': CUSTOM}}
        stored = mo.build_stored(mo.validate_input(editor_input()), current_tutor='Ray Mead', previous=previous)
        self.assertNotIn('instructor', stored)

    def test_learner_view_tolerates_text_garbage_and_null(self):
        self.assertEqual(mo.learner_view('{"summary": "Hi", "targetAudience": ["A", 3, ""]}', None),
                         {'summary': 'Hi', 'description': '', 'targetAudience': ['A'], 'prerequisites': [],
                          'requirements': [], 'highlights': [], 'descriptionSections': [], 'sidebarSections': [],
                          'instructor': None})
        for raw in (None, '', 'not json', '[1, 2]', 42):
            with self.subTest(raw=raw):
                self.assertEqual(mo.learner_view(raw, None)['summary'], '')


class DuplicateCopyTests(SimpleTestCase):
    source = {
        'schemaVersion': 1, 'summary': 'S', 'description': 'D', 'targetAudience': ['T'],
        'prerequisites': ['P'], 'requirements': ['R'],
        'instructor': {'tutorName': 'Ray Mead', 'bio': 'Ray bio', 'photoUrl': CUSTOM},
        'updatedAt': '2026-01-01T00:00:00.000000Z',
    }

    def test_same_tutor_copies_descriptive_fields_and_the_instructor_override(self):
        copied = mo.copy_for_duplicate(json.dumps(self.source), target_tutor='ray mead', now=NOW)
        for key in ('summary', 'description', 'targetAudience', 'prerequisites', 'requirements'):
            self.assertEqual(copied[key], self.source[key])
        self.assertEqual(copied['instructor'], {'tutorName': 'ray mead', 'bio': 'Ray bio', 'photoUrl': CUSTOM})
        self.assertEqual(copied['updatedAt'], '2026-11-12T10:00:00.000000Z')

    def test_different_tutor_copies_descriptive_fields_only(self):
        copied = mo.copy_for_duplicate(self.source, target_tutor='Andrew Millington', now=NOW)
        self.assertEqual(copied['summary'], 'S')
        self.assertNotIn('instructor', copied)
        self.assertEqual(mo.learner_view(copied, 'Andrew Millington')['instructor'],
                         {'name': 'Andrew Millington', 'bio': '', 'photoUrl': ANDREW})

    def test_unassigned_target_tutor_drops_the_override(self):
        self.assertNotIn('instructor', mo.copy_for_duplicate(self.source, target_tutor=''))

    def test_nothing_to_copy(self):
        self.assertIsNone(mo.copy_for_duplicate(None, target_tutor='Ray Mead'))
        self.assertIsNone(mo.copy_for_duplicate({'summary': ''}, target_tutor='Ray Mead'))


class FakeModules:
    """The ``curriculum.modules`` rows the endpoints read and write."""

    def __init__(self):
        self.rows = {
            MODULE: {'module_catalogue_id': MODULE, 'tutor_name': 'Ray Mead', 'module_overview': None,
                     'title': 'Untouched title', 'description': 'Untouched notes'},
            COPY: {'module_catalogue_id': COPY, 'tutor_name': 'Ray Mead', 'module_overview': None,
                   'title': 'Copy title', 'description': ''},
        }
        self.writes = []

    def read(self, module_id, *, lock=False):
        row = self.rows.get(module_id)
        return dict(row) if row else None

    def write(self, module_id, stored):
        self.writes.append((module_id, stored))
        self.rows[module_id]['module_overview'] = json.dumps(stored) if stored is not None else None
        return [self.rows[module_id]]


class EndpointTestCase(SimpleTestCase):
    def setUp(self):
        self.modules = FakeModules()
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.available = stack.enter_context(patch.object(mo, 'column_available', return_value=True))
        stack.enter_context(patch.object(mo, 'read_module_row', side_effect=self.modules.read))
        stack.enter_context(patch.object(mo, 'write_overview', side_effect=self.modules.write))
        stack.enter_context(patch.object(views, 'resolve_stored_module_catalogue_id', return_value=None))
        self.invalidate = stack.enter_context(patch.object(views, 'invalidate_curriculum_cache'))
        # No database: the row lock/transaction is the stub's job here.
        stack.enter_context(patch.object(mo.transaction, 'atomic', side_effect=lambda *a, **k: nullcontext()))
        self.client = Client()

    def put(self, overview, expected=None, url=URL, client=None):
        return (client or self.client).put(url, json.dumps({'overview': overview, 'expectedUpdatedAt': expected}),
                                           content_type='application/json')


class EndpointTests(EndpointTestCase):
    def test_empty_module_loads_with_tutor_and_default_photo(self):
        body = self.client.get(URL).json()
        self.assertFalse(body['hasOverview'])
        self.assertIsNone(body['updatedAt'])
        self.assertEqual(body['tutorName'], 'Ray Mead')
        self.assertEqual(body['defaultPhotoUrl'], RAY)
        self.assertEqual(body['overview']['summary'], '')

    def test_save_then_load_round_trip_writes_only_the_overview(self):
        response = self.put(editor_input(instructorBio='Ray bio'))
        self.assertEqual(response.status_code, 200, response.content)
        saved = response.json()
        self.assertTrue(saved['saved'])
        self.assertTrue(saved['hasOverview'])
        self.assertEqual(saved['overview']['instructorBio'], 'Ray bio')
        self.assertEqual(len(self.modules.writes), 1)
        loaded = self.client.get(URL).json()
        self.assertEqual(loaded['updatedAt'], saved['updatedAt'])
        self.assertEqual(loaded['overview']['requirements'], ['A laptop with Microsoft Teams'])
        self.assertEqual(self.modules.rows[MODULE]['title'], 'Untouched title')
        self.assertEqual(self.modules.rows[MODULE]['description'], 'Untouched notes')
        self.invalidate.assert_called_once()

    def test_stale_or_missing_revision_is_refused(self):
        first = self.put(editor_input()).json()
        # Someone else saved after the editor loaded "no overview".
        stale = self.put(editor_input(summary='Mine'))
        self.assertEqual(stale.status_code, 409)
        self.assertTrue(stale.json()['conflict'])
        self.assertEqual(stale.json()['current']['updatedAt'], first['updatedAt'])
        self.assertEqual(self.put(editor_input(summary='Mine'), expected='2000-01-01T00:00:00.000000Z').status_code, 409)
        ok = self.put(editor_input(summary='Mine'), expected=first['updatedAt'])
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(self.modules.writes), 2)

    def test_invalid_input_reports_fields_and_writes_nothing(self):
        response = self.put(editor_input(summary='<b>x</b>', instructorPhotoUrl='http://x.org/a.png'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual({item['field'] for item in response.json()['fields']}, {'summary', 'instructorPhotoUrl'})
        self.assertEqual(self.modules.writes, [])

    def test_clearing_everything_stores_null(self):
        first = self.put(editor_input()).json()
        cleared = self.put(editor_input(summary='', description='', targetAudience=[], requirements=[]),
                           expected=first['updatedAt'])
        self.assertEqual(cleared.status_code, 200)
        self.assertFalse(cleared.json()['hasOverview'])
        self.assertIsNone(self.modules.writes[-1][1])

    def test_unknown_module_missing_column_and_bad_methods(self):
        self.assertEqual(self.client.get('/curriculum_api/curriculum/modules/MOD-NOPE/overview/').status_code, 404)
        self.assertEqual(self.put(editor_input(), url='/curriculum_api/curriculum/modules/MOD-NOPE/overview/').status_code, 404)
        self.assertEqual(self.client.post(URL, {}).status_code, 405)
        self.assertEqual(self.client.put(URL, 'not json', content_type='application/json').status_code, 400)
        self.available.return_value = False
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], 'overview_storage_missing')
        self.assertEqual(self.client.get('/curriculum_api/curriculum/module-overviews/').json(),
                         {'available': False, 'moduleIds': []})
        self.assertEqual(self.modules.writes, [])

    def test_database_errors_are_reported_not_hidden(self):
        with patch.object(mo, 'read_module_row', side_effect=DatabaseError('down')):
            self.assertEqual(self.client.get(URL).status_code, 503)
            self.assertEqual(self.put(editor_input()).status_code, 503)

    def test_status_lists_modules_with_an_overview(self):
        with patch.object(mo, 'overview_module_ids', return_value=[MODULE]):
            self.assertEqual(self.client.get('/curriculum_api/curriculum/module-overviews/').json(),
                             {'available': True, 'moduleIds': [MODULE]})

    def test_writes_require_a_csrf_token(self):
        strict = Client(enforce_csrf_checks=True)
        self.assertEqual(self.put(editor_input(), client=strict).status_code, 403)
        self.assertEqual(strict.post(COPY_URL, json.dumps({'sourceModuleCatalogueId': MODULE}),
                                     content_type='application/json').status_code, 403)
        token = strict.get('/curriculum_api/curriculum/module-overviews/csrf/').json()['csrfToken']
        response = strict.put(URL, json.dumps({'overview': editor_input(), 'expectedUpdatedAt': None}),
                              content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200, response.content)

    def test_write_overview_names_only_its_own_column(self):
        # ``real_write`` is the implementation captured before setUp's patch.
        with patch.object(views, 'update_rows', return_value=[{}]) as update:
            type(self).real_write(MODULE, {'summary': 'S'})
            table, where, params, payload = update.call_args.args
            self.assertEqual(table, views.AUTHORING_MODULES_TABLE)
            self.assertEqual((where, params), ('module_catalogue_id = %s', [MODULE]))
            self.assertEqual(payload, {'module_overview': json.dumps({'summary': 'S'})})
            self.assertEqual(update.call_args.kwargs['allow_null_columns'], ['module_overview'])
            type(self).real_write(MODULE, None)
            self.assertEqual(update.call_args.args[3], {'module_overview': None})

    real_write = staticmethod(mo.write_overview)


class DuplicateEndpointTests(EndpointTestCase):
    def seed_source(self, tutor='Ray Mead'):
        self.modules.rows[MODULE]['module_overview'] = json.dumps({
            'schemaVersion': 1, 'summary': 'S', 'description': 'D', 'targetAudience': ['T'],
            'prerequisites': [], 'requirements': [],
            'instructor': {'tutorName': tutor, 'bio': 'Bio', 'photoUrl': CUSTOM}})

    def copy(self, source=MODULE):
        return self.client.post(COPY_URL, json.dumps({'sourceModuleCatalogueId': source}),
                                content_type='application/json')

    def test_same_tutor_duplicate_copies_overview_and_instructor(self):
        self.seed_source()
        body = self.copy().json()
        self.assertTrue(body['copied'])
        self.assertTrue(body['instructorCopied'])
        self.assertFalse(body['instructorDropped'])
        stored = self.modules.writes[-1][1]
        self.assertEqual(self.modules.writes[-1][0], COPY)
        self.assertEqual(stored['instructor']['tutorName'], 'Ray Mead')
        self.assertEqual(body['overview']['instructorBio'], 'Bio')

    def test_different_tutor_duplicate_resolves_to_its_own_tutor(self):
        self.seed_source()
        self.modules.rows[COPY]['tutor_name'] = 'Andrew Millington'
        body = self.copy().json()
        self.assertTrue(body['copied'])
        self.assertFalse(body['instructorCopied'])
        self.assertTrue(body['instructorDropped'])
        stored = self.modules.writes[-1][1]
        self.assertNotIn('instructor', stored)
        self.assertEqual(mo.learner_view(stored, 'Andrew Millington')['instructor']['photoUrl'], ANDREW)

    def test_never_overwrites_and_never_guesses(self):
        self.assertEqual(self.copy().json(), {'copied': False, 'reason': 'source_has_no_overview'})
        self.seed_source()
        self.modules.rows[COPY]['module_overview'] = json.dumps({'summary': 'Already authored'})
        self.assertEqual(self.copy().json(), {'copied': False, 'reason': 'target_has_overview'})
        self.assertEqual(self.copy(source='').status_code, 400)
        self.assertEqual(self.copy(source=COPY).status_code, 400)
        self.assertEqual(self.copy(source='MOD-NOPE').status_code, 404)
        self.assertEqual(self.modules.writes, [])


class AccessTests(SimpleTestCase):
    def test_overview_endpoints_are_staff_only_at_the_api_gate(self):
        from login import api_gate
        for path in (URL, COPY_URL, '/curriculum_api/curriculum/module-overviews/',
                     '/curriculum_api/curriculum/module-overviews/csrf/'):
            with self.subTest(path=path):
                prefix, roles = api_gate.rule_for(path)
                self.assertEqual(roles, api_gate.STAFF)
                self.assertNotIn('learner', roles)
                self.assertNotIn('employer', roles)


class LearnerReadTests(SimpleTestCase):
    def cursor(self, value=None, error=None):
        cursor = MagicMock()
        cursor.fetchone.return_value = (value,)
        if error:
            cursor.execute.side_effect = error
        return cursor

    def test_reads_one_module_by_id_and_resolves_the_instructor(self):
        cursor = self.cursor(json.dumps({'summary': 'Hi', 'requirements': ['Laptop']}))
        view = mo.read_learner_overview(cursor, 'MOD-1', 'Ray Mead')
        self.assertEqual(cursor.execute.call_args.args[1], ['MOD-1'])
        self.assertIn("to_jsonb(m)->'module_overview'", cursor.execute.call_args.args[0])
        self.assertEqual(view['summary'], 'Hi')
        self.assertEqual(view['requirements'], ['Laptop'])
        self.assertEqual(view['instructor'], {'name': 'Ray Mead', 'bio': '', 'photoUrl': RAY})

    def test_missing_column_or_row_or_error_is_an_empty_overview(self):
        for cursor in (self.cursor(None), self.cursor(error=DatabaseError('x'))):
            with self.subTest(cursor=cursor):
                view = mo.read_learner_overview(cursor, 'MOD-1', 'Someone New')
                self.assertEqual(view['summary'], '')
                self.assertEqual(view['instructor'], {'name': 'Someone New', 'bio': '', 'photoUrl': ''})


class SchemaVersionTwoTests(SimpleTestCase):
    """Description sections and highlights (schemaVersion 2), v1 compatibility."""

    def section(self, **overrides):
        return {'id': 'practise', 'heading': "What you'll practise", 'body': 'Role-play a coaching conversation.',
                'bullets': ['Ask an open question', 'Agree an action'], **overrides}

    def test_sections_and_highlights_are_cleaned_in_order(self):
        cleaned = mo.validate_input(editor_input(
            highlights=[' Self-paced study ', 'self-paced study', 'Coaching practice'],
            descriptionSections=[
                self.section(),
                {'id': 'blank', 'heading': '  ', 'body': '', 'bullets': ['  ']},
                self.section(id='access', heading='Enrolment  and access', body='Open\r\n\r\n\r\nenrolment.', bullets=[]),
            ]))
        self.assertEqual(cleaned['highlights'], ['Self-paced study', 'Coaching practice'])
        self.assertEqual([s['id'] for s in cleaned['descriptionSections']], ['practise', 'access'])
        self.assertEqual(cleaned['descriptionSections'][1]['heading'], 'Enrolment and access')
        self.assertEqual(cleaned['descriptionSections'][1]['body'], 'Open\n\nenrolment.')

    def test_section_ids_are_made_safe_and_unique(self):
        cleaned = mo.validate_input(editor_input(descriptionSections=[
            self.section(id='same'), self.section(id='same'), self.section(id='<bad id>'), self.section(id=None)]))
        ids = [s['id'] for s in cleaned['descriptionSections']]
        self.assertEqual(len(set(ids)), 4)
        self.assertEqual(ids[:2], ['same', 'same-2'])
        self.assertEqual(ids[2], 'section-3')

    def test_section_validation_errors_are_field_specific(self):
        cases = {
            'descriptionSections[0].heading': [self.section(heading='')],
            'descriptionSections[0].body': [self.section(body='<script>x</script>')],
            'descriptionSections[0].bullets[1]': [self.section(bullets=['ok', 'x' * 201])],
            'descriptionSections[0]': [self.section(colour='red')],
            'descriptionSections': [self.section(id=f's{i}') for i in range(mo.MAX_SECTIONS + 1)],
        }
        for field, sections in cases.items():
            with self.subTest(field=field), self.assertRaises(mo.OverviewValidationError) as caught:
                mo.validate_input(editor_input(descriptionSections=sections))
            self.assertIn(field, [error['field'] for error in caught.exception.errors])
        with self.assertRaises(mo.OverviewValidationError):
            mo.validate_input(editor_input(descriptionSections='not a list'))

    def test_schema_versions_one_and_two_are_accepted_others_refused(self):
        for version in (1, 2, None):
            mo.validate_input(editor_input(schemaVersion=version))
        for version in (3, '2', True):
            with self.subTest(version=version), self.assertRaises(mo.OverviewValidationError):
                mo.validate_input(editor_input(schemaVersion=version))

    def test_a_section_alone_counts_as_authored_and_is_stored(self):
        cleaned = mo.validate_input(editor_input(summary='', description='', targetAudience=[], requirements=[],
                                                 descriptionSections=[self.section()]))
        stored = mo.build_stored(cleaned, current_tutor='Ray Mead', now=NOW)
        self.assertEqual(stored['schemaVersion'], 2)
        self.assertEqual(stored['descriptionSections'], [self.section()])
        highlights_only = mo.validate_input(editor_input(summary='', description='', targetAudience=[], requirements=[],
                                                         highlights=['One']))
        self.assertIsNotNone(mo.build_stored(highlights_only, current_tutor='Ray Mead', now=NOW))

    def test_version_one_records_read_unchanged(self):
        v1 = {'schemaVersion': 1, 'summary': 'S', 'description': 'D', 'targetAudience': ['T'],
              'prerequisites': [], 'requirements': [], 'updatedAt': '2026-01-01T00:00:00.000000Z'}
        learner = mo.learner_view(json.dumps(v1), 'Ray Mead')
        self.assertEqual(learner['descriptionSections'], [])
        self.assertEqual(learner['highlights'], [])
        self.assertEqual(learner['summary'], 'S')
        editor = mo.editor_view(MODULE, v1, 'Ray Mead')
        self.assertEqual(editor['overview']['descriptionSections'], [])
        self.assertEqual(editor['updatedAt'], v1['updatedAt'])
        self.assertTrue(editor['hasOverview'])

    def test_malformed_stored_sections_are_skipped_not_fatal(self):
        stored = {'descriptionSections': [None, 'x', {'heading': ''}, {'heading': 'Kept', 'bullets': ['a', 4]},
                                          {'id': 'Kept', 'heading': 'Also kept', 'body': 7}]}
        sections = mo.learner_view(stored, None)['descriptionSections']
        self.assertEqual([s['heading'] for s in sections], ['Kept', 'Also kept'])
        self.assertEqual(sections[0]['bullets'], ['a'])
        self.assertEqual(sections[1]['body'], '')
        self.assertEqual(len({s['id'] for s in sections}), 2)

    def test_duplicate_copies_sections_and_highlights(self):
        source = {'summary': 'S', 'highlights': ['H'], 'descriptionSections': [self.section()]}
        copied = mo.copy_for_duplicate(source, target_tutor='Andrew Millington', now=NOW)
        self.assertEqual(copied['highlights'], ['H'])
        self.assertEqual(copied['descriptionSections'], [self.section()])


class SchemaVersionTwoEndpointTests(EndpointTestCase):
    def test_sections_round_trip_and_deleting_one_persists_only_on_save(self):
        sections = [
            {'id': 'a', 'heading': 'First', 'body': 'One', 'bullets': []},
            {'id': 'b', 'heading': 'Second', 'body': '', 'bullets': ['x', 'y']},
        ]
        first = self.put(editor_input(schemaVersion=2, highlights=['H1'], descriptionSections=sections))
        self.assertEqual(first.status_code, 200, first.content)
        loaded = self.client.get(URL).json()
        self.assertEqual(loaded['overview']['descriptionSections'], sections)
        self.assertEqual(loaded['overview']['highlights'], ['H1'])
        # Reordered, one section removed and one bullet deleted.
        edited = [{**sections[1], 'bullets': ['y']}]
        second = self.put(editor_input(schemaVersion=2, highlights=[], descriptionSections=edited),
                          expected=first.json()['updatedAt'])
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(self.client.get(URL).json()['overview']['descriptionSections'], edited)
        self.assertEqual(json.loads(self.modules.rows[MODULE]['module_overview'])['highlights'], [])
        self.assertEqual(self.modules.rows[MODULE]['title'], 'Untouched title')
        self.assertEqual(len(self.modules.writes), 2)

    def test_reading_a_v1_record_does_not_write(self):
        self.modules.rows[MODULE]['module_overview'] = json.dumps({'schemaVersion': 1, 'summary': 'Old',
                                                                   'updatedAt': '2026-01-01T00:00:00.000000Z'})
        body = self.client.get(URL).json()
        self.assertEqual(body['overview']['summary'], 'Old')
        self.assertEqual(self.modules.writes, [])


class SidebarSectionTests(SimpleTestCase):
    """Custom sidebar sections: same item rules as Description sections, own list and limit."""

    def section(self, **overrides):
        return {'id': 'tools', 'heading': 'Tools & software', 'body': 'Used throughout.',
                'bullets': ['Microsoft Excel', 'Microsoft Project'], **overrides}

    def test_sidebar_sections_are_cleaned_and_kept_in_order(self):
        cleaned = mo.validate_input(editor_input(sidebarSections=[
            self.section(), {'id': 'blank', 'heading': ' ', 'body': '', 'bullets': []},
            self.section(id='kit', heading=' Kit  list ', body='', bullets=[' Headset ', 'headset'])]))
        self.assertEqual([s['id'] for s in cleaned['sidebarSections']], ['tools', 'kit'])
        self.assertEqual(cleaned['sidebarSections'][1], {'id': 'kit', 'heading': 'Kit list', 'body': '', 'bullets': ['Headset']})
        # Description sections are untouched by a sidebar edit.
        self.assertEqual(cleaned['descriptionSections'], [])

    def test_sidebar_errors_name_the_sidebar_list(self):
        cases = {
            'sidebarSections[0].heading': [self.section(heading='')],
            'sidebarSections[0].body': [self.section(body='<b>x</b>')],
            'sidebarSections[0].bullets[0]': [self.section(bullets=['x' * 201])],
            'sidebarSections': [self.section(id=f's{i}') for i in range(mo.MAX_SIDEBAR_SECTIONS + 1)],
        }
        for field, sections in cases.items():
            with self.subTest(field=field), self.assertRaises(mo.OverviewValidationError) as caught:
                mo.validate_input(editor_input(sidebarSections=sections))
            self.assertIn(field, [error['field'] for error in caught.exception.errors])

    def test_a_sidebar_section_alone_is_authored_content(self):
        cleaned = mo.validate_input(editor_input(summary='', description='', targetAudience=[], requirements=[],
                                                 sidebarSections=[self.section()]))
        stored = mo.build_stored(cleaned, current_tutor='Ray Mead', now=NOW)
        self.assertEqual(stored['sidebarSections'], [self.section()])
        self.assertEqual(stored['schemaVersion'], 2)

    def test_records_without_sidebar_sections_still_read(self):
        for stored in ({'schemaVersion': 1, 'summary': 'S'},
                       {'schemaVersion': 2, 'summary': 'S', 'descriptionSections': [], 'highlights': []}):
            with self.subTest(stored=stored):
                self.assertEqual(mo.learner_view(stored, None)['sidebarSections'], [])
                self.assertEqual(mo.editor_view(MODULE, stored, None)['overview']['sidebarSections'], [])

    def test_malformed_stored_sidebar_sections_are_skipped(self):
        stored = {'sidebarSections': [None, {'heading': ''}, {'heading': 'Kept', 'bullets': ['a', 3]}, 'x'],
                  'descriptionSections': [{'heading': 'Description one'}]}
        view = mo.learner_view(stored, None)
        self.assertEqual([s['heading'] for s in view['sidebarSections']], ['Kept'])
        self.assertEqual([s['heading'] for s in view['descriptionSections']], ['Description one'])

    def test_duplicate_copies_sidebar_sections(self):
        copied = mo.copy_for_duplicate({'sidebarSections': [self.section()]}, target_tutor='Ray Mead', now=NOW)
        self.assertEqual(copied['sidebarSections'], [self.section()])


class SidebarSectionEndpointTests(EndpointTestCase):
    def test_sidebar_sections_round_trip_reorder_and_delete(self):
        one = {'id': 'a', 'heading': 'Tools', 'body': '', 'bullets': ['Excel']}
        two = {'id': 'b', 'heading': 'Support', 'body': 'Ask your tutor.', 'bullets': []}
        first = self.put(editor_input(sidebarSections=[one, two]))
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(self.client.get(URL).json()['overview']['sidebarSections'], [one, two])
        second = self.put(editor_input(sidebarSections=[{**two}, {**one, 'bullets': []}]), expected=first.json()['updatedAt'])
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(self.client.get(URL).json()['overview']['sidebarSections'], [two, {**one, 'bullets': []}])
        third = self.put(editor_input(sidebarSections=[two]), expected=second.json()['updatedAt'])
        self.assertEqual(json.loads(self.modules.rows[MODULE]['module_overview'])['sidebarSections'], [two])
        self.assertEqual(third.status_code, 200)
        self.assertEqual(self.modules.rows[MODULE]['title'], 'Untouched title')


class TitleAndAliasPhotoTests(SimpleTestCase):
    """Photo lookup ignores leading titles and applies approved aliases only."""

    def photo(self, key):
        return mo.KNOWN_INSTRUCTOR_PHOTOS[key]

    def test_titled_and_aliased_names_resolve_to_the_right_photo(self):
        cases = {
            'Dr. Ray Mead': 'ray mead', 'Ray Mead': 'ray mead', 'DR RAY MEAD': 'ray mead', 'Dr.Ray Mead': 'ray mead',
            'Steve Wake': 'steven wake', 'Steven Wake': 'steven wake', 'Dr Steve Wake': 'steven wake',
            'Dr. Amgad Badewi': 'amgad badewi', 'Professor Amgad Badewi': 'amgad badewi', 'Prof. Amgad Badewi': 'amgad badewi',
            'Prof Dr Amgad Badewi': 'amgad badewi', 'Dr, Amgad Badewi': 'amgad badewi',
            'Andrew Millington': 'andrew millington', 'Dr Andrew Millington': 'andrew millington',
            'Stephen Jenner': 'stephen jenner',
        }
        for name, key in cases.items():
            with self.subTest(name=name):
                resolved = mo.resolve_instructor(name, None)
                self.assertEqual(resolved['photoUrl'], self.photo(key))
                # The name learners see is the tutor name as stored, title and all.
                self.assertEqual(resolved['name'], name)

    def test_titles_are_only_removed_from_the_start_and_nothing_is_guessed(self):
        for name in ('Ray Dr Mead', 'Ray Mead Dr', 'Drew Smith', 'Professorial Ray Mead', 'Dr', 'Dr.', 'Professor',
                     'Steve', 'Wake', 'Stephen Wake', 'Steven Wakes', 'Dr. Stephen Wake', 'Mr Ray Mead', 'Someone New'):
            with self.subTest(name=name):
                self.assertEqual(mo.default_photo_url(name), '')
        self.assertEqual(mo.photo_lookup_key('  Dr.  Ray   MEAD '), 'ray mead')
        self.assertEqual(mo.photo_lookup_key('Steve Wake'), 'steven wake')
        self.assertEqual(mo.photo_lookup_key('Ray Dr Mead'), 'ray dr mead')

    def test_a_saved_photo_for_the_current_tutor_still_wins(self):
        stored = {'instructor': {'tutorName': 'Dr. Ray Mead', 'bio': 'Bio', 'photoUrl': CUSTOM}}
        self.assertEqual(mo.resolve_instructor('Dr. Ray Mead', stored),
                         {'name': 'Dr. Ray Mead', 'bio': 'Bio', 'photoUrl': CUSTOM})
        # Bio only: the known photo still resolves through the title-insensitive lookup.
        bio_only = {'instructor': {'tutorName': 'Steve Wake', 'bio': 'Steve bio', 'photoUrl': ''}}
        self.assertEqual(mo.resolve_instructor('Steve Wake', bio_only)['photoUrl'], self.photo('steven wake'))

    def test_a_tutor_change_never_shows_the_previous_tutors_details(self):
        stored = {'instructor': {'tutorName': 'Ray Mead', 'bio': 'Ray bio', 'photoUrl': CUSTOM}}
        resolved = mo.resolve_instructor('Professor Amgad Badewi', stored)
        self.assertEqual(resolved, {'name': 'Professor Amgad Badewi', 'bio': '', 'photoUrl': self.photo('amgad badewi')})
        # Saved details stay bound to the exact tutor they were written for.
        self.assertEqual(mo.resolve_instructor('Dr. Ray Mead', stored)['bio'], '')

    def test_learner_view_and_editor_preview_resolve_the_same_photo(self):
        for name in ('Dr. Ray Mead', 'Steve Wake', 'Professor Amgad Badewi', 'Someone New'):
            with self.subTest(name=name):
                learner = mo.learner_view(None, name)['instructor']['photoUrl']
                editor = mo.editor_view(MODULE, None, name)['defaultPhotoUrl']
                self.assertEqual(learner, editor)
