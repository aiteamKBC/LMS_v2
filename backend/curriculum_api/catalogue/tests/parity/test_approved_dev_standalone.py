"""Fail-closed source deltas and actual study-week owners; no Django or DB."""
import ast
import copy
import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
from curriculum_api.catalogue.tests.parity import approved_dev_contracts as contracts
from curriculum_api.catalogue.application.delivery_schedules import (
    load_module_session_plan, module_schedule_view, ModuleSessionPlanValidationError,
)
from curriculum_api.catalogue.domain.hierarchy_dates import module_calendar_end_date
from curriculum_api.catalogue.domain.read_contracts import COMPACT_MODULE_LIST_FIELDS, PROGRAMME_WORKSPACE_MODULE_FIELDS
from curriculum_api.weekly_schedule import module_week_boundary_mode, merged_week_boundary_mode


class ApprovedSourceContracts(unittest.TestCase):
    def test_reference_is_pinned_to_reviewed_merge_and_immutable(self):
        self.assertEqual(contracts.REFERENCE['accepted_merge'], 'fcdaa2a542412536cc51ff8ea5ee7846ad5a118f')
        self.assertEqual(hashlib.sha256(contracts.REFERENCE_PATH.read_bytes()).hexdigest(),
                         'c49c04c7fbfff11b95ea3d41132176376ad9c0741adc4fd2f3d37ee2ea13949c')
        self.assertEqual(len(contracts.REFERENCE['files']), 35)

    def test_each_current_owner_matches_approved_source_and_exact_historical_delta(self):
        for relative, entry in contracts.REFERENCE['files'].items():
            with self.subTest(file=relative):
                current = ast.parse((BACKEND / relative).read_text(encoding='utf-8-sig'))
                restored = contracts.restore_tree(current, relative)
                self.assertEqual(contracts.fingerprint(restored), entry['historical_ast_sha256'])
                # Validate the pinned new readiness calls before comparing with
                # the unchanged dev-merge fingerprint. No snapshot is rewritten.
                approved = contracts.restore_review_readiness(current, relative)
                self.assertEqual(contracts.fingerprint(approved), entry['approved_ast_sha256'])
                self.assertIs(contracts.restore_tree(restored, relative), restored)

    def test_unknown_additions_in_approved_files_are_rejected(self):
        for relative in contracts.REFERENCE['files']:
            with self.subTest(file=relative):
                tree = ast.parse((BACKEND / relative).read_text(encoding='utf-8-sig'))
                tree.body += ast.parse('unexpected_policy = True').body
                with self.assertRaisesRegex(AssertionError, 'Unreviewed source change'):
                    contracts.restore_tree(tree, relative)

    def test_reverting_approved_behavior_is_rejected(self):
        relative = 'curriculum_api/catalogue/domain/read_contracts.py'
        old = contracts.source_tree(BACKEND / relative)
        # A newly parsed reverted file cannot inherit the in-memory restoration marker.
        with self.assertRaisesRegex(AssertionError, 'Unreviewed source change'):
            contracts.restore_tree(ast.parse(ast.unparse(old)), relative)

    def test_missing_or_duplicate_imports_and_changed_functions_are_rejected(self):
        relative = 'curriculum_api/catalogue/application/authoring_summaries.py'
        tree = ast.parse((BACKEND / relative).read_text(encoding='utf-8'))
        index = next(i for i, node in enumerate(tree.body) if isinstance(node, ast.ImportFrom)
                     and node.module == 'curriculum_api.weekly_schedule')
        for operation in ('missing', 'duplicate', 'function'):
            with self.subTest(operation=operation):
                changed = copy.deepcopy(tree)
                if operation == 'missing':
                    changed.body.pop(index)
                elif operation == 'duplicate':
                    changed.body.append(copy.deepcopy(changed.body[index]))
                else:
                    fn = next(n for n in changed.body if isinstance(n, ast.FunctionDef))
                    fn.body.append(ast.parse('return {}').body[0])
                with self.assertRaisesRegex(AssertionError, 'Unreviewed source change'):
                    contracts.restore_tree(changed, relative)

    def test_unreviewed_files_are_returned_untouched(self):
        tree = ast.parse('unexpected_policy = True')
        self.assertIs(contracts.restore_tree(tree, 'curriculum_api/unreviewed.py'), tree)

    def test_current_runtime_fixture_keeps_real_new_capabilities(self):
        from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
        tree = current_entry_tree()
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                  and n.name == 'module_attachment_authoring_payload')
        keywords = {n.arg for n in ast.walk(fn) if isinstance(n, ast.keyword)}
        self.assertIn('cohort_selected_holidays_by_cohort', keywords)
        self.assertIn('ModuleAuthoringValidationError', keywords)


