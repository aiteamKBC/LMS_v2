"""Slice 03b-1: student-activity reports the official programme total in journal mode.

Database and network are prohibited. The real ``source_subjects`` journal
expression, ``official_planned_hours`` and ``learner_journal_view`` run; only
their data readers (courses, catalogue, ledger, targets, review overlays) are
replaced with synthetic values.
"""
import json
from contextlib import ExitStack, contextmanager
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import canonical_learning, journal_sources, official_hours, student_activity

ENROLMENT_ID = 201
REVIEW = 20                                  # review planned hours
MONTHLY = {'2026-01': 200.0, '2026-02': 200.0}  # Training Plan monthly targets: 400
ACTUAL_SECONDS = 120 * 3600                  # 120 accepted hours
SUBJECTS = [{'id': 'legacy:9', 'name': 'Legacy course', 'module_id': None}]
ITEMS = [{'activity_id': 'a1', 'group_id': 9, 'completed': True, 'planned': 37.5,
          'planned_hours_mapped': True, 'actual': 2.0, 'hours_mapped': True}]


def owner(official, kind='apprenticeship'):
    """A verified canonical owner as ``canonical_learning.profile`` returns it."""
    return {'id': 101, 'enrolment_id': ENROLMENT_ID, 'aptem_id': 7101, 'name': 'Synthetic Learner',
            'email': 'learner@example.test', 'account_record_id': ENROLMENT_ID,
            'account_email': 'learner@example.test', 'account_aptem_id': '7101',
            'programme_planned_hours': official, 'learner_type': kind,
            # Never consulted for the official total.
            'Planned_hours': '576'}


def summarize(items):
    return {'activities': items, 'planned_total': 37.5, 'planned_mapped_count': 1}


@contextmanager
def readers(review=REVIEW):
    """Replace every data reader of source_subjects; keep its own logic."""
    with ExitStack() as stack:
        calls = SimpleNamespace(
            query=stack.enter_context(patch.object(canonical_learning, 'query', return_value=[])),
            profile=stack.enter_context(patch.object(canonical_learning, 'profile')),
            targets=stack.enter_context(patch.object(canonical_learning, 'targets_for', return_value=dict(MONTHLY))),
            reviews=stack.enter_context(patch('coach_api.migrated_otjh.planned_hours_bulk',
                                              return_value={ENROLMENT_ID: review} if review else {})),
            plan=stack.enter_context(patch('learner_api.training_plan_dashboard.plan_planned_hours')),
            selector_query=stack.enter_context(patch.object(official_hours, 'query')),
            target_to_date=stack.enter_context(patch('coach_api.views.apply_otjh_to_date_metrics')),
        )
        stack.enter_context(patch.object(canonical_learning, 'owned_source_courses', return_value=[]))
        stack.enter_context(patch.object(canonical_learning, 'recorded_course_items',
                                         return_value=(list(ITEMS), list(SUBJECTS), {'a1': ['src-1']})))
        stack.enter_context(patch('learner_api.course_catalogue_display.catalogue_display_context',
                                  side_effect=lambda catalogue, placements: catalogue))
        stack.enter_context(patch('learner_api.course_catalogue_display.read_export_placements', return_value={}))
        stack.enter_context(patch.object(canonical_learning, 'counts_as_actual', return_value=True))
        stack.enter_context(patch.object(canonical_learning, 'recorded_seconds', return_value=ACTUAL_SECONDS))
        yield calls


@contextmanager
def journal(enabled):
    token = journal_sources._current.set(enabled)
    try:
        yield
    finally:
        journal_sources._current.reset(token)


RECORDS = [{'ksbs': ['K1'], 'module_ref': 'M1'}]


def read(official, *, journal_mode=True, review=REVIEW, kind='apprenticeship'):
    with readers(review) as calls, journal(journal_mode):
        result = canonical_learning.source_subjects(
            ENROLMENT_ID, summarize, owner=owner(official, kind), records=list(RECORDS), include_ledger=False)
    return result, calls


