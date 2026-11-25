"""Exact moved-source contracts and synthetic calendar reads; no Django startup."""
import ast
import copy
from datetime import date, datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import calendar_composition_oracle as oracle

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative):
    from curriculum_api.catalogue.tests.parity.cache_composition_oracle import restore_tree
    return restore_tree(ast.parse((ROOT / relative).read_text(encoding='utf-8-sig')), relative)


def original(relative):
    return oracle.restore_tree(tree(relative), relative)


class OwnerImports(ast.NodeTransformer):
    def __init__(self, package='curriculum_api'):
        self.package = package

    def visit_ImportFrom(self, node):
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), self.package)
            node.level = 0
        names = {a.name for a in node.names}
        if node.module == 'curriculum_api.country_calendars' and names == {'CalendarUnavailable'}:
            node.module = 'curriculum_api.catalogue.infrastructure.country_calendar_reads'
        if node.module == 'curriculum_api.delivery_calendar':
            node.module = 'curriculum_api.catalogue.infrastructure.' + (
                'calendar_display' if names == {'display_cohort_holidays'} else 'delivery_calendar_runtime')
        if node.module == 'curriculum_api.delivery_dashboard':
            node.module = 'curriculum_api.catalogue.api.delivery_dashboard'
        return node


class DirectCapabilities(OwnerImports):
    def visit_ImportFrom(self, node):
        if node.level == 1 and node.module is None and [a.name for a in node.names] == ['views']:
            return None
        return super().visit_ImportFrom(node)

    def visit_Assign(self, node):
        if ast.dump(node) == ast.dump(ast.parse('v = _views()').body[0]):
            return None
        return self.generic_visit(node)

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name) and node.value.id in ('v', 'views') or (
            isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
            and node.value.func.id == '_views'):
            return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
        return self.generic_visit(node)


def country_scope(prior):
    """Compile the actual old/new definitions, injecting only their read ports."""
    now = datetime(2026, 11, 23, tzinfo=timezone.utc)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now
    parse_date = lambda value: date.fromisoformat(value) if isinstance(value, str) else value
    parse_json = lambda value, default: json.loads(value) if isinstance(value, str) else value or default
    ports = dict(parse_date=parse_date, parse_json_value=parse_json,
                 table_exists=Mock(return_value=True), table_name=lambda name: name,
                 fetch_all=Mock(return_value=[]))
    env = dict(datetime=Clock, timedelta=timedelta, timezone=timezone,
               REFRESH_DAYS=25, EXPIRY_DAYS=30, TABLE='country_holiday_calendars', **ports)
    env['_views'] = lambda: SimpleNamespace(**ports)
    source = original('country_calendars.py') if prior else tree('catalogue/infrastructure/country_calendar_reads.py')
    wanted = {'CalendarUnavailable', 'saved_calendars', '_stamp', 'cache_status', 'holidays_for_period'}
    nodes = [n for n in source.body if getattr(n, 'name', None) in wanted]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual-country-read-definitions>', 'exec'), env)
    return env, ports, now