class ActualStudyWeekContracts(unittest.TestCase):
    def test_default_end_date_keeps_legacy_two_argument_contract(self):
        self.assertEqual(module_calendar_end_date('2026-11-04', 2), '2026-11-17')
        self.assertEqual(module_calendar_end_date('2026-11-04', 2, {}), '2026-11-17')

    def test_opted_in_end_date_uses_selected_week_boundary(self):
        self.assertEqual(module_calendar_end_date('2026-11-04', 2,
                         {'weekBoundaryMode': 'calendar', 'weekStartsOn': 'Monday'}), '2026-11-15')

    def test_absent_and_invalid_boundary_modes_are_distinct(self):
        self.assertIsNone(module_week_boundary_mode({}))
        self.assertIsNone(module_week_boundary_mode({'weekBoundaryMode': ''}))
        self.assertEqual(module_week_boundary_mode({'week_boundary_mode': 'calendar'}), 'calendar')
        with self.assertRaises(ValueError):
            module_week_boundary_mode({'weekBoundaryMode': 'invented'})

    def test_existing_layout_cannot_be_switched_or_cleared(self):
        current = {'week_boundary_mode': 'calendar'}
        self.assertEqual(merged_week_boundary_mode({}, current), 'calendar')
        self.assertIsNone(merged_week_boundary_mode({}, {'module_catalogue_id': 'M'}))
        for payload, stored in (({'weekBoundaryMode': ''}, current),
                                ({'weekBoundaryMode': 'calendar'}, {'module_catalogue_id': 'M'})):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                merged_week_boundary_mode(payload, stored)

    def test_compact_and_workspace_payloads_keep_the_layout_field(self):
        for fields in (COMPACT_MODULE_LIST_FIELDS, PROGRAMME_WORKSPACE_MODULE_FIELDS):
            self.assertEqual(list(fields).count('weekBoundaryMode'), 1)
            self.assertIn('weekStartsOn', fields)

    def test_schedule_view_preserves_calendar_and_legacy_modes(self):
        for mode in (None, 'calendar'):
            value = module_schedule_view({'weekBoundaryMode': mode, 'weekStartsOn': 'Monday'},
                                        module_week_starts_on=lambda row: row['weekStartsOn'],
                                        module_weekly_schedule=lambda row: [], session_overrides=lambda row: {})
            self.assertEqual(value['week_boundary_mode'], mode)
            self.assertEqual(value['week_starts_on'], 'Monday')

    def plan_ports(self, rows):
        from curriculum_api.catalogue.domain.values import parse_int
        return dict(resolve_stored_module_catalogue_id=lambda identifier: identifier,
                    authoring_fetch_all=Mock(return_value=rows), AUTHORING_MODULES_TABLE='synthetic_modules',
                    module_delivery_row=lambda row, group: {**row, **group}, fetch_group_row=Mock(return_value={}),
                    parse_int=parse_int, module_session_plan_for_count=Mock(return_value={'sessions': []}),
                    module_session_plan_for_weeks=Mock(return_value={'weeks': []}),
                    module_stored_week_count=lambda row: row.get('weeks_number', 2))

    def test_missing_module_does_not_invent_a_plan(self):
        ports = self.plan_ports([])
        self.assertIsNone(load_module_session_plan('M', {}, **ports))
        ports['module_session_plan_for_weeks'].assert_not_called()
        ports['module_session_plan_for_count'].assert_not_called()

    def test_calendar_limit_is_checked_before_planning(self):
        ports = self.plan_ports([{'week_boundary_mode': 'calendar'}])
        with self.assertRaisesRegex(ModuleSessionPlanValidationError, '104'):
            load_module_session_plan('M', {'weeks': '105'}, **ports)
        ports['module_session_plan_for_weeks'].assert_not_called()
        ports['module_session_plan_for_count'].assert_not_called()

    def test_legacy_week_limit_and_explicit_session_precedence_stay_unchanged(self):
        ports = self.plan_ports([{}])
        result = load_module_session_plan('M', {'weeks': '105'}, **ports)
        self.assertEqual(result[3], 105)
        ports['module_session_plan_for_weeks'].assert_called_once_with({}, 105)
        load_module_session_plan('M', {'sessions': '3', 'weeks': '2'}, **ports)
        ports['module_session_plan_for_count'].assert_called_once_with({}, 3)

    def test_stored_week_count_and_group_delivery_remain_authoritative(self):
        ports = self.plan_ports([{'group_id': 'G', 'weeks_number': 4, 'week_boundary_mode': 'calendar'}])
        ports['fetch_group_row'].return_value = {'session_week_day': 'Monday'}
        result = load_module_session_plan('M', {}, **ports)
        ports['fetch_group_row'].assert_called_once_with('G')
        self.assertEqual(result[2]['session_week_day'], 'Monday')
        ports['module_session_plan_for_weeks'].assert_called_once_with(result[2], 4)


if __name__ == '__main__':
    unittest.main()
