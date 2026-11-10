"""KSB mapping writes against the new ksb_mappings constraints, without a database.

ksb_mappings on the normalised schema: standard_ksb_id NOT NULL (FK
standard_ksbs) and weight > 0. Pins that a mapping's own standard picks its
standard_ksbs row before the module's profile does, and that the component
builder refuses a weightless mapping instead of failing at the insert.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import schema_compat, views


class StandardReferenceTests(SimpleTestCase):
    def test_reads_the_standard_and_version_from_a_source_id(self):
        cases = {
            'st0596-v1-0': ('ST0596', '1.0'),
            'standard:st0845-v1-1': ('ST0845', '1.1'),
            'ST0612': ('ST0612', ''),
            'KSBP-20260610080934000011': ('', ''),
            '': ('', ''),
        }
        for source_id, expected in cases.items():
            self.assertEqual(schema_compat.standard_reference(source_id), expected, source_id)


class FakeCursor:
    """Answers the lookups standard_ksb_id_for makes, recording each one."""

    def __init__(self, answers):
        self.answers, self.queries, self._next = answers, [], None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.queries.append((sql, list(params or [])))
        self._next = next((answer for match, answer in self.answers if match(sql, params or [])), None)

    def fetchone(self):
        return self._next


def standard_lookup(reference):
    return lambda sql, params: 'standard_ksbs' in sql and params and params[0] == reference


class StandardKsbIdTests(SimpleTestCase):
    def _resolve(self, answers, **kwargs):
        cursor = FakeCursor(answers)
        connection = mock.MagicMock()
        connection.cursor.return_value = cursor
        with mock.patch.object(schema_compat, 'connection', connection):
            return schema_compat.standard_ksb_id_for(**kwargs), cursor.queries

    def test_the_mappings_own_standard_decides_before_the_module_profile(self):
        resolved, queries = self._resolve(
            [(standard_lookup('ST0596'), (596,)), (standard_lookup('ST0612'), (612,)),
             (lambda sql, params: 'from' in sql and 'modules' in sql, ('standard:st0612-v1-0', 'PROG-MM-L6'))],
            ksb_code='K1', module_catalogue_id='MOD-MM', source_type='standard', source_id='st0596-v1-0',
        )
        self.assertEqual(resolved, 596)
        self.assertEqual(queries[-1][1], ['ST0596', 'K1', '1.0'])
        self.assertFalse(any('modules' in sql for sql, _ in queries))

    def test_a_framework_source_falls_back_to_the_module_profile(self):
        resolved, queries = self._resolve(
            [(lambda sql, params: 'modules' in sql, ('standard:st0596-v1-0', 'PROG-ME-L4')),
             (standard_lookup('ST0596'), (596,))],
            ksb_code='K1', module_catalogue_id='MOD-ME', source_type='framework', source_id='KSBP-1',
        )
        self.assertEqual(resolved, 596)
        self.assertTrue(any('modules' in sql for sql, _ in queries))

    def test_a_code_missing_from_its_standard_falls_back_to_the_profile(self):
        resolved, _ = self._resolve(
            [(standard_lookup('ST0596'), None),
             (lambda sql, params: 'modules' in sql, ('standard:st0612-v1-0', 'PROG-MM-L6')),
             (standard_lookup('ST0612'), (612,))],
            ksb_code='K1', module_catalogue_id='MOD-MM', source_type='standard', source_id='st0596-v1-0',
        )
        self.assertEqual(resolved, 612)

    def test_translate_write_passes_the_mapping_source(self):
        columns = {'id', 'component_id', 'ksb_id', 'standard_ksb_id', 'source_type', 'source_id', 'weight', 'status'}
        with mock.patch.object(schema_compat, 'standard_ksb_id_for', return_value=7) as lookup:
            payload, _ = schema_compat.translate_write('ksb_mappings', {
                'id': 'KSBMAP-1', 'component_id': 'C1', 'ksb_id': 'K1', 'ksb_code': 'K1', 'weight': 40,
                'module_catalogue_id': 'MOD-1', 'source_type': 'standard', 'source_id': 'st0596-v1-0',
            }, columns)
        self.assertEqual(payload['standard_ksb_id'], 7)
        self.assertEqual(lookup.call_args.kwargs['source_type'], 'standard')
        self.assertEqual(lookup.call_args.kwargs['source_id'], 'st0596-v1-0')


class ComponentBuilderWeightTests(SimpleTestCase):
    def test_a_weightless_mapping_is_refused_before_anything_is_written(self):
        mappings = [{'ksb_code': 'K1', 'weight': 40}, {'ksb_code': 'S2', 'weight': 0}]
        with mock.patch.object(views, 'authoring_fetch_all', return_value=[]), \
             mock.patch.object(views, 'component_context_for_payload', return_value=('MOD-1', 'WEEK-1', 1)), \
             mock.patch.object(views, 'ensure_module_authoring_tables'), \
             mock.patch.object(views, 'normalise_component_ksb_mappings', return_value=([], mappings)), \
             mock.patch.object(views, 'authoring_upsert', side_effect=AssertionError('written')), \
             mock.patch.object(views, 'authoring_bulk_upsert', side_effect=AssertionError('written')):
            with self.assertRaises(views.ModuleAuthoringValidationError) as raised:
                views.save_component_builder_payload({
                    'title': 'Intro', 'module': 'MOD-1', 'week': 'WEEK-1', 'type': 'reading',
                    'ksbMappings': [{'code': 'K1', 'weight': 40}, {'code': 'S2', 'weight': 0}],
                })
        self.assertEqual(raised.exception.errors, [
            {'path': 'ksbMappings.1.weight', 'message': 'S2: weight must be greater than zero.'},
        ])
