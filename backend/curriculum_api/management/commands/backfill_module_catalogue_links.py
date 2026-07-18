import json
from collections import Counter, defaultdict
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from curriculum_api import views


def _clean(value):
    return str(value or '').strip()


def _fetch_all(query, params=None):
    with connection.cursor() as cursor:
        cursor.execute(query, params or [])
        return views.rows_as_dicts(cursor)


def _table_exists(table):
    rows = _fetch_all(
        '''
        select 1
        from information_schema.tables
        where table_schema = %s and table_name = %s
        limit 1
        ''',
        [views.CURRICULUM_SCHEMA, table],
    )
    return bool(rows)


def _column_exists(table, column):
    rows = _fetch_all(
        '''
        select 1
        from information_schema.columns
        where table_schema = %s and table_name = %s and column_name = %s
        limit 1
        ''',
        [views.CURRICULUM_SCHEMA, table, column],
    )
    return bool(rows)


def _authoring_table(table):
    return f'{views.quote_ident(views.CURRICULUM_SCHEMA)}.{views.quote_ident(table)}'


def _candidate_score(module_id, mapping_counts, component_counts, week_counts):
    return (
        mapping_counts.get(module_id, 0),
        component_counts.get(module_id, 0),
        week_counts.get(module_id, 0),
    )


def _sorted_unique(values):
    return sorted({value for value in values if value})


