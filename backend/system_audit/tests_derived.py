"""The timestamp reading of the Changes feed, across the whole LMS.

Used where the revision log does not exist. What is guarded here is the
difference between a feed that covers the LMS and one that says it does: a
workspace may be reported as covered only when a real table was read for it, a
missing stamp must not become a creation, a missing author must not become a
person, and a filter must narrow the window before it is paged -- not after.

Every table is synthetic and lives in an in-memory schema attached for this
class alone. Nothing here can reach a real database.
"""

from datetime import datetime, timedelta

from django.db import connection

from curriculum_api import versioning
from curriculum_api import views as curriculum_views
from curriculum_api.tests_audit_trail import AuditHarness
from system_audit import derived

ATTACHED = ('enrolment', 'Coach', 'Engagement')

TABLES = (
    'create table "enrolment"."Staff_users" ('
    'id integer primary key, "Username" text, "Email" text, "Position" text, "Access" text, '
    '"Created_at" text, "Updated_at" text)',
    'create table "Coach"."coach_absence_report" ('
    'id integer primary key, learner_name text, session_title text, session_date text, '
    'reason_category text, status text, created_at text, updated_at text)',
    'create table "Engagement"."attendance_interventions" ('
    'id integer primary key, learner_id text, learner_name text, action text, employer_notified integer, '
    'intervention_date text, created_by text, created_at text, resolved integer, resolved_at text)',
)


def stamp(hours_ago):
    return (datetime.utcnow() - timedelta(hours=hours_ago)).strftime('%Y-%m-%d %H:%M:%S')


