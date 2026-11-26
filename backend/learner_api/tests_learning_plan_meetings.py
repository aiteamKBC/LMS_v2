"""The Learning plan's Meetings table follows the PROGRAMME, not the plan.

Reviews are configured per Curriculum programme, so which Reviews a learner
attends is decided by ``learner.programme`` alone. Two nearby values must never
be used for it, and both were available at the call site:

  * the plan's own modules -- the picker deliberately allows borrowing a module
    from another programme, so the plan can name a programme the learner is not
    on;
  * the group's modules -- a group's catalogue rows carry their own programme
    id, which is what the modal's Group column reflects.

Resolving from either gives a learner whichever programme's Reviews their
module list happens to name. These cover that, plus the two ways the lookup can
come back empty (unconfigured programme, unreachable Curriculum), which must
leave the modules table intact rather than failing the whole modal.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .learning_plan import _meetings, _parse_day, _totals

MEETING = {
    'reviewTemplateId': 'REV-1',
    'name': 'Monthly Coaching Meeting',
    'hoursEach': 2.5,
    'occurrences': 12,
    'hours': 30.0,
    'recurrenceLabel': 'Every month',
    'startDate': '2026-09-10',
    'endDate': '2027-08-10',
}


def _learner(programme='Final Test', start='2026-08-03', end='2027-08-02', status='Active'):
    return SimpleNamespace(
        pk=99, programme=programme, programme_status=status,
        start_date=start, end_date=end,
    )


class LearningPlanMeetingsTestCase(SimpleTestCase):
    # ------------------------------------------- the programme is the source

    def test_programme_is_resolved_from_the_learner_not_the_plan(self):
        learner = _learner(programme='Final Test')
        with patch('coach_api.views.resolve_curriculum_programme_id', return_value='PROG-FINAL') as resolve, \
             patch('curriculum_api.review_otjh.planned_meetings', return_value=[MEETING]) as planned:
            meetings, reason = _meetings(learner)

        # Resolved from the learner's own programme NAME...
        resolve.assert_called_once_with('Final Test')
        # ...and that id is what the Review Engine is asked about.
        self.assertEqual(planned.call_args.args[0], 'PROG-FINAL')
        self.assertEqual(meetings, [MEETING])
        self.assertEqual(reason, '')

    def test_learner_start_and_status_drive_the_projection(self):
        learner = _learner(start='2026-08-03', end='2027-08-02', status='Active')
        with patch('coach_api.views.resolve_curriculum_programme_id', return_value='PROG-FINAL'), \
             patch('curriculum_api.review_otjh.planned_meetings', return_value=[]) as planned:
            _meetings(learner)

        programme_id, learner_id, status, start, window_start, window_end = planned.call_args.args
        self.assertEqual(programme_id, 'PROG-FINAL')
        self.assertEqual(learner_id, 99)
        self.assertEqual(status, 'Active')
        # Text columns on Created_users must arrive as real dates.
        self.assertEqual(start, date(2026, 8, 3))
        self.assertEqual(window_start, date(2026, 8, 3))
        self.assertEqual(window_end, date(2027, 8, 2))

    # ------------------------------------------------------- empty, not loud

    def test_programme_not_configured_in_curriculum_shows_no_meetings(self):
        with patch('coach_api.views.resolve_curriculum_programme_id', return_value=None), \
             patch('curriculum_api.review_otjh.planned_meetings') as planned:
            self.assertEqual(_meetings(_learner())[0], [])
        planned.assert_not_called()

    def test_unreachable_curriculum_shows_no_meetings_rather_than_failing(self):
        """The modules table must still render when Curriculum is down."""
        with patch('coach_api.views.resolve_curriculum_programme_id', side_effect=RuntimeError('boom')):
            self.assertEqual(_meetings(_learner())[0], [])

    def test_review_engine_failure_shows_no_meetings_rather_than_failing(self):
        with patch('coach_api.views.resolve_curriculum_programme_id', return_value='PROG-FINAL'), \
             patch('curriculum_api.review_otjh.planned_meetings', side_effect=RuntimeError('boom')):
            self.assertEqual(_meetings(_learner())[0], [])

    def test_missing_dates_show_no_meetings(self):
        with patch('coach_api.views.resolve_curriculum_programme_id', return_value='PROG-FINAL'), \
             patch('curriculum_api.review_otjh.planned_meetings') as planned:
            self.assertEqual(_meetings(_learner(start=''))[0], [])
            self.assertEqual(_meetings(_learner(end=''))[0], [])
            # An unparseable date is not a window either.
            self.assertEqual(_meetings(_learner(start='not a date'))[0], [])
        planned.assert_not_called()

    def test_blank_programme_shows_no_meetings(self):
        with patch('curriculum_api.review_otjh.planned_meetings') as planned:
            self.assertEqual(_meetings(_learner(programme=''))[0], [])
        planned.assert_not_called()

    # ------------------------------------------------- why the table is empty

    def test_empty_reasons_say_which_thing_to_fix(self):
        """The reason drives the empty state's wording, so each distinct cause
        has to survive as its own code -- a single generic "empty" would have
        left a half-configured programme looking like a broken feature."""
        with patch('coach_api.views.resolve_curriculum_programme_id', return_value=None):
            self.assertEqual(_meetings(_learner())[1], 'no-programme')

        with patch('coach_api.views.resolve_curriculum_programme_id', side_effect=RuntimeError('boom')):
            self.assertEqual(_meetings(_learner())[1], 'unavailable')

        with patch('coach_api.views.resolve_curriculum_programme_id', return_value='PROG-FINAL'):
            self.assertEqual(_meetings(_learner(start=''))[1], 'no-dates')

            with patch('curriculum_api.review_otjh.planned_meetings', side_effect=RuntimeError('boom')):
                self.assertEqual(_meetings(_learner())[1], 'unavailable')

            # The real-world case: templates exist but none carries hours with
            # countsTowardsOtjh ticked.
            with patch('curriculum_api.review_otjh.planned_meetings', return_value=[]), \
                 patch('curriculum_api.review_otjh.otjh_template_rows', return_value=[]):
                self.assertEqual(_meetings(_learner())[1], 'no-otjh-reviews')

            # Hours ARE configured, so the learner's status is what excluded
            # them -- a different fix, so a different message.
            with patch('curriculum_api.review_otjh.planned_meetings', return_value=[]), \
                 patch('curriculum_api.review_otjh.otjh_template_rows', return_value=[{'id': 'REV-1'}]):
                self.assertEqual(_meetings(_learner(status='Paused'))[1], 'not-eligible')

    # ------------------------------------------------------------- arithmetic

    def test_totals_keep_module_and_meeting_hours_separable(self):
        """The screenshot's 102h of modules, plus a 30h review schedule."""
        totals = _totals([{'hours': 2}, {'hours': 78}, {'hours': 22}, {'hours': 0}], [MEETING])
        self.assertEqual(totals['moduleCount'], 4)
        self.assertEqual(totals['moduleHours'], 102.0)
        self.assertEqual(totals['meetingCount'], 1)
        self.assertEqual(totals['meetingHours'], 30.0)
        self.assertEqual(totals['totalHours'], 132.0)

    def test_totals_without_meetings_are_unchanged(self):
        totals = _totals([{'hours': 2}, {'hours': 100}])
        self.assertEqual(totals['moduleHours'], 102.0)
        self.assertEqual(totals['meetingHours'], 0)
        self.assertEqual(totals['totalHours'], 102.0)

    def test_parse_day_accepts_the_formats_created_users_actually_holds(self):
        self.assertEqual(_parse_day('2026-08-03'), date(2026, 8, 3))
        self.assertEqual(_parse_day('03/08/2026'), date(2026, 8, 3))
        self.assertEqual(_parse_day(date(2026, 8, 3)), date(2026, 8, 3))
        self.assertIsNone(_parse_day(''))
        self.assertIsNone(_parse_day(None))
        self.assertIsNone(_parse_day('not a date'))
