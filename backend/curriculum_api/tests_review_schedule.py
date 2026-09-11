"""Review Schedule preview + clash resolution (review_schedule.py)."""
import json

from django.db import connection
from django.test import TestCase

from . import review_schedule, reviews, views


class ReviewScheduleTestCase(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_schedule.provision_review_schedule_tables()
        self._clear()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table = 'curriculum.programmes'
            else:
                table = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table} (
                    id varchar(128) primary key,
                    programme_id varchar(128),
                    program_id varchar(128),
                    name varchar(255),
                    status varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def _clear(self):
        for table in (
            review_schedule.CLASH_RESOLUTIONS_TABLE,
            review_schedule.OCCURRENCE_OVERRIDES_TABLE,
            reviews.REVIEW_FIELDS_TABLE,
            reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE,
            'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')

    def _programme(self, programme_id='PROG-DATA', name='Data Technician'):
        views.insert_row('programmes', {
            'id': programme_id,
            'programme_id': programme_id,
            'program_id': programme_id,
            'name': name,
            'status': 'active',
            'is_active': True,
            'is_archived': False,
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _create_review(self, programme_id, *, name, interval, unit, anchor, enabled=True, **overrides):
        payload = {
            'name': name,
            'enabled': enabled,
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': anchor,
            'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'recordTimeSpent': False,
            'allowEditingPriorDays': 0,
            'notifications': {'employer': False, 'participant': False},
            'incompleteMarker': '',
            'fields': [{'title': 'Notes', 'fieldType': 'text', 'required': False}],
        }
        payload.update(overrides)
        response = self.client.post(
            f'/curriculum_api/curriculum/programmes/{programme_id}/reviews/',
            data=json.dumps(payload), content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['review']['id']

    def _schedule(self, programme_id, *, months=12, today=None):
        if today is None:
            return review_schedule.build_programme_schedule(programme_id, months=months)
        return review_schedule.build_programme_schedule(programme_id, months=months, today=today)

    def _get_schedule(self, programme_id, *, months=None):
        query = f'?months={months}' if months else ''
        return self.client.get(f'/curriculum_api/curriculum/programmes/{programme_id}/reviews/schedule/{query}')

    def _resolve(self, programme_id, month, occurrences):
        return self.client.post(
            f'/curriculum_api/curriculum/programmes/{programme_id}/reviews/clashes/resolve/',
            data=json.dumps({'month': month, 'occurrences': occurrences}),
            content_type='application/json',
        )


class RecurrenceMathTests(TestCase):
    def test_weekly_recurrence_steps_by_seven_days(self):
        from datetime import date
        occ = review_schedule.generate_occurrences(date(2027, 1, 1), 1, 'weeks', date(2027, 1, 1), date(2027, 1, 31))
        self.assertEqual(occ, [date(2027, 1, 1), date(2027, 1, 8), date(2027, 1, 15), date(2027, 1, 22), date(2027, 1, 29)])

    def test_twelve_week_recurrence_is_84_days_not_three_calendar_months(self):
        from datetime import date
        occ = review_schedule.generate_occurrences(date(2027, 1, 1), 12, 'weeks', date(2027, 1, 1), date(2027, 12, 31))
        self.assertIn(date(2027, 3, 26), occ)  # 1 Jan + 84 days
        self.assertNotIn(date(2027, 4, 1), occ)  # NOT "3 calendar months later"

    def test_monthly_recurrence_uses_calendar_months(self):
        from datetime import date
        occ = review_schedule.generate_occurrences(date(2027, 1, 15), 1, 'months', date(2027, 1, 1), date(2027, 6, 30))
        self.assertEqual(occ, [date(2027, 1, 15), date(2027, 2, 15), date(2027, 3, 15), date(2027, 4, 15), date(2027, 5, 15), date(2027, 6, 15)])

    def test_month_end_date_clamps_correctly(self):
        # Each occurrence clamps against the ANCHOR's original day (31), not a
        # drifting previous occurrence -- so March (which has 31 days) is not
        # stuck at 28 just because February was.
        from datetime import date
        occ = review_schedule.generate_occurrences(date(2027, 1, 31), 1, 'months', date(2027, 1, 1), date(2027, 4, 30))
        self.assertEqual(occ, [date(2027, 1, 31), date(2027, 2, 28), date(2027, 3, 31), date(2027, 4, 30)])

    def test_daily_recurrence(self):
        from datetime import date
        occ = review_schedule.generate_occurrences(date(2027, 1, 1), 10, 'days', date(2027, 1, 1), date(2027, 1, 31))
        self.assertEqual(occ, [date(2027, 1, 1), date(2027, 1, 11), date(2027, 1, 21), date(2027, 1, 31)])

    def test_bounded_generation_never_exceeds_max_count(self):
        from datetime import date
        occ = review_schedule.generate_occurrences(date(2000, 1, 1), 1, 'days', date(2027, 1, 1), date(2027, 12, 31), max_count=5)
        self.assertLessEqual(len(occ), 5)


class ScheduleDetectionTests(ReviewScheduleTestCase):
    def test_monthly_review_appears_every_month(self):
        programme_id = self._programme()
        self._create_review(programme_id, name='MCM', interval=1, unit='months', anchor='2027-01-15')
        schedule = self._schedule(programme_id, today=__import__('datetime').date(2027, 1, 1))
        months = [m['month'] for m in schedule['months']]
        self.assertEqual(months, ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'])
        for month in schedule['months']:
            self.assertFalse(month['hasClash'])
            self.assertEqual(month['resolutionStatus'], 'none')

    def test_no_clash_when_reviews_fall_in_different_months(self):
        programme_id = self._programme()
        self._create_review(programme_id, name='Six-Monthly A', interval=6, unit='months', anchor='2027-01-10')
        self._create_review(programme_id, name='Six-Monthly B', interval=6, unit='months', anchor='2027-04-10')
        from datetime import date
        schedule = self._schedule(programme_id, today=date(2027, 1, 1))
        clashing = [m for m in schedule['months'] if m['hasClash']]
        self.assertEqual(clashing, [])
        occupied = {m['month'] for m in schedule['months']}
        self.assertEqual(occupied, {'2027-01', '2027-04', '2027-07', '2027-10'})

    def test_same_month_clash_detected(self):
        programme_id = self._programme()
        self._create_review(programme_id, name='MCM', interval=1, unit='months', anchor='2027-01-15')
        self._create_review(programme_id, name='PR', interval=12, unit='weeks', anchor='2027-03-22')
        from datetime import date
        schedule = self._schedule(programme_id, today=date(2027, 1, 1))
        march = next(m for m in schedule['months'] if m['month'] == '2027-03')
        self.assertTrue(march['hasClash'])
        self.assertEqual(march['resolutionStatus'], 'unresolved')
        names = sorted(o['reviewName'] for o in march['occurrences'])
        self.assertEqual(names, ['MCM', 'PR'])

    def test_three_reviews_in_one_month_all_flagged(self):
        programme_id = self._programme()
        self._create_review(programme_id, name='A', interval=1, unit='months', anchor='2027-03-01')
        self._create_review(programme_id, name='B', interval=1, unit='months', anchor='2027-03-10')
        self._create_review(programme_id, name='C', interval=1, unit='months', anchor='2027-03-20')
        from datetime import date
        schedule = self._schedule(programme_id, today=date(2027, 3, 1))
        march = next(m for m in schedule['months'] if m['month'] == '2027-03')
        self.assertEqual(len(march['occurrences']), 3)
        self.assertTrue(march['hasClash'])

    def test_disabled_review_excluded_from_schedule(self):
        programme_id = self._programme()
        self._create_review(programme_id, name='Disabled', interval=1, unit='months', anchor='2027-01-15', enabled=False)
        from datetime import date
        schedule = self._schedule(programme_id, today=date(2027, 1, 1))
        self.assertEqual(schedule['months'], [])

    def test_deleted_review_excluded_from_schedule(self):
        programme_id = self._programme()
        review_id = self._create_review(programme_id, name='Deleted', interval=1, unit='months', anchor='2027-01-15')
        self.client.delete(f'/curriculum_api/curriculum/reviews/{review_id}/')
        from datetime import date
        schedule = self._schedule(programme_id, today=date(2027, 1, 1))
        self.assertEqual(schedule['months'], [])

    def test_programme_isolation_no_cross_programme_clash(self):
        programme_a = self._programme('PROG-A', 'Programme A')
        programme_b = self._programme('PROG-B', 'Programme B')
        self._create_review(programme_a, name='A-Review', interval=1, unit='months', anchor='2027-01-15')
        self._create_review(programme_b, name='B-Review', interval=1, unit='months', anchor='2027-01-15')
        from datetime import date
        schedule_a = self._schedule(programme_a, today=date(2027, 1, 1))
        jan_a = next(m for m in schedule_a['months'] if m['month'] == '2027-01')
        self.assertFalse(jan_a['hasClash'])
        self.assertEqual(len(jan_a['occurrences']), 1)

    def test_bounded_schedule_generation_respects_months_param(self):
        programme_id = self._programme()
        self._create_review(programme_id, name='Weekly', interval=1, unit='weeks', anchor='2027-01-01')
        response = self._get_schedule(programme_id, months=1)
        payload = response.json()
        self.assertEqual(payload['monthsPreviewed'], 1)
        self.assertLessEqual(len(payload['months']), 1)
        # months=999 must still be clamped to MAX_PREVIEW_MONTHS, never unbounded.
        clamped = self._get_schedule(programme_id, months=999).json()
        self.assertEqual(clamped['monthsPreviewed'], review_schedule.MAX_PREVIEW_MONTHS)


class ClashResolutionTests(ReviewScheduleTestCase):
    def setUp(self):
        super().setUp()
        self.programme_id = self._programme()
        self.mcm_id = self._create_review(self.programme_id, name='MCM', interval=1, unit='months', anchor='2027-01-15')
        self.pr_id = self._create_review(self.programme_id, name='PR', interval=12, unit='weeks', anchor='2027-03-22')

    def test_skip_one_occurrence(self):
        response = self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'skip'},
            {'reviewId': self.pr_id, 'occurrenceDate': '2027-03-22', 'action': 'keep'},
        ])
        self.assertEqual(response.status_code, 200, response.content)
        month = response.json()['month']
        self.assertEqual(month['resolutionStatus'], 'resolved')
        statuses = {o['reviewId']: o['status'] for o in month['occurrences']}
        self.assertEqual(statuses[self.mcm_id], 'skipped')
        self.assertEqual(statuses[self.pr_id], 'scheduled')

    def test_skipping_does_not_shift_future_recurrence(self):
        self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'skip'},
            {'reviewId': self.pr_id, 'occurrenceDate': '2027-03-22', 'action': 'keep'},
        ])
        from datetime import date
        schedule = self._schedule(self.programme_id, today=date(2027, 1, 1))
        april = next(m for m in schedule['months'] if m['month'] == '2027-04')
        self.assertEqual(len(april['occurrences']), 1)
        self.assertEqual(april['occurrences'][0]['occurrenceDate'], '2027-04-15')
        self.assertEqual(april['occurrences'][0]['status'], 'scheduled')

    def test_restore_skipped_occurrence(self):
        self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'skip'},
            {'reviewId': self.pr_id, 'occurrenceDate': '2027-03-22', 'action': 'keep'},
        ])
        response = self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'keep'},
        ])
        month = response.json()['month']
        statuses = {o['reviewId']: o['status'] for o in month['occurrences']}
        self.assertEqual(statuses[self.mcm_id], 'scheduled')
        self.assertEqual(month['resolutionStatus'], 'kept_all')

    def test_keep_both_persists_and_is_not_unresolved_on_reload(self):
        response = self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'keep'},
            {'reviewId': self.pr_id, 'occurrenceDate': '2027-03-22', 'action': 'keep'},
        ])
        self.assertEqual(response.json()['month']['resolutionStatus'], 'kept_all')

        from datetime import date
        schedule = self._schedule(self.programme_id, today=date(2027, 1, 1))
        march = next(m for m in schedule['months'] if m['month'] == '2027-03')
        self.assertEqual(march['resolutionStatus'], 'kept_all')
        self.assertTrue(march['hasClash'])

    def test_unresolved_until_a_decision_is_made(self):
        from datetime import date
        schedule = self._schedule(self.programme_id, today=date(2027, 1, 1))
        march = next(m for m in schedule['months'] if m['month'] == '2027-03')
        self.assertEqual(march['resolutionStatus'], 'unresolved')

    def test_unique_occurrence_override_no_duplicate_skip_rows(self):
        self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'skip'},
        ])
        self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'skip'},
        ])
        rows = views.fetch_all(
            f"select * from {views.table_name(review_schedule.OCCURRENCE_OVERRIDES_TABLE)} "
            f"where review_id = %s and occurrence_date = %s and deleted_at is null",
            [self.mcm_id, '2027-03-15'],
        )
        self.assertEqual(len(rows), 1)

    def test_rejects_occurrence_not_actually_scheduled(self):
        response = self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-16', 'action': 'skip'},
        ])
        self.assertEqual(response.status_code, 400)

    def test_rejects_review_from_another_programme(self):
        other_programme = self._programme('PROG-OTHER', 'Other')
        other_review = self._create_review(other_programme, name='Other', interval=1, unit='months', anchor='2027-03-05')
        response = self._resolve(self.programme_id, '2027-03', [
            {'reviewId': other_review, 'occurrenceDate': '2027-03-05', 'action': 'skip'},
        ])
        self.assertEqual(response.status_code, 400)

    def test_invalid_action_rejected(self):
        response = self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'delete'},
        ])
        self.assertEqual(response.status_code, 400)

    def test_stale_override_after_recurrence_edit_is_ignored(self):
        self._resolve(self.programme_id, '2027-03', [
            {'reviewId': self.mcm_id, 'occurrenceDate': '2027-03-15', 'action': 'skip'},
        ])
        # Edit MCM's anchor so its March occurrence is now the 18th, not the 15th.
        self.client.patch(
            f'/curriculum_api/curriculum/reviews/{self.mcm_id}/',
            data=json.dumps({'scheduleAnchorDate': '2027-01-18'}),
            content_type='application/json',
        )
        from datetime import date
        schedule = self._schedule(self.programme_id, today=date(2027, 1, 1))
        march = next(m for m in schedule['months'] if m['month'] == '2027-03')
        mcm_occurrence = next(o for o in march['occurrences'] if o['reviewId'] == self.mcm_id)
        self.assertEqual(mcm_occurrence['occurrenceDate'], '2027-03-18')
        self.assertEqual(mcm_occurrence['status'], 'scheduled')  # the 15th override no longer applies


