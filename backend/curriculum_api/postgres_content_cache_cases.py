"""Content cache cases for run_content_cache_postgres_tests.py only.

Not a test_*.py module: it creates tables and must never be discovered by a
normal test run. The runner has already proved the database is an empty local
PostgreSQL before this is imported.

Every case compares the learner tree built from cached rows with the one built
straight from the database (CURRICULUM_CONTENT_CACHE=false), serialised to
JSON, so "equal" means byte-for-byte the same response content.
"""
import json
import os
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from django.core.cache import cache
from django.db import connections

from curriculum_api import content_cache
from learner_api import learner_detail

SCHEMA = '''
CREATE SCHEMA curriculum;
CREATE TABLE curriculum.modules (module_catalogue_id text PRIMARY KEY, title text,
    deleted_at timestamptz, deleted_via_parent text);
CREATE TABLE curriculum.weeks (id text PRIMARY KEY, module_catalogue_id text, title text,
    week_number int, display_order int, deleted_at timestamptz, deleted_via_parent text);
CREATE TABLE curriculum.components (id text PRIMARY KEY, week_id text, module_catalogue_id text,
    type text, title text, description text, settings_json jsonb, live_sessions_link text,
    display_order int, ksb_mappings jsonb, reflection_required boolean DEFAULT false,
    "Reflection_Question" text, tutor_validation_required boolean DEFAULT false,
    expected_otjh numeric, deleted_at timestamptz, deleted_via_parent text);
CREATE TABLE curriculum.ksb_mappings (id serial PRIMARY KEY, component_id text, module_catalogue_id text,
    ksb_code text, ksb_description text, classification text, weight numeric, weight_class text,
    deleted_at timestamptz, deleted_via_parent text);
CREATE TABLE curriculum.quizzes (id bigint PRIMARY KEY, title text, questions int, duration int, time_unit text);
CREATE TABLE curriculum.quiz_component_links (quiz_id bigint, component_id text);
'''

# Ids chosen to sort differently under a linguistic collation (case, '_', '-').
MODULES = [('MOD-b', 'Beta'), ('MOD-A', 'Alpha'), ('MOD_Z', 'Zed'), ('MOD-ARCH', 'Archived')]
WEEKS = [
    ('w-b2', 'MOD-b', 'Week two', 2, 2), ('w-b1', 'MOD-b', '', 1, 1), ('W-B0', 'MOD-b', 'Intro', 0, None),
    ('w-a1', 'MOD-A', 'A one', 1, 1), ('w_a2', 'MOD-A', 'A two', 2, 1),
    ('w-z1', 'MOD_Z', 'Z one', 1, 1), ('w-arch', 'MOD-ARCH', 'Old', 1, 1),
]


def component(cid, week, module, ctype, title, order, settings, otjh=None, ksbs=None, **extra):
    return dict(id=cid, week_id=week, module_catalogue_id=module, type=ctype, title=title,
                description=extra.get('description', '<p>About</p>'), settings_json=json.dumps(settings),
                live_sessions_link=extra.get('link', ''), display_order=order,
                ksb_mappings=json.dumps(ksbs) if ksbs is not None else None, expected_otjh=otjh,
                deleted_at=extra.get('deleted_at'), deleted_via_parent=extra.get('via'))