class Command(BaseCommand):
    help = 'Safely report or apply Training_plan.module_catalogue_id links from canonical Module Builder records.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Apply links. Omit this flag for a strict read-only dry-run.')
        parser.add_argument('--dry-run', action='store_true', help='Deprecated compatibility flag; dry-run is the default.')
        parser.add_argument('--resolution-file', help='JSON file containing reviewed ambiguous-row selections.')
        parser.add_argument('--write-resolution-template', help='Write a JSON template for ambiguous rows.')

    def handle(self, *args, **options):
        apply_mode = bool(options['apply'])
        if options['dry_run'] and apply_mode:
            raise CommandError('Use either --apply or --dry-run, not both.')
        self.stdout.write(f'Mode: {"APPLY" if apply_mode else "DRY-RUN (read-only)"}')

        if not _table_exists('Training_plan'):
            raise CommandError('curriculum.Training_plan does not exist.')
        if not _column_exists('Training_plan', views.TRAINING_MODULE_CATALOGUE_COLUMN):
            self.stdout.write('Required column Training_plan.module_catalogue_id is missing. Dry-run exits without changes.')
            return
        schema_mismatch = self._schema_mismatch_reasons()
        if schema_mismatch and apply_mode:
            raise CommandError(f'Apply refused: schema does not match migration 0002 ({"; ".join(schema_mismatch)}).')
        required_authoring = [
            views.AUTHORING_MODULES_TABLE,
            views.AUTHORING_WEEKS_TABLE,
            views.AUTHORING_COMPONENTS_TABLE,
            views.AUTHORING_KSB_MAPPINGS_TABLE,
        ]
        missing_tables = [table for table in required_authoring if not _table_exists(table)]
        if missing_tables:
            raise CommandError(f'Missing authoring tables: {", ".join(missing_tables)}')

        result = self._analyse(options.get('resolution_file'))

        if options.get('write_resolution_template'):
            self._write_resolution_template(options['write_resolution_template'], result['ambiguous'])

        if apply_mode:
            self._apply(result)

        self._print_summary(result, apply_mode)

    def _load_rows(self):
        training_rows = _fetch_all(f'''
            select *
            from {views.table_name("Training_plan")}
            order by programme_display_order nulls last, "Program", cohort_display_order nulls last, "Cohort_name", start_date, id
        ''')
        for row in training_rows:
            row['_meta'] = views.extract_notes_meta(row.get('notes'))
        return {
            'training': training_rows,
            'modules': _fetch_all(f'''
                select *
                from {_authoring_table(views.AUTHORING_MODULES_TABLE)}
                order by programme_id nulls last, programme_name nulls last, cohort_id nulls last,
                         group_id nulls last, title nulls last, module_catalogue_id
            '''),
            'mappings': _fetch_all(f'select * from {_authoring_table(views.AUTHORING_KSB_MAPPINGS_TABLE)} order by module_catalogue_id, id'),
            'components': _fetch_all(f'select * from {_authoring_table(views.AUTHORING_COMPONENTS_TABLE)} order by module_catalogue_id, week_id, id'),
            'weeks': _fetch_all(f'select * from {_authoring_table(views.AUTHORING_WEEKS_TABLE)} order by module_catalogue_id, week_number, id'),
            'program_configs': _fetch_all(f'select * from {views.table_name("training_plan_program_configs")} order by name')
            if _table_exists('training_plan_program_configs') else [],
        }

    def _analyse(self, resolution_file=''):
        rows = self._load_rows()
        configs_by_id = views.program_config_by_id(rows['program_configs'])
        modules_by_id = {_clean(row.get('module_catalogue_id')): row for row in rows['modules'] if _clean(row.get('module_catalogue_id'))}
        indexes = self._build_indexes(rows['modules'])
        mapping_counts = Counter(_clean(row.get('module_catalogue_id')) for row in rows['mappings'])
        component_counts = Counter(_clean(row.get('module_catalogue_id')) for row in rows['components'])
        week_counts = Counter(_clean(row.get('module_catalogue_id')) for row in rows['weeks'])
        resolutions = self._load_resolutions(resolution_file) if resolution_file else {}

        result = {
            'already_linked': [],
            'newly_matchable': [],
            'unmatched': [],
            'ambiguous': [],
            'stale_legacy_references': [],
            'invalid_explicit_links': [],
            'skipped': [],
            'errors': [],
            'applied': [],
        }

        def choose(row, stage, candidates):
            unique_candidates = _sorted_unique(candidates)
            if not unique_candidates:
                return '', unique_candidates
            if len(unique_candidates) == 1:
                return unique_candidates[0], unique_candidates
            scored = sorted(
                (_candidate_score(candidate, mapping_counts, component_counts, week_counts), candidate)
                for candidate in unique_candidates
            )
            if len(scored) >= 2 and scored[-1][0] > scored[-2][0]:
                return scored[-1][1], unique_candidates
            manual = resolutions.get(_clean(row.get('id')))
            if manual:
                self._validate_manual_selection(row, manual, unique_candidates, modules_by_id, configs_by_id)
                return manual['selectedModuleCatalogueId'], unique_candidates
            result['ambiguous'].append(self._row_detail(row, configs_by_id, stage, unique_candidates, modules_by_id, 'Candidate score tie requires manual selection.'))
            return '', unique_candidates

        for row in rows['training']:
            try:
                module_name = _clean(row.get('module_name'))
                if not module_name:
                    result['skipped'].append(self._row_detail(row, configs_by_id, 'skipped', [], modules_by_id, 'Blank or malformed module name.'))
                    continue

                invalid_explicit = views.training_row_invalid_explicit_module_catalogue_id(row)
                if invalid_explicit:
                    result['invalid_explicit_links'].append(self._row_detail(row, configs_by_id, 'existing_column', [invalid_explicit], modules_by_id, 'Populated column value is not a valid MOD-... canonical ID.'))
                    continue

                stale_legacy = views.training_row_stale_legacy_module_catalogue_id(row)
                if stale_legacy:
                    result['stale_legacy_references'].append(self._row_detail(row, configs_by_id, 'legacy_notes', [stale_legacy], modules_by_id, 'Legacy note reference is not a valid MOD-... canonical ID.'))

                existing = views.training_row_module_catalogue_id(row)
                if existing:
                    if existing in modules_by_id:
                        result['already_linked'].append(self._row_detail(row, configs_by_id, 'existing_column', [existing], modules_by_id, 'Existing canonical link is valid.'))
                    else:
                        result['invalid_explicit_links'].append(self._row_detail(row, configs_by_id, 'existing_column', [existing], modules_by_id, 'Canonical column points to a missing authoring module.'))
                    continue

                training_id = _clean(row.get('id'))
                identity = views.programme_identity(row, configs_by_id)
                cohort = views.actual_cohort_identity(row, identity['name'])
                group = views.actual_group_identity(row, cohort['id']) if cohort else None
                scoped_key = (
                    views.normalise(identity.get('sourceId') or identity.get('name')),
                    views.normalise((cohort or {}).get('id') or (cohort or {}).get('name')),
                    views.normalise((group or {}).get('id') or (group or {}).get('name')),
                    views.normalise(module_name),
                )
                signature = views.training_row_delivery_signature(row, configs_by_id)
                title_key = views.normalise(module_name)
                title_candidates = indexes['by_title'].get(title_key, [])
                programme_title_candidates = [
                    candidate
                    for candidate in title_candidates
                    if self._candidate_in_training_programme(modules_by_id.get(candidate, {}), identity)
                ]

                candidate = ''
                matched_stage = ''
                matched_candidates = []
                for stage, candidates in (
                    ('source_id', indexes['by_source'].get(training_id, [])),
                    ('imported_from_training_plan_id', indexes['by_import'].get(training_id, [])),
                    ('programme_cohort_group_module', indexes['by_delivery_identity'].get(scoped_key, [])),
                    ('delivery_signature', indexes['by_signature'].get(signature, [])),
                    ('normalised_title_programme_scoped', programme_title_candidates),
                ):
                    before = len(result['ambiguous'])
                    candidate, considered_candidates = choose(row, stage, candidates)
                    if len(result['ambiguous']) > before or candidate:
                        matched_stage = stage
                        matched_candidates = considered_candidates
                        break
                if candidate:
                    result['newly_matchable'].append(self._row_detail(
                        row,
                        configs_by_id,
                        matched_stage,
                        [candidate],
                        modules_by_id,
                        'Canonical candidate selected by deterministic matching.',
                        total_candidate_count=len(matched_candidates) or 1,
                    ))
                elif not any(item.get('trainingPlanId') == row.get('id') for item in result['ambiguous']):
                    reason = self._unmatched_reason(row, rows['modules'], configs_by_id, stale_legacy)
                    result['unmatched'].append(self._row_detail(row, configs_by_id, 'unmatched', [], modules_by_id, reason))
            except CommandError:
                raise
            except Exception as exc:
                result['errors'].append({'trainingPlanId': row.get('id'), 'error': str(exc)})
        return result

    def _build_indexes(self, module_rows):
        indexes = {
            'by_source': defaultdict(list),
            'by_import': defaultdict(list),
            'by_delivery_identity': defaultdict(list),
            'by_signature': defaultdict(list),
            'by_title': defaultdict(list),
        }
        for row in module_rows:
            module_id = _clean(row.get('module_catalogue_id'))
            if not module_id:
                continue
            if _clean(row.get('source_type')) == 'training_plan' and _clean(row.get('source_id')):
                indexes['by_source'][_clean(row.get('source_id'))].append(module_id)
            if _clean(row.get('imported_from_training_plan_id')):
                indexes['by_import'][_clean(row.get('imported_from_training_plan_id'))].append(module_id)
            indexes['by_delivery_identity'][
                (
                    views.normalise(row.get('programme_id') or row.get('programme_name')),
                    views.normalise(row.get('cohort_id') or row.get('cohort_name')),
                    views.normalise(row.get('group_id') or row.get('group_name')),
                    views.normalise(row.get('title')),
                )
            ].append(module_id)
            signature = views.authoring_row_delivery_signature(row)
            if signature:
                indexes['by_signature'][signature].append(module_id)
            indexes['by_title'][views.normalise(row.get('title'))].append(module_id)
        return indexes

    def _candidate_in_training_programme(self, module, identity):
        if not module:
            return False
        return views.identity_values_overlap(
            [module.get('programme_id'), module.get('programme_name')],
            [identity.get('sourceId'), identity.get('name')],
        )

    def _row_detail(self, row, configs_by_id, stage, candidates, modules_by_id, reason, total_candidate_count=None):
        identity = views.programme_identity(row, configs_by_id)
        cohort = views.actual_cohort_identity(row, identity['name'])
        group = views.actual_group_identity(row, cohort['id']) if cohort else None
        candidate_metadata = [self._candidate_metadata(modules_by_id.get(candidate, {})) for candidate in candidates if modules_by_id.get(candidate)]
        cross_programme = [
            item['moduleCatalogueId']
            for item in candidate_metadata
            if not views.identity_values_overlap([item.get('programmeId'), item.get('programmeName')], [identity.get('sourceId'), identity.get('name')])
        ]
        return {
            'trainingPlanId': row.get('id'),
            'trainingPlanRowId': row.get('id'),
            'programmeId': identity.get('sourceId') or '',
            'programmeName': identity.get('name') or '',
            'cohortId': (cohort or {}).get('id') or '',
            'cohortName': (cohort or {}).get('name') or '',
            'groupId': (group or {}).get('id') or '',
            'groupName': (group or {}).get('name') or '',
            'moduleTitle': row.get('module_name') or '',
            'existingModuleCatalogueId': views.training_row_module_catalogue_id(row),
            'existingLegacyReference': views.training_row_stale_legacy_module_catalogue_id(row),
            'staleLegacyModuleId': views.training_row_stale_legacy_module_catalogue_id(row),
            'invalidExplicitModuleId': views.training_row_invalid_explicit_module_catalogue_id(row),
            'candidateModuleCatalogueIds': _sorted_unique(candidates),
            'candidateMetadata': sorted(candidate_metadata, key=lambda item: item.get('moduleCatalogueId') or ''),
            'candidateCount': total_candidate_count if total_candidate_count is not None else len(_sorted_unique(candidates)),
            'matchingStrategy': stage,
            'crossProgrammeCheck': 'failed' if cross_programme else ('passed' if candidates else 'not_applicable'),
            'confidence': self._confidence_for_stage(stage),
            'sourceReferences': {
                'trainingPlanId': _clean(row.get('id')),
                'legacyModuleId': views.training_row_stale_legacy_module_catalogue_id(row),
                'notesMeta': row.get('_meta') or {},
            },
            'stage': stage,
            'reason': reason,
        }

    def _confidence_for_stage(self, stage):
        if stage in {'source_id', 'imported_from_training_plan_id', 'programme_cohort_group_module', 'delivery_signature'}:
            return 'High'
        if stage == 'normalised_title_programme_scoped':
            return 'Medium'
        if stage == 'skipped':
            return 'Not applicable'
        return 'Low'

    def _candidate_metadata(self, row):
        module_id = _clean(row.get('module_catalogue_id'))
        week_count = self._count_rows(views.AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_id]) if module_id else 0
        component_count = self._count_rows(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_id]) if module_id else 0
        live_session_count = self._count_rows(
            views.AUTHORING_COMPONENTS_TABLE,
            "module_catalogue_id = %s and lower(coalesce(type, '')) in ('live_session', 'live-session', 'live session')",
            [module_id],
        ) if module_id else 0
        mapping_count = self._count_rows(views.AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [module_id]) if module_id else 0
        completion_present = self._count_rows(views.AUTHORING_COMPLETION_TABLE, 'module_catalogue_id = %s', [module_id]) > 0 if module_id and _table_exists(views.AUTHORING_COMPLETION_TABLE) else False
        advanced_present = self._count_rows(views.AUTHORING_ADVANCED_TABLE, 'module_catalogue_id = %s', [module_id]) > 0 if module_id and _table_exists(views.AUTHORING_ADVANCED_TABLE) else False
        referenced_rows = [
            item.get('id')
            for item in _fetch_all(
                f'select id from {views.table_name("Training_plan")} where module_catalogue_id = %s order by id',
                [module_id],
            )
        ] if module_id else []
        is_empty_shell = not any([week_count, component_count, mapping_count, completion_present, advanced_present])
        return {
            'moduleCatalogueId': module_id,
            'title': row.get('title') or '',
            'programmeId': row.get('programme_id') or '',
            'programmeName': row.get('programme_name') or '',
            'cohortId': row.get('cohort_id') or '',
            'cohortName': row.get('cohort_name') or '',
            'groupIds': [row.get('group_id')] if row.get('group_id') else [],
            'groupName': row.get('group_name') or '',
            'sourceType': row.get('source_type') or '',
            'sourceId': row.get('source_id') or '',
            'authoringStatus': row.get('status') or '',
            'weekCount': week_count,
            'componentCount': component_count,
            'liveSessionCount': live_session_count,
            'ksbMappingCount': mapping_count,
            'completionCriteriaPresent': completion_present,
            'advancedDetailsPresent': advanced_present,
            'createdAt': str(row.get('created_at') or ''),
            'updatedAt': str(row.get('updated_at') or ''),
            'isEmptyShell': is_empty_shell,
            'emptyShell': is_empty_shell,
            'referencedTrainingPlanRowIds': referenced_rows,
        }

    def _count_rows(self, table, where_sql, params):
        return len(_fetch_all(f'select 1 from {_authoring_table(table)} where {where_sql}', params))

    def _load_resolutions(self, path):
        data = json.loads(Path(path).read_text())
        entries = data.get('resolutions', data if isinstance(data, list) else [])
        return {
            _clean(item.get('trainingPlanId') or item.get('trainingPlanRowId')): item
            for item in entries
            if _clean(item.get('selectedModuleCatalogueId'))
        }

    def _validate_manual_selection(self, row, manual, candidates, modules_by_id, configs_by_id):
        selected = _clean(manual.get('selectedModuleCatalogueId'))
        if selected not in candidates:
            raise CommandError(f'Training_plan {row.get("id")} selected module {selected} is not one of the ambiguous candidates.')
        module = modules_by_id.get(selected)
        if not module:
            raise CommandError(f'Training_plan {row.get("id")} selected module {selected} does not exist.')
        identity = views.programme_identity(row, configs_by_id)
        if not views.identity_values_overlap(
            [module.get('programme_id'), module.get('programme_name')],
            [identity.get('sourceId'), identity.get('name')],
        ):
            raise CommandError(f'Training_plan {row.get("id")} selected module {selected} is outside the delivery programme.')

    def _write_resolution_template(self, path, ambiguous_rows):
        payload = {
            'instructions': 'Fill selectedModuleCatalogueId with one of candidateModuleCatalogueIds after manual review. Leave blank to keep unresolved.',
            'resolutions': [
                {
                    **item,
                    'selectedModuleCatalogueId': '',
                }
                for item in ambiguous_rows
            ],
        }
        Path(path).write_text(json.dumps(payload, indent=2, default=str))
        self.stdout.write(f'Wrote ambiguous resolution template: {path}')

    def _unmatched_reason(self, row, module_rows, configs_by_id, stale_legacy):
        identity = views.programme_identity(row, configs_by_id)
        cohort = views.actual_cohort_identity(row, identity['name'])
        group = views.actual_group_identity(row, cohort['id']) if cohort else None
        if not identity.get('sourceId'):
            return 'Stale legacy reference with missing programme ID.' if stale_legacy else 'Missing programme ID.'
        if not cohort or not group:
            return 'Stale legacy reference with missing cohort or group identity.' if stale_legacy else 'Missing cohort or group identity.'
        title_key = views.normalise(row.get('module_name'))
        title_matches = [module for module in module_rows if views.normalise(module.get('title')) == title_key]
        if not title_matches:
            return 'Stale legacy reference with no matching authoring title.' if stale_legacy else 'No authoring module with matching title.'
        programme_matches = [
            module for module in title_matches
            if views.identity_values_overlap([module.get('programme_id'), module.get('programme_name')], [identity.get('sourceId'), identity.get('name')])
        ]
        if not programme_matches:
            return 'Stale legacy reference with cross-programme candidate only.' if stale_legacy else 'Cross-programme candidate only.'
        delivery_matches = [
            module for module in programme_matches
            if views.normalise(module.get('cohort_id') or module.get('cohort_name')) == views.normalise((cohort or {}).get('id') or (cohort or {}).get('name'))
            and views.normalise(module.get('group_id') or module.get('group_name')) == views.normalise((group or {}).get('id') or (group or {}).get('name'))
        ]
        if not delivery_matches:
            return 'Stale legacy reference with delivery identity mismatch.' if stale_legacy else 'Programme-scoped title match exists but delivery identity differs.'
        return 'Delivery-only module with no deterministic authoring record.'

    def _schema_mismatch_reasons(self):
        column_rows = _fetch_all(
            '''
            select table_schema, table_name, column_name, data_type, character_maximum_length,
                   is_nullable, column_default
            from information_schema.columns
            where table_schema = %s and table_name = %s and column_name = %s
            ''',
            [views.CURRICULUM_SCHEMA, 'Training_plan', views.TRAINING_MODULE_CATALOGUE_COLUMN],
        )
        reasons = []
        if not column_rows:
            return ['missing Training_plan.module_catalogue_id column']
        column = column_rows[0]
        expected = {
            'table_schema': views.CURRICULUM_SCHEMA,
            'table_name': 'Training_plan',
            'column_name': views.TRAINING_MODULE_CATALOGUE_COLUMN,
            'data_type': 'character varying',
            'character_maximum_length': 128,
            'is_nullable': 'YES',
            'column_default': None,
        }
        for key, value in expected.items():
            if column.get(key) != value:
                reasons.append(f'{key}={column.get(key)!r}, expected {value!r}')
        index_rows = _fetch_all(
            '''
            select schemaname, tablename, indexname, indexdef
            from pg_indexes
            where schemaname = %s and tablename = %s and indexname = %s
            ''',
            [views.CURRICULUM_SCHEMA, 'Training_plan', 'curriculum_training_plan_module_catalogue_idx'],
        )
        if not index_rows:
            reasons.append('missing curriculum_training_plan_module_catalogue_idx')
        else:
            indexdef = ' '.join(_clean(index_rows[0].get('indexdef')).lower().split())
            if 'unique index' in indexdef:
                reasons.append('index is unique')
            if 'module_catalogue_id' not in indexdef:
                reasons.append('index does not cover module_catalogue_id')
        return reasons

    def _apply(self, result):
        if result['invalid_explicit_links'] or result['ambiguous'] or result['errors']:
            raise CommandError('Apply refused: resolve invalid explicit links, ambiguous rows, and errors first.')
        with transaction.atomic():
            for item in result['newly_matchable']:
                training_id = item['trainingPlanId']
                candidate = item['candidateModuleCatalogueIds'][0]
                if not views.link_training_row_to_catalogue(training_id, candidate):
                    raise CommandError(f'Unable to link Training_plan {training_id} to {candidate}; transaction rolled back.')
                result['applied'].append(item)

    def _print_summary(self, result, apply_mode=False):
        labels = [
            ('Already linked', 'already_linked'),
            ('Newly matchable', 'newly_matchable'),
            ('Unmatched', 'unmatched'),
            ('Ambiguous', 'ambiguous'),
            ('Stale legacy references', 'stale_legacy_references'),
            ('Invalid explicit links', 'invalid_explicit_links'),
            ('Skipped', 'skipped'),
            ('Errors', 'errors'),
        ]
        for label, key in labels:
            self.stdout.write(f'{label}: {len(result[key])}')
        if result['unmatched']:
            self.stdout.write('Unmatched reasons:')
            reasons = defaultdict(list)
            for item in result['unmatched']:
                reasons[item['reason']].append(item['trainingPlanId'])
            for reason, ids in sorted(reasons.items()):
                self.stdout.write(f'- {reason}: {len(ids)} rows; samples: {", ".join(str(item) for item in ids[:10])}')
        if result['ambiguous']:
            self.stdout.write('Ambiguous rows require a resolution file; none were linked automatically.')
        if result['applied']:
            self.stdout.write(f'Applied links: {len(result["applied"])}')
        elif apply_mode:
            self.stdout.write('No Training_plan rows required updates.')
        elif not result['applied']:
            self.stdout.write('No Training_plan rows were updated in dry-run mode.')
