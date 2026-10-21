"""F01/F02 P04 and mirror safety regressions; no framework/database startup.

Run: python -B backend/learner_api/test_f01_f02_security_mirror_no_db.py
Frozen exception bodies are a pre-security-correction contract oracle.
Transactions/ORM are synthetic; PostgreSQL guarantees are not established here.
"""
import ast
from contextlib import contextmanager
from copy import deepcopy
import io
import json
import logging
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock

import test_legacy_assignment_list_no_db as safety
import test_plan_reconciliation_no_db as reconciliation
import test_module_roster_no_db as roster

ROOT = Path(__file__).resolve().parents[2]
SAFE = 'The database service is temporarily unavailable.'
SENSITIVE = 'password=synthetic-secret postgresql://user:secret@private-host/db SELECT * FROM private_table learner@example.invalid'
DatabaseError = safety.DatabaseError

FROZEN_HANDLERS = json.loads("[{\"path\":\"backend/login/platform_admin.py\",\"func\":\"_optional_rows\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return str(exc), []\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"overview\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    accounts, login_ok, login_error = {}, False, str(exc)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"accounts\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"account_action\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"account_action\",\"index\":1,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"account_action\",\"index\":2,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"account_action\",\"index\":4,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"account_action\",\"index\":6,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"_delete_staff_account\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"audit\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"roles\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"email_log\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"email_acknowledge\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"system\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    configured, detail = False, str(exc)[:200]\"},{\"path\":\"backend/login/platform_admin.py\",\"func\":\"report_drill\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    # The source table is absent on this database -- the same state the\\n    # report itself reports by dropping a section, so it is said plainly\\n    # rather than shown as an empty result.\\n    return JsonResponse({\\n        \\\"metric\\\": key,\\n        \\\"label\\\": spec[\\\"label\\\"],\\n        \\\"table\\\": spec[\\\"table\\\"],\\n        \\\"available\\\": False,\\n        \\\"error\\\": str(exc),\\n        \\\"countSql\\\": count_sql,\\n        \\\"rowsSql\\\": rows_sql,\\n    })\"},{\"path\":\"backend/login/learner_enrolment.py\",\"func\":\"add_learner_record\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    raise EnrolmentError(f\\\"Database error: {exc}\\\") from exc\"},{\"path\":\"backend/learner_api/training_plan_document.py\",\"func\":\"training_plan_document\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"training_plan_document: build failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/training_plan_document.py\",\"func\":\"issue_training_plan\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"issue_training_plan: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/training_plan_document.py\",\"func\":\"sign_training_plan\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"sign_training_plan: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/apprenticeship_agreement.py\",\"func\":\"apprenticeship_agreement\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"apprenticeship_agreement: build failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/apprenticeship_agreement.py\",\"func\":\"issue_agreement\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"issue_agreement: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/apprenticeship_agreement.py\",\"func\":\"sign_agreement\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"sign_agreement: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/written_agreement.py\",\"func\":\"written_agreement\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"written_agreement: build failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/written_agreement.py\",\"func\":\"issue_written_agreement\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"issue_written_agreement: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/written_agreement.py\",\"func\":\"sign_written_agreement\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"sign_written_agreement: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/ilr_document.py\",\"func\":\"ilr_document\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"ilr_document: build failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/ilr_document.py\",\"func\":\"issue_ilr\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"issue_ilr: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/ilr_document.py\",\"func\":\"sign_ilr\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"sign_ilr: failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/module_shift.py\",\"func\":\"module_shift_options\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"module_shift_options: lookup failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/module_shift.py\",\"func\":\"module_shift_progress\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"module_shift_progress: lookup failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/module_shift.py\",\"func\":\"module_shift_progress\",\"index\":1,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"module_shift_progress: pairing failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/module_shift.py\",\"func\":\"module_shift\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"module_shift: lookup failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/module_shift.py\",\"func\":\"module_shift\",\"index\":1,\"source\":\"except DatabaseError as exc:\\n    logger.exception(\\\"module_shift: save failed\\\")\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/free_courses_view.py\",\"func\":\"submit_free_course_quiz\",\"index\":1,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/curriculum.py\",\"func\":\"_guard\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"},{\"path\":\"backend/learner_api/curriculum.py\",\"func\":\"ksb_profile\",\"index\":0,\"source\":\"except DatabaseError as exc:\\n    return _error(f\\\"Database error: {exc}\\\", 502)\"}]")


class Response:
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status


def source_tree(path):
    return ast.parse((ROOT / path).read_text(encoding='utf-8-sig'))


def handlers(function):
    return sorted((n for n in ast.walk(function) if isinstance(n, ast.ExceptHandler)
                   and n.type is not None and ast.unparse(n.type) == 'DatabaseError'),
                  key=lambda n: n.lineno)


