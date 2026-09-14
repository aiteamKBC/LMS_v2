"""The two halves of the holiday calendar, and how the GOV.UK half stays current.

Two features are pinned here.

**The mirror maintains itself.** ``england_holidays.run_sync`` reads GOV.UK,
works out what moved, writes it, and records the check so the England Holidays
page can say *which* holidays changed rather than only that something did. The
interesting cases are the ones a naive "insert what is new" sync gets wrong: a
holiday GOV.UK withdraws (it must stop closing sessions), a holiday GOV.UK moves
to a different date (one fact, not an unexplained removal beside an unexplained
arrival), and a holiday that has simply aged out of the rolling ten-year window
(it must be kept -- a past cohort was scheduled around it).

**The other half of the calendar is authored here.** A college closure has its
own start and end date, so the write path is tested on ranges: a single day
stored as a period, an end date before the start refused, and a GOV.UK row
refusing to be edited at all.

The feed is stubbed throughout. Nothing here touches the network.
"""

import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.db import connection
from django.test import SimpleTestCase, TestCase

from . import england_holidays, views


# --------------------------------------------------------------------------
# The feed, as GOV.UK shapes it, and the mirror as the tables shape it.
# --------------------------------------------------------------------------

def feed(*events):
    """A GOV.UK payload carrying exactly these England and Wales events."""
    return {
        'england-and-wales': {'division': 'england-and-wales', 'events': list(events)},
        'scotland': {'division': 'scotland', 'events': []},
    }


def event(date, title, notes='', bunting=True):
    return {'date': date, 'title': title, 'notes': notes, 'bunting': bunting}


def stored(date, title, notes='', bunting=True):
    """One row as ``stored_holidays`` returns it, keyed by date by the caller."""
    return {
        'id': f'england-and-wales:{date}',
        'division': 'england-and-wales',
        'title': title,
        'holiday_date': date,
        'notes': notes,
        'bunting': bunting,
    }


class WhatCountsAsAChange(SimpleTestCase):
    """``plan_changes`` sorts the feed against the mirror, and writes nothing."""

    def setUp(self):
        self.incoming = {
            '2027-01-01': {'id': 'england-and-wales:2027-01-01', 'title': 'New Year’s Day', 'date': '2027-01-01', 'notes': '', 'bunting': True},
            '2027-12-27': {'id': 'england-and-wales:2027-12-27', 'title': 'Christmas Day', 'date': '2027-12-27', 'notes': 'Substitute day', 'bunting': True},
        }

    def test_a_date_the_feed_carries_and_we_do_not_is_added(self):
        added, changed, withdrawn, aged_out = england_holidays.plan_changes(
            self.incoming, {'2027-01-01': stored('2027-01-01', 'New Year’s Day')},
        )

        self.assertEqual([item['date'] for item in added], ['2027-12-27'])
        self.assertEqual(changed, [])
        self.assertEqual(withdrawn, [])
        self.assertEqual(aged_out, [])

    def test_a_retitled_or_renoted_holiday_is_changed_and_says_what_it_was(self):
        added, changed, withdrawn, _ = england_holidays.plan_changes(self.incoming, {
            '2027-01-01': stored('2027-01-01', 'New Year’s Day'),
            # Same date, no substitute-day note yet.
            '2027-12-27': stored('2027-12-27', 'Christmas Day'),
        })

        self.assertEqual(added, [])
        self.assertEqual(withdrawn, [])
        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0]['date'], '2027-12-27')
        self.assertEqual(changed[0]['notes'], 'Substitute day')
        self.assertEqual(changed[0]['previous']['notes'], '')

    def test_a_date_inside_the_feeds_span_that_it_no_longer_lists_is_withdrawn(self):
        added, changed, withdrawn, aged_out = england_holidays.plan_changes(self.incoming, {
            '2027-01-01': stored('2027-01-01', 'New Year’s Day'),
            '2027-06-01': stored('2027-06-01', 'Invented bank holiday'),
            '2027-12-27': stored('2027-12-27', 'Christmas Day', 'Substitute day'),
        })

        self.assertEqual(added, [])
        self.assertEqual(changed, [])
        self.assertEqual([item['date'] for item in withdrawn], ['2027-06-01'])
        self.assertEqual(aged_out, [])

    def test_a_date_older_than_the_feeds_window_is_kept_not_withdrawn(self):
        # GOV.UK publishes a rolling ten-year window. A holiday dropping off the
        # back of it is still the date a past cohort was scheduled around.
        _, _, withdrawn, aged_out = england_holidays.plan_changes(self.incoming, {
            '2019-01-01': stored('2019-01-01', 'New Year’s Day'),
            '2027-01-01': stored('2027-01-01', 'New Year’s Day'),
            '2027-12-27': stored('2027-12-27', 'Christmas Day', 'Substitute day'),
        })

        self.assertEqual(withdrawn, [])
        self.assertEqual([item['date'] for item in aged_out], ['2019-01-01'])

    def test_an_unchanged_mirror_reports_nothing_at_all(self):
        added, changed, withdrawn, aged_out = england_holidays.plan_changes(self.incoming, {
            '2027-01-01': stored('2027-01-01', 'New Year’s Day'),
            '2027-12-27': stored('2027-12-27', 'Christmas Day', 'Substitute day'),
        })

        self.assertEqual((added, changed, withdrawn, aged_out), ([], [], [], []))


