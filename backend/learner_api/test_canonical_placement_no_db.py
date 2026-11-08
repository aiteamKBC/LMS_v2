"""Offline ORM/consumer regression tests. No app startup hooks or database I/O.

Run: PYTHONPATH=backend python -m learner_api.test_canonical_placement_no_db
The direct runner registers only the models using a bare AppConfig, never the
production settings, signals, schema helpers or database test runner.
"""
import ast
import importlib
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

if __name__ == '__main__':
    from django.conf import settings
    settings.configure(SECRET_KEY='offline-placement-check', INSTALLED_APPS=[],
                       DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}})
    from django.apps import apps, AppConfig
    apps.populate([AppConfig('learner_api', importlib.import_module('learner_api'))])

from django.db import models
from django.db.backends.base.base import BaseDatabaseWrapper
from django.db.models.sql.subqueries import UpdateQuery
from learner_api.models import (
    EnrolmentUser, CommercialUser, LearnerProfile,
    PlacementProgramme, PlacementCohort, PlacementGroup,
)
from learner_api.placement_links import placement_ids, placement_profile, with_placements, RELATIONS, CACHE

BACKEND = Path(__file__).resolve().parents[1]


def function(relative, name, **namespace):
    """Execute an unchanged function body, isolating conflicted endpoint imports."""
    namespace.setdefault('__package__', relative.split('/')[0])
    namespace.setdefault('__name__', relative.removesuffix('.py').replace('/', '.'))
    tree = ast.parse((BACKEND / relative).read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), relative, 'exec'), namespace)
    return namespace[name]


def profile(**overrides):
    values = dict(pk=90, enrolment_id=7,
                  programme_record=PlacementProgramme(programme_id='P', name='Programme'),
                  cohort_record=PlacementCohort(cohort_id='C', cohort_name='Cohort'),
                  group_record=PlacementGroup(group_id='G', group_name='Group'))
    values.update(overrides)
    return LearnerProfile(**values)


class CanonicalPlacementTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(BaseDatabaseWrapper, 'connect',
                                      side_effect=AssertionError('Database I/O forbidden')))

    def query(self, row):
        manager = self.enterContext(patch('learner_api.placement_links.LearnerProfile.objects'))
        query = manager.using.return_value.select_related.return_value.only.return_value
        query.get.return_value = row
        return manager, query

    def test_all_six_existing_foreign_keys_preserve_scalar_id_contract(self):
        for model in (EnrolmentUser, LearnerProfile):
            for kind, target in (('programme', PlacementProgramme), ('cohort', PlacementCohort), ('group', PlacementGroup)):
                field = model._meta.get_field(kind + '_record')
                self.assertIsInstance(field, models.ForeignKey)
                self.assertIs(field.remote_field.model, target)
                self.assertEqual((field.attname, field.column), (kind + '_id', kind + '_id'))
                self.assertIs(field.remote_field.on_delete, models.PROTECT)
                self.assertFalse(target._meta.managed)
                self.assertIs(model._meta.get_field(kind + '_id'), field)
                self.assertNotIn(kind, {f.name for f in model._meta.concrete_fields})

    def test_select_related_and_existing_only_filter_values_compile(self):
        for model in (EnrolmentUser, LearnerProfile):
            query = model._base_manager.select_related(*RELATIONS).only('id', *RELATIONS).filter(cohort_id='C')
            sql, params = query.query.sql_with_params()
            self.assertIn('JOIN "curriculum"."cohorts"', sql)
            self.assertIn('JOIN "curriculum"."programmes"', sql)
            self.assertIn('JOIN "curriculum"."groups"', sql)
            self.assertEqual(params, ('C',))
            ids = str(model._base_manager.only('id', 'programme_id', 'cohort_id', 'group_id').query)
            self.assertNotIn('"Programme"', ids)
            self.assertIn('"programme_id"', ids)
            self.assertIn('"cohort_id"', str(model._base_manager.values('cohort_id').query))

    def test_existing_id_updates_compile_without_name_writes(self):
        query = UpdateQuery(LearnerProfile)
        query.add_update_values({'programme_id': 'P', 'cohort_id': 'C', 'group_id': 'G'})
        sql, params = query.get_compiler('default').as_sql()
        self.assertEqual(params, ('P', 'C', 'G'))
        self.assertNotIn('cohort_name', sql)
        self.assertNotIn('programme_record_id', sql)

    def test_profile_fk_descriptors_return_names_without_queries(self):
        row = profile()
        self.assertEqual((row.programme, row.cohort, row.group_name), ('Programme', 'Cohort', 'Group'))
        self.assertEqual(placement_ids(row), dict(programme_id='P', cohort_id='C', group_id='G'))

    def test_enrolment_and_commercial_use_profile_even_when_registration_ids_disagree(self):
        for model in (EnrolmentUser, CommercialUser):
            with self.subTest(model=model):
                source = model(pk=7, programme_id='REG-P', cohort_id='REG-C', group_id='REG-G')
                manager, query = self.query(profile())
                self.assertEqual(placement_ids(source), dict(programme_id='P', cohort_id='C', group_id='G'))
                self.assertEqual((source.programme, source.cohort, source.group), ('Programme', 'Cohort', 'Group'))
                query.get.assert_called_once_with(enrolment_id=7)
                self.assertEqual((source.programme_id, source.cohort_id, source.group_id), ('REG-P', 'REG-C', 'REG-G'))

    def test_missing_profile_has_no_registration_or_legacy_name_fallback(self):
        source = EnrolmentUser(pk=7, programme_id='REG-P', cohort_id='REG-C', group_id='REG-G')
        source.__dict__.update(programme='Legacy programme', cohort='Legacy cohort', group='Legacy group')
        _, query = self.query(None)
        query.get.side_effect = LearnerProfile.DoesNotExist
        self.assertEqual(placement_ids(source), dict(programme_id='', cohort_id='', group_id=''))
        self.assertEqual((source.programme, source.cohort, source.group), (None, None, None))

    def test_null_relationships_do_not_borrow_another_placement(self):
        row = profile(programme_record=None, cohort_record=None, group_record=None)
        self.assertEqual((row.programme, row.cohort, row.group_name), ('', '', ''))
        self.assertEqual(placement_ids(row), dict(programme_id='', cohort_id='', group_id=''))

    def test_ambiguous_bridge_fails_instead_of_selecting_first_learner(self):
        _, query = self.query(None)
        query.get.side_effect = LearnerProfile.MultipleObjectsReturned
        with self.assertRaises(LearnerProfile.MultipleObjectsReturned):
            placement_ids(EnrolmentUser(pk=7))

    def test_unsaved_enrolment_has_no_educational_placement(self):
        self.assertEqual(placement_ids(EnrolmentUser()), dict(programme_id='', cohort_id='', group_id=''))

    def test_names_on_fresh_read_follow_renamed_entities_without_id_changes(self):
        old = profile()
        _, query = self.query(old)
        self.assertEqual(EnrolmentUser(pk=7).cohort, 'Cohort')
        fresh = profile(programme_record=PlacementProgramme(programme_id='P', name='New programme'),
                        cohort_record=PlacementCohort(cohort_id='C', cohort_name='New cohort'),
                        group_record=PlacementGroup(group_id='G', group_name='New group'))
        query.get.return_value = fresh
        source = EnrolmentUser(pk=7)
        self.assertEqual((source.programme, source.cohort, source.group), ('New programme', 'New cohort', 'New group'))
        self.assertEqual(placement_ids(fresh), placement_ids(old))

    def test_batch_directory_reads_use_one_canonical_lookup_and_same_alias(self):
        source, missing = EnrolmentUser(pk=7), EnrolmentUser(pk=8)
        source._state.db = missing._state.db = 'enrolment'
        manager, query = self.query(None)
        query.filter.return_value = [profile()]
        self.assertEqual(with_placements([source, missing]), [source, missing])
        manager.using.assert_called_once_with('enrolment')
        query.filter.assert_called_once_with(enrolment_id__in=[7, 8])
        self.assertEqual(source.group, 'Group')
        self.assertIsNone(missing.group)
        query.get.assert_not_called()

    def test_batch_directory_rejects_duplicate_bridges(self):
        _, query = self.query(None)
        query.filter.return_value = [profile(), profile(pk=91)]
        with self.assertRaises(LearnerProfile.MultipleObjectsReturned):
            with_placements([EnrolmentUser(pk=7)])

    def test_refresh_clears_request_placement_snapshots(self):
        source = EnrolmentUser(pk=7)
        source.__dict__.update({CACHE: profile(), '_placement_names': ('old', 'old', 'old')})
        with patch.object(models.Model, 'refresh_from_db'):
            source.refresh_from_db()
        self.assertNotIn(CACHE, source.__dict__)
        self.assertNotIn('_placement_names', source.__dict__)

    def test_cohort_membership_is_id_based_even_with_namesakes(self):
        same = function('curriculum_api/learner_assignments.py', '_same_cohort', placement_ids=placement_ids)
        target = dict(id='C', programmeId='P', name='Renamed cohort', programmeName='Renamed programme')
        self.assertTrue(same(profile(), target))
        self.assertFalse(same(profile(cohort_id='OTHER'), target))

    def test_missing_fk_never_calls_name_based_module_or_preset_lookup(self):
        source = SimpleNamespace(programme='Old', group='Old', programme_id=None, group_id=None)
        catalogue, groups = Mock(), Mock()
        namespace = dict(placement_ids=placement_ids, _programme_modules=catalogue, _group_module_ids=groups)
        for name in ('learner_programme_modules', 'learner_group_module_ids'):
            self.assertEqual(function('learner_api/learning_plan.py', name, **namespace)(source), [])
        preset = function('learner_api/learning_plan.py', '_preset_ids_for', **namespace,
                          projection_call=lambda key, callback, value: callback(value))
        self.assertEqual(preset(source, {}), [])
        catalogue.assert_not_called()
        groups.assert_not_called()

    def test_learner_module_lookups_send_only_canonical_ids(self):
        catalogue, groups = Mock(return_value=['M']), Mock(return_value=['M'])
        row = profile()
        namespace = dict(placement_ids=placement_ids, _programme_modules=catalogue, _group_module_ids=groups)
        function('learner_api/learning_plan.py', 'learner_programme_modules', **namespace)(row)
        function('learner_api/learning_plan.py', 'learner_group_module_ids', **namespace)(row)
        catalogue.assert_called_once_with('', 'P')
        groups.assert_called_once_with('', '', group_id='G')

    def test_affected_readers_no_longer_call_learner_compat_fill_or_only(self):
        for name in ('learner_assignments', 'learner_assignment_counts_sql', 'learner_directory_details'):
            text = (BACKEND / 'curriculum_api' / (name + '.py')).read_text()
            self.assertNotIn('learner_compat.fill', text)
            self.assertNotIn('learner_compat.only', text)

    def test_assignment_directory_payload_keeps_display_contract(self):
        import sys
        import types
        source = EnrolmentUser(pk=7, username='Synthetic', email='learner@example.invalid',
                               employer='', organization='', programme_status='Active', learner_type='commercial')
        source.__dict__[CACHE] = profile()
        facts = types.ModuleType('curriculum_api.learner_assignment_counts_sql')
        facts.assignment_directory_facts = lambda ids: ({7: {'effective': {'M'}, 'moduleCount': 1}}, [])
        same = function('curriculum_api/learner_assignments.py', '_same_cohort', placement_ids=placement_ids)
        payload = function('curriculum_api/learner_assignments.py', '_payload',
                           plans=SimpleNamespace(_s=lambda value: str(value or '').strip()), _same_cohort=same)
        target = dict(id='C', name='Cohort', scope='cohort', programmeId='P', programmeName='Programme', moduleIds=['M'])
        with patch.dict(sys.modules, {facts.__name__: facts}):
            result = payload(target, [source])
        self.assertEqual(result['learners'][0]['id'], '7')
        self.assertEqual(result['learners'][0]['programme'], 'Programme')
        self.assertEqual(result['learners'][0]['cohort'], 'Cohort')
        self.assertEqual(result['learners'][0]['group'], 'Group')
        self.assertTrue(result['learners'][0]['assigned'])

    def test_attendance_projection_reads_profile_ids_not_registration_ids(self):
        from unittest.mock import MagicMock
        cursor = MagicMock()
        cursor.fetchall.return_value = [(7, 'Synthetic', 'learner@example.invalid', 'Programme', 'Group',
                                         'P', 'C', 'G', [], [])]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        reader = function('learner_api/attendance_assignments.py', 'roster_sources',
                          connections={'enrolment': connection}, SimpleNamespace=SimpleNamespace)
        rows = reader()
        self.assertEqual(placement_ids(rows[0]), dict(programme_id='P', cohort_id='C', group_id='G'))
        sql = cursor.execute.call_args.args[0]
        self.assertIn('l.enrolment_id = u.id', sql)
        self.assertIn('l.programme_id, l.cohort_id, l.group_id', sql)
        self.assertNotIn('u.programme_id', sql)

    def test_assignment_count_reader_does_not_lookup_a_namesake_when_group_fk_missing(self):
        plans = SimpleNamespace(_s=lambda value: str(value or '').strip(), _group_module_ids=Mock())
        preset = function('curriculum_api/learner_assignment_counts_sql.py', '_preset_ids', plans=plans)
        self.assertEqual(preset('Legacy programme', 'Legacy group', {}), [])
        plans._group_module_ids.assert_not_called()

    def test_cohort_access_with_missing_fk_never_queries_by_name(self):
        from datetime import date
        connection = Mock()
        access = function('learner_api/programme_access.py', 'learning_access', placement_ids=placement_ids,
                          connections={'default': connection}, _to_date=lambda value: value,
                          timezone=SimpleNamespace(localdate=lambda **kw: date(2026, 11, 8)),
                          ZoneInfo=lambda name: name)
        self.assertEqual(access(SimpleNamespace(cohort='Legacy name', programme='Legacy name', start_date=None)),
                         {'blocked': True, 'startDate': ''})
        connection.cursor.assert_not_called()

    def test_placement_input_preserves_omitted_and_explicitly_cleared_fields(self):
        from learner_api.placement_links import placement_input
        self.assertEqual(placement_input({'programmeId': ' P ', 'cohort_id': 'C', 'groupId': None}),
                         {'programme_id': 'P', 'cohort_id': 'C', 'group_id': None})
        self.assertEqual(placement_input({'phone': '123'}), {})

    def test_legacy_label_only_edits_are_rejected(self):
        from learner_api.placement_links import placement_input
        from learner_api.mappers import ValidationError
        for payload in ({'programme': 'Legacy'}, {'cohort': 'Legacy'}, {'group': 'Legacy'},
                        {'groupId': 99}, {'groupId': 'G', 'group_id': 'OTHER'}):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                placement_input(payload)

    def test_id_validation_checks_parent_relationships_and_preserves_omitted_values(self):
        from learner_api.placement_links import validate_placement
        from learner_api.mappers import ValidationError
        with patch.object(PlacementProgramme, 'objects') as programmes, \
                patch.object(PlacementCohort, 'objects') as cohorts, \
                patch.object(PlacementGroup, 'objects') as groups:
            programmes.using.return_value.filter.return_value.exists.return_value = True
            cohorts.using.return_value.filter.return_value.exists.return_value = True
            groups.using.return_value.filter.return_value.exists.return_value = True
            self.assertEqual(validate_placement({'group_id': 'G2'}, profile()), {'group_id': 'G2'})
            groups.using.return_value.filter.assert_called_once_with(pk='G2', programme_id='P', cohort_id='C')
            cohorts.using.return_value.filter.assert_called_once_with(pk='C', programme_id='P')
            groups.using.return_value.filter.return_value.exists.return_value = False
            with self.assertRaises(ValidationError):
                validate_placement({'group_id': 'OTHER'}, profile())

    def test_both_write_mappers_accept_ids_and_never_write_display_names(self):
        from learner_api.mappers import write_fields, write_commercial_fields
        for mapper in (write_fields, write_commercial_fields):
            self.assertEqual(mapper({'programmeId': 'P', 'cohortId': 'C', 'groupId': 'G'}),
                             {'programme_id': 'P', 'cohort_id': 'C', 'group_id': 'G'})

    def test_curriculum_options_filter_by_parent_ids_and_keep_duplicate_labels(self):
        from unittest.mock import MagicMock
        rows = MagicMock(return_value=[{'id': 'C1', 'title': 'Same'}, {'id': 'C2', 'title': 'Same'}])
        reader = function('learner_api/curriculum.py', 'cohorts', _rows=rows,
                          _guard=lambda callback: callback(), _error=lambda *a: a)
        result = reader(SimpleNamespace(method='GET', GET={'format': 'options', 'programme_id': 'P'}))
        self.assertEqual(len(result), 2)
        self.assertEqual(rows.call_args.args[1], ['P'])
        self.assertNotIn('DISTINCT', rows.call_args.args[0])
        self.assertNotIn('programme_name', rows.call_args.args[0])

    def test_import_resolves_ids_only_and_rejects_matching_display_names(self):
        normalize = lambda value: str(value or '').strip()
        parent = function('learner_api/learner_import.py', '_matches_parent', _text=normalize)
        resolver = function('learner_api/learner_import.py', '_resolve_placement', _text=normalize,
                            _matches_parent=parent, _issue=lambda row, message, field: (row, message, field))
        refs = {'programmes': [{'programme_id': 'P', 'name': 'Programme'}],
                'cohorts': [{'cohort_id': 'C', 'cohort_name': 'Cohort', 'programme_id': 'P'}],
                'groups': [{'group_id': 'G', 'group_name': 'Group', 'programme_id': 'P', 'cohort_id': 'C'}]}
        payload = {'programmeId': 'P', 'cohortId': 'C', 'groupId': 'G'}
        self.assertEqual(resolver(payload, refs, 2), [])
        self.assertEqual(payload['groupId'], 'G')
        self.assertTrue(resolver({'programmeId': 'Programme'}, refs, 2))

    def test_saving_fk_edits_clears_old_label_snapshot(self):
        row = profile()
        row.__dict__['_placement_names'] = ('Old', 'Old', 'Old')
        with patch.object(models.Model, 'save') as save:
            row.save(update_fields=['group_id'])
        save.assert_called_once_with(update_fields=['group_id'])
        self.assertNotIn('_placement_names', row.__dict__)

    def test_edit_saves_only_canonical_placement_and_preserves_registration_ids(self):
        from contextlib import nullcontext
        source = EnrolmentUser(pk=7, programme_id='REG-P', cohort_id='REG-C', group_id='REG-G')
        source._state.db = 'enrolment'
        learner = profile()
        source.__dict__[CACHE] = learner
        registration = Mock(return_value={'reviewHandover': 'preserved'})
        save = function('learner_api/learner_dates.py', 'save_enrolment_fields',
                        transaction=SimpleNamespace(atomic=lambda **kw: nullcontext()),
                        _save_enrolment_fields=registration)
        with patch('learner_api.placement_links.validate_placement') as validate, \
                patch.object(learner, 'save') as persist:
            result = save(source, {'group_id': 'G2', 'phone_number': '123'})
        registration.assert_called_once_with(source, {'phone_number': '123'})
        validate.assert_called_once_with({'group_id': 'G2'}, learner, using='enrolment')
        persist.assert_called_once_with(using='enrolment', update_fields=['group_id', 'updated_at'])
        self.assertEqual(learner.group_id, 'G2')
        self.assertEqual((source.programme_id, source.cohort_id, source.group_id), ('REG-P', 'REG-C', 'REG-G'))
        self.assertEqual(result, {'reviewHandover': 'preserved'})

    def test_mirror_dates_uses_explicit_profile_without_identity_repair(self):
        from datetime import date, timedelta
        source = EnrolmentUser(pk=7)
        learner = profile()
        source.__dict__[CACHE] = learner
        learner.start_date = None
        learner.end_date = None
        learner.gateway_review_date = None
        dates = Mock(return_value=(date(2026, 1, 1), date(2026, 12, 31)))
        mirror = function('learner_api/active_users.py', 'mirror_learner_placement',
                          cohort_dates=dates, timedelta=timedelta,
                          timezone=SimpleNamespace(now=lambda: None), DatabaseError=RuntimeError)
        with patch.object(learner, 'save'):
            self.assertIs(mirror(source), learner)
        dates.assert_called_once_with('', '', 'C')
        self.assertEqual(learner.group_id, 'G')

    def test_edit_failure_propagates_from_the_shared_transaction(self):
        from contextlib import contextmanager
        events = []
        @contextmanager
        def atomic(**kw):
            events.append(('begin', kw))
            try:
                yield
            except RuntimeError:
                events.append('rollback')
                raise
        source = EnrolmentUser(pk=7)
        row = profile()
        source.__dict__[CACHE] = row
        save = function('learner_api/learner_dates.py', 'save_enrolment_fields',
                        transaction=SimpleNamespace(atomic=atomic), _save_enrolment_fields=Mock())
        with patch('learner_api.placement_links.validate_placement'), \
                patch.object(row, 'save', side_effect=RuntimeError('write failure')), \
                self.assertRaisesRegex(RuntimeError, 'write failure'):
            save(source, {'group_id': 'G2'})
        self.assertEqual(events, [('begin', {'using': 'enrolment'}), 'rollback'])

    def test_authoring_reader_preserves_name_filters_order_and_ksb_compatibility(self):
        from curriculum_api import schema_compat
        physical = {'group_id', 'group_name', 'programme_id', 'cohort_id', 'status', 'updated_at'}
        namespace = dict(schema_compat=schema_compat, CURRICULUM_SCHEMA='curriculum',
                         ensure_module_authoring_tables=Mock(), column_names=lambda table: physical,
                         derived_placement_names_sql=Mock(side_effect=AssertionError('duplicate derived fields')),
                         quote_ident=lambda name: '"' + name + '"',
                         archive_state=SimpleNamespace(uses_status=lambda table: True),
                         LEGACY_LIFECYCLE_READ_COLUMNS={'deleted_at'},
                         authoring_table_name=lambda table: 'curriculum.' + table)
        reader = function('curriculum_api/views.py', 'authoring_select_sql', **namespace)
        with patch.object(schema_compat, 'connection', Mock(vendor='postgresql')), \
                patch.object(schema_compat, 'columns_of', return_value=physical):
            sql = reader('groups', 'cohort_name = %s', 'programme_name, group_name',
                         ensure_tables=False, columns=['group_id', 'cohort_name'])
            self.assertIn('"cohort_name"', sql)
            self.assertTrue(sql.endswith('where cohort_name = %s order by programme_name, group_name'))
            ksb = schema_compat.read_relation('ksb_mappings', {'id', 'component_id', 'standard_ksb_id', 'status'})
            self.assertIn('standard_ksbs', ksb)
            self.assertIn('ksb_code', ksb)

    def test_status_counters_preserve_explicit_module_memberships_and_deduplicate(self):
        import sys
        import types
        from collections import Counter, defaultdict
        import curriculum_api
        views = types.ModuleType('curriculum_api.views')
        views.scope_programme_identifier = lambda lineage: lineage['programmeId']
        views.normalise = lambda value: str(value or '').lower()
        counters = function('curriculum_api/learner_status_counts.py', 'counts_for_lineages',
                            Counter=Counter, defaultdict=defaultdict, status_key=lambda value: value.lower())
        base = dict(programme_id='P', cohort_id='C', group_id='G', status='Active', module_ids=[])
        facts = [dict(base, id=1), dict(base, id=1), dict(base, id=2, explicit=True),
                 dict(base, id=3, programme_id='OTHER', group_id='H', module_ids=['M'], explicit=True)]
        lineages = {'G': dict(found=True, programmeId='P', cohortId='C', groupId='G'),
                    'M': dict(found=True, programmeId='P', cohortId='C', groupId='G', moduleCatalogueId='M')}
        with patch.dict(sys.modules, {views.__name__: views}), patch.object(curriculum_api, 'views', views, create=True):
            result = counters(lineages, facts, {})
        self.assertEqual(result, {'G': {'total': 2, 'statuses': {'active': 2}},
                                  'M': {'total': 2, 'statuses': {'active': 2}}})

    def test_roster_never_admits_missing_fk_by_matching_label(self):
        narrow = function('curriculum_api/views.py', 'narrow_learners_to_placement',
                          clean_str=lambda value: str(value or '').strip())
        rows = [{'id': 1, 'cohortId': 'C', 'cohort': 'Old name'},
                {'id': 2, 'cohortId': '', 'cohort': 'Renamed'},
                {'id': 3, 'cohortId': 'OTHER', 'cohort': 'Renamed'}]
        self.assertEqual(narrow(rows, 'cohortId', 'C', 'cohort', 'Renamed'), [rows[0]])


if __name__ == '__main__':
    unittest.main(verbosity=2)
