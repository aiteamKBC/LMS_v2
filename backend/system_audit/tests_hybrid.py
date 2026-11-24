"""Canonical revision feeds, with legacy timestamp rows as exclusion fixtures.

Retired contracts and replacements: persistence_contract_cleanup.md.
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
    """Only canonical revisions contribute events, actors, counts and start times."""

    # ------------------------------------------------------------ the boundary

    def test_each_type_reports_only_its_canonical_start(self):
        self.revision('absence_report', '90', self.at(hours=48))
        self.revision('coach_meeting', 'M-90', self.at(hours=24))
        self.absence(1, 'Before both', self.at(hours=60))
        self.absence(2, 'Between starts', self.at(hours=36))
        self.meeting('M-1', 'Between starts', self.at(hours=36))
        self.meeting('M-2', 'After both', self.at(hours=12))
        payload = self.trail('?workspace=coach&days=7')
        self.assertEqual(sorted(self.keyed(payload)), [
            ('revision', 'absence_report', '90', 'updated'),
            ('revision', 'coach_meeting', 'M-90', 'updated'),
        ])
        for entity, hours in [('absence_report', 48), ('coach_meeting', 24)]:
            self.assertEqual(payload['revisionStartedAt'][entity].replace('T', ' ')[:19], self.at(hours=hours))

    def test_source_rows_on_either_side_of_the_old_guard_are_never_recovered(self):
        boundary = self.now - timedelta(hours=10)
        self.revision('absence_report', '90', boundary.strftime('%Y-%m-%d %H:%M:%S'))
        self.absence(1, 'Before guard', (boundary - GUARD - timedelta(seconds=1)).strftime('%Y-%m-%d %H:%M:%S'))
        self.absence(2, 'Inside guard', (boundary - timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S'))
        self.absence(3, 'After start', self.at(hours=2))
        payload = self.trail('?workspace=coach&days=7')
        self.assertEqual(self.keyed(payload), [('revision', 'absence_report', '90', 'updated')])
        self.assertEqual(payload['provenanceCounts'], {'revision': 1, 'timestamps': 0})

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

    def test_deep_canonical_pages_ignore_source_only_history(self):
        for number in range(14):
            self.revision('absence_report', str(100 + number), self.at(hours=30 + number))
        for number in range(6):
            self.absence(number + 1, f'Source {number}', self.at(hours=50 + number))
        first, events = self.every_page('?workspace=coach&days=7', 3)
        self.assertEqual((first['total'], first['pages'], len(events)), (14, 5, 14))
        self.assertEqual(len({event['id'] for event in events}), 14)
        stamps = [event['at'] for event in events]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        self.assertEqual({event['provenance'] for event in events}, {'revision'})
        self.assertEqual(first['provenanceCounts'], {'revision': 14, 'timestamps': 0})
        later = self.trail('?workspace=coach&days=7&limit=3&page=4')
        self.assertEqual(later['total'], 14)
        self.assertEqual(later['actionCounts'], first['actionCounts'])

    def test_workspace_filter_isolates_canonical_events_and_counts(self):
        for entity in ('absence_report', 'staff_record'):
            for ident in ('1', '90'):
                self.revision(entity, ident, self.at(hours=20), action='created')
        self.absence(2, 'Unlogged', self.at(hours=30))
        self.staff(2, 'Unlogged', self.at(hours=30), self.at(hours=30))
        for workspace, entity in [('coach', 'absence_report'), ('admin', 'staff_record')]:
            payload = self.trail(f'?workspace={workspace}&days=7&limit=1')
            self.assertEqual({event['entity'] for event in payload['events']}, {entity})
            self.assertEqual(payload['entityCounts'], {entity: 2})
            self.assertEqual(payload['total'], 2)
            self.assertEqual(payload['provenanceCounts'], {'revision': 2, 'timestamps': 0})

    def test_record_type_filters_canonical_events_before_paging(self):
        self.revision('absence_report', '90', self.at(hours=20))
        self.revision('coach_meeting', 'M-90', self.at(hours=20))
        self.revision('coach_meeting', 'M-1', self.at(hours=30), action='created')
        self.meeting('M-2', 'Unlogged', self.at(hours=10))
        payload = self.trail('?workspace=coach&days=7&entity=coach_meeting')
        self.assertEqual(sorted(self.keyed(payload)), [
            ('revision', 'coach_meeting', 'M-1', 'created'),
            ('revision', 'coach_meeting', 'M-90', 'updated'),
        ])
        self.assertEqual(payload['entityCounts'], {'coach_meeting': 2})
        self.assertEqual(self.trail('?entity=coach_meeting&limit=1')['total'], 2)

    def test_author_filter_and_options_use_only_saved_revision_actors(self):
        self.revision('attendance_intervention', '1', self.at(hours=30), actor_email='coach@example.test')
        self.revision('attendance_intervention', '2', self.at(hours=29), actor_email='other@example.test')
        self.revision('absence_report', '1', self.at(hours=5), actor_email='coach@example.test')
        self.intervention(3, 'Unlogged', self.at(hours=1), created_by='raw@example.test')
        payload = self.trail('?days=7&actor=coach@example.test')
        self.assertEqual(sorted(self.keyed(payload)), [
            ('revision', 'absence_report', '1', 'updated'),
            ('revision', 'attendance_intervention', '1', 'updated'),
        ])
        actors = {actor['email']: actor['changes'] for actor in payload['actors']}
        self.assertEqual(actors, {'coach@example.test': 2, 'other@example.test': 1})

    def test_date_window_uses_revision_events_not_source_timestamps(self):
        for ident, hours in [('90', 48), ('1', 60), ('2', 80)]:
            self.revision('absence_report', ident, self.at(hours=hours))
        self.absence(3, 'Raw source inside window', self.at(hours=1))
        payload = self.trail('?workspace=coach&days=3')
        self.assertEqual(sorted(self.keyed(payload)), [
            ('revision', 'absence_report', '1', 'updated'),
            ('revision', 'absence_report', '90', 'updated'),
        ])
        self.assertEqual(payload['revisionStartedAt']['absence_report'].replace('T', ' ')[:19], self.at(hours=80))

    def test_unlogged_type_has_no_events_and_null_authoritative_start(self):
        self.intervention(1, 'Recent source', self.at(hours=2))
        self.intervention(2, 'Older source', self.at(hours=100))
        payload = self.trail('?workspace=engagement&days=7')
        self.assertEqual(payload['events'], [])
        self.assertEqual(payload['total'], 0)
        self.assertIsNone(payload['revisionStartedAt']['attendance_intervention'])
        self.assertEqual(payload['derivedWorkspaces'], [])
        self.assertEqual(payload['actors'], [])

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

    def test_canonical_blank_author_never_becomes_the_signed_in_reader(self):
        self.revision('absence_report', '90', self.at(hours=10), actor_email='', actor_name='')
        self.sign_in('Somebody Reading', 'reader@example.test')
        event, = self.trail('?workspace=coach&days=7')['events']
        self.assertEqual(event['actorName'], '')
        self.assertEqual(event['actorEmail'], '')
        self.assertEqual(event['provenanceLabel'], 'Revision history')
        self.assertEqual(len(event['changes']), 1)

    def test_recorded_created_and_updated_keep_their_saved_meaning(self):
        # Explicit canonical events, not inferred actions from source stamps.
        for ident, action, hours in [('1', 'recorded', 30), ('2', 'created', 40),
                                     ('3', 'created', 60), ('3', 'updated', 50)]:
            self.revision('staff_record', ident, self.at(hours=hours), action=action)
        self.staff(4, 'Unlogged', None, self.at(hours=10))
        self.assertEqual(sorted(self.keyed(self.trail('?workspace=admin&days=7'))), [
            ('revision', 'staff_record', '1', 'recorded'),
            ('revision', 'staff_record', '2', 'created'),
            ('revision', 'staff_record', '3', 'created'),
            ('revision', 'staff_record', '3', 'updated'),
        ])

    def test_identical_revision_moments_have_stable_id_order_across_pages(self):
        same = self.at(hours=30)
        for ident in ('M-9', 'M-1', 'M-2'):
            self.revision('coach_meeting', ident, same)
        self.absence(1, 'Unlogged tie', same)
        reads = [self.keyed(self.trail('?workspace=coach&days=7&limit=50')) for _ in range(3)]
        self.assertEqual(reads[0], reads[1])
        self.assertEqual(reads[1], reads[2])
        self.assertEqual(reads[0], [('revision', 'coach_meeting', ident, 'updated') for ident in ('M-2', 'M-1', 'M-9')])
        _, paged = self.every_page('?workspace=coach&days=7', 1)
        self.assertEqual([(e['provenance'], e['entity'], e['entityId'], e['action']) for e in paged], reads[0])

    def test_a_filter_only_the_log_can_answer_reads_the_log_alone(self):
        self.revision('absence_report', '90', self.at(hours=10))
        self.absence(1, 'Ahmed Ali', self.at(hours=30))

        payload = self.trail('?workspace=coach&days=7&scope=module&scopeId=MOD-1')

        self.assertFalse(payload['recoveredHistory'])
        self.assertEqual(self.keyed(payload, 'timestamps'), [])

    def test_coverage_advertises_registered_revisions_never_timestamp_sources(self):
        from unittest.mock import patch
        from system_audit import writes
        with patch.object(derived, 'resolve', side_effect=AssertionError('Retired source scan')):
            payload = self.trail('?days=7')
        self.assertEqual(payload['derivedWorkspaces'], [])
        self.assertEqual(payload['revisionWorkspaces'], writes.change_workspaces())
        self.assertEqual(payload['changeWorkspaces'], writes.change_workspaces())
        self.assertFalse(set(payload['uncoveredWorkspaces']) & set(payload['changeWorkspaces']))
        self.assertFalse(payload['recoveredHistory'])
        self.assertEqual(payload['provenanceCounts']['timestamps'], 0)


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

    def test_system_wide_30_days_includes_canonical_events_from_each_workspace(self):
        for entity in ('absence_report', 'staff_record', 'attendance_intervention'):
            self.revision(entity, '1', self.days_ago(20), action='created')
        payload = self.trail('?days=30&limit=200')
        self.assertEqual(payload['windowDays'], 30)
        self.assertEqual({e['workspace'] for e in payload['events']}, {'coach', 'admin', 'engagement'})
        self.assertEqual(payload['total'], 3)

    def test_system_wide_60_days_includes_canonical_events_outside_30_days(self):
        for entity in ('absence_report', 'staff_record', 'attendance_intervention'):
            self.revision(entity, '1', self.days_ago(50), action='created')
        thirty = self.trail('?days=30&limit=200')
        sixty = self.trail('?days=60&limit=200')
        self.assertEqual(thirty['events'], [])
        self.assertEqual(sixty['windowDays'], 60)
        self.assertEqual({e['workspace'] for e in sixty['events']}, {'coach', 'admin', 'engagement'})
        self.assertEqual(sixty['total'], 3)

    def test_workspace_30_and_60_day_feeds_use_only_their_canonical_events(self):
        for entity in ('absence_report', 'staff_record', 'attendance_intervention'):
            for ident, days in [('1', 20), ('2', 45)]:
                self.revision(entity, ident, self.days_ago(days), action='created')
        for workspace, entity in [('coach', 'absence_report'), ('admin', 'staff_record'), ('engagement', 'attendance_intervention')]:
            thirty = self.trail(f'?workspace={workspace}&days=30')
            sixty = self.trail(f'?workspace={workspace}&days=60')
            self.assertEqual(self.keyed(thirty), [('revision', entity, '1', 'created')])
            self.assertEqual(sorted(self.keyed(sixty)), [('revision', entity, '1', 'created'), ('revision', entity, '2', 'created')])
            self.assertEqual((thirty['windowDays'], sixty['windowDays']), (30, 60))

    def test_seven_days_stays_the_default_and_reads_no_further(self):
        self.seed_older_history(20)

        payload = self.trail('?workspace=coach')

        self.assertEqual(payload['windowDays'], 7)
        self.assertEqual(self.keyed(payload, 'timestamps'), [])

    def test_a_non_curriculum_feed_still_stops_at_60_days(self):
        self.assertEqual(self.trail('?workspace=coach&days=365')['windowDays'], 60)
        self.assertEqual(self.trail('?days=365')['windowDays'], 60)

    def test_source_rows_never_duplicate_a_revision_in_any_window(self):
        boundary = self.now - timedelta(days=3)
        self.revision('absence_report', '1', boundary.strftime('%Y-%m-%d %H:%M:%S'), action='created')
        for ident, delta in [(1, timedelta(seconds=2)), (2, timedelta(minutes=1)), (3, GUARD + timedelta(seconds=1))]:
            self.absence(ident, 'Source only', (boundary - delta).strftime('%Y-%m-%d %H:%M:%S'))
        for days in (7, 30, 60):
            payload = self.trail(f'?workspace=coach&days={days}')
            self.assertEqual(self.keyed(payload), [('revision', 'absence_report', '1', 'created')])
            self.assertEqual(payload['total'], 1)

    def test_uncovered_workspaces_stay_uncovered_at_60_days(self):
        payload = self.trail('?days=60')

        for workspace in ('safeguarding', 'finance', 'mis'):
            self.assertIn(workspace, payload['uncoveredWorkspaces'])
            self.assertNotIn(workspace, payload['changeWorkspaces'])
            self.assertNotIn(workspace, payload['derivedWorkspaces'])
        self.assertNotIn('tutor', payload['derivedWorkspaces'])
