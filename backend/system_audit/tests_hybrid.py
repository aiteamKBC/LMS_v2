"""One Changes feed over two kinds of evidence: the revision log, and before it.

Where the revision log exists it is the authority. Each record type began being
recorded on a different day, and before that day the only history is the
records' own timestamps. These tests guard the line between the two: a
recovered event may only come from before its own record type's first revision
(less ``derived.BOUNDARY_GUARD``), so the two readings can never show one save
twice -- and everything a reader sees, the total, the counts, the order and
every page, is taken from the combined set, never from either half.

Every table is synthetic: the revision log is the test database's own, and the
LMS tables live in in-memory schemas attached for this class alone. Revisions
are inserted directly with the moment each test needs, so every boundary here
is one the test set, not one the clock happened to produce.
"""

import json
from datetime import datetime, timedelta

from django.db import connection

from curriculum_api import versioning
from curriculum_api.tests_audit_trail import AuditHarness
from system_audit import derived

ATTACHED = ('enrolment', 'Coach', 'Engagement')

TABLES = (
    'create table if not exists "enrolment"."Staff_users" ('
    'id integer primary key, "Username" text, "Email" text, "Position" text, "Access" text, '
    '"Created_at" text, "Updated_at" text)',
    'create table if not exists "Coach"."coach_absence_report" ('
    'id integer primary key, learner_name text, session_title text, session_date text, '
    'reason_category text, status text, created_at text, updated_at text)',
    'create table if not exists "Coach"."coach_calendar_event" ('
    'event_key text primary key, learner_name text, event_type text, owner_name text, '
    'scheduled_date text, status text, created_at text, updated_at text)',
    'create table if not exists "Engagement"."attendance_interventions" ('
    'id integer primary key, learner_id text, learner_name text, action text, employer_notified integer, '
    'intervention_date text, created_by text, created_at text, resolved integer, resolved_at text)',
)

GUARD = derived.BOUNDARY_GUARD