def probe(handler, func):
    # Execute the actual exception branch with synthetic HTTP/log seams. No app imports.
    scope = dict(DatabaseError=DatabaseError, logger=Mock(spec=logging.Logger),
                 JsonResponse=Response, EnrolmentError=ValueError,
                 key='synthetic_metric', spec={'label': 'Synthetic', 'table': 'private_table'},
                 count_sql='SELECT secret FROM private_table', rows_sql='SELECT secret FROM private_table')
    scope['_error'] = lambda message, status, **extra: Response({'error': message, **extra}, status)
    wrapper = ast.parse('def run(failure):\n try:\n  raise failure\n except DatabaseError as exc:\n  pass\n return locals()').body[0]
    wrapper.body[0].handlers = [deepcopy(handler)]
    exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[])),
                 '<real database error branch>', 'exec'), scope)
    try:
        result = scope['run'](DatabaseError(SENSITIVE))
    except ValueError as exc:
        result = {'exception': 'EnrolmentError', 'message': str(exc)}
    if isinstance(result, Response):
        return result.status_code, result.data, scope['logger']
    if func == 'overview':
        result = {k: result[k] for k in ('accounts', 'login_ok', 'login_error')}
    if func == 'system':
        result = {k: result[k] for k in ('configured', 'detail')}
    return None, result, scope['logger']


