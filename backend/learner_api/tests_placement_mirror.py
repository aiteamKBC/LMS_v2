"""Placing a learner has to reach their permanent profile, not just the record.

Where a learner sits is stored twice: on the enrolment row staff edit, and on
the "Learner"."learners" mirror that the learner's workspace, the coach tools
and every report actually read. sync_active_user copies it across, but only at
the moment a learner becomes Active — so a placement set in Delivery, or a move
between groups afterwards, left the mirror behind. See mirror_learner_placement.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .active_users import (
    mirror_learner_placement,
    mirror_placement_to_enrolment,
    stamp_cohort_window,
)

WINDOW = (date(2026, 9, 1), date(2027, 6, 30))


def _source(programme='Test fouda', cohort='fouda cohort', group='Fouda group 1'):
    return SimpleNamespace(pk=91, programme=programme, cohort=cohort, group=group)


def _profile(**kwargs):
    fields = {
        'programme': '',
        'programme_id': '',
        'cohort': '',
        'group_name': '',
        'start_date': None,
        'end_date': None,
        'gateway_review_date': None,
        'updated_at': None,
    }
    fields.update(kwargs)
    return SimpleNamespace(id=248, save=Mock(), **fields)


class MirrorLearnerPlacementTests(SimpleTestCase):
    def _mirror(self, source, profile, programme_id='PROG-1', window=WINDOW):
        with patch('learner_api.active_users.learner_profile_for_source', return_value=profile), \
                patch('learner_api.active_users.cohort_dates', return_value=window), \
                patch('learner_api.active_users._resolve_linkable_programme_id',
                      return_value=programme_id):
            return mirror_learner_placement(source)

    def test_the_placement_is_written_to_the_profile(self):
        profile = _profile()

        result = self._mirror(_source(), profile)

        self.assertIs(result, profile)
        self.assertEqual(profile.programme, 'Test fouda')
        self.assertEqual(profile.cohort, 'fouda cohort')
        self.assertEqual(profile.group_name, 'Fouda group 1')
        # Saved with exactly the fields that moved, plus the timestamp.
        saved = profile.save.call_args.kwargs['update_fields']
        self.assertIn('programme', saved)
        self.assertIn('group_name', saved)
        self.assertIn('updated_at', saved)

    def test_the_cohorts_delivery_window_follows_the_placement(self):
        profile = _profile()

        self._mirror(_source(), profile)

        self.assertEqual(profile.start_date, WINDOW[0])
        self.assertEqual(profile.end_date, WINDOW[1])
        # 90 days before the end, the same rule sync_active_user applies.
        self.assertEqual(profile.gateway_review_date, date(2027, 4, 1))

    def test_an_unresolvable_programme_name_leaves_the_link_alone(self):
        # Two programmes sharing a name resolve to '': attaching the learner to
        # whichever was updated last would be a guess.
        profile = _profile(programme_id='PROG-ORIGINAL')

        self._mirror(_source(), profile, programme_id='')

        self.assertEqual(profile.programme_id, 'PROG-ORIGINAL')
        self.assertEqual(profile.programme, 'Test fouda')

    def test_a_profile_already_in_step_is_not_written_to(self):
        profile = _profile(
            programme='Test fouda', programme_id='PROG-1', cohort='fouda cohort',
            group_name='Fouda group 1', start_date=WINDOW[0], end_date=WINDOW[1],
            gateway_review_date=date(2027, 4, 1),
        )

        self.assertIsNone(self._mirror(_source(), profile))
        profile.save.assert_not_called()

    def test_clearing_a_placement_clears_the_mirror_too(self):
        profile = _profile(programme='Test fouda', cohort='fouda cohort', group_name='Fouda group 1')

        self._mirror(_source(programme='', cohort='', group=''), profile, window=(None, None))

        self.assertEqual((profile.programme, profile.cohort, profile.group_name), ('', '', ''))
        self.assertIsNone(profile.gateway_review_date)

    def test_a_learner_with_no_profile_yet_is_left_alone(self):
        # Activation creates it from the record as it stands then.
        with patch('learner_api.active_users.learner_profile_for_source', return_value=None):
            self.assertIsNone(mirror_learner_placement(_source()))

    def test_a_mirror_failure_never_fails_the_edit_that_triggered_it(self):
        from django.db import DatabaseError

        profile = _profile()
        profile.save.side_effect = DatabaseError('mirror table is gone')

        self.assertIsNone(self._mirror(_source(), profile))


# The cohort's own window: start, practical end, and the apprenticeship end that
# adds the EPA period on top.
COHORT_WINDOW = (date(2026, 8, 5), date(2027, 11, 4), date(2028, 2, 4))


def _learner(**kwargs):
    fields = {
        'programme': 'Test fouda',
        'cohort': 'fouda cohort',
        'group': 'Fouda group 1',
        'start_date': None,
        'end_date': None,
        'practical_period_end_date': '',
        'apprenticeship_end_date': '',
    }
    fields.update(kwargs)
    return SimpleNamespace(pk=91, save=Mock(), **fields)


class StampCohortWindowTests(SimpleTestCase):
    """A learner placed after they were created still needs the cohort's dates.

    Progression reads the start date to decide when a learner becomes Active, so
    without this a placed learner with a saved plan waits in Delivery for ever.
    """

    def _stamp(self, learner, window=COHORT_WINDOW):
        with patch('learner_api.active_users.cohort_delivery_window', return_value=window):
            return stamp_cohort_window(learner)

    def test_an_undated_learner_takes_the_cohorts_window(self):
        learner = _learner()

        written = self._stamp(learner)

        self.assertEqual(learner.start_date, date(2026, 8, 5))
        self.assertEqual(learner.end_date, date(2027, 11, 4))
        # Text columns on this table, written as ISO strings like enrolment does.
        self.assertEqual(learner.practical_period_end_date, '2027-11-04')
        self.assertEqual(learner.apprenticeship_end_date, '2028-02-04')
        self.assertEqual(set(written), set(learner.save.call_args.kwargs['update_fields']))

    def test_dates_the_learner_already_has_are_never_overwritten(self):
        # Either stamped from a cohort already or set deliberately for this
        # learner; neither is this function's to rewrite.
        learner = _learner(start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))

        written = self._stamp(learner)

        self.assertEqual(learner.start_date, date(2026, 1, 1))
        self.assertEqual(learner.end_date, date(2026, 12, 31))
        self.assertNotIn('start_date', written)

    def test_a_learner_with_no_cohort_is_left_alone(self):
        learner = _learner(cohort='')

        self.assertEqual(self._stamp(learner), {})
        learner.save.assert_not_called()

    def test_a_cohort_with_no_window_of_its_own_stamps_nothing(self):
        learner = _learner()

        self.assertEqual(self._stamp(learner, window=(None, None, None)), {})
        learner.save.assert_not_called()

    def test_a_stamp_failure_never_fails_the_edit_that_triggered_it(self):
        from django.db import DatabaseError

        learner = _learner()
        learner.save.side_effect = DatabaseError('learner table is gone')

        self.assertEqual(self._stamp(learner), {})


class MirrorPlacementToEnrolmentTests(SimpleTestCase):
    """The commercial delivery screens edit the profile; the enrolment row is
    what enrolment views, the documents and progression read, so it has to
    follow — with the cohort's dates, not just the names."""

    def _mirror(self, profile, learner, stamped=None):
        model = Mock()
        model.all_learners.filter.return_value.first.return_value = learner
        with patch('learner_api.active_users.EnrolmentUser', model),                 patch('learner_api.active_users.stamp_cohort_window',
                      return_value=stamped if stamped is not None else {}) as stamp:
            result = mirror_placement_to_enrolment(profile)
        return result, stamp

    def test_the_placement_reaches_the_enrolment_row(self):
        profile = SimpleNamespace(
            pk=248, enrolment_id=101, programme='Test Aya', cohort='Aya Cohort',
            group_name='Aya Group',
        )
        learner = _learner(programme='', cohort='', group='')

        result, stamp = self._mirror(profile, learner)

        self.assertIs(result, learner)
        self.assertEqual(
            (learner.programme, learner.cohort, learner.group),
            ('Test Aya', 'Aya Cohort', 'Aya Group'),
        )
        # And the window that placement implies, in the same breath.
        stamp.assert_called_once_with(learner)

    def test_a_profile_with_no_enrolment_row_behind_it_is_left_alone(self):
        profile = SimpleNamespace(pk=248, enrolment_id=None, programme='X', cohort='Y', group_name='Z')

        with patch('learner_api.active_users.EnrolmentUser') as model:
            self.assertIsNone(mirror_placement_to_enrolment(profile))
        model.all_learners.filter.assert_not_called()

    def test_an_unchanged_placement_still_stamps_a_missing_window(self):
        # The names already agree; the dates are what was never written.
        profile = SimpleNamespace(
            pk=248, enrolment_id=101, programme='Test fouda', cohort='fouda cohort',
            group_name='Fouda group 1',
        )
        learner = _learner()

        result, _stamp = self._mirror(profile, learner, stamped={'start_date': date(2026, 8, 5)})

        self.assertIs(result, learner)
        learner.save.assert_not_called()

    def test_nothing_to_do_reports_nothing(self):
        profile = SimpleNamespace(
            pk=248, enrolment_id=101, programme='Test fouda', cohort='fouda cohort',
            group_name='Fouda group 1',
        )

        result, _stamp = self._mirror(profile, _learner())

        self.assertIsNone(result)


