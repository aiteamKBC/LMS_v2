"""Offline regressions: synthetic evidence, no Django startup, database or network."""
import json
import sqlite3
import sys
import types
import unittest
from unittest.mock import Mock, patch

import test_session_results_no_db as base
from curriculum_api.attendance_link_policy import apply_reviewed_identities, link_specs, unmatched_roster
from curriculum_api.session_results_policy import session_roster


def record(row='R1', guest='G1', name='Example Guest', occurrence='O'):
    return {'id': row, 'occurrence_id': occurrence, 'email': '', 'display_name': name,
            'role': 'attendee', 'raw_data': {'identity': {'id': guest, 'displayName': name}},
            'intervals': [], 'total_attendance_seconds': 600}


def rule(**changes):
    return {'module_catalogue_id': 'M', 'identity_kind': 'guest_name', 'identity_value': 'example guest',
            'canonical_email': 'a@example.invalid', 'learner_profile_id': 7,
            'display_name': 'Example Guest', 'revision': 1, 'active': True, **changes}


class ReviewedEvidenceTests(unittest.TestCase):
    def test_guest_rule_matches_future_occurrence_even_when_guest_id_changes(self):
        raw = record(guest='NEW-GUEST', occurrence='NEXT')
        mapped = apply_reviewed_identities([raw], rules=[rule()])
        self.assertEqual(mapped[0]['email'], 'a@example.invalid')
        self.assertEqual(raw['email'], '')

    def test_correction_moves_duration_from_old_learner_to_new_learner(self):
        mapped = apply_reviewed_identities([record()], rules=[rule(canonical_email='b@example.invalid', learner_profile_id=8)])
        roster = {row['email']: row for row in session_roster({'a@example.invalid', 'b@example.invalid'}, mapped, complete=True)}
        self.assertEqual((roster['a@example.invalid']['status'], roster['a@example.invalid']['seconds']), ('absent', 0))
        self.assertEqual((roster['b@example.invalid']['status'], roster['b@example.invalid']['seconds']), ('present', 600))

    def test_duplicate_names_block_module_rule_and_remain_separate(self):
        rows = [record(), record('R2', 'G2')]
        mapped = apply_reviewed_identities(rows, rules=[rule()])
        self.assertTrue(all(row['identityReviewRequired'] and not row['email'] for row in mapped))
        unmatched = unmatched_roster(mapped, complete=True)
        self.assertEqual(len(unmatched), 2)
        self.assertTrue(all(row['identityAmbiguous'] for row in unmatched))
        with self.assertRaises(ValueError):
            link_specs(rows, rows)
        self.assertEqual(link_specs(rows[:1], rows), [('record', 'O:R1')])

    def test_explicit_collision_review_counts_only_selected_participant(self):
        rows = [record(), record('R2', 'G2')]
        mapped = apply_reviewed_identities(rows, rules=[rule(), rule(identity_kind='record', identity_value='O:R2', canonical_email='b@example.invalid')])
        self.assertTrue(mapped[0]['identityReviewRequired'])
        self.assertEqual(mapped[1]['email'], 'b@example.invalid')

    def test_reconnects_with_same_identity_are_not_treated_as_two_people(self):
        rows = [record(), record('R2', 'G1')]
        self.assertEqual(link_specs(rows, rows), [('guest_name', 'example guest')])
        mapped = apply_reviewed_identities(rows, rules=[rule()])
        self.assertEqual(session_roster({'a@example.invalid'}, mapped, complete=True)[0]['seconds'], 600)

    def test_unknown_ids_do_not_silently_merge_same_name_rows(self):
        rows = [record(guest=''), record('R2', '')]
        self.assertTrue(all(row['identityReviewRequired'] for row in apply_reviewed_identities(rows, rules=[rule()])))

    def test_revoke_blocks_legacy_row_and_name_fallback(self):
        legacy = [{'occurrence_id': 'O', 'attendance_row_id': 'R1', 'canonical_email': 'a@example.invalid', 'learner_profile_id': 7}]
        mapped = apply_reviewed_identities([record()], legacy_links=legacy, rules=[rule(active=False)])
        self.assertEqual(mapped[0]['email'], '')
        self.assertTrue(mapped[0]['identityReviewRequired'])

    def test_revoke_email_alias_blocks_older_alias(self):
        row = {**record(), 'email': 'guest@example.invalid'}
        old = [{'alias_email': row['email'], 'canonical_email': 'a@example.invalid', 'learner_profile_id': 7}]
        mapped = apply_reviewed_identities([row], aliases=old, rules=[rule(identity_kind='email', identity_value=row['email'], active=False)])
        self.assertEqual(mapped[0]['email'], row['email'])
        self.assertFalse(mapped[0]['identityReviewRequired'])

    def test_no_rules_from_other_module_are_inferred(self):
        self.assertEqual(apply_reviewed_identities([record()])[0]['email'], '')

    def test_different_names_are_never_fuzzy_matched(self):
        self.assertEqual(apply_reviewed_identities([record(name='Example Other')], rules=[rule()])[0]['email'], '')

    def test_guest_short_visit_remains_absent(self):
        mapped = apply_reviewed_identities([{**record(), 'total_attendance_seconds': 38}], rules=[rule()])
        self.assertEqual(session_roster({'a@example.invalid'}, mapped, complete=True)[0]['status'], 'absent')

    def test_incomplete_report_remains_pending(self):
        mapped = apply_reviewed_identities([record()], rules=[rule()])
        self.assertEqual(session_roster({'a@example.invalid'}, mapped, complete=False)[0]['status'], 'pending')