COMPONENTS = [
    component('c-b1', 'w-b1', 'MOD-b', 'reading', 'Read me', 2,
              {'readingContent': '<p>Body</p>', 'lessonContent': 'x' * 500, 'speakerNotes': 'n'}, 1.5),
    component('C-b2', 'w-b1', 'MOD-b', 'video', 'Watch', 1, {'videoUrl': 'https://example.invalid/v.mp4'}, 2),
    component('c-b3', 'w-b1', 'MOD-b', 'video', 'Removed video', 3, {}),
    component('c-b4', 'w-b2', 'MOD-b', 'quiz', 'Quiz', None, {'linkedQuizId': 7}, 0.5),
    component('c-b5', 'w-b2', 'MOD-b', 'quiz', 'Linked quiz', 1, {}),
    component('c-b6', None, 'MOD-b', 'assignment', 'Module task', 1,
              {'assignmentBrief': 'Do it', 'assignmentTopics': [{'id': 't'}]}, 3, ksbs=[{'code': 'K1', 'weight': 2}]),
    component('c-b7', 'W-B0', 'MOD-b', 'live_session', 'Live', 1,
              {'sessionDate': '2026-11-20', 'teamsLiveSessionId': 'S1', 'teamsSessionNumber': 1}),
    component('c-a1', 'w-a1', 'MOD-A', 'podcast', 'Listen', 1, {'podcastUrl': 'https://example.invalid/p.mp3'}),
    component('c-a2', 'w_a2', 'MOD-A', 'reading', 'Deleted', 1, {}, deleted_at='2026-01-01T00:00:00Z'),
    component('c-a3', 'w_a2', 'MOD-A', 'reading', 'Same order', 1, {'readingContent': ''}),
    component('c-a4', 'w_a2', 'MOD-A', 'reading', 'same order', 1, {'readingContent': ' '}),
    component('c-z1', 'w-z1', 'MOD_Z', 'reading', 'Zed reading', 1, {'resourceUrl': 'https://example.invalid/r'}),
    component('c-arch', 'w-arch', 'MOD-ARCH', 'reading', 'Archived with module', 1, {},
              deleted_at='2026-02-01T00:00:01Z', via='MOD-ARCH'),
]
MAPPINGS = [
    ('c-b1', 'MOD-b', 'S2', 'Skill two', 'core', 1, 'hard'), ('c-b1', 'MOD-b', 'K1', 'Knowledge', 'core', 2, None),
    ('c-b1', 'MOD-b', None, None, None, 0, None), ('C-b2', 'MOD-b', 'B1', 'Behaviour', 'possible', 0.5, 'soft'),
    ('c-a1', 'MOD-A', 'K2', 'Gone', 'core', 1, None, '2026-01-01T00:00:00Z'),
    ('c-a1', 'MOD-A', 'K3', 'Kept', 'core', 1, None), ('c-z1', 'MOD_Z', 'K9', 'Zed', 'core', 1, None),
]

VARIANTS = {
    'full': {},
    'compact': {'compact': True},
    'expected_otjh': {'expected_otjh': True},
    'identities_only': {'identities_only': True},
    'identities_catalogue': {'identities_only': True, 'catalogue_facts': True},
    'compact_content': {'compact_content': True},
    'week_ids': {'week_ids': ['w-b1', 'w_a2', 'w-z1']},
    'routing_only': {'routing_only': True},
    'no_live_ids': {'live_session_ids': False},
}


def seed():
    with connections['enrolment'].cursor() as cur:
        cur.execute(SCHEMA)
        for mid, title in MODULES:
            deleted = '2026-02-01T00:00:00Z' if mid == 'MOD-ARCH' else None
            cur.execute('INSERT INTO curriculum.modules VALUES (%s,%s,%s,%s)',
                        [mid, title, deleted, 'PROG-OLD' if deleted else None])
        for row in WEEKS:
            arch = row[0] == 'w-arch'
            cur.execute('INSERT INTO curriculum.weeks VALUES (%s,%s,%s,%s,%s,%s,%s)',
                        [*row, '2026-02-01T00:00:02Z' if arch else None, 'MOD-ARCH' if arch else None])
        for row in COMPONENTS:
            cur.execute('INSERT INTO curriculum.components (id,week_id,module_catalogue_id,type,title,description,'
                        'settings_json,live_sessions_link,display_order,ksb_mappings,expected_otjh,deleted_at,'
                        'deleted_via_parent) VALUES (%(id)s,%(week_id)s,%(module_catalogue_id)s,%(type)s,%(title)s,'
                        '%(description)s,%(settings_json)s,%(live_sessions_link)s,%(display_order)s,%(ksb_mappings)s,'
                        '%(expected_otjh)s,%(deleted_at)s,%(deleted_via_parent)s)', row)
        for row in MAPPINGS:
            cur.execute('INSERT INTO curriculum.ksb_mappings (component_id,module_catalogue_id,ksb_code,'
                        'ksb_description,classification,weight,weight_class,deleted_at) '
                        'VALUES (%s,%s,%s,%s,%s,%s,%s,%s)', [*row[:7], row[7] if len(row) > 7 else None])
        cur.execute("INSERT INTO curriculum.quizzes VALUES (7,'Quiz seven',10,15,'minutes'),(8,'Quiz eight',5,5,'minutes')")
        cur.execute("INSERT INTO curriculum.quiz_component_links VALUES (8,'c-b5'),(8,'c-b4')")


def assigned(*modules):
    return [{'moduleId': mid} for mid in modules]


@contextmanager
def cache_switch(on):
    with patch.dict(os.environ, {'CURRICULUM_CONTENT_CACHE': 'true' if on else 'false'}):
        yield