class DisclosureTests(unittest.TestCase):
    def test_every_corrected_exception_branch_preserves_status_and_sanitizes_response_and_logs(self):
        self.assertEqual(len(FROZEN_HANDLERS), 36)
        for fixture in FROZEN_HANDLERS:
            with self.subTest(path=fixture['path'], function=fixture['func'], index=fixture['index']):
                tree = source_tree(fixture['path'])
                func = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == fixture['func'])
                current = handlers(func)[fixture['index']]
                frozen = ast.parse('try:\n pass\n' + fixture['source']).body[0].handlers[0]
                old_status, old_data, _ = probe(frozen, fixture['func'])
                status, data, log = probe(current, fixture['func'])
                self.assertIn(SENSITIVE, json.dumps(old_data))
                self.assertEqual(status, old_status)
                encoded = json.dumps(data)
                for denied in [SENSITIVE, 'synthetic-secret', 'private-host', 'private_table', 'SELECT secret']:
                    self.assertNotIn(denied, encoded)
                    self.assertNotIn(denied, str(log.mock_calls))
                log.error.assert_called_once()
                log.exception.assert_not_called()
                self.assertIn(SAFE, encoded)
                if isinstance(old_data, dict):
                    self.assertEqual(set(data), set(old_data))
                if fixture['func'] == 'report_drill':
                    self.assertFalse(data['available'])
                    self.assertEqual(data['table'], '')
                    self.assertEqual(data['countSql'], '')
                    self.assertEqual(data['rowsSql'], '')
                elif isinstance(data, dict) and 'error' in data:
                    self.assertEqual(data['error'], SAFE)

    def test_validation_and_authorization_are_not_caught_by_database_handlers(self):
        tree = source_tree('backend/login/learner_enrolment.py')
        scope = dict(EnrolmentError=ValueError, can_add_learner_record=lambda account: 'Already a learner.',
                     transaction=NS(atomic=lambda **kw: lambda function: function))
        safety.definitions(ROOT / 'backend/login/learner_enrolment.py', ['add_learner_record'], scope)
        with self.assertRaisesRegex(ValueError, 'Already a learner'):
            scope['add_learner_record'](NS(), programme='')
        platform = source_tree('backend/login/platform_admin.py')
        for name in ['accounts', 'account_action', 'audit', 'roles', 'email_log', 'system', 'report_drill']:
            func = next(n for n in platform.body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertIn('require_role(ROLE_ADMIN)', [ast.unparse(d) for d in func.decorator_list])
        self.assertIn('EnrolmentError', ast.unparse(tree))

    def test_corrected_modules_have_no_raw_public_database_exception_text(self):
        for path in {f['path'] for f in FROZEN_HANDLERS}:
            tree = source_tree(path)
            for node in ast.walk(tree):
                if isinstance(node, ast.JoinedStr):
                    self.assertFalse(any(isinstance(c, ast.Constant) and isinstance(c.value, str)
                                         and 'Database error:' in c.value for c in node.values), path)
            for func in tree.body:
                if not isinstance(func, ast.FunctionDef):
                    continue
                for branch in handlers(func):
                    for call in ast.walk(branch):
                        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == 'str':
                            self.assertNotEqual(ast.unparse(call), 'str(exc)', (path, func.name))
        activation = next(n for n in source_tree('backend/learner_api/active_users.py').body
                          if isinstance(n, ast.FunctionDef) and n.name == 'sync_active_user')
        _, result, log = probe(handlers(activation)[-1], 'sync_active_user')
        self.assertIsNone(result)
        log.warning.assert_called_once_with('Could not sync learner (%s)', 'DatabaseError')
        self.assertNotIn(SENSITIVE, str(log.mock_calls))


class Query:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows

    def filter(self, **where):
        ids = where.get('pk__in', where.get('enrolment_id__in'))
        if ids is None and 'pk' in where:
            ids = [where['pk']]
        return Query([r for r in self.rows if ids is None or r.pk in ids])

    def values_list(self, field, flat=False):
        return [r.pk for r in self.rows]

    def __iter__(self):
        return iter(self.rows)


class CommandHarness:
    def __init__(self, name, plans, fail=None, fail_before_save=False):
        self.events, self.stdout, self.stderr = [], io.StringIO(), io.StringIO()
        self.persisted = {i: deepcopy(plan) for i, plan in enumerate(plans, 1)}
        self.mirrors = {i: deepcopy(plan) for i, plan in self.persisted.items()}
        self.failure = fail
        self.fail_before_save = fail_before_save
        self.rows = []
        harness = self
        for pk, plan in self.persisted.items():
            row = NS(pk=pk, username='Synthetic', programme='P', training_plan=deepcopy(plan),
                     learning_plan=None)
            def save(update_fields, row=row):
                harness.events.append(('source-save', row.pk))
                if harness.fail_before_save:
                    raise DatabaseError(SENSITIVE)
                harness.persisted[row.pk] = deepcopy(row.training_plan)
            row.save = save
            self.rows.append(row)

        @contextmanager
        def atomic(using):
            assert using == 'enrolment'
            before = deepcopy((harness.persisted, harness.mirrors))
            harness.events.append(('begin',))
            try:
                yield
            except DatabaseError:
                harness.persisted, harness.mirrors = before
                harness.events.append(('rollback',))
                raise
            else:
                harness.events.append(('commit',))

        @contextmanager
        def cursor():
            yield NS(execute=lambda sql: harness.events.append(('transaction-mode', sql)))

        def sync(row, strict=False):
            harness.events.append(('mirror', row.pk, strict))
            if harness.failure == row.pk:
                if strict:
                    raise DatabaseError(SENSITIVE)
                return 0
            harness.mirrors[row.pk] = deepcopy(row.training_plan)
            return len(row.training_plan or [])

        codec = reconciliation.codec_scope()
        scope = dict(BaseCommand=object, DatabaseError=DatabaseError, Counter=__import__('collections').Counter,
                     transaction=NS(atomic=atomic), connections={'enrolment': NS(cursor=cursor)},
                     EnrolmentUser=NS(all_learners=Query(self.rows)),
                     LearnerProfile=NS(objects=Query(self.rows)), get_training_plan=codec['get_training_plan'],
                     stored_training_plan=codec['stored_training_plan'], training_plan_field=lambda row: 'training_plan',
                     hydrate_training_plan=lambda values: deepcopy(values),
                     _s=lambda value: str(value or '').strip(),
                     _programme_modules=lambda programme: [{'moduleId': 'new', 'weeks': []}],
                     _plan_titles=lambda plan: ('synthetic', '', ''), sync_learning_plan_mirror=sync)
        tree = source_tree('backend/learner_api/management/commands/' + name + '.py')
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Command')
        exec(compile(ast.Module(body=[cls], type_ignores=[]), '<real management command>', 'exec'), scope)
        self.command = scope['Command']()
        self.command.stdout, self.command.stderr = self.stdout, self.stderr
        self.command.style = NS(SUCCESS=lambda text: text, WARNING=lambda text: text, ERROR=lambda text: text)

    def run(self, apply=True):
        self.command.handle(apply=apply)
        return self.stdout.getvalue(), self.stderr.getvalue()


class MirrorFailureTests(unittest.TestCase):
    def test_sync_command_counts_failure_without_retry_and_continues_other_learners(self):
        h = CommandHarness('sync_learning_plans', [reconciliation.PLAN, []], fail=1)
        before = deepcopy(h.persisted)
        out, err = h.run()
        self.assertIn('Mirrored 1 learner(s).', out)
        self.assertIn('1 failed.', out)
        self.assertNotIn(SENSITIVE, err)
        self.assertEqual(h.persisted, before)
        self.assertEqual([e for e in h.events if e[0] == 'mirror'], [('mirror', 1, True), ('mirror', 2, True)])
        self.assertEqual([e[0] for e in h.events if e[0] in {'begin', 'rollback', 'commit'}],
                         ['begin', 'rollback', 'begin', 'commit'])

    def test_assignment_batch_mirror_failure_rolls_back_prior_source_and_other_batch_rows(self):
        h = CommandHarness('assign_programme_plans', [None, None], fail=2)
        before = deepcopy((h.persisted, h.mirrors))
        out, err = h.run()
        self.assertIn('rolled back', err)
        self.assertNotIn('Assigned a plan', out)
        self.assertNotIn(SENSITIVE, err)
        self.assertEqual((h.persisted, h.mirrors), before)
        self.assertEqual([e for e in h.events if e[0] == 'mirror'], [('mirror', 1, True), ('mirror', 2, True)])
        self.assertEqual(h.events[-1], ('rollback',))

    def test_failure_before_source_persistence_does_not_reconcile(self):
        h = CommandHarness('assign_programme_plans', [None], fail_before_save=True)
        out, err = h.run()
        self.assertEqual(h.persisted, {1: None})
        self.assertFalse(any(e[0] == 'mirror' for e in h.events))
        self.assertIn('rolled back', err)
        self.assertNotIn('Assigned a plan', out)

    def test_successful_batch_saves_and_reconciles_in_existing_transaction_order(self):
        h = CommandHarness('assign_programme_plans', [None])
        out, err = h.run()
        self.assertEqual(err, '')
        self.assertIn('Assigned a plan to 1 learner(s).', out)
        self.assertEqual(h.persisted, h.mirrors)
        names = [e[0] for e in h.events]
        self.assertLess(names.index('source-save'), names.index('mirror'))
        self.assertEqual(names[0], 'begin')
        self.assertEqual(names[-1], 'commit')

    def test_explicit_empty_and_existing_assignments_are_not_replaced_by_batch(self):
        for saved in [[], reconciliation.PLAN]:
            h = CommandHarness('assign_programme_plans', [saved])
            before = deepcopy((h.persisted, h.mirrors))
            h.run()
            self.assertEqual((h.persisted, h.mirrors), before)
            self.assertFalse(any(e[0] in {'source-save', 'mirror'} for e in h.events))

    def test_dry_runs_never_save_or_reconcile(self):
        for name in ['sync_learning_plans', 'assign_programme_plans']:
            h = CommandHarness(name, [None])
            h.run(apply=False)
            self.assertEqual(h.events, [])

    def test_legacy_csv_assignment_is_not_overwritten_by_programme_batch(self):
        h = CommandHarness('assign_programme_plans', [None])
        h.rows[0].modules = 'Historical module title'
        before = deepcopy((h.persisted, h.mirrors))
        h.run()
        self.assertEqual((h.persisted, h.mirrors), before)
        self.assertFalse(any(e[0] in {'source-save', 'mirror'} for e in h.events))

    def test_strict_and_non_strict_helper_roll_back_mirror_but_not_prior_source_write(self):
        for strict in [False, True]:
            db = reconciliation.Store()
            db.replace(reconciliation.PLAN)
            db.progress = [{'id': 911, 'plan_component_id': db.rows[2][0].pk}]
            before = db.snapshot()
            persisted_source = NS(pk=7, training_plan=[], learning_plan=None, free_courses=[])
            if strict:
                with self.assertRaises(reconciliation.Failure):
                    db.sync(persisted_source, strict=True)
            else:
                with self.assertLogs('guarded', level='ERROR') as log:
                    self.assertEqual(db.sync(persisted_source, strict=False), 0)
                self.assertNotIn('historical progress', ' '.join(log.output))
            self.assertEqual(db.snapshot(), before)
            self.assertEqual(persisted_source.training_plan, [])  # Already saved source is outside helper rollback.

    def test_http_roster_zero_mirror_result_still_has_legacy_success_contract_blocked(self):
        # This characterizes the unresolved contract; it is not a fake claim of closure.
        h = roster.Harness([roster.learner(1, [])])
        sync = Mock(return_value=0)
        h.ns['sync_learning_plan_mirror'] = sync
        response = h.request('PUT', [1])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(h.directory.data[1]['learning_plan'])
        self.assertEqual(sync.call_count, 1)
        self.assertNotIn('strict', sync.call_args.kwargs)

    def test_repeated_and_out_of_order_snapshots_show_missing_freshness_contract(self):
        db = reconciliation.Store()
        old = NS(pk=7, training_plan=deepcopy(reconciliation.PLAN), learning_plan=None, free_courses=[])
        newer = deepcopy(old)
        newer.training_plan[0]['moduleTitle'] = 'Newer title'
        db.sync(newer)
        state = db.snapshot()
        db.sync(newer)
        self.assertEqual(db.snapshot(), state)
        db.sync(old)
        self.assertEqual(db.json, old.training_plan)
        self.assertNotEqual(db.json, newer.training_plan)  # No source version/CAS; stale ordering stays BLOCKED.


if __name__ == '__main__':
    sys.addaudithook(safety.guard)
    unittest.main()