class CommercialProfileEditTests(SimpleTestCase):
    """The commercial delivery screens edit the profile; everything the platform
    decides from a placement hangs off the enrolment row, so the edit has to
    reach it and then be judged the same way an enrolment edit is."""

    def _edit(self, payload, mirrored=None):
        from .views import _update_profile_from_delivery_payload

        profile = SimpleNamespace(
            pk=248, enrolment_id=101, full_name='Aya', email='aya@example.com',
            phone_number='', programme_status='Delivery', programme='', cohort='',
            group_name='', updated_at=None, save=Mock(),
        )
        with patch('learner_api.views.mirror_placement_to_enrolment',
                   return_value=mirrored) as mirror,                 patch('learner_api.views.advance_learner') as advance:
            _update_profile_from_delivery_payload(profile, payload)
        return profile, mirror, advance

    def test_a_placement_edit_reaches_the_enrolment_row_and_is_re_judged(self):
        learner = _learner()

        profile, mirror, advance = self._edit({'programme': 'Test Aya'}, mirrored=learner)

        self.assertEqual(profile.programme, 'Test Aya')
        mirror.assert_called_once_with(profile)
        advance.assert_called_once_with(learner)

    def test_an_edit_that_touches_no_placement_leaves_the_enrolment_row_alone(self):
        _profile, mirror, advance = self._edit({'username': 'Aya Renamed'})

        mirror.assert_not_called()
        advance.assert_not_called()

    def test_a_profile_with_no_enrolment_row_advances_nobody(self):
        _profile, mirror, advance = self._edit({'cohort': 'Aya Cohort'}, mirrored=None)

        mirror.assert_called_once()
        advance.assert_not_called()