class DerivedTrailTests(AuditHarness):
    """A database with no revision log, read through the timestamps instead."""

    @classmethod
    def setUpClass(cls):
        if connection.vendor != 'sqlite':
            raise RuntimeError('These fixtures attach in-memory schemas and need the sqlite test runner.')
        with connection.cursor() as cursor:
            cursor.execute('pragma database_list')
            already = {row[1].lower() for row in cursor.fetchall()}
            for schema in ATTACHED:
                if schema.lower() not in already:
                    cursor.execute(f"attach database ':memory:' as \"{schema}\"")
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.cursor() as cursor:
            for schema in ATTACHED:
                try:
                    cursor.execute(f'detach database "{schema}"')
                except Exception:
                    pass

    def setUp(self):
        super().setUp()
        with self.connection_cursor() as cursor:
            for ddl in TABLES:
                cursor.execute(ddl.replace('create table', 'create table if not exists', 1))
            cursor.execute('delete from "enrolment"."Staff_users"')
            cursor.execute('delete from "Coach"."coach_absence_report"')
            cursor.execute('delete from "Engagement"."attendance_interventions"')
            # The point of this class: no revision log, so the trail falls back.
            cursor.execute(f'drop table {versioning.qualified(versioning.VERSIONS_TABLE)}')
            cursor.execute(f'drop table {versioning.qualified(versioning.REVISIONS_TABLE)}')
        versioning.reset_availability()
        derived.reset_catalogue()

    def tearDown(self):
        versioning.reset_availability()
        derived.reset_catalogue()
        super().tearDown()

    # ------------------------------------------------------------ fixtures

    def curriculum_component(self, ident, title):
        self.committed(lambda: curriculum_views.authoring_upsert(curriculum_views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': ident, 'module_catalogue_id': 'MOD-D', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': title, 'display_order': 0,
        }))

    def staff(self, ident, name, created, updated):
        with self.connection_cursor() as cursor:
            cursor.execute(
                'insert into "enrolment"."Staff_users" (id, "Username", "Email", "Position", "Access", '
                '"Created_at", "Updated_at") values (%s, %s, %s, %s, %s, %s, %s)',
                [ident, name, f'{name.lower().replace(" ", ".")}@example.test', 'Coach', 'coach', created, updated],
            )

    def absence(self, ident, learner, created, updated=None):
        with self.connection_cursor() as cursor:
            cursor.execute(
                'insert into "Coach"."coach_absence_report" (id, learner_name, session_title, session_date, '
                'reason_category, status, created_at, updated_at) values (%s, %s, %s, %s, %s, %s, %s, %s)',
                [ident, learner, 'Week 3 workshop', '2026-10-01', 'illness', 'open', created, updated or created],
            )

    def intervention(self, ident, learner, created, created_by=None):
        with self.connection_cursor() as cursor:
            cursor.execute(
                'insert into "Engagement"."attendance_interventions" (id, learner_id, learner_name, action, '
                'employer_notified, intervention_date, created_by, created_at, resolved, resolved_at) '
                'values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                [ident, f'L-{ident}', learner, 'call', 0, '2026-10-01', created_by, created, 0, None],
            )

    def trail(self, query=''):
        response = self.client.get(f'/curriculum_api/curriculum/quality/audit-trail/{query}')
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload['source'], 'timestamps')
        return payload

    def workspaces_in(self, payload):
        from system_audit import writes
        return {writes.workspace_for_entity(event['entity']) for event in payload['events']}

    def seed_three_workspaces(self):
        self.curriculum_component('COMP-D1', 'Reading quiz')
        self.staff(1, 'Rachel Myers', stamp(5), stamp(5))
        self.absence(1, 'Ahmed Ali', stamp(3))

    # ------------------------------------------------------------ coverage

    def test_curriculum_events_appear(self):
        self.curriculum_component('COMP-D1', 'Reading quiz')
        payload = self.trail('?workspace=curriculum')
        event = next(item for item in payload['events'] if item['entityId'] == 'COMP-D1')
        self.assertEqual(event['action'], 'created')
        self.assertEqual(event['title'], 'Reading quiz')

    def test_an_admin_source_appears(self):
        self.staff(1, 'Rachel Myers', stamp(5), stamp(5))
        payload = self.trail('?workspace=admin')
        event = next(item for item in payload['events'] if item['entity'] == 'staff_record')
        self.assertEqual(event['action'], 'created')
        # Named from the record, not shown as its id.
        self.assertEqual(event['title'], 'Rachel Myers')
        self.assertEqual(event['entityLabel'], 'Staff record')

    def test_a_coach_source_appears(self):
        self.absence(1, 'Ahmed Ali', stamp(3))
        payload = self.trail('?workspace=coach')
        event = next(item for item in payload['events'] if item['entity'] == 'absence_report')
        self.assertEqual(event['action'], 'created')
        self.assertIn('Ahmed Ali', event['title'])

    def test_the_system_wide_feed_carries_every_workspace_together(self):
        self.seed_three_workspaces()
        payload = self.trail()
        self.assertTrue({'curriculum', 'admin', 'coach'} <= self.workspaces_in(payload))

    def test_curriculum_excludes_admin_and_coach(self):
        self.seed_three_workspaces()
        self.assertEqual(self.workspaces_in(self.trail('?workspace=curriculum')), {'curriculum'})

    def test_admin_excludes_curriculum_and_coach(self):
        self.seed_three_workspaces()
        self.assertEqual(self.workspaces_in(self.trail('?workspace=admin')), {'admin'})

    def test_coach_excludes_curriculum_and_admin(self):
        self.seed_three_workspaces()
        self.assertEqual(self.workspaces_in(self.trail('?workspace=coach')), {'coach'})

    def test_coverage_names_only_workspaces_whose_tables_were_found(self):
        """A workspace with no table in this database is not advertised as covered."""
        self.seed_three_workspaces()
        payload = self.trail()
        for workspace in ('curriculum', 'admin', 'coach', 'engagement'):
            self.assertIn(workspace, payload['derivedWorkspaces'])
            self.assertIn(workspace, payload['changeWorkspaces'])
        # Mock-only workspaces, and enrolment, whose tables were never created here.
        for workspace in ('finance', 'safeguarding', 'support', 'enrolment'):
            self.assertNotIn(workspace, payload['changeWorkspaces'])
            self.assertIn(workspace, payload['uncoveredWorkspaces'])
        self.assertEqual(payload['revisionWorkspaces'], [])
        # A filter narrows the feed, not the claim about what the database holds.
        filtered = self.trail('?workspace=coach')
        self.assertEqual(filtered['derivedWorkspaces'], payload['derivedWorkspaces'])

    def test_a_workspace_whose_only_table_disappears_stops_being_covered(self):
        """Coverage is read from the database, not from the registry."""
        self.assertIn('admin', self.trail()['derivedWorkspaces'])
        with self.connection_cursor() as cursor:
            cursor.execute('drop table "enrolment"."Staff_users"')
        payload = self.trail()
        # The staff directory is the administration workspace's only source.
        self.assertNotIn('admin', payload['derivedWorkspaces'])
        self.assertIn('admin', payload['uncoveredWorkspaces'])

    # ------------------------------------------------------------ filters before paging

    def test_search_filters_the_whole_window_before_paging(self):
        for index in range(1, 6):
            self.staff(index, f'Staff Person {index}', stamp(index), stamp(index))
        self.absence(1, 'Unique Learner Name', stamp(10))
        payload = self.trail('?limit=2&search=unique learner')
        self.assertEqual(payload['total'], 1)
        self.assertEqual(payload['pages'], 1)
        self.assertEqual([event['entity'] for event in payload['events']], ['absence_report'])

    def test_the_date_window_filters_before_paging(self):
        for index in range(1, 4):
            self.staff(index, f'Recent {index}', stamp(index), stamp(index))
        for index in range(4, 7):
            self.staff(index, f'Older {index}', stamp(72 + index), stamp(72 + index))
        narrow = self.trail('?workspace=admin&days=1&limit=2')
        wide = self.trail('?workspace=admin&days=7&limit=2')
        self.assertEqual(narrow['total'], 3)
        self.assertEqual(narrow['pages'], 2)
        self.assertEqual(wide['total'], 6)
        self.assertTrue(all(event['title'].startswith('Recent') for event in narrow['events']))

    def seed_many(self):
        for index in range(1, 6):
            self.staff(index, f'Staff {index}', stamp(index * 2), stamp(index * 2))
            self.absence(index, f'Learner {index}', stamp(index * 2 + 1))

    def test_pages_do_not_repeat_rows(self):
        self.seed_many()
        seen = []
        first = self.trail('?limit=3')
        for page in range(1, first['pages'] + 1):
            seen.extend(event['id'] for event in self.trail(f'?limit=3&page={page}')['events'])
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(len(seen), first['total'])

    def test_the_pages_rebuild_the_whole_filtered_window_in_order(self):
        self.seed_many()
        whole = [event['id'] for event in self.trail('?limit=200&action=created')['events']]
        paged = []
        pages = self.trail('?limit=3&action=created')['pages']
        for page in range(1, pages + 1):
            paged.extend(event['id'] for event in self.trail(f'?limit=3&action=created&page={page}')['events'])
        self.assertEqual(paged, whole)
        stamps = [event['at'] for event in self.trail('?limit=200&action=created')['events']]
        self.assertEqual(stamps, sorted(stamps, reverse=True))

    def test_the_headline_counts_stay_still_across_pages(self):
        self.seed_many()
        first = self.trail('?limit=3&page=1')
        last = self.trail(f'?limit=3&page={first["pages"]}')
        self.assertEqual(first['actionCounts'], last['actionCounts'])
        self.assertEqual(first['entityCounts'], last['entityCounts'])
        self.assertEqual(first['total'], sum(first['actionCounts'].values()))

    # ------------------------------------------------------------ honesty

    def test_a_missing_creation_stamp_is_never_a_creation(self):
        # No creation stamp, a later write: present, but not provably created.
        self.staff(1, 'No Created Stamp', None, stamp(2))
        # No stamps at all: nothing to report.
        self.staff(2, 'No Stamps', None, None)
        events = self.trail('?workspace=admin')['events']
        by_title = {}
        for event in events:
            by_title.setdefault(event['title'], []).append(event['action'])
        self.assertEqual(by_title.get('No Created Stamp'), ['recorded'])
        self.assertNotIn('No Stamps', by_title)
        self.assertNotIn('created', by_title['No Created Stamp'])

    def test_a_second_write_is_an_edit_and_the_first_is_the_creation(self):
        self.staff(1, 'Edited Later', stamp(10), stamp(2))
        actions = sorted(event['action'] for event in self.trail('?workspace=admin')['events'])
        self.assertEqual(actions, ['created', 'updated'])

    def test_a_missing_author_is_not_filled_in(self):
        """Not the signed-in account, not "System" -- nobody, because nobody was recorded."""
        self.sign_in(name='Signed In Reader', email='reader@example.test')
        self.absence(1, 'Ahmed Ali', stamp(3))          # the table records no author at all
        self.intervention(1, 'Sara Khan', stamp(4))     # it could, and this row does not
        for event in self.trail()['events']:
            if event['entity'] in {'absence_report', 'attendance_intervention'}:
                self.assertEqual(event['actorName'], '')
                self.assertEqual(event['actorEmail'], '')
                self.assertEqual(event['actorType'], '')

    def test_an_author_the_row_records_is_shown_and_filterable(self):
        self.intervention(1, 'Sara Khan', stamp(4), created_by='coach.one@example.test')
        self.intervention(2, 'Omar Aziz', stamp(5))
        payload = self.trail('?workspace=engagement')
        event = next(item for item in payload['events'] if item['title'] == 'Sara Khan')
        self.assertEqual(event['actorEmail'], 'coach.one@example.test')
        self.assertIn('coach.one@example.test', [person['email'] for person in payload['actors']])
        only = self.trail('?workspace=engagement&actor=coach.one@example.test')
        self.assertEqual(only['total'], 1)

    def test_every_derived_record_type_is_one_the_revision_log_knows(self):
        """So both readings share labels, links, filters and workspaces."""
        from system_audit import writes
        for source in derived.DERIVED_AUDIT_SOURCES:
            self.assertTrue(writes.workspace_for_entity(source.entity), source.entity)
            self.assertIn(source.created_action, {'created', 'recorded'}, source.entity)