class JournalOfficialTotalTests(SimpleTestCase):
    def test_1_official_288_is_not_increased_by_review_hours(self):
        result, _ = read(Decimal('288.00'))
        self.assertEqual(result['audit_tp_planned'], 288.0)
        self.assertNotEqual(result['audit_tp_planned'], 308.0)

    def test_2_null_stays_null(self):
        result, _ = read(None)
        self.assertIsNone(result['audit_tp_planned'])

    def test_3_zero_stays_zero_and_does_not_become_review_hours(self):
        result, _ = read(Decimal('0'))
        self.assertEqual(result['audit_tp_planned'], 0.0)
        self.assertIsNotNone(result['audit_tp_planned'])

    def test_4_negative_is_unavailable(self):
        result, _ = read(Decimal('-1'))
        self.assertIsNone(result['audit_tp_planned'])

    def test_5_training_plan_and_enrolment_totals_never_replace_an_unavailable_total(self):
        for official in (None, Decimal('-1'), Decimal('NaN'), 'abc'):
            with self.subTest(official=official):
                result, calls = read(official)
                self.assertIsNone(result['audit_tp_planned'])
                calls.targets.assert_not_called()     # monthly Training Plan (400) not read
                calls.plan.assert_not_called()        # module plan total not read
                self.assertNotIn(result['audit_tp_planned'], (400.0, 420.0, 576.0, 20.0))

    def test_6_review_hours_stay_in_their_own_field(self):
        for official in (Decimal('288'), None, Decimal('0'), Decimal('-1')):
            with self.subTest(official=official):
                result, calls = read(official)
                self.assertEqual(result['review_planned_otjh'], REVIEW)
                calls.reviews.assert_called_once()
        result, _ = read(Decimal('288'), review=0)
        self.assertNotIn('review_planned_otjh', result)   # unchanged presence rule
        self.assertEqual(result['audit_tp_planned'], 288.0)

    def test_7_journal_metrics_and_student_activity_agree(self):
        for official in (Decimal('288'), None, Decimal('0'), Decimal('-1')):
            with self.subTest(official=official):
                with readers() as _calls, journal(True), \
                     patch.object(canonical_learning, 'entries_for', return_value=[]):
                    metrics = canonical_learning.metrics(ENROLMENT_ID, owner=owner(official))
                    activity = canonical_learning.source_subjects(
                        ENROLMENT_ID, summarize, owner=owner(official), records=list(RECORDS), include_ledger=False)
                self.assertEqual(activity['audit_tp_planned'], metrics['otjh']['planned'])

    def test_12_both_learner_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                result, _ = read(Decimal('288'), kind=kind)
                self.assertEqual(result['audit_tp_planned'], 288.0)

    def test_16_invalid_values_are_never_a_successful_figure(self):
        for official in (Decimal('-0.5'), Decimal('Infinity'), True, '', '1_000'):
            with self.subTest(official=official):
                result, _ = read(official)
                self.assertIsNone(result['audit_tp_planned'])

    def test_serialises_as_a_nullable_number(self):
        for official, expected in ((Decimal('288.00'), 288.0), (None, None), (Decimal('0'), 0.0)):
            with self.subTest(official=official):
                result, _ = read(official)
                self.assertEqual(json.loads(json.dumps({'v': result['audit_tp_planned']}))['v'], expected)
                self.assertTrue(result['audit_tp_planned'] is None or isinstance(result['audit_tp_planned'], float))


class UnchangedBehaviourTests(SimpleTestCase):
    def test_8_non_journal_coach_source_is_unchanged(self):
        for official in (Decimal('288'), None, Decimal('0')):
            with self.subTest(official=official):
                result, calls = read(official, journal_mode=False)
                # Monthly targets (400) plus review (20), exactly as before.
                self.assertEqual(result['audit_tp_planned'], 420.0)
                self.assertEqual(result['review_planned_otjh'], REVIEW)
                calls.targets.assert_called_once()
        result, _ = read(Decimal('288'), journal_mode=False, review=0)
        self.assertEqual(result['audit_tp_planned'], 400.0)

    def test_9_activity_planned_total_is_unchanged(self):
        for mode in (True, False):
            with self.subTest(journal=mode):
                result, _ = read(Decimal('288'), journal_mode=mode)
                self.assertEqual(result['planned_total'], 37.5)
                self.assertEqual(result['planned_mapped_count'], 1)

    def test_10_actual_and_historical_projection_is_unchanged(self):
        results = [read(official)[0] for official in (Decimal('288'), None, Decimal('0'))]
        for result in results:
            self.assertEqual(result['audit_lms_actual'], 120.0)
            self.assertEqual(result['recorded_otjh_total'], 120.0)
            self.assertEqual(result['subjects'], SUBJECTS)
            self.assertEqual(result['source_status'], 'historical')
            self.assertEqual(result['module_count'], 1)
        stripped = [{k: v for k, v in r.items() if k != 'audit_tp_planned'} for r in results]
        self.assertTrue(all(s == stripped[0] for s in stripped))

    def test_11_no_target_to_date_or_rag_is_computed(self):
        _result, calls = read(Decimal('288'))
        calls.target_to_date.assert_not_called()
        self.assertFalse({'targetToDate', 'otjhTargetAsOfToday', 'otjhRagStatus'} & set(_result))

    def test_14_no_extra_sql_and_15_no_writes(self):
        from learner_api.models import LearnerProfile
        with patch.object(LearnerProfile, 'save') as save:
            _result, calls = read(Decimal('288'))
        calls.query.assert_not_called()          # no catalogue courses: no catalogue read
        calls.profile.assert_not_called()        # the verified owner is reused, not re-read
        calls.selector_query.assert_not_called() # the single-owner selector reads nothing
        calls.reviews.assert_called_once()       # the existing review read, unchanged
        save.assert_not_called()


