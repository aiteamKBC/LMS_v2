"""Phase 4 counting and persisted write/read regressions on isolated SQLite."""
import json
from datetime import date, datetime, timedelta, timezone as utc
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch
from contextlib import nullcontext
from django.test import SimpleTestCase, TestCase, RequestFactory
from .attendance_rules import attendance_outcome, canonical_status
from .attendance_lectures import attendance_read_contract, _merge_register_duplicates
from .tests_attendance_lectures import register_row
from coach_api import bulk_attendance as bulk

NOW = datetime(2026, 9, 20, 12, tzinfo=utc.utc)

class AttendanceRulesTests(SimpleTestCase):
    def test_unmarked_and_non_outcomes_are_excluded(self):
        for status in ('pending', 'unmarked', 'upcoming', 'in_progress', 'cancelled', 'deleted', 'failed', 'superseded'):
            with self.subTest(status=status):
                self.assertFalse(attendance_outcome(register_row(attendance_status=status), NOW)[1])

    def test_future_and_active_evidence_is_excluded(self):
        for start, end, expected in ((NOW + timedelta(hours=1), NOW + timedelta(hours=2), 'upcoming'),
                                     (NOW - timedelta(hours=1), NOW + timedelta(hours=1), 'in_progress')):
            self.assertEqual(attendance_outcome(register_row(attendance_status='present', scheduled_start=start,
                scheduled_end=end), NOW), (expected, False))

    def test_recovered_absence_credits_present(self):
        self.assertEqual(attendance_outcome(register_row(effective_attendance=1,
            effective_attendance_status='made_up'), NOW), ('present', True))

    def test_canonical_vocabulary(self):
        for value in ('late', 'attended', 'completed', 'made_up'):
            self.assertEqual(canonical_status(value), 'present')
        self.assertEqual(canonical_status('missed'), 'absent')
        self.assertEqual(canonical_status('pending'), 'unmarked')

    def test_deterministic_legacy_mirror_never_overrides_occurrence(self):
        native = register_row(source='microsoft-teams', session_id='a', attendance_status='absent')
        legacy = register_row(attendance_status='present')
        self.assertEqual(_merge_register_duplicates([legacy, native]), [native])

    def test_ambiguous_same_day_matches_remain_separate_and_exposed(self):
        rows = [register_row(attendance_status='present'),
                register_row(source='microsoft-teams', session_id='a'),
                register_row(source='microsoft-teams', session_id='b')]
        result = _merge_register_duplicates(rows)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]['legacy_ambiguity'], ['teams:a', 'teams:b'])
        self.assertNotIn('legacy_ambiguity', rows[0])

    def test_unmarked_with_verified_catchup_becomes_counted(self):
        from .attendance_lectures import _apply_completed_catchups
        row = register_row(source='microsoft-teams', session_id='occ', attendance_status='unmarked')
        with patch('learner_api.attendance_lectures._completed_catchup_occurrences', return_value={'occ'}):
            recovered = _apply_completed_catchups([row], 901)[0]
        self.assertEqual(attendance_outcome(recovered, NOW), ('present', True))
        self.assertEqual(recovered['attendance_status'], 'unmarked')

    def test_multiple_legacy_candidates_for_one_occurrence_are_ambiguous(self):
        rows = [register_row(session_id='legacy-a'), register_row(session_id='legacy-b'),
                register_row(source='microsoft-teams', session_id='occ')]
        result = _merge_register_duplicates(rows)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]['legacy_ambiguity'], ['teams:occ'])