class CloneDoesNotCopyOccurrenceDecisionsTests(ReviewScheduleTestCase):
    def test_clone_does_not_copy_occurrence_overrides(self):
        source_programme = self._programme('PROG-SRC', 'Source')
        dest_programme = self._programme('PROG-DEST', 'Destination')
        review_id = self._create_review(source_programme, name='MCM', interval=1, unit='months', anchor='2027-01-15')
        self._resolve(source_programme, '2027-01', [
            {'reviewId': review_id, 'occurrenceDate': '2027-01-15', 'action': 'skip'},
        ])
        clone_response = self.client.post(
            f'/curriculum_api/curriculum/programmes/{dest_programme}/reviews/clone/',
            data=json.dumps({'sourceProgrammeId': source_programme, 'reviewIds': [review_id]}),
            content_type='application/json',
        )
        self.assertEqual(clone_response.status_code, 200, clone_response.content)
        cloned_review_id = clone_response.json()['reviewIds'][0]

        from datetime import date
        schedule = self._schedule(dest_programme, today=date(2027, 1, 1))
        january = next(m for m in schedule['months'] if m['month'] == '2027-01')
        occurrence = next(o for o in january['occurrences'] if o['reviewId'] == cloned_review_id)
        self.assertEqual(occurrence['status'], 'scheduled')
