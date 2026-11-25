"""Read parity on synthetic PostgreSQL fixtures in the established isolated runner."""
import ast
from contextlib import contextmanager
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from django.conf import settings
from django.db import connection, transaction
from curriculum_api import learner_assignment_counts_sql as counts
from learner_api.learning_plans.infrastructure import assignment_reads as reads


def original_reads():
    snapshot = json.loads((Path('/tmp/phase1f/backend/learner_api/learning_plans/tests/fixtures/legacy_snapshots')
                           / 'assignment_reads_snapshot.json').read_text(encoding='utf-8'))
    namespace = dict(vars(reads))
    for kind in ('functions', 'constants'):
        for entry in snapshot[kind].values():
            exec(compile(ast.parse(entry['source']), '<frozen-assignment-read>', 'exec'), namespace)
    return SimpleNamespace(**namespace)


@contextmanager
def synthetic_presets():
    assert connection.vendor == 'postgresql'
    assert all(db['HOST'] == '127.0.0.1' and db['NAME'] == 'phase1f' for db in settings.DATABASES.values())
    with transaction.atomic():
        try:
            with connection.cursor() as cursor:
                cursor.execute('''CREATE TEMP TABLE assignment_read_presets (
                    group_id text, group_name text, programme_name text, programme_id text,
                    status text, module_ids jsonb, created_at timestamp, updated_at timestamp)''')
                cursor.execute('''INSERT INTO assignment_read_presets VALUES
                    ('G1','Shared','Programme','P','active','["A","B","A"]','2026-01-01','2026-01-01'),
                    ('G2','Shared','Programme','P','active','["X"]','2026-01-01','2026-02-01'),
                    ('G3','Empty','Programme','P','active','[]','2026-01-01','2026-01-01'),
                    ('G4','Shared','Other','OTHER','active','["OUT"]','2026-01-01','2026-01-01')''')
            yield
        finally:
            transaction.set_rollback(True)


class AssignmentReadsPostgreSQL(unittest.TestCase):
    def test_canonical_group_and_name_tiebreak_match_frozen_reader(self):
        with synthetic_presets():
            old = original_reads()
            for programme, group, group_id in [('P', 'Shared', ''), ('stale', 'stale', 'G2'),
                                                ('OTHER', 'Shared', ''), ('P', 'Empty', ''), ('', '', 'MISSING')]:
                kwargs = dict(source='assignment_read_presets', group_id=group_id)
                self.assertEqual(reads._group_module_ids(programme, group, **kwargs),
                                 old._group_module_ids(programme, group, **kwargs))
            self.assertEqual(reads._group_module_ids('P', 'Shared', source='assignment_read_presets'), ['A', 'B', 'A'])

    def test_bulk_presets_match_single_reads_and_frozen_sql(self):
        with synthetic_presets():
            pairs = [('P', 'Shared'), ('P', 'Empty'), ('OTHER', 'Shared'), ('P', '')]
            old = original_reads()
            actual = reads.group_module_ids_bulk(pairs, source='assignment_read_presets')
            self.assertEqual(actual, old.group_module_ids_bulk(pairs, source='assignment_read_presets'))
            self.assertEqual(actual, {pair: reads._group_module_ids(*pair, source='assignment_read_presets') for pair in pairs})

    def test_manual_roster_lookup_executes_unchanged_postgresql_predicate(self):
        with synthetic_presets(), connection.cursor() as cursor:
            # Only the existing isolated suite's synthetic records are touched.
            cursor.execute("UPDATE curriculum.modules SET learner_roster_mode='manual' WHERE module_catalogue_id='MOD-TEST'")
            actual = reads._manual_roster_module_ids(['MOD-TEST', 'MOD-TEST', 'MISSING'])
            self.assertEqual(actual, original_reads()._manual_roster_module_ids(['MOD-TEST', 'MOD-TEST', 'MISSING']))
            self.assertEqual(actual, {'MOD-TEST'})

    def test_plan_facts_and_group_cache_execute_real_queries_with_count_parity(self):
        source = '''(VALUES
            (1,'P','Shared','G1',NULL::jsonb,NULL::jsonb),
            (2,'P','Shared','G1','[]'::jsonb,NULL::jsonb),
            (3,'P','Shared','G1','[{"moduleId":"X","assignmentMode":"explicit"}]'::jsonb,NULL::jsonb),
            (4,'P','Shared','G1','[{"moduleId":"A"},{"moduleId":"A"}]'::jsonb,NULL::jsonb)
        ) AS u(id,"Programme","Group",group_id,"Training_plan","Learning_plan")'''
        with synthetic_presets(), patch.object(counts, '_group_source', return_value='assignment_read_presets'):
            wanted = {'A', 'B', 'X'}
            facts = counts.fetch_plan_facts(wanted, using='default', source=source)
            cache = counts.seed_preset_cache(facts)
            self.assertEqual(cache, {('group_id', 'G1'): ['A', 'B', 'A']})
            actual = counts.counts_from_plan_facts(facts, wanted, cache)
            with patch.object(counts, 'plans', original_reads()):
                expected = counts.counts_from_plan_facts(facts, wanted, counts.seed_preset_cache(facts))
            self.assertEqual(actual, expected)
            self.assertEqual(actual, ({'A': 2, 'B': 2, 'X': 1}, []))

    def test_ambiguous_json_and_missing_group_are_not_silently_reassigned(self):
        source = '''(VALUES
            (7,'P','Shared',NULL::text,'"[]"'::jsonb,NULL::jsonb),
            (8,'P','Shared',NULL::text,NULL::jsonb,NULL::jsonb)
        ) AS u(id,"Programme","Group",group_id,"Training_plan","Learning_plan")'''
        with synthetic_presets(), patch.object(counts, '_group_source', return_value='assignment_read_presets'):
            facts = counts.fetch_plan_facts({'A'}, using='default', source=source)
            self.assertEqual(counts.counts_from_plan_facts(facts, {'A'}, counts.seed_preset_cache(facts)), ({'A': 0}, [7]))