class CalendarCompositionContracts(unittest.TestCase):
    def test_frozen_evidence_and_exact_remaining_source(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '5798dac770cf3f7de53ca58ea39ef66a5b217faf41a3c6b0119a6f86edb14a48')
        for relative, record in oracle.SNAPSHOT['source_changes'].items():
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in tree(relative).body], record['after'], relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in original(relative).body], record['order'], relative)

    def test_all_77_bodies_signatures_and_decorators_are_preserved(self):
        old = {n.name: n for n in original('views.py').body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(len(MANIFEST['functions']), 77)
        for name, owner in MANIFEST['functions'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body if getattr(n, 'name', None) == name)
            self.assertEqual(ast.dump(OwnerImports().visit(copy.deepcopy(old[name]))), ast.dump(actual), name)
        for actual in tree('views.py').body:
            if isinstance(actual, ast.FunctionDef):
                self.assertEqual(ast.dump(OwnerImports().visit(copy.deepcopy(old[actual.name]))),
                                 ast.dump(OwnerImports().visit(copy.deepcopy(actual))), actual.name)
        old_values = {t.id: n for n in original('views.py').body if isinstance(n, ast.Assign)
                      for t in n.targets if isinstance(t, ast.Name)}
        for name, owner in MANIFEST['constants'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body if isinstance(n, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == name for t in n.targets))
            self.assertEqual(ast.dump(old_values[name]), ast.dump(actual), name)

    def test_calendar_and_dashboard_algorithms_keep_exact_bodies(self):
        for relative, groups in oracle.SNAPSHOT['calendar'].items():
            old = {n.name: n for n in original(relative).body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
            for owner, names in groups.items():
                actual = {n.name: n for n in tree(owner.replace('.', '/') + '.py').body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
                for name in names:
                    expected = DirectCapabilities().visit(copy.deepcopy(old[name]))
                    current = OwnerImports('curriculum_api.' + owner.rsplit('.', 1)[0]).visit(copy.deepcopy(actual[name]))
                    self.assertEqual(ast.dump(expected), ast.dump(current), (owner, name))
                old_values = {t.id: n for n in original(relative).body if isinstance(n, ast.Assign)
                              for t in n.targets if isinstance(t, ast.Name)}
                for node in tree(owner.replace('.', '/') + '.py').body:
                    if isinstance(node, ast.Assign):
                        for target in node.targets:
                            if isinstance(target, ast.Name) and target.id in old_values:
                                self.assertEqual(ast.dump(old_values[target.id]), ast.dump(node), target.id)

    def test_provider_sync_and_http_authorization_bodies_remain_unchanged(self):
        for relative, names in [('country_calendars.py', ('_views', 'fetch_holidays', 'ensure_calendar', 'sync_saved', 'record_sync_failure')),
                                ('delivery_dashboard.py', ('overview', 'sessions'))]:
            old = {n.name: n for n in original(relative).body if isinstance(n, ast.FunctionDef)}
            current = {n.name: n for n in tree(relative).body if isinstance(n, ast.FunctionDef)}
            for name in names:
                self.assertEqual(ast.dump(old[name]), ast.dump(current[name]), name)

    def test_no_reverse_or_forbidden_layer_dependencies(self):
        for owner in MANIFEST['modules']:
            for node in ast.walk(tree(owner.replace('.', '/') + '.py')):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotEqual(node.module, 'curriculum_api.views', owner)
                    self.assertFalse(node.level == 1 and node.module is None and any(a.name == 'views' for a in node.names), owner)
                    if '.infrastructure.' in owner:
                        self.assertNotIn('.api.', node.module or '', owner)
                    if '.domain.' in owner:
                        self.assertFalse(any(x in (node.module or '') for x in ('django', '.infrastructure.', '.api.', 'settings')), owner)
                    if owner.endswith('country_calendar_reads'):
                        self.assertNotIn(node.module, ('requests', 'curriculum_api.country_calendars'))

    def test_refresh_expiry_and_missing_timestamp_parity(self):
        results = []
        for prior in (True, False):
            env, _, now = country_scope(prior)
            result = []
            for age in (0, 24, 25, 29, 30, None):
                stamp = now - timedelta(days=age) if age is not None else None
                row = dict(country='US', year=2026, fetched_at=stamp, holidays='[]', last_error='')
                actual = env['cache_status'](row)
                self.assertEqual((actual['due'], actual['expired']), (age is None or age >= 25, age is None or age >= 30))
                result.append(actual)
            results.append(result)
        self.assertEqual(*results)

    def test_multi_year_country_selection_and_duplicate_rows_parity(self):
        results = []
        for prior in (True, False):
            env, ports, now = country_scope(prior)
            rows = [dict(country=country, year=year, fetched_at=now, holidays=[{'date': value}])
                    for country, year, value in [('US', 2026, 'old'), ('GB', 2026, 'foreign'), ('US', 2026, 'new'), ('US', 2027, 'next')]]
            ports['fetch_all'].return_value = rows
            result = env['holidays_for_period']('US', '2026-12-01', '2027-02-01')
            self.assertEqual(result, [{'date': 'new'}, {'date': 'next'}])
            ports['fetch_all'].assert_called_once_with('select * from country_holiday_calendars order by country, year')
            results.append(result)
        self.assertEqual(*results)

    def test_missing_and_expired_calendar_never_fabricates_holidays(self):
        for prior in (True, False):
            for expired in (False, True):
                env, ports, now = country_scope(prior)
                ports['fetch_all'].return_value = [dict(country='US', year=2026, fetched_at=now - timedelta(days=30), holidays=[])] if expired else []
                with self.assertRaisesRegex(env['CalendarUnavailable'], 'Sync US public holidays for 2026'):
                    env['holidays_for_period']('US', '2026-10-01')

    def test_missing_dates_do_not_read_storage(self):
        for prior in (True, False):
            env, ports, _ = country_scope(prior)
            with self.assertRaisesRegex(env['CalendarUnavailable'], 'Set delivery dates'):
                env['holidays_for_period']('US', None)
            ports['fetch_all'].assert_not_called()

    def test_missing_table_preserves_empty_storage_result(self):
        for prior in (True, False):
            env, ports, _ = country_scope(prior)
            ports['table_exists'].return_value = False
            self.assertEqual(env['saved_calendars'](), [])
            ports['fetch_all'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