class AMovedHolidayIsOneFact(SimpleTestCase):
    """The feed keys on date, so a reschedule arrives as a removal and an arrival."""

    def test_the_two_halves_are_reported_as_a_single_move(self):
        added = [{'id': 'england-and-wales:2027-12-28', 'title': 'Boxing Day', 'date': '2027-12-28', 'notes': 'Substitute day', 'bunting': True}]
        withdrawn = [{'id': 'england-and-wales:2027-12-26', 'title': 'Boxing Day', 'date': '2027-12-26', 'notes': '', 'bunting': True}]

        moved, still_added, still_withdrawn = england_holidays.pair_moves(added, withdrawn)

        self.assertEqual(still_added, [])
        self.assertEqual(still_withdrawn, [])
        self.assertEqual(len(moved), 1)
        self.assertEqual(moved[0]['previousDate'], '2027-12-26')
        self.assertEqual(moved[0]['date'], '2027-12-28')

    def test_a_different_holiday_in_the_same_year_is_not_paired_with_it(self):
        added = [{'id': 'x', 'title': 'Coronation of King William V', 'date': '2027-06-01', 'notes': '', 'bunting': True}]
        withdrawn = [{'id': 'y', 'title': 'Boxing Day', 'date': '2027-12-26', 'notes': '', 'bunting': True}]

        moved, still_added, still_withdrawn = england_holidays.pair_moves(added, withdrawn)

        self.assertEqual(moved, [])
        self.assertEqual(len(still_added), 1)
        self.assertEqual(len(still_withdrawn), 1)

    def test_the_same_holiday_a_year_later_is_not_a_move(self):
        # Every New Year's Day is a new holiday, not last year's one rescheduled.
        added = [{'id': 'x', 'title': 'New Year’s Day', 'date': '2029-01-01', 'notes': '', 'bunting': True}]
        withdrawn = [{'id': 'y', 'title': 'New Year’s Day', 'date': '2028-01-03', 'notes': 'Substitute day', 'bunting': True}]

        moved, still_added, still_withdrawn = england_holidays.pair_moves(added, withdrawn)

        self.assertEqual(moved, [])
        self.assertEqual(len(still_added), 1)
        self.assertEqual(len(still_withdrawn), 1)


# --------------------------------------------------------------------------
# The sync end to end, against a stubbed feed and real tables.
# --------------------------------------------------------------------------