class StudentActivityViewTests(SimpleTestCase):
    """The real journal wrapper decides the mode from the account and request."""

    factory = RequestFactory()

    def call(self, account, kind='apprenticeship', pk=ENROLMENT_ID, official=Decimal('288'), **params):
        request = self.factory.get(f'/learner_api/student-activity/{kind}/{pk}/', params)
        request.login_account = account
        # Skip require_GET and the ownership gate; keep learner_journal_view.
        view = student_activity.student_activity.__wrapped__.__wrapped__
        with readers() as calls, ExitStack() as stack:
            calls.profile.return_value = owner(official, kind)
            stack.enter_context(patch('learner_api.case_file_sources.source_for_case_file',
                                      return_value=SimpleNamespace(pk=pk, aptem_id=7101, email='learner@example.test')))
            stack.enter_context(patch.object(canonical_learning, 'entries_for', return_value=list(RECORDS)))
            stack.enter_context(patch('learner_api.replacement_hours.read_replacement_hours', return_value={}))
            stack.enter_context(patch.object(student_activity.subject_store, 'covers_for', return_value={}))
            stack.enter_context(patch.object(student_activity, 'summarize_activities', side_effect=summarize))
            response = view(request, kind=kind, pk=pk)
        return response, json.loads(response.content), calls

    def test_13_learner_and_staff_preview_get_the_official_total(self):
        learner = SimpleNamespace(role='learner', subject_type='learner', subject_id=ENROLMENT_ID)
        staff = SimpleNamespace(role='staff', subject_type='staff', subject_id=3)
        for account in (learner, staff):
            for kind in ('commercial', 'apprenticeship'):
                with self.subTest(role=account.role, kind=kind):
                    response, payload, calls = self.call(account, kind)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(payload['audit_tp_planned'], 288.0)
                    self.assertEqual(payload['review_planned_otjh'], REVIEW)
                    calls.profile.assert_called_once_with(ENROLMENT_ID)

    def test_13_coach_context_keeps_the_non_journal_value(self):
        staff = SimpleNamespace(role='staff', subject_type='staff', subject_id=3)
        _response, payload, _calls = self.call(staff, viewAsCoach='coach@example.test')
        self.assertEqual(payload['audit_tp_planned'], 420.0)

    def test_13_the_ownership_gate_is_still_applied(self):
        from login import permissions
        other_learner = SimpleNamespace(role='learner', subject_type='learner', subject_id=999)
        request = self.factory.get(f'/learner_api/student-activity/apprenticeship/{ENROLMENT_ID}/')
        with patch.object(permissions, 'authenticate_request', return_value=other_learner), \
             patch.object(canonical_learning, 'source_subjects') as reader:
            response = student_activity.student_activity(request, kind='apprenticeship', pk=ENROLMENT_ID)
        self.assertEqual(response.status_code, 404)
        reader.assert_not_called()
        with patch.object(permissions, 'authenticate_request', return_value=None), \
             patch.object(permissions, 'session_unreadable', return_value=False), \
             patch.object(canonical_learning, 'source_subjects') as reader:
            response = student_activity.student_activity(request, kind='apprenticeship', pk=ENROLMENT_ID)
        self.assertEqual(response.status_code, 401)
        reader.assert_not_called()
