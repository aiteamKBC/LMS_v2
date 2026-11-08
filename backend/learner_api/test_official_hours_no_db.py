"""Slice 03a: the official Planned Hours selector.

Database and network are prohibited: ``query`` returns synthetic rows and the
real ``canonical_learning._validated_profile`` decides identity.
"""
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.db import OperationalError, ProgrammingError
from django.test import SimpleTestCase

from . import canonical_learning, official_hours
from .official_hours import (
    AMBIGUOUS_PROFILE, IDENTITY_REVIEW_REQUIRED, INVALID, NO_PROFILE, NOT_SET, SET,
    OfficialPlannedHours, normalise_official_planned_hours, official_planned_hours,
    official_planned_hours_for_enrolments,
)


def row(enrolment_id, learner_id, official, /, **overrides):
    """A synthetic, identity-consistent profile row as the bulk query returns it."""
    values = {
        'id': learner_id, 'enrolment_id': enrolment_id, 'aptem_id': 7000 + learner_id,
        'email': f'learner{learner_id}@example.test', 'programme_planned_hours': official,
        'account_record_id': enrolment_id, 'account_email': f'Learner{learner_id}@Example.test',
        'account_aptem_id': f'00{7000 + learner_id}',
    }
    values.update(overrides)
    return values


class NormaliseTests(SimpleTestCase):
    def test_t1_positive_official_value(self):
        self.assertEqual(normalise_official_planned_hours(Decimal('288.00')), (288.0, SET))
        self.assertEqual(normalise_official_planned_hours(288), (288.0, SET))
        self.assertEqual(normalise_official_planned_hours('288'), (288.0, SET))

    def test_t2_four_place_rounding_is_decimal_half_even(self):
        cases = {
            Decimal('123.45'): 123.45,        # numeric(12,2) values are unchanged
            Decimal('9999999999.99'): 9999999999.99,
            Decimal('0.00005'): 0.0,          # half-even: down to the even digit
            Decimal('0.00015'): 0.0002,       # half-even: up to the even digit
            Decimal('2.67455'): 2.6746,
            Decimal('1.00005'): 1.0,
            Decimal('1.00006'): 1.0001,
            1.00005: 1.0,                     # a float is rounded as its repr, not its binary value
            0.1 + 0.2: 0.3,
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                hours, status = normalise_official_planned_hours(value)
                self.assertEqual((hours, status), (expected, SET))
        # The binary-float route this avoids would have given 1.0001.
        self.assertEqual(round(1.00005, 4), 1.0001)

    def test_t3_null_is_not_set_and_never_zero(self):
        hours, status = normalise_official_planned_hours(None)
        self.assertIsNone(hours)
        self.assertEqual(status, NOT_SET)

    def test_t4_real_zero_is_set_zero(self):
        for value in (Decimal('0'), Decimal('0.00'), 0, 0.0, '0'):
            with self.subTest(value=value):
                self.assertEqual(normalise_official_planned_hours(value), (0.0, SET))

    def test_t5_negative_zero_is_plain_zero(self):
        for value in (Decimal('-0'), Decimal('-0.00'), -0.0):
            with self.subTest(value=value):
                hours, status = normalise_official_planned_hours(value)
                self.assertEqual((hours, status), (0.0, SET))
                self.assertEqual(str(hours), '0.0')

    def test_t6_negative_is_invalid_even_when_it_would_round_to_zero(self):
        for value in (Decimal('-5'), Decimal('-0.00004'), -1, '-288'):
            with self.subTest(value=value):
                self.assertEqual(normalise_official_planned_hours(value), (None, INVALID))

    def test_t7_nan_and_infinities_are_invalid(self):
        for value in (Decimal('NaN'), Decimal('sNaN'), Decimal('Infinity'), Decimal('-Infinity'),
                      float('nan'), float('inf'), float('-inf'), 'NaN', 'Infinity'):
            with self.subTest(value=value):
                self.assertEqual(normalise_official_planned_hours(value), (None, INVALID))

    def test_t8_booleans_and_malformed_values_are_invalid(self):
        for value in (True, False, '', '   ', 'abc', '1_000', '12h', object(), [], {}, Decimal('1e30')):
            with self.subTest(value=value):
                self.assertEqual(normalise_official_planned_hours(value), (None, INVALID))

    def test_the_input_is_never_modified(self):
        stored = {'programme_planned_hours': Decimal('-5')}
        official_planned_hours(stored)
        self.assertEqual(stored, {'programme_planned_hours': Decimal('-5')})

    def test_parity_with_the_existing_canonical_rule_for_stored_values(self):
        for value in (Decimal('288.00'), Decimal('0.00'), Decimal('12.5'), Decimal('-5'), None,
                      Decimal('NaN')):
            with self.subTest(value=value):
                owner = {'programme_planned_hours': value}
                self.assertEqual(official_planned_hours(owner),
                                 canonical_learning.programme_planned_hours(None, owner=owner))


class OwnerTests(SimpleTestCase):
    def test_t9_missing_owner_is_none_without_a_read(self):
        with patch.object(canonical_learning, 'profile') as profile, \
             patch.object(official_hours, 'query') as read:
            self.assertIsNone(official_planned_hours(None))
        profile.assert_not_called()
        read.assert_not_called()

    def test_t10_an_owner_without_the_field_raises(self):
        for owner in ({}, {'planned_hours': 288}, {'id': 1, 'enrolment_id': 2}):
            with self.subTest(owner=owner), self.assertRaises(KeyError):
                official_planned_hours(owner)

    def test_owner_values_keep_null_and_zero_apart(self):
        self.assertIsNone(official_planned_hours({'programme_planned_hours': None}))
        self.assertEqual(official_planned_hours({'programme_planned_hours': Decimal('0')}), 0.0)
        self.assertEqual(official_planned_hours({'programme_planned_hours': Decimal('288')}), 288.0)


class BulkTests(SimpleTestCase):
    def run_bulk(self, ids, rows):
        with patch.object(official_hours, 'query', return_value=rows) as read:
            return official_planned_hours_for_enrolments(ids), read

    def test_t11_an_enrolment_without_a_profile(self):
        result, read = self.run_bulk([201], [])
        self.assertEqual(result, {201: OfficialPlannedHours(None, NO_PROFILE)})
        read.assert_called_once()
        for ids in ([0], [-3]):
            with self.subTest(ids=ids):
                result, read = self.run_bulk(ids, [])
                self.assertEqual(result, {ids[0]: OfficialPlannedHours(None, NO_PROFILE)})
                read.assert_not_called()

    def test_t12_two_profiles_for_one_enrolment_resolve_to_neither(self):
        result, _ = self.run_bulk([201], [row(201, 101, Decimal('288')), row(201, 102, Decimal('400'))])
        self.assertEqual(result, {201: OfficialPlannedHours(None, AMBIGUOUS_PROFILE)})

    def test_t13_a_profile_failing_identity_verification(self):
        failures = (
            {'account_record_id': None},                         # no Created_users row
            {'account_email': 'someone.else@example.test'},       # email mismatch
            {'email': ''},                                         # no profile email
            {'account_aptem_id': '9999'},                          # Aptem mismatch
        )
        for override in failures:
            with self.subTest(override=override):
                result, _ = self.run_bulk([201], [row(201, 101, Decimal('288'), **override)])
                self.assertEqual(result, {201: OfficialPlannedHours(None, IDENTITY_REVIEW_REQUIRED)})

    def test_t14_a_verified_enrolment_resolves_to_its_own_profile(self):
        result, read = self.run_bulk([201, 202], [row(201, 101, Decimal('288.00')),
                                                 row(202, 102, None)])
        self.assertEqual(result, {201: OfficialPlannedHours(288.0, SET, 101),
                                  202: OfficialPlannedHours(None, NOT_SET, 102)})
        sql, params = read.call_args.args
        self.assertIn('l.enrolment_id=ANY(%s)', sql)
        self.assertEqual(params, [[201, 202]])

    def test_t15_an_enrolment_id_equal_to_another_profile_id_is_not_matched(self):
        # Profile 101 belongs to enrolment 201. Enrolment 101 has no profile.
        rows = [row(201, 101, Decimal('288'))]
        with patch.object(official_hours, 'query', side_effect=lambda sql, params: [
                r for r in rows if r['enrolment_id'] in params[0]]) as read:
            result = official_planned_hours_for_enrolments([101])
        self.assertEqual(result, {101: OfficialPlannedHours(None, NO_PROFILE)})
        sql, _params = read.call_args.args
        self.assertNotRegex(sql, r'l\.id\s*=\s*ANY|l\.id\s+IN')
        # A row for another enrolment is ignored even if the reader returned it.
        result, _ = self.run_bulk([101], rows)
        self.assertEqual(result, {101: OfficialPlannedHours(None, NO_PROFILE)})

    def test_t16_duplicate_ids_are_one_entry_and_one_query(self):
        result, read = self.run_bulk([201, '201', 201, None, ' 201 ', 202],
                                     [row(201, 101, Decimal('288')), row(202, 102, Decimal('0'))])
        self.assertEqual(list(result), [201, 202])
        read.assert_called_once()
        self.assertEqual(read.call_args.args[1], [[201, 202]])
        self.assertEqual(result[202], OfficialPlannedHours(0.0, SET, 102))

    def test_input_type_errors_are_raised_without_a_query(self):
        for ids, error in (([True], TypeError), ([1.5], TypeError), ([Decimal('201')], TypeError),
                           (['2x'], ValueError), (['-3'], ValueError), ([''], ValueError), (['٢٠١'], ValueError)):
            with self.subTest(ids=ids), patch.object(official_hours, 'query') as read:
                with self.assertRaises(error):
                    official_planned_hours_for_enrolments(ids)
                read.assert_not_called()

    def test_empty_input_reads_nothing(self):
        for ids in ([], [None], ()):
            with self.subTest(ids=ids):
                result, read = self.run_bulk(ids, [])
                self.assertEqual(result, {})
                read.assert_not_called()

    def test_t17_no_other_planned_source_is_consulted(self):
        legacy = row(201, 101, None, Planned_hours='576', training_plan_planned_hours=Decimal('400'),
                     review_planned=20, planned=Decimal('420'))
        with patch.object(official_hours, 'query', return_value=[legacy]) as read, \
             patch('learner_api.training_plan_dashboard.plan_planned_hours') as plan, \
             patch.object(canonical_learning, 'targets_for') as monthly, \
             patch('coach_api.migrated_otjh.planned_hours_bulk') as reviews, \
             patch.object(canonical_learning, 'profile') as profile:
            result = official_planned_hours_for_enrolments([201])
        self.assertEqual(result, {201: OfficialPlannedHours(None, NOT_SET, 101)})
        for unused in (plan, monthly, reviews, profile):
            unused.assert_not_called()
        sql = read.call_args.args[0]
        self.assertNotIn('Planned_hours', sql)
        self.assertNotIn('training_plan', sql)
        self.assertIn('l.planned_hours AS programme_planned_hours', sql)

    def test_t18_nothing_is_written(self):
        from learner_api.models import LearnerProfile
        connections = MagicMock()
        with patch.object(official_hours, 'query', return_value=[row(201, 101, Decimal('288'))]) as read, \
             patch('django.db.connections', connections), \
             patch.object(LearnerProfile, 'save') as save:
            official_planned_hours_for_enrolments([201])
            official_planned_hours({'programme_planned_hours': Decimal('288')})
        save.assert_not_called()
        connections.__getitem__.assert_not_called()
        sql = read.call_args.args[0]
        self.assertRegex(sql, r'^\s*SELECT\b')
        self.assertNotRegex(sql.upper(), r'\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|MERGE|FOR\s+UPDATE)\b')

    def test_t19_database_errors_propagate(self):
        for failure in (OperationalError('down'), ProgrammingError('missing column')):
            with self.subTest(failure=type(failure).__name__), \
                 patch.object(official_hours, 'query', side_effect=failure):
                with self.assertRaises(type(failure)):
                    official_planned_hours_for_enrolments([201])

    def test_both_learner_kinds_have_the_same_contract(self):
        rows = [row(201, 101, Decimal('288'), learner_type='commercial'),
                row(202, 102, Decimal('288'), learner_type='apprenticeship')]
        result, _ = self.run_bulk([201, 202], rows)
        self.assertEqual(result[201], OfficialPlannedHours(288.0, SET, 101))
        self.assertEqual(result[202], OfficialPlannedHours(288.0, SET, 102))

    def test_invalid_stored_values_keep_the_verified_identity(self):
        result, _ = self.run_bulk([201, 202, 203], [row(201, 101, Decimal('-1')),
                                                   row(202, 102, Decimal('NaN')),
                                                   row(203, 103, Decimal('0'))])
        self.assertEqual(result[201], OfficialPlannedHours(None, INVALID, 101))
        self.assertEqual(result[202], OfficialPlannedHours(None, INVALID, 102))
        self.assertEqual(result[203], OfficialPlannedHours(0.0, SET, 103))

    def test_every_requested_id_has_one_result(self):
        result, _ = self.run_bulk([201, 202, 203, 0], [row(201, 101, Decimal('1')),
                                                      row(202, 102, Decimal('2')),
                                                      row(202, 112, Decimal('3'))])
        self.assertEqual({key: value.status for key, value in result.items()},
                         {201: SET, 202: AMBIGUOUS_PROFILE, 203: NO_PROFILE, 0: NO_PROFILE})