class HolidayTableCase(TestCase):
    """Both holiday tables and the sync ledger, in SQLite."""

    def setUp(self):
        views.reset_schema_ready_flags()
        england_holidays.reset_auto_sync_state()
        self.create_tables()
        views.invalidate_curriculum_cache()

    def create_tables(self):
        with connection.cursor() as cursor:
            cursor.execute(f'''
                create table if not exists {views.table_name(views.ENGLAND_HOLIDAYS_TABLE)} (
                    id varchar(128) primary key,
                    division varchar(64) not null default 'england-and-wales',
                    title varchar(255) not null,
                    holiday_date date not null,
                    notes varchar(255) not null default '',
                    bunting boolean not null default 0,
                    fetched_at timestamp,
                    created_at timestamp,
                    updated_at timestamp
                )
            ''')
            cursor.execute(f'''
                create table if not exists {views.table_name(views.AUTHORED_HOLIDAYS_TABLE)} (
                    id integer primary key autoincrement,
                    label varchar(255) not null default '',
                    start_date date,
                    end_date date,
                    type varchar(128) not null default '',
                    color varchar(32) not null default '',
                    notes text,
                    is_archived boolean not null default 0,
                    created_at timestamp,
                    updated_at timestamp
                )
            ''')
        england_holidays.provision_sync_table()
        with connection.cursor() as cursor:
            for table in (
                views.ENGLAND_HOLIDAYS_TABLE,
                views.AUTHORED_HOLIDAYS_TABLE,
                england_holidays.SYNCS_TABLE,
            ):
                cursor.execute(f'delete from {views.table_name(table)}')
        views.reset_schema_ready_flags()

    def seed_bank_holiday(self, date, title, notes='', bunting=True, fetched_at=None):
        with connection.cursor() as cursor:
            cursor.execute(
                f'''insert into {views.table_name(views.ENGLAND_HOLIDAYS_TABLE)}
                        (id, division, title, holiday_date, notes, bunting, fetched_at, created_at, updated_at)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s)''',
                [
                    f'england-and-wales:{date}', 'england-and-wales', title, date, notes,
                    bunting, fetched_at or datetime.utcnow(), datetime.utcnow(), datetime.utcnow(),
                ],
            )

    def bank_holidays(self):
        return {
            views.format_date(row['holiday_date']): row
            for row in views.fetch_all(f'select * from {views.table_name(views.ENGLAND_HOLIDAYS_TABLE)}')
        }

    def sync_with(self, payload):
        """Run a real sync against a stubbed GOV.UK response."""
        class Response:
            @staticmethod
            def raise_for_status():
                return None

            @staticmethod
            def json():
                return payload

        with patch.object(england_holidays.requests, 'get', return_value=Response()):
            return england_holidays.run_sync(source='manual')