class HybridFixtures(AuditHarness):
    """Synthetic LMS tables beside the test database's own revision log."""

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
                cursor.execute(ddl)
            for table in ('"enrolment"."Staff_users"', '"Coach"."coach_absence_report"',
                          '"Coach"."coach_calendar_event"', '"Engagement"."attendance_interventions"'):
                cursor.execute(f'delete from {table}')
        derived.reset_catalogue()
        self.now = datetime.utcnow().replace(microsecond=0)

    def tearDown(self):
        derived.reset_catalogue()
        super().tearDown()

    # ------------------------------------------------------------ fixtures

    def at(self, hours=0, minutes=0, seconds=0):
        """A moment before now, in the text form sqlite stores stamps in."""
        moment = self.now - timedelta(hours=hours, minutes=minutes, seconds=seconds)
        return moment.strftime('%Y-%m-%d %H:%M:%S')

    def revision(self, entity_type, entity_id, when, action='updated', actor_email='', actor_name='', title=''):
        """One revision, logged at exactly ``when``."""
        table = versioning.qualified(versioning.REVISIONS_TABLE)
        with self.connection_cursor() as cursor:
            cursor.execute(
                f'select count(*) from {table} where entity_type = %s and entity_id = %s', [entity_type, entity_id])
            number = cursor.fetchone()[0] + 1
            # An edit with no moved field is hidden from the feed on purpose,
            # so a test edit carries one.
            changes = [{'field': 'status', 'from': 'open', 'to': 'closed'}] if action == 'updated' else []
            cursor.execute(
                f'insert into {table} (entity_type, entity_id, revision_no, action, title, snapshot, '
                'changed_fields, actor_email, actor_name, created_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                [entity_type, str(entity_id), number, action, title or f'{entity_type} {entity_id}', '{}',
                 json.dumps(changes), actor_email, actor_name, when],
            )

    def absence(self, ident, learner, created, updated=None):
        with self.connection_cursor() as cursor:
            cursor.execute(
                'insert into "Coach"."coach_absence_report" (id, learner_name, session_title, session_date, '
                'reason_category, status, created_at, updated_at) values (%s, %s, %s, %s, %s, %s, %s, %s)',
                [ident, learner, 'Week 3 workshop', '2026-10-01', 'illness', 'open', created, updated or created],
            )

    def meeting(self, key, learner, created, updated=None):
        with self.connection_cursor() as cursor:
            cursor.execute(
                'insert into "Coach"."coach_calendar_event" (event_key, learner_name, event_type, owner_name, '
                'scheduled_date, status, created_at, updated_at) values (%s, %s, %s, %s, %s, %s, %s, %s)',
                [key, learner, 'progress-review', 'Coach Carter', '2026-10-02', 'scheduled', created, updated or created],
            )

    def staff(self, ident, name, created, updated):
        with self.connection_cursor() as cursor:
            cursor.execute(
                'insert into "enrolment"."Staff_users" (id, "Username", "Email", "Position", "Access", '
                '"Created_at", "Updated_at") values (%s, %s, %s, %s, %s, %s, %s)',
                [ident, name, f'{name.lower().replace(" ", ".")}@example.test', 'Coach', 'coach', created, updated],
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
        self.assertEqual(payload['source'], 'revisions')
        return payload

    def keyed(self, payload, provenance=None):
        """``(provenance, entity, entityId, action)`` for every event on the page."""
        return [
            (event['provenance'], event['entity'], event['entityId'], event['action'])
            for event in payload['events']
            if provenance is None or event['provenance'] == provenance
        ]

    def every_page(self, query, limit):
        first = self.trail(f'{query}&limit={limit}&page=1')
        events = list(first['events'])
        for number in range(2, first['pages'] + 1):
            events += self.trail(f'{query}&limit={limit}&page={number}')['events']
        return first, events



class HybridTrailTests(HybridFixtures):
    """The revision log, with the history before it recovered into one feed."""

    # ------------------------------------------------------------ the boundary

    def test_two_sources_in_one_workspace_keep_their_own_revision_start(self):
        # Absence reports were recorded from 48 hours ago, meetings only from 24.
        self.revision('absence_report', '90', self.at(hours=48))
        self.revision('coach_meeting', 'M-90', self.at(hours=24))
        self.absence(1, 'Before both', self.at(hours=60))
        self.absence(2, 'After absence logging began', self.at(hours=36))
        self.meeting('M-1', 'Before meetings were logged', self.at(hours=36))
        self.meeting('M-2', 'After meetings were logged', self.at(hours=12))

        recovered = self.keyed(self.trail('?workspace=coach&days=7'), 'timestamps')

        self.assertIn(('timestamps', 'absence_report', '1', 'created'), recovered)
        self.assertIn(('timestamps', 'coach_meeting', 'M-1', 'created'), recovered)
        # 36 hours ago is inside the absence log's coverage, and outside the
        # meetings'. One global cutoff would have got one of these wrong.
        self.assertNotIn(('timestamps', 'absence_report', '2', 'created'), recovered)
        self.assertNotIn(('timestamps', 'coach_meeting', 'M-2', 'created'), recovered)

    def test_a_recovered_event_just_before_the_boundary_is_shown(self):
        boundary = self.now - timedelta(hours=10)
        self.revision('absence_report', '90', boundary.strftime('%Y-%m-%d %H:%M:%S'))
        just_before = (boundary - GUARD - timedelta(seconds=1)).strftime('%Y-%m-%d %H:%M:%S')
        inside_guard = (boundary - timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S')
        self.absence(1, 'Just before', just_before)
        self.absence(2, 'Inside the guard', inside_guard)

        payload = self.trail('?workspace=coach&days=7')

        recovered = {event['entityId']: event for event in payload['events'] if event['provenance'] == 'timestamps'}
        self.assertIn('1', recovered)
        self.assertEqual(recovered['1']['at'].replace('T', ' ')[:19], just_before)
        # Within minutes of the log starting, a stamp may belong to the very
        # save the log recorded; it is left to the log.
        self.assertNotIn('2', recovered)

    def test_the_revision_at_the_boundary_is_in_the_feed(self):
        self.revision('absence_report', '1', self.at(hours=10), action='created', actor_email='coach@example.test')
        self.absence(1, 'Ahmed Ali', self.at(hours=30))

        payload = self.trail('?workspace=coach&days=7')

        logged = [event for event in payload['events'] if event['provenance'] == 'revision']
        self.assertEqual(len(logged), 1)
        self.assertEqual(logged[0]['provenanceLabel'], 'Revision history')
        self.assertEqual(logged[0]['actorEmail'], 'coach@example.test')
        self.assertEqual(payload['revisionStartedAt']['absence_report'][:19].replace('T', ' '), self.at(hours=10))

    def test_one_save_is_never_shown_twice_at_the_boundary(self):
        # The row was stamped two seconds before the revision that logged the
        # same save -- a stamp taken as the request began. Read naively, the
        # creation would appear once from each reading.
        self.absence(1, 'Ahmed Ali', self.at(hours=10, seconds=2))
        self.revision('absence_report', '1', self.at(hours=10), action='created')

        payload = self.trail('?workspace=coach&days=7')

        creations = [event for event in payload['events']
                     if event['entity'] == 'absence_report' and event['entityId'] == '1']
        self.assertEqual(len(creations), 1)
        self.assertEqual(creations[0]['provenance'], 'revision')
        self.assertEqual(payload['total'], 1)

    # ------------------------------------------------------------ one feed

    def test_deep_pages_cross_from_the_log_into_recovered_history(self):
        self.revision('absence_report', '900', self.at(hours=40))
        for number in range(7):
            self.revision('absence_report', str(100 + number), self.at(hours=30 - number))
        for number in range(6):
            self.absence(number + 1, f'Learner {number}', self.at(hours=50 + number))

        first, events = self.every_page('?workspace=coach&days=7', 3)

        self.assertEqual(first['total'], 14)
        self.assertEqual(first['pages'], 5)
        self.assertEqual(len(events), 14)
        self.assertEqual(len({event['id'] for event in events}), 14)
        stamps = [event['at'].replace('T', ' ')[:19] for event in events]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        kinds = [event['provenance'] for event in events]
        # Newest first: the log, then -- once -- the history before it.
        self.assertEqual(kinds, ['revision'] * 8 + ['timestamps'] * 6)
        self.assertEqual(first['provenanceCounts'], {'revision': 8, 'timestamps': 6})
        # Asked of a later page, the counts describe the same whole window.
        later = self.trail('?workspace=coach&days=7&limit=3&page=4')
        self.assertEqual(later['total'], 14)
        self.assertEqual(later['actionCounts'], first['actionCounts'])

    def test_the_workspace_filter_applies_to_both_readings(self):
        self.revision('absence_report', '90', self.at(hours=20))
        self.revision('staff_record', '90', self.at(hours=20))
        self.absence(1, 'Ahmed Ali', self.at(hours=30))
        self.staff(1, 'Rachel Myers', self.at(hours=30), self.at(hours=30))

        coach = self.trail('?workspace=coach&days=7')
        admin = self.trail('?workspace=admin&days=7')

        self.assertEqual({event['entity'] for event in coach['events']}, {'absence_report'})
        self.assertEqual({event['provenance'] for event in coach['events']}, {'revision', 'timestamps'})
        self.assertEqual({event['entity'] for event in admin['events']}, {'staff_record'})
        self.assertEqual({event['provenance'] for event in admin['events']}, {'revision', 'timestamps'})

    def test_the_record_type_filter_applies_to_both_readings(self):
        self.revision('absence_report', '90', self.at(hours=20))
        self.revision('coach_meeting', 'M-90', self.at(hours=20))
        self.absence(1, 'Ahmed Ali', self.at(hours=30))
        self.meeting('M-1', 'Bea Lane', self.at(hours=30))

        payload = self.trail('?workspace=coach&days=7&entity=coach_meeting')

        self.assertEqual({event['entity'] for event in payload['events']}, {'coach_meeting'})
        self.assertEqual(sorted(self.keyed(payload)), [
            ('revision', 'coach_meeting', 'M-90', 'updated'),
            ('timestamps', 'coach_meeting', 'M-1', 'created'),
        ])
        self.assertEqual(payload['entityCounts'], {'coach_meeting': 2})

    def test_the_author_filter_applies_to_both_readings(self):
        # Interventions have never been logged, so every one is recovered; the
        # row itself records who raised it.
        self.intervention(1, 'Ahmed Ali', self.at(hours=30), created_by='coach@example.test')
        self.intervention(2, 'Bea Lane', self.at(hours=29), created_by='other@example.test')
        self.revision('absence_report', '1', self.at(hours=5), actor_email='coach@example.test')

        payload = self.trail('?days=7&actor=coach@example.test')

        self.assertEqual(sorted(self.keyed(payload)), [
            ('revision', 'absence_report', '1', 'updated'),
            ('timestamps', 'attendance_intervention', '1', 'created'),
        ])
        actors = {actor['email']: actor['changes'] for actor in payload['actors']}
        self.assertEqual(actors['coach@example.test'], 2)
        self.assertEqual(actors['other@example.test'], 1)

    def test_a_window_that_crosses_the_boundary_reads_both_sides_of_it(self):
        self.revision('absence_report', '90', self.at(hours=48))
        self.absence(1, 'Inside the window, before the log', self.at(hours=60))
        self.absence(2, 'Outside the window', self.at(hours=80))

        payload = self.trail('?workspace=coach&days=3')

        self.assertEqual(sorted(self.keyed(payload)), [
            ('revision', 'absence_report', '90', 'updated'),
            ('timestamps', 'absence_report', '1', 'created'),
        ])

    def test_a_record_type_never_logged_is_recovered_for_the_whole_window(self):
        self.intervention(1, 'Ahmed Ali', self.at(hours=2))
        self.intervention(2, 'Bea Lane', self.at(hours=100))

        payload = self.trail('?workspace=engagement&days=7')

        self.assertEqual(sorted(self.keyed(payload)), [
            ('timestamps', 'attendance_intervention', '1', 'created'),
            ('timestamps', 'attendance_intervention', '2', 'created'),
        ])
        self.assertIsNone(payload['revisionStartedAt']['attendance_intervention'])
        self.assertIn('engagement', payload['derivedWorkspaces'])

    def test_a_record_type_logged_since_before_the_window_recovers_nothing(self):
        # Staff saves have been logged since long before this two-day window
        # opened. A stamp inside it with no revision is a save the log missed;
        # it is not the timestamps' place to supply it.
        self.revision('staff_record', '90', self.at(hours=24 * 6))
        self.staff(1, 'Rachel Myers', self.at(hours=20), self.at(hours=20))

        payload = self.trail('?workspace=admin&days=2')

        self.assertEqual(self.keyed(payload, 'timestamps'), [])
        self.assertEqual(payload['provenanceCounts']['timestamps'], 0)

    # ------------------------------------------------------------ what it may claim

    def test_a_recovered_event_names_no_author_the_row_does_not_record(self):
        self.revision('absence_report', '90', self.at(hours=10))
        self.sign_in('Somebody Reading', 'reader@example.test')
        self.absence(1, 'Ahmed Ali', self.at(hours=30))

        event = next(event for event in self.trail('?workspace=coach&days=7')['events']
                     if event['provenance'] == 'timestamps')

        self.assertEqual(event['actorName'], '')
        self.assertEqual(event['actorEmail'], '')
        self.assertEqual(event['changes'], [])
        self.assertIsNone(event['snapshot'])
        self.assertEqual(event['provenanceLabel'], 'Recovered from timestamps')

    def test_first_recorded_and_created_keep_their_meaning_before_the_log(self):
        self.revision('staff_record', '90', self.at(hours=5))
        # No creation stamp: present, origin unknown.
        self.staff(1, 'Rachel Myers', None, self.at(hours=30))
        # Written once: a creation, and not also an edit.
        self.staff(2, 'Tom Price', self.at(hours=40), self.at(hours=40))
        # Written twice: a creation and a later edit.
        self.staff(3, 'Ana Ruiz', self.at(hours=60), self.at(hours=50))

        recovered = sorted(self.keyed(self.trail('?workspace=admin&days=7'), 'timestamps'))

        self.assertEqual(recovered, [
            ('timestamps', 'staff_record', '1', 'recorded'),
            ('timestamps', 'staff_record', '2', 'created'),
            ('timestamps', 'staff_record', '3', 'created'),
            ('timestamps', 'staff_record', '3', 'updated'),
        ])

    def test_identical_moments_are_ordered_the_same_way_every_time(self):
        same = self.at(hours=30)
        self.revision('coach_meeting', 'M-9', same)
        self.revision('absence_report', '90', self.at(hours=20))
        self.absence(1, 'Ahmed Ali', same)
        self.absence(2, 'Bea Lane', same)

        reads = [self.keyed(self.trail('?workspace=coach&days=7&limit=50')) for _ in range(3)]
        _, paged = self.every_page('?workspace=coach&days=7', 1)

        self.assertEqual(reads[0], reads[1])
        self.assertEqual(reads[1], reads[2])
        tied = [key for key in reads[0] if key[0:3] != ('revision', 'absence_report', '90')]
        # At one instant the log's event leads, then recovered ones by key.
        self.assertEqual(tied, [
            ('revision', 'coach_meeting', 'M-9', 'updated'),
            ('timestamps', 'absence_report', '1', 'created'),
            ('timestamps', 'absence_report', '2', 'created'),
        ])
        self.assertEqual(
            [(event['provenance'], event['entity'], event['entityId'], event['action']) for event in paged],
            reads[0],
        )

    def test_a_filter_only_the_log_can_answer_reads_the_log_alone(self):
        self.revision('absence_report', '90', self.at(hours=10))
        self.absence(1, 'Ahmed Ali', self.at(hours=30))

        payload = self.trail('?workspace=coach&days=7&scope=module&scopeId=MOD-1')

        self.assertFalse(payload['recoveredHistory'])
        self.assertEqual(self.keyed(payload, 'timestamps'), [])

    def test_coverage_names_each_kind_of_evidence(self):
        payload = self.trail('?days=7')

        self.assertIn('coach', payload['derivedWorkspaces'])
        self.assertIn('admin', payload['derivedWorkspaces'])
        self.assertTrue(set(payload['revisionWorkspaces']) <= set(payload['changeWorkspaces']))
        self.assertTrue(set(payload['derivedWorkspaces']) <= set(payload['changeWorkspaces']))
        self.assertFalse(set(payload['uncoveredWorkspaces']) & set(payload['changeWorkspaces']))
        self.assertTrue(payload['recoveredHistory'])


class HybridWindowTests(HybridFixtures):
    """The Changes feed reads 7 days by default, and 30 or 60 on request -- everywhere.

    Saved history is kept, so no workspace is held to the seven days page
    activity survives. The boundary rules do not change with the window.
    """

    def days_ago(self, days):
        return self.at(hours=24 * days)

    def seed_older_history(self, days_back):
        """Pre-log history in three workspaces, ``days_back`` days ago."""
        self.revision('absence_report', '90', self.days_ago(5))
        self.revision('staff_record', '90', self.days_ago(5))
        self.absence(1, 'Ahmed Ali', self.days_ago(days_back))
        self.staff(1, 'Rachel Myers', self.days_ago(days_back), self.days_ago(days_back))
        self.intervention(1, 'Bea Lane', self.days_ago(days_back))

    def recovered_workspaces(self, payload):
        from system_audit import writes
        return {writes.workspace_for_entity(event['entity'])
                for event in payload['events'] if event['provenance'] == 'timestamps'}

    def test_the_system_wide_30_day_feed_recovers_every_workspace(self):
        self.seed_older_history(20)

        payload = self.trail('?days=30&limit=200')

        self.assertEqual(payload['windowDays'], 30)
        self.assertTrue({'coach', 'admin', 'engagement'} <= self.recovered_workspaces(payload))

    def test_the_system_wide_60_day_feed_recovers_every_workspace(self):
        self.seed_older_history(50)

        thirty = self.trail('?days=30&limit=200')
        sixty = self.trail('?days=60&limit=200')

        self.assertFalse({'coach', 'admin', 'engagement'} & self.recovered_workspaces(thirty))
        self.assertEqual(sixty['windowDays'], 60)
        self.assertTrue({'coach', 'admin', 'engagement'} <= self.recovered_workspaces(sixty))

    def test_workspace_feeds_recover_their_own_history_at_30_and_60_days(self):
        self.revision('absence_report', '90', self.days_ago(5))
        self.revision('staff_record', '90', self.days_ago(5))
        self.absence(1, 'Ahmed Ali', self.days_ago(20))
        self.absence(2, 'Bea Lane', self.days_ago(45))
        self.staff(1, 'Rachel Myers', self.days_ago(20), self.days_ago(20))
        self.staff(2, 'Tom Price', self.days_ago(45), self.days_ago(45))
        self.intervention(1, 'Ahmed Ali', self.days_ago(20))
        self.intervention(2, 'Bea Lane', self.days_ago(45))
        for workspace, entity in (('coach', 'absence_report'), ('admin', 'staff_record'),
                                  ('engagement', 'attendance_intervention')):
            thirty = self.trail(f'?workspace={workspace}&days=30')
            sixty = self.trail(f'?workspace={workspace}&days=60')
            self.assertEqual(self.keyed(thirty, 'timestamps'), [('timestamps', entity, '1', 'created')], workspace)
            self.assertEqual(sorted(self.keyed(sixty, 'timestamps')), [
                ('timestamps', entity, '1', 'created'),
                ('timestamps', entity, '2', 'created'),
            ], workspace)
            self.assertEqual((thirty['windowDays'], sixty['windowDays']), (30, 60))

    def test_seven_days_stays_the_default_and_reads_no_further(self):
        self.seed_older_history(20)

        payload = self.trail('?workspace=coach')

        self.assertEqual(payload['windowDays'], 7)
        self.assertEqual(self.keyed(payload, 'timestamps'), [])

    def test_a_non_curriculum_feed_still_stops_at_60_days(self):
        self.assertEqual(self.trail('?workspace=coach&days=365')['windowDays'], 60)
        self.assertEqual(self.trail('?days=365')['windowDays'], 60)

    def test_the_boundary_and_its_guard_hold_in_every_window(self):
        boundary = self.now - timedelta(days=3)
        self.revision('absence_report', '1', boundary.strftime('%Y-%m-%d %H:%M:%S'), action='created')
        # The same save, stamped a moment before the revision that logged it.
        self.absence(1, 'Same save', (boundary - timedelta(seconds=2)).strftime('%Y-%m-%d %H:%M:%S'))
        self.absence(2, 'Inside the guard', (boundary - timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S'))
        self.absence(3, 'Before the guard', (boundary - GUARD - timedelta(seconds=1)).strftime('%Y-%m-%d %H:%M:%S'))

        for days in (7, 30, 60):
            payload = self.trail(f'?workspace=coach&days={days}')
            self.assertEqual(sorted(self.keyed(payload)), [
                ('revision', 'absence_report', '1', 'created'),
                ('timestamps', 'absence_report', '3', 'created'),
            ], days)
            self.assertEqual(payload['total'], 2, days)

    def test_uncovered_workspaces_stay_uncovered_at_60_days(self):
        payload = self.trail('?days=60')

        for workspace in ('safeguarding', 'finance', 'mis'):
            self.assertIn(workspace, payload['uncoveredWorkspaces'])
            self.assertNotIn(workspace, payload['changeWorkspaces'])
            self.assertNotIn(workspace, payload['derivedWorkspaces'])
        self.assertNotIn('tutor', payload['derivedWorkspaces'])