def resolve(modules, *, snapshot=None, **flags):
    weeks, components = snapshot or ([], [])
    result = learner_detail._resolve_from_master([], weeks, components, assigned(*modules), **flags)
    return json.dumps(result, default=str)


class ContentCachePostgresCases(unittest.TestCase):
    ALL = ('MOD-b', 'MOD-A', 'MOD_Z', 'MOD-ARCH')

    @classmethod
    def setUpClass(cls):
        seed()
        with connections['enrolment'].cursor() as cur:
            cur.execute('SELECT datcollate FROM pg_database WHERE datname = current_database()')
            cls.collation = cur.fetchone()[0]

    def setUp(self):
        cache.clear()
        content_cache.reset_for_tests()

    def counted(self, fn):
        calls = []
        original = content_cache._build

        def build(*args, **kwargs):
            calls.append(args[2])
            return original(*args, **kwargs)
        with patch.object(content_cache, '_build', side_effect=build):
            value = fn()
        return value, calls

    def test_database_collation_is_code_point(self):
        self.assertEqual(self.collation, 'C.UTF-8')
        with connections['enrolment'].cursor() as cur:
            self.assertTrue(content_cache.collation_ok(cur))

    def test_every_variant_matches_the_database_byte_for_byte(self):
        for name, flags in VARIANTS.items():
            for modules in (self.ALL, ('MOD-A',), ('MOD_Z', 'MOD-b')):
                with self.subTest(variant=name, modules=modules):
                    with cache_switch(False):
                        expected = resolve(modules, **flags)
                    with cache_switch(True):
                        miss, built = self.counted(lambda: resolve(modules, **flags))
                        hit, rebuilt = self.counted(lambda: resolve(modules, **flags))
                    self.assertEqual(miss, expected)
                    self.assertEqual(hit, expected)
                    self.assertEqual(rebuilt, [], 'second read must come from the cache')

    def test_otjh_lookups_match_the_by_id_reads(self):
        from coach_api import views as coach
        components = [{'componentId': cid} for cid in ('c-b1', 'C-b2', 'c-b3', 'c-a2', 'nope')]
        with cache_switch(False):
            learner = learner_detail._otjh_by_component_id(components)
            staff = coach.curriculum_expected_otjh_by_component_id([c['componentId'] for c in components])
        with cache_switch(True):
            self.assertEqual(learner_detail._otjh_by_component_id(components), learner)
            self.assertEqual(coach.curriculum_expected_otjh_by_component_id(
                [c['componentId'] for c in components]), staff)

    def test_a_write_shows_after_invalidation_and_not_before(self):
        from curriculum_api import views
        with cache_switch(True):
            before = resolve(('MOD-b',))
            self.assertEqual(learner_detail._otjh_by_component_id([{'componentId': 'c-b1'}]), {'c-b1': 1.5})
            with connections['enrolment'].cursor() as cur:
                cur.execute("UPDATE curriculum.components SET title='Renamed' WHERE id='c-b1'")
                cur.execute("UPDATE curriculum.ksb_mappings SET ksb_description='Changed' WHERE ksb_code='K1'")
                cur.execute("UPDATE curriculum.components SET expected_otjh=9 WHERE id='c-b1'")
            # Proves the read is cached: without the write path's invalidation
            # the old rows are still served.
            self.assertEqual(resolve(('MOD-b',)), before)
            self.assertEqual(learner_detail._otjh_by_component_id([{'componentId': 'c-b1'}]), {'c-b1': 1.5})
            # A non-content invalidation (activity status, reviews...) moves the
            # global epoch but leaves learner content cached.
            views.invalidate_curriculum_cache()
            self.assertEqual(resolve(('MOD-b',)), before)
            # What a raw-SQL writer must do: name the module it wrote.
            content_cache.note_modules(['MOD-b'])
            after = resolve(('MOD-b',))
            self.assertIn('Renamed', after)
            self.assertIn('Changed', after)
            self.assertEqual(learner_detail._otjh_by_component_id([{'componentId': 'c-b1'}]), {'c-b1': 9.0})
        with cache_switch(False):
            self.assertEqual(resolve(('MOD-b',)), after)
        with connections['enrolment'].cursor() as cur:
            cur.execute("UPDATE curriculum.components SET title='Read me', expected_otjh=1.5 WHERE id='c-b1'")
            cur.execute("UPDATE curriculum.ksb_mappings SET ksb_description='Knowledge' WHERE ksb_code='K1'")
        content_cache.note_modules(['MOD-b'])

    def counted_reads(self, modules):
        calls = []
        original = content_cache._build

        def build(cursor, sql, missing, *args, **kwargs):
            calls.extend(missing)
            return original(cursor, sql, missing, *args, **kwargs)
        with patch.object(content_cache, '_build', side_effect=build), cache_switch(True):
            resolve(modules)
        return sorted(set(calls))

    def test_a_helper_write_retires_only_its_module(self):
        from curriculum_api import views
        self.counted_reads(self.ALL)
        views.update_rows('components', 'id = %s', ['c-a1'], {'title': 'Listen again'})
        self.assertEqual(self.counted_reads(self.ALL), ['MOD-A'])
        with cache_switch(True):
            self.assertIn('Listen again', resolve(('MOD-A',)))
        views.update_rows('components', 'id = %s', ['c-a1'], {'title': 'Listen'})

    def test_moving_a_component_retires_both_modules(self):
        from curriculum_api import views
        self.counted_reads(self.ALL)
        views.update_rows('components', 'id = %s', ['c-z1'], {'module_catalogue_id': 'MOD-A', 'week_id': 'w-a1'})
        self.assertEqual(self.counted_reads(self.ALL), ['MOD-A', 'MOD_Z'])
        with cache_switch(True):
            self.assertNotIn('Zed reading', resolve(('MOD_Z',)))
        views.update_rows('components', 'id = %s', ['c-z1'], {'module_catalogue_id': 'MOD_Z', 'week_id': 'w-z1'})

    def test_a_request_scope_bumps_once_after_the_view(self):
        from curriculum_api import views
        self.counted_reads(self.ALL)
        views.begin_curriculum_write_scope()
        try:
            for title in ('One', 'Two', 'Three'):
                views.update_rows('weeks', 'id = %s', ['w-b2'], {'title': title})
            # Not yet: the bump waits for the end of the request.
            self.assertEqual(self.counted_reads(self.ALL), [])
        finally:
            with patch.object(views, 'write_shared_curriculum_epoch_bump'):
                views.end_curriculum_write_scope()
        self.assertEqual(self.counted_reads(self.ALL), ['MOD-b'])
        views.update_rows('weeks', 'id = %s', ['w-b2'], {'title': 'Week two'})

    def test_non_content_write_keeps_learner_content(self):
        from curriculum_api import views
        self.counted_reads(self.ALL)
        views.note_live_rows('groups', [{'group_id': 'G1', 'module_catalogue_id': 'MOD-A'}])
        views.note_live_rows('live_sessions', [{'id': 'S1', 'module_catalogue_id': 'MOD-A'}])
        self.assertEqual(self.counted_reads(self.ALL), [])

    def test_learners_share_rows_but_never_each_others_tree(self):
        legacy_week = {'module': 'Legacy', 'week': 'Week 1'}
        legacy_component = {'module': 'Legacy', 'week': 'Week 1', 'component': 'Old task'}
        with cache_switch(False):
            first_expected = resolve(('MOD-A',), snapshot=([legacy_week], [legacy_component]))
            second_expected = resolve(('MOD_Z',))
        with cache_switch(True):
            first = resolve(('MOD-A',), snapshot=([legacy_week], [legacy_component]))
            second = resolve(('MOD_Z',))
            again_first_modules_no_snapshot = resolve(('MOD-A',))
        self.assertEqual(first, first_expected)
        self.assertEqual(second, second_expected)
        self.assertNotIn('Zed', first)
        self.assertNotIn('Alpha', second)
        self.assertNotIn('Old task', again_first_modules_no_snapshot)
        # Nothing learner-supplied reached the cache.
        import pickle
        stored = [content_cache._unpack(pickle.loads(blob)) for key, blob in cache._cache.items() if ':cmc:v2:' in key]
        self.assertTrue(stored)
        self.assertNotIn('Old task', repr(stored))

    def test_an_unavailable_cache_reads_the_database(self):
        with cache_switch(False):
            expected = resolve(self.ALL)

        class Down:
            def __getattr__(self, name):
                raise ConnectionError('valkey down')
        with cache_switch(True), patch.object(content_cache, 'cache', Down()), \
                patch.object(content_cache.shared_build, 'cache_is_shared', return_value=False):
            self.assertEqual(resolve(self.ALL), expected)

    def test_measured_size_of_this_seed(self):
        with cache_switch(True):
            for flags in VARIANTS.values():
                resolve(self.ALL, **flags)
        keys = [key for key in cache._cache if ':cmc:v2:' in key]
        self.assertTrue(keys)