class AttendanceWriteReadTests(TestCase):
    def setUp(self):
        self.source = SimpleNamespace(id=901, email='synthetic@example.test')
        self.profile = SimpleNamespace(id=42, _caseload_source=self.source)
        self.schedule = [register_row(source='microsoft-teams', session_id='occ', attendance_status='pending',
            scheduled_start=NOW-timedelta(days=1, hours=2), scheduled_end=NOW-timedelta(days=1),
            session_date=date(2026, 9, 19))]
        for target, kwargs in (
            ('learner_api.attendance_lectures.timezone.now', {'return_value': NOW}),
            ('learner_api.attendance_lectures.read_native_occurrences', {'side_effect': lambda *a, **k: [dict(r) for r in self.schedule]}),
            ('learner_api.attendance_lectures.combined_attendance_rows', {'return_value': []}),
            ('learner_api.attendance_confirmation.read_confirmations', {'return_value': {}}),
            ('learner_api.attendance_lectures._apply_completed_catchups', {'side_effect': lambda rows, _: rows}),
            ('coach_api.models.CoachAbsenceReport.objects', {}),
        ):
            mock = patch(target, **kwargs).start()
            if 'AbsenceReport' in target:
                mock.filter.return_value.order_by.return_value = []
        self.addCleanup(patch.stopall)

    def read(self):
        return attendance_read_contract(self.source, learner_profile_id=42)

    def bulk_request(self, records=None, occurrence='occ'):
        payload = {'programmeId': 'p', 'groupId': 'g', 'sessionOccurrenceId': occurrence}
        factory = RequestFactory()
        if records is None:
            request = factory.get('/', payload)
        else:
            request = factory.post('/', json.dumps({**payload, 'records': records}), content_type='application/json')
        with patch.object(bulk, 'context_profiles', return_value={'42': self.profile}), \
             patch.object(bulk, 'delivery_occurrences', return_value=[(object(), object())]), \
             patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test'), \
             patch('coach_api.views.is_coach_view_as', return_value=False), \
             patch.object(bulk.transaction, 'atomic', side_effect=lambda **kwargs: nullcontext()):
            return unwrap(bulk.coach_bulk_attendance)(request)

    def loaded_record(self, status='present'):
        response = self.bulk_request()
        self.assertEqual(response.status_code, 200)
        row = json.loads(response.content)['learners'][0]
        return {key: row[key] for key in ('learnerId', 'version')} | {'status': status}

    def test_fresh_bulk_version_survives_read_calculation_and_saves_canonical_present(self):
        from .attendance import combined_attendance_rows
        from coach_api.views import canonical_attendance_detail_rows
        self.schedule[0]['attendance_status'] = 'absent'
        reads = 0

        def evidence(**kwargs):
            nonlocal reads
            reads += 1
            return [{**self.schedule[0], 'enrolment_id': 901,
                     'calculated_at': NOW + timedelta(microseconds=reads)}]

        # Exercise the real combined reader: verified Teams reads carry a new
        # calculated_at even when the underlying attendance is unchanged.
        with patch('learner_api.attendance_lectures.combined_attendance_rows', side_effect=combined_attendance_rows), \
             patch('learner_api.attendance.kbc_attendance_rows', side_effect=lambda _: []), \
             patch('learner_api.attendance.fetch_verified_teams_attendance_rows', side_effect=evidence):
            record = self.loaded_record()
            self.assertIn('calculated_at', bulk.current_row(self.profile, 'occ')[0])
            self.assertEqual(json.loads(self.bulk_request().content)['learners'][0]['status'], 'absent')
            response = self.bulk_request([record])
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(json.loads(self.bulk_request().content)['learners'][0]['status'], 'present')
            _, history = canonical_attendance_detail_rows(self.source, learner_profile_id=42)
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]['effectiveStatus'], 'present')
            self.assertFalse(any(row['effectiveStatus'] == 'absent' for row in history))
            self.assertGreater(reads, 1)

    def test_real_concurrent_correction_returns_409_and_identical_retry_is_noop(self):
        from coach_api.models import CoachAttendanceSourceAdjustment
        record = self.loaded_record()
        CoachAttendanceSourceAdjustment.objects.create(learner_id=42, source='microsoft-teams',
            source_id='occ', status='absent', owner_email='coach@example.test', updated_by='coach@example.test')
        self.assertEqual(self.bulk_request([record]).status_code, 409)
        fresh = self.loaded_record()
        self.assertEqual(self.bulk_request([fresh]).status_code, 200)
        adjustment = CoachAttendanceSourceAdjustment.objects.get(learner_id=42, source_id='occ')
        revision = adjustment.updated_at
        self.assertEqual(self.bulk_request([fresh]).status_code, 200)
        adjustment.refresh_from_db()
        self.assertEqual(adjustment.updated_at, revision)
        self.assertEqual(CoachAttendanceSourceAdjustment.objects.count(), 1)

    def test_other_learner_or_occurrence_and_display_metadata_do_not_stale_version(self):
        from coach_api.models import CoachAttendanceSourceAdjustment
        for learner, occurrence in ((43, 'occ'), (42, 'another-occ')):
            with self.subTest(learner=learner, occurrence=occurrence):
                record = self.loaded_record()
                CoachAttendanceSourceAdjustment.objects.create(learner_id=learner, source='microsoft-teams',
                    source_id=occurrence, status='absent', owner_email='coach@example.test', updated_by='coach@example.test')
                self.schedule[0].update(updated_at=NOW, session_title='New display title', legacy_ambiguity=['other'])
                self.assertEqual(record['version'], self.loaded_record()['version'])
                self.assertEqual(self.bulk_request([record]).status_code, 200)

    def test_selected_occurrence_source_attendance_change_conflicts(self):
        self.schedule[0]['attendance_status'] = 'absent'
        record = self.loaded_record(status='absent')
        self.schedule[0]['attendance_status'] = 'present'
        self.assertEqual(self.bulk_request([record]).status_code, 409)

    def test_correction_metadata_timestamp_does_not_stale_attendance_state(self):
        from coach_api.models import CoachAttendanceSourceAdjustment
        correction = CoachAttendanceSourceAdjustment.objects.create(learner_id=42, source='microsoft-teams',
            source_id='occ', status='absent', owner_email='coach@example.test', updated_by='coach@example.test')
        record = self.loaded_record()
        CoachAttendanceSourceAdjustment.objects.filter(pk=correction.pk).update(
            session_title='Updated title', updated_at=NOW + timedelta(hours=1))
        self.assertEqual(record['version'], self.loaded_record()['version'])
        self.assertEqual(self.bulk_request([record]).status_code, 200)

    def test_bulk_write_then_bulk_detail_summary_and_recent_agree(self):
        initial = self.read()
        self.assertEqual(initial['history'][0]['status'], 'unmarked')
        self.assertEqual(initial['summary']['totalCounted'], 0)
        self.assertIsNone(initial['summary']['attendanceRate'])
        self.assertEqual(initial['recentAttendance'], [])
        for status in ('present', 'absent'):
            _, _, token = bulk.current_row(self.profile, 'occ')
            bulk.write_records({'42': self.profile}, 'occ',
                [{'learnerId': '42', 'status': status, 'version': token}], 'coach@example.test')
            contract = self.read()
            from coach_api.views import canonical_attendance_detail_rows
            summary, history = canonical_attendance_detail_rows(self.source, learner_profile_id=42)
            self.assertEqual(history[0]['status'], status)
            self.assertEqual(contract['recentAttendance'][0]['status'], status)
            self.assertEqual(summary, contract['summary'])
            self.assertEqual(summary['attendanceRate'], 100 if status == 'present' else 0)
            request = RequestFactory().get('/', {'programmeId': 'p', 'groupId': 'g', 'sessionOccurrenceId': 'occ'})
            with patch.object(bulk, 'context_profiles', return_value={'42': self.profile}), \
                 patch.object(bulk, 'delivery_occurrences', return_value=[(object(), object())]), \
                 patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test'):
                payload = json.loads(unwrap(bulk.coach_bulk_attendance)(request).content)
            self.assertEqual(payload['learners'][0]['status'], status)

    def test_source_absence_bulk_correction_has_one_effective_occurrence(self):
        from coach_api.models import CoachAttendanceSourceAdjustment, CoachAbsenceReport
        from .attendance_lectures import report_id
        original = {**self.schedule[0], 'learner_id': 901, 'attendance_status': 'absent',
                    'occurrence_id': 'occ', 'session_id': 'source-evidence-id'}
        # An explicitly linked source mirror has stale display metadata. Its
        # identity, rather than date/title matching, must suppress it.
        mirror = {**original, 'source': 'kbc-attendance', 'session_id': 'legacy-key',
                  'session_date': date(2026, 9, 18), 'module_title': 'Old title'}
        report = SimpleNamespace(id=71, attendance_id=report_id({**original, 'session_id': 'occ'}),
                                 status='approved', evidence_image_url='synthetic-evidence')
        CoachAbsenceReport.objects.filter.return_value.order_by.return_value = [report]
        with patch('learner_api.attendance_lectures.combined_attendance_rows', return_value=[mirror, original]):
            initial = self.read()
            self.assertEqual(len(initial['history']), 1)
            self.assertEqual(initial['history'][0]['status'], 'absent')
            _, _, version = bulk.current_row(self.profile, 'occ')
            records = [{'learnerId': '42', 'status': 'present', 'version': version}]
            bulk.write_records({'42': self.profile}, 'occ', records, 'coach@example.test')
            bulk.write_records({'42': self.profile}, 'occ', records, 'coach@example.test')
            contract = self.read()
            self.assertEqual(len(contract['history']), 1)
            row = contract['history'][0]
            self.assertEqual((row['sourceId'], row['rawStatus'], row['effectiveStatus'], row['status']),
                             ('occ', 'absent', 'present', 'present'))
            self.assertEqual([r['status'] for r in contract['recentAttendance']], ['present'])
            self.assertEqual((contract['summary']['present'], contract['summary']['absent'],
                              contract['summary']['totalCounted'], contract['summary']['attendanceRate']),
                             (1, 0, 1, 100))
            self.assertEqual(row['absenceReport']['id'], '71')
            self.assertEqual(CoachAttendanceSourceAdjustment.objects.count(), 1)
            from coach_api.views import canonical_attendance_detail_rows
            self.assertEqual(len(canonical_attendance_detail_rows(self.source, learner_profile_id=42)[1]), 1)
            request = RequestFactory().get('/', {'programmeId': 'p', 'groupId': 'g', 'sessionOccurrenceId': 'occ'})
            with patch.object(bulk, 'context_profiles', return_value={'42': self.profile}), \
                 patch.object(bulk, 'delivery_occurrences', return_value=[(object(), object())]), \
                 patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test'):
                payload = json.loads(unwrap(bulk.coach_bulk_attendance)(request).content)
            self.assertEqual(len(payload['learners']), 1)
            self.assertEqual(payload['learners'][0]['status'], 'present')
            # Reverse correction keeps the same source evidence and identity.
            _, _, version = bulk.current_row(self.profile, 'occ')
            bulk.write_records({'42': self.profile}, 'occ',
                [{'learnerId': '42', 'status': 'absent', 'version': version}], 'coach@example.test')
            contract = self.read()
            self.assertEqual(len(contract['history']), 1)
            self.assertEqual(contract['history'][0]['effectiveStatus'], 'absent')
            self.assertEqual(contract['summary']['totalCounted'], 1)
            self.assertEqual(contract['summary']['attendanceRate'], 0)
            self.assertEqual(original['attendance_status'], 'absent')

    def test_present_source_to_absent_and_same_day_occurrence_remain_separate(self):
        original = {**self.schedule[0], 'learner_id': 901, 'attendance_status': 'present'}
        self.schedule.append({**original, 'session_id': 'other'})
        with patch('learner_api.attendance_lectures.combined_attendance_rows', return_value=[original]):
            _, _, version = bulk.current_row(self.profile, 'occ')
            bulk.write_records({'42': self.profile}, 'occ',
                [{'learnerId': '42', 'status': 'absent', 'version': version}], 'coach@example.test')
            contract = self.read()
        self.assertEqual(len(contract['history']), 2)
        row = next(row for row in contract['history'] if row['sourceId'] == 'occ')
        self.assertEqual((row['rawStatus'], row['effectiveStatus'], row['status']), ('present', 'absent', 'absent'))
        self.assertEqual(len(contract['recentAttendance']), 2)
        self.assertEqual(contract['summary']['totalCounted'], 2)
        self.assertEqual(contract['summary']['attendanceRate'], 50)

    def test_duplicate_source_identity_ignores_date_but_not_other_occurrences(self):
        rows = [register_row(learner_id=901, session_id='a'),
                register_row(learner_id=901, session_id='a', session_date=date(2026, 9, 2)),
                register_row(learner_id=901, session_id='b'),
                register_row(learner_id=902, session_id='a')]
        self.assertEqual(len(_merge_register_duplicates(rows)), 3)

    def test_absent_to_present_preserves_report_identity_status_and_evidence(self):
        from coach_api.models import CoachAbsenceReport
        from .attendance_lectures import report_id
        report = SimpleNamespace(id=71, attendance_id=report_id(self.schedule[0]),
            status='approved', evidence_image_url='synthetic-evidence-reference')
        reports = CoachAbsenceReport.objects
        reports.filter.return_value.order_by.return_value = [report]
        for status in ('absent', 'present'):
            _, _, version = bulk.current_row(self.profile, 'occ')
            bulk.write_records({'42': self.profile}, 'occ',
                [{'learnerId': '42', 'status': status, 'version': version}], 'coach@example.test')
            row = self.read()['history'][0]
            self.assertEqual(row['status'], status)
            self.assertEqual(row['absenceReport'], {'id': '71', 'status': 'approved',
                'url': 'synthetic-evidence-reference'})
        reports.create.assert_not_called()
        reports.update_or_create.assert_not_called()
        reports.filter.return_value.update.assert_not_called()
        reports.filter.return_value.delete.assert_not_called()

    def test_denominator_excludes_unmarked_and_future_manual(self):
        from coach_api.models import CoachManualAttendance
        for day, status in ((date(2026, 9, 18), 'present'), (date(2026, 9, 18), 'absent'), (date(2026, 9, 21), 'present')):
            CoachManualAttendance.objects.create(learner_id=42, owner_email='coach@example.test', session_date=day,
                module_name='Module', session_title=status, status=status)
        summary = self.read()['summary']
        self.assertEqual((summary['present'], summary['absent'], summary['totalCounted'], summary['attendanceRate']), (1, 1, 2, 50))

    def test_manual_only_learner_still_uses_canonical_summary(self):
        self.schedule.clear()
        from coach_api.models import CoachManualAttendance
        CoachManualAttendance.objects.create(learner_id=42, session_date=date(2026, 9, 18),
            module_name='Module', session_title='Manual only', status='present')
        self.assertEqual(self.read()['summary']['present'], 1)

    def test_duplicate_manual_retry_preserves_existing_records_and_totals(self):
        from coach_api.views import coach_manual_attendance
        from coach_api.models import CoachManualAttendance
        payload = {'learnerId': '42', 'date': '2026-09-18', 'module': 'Module', 'sessionTitle': 'Lecture', 'status': 'present'}
        with patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test'), \
             patch('coach_api.views.is_coach_view_as', return_value=False), \
             patch('coach_api.views._manual_attendance_learner', return_value=(self.profile, {'id': '42', 'name': 'Synthetic'})):
            for expected in (201, 200):
                request = RequestFactory().post('/', json.dumps(payload), content_type='application/json')
                self.assertEqual(unwrap(coach_manual_attendance)(request).status_code, expected)
        self.assertEqual(CoachManualAttendance.objects.count(), 1)
        self.assertEqual(self.read()['summary']['totalCounted'], 1)