class TheSyncBringsTheMirrorIntoLine(HolidayTableCase):
    def test_a_new_bank_holiday_is_added_and_reported(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        summary = self.sync_with(feed(
            event('2027-01-01', 'New Year’s Day'),
            event('2027-06-07', 'Coronation bank holiday'),
        ))

        self.assertEqual(summary['status'], 'ok')
        self.assertEqual([item['date'] for item in summary['added']], ['2027-06-07'])
        self.assertIn('2027-06-07', self.bank_holidays())

    def test_a_withdrawn_bank_holiday_stops_closing_delivery_days(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')
        self.seed_bank_holiday('2027-06-07', 'Coronation bank holiday')

        summary = self.sync_with(feed(event('2027-01-01', 'New Year’s Day')))

        self.assertEqual([item['date'] for item in summary['withdrawn']], ['2027-06-07'])
        self.assertNotIn('2027-06-07', self.bank_holidays())

    def test_a_holiday_moved_by_govuk_moves_here_too_and_reads_as_one_move(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')
        self.seed_bank_holiday('2027-12-26', 'Boxing Day')

        # The 26th is inside the span the feed still covers, so its absence is a
        # withdrawal rather than a date that has aged out of the window.
        summary = self.sync_with(feed(
            event('2027-01-01', 'New Year’s Day'),
            event('2027-12-28', 'Boxing Day', 'Substitute day'),
        ))

        self.assertEqual(summary['added'], [])
        self.assertEqual(summary['withdrawn'], [])
        self.assertEqual(len(summary['moved']), 1)
        self.assertEqual(summary['moved'][0]['previousDate'], '2027-12-26')
        stored_dates = self.bank_holidays()
        self.assertIn('2027-12-28', stored_dates)
        self.assertNotIn('2027-12-26', stored_dates)

    def test_a_retitled_holiday_is_updated_in_place(self):
        self.seed_bank_holiday('2027-05-03', 'Early May bank holiday')

        summary = self.sync_with(feed(event('2027-05-03', 'Early May bank holiday (VE day)')))

        self.assertEqual(len(summary['changed']), 1)
        self.assertEqual(
            self.bank_holidays()['2027-05-03']['title'], 'Early May bank holiday (VE day)',
        )

    def test_a_holiday_older_than_the_feed_window_survives_the_sync(self):
        self.seed_bank_holiday('2019-01-01', 'New Year’s Day')

        summary = self.sync_with(feed(event('2027-01-01', 'New Year’s Day')))

        self.assertEqual([item['date'] for item in summary['agedOut']], ['2019-01-01'])
        self.assertIn('2019-01-01', self.bank_holidays())

    def test_a_dry_run_reports_without_writing(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        class Response:
            @staticmethod
            def raise_for_status():
                return None

            @staticmethod
            def json():
                return feed(event('2027-01-01', 'New Year’s Day'), event('2027-06-07', 'Extra day'))

        with patch.object(england_holidays.requests, 'get', return_value=Response()):
            summary = england_holidays.run_sync(source='command', apply=False)

        self.assertEqual([item['date'] for item in summary['added']], ['2027-06-07'])
        self.assertFalse(summary['applied'])
        self.assertNotIn('2027-06-07', self.bank_holidays())

    def test_an_unreachable_feed_leaves_every_stored_date_alone(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        with patch.object(
            england_holidays.requests, 'get',
            side_effect=england_holidays.requests.RequestException('gov.uk timed out'),
        ):
            summary = england_holidays.run_sync(source='auto')

        self.assertEqual(summary['status'], 'error')
        self.assertIn('gov.uk timed out', summary['message'])
        # The one failure mode that must never happen: an empty read reading as
        # "every bank holiday has been abolished".
        self.assertEqual(list(self.bank_holidays()), ['2027-01-01'])


class TheLedgerSaysWhatChanged(HolidayTableCase):
    def test_every_check_is_recorded_including_the_quiet_ones(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        self.sync_with(feed(event('2027-01-01', 'New Year’s Day')))
        self.sync_with(feed(event('2027-01-01', 'New Year’s Day'), event('2027-06-07', 'Extra day')))

        checks = england_holidays.recent_syncs()
        self.assertEqual(len(checks), 2)
        # Newest first: the one that found something.
        self.assertEqual([item['date'] for item in checks[0]['added']], ['2027-06-07'])
        self.assertEqual(checks[1]['added'], [])

    def test_a_failed_check_is_recorded_with_its_reason(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        with patch.object(
            england_holidays.requests, 'get',
            side_effect=england_holidays.requests.RequestException('gov.uk is down'),
        ):
            england_holidays.run_sync(source='auto')

        check = england_holidays.recent_syncs()[0]
        self.assertEqual(check['status'], 'error')
        self.assertIn('gov.uk is down', check['message'])

    def test_the_endpoint_serves_the_checks_and_the_current_state(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')
        self.seed_bank_holiday('2027-12-26', 'Boxing Day')
        self.sync_with(feed(
            event('2027-01-01', 'New Year’s Day'),
            event('2027-12-28', 'Boxing Day', 'Substitute day'),
        ))

        response = self.client.get('/curriculum_api/curriculum/england-holidays/syncs/')

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(len(payload['results']), 1)
        self.assertEqual(payload['results'][0]['moved'][0]['previousDate'], '2027-12-26')
        self.assertTrue(payload['status']['lastSuccessAt'])

    def test_the_refresh_route_checks_on_demand(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        class Response:
            @staticmethod
            def raise_for_status():
                return None

            @staticmethod
            def json():
                return feed(event('2027-01-01', 'New Year’s Day'), event('2027-06-07', 'Extra day'))

        with patch.object(england_holidays.requests, 'get', return_value=Response()):
            response = self.client.post('/curriculum_api/curriculum/england-holidays/refresh/')

        self.assertEqual(response.status_code, 200)
        summary = json.loads(response.content)['summary']
        self.assertEqual([item['date'] for item in summary['added']], ['2027-06-07'])
        self.assertIn('2027-06-07', self.bank_holidays())

    def test_a_failed_refresh_answers_with_the_reason_not_a_success(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        with patch.object(
            england_holidays.requests, 'get',
            side_effect=england_holidays.requests.RequestException('gov.uk is down'),
        ):
            response = self.client.post('/curriculum_api/curriculum/england-holidays/refresh/')

        self.assertEqual(response.status_code, 502)
        self.assertIn('gov.uk is down', json.loads(response.content)['summary']['message'])


class TheBackgroundRefreshRunsOnlyWhenItIsDue(HolidayTableCase):
    def test_a_mirror_checked_today_is_left_alone(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day', fetched_at=datetime.utcnow())

        with patch.object(england_holidays, 'AUTO_SYNC_ENABLED', True):
            self.assertFalse(england_holidays.auto_sync_if_due())

    def test_a_mirror_older_than_the_interval_is_checked(self):
        self.seed_bank_holiday(
            '2027-01-01', 'New Year’s Day', fetched_at=datetime.utcnow() - timedelta(days=3),
        )

        started = []
        with (
            patch.object(england_holidays, 'AUTO_SYNC_ENABLED', True),
            patch.object(england_holidays.threading, 'Thread') as thread,
        ):
            thread.side_effect = lambda **kwargs: started.append(kwargs) or FakeThread()
            self.assertTrue(england_holidays.auto_sync_if_due())

        self.assertEqual(len(started), 1)

    def test_it_does_nothing_at_all_when_switched_off(self):
        self.seed_bank_holiday(
            '2027-01-01', 'New Year’s Day', fetched_at=datetime.utcnow() - timedelta(days=3),
        )

        with patch.object(england_holidays, 'AUTO_SYNC_ENABLED', False):
            self.assertFalse(england_holidays.auto_sync_if_due())


class FakeThread:
    """A thread that is never actually started, for the scheduling tests above."""

    def start(self):
        return None


# --------------------------------------------------------------------------
# The authored half: closure periods with their own start and end dates.
# --------------------------------------------------------------------------

class AuthoredHolidaysCoverARangeOfDates(HolidayTableCase):
    def create_holiday(self, **payload):
        return self.client.post(
            '/curriculum_api/curriculum/holidays/', data=json.dumps(payload), content_type='application/json',
        )

    def test_a_closure_period_is_saved_across_its_whole_range(self):
        response = self.create_holiday(
            label='Christmas closure', startDate='2027-12-20', endDate='2027-12-31',
            type='College closure', color='#ea580c',
        )

        self.assertEqual(response.status_code, 201)
        holiday = json.loads(response.content)['holiday']
        self.assertEqual(holiday['startDate'], '2027-12-20')
        self.assertEqual(holiday['endDate'], '2027-12-31')
        self.assertEqual(holiday['type'], 'College closure')
        self.assertEqual(holiday['source'], 'authored')

    def test_a_single_day_closure_is_stored_as_a_period_ending_on_itself(self):
        # "Leave blank for a single day" -- every reader downstream measures a
        # period, so a one-day closure must not arrive with a null end.
        response = self.create_holiday(label='Staff training', startDate='2027-03-01')

        holiday = json.loads(response.content)['holiday']
        self.assertEqual(holiday['startDate'], '2027-03-01')
        self.assertEqual(holiday['endDate'], '2027-03-01')

    def test_an_end_before_the_start_is_refused_rather_than_swapped(self):
        response = self.create_holiday(
            label='Backwards', startDate='2027-12-31', endDate='2027-12-20',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('end date', json.loads(response.content)['error'].lower())

    def test_a_holiday_with_no_name_is_refused(self):
        response = self.create_holiday(startDate='2027-12-20')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)['fields'], ['label'])

    def test_the_dates_can_be_moved_afterwards(self):
        created = json.loads(self.create_holiday(
            label='Exam week', startDate='2027-05-10', endDate='2027-05-14',
        ).content)['holiday']

        response = self.client.patch(
            f"/curriculum_api/curriculum/holidays/{created['id']}/",
            data=json.dumps({'endDate': '2027-05-21'}), content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        rows = views.get_holiday_rows()
        moved = [views.serialize_holiday_row(row) for row in rows if row.get('label') == 'Exam week'][0]
        self.assertEqual(moved['startDate'], '2027-05-10')
        self.assertEqual(moved['endDate'], '2027-05-21')

    def test_renaming_a_type_leaves_the_dates_where_they_are(self):
        # The Holidays page renames a type by patching the type alone across the
        # holidays that carry it; a patch that also rewrote the dates would move
        # every one of them.
        created = json.loads(self.create_holiday(
            label='Half term', startDate='2027-02-15', endDate='2027-02-19', type='Half term',
        ).content)['holiday']

        self.client.patch(
            f"/curriculum_api/curriculum/holidays/{created['id']}/",
            data=json.dumps({'type': 'Term break', 'color': '#2563eb'}),
            content_type='application/json',
        )

        row = [item for item in views.get_holiday_rows() if item.get('label') == 'Half term'][0]
        holiday = views.serialize_holiday_row(row)
        self.assertEqual(holiday['type'], 'Term break')
        self.assertEqual(holiday['startDate'], '2027-02-15')
        self.assertEqual(holiday['endDate'], '2027-02-19')

    def test_archiving_one_takes_it_out_of_the_calendar(self):
        created = json.loads(self.create_holiday(
            label='Cancelled closure', startDate='2027-07-01', endDate='2027-07-05',
        ).content)['holiday']

        response = self.client.delete(f"/curriculum_api/curriculum/holidays/{created['id']}/")

        self.assertEqual(response.status_code, 200)
        labels = [views.clean_str(row.get('label')) for row in views.get_holiday_rows()]
        self.assertNotIn('Cancelled closure', labels)
        # Archived, not deleted: still there when asked for.
        archived = [views.clean_str(row.get('label')) for row in views.get_holiday_rows(include_archived=True)]
        self.assertIn('Cancelled closure', archived)

    def test_a_bank_holiday_cannot_be_edited_here(self):
        self.seed_bank_holiday('2027-01-01', 'New Year’s Day')

        response = self.client.patch(
            '/curriculum_api/curriculum/holidays/england-and-wales:2027-01-01/',
            data=json.dumps({'label': 'Renamed'}), content_type='application/json',
        )

        self.assertEqual(response.status_code, 405)
        self.assertIn('GOV.UK', json.loads(response.content)['error'])


class OneCalendarOutOfTwoTables(HolidayTableCase):
    def test_both_kinds_are_served_together_in_date_order(self):
        self.seed_bank_holiday('2027-12-25', 'Christmas Day')
        self.client.post(
            '/curriculum_api/curriculum/holidays/',
            data=json.dumps({'label': 'Summer closure', 'startDate': '2027-08-02', 'endDate': '2027-08-13'}),
            content_type='application/json',
        )

        response = self.client.get('/curriculum_api/curriculum/holidays/')

        self.assertEqual(response.status_code, 200)
        results = json.loads(response.content)['results']
        self.assertEqual(
            [(item['label'], item['startDate'], item['source']) for item in results],
            [
                ('Summer closure', '2027-08-02', 'authored'),
                ('Christmas Day', '2027-12-25', 'gov.uk'),
            ],
        )

    def test_a_bank_holiday_keeps_its_type_and_a_closure_keeps_its_own(self):
        self.seed_bank_holiday('2027-12-25', 'Christmas Day')
        self.client.post(
            '/curriculum_api/curriculum/holidays/',
            data=json.dumps({'label': 'Exam week', 'startDate': '2027-05-10', 'endDate': '2027-05-14', 'type': 'Exam week'}),
            content_type='application/json',
        )

        by_label = {
            item['label']: item
            for item in json.loads(self.client.get('/curriculum_api/curriculum/holidays/').content)['results']
        }

        self.assertEqual(by_label['Christmas Day']['type'], views.BANK_HOLIDAY_TYPE)
        self.assertEqual(by_label['Exam week']['type'], 'Exam week')

    def test_a_closure_period_closes_every_delivery_day_inside_it(self):
        # The whole point of the range: a fortnight's closure is fourteen closed
        # calendar days, not one.
        self.client.post(
            '/curriculum_api/curriculum/holidays/',
            data=json.dumps({'label': 'Summer closure', 'startDate': '2027-08-02', 'endDate': '2027-08-13'}),
            content_type='application/json',
        )

        holidays = [views.serialize_holiday_row(row) for row in views.get_holiday_rows()]
        closed = views.holiday_date_set(holidays)

        self.assertEqual(len(closed), 12)
        self.assertIn(views.parse_date('2027-08-09'), closed)