class CorrectionEndpointTests(unittest.TestCase):
    req = base.EndpointTests.req

    def setUp(self):
        base.EndpointTests.setUp(self)
        self.rules = []
        self.raw = [record()]
        self.roster = [{'learner_profile_id': 7, 'learner_email': 'a@example.invalid', 'learner_name': 'Learner A'},
                       {'learner_profile_id': 8, 'learner_email': 'b@example.invalid', 'learner_name': 'Learner B'}]
        def read(sql, params=()):
            if 'JOIN curriculum.live_sessions' in sql:
                return [{'id': 'O', 'module_catalogue_id': 'M'}]
            if 'live_session_learner_attendance' in sql:
                return self.roster
            if 'SELECT * FROM curriculum.live_session_attendance' in sql:
                return self.raw
            return []
        self.ns['read'].side_effect = read
        self.ns['identity_rules'].side_effect = lambda *_args: self.rules
        self.cursor.fetchone.return_value = ('M',)
        self.reporting = types.ModuleType('learner_api.teams_attendance')
        self.reporting.sync_verified_teams_attendance_reporting = Mock(return_value=2)
        modules = patch.dict(sys.modules, {'learner_api.teams_attendance': self.reporting})
        modules.start(); self.addCleanup(modules.stop)

    def submit(self, role='staff', **data):
        request = self.req(role, method='POST')
        request.body = json.dumps({'sourceRecordIds': ['R1'], 'learnerProfileId': 7, **data}).encode()
        return self.ns['link_attendance_alias'](request, 'S', 1)

    def writes(self, table='rules'):
        return [call.args for call in self.cursor.execute.call_args_list
                if f'INSERT INTO curriculum.live_session_attendance_identity_{table}' in call.args[0]]

    def test_link_saves_module_rule_and_history_and_recalculates(self):
        response = self.submit()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['scope'], 'module')
        self.assertEqual(self.writes()[0][1][:5], ['M', 'guest_name', 'example guest', 7, 'a@example.invalid'])
        self.assertEqual(len(self.writes('audit')), 1)
        self.reporting.sync_verified_teams_attendance_reporting.assert_called_once_with(module_refs=['M'])

    def test_correct_link_uses_previous_revision_and_retains_before_snapshot(self):
        self.rules = [rule()]
        response = self.submit(action='change', learnerProfileId=8, expectedRevision=1, expectedLearnerProfileId=7,
                               identityKind='guest_name', identityValue='example guest')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.writes()[0][1][3], 8)
        audit = self.writes('audit')[0][1]
        self.assertEqual(json.loads(audit[-2])['learner_profile_id'], 7)
        self.assertEqual(json.loads(audit[-1])['learner_profile_id'], 8)

    def test_stale_correction_cannot_overwrite_another_staff_decision(self):
        self.rules = [rule(revision=2)]
        response = self.submit(action='change', learnerProfileId=8, expectedRevision=1, expectedLearnerProfileId=7)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(self.writes())
        self.reporting.sync_verified_teams_attendance_reporting.assert_not_called()

    def test_unlink_keeps_revoked_rule_and_audit(self):
        self.rules = [rule()]
        response = self.submit(action='unlink', learnerProfileId=0, expectedRevision=1, expectedLearnerProfileId=7)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.writes()[0][1][-2])
        self.assertEqual(len(self.writes('audit')), 1)

    def test_retry_existing_link_is_idempotent_but_retries_reporting(self):
        self.rules = [rule()]
        self.assertEqual(self.submit().status_code, 200)
        self.assertFalse(self.writes())
        self.reporting.sync_verified_teams_attendance_reporting.assert_called_once()

    def test_learner_employer_and_unauthenticated_cannot_write(self):
        for role in ['learner', 'employer', None]:
            self.assertIn(self.submit(role).status_code, [401, 403])
        self.cursor.execute.assert_not_called()

    def test_foreign_module_and_foreign_learner_are_rejected(self):
        self.assertEqual(self.submit(moduleId='OTHER').status_code, 400)
        self.assertEqual(self.submit(learnerProfileId=999).status_code, 400)
        self.assertFalse(self.writes())

    def test_fabricated_source_id_is_rejected(self):
        self.assertEqual(self.submit(sourceRecordIds=['MISSING']).status_code, 404)
        self.assertFalse(self.writes())

    def test_collision_review_is_session_scoped(self):
        self.raw.append(record('R2', 'G2'))
        self.assertEqual(self.submit()['scope'], 'session')
        self.assertEqual(self.writes()[0][1][:3], ['M', 'record', 'O:R1'])

    def test_reporting_failure_is_explicit_after_link_is_saved(self):
        self.reporting.sync_verified_teams_attendance_reporting.side_effect = RuntimeError('synthetic failure')
        with self.assertLogs('test', level='ERROR'):
            response = self.submit()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['recalculation'], 'failed')
        self.assertEqual(len(self.writes()), 1)

    def test_empty_reporting_refresh_is_not_reported_as_complete(self):
        self.reporting.sync_verified_teams_attendance_reporting.return_value = 0
        self.assertEqual(self.submit()['recalculation'], 'pending')
        self.assertEqual(len(self.writes()), 1)

    def test_collision_can_link_different_learner_and_disables_recurring_guess(self):
        self.rules = [rule()]
        self.raw.append(record('R2', 'G2'))
        response = self.submit(sourceRecordIds=['R2'], learnerProfileId=8)
        self.assertEqual(response.status_code, 200)
        writes = self.writes()
        self.assertEqual(writes[0][1][:5], ['M', 'record', 'O:R2', 8, 'b@example.invalid'])
        self.assertEqual(writes[1][1][:3], ['M', 'guest_name', 'example guest'])
        self.assertFalse(writes[1][1][-2])
        self.assertEqual(len(self.writes('audit')), 2)

    def test_shared_module_register_uses_reviewed_evidence_instead_of_stale_absence(self):
        self.rules = [rule(canonical_email='b@example.invalid', learner_profile_id=8)]
        self.ns['apply_recovery'] = lambda rows: None
        self.ns['replaced_module_register_rows'].return_value = [
            {**learner, 'source_occurrence_id': 'O', 'occurrence_id': None,
             'attendance_status': 'present' if learner['learner_profile_id'] == 7 else 'absent',
             'attended_seconds': 600 if learner['learner_profile_id'] == 7 else 0}
            for learner in self.roster]
        self.ns['read'].side_effect = [
            [{'id': 'O', 'session_number': 1, 'status': 'completed', 'attendance_report_id': 'REPORT',
              'actual_end': '2026-10-01T10:00Z', 'scheduled_start': '2026-10-01T09:00Z',
              'scheduled_end': '2026-10-01T10:00Z'}], self.raw, [], [], [],
        ]
        results = self.ns['result_rows']({'id': 'S', 'module_catalogue_id': 'SOURCE'}, module_catalogue_id='M')
        people = {row['email']: row for row in results[0]['attendance']}
        self.assertEqual((people['a@example.invalid']['status'], people['a@example.invalid']['seconds']), ('absent', 0))
        self.assertEqual((people['b@example.invalid']['status'], people['b@example.invalid']['seconds']), ('present', 600))
        self.assertEqual(results[0]['unmatchedAttendance'], [])
        self.assertEqual(results[0]['linkedIdentities'][0]['learnerProfileId'], 8)


class MigrationHistoryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        connection = self.db
        class Cursor:
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                pass
            def execute(self, sql, params=()):
                return connection.execute(sql.replace('curriculum.', '').replace('%s', '?'), params)
        self.cursor = Cursor()
        namespace = {'json': json}
        base.functions(base.ROOT / 'migrations/0071_attendance_identity_rules.py', {'provision'}, namespace)
        namespace['provision'](None, types.SimpleNamespace(connection=types.SimpleNamespace(vendor='sqlite', cursor=Cursor)))
        self.db.commit()
        base.functions(base.ROOT / 'attendance_link_store.py', {'save_rule'}, namespace)
        self.save = namespace['save_rule']

    def test_migration_and_corrections_keep_immutable_before_after_history(self):
        with self.db:
            before = self.save(self.cursor, 'M', ('guest_name', 'example guest'), None, rule(), 'synthetic-staff')
        with self.db:
            self.save(self.cursor, 'M', ('guest_name', 'example guest'), before,
                      rule(learner_profile_id=8, canonical_email='b@example.invalid'), 'synthetic-staff')
        self.assertEqual(self.db.execute('SELECT learner_profile_id,revision FROM live_session_attendance_identity_rules').fetchone(), (8, 2))
        audits = self.db.execute('SELECT before_snapshot,after_snapshot FROM live_session_attendance_identity_audit ORDER BY revision').fetchall()
        self.assertEqual(len(audits), 2)
        self.assertEqual(json.loads(audits[0][1])['learner_profile_id'], 7)
        self.assertEqual(json.loads(audits[1][0])['learner_profile_id'], 7)
        self.assertEqual(json.loads(audits[1][1])['learner_profile_id'], 8)

    def test_rule_and_audit_roll_back_together(self):
        with self.assertRaises(RuntimeError):
            with self.db:
                self.save(self.cursor, 'M', ('guest_name', 'example guest'), None, rule(), 'synthetic-staff')
                raise RuntimeError('synthetic failure before commit')
        self.assertEqual(self.db.execute('SELECT count(*) FROM live_session_attendance_identity_rules').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM live_session_attendance_identity_audit').fetchone()[0], 0)


class SharedModuleRosterTests(unittest.TestCase):
    def test_shared_module_without_own_occurrences_keeps_its_own_learners(self):
        read = Mock(side_effect=[[], [{'source_occurrence_id': 'SOURCE-O',
            'learner_profile_id': 33, 'learner_email': 'destination@example.invalid'}]])
        namespace = {'read': read}
        base.functions(base.ROOT / 'session_results.py', {'replaced_module_register_rows'}, namespace)
        replaced = types.ModuleType('learner_api.replaced_teams_attendance')
        replaced.REPLACED_ATTENDANCE_LATERAL_SQL = 'LEFT JOIN LATERAL (SELECT NULL) replaced_attendance ON true'
        with patch.dict(sys.modules, {'learner_api.replaced_teams_attendance': replaced}):
            rows = namespace['replaced_module_register_rows']('DEST', ['SOURCE-O'])
        self.assertEqual(rows[0]['learner_profile_id'], 33)
        query, params = read.call_args_list[1].args
        self.assertIn('teams_shared_source_module_id', query)
        self.assertIn('learner_training_plan_modules', query)
        self.assertEqual(params, ['DEST', ['SOURCE-O']])


if __name__ == '__main__':
    unittest.main(verbosity=2)
