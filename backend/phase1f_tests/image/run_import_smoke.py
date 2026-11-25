"""Host-side static import bundle. Only reviewed Python sources enter runtime."""
import ast
import io
from pathlib import Path
import subprocess
import tarfile
import uuid

BACKEND = Path(__file__).resolve().parents[2]
CONTAINER = 'lms-phase1f-import-' + uuid.uuid4().hex[:10]
TARGETS = ['curriculum_api.' + name for name in (
    'views', 'learner_assignments', 'learner_status_counts', 'learning_storage',
    'home_summary', 'programme_list', 'upload_storage', 'catalogue_summary_reads',
    'teams_external_calendar')]
TARGETS += [
    'curriculum_api.catalogue.tests.free_course_write_postgresql',
    'curriculum_api.catalogue.tests.parity.test_free_course_writer_standalone',
    'curriculum_api.migrations.0084_free_course_authoring_prerequisites',
    'curriculum_api.migrations.0089_free_course_content_soft_delete',
    'curriculum_api.catalogue.tests.free_course_reads_postgresql',
    'curriculum_api.catalogue.tests.parity.test_free_course_reads_standalone',
    'curriculum_api.catalogue.tests.test_free_course_authoring_contract_no_db',
    'curriculum_api.catalogue.tests.test_free_course_authoring_endpoint_no_db',
    'curriculum_api.catalogue.tests.test_free_course_catalogue_no_db',
    'curriculum_api.catalogue.tests.test_free_course_catalogue_store_no_db',
    'curriculum_api.catalogue.tests.test_free_course_authoring_mutations_no_db',
    'curriculum_api.catalogue.tests.tests_free_course_authoring_postgres',
]
TARGETS += ['curriculum_api.catalogue.tests.test_database_read_composition_no_db',
            'curriculum_api.catalogue.tests.test_entry_composition_no_db',
            'curriculum_api.catalogue.tests.test_runtime_ownership_no_db',
            'curriculum_api.catalogue.tests.test_registry_composition_no_db',
            'curriculum_api.catalogue.tests.test_calendar_composition_no_db',
            'curriculum_api.catalogue.tests.test_cache_composition_no_db',
            'curriculum_api.catalogue.tests.test_overview_composition_no_db',
            'curriculum_api.test_read_entry_no_db',
            'curriculum_api.catalogue.tests.test_placement_names_composition_no_db',
            'curriculum_api.catalogue.tests.test_curriculum_names_no_db',
            'curriculum_api.catalogue.tests.test_catalogue_content_composition_no_db',
            'curriculum_api.catalogue.tests.test_authoring_workspace_composition_no_db']
TARGETS += ['curriculum_api.catalogue.application.overview',
            'curriculum_api.catalogue.tests.parity.read_entry_oracle',
            'curriculum_api.catalogue.application.overview_delivery',
            'curriculum_api.catalogue.api.overview',
            'curriculum_api.directory.application.assignment_counts',
            'curriculum_api.reporting.api.achievement_reads',
            'curriculum_api.reporting.api.coverage_reads',
            'curriculum_api.reporting.domain.readiness',
            'curriculum_api.catalogue.infrastructure.overview_reads',
            'curriculum_api.catalogue.tests.test_overview_boundary_no_db',
            'curriculum_api.meetings.tests.test_bulk_attendance_overview_no_db',
            'curriculum_api.catalogue.tests.test_curriculum_read_model_no_db',
            'curriculum_api.module_live', 'curriculum_api.content_cache']

TARGETS += ['curriculum_api.catalogue.application.programme_builder',
            'curriculum_api.catalogue.application.programme_structure',
            'curriculum_api.catalogue.application.resolution',
            'curriculum_api.catalogue.application.projections',
            'curriculum_api.catalogue.infrastructure.content_counts',
            'curriculum_api.catalogue.infrastructure.projection_sources',
            'curriculum_api.catalogue.domain.ranking',
            'curriculum_api.catalogue.tests.test_home_summary_no_db', 'curriculum_api.catalogue.tests.test_home_source_no_db',
            'curriculum_api.catalogue.tests.test_programme_list_no_db', 'curriculum_api.catalogue.tests.test_catalogue_reads_no_db',
            'curriculum_api.catalogue.tests.test_programme_ksb_source_no_db',
'learner_api.learning_plans.application.module_membership',
            'learner_api.learning_plans.infrastructure.membership_facts',
'learner_api.learning_plan', 'learner_api.active_users', 'login.sessions', 'login.identity',
            'learner_api.programme_access', 'old_otjh.gate', 'login.middleware', 'learner_api.learning_plans.domain.membership_policy', 'curriculum_api.cache_scope',
            'config.management_safety', 'curriculum_api.read_model', 'learner_api.routers']

TARGETS += ['curriculum_api.authoring_read_transport', 'curriculum_api.catalogue.application.programme_enrichment', 'curriculum_api.catalogue.application.programme_detail', 'curriculum_api.catalogue.application.home_projection', 'curriculum_api.catalogue.infrastructure.programme_reads', 'curriculum_api.catalogue.tests.test_programme_read_boundary_no_db', 'curriculum_api.catalogue.tests.tests_programme_detail_sections', 'curriculum_api.catalogue.tests.test_programme_modules_workspace_no_db', 'curriculum_api.catalogue.tests.test_programme_workspace_latency_no_db', 'curriculum_api.catalogue.tests.test_programme_workspace_text_no_db']

TARGETS += ['curriculum_api.catalogue.domain.module_selection',
            'curriculum_api.catalogue.application.module_projection',
            'curriculum_api.catalogue.application.module_assembly',
            'curriculum_api.catalogue.tests.test_module_read_boundary_no_db',
            'curriculum_api.catalogue.tests.test_curriculum_projection_performance_no_db',
            'curriculum_api.catalogue.tests.test_module_builder_latency_no_db',
            'curriculum_api.catalogue.tests.test_http_cache_no_db']

TARGETS += ['curriculum_api.catalogue.application.delivery_reads',
            'curriculum_api.catalogue.infrastructure.delivery_counts',
            'curriculum_api.catalogue.tests.test_delivery_read_boundary_no_db',
            'curriculum_api.catalogue.tests.test_shared_reads_no_db']

TARGETS += ['curriculum_api.catalogue.application.authoring_rows',
            'curriculum_api.catalogue.application.authoring_summaries',
            'curriculum_api.catalogue.infrastructure.grouped_content',
            'curriculum_api.catalogue.tests.test_authoring_read_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.application.structure_payloads',
            'curriculum_api.catalogue.infrastructure.component_reads',
            'curriculum_api.catalogue.tests.test_structure_read_boundary_no_db',
            'curriculum_api.catalogue.tests.test_structure_transport_no_db',
            'curriculum_api.module_merge',
            'curriculum_api.catalogue.tests.test_component_programme_view_no_db']

TARGETS += ['curriculum_api.catalogue.application.component_projection',
            'curriculum_api.catalogue.application.component_catalogue',
            'curriculum_api.catalogue.infrastructure.library_reads',
            'curriculum_api.catalogue.tests.test_component_catalogue_boundary_no_db',
            'curriculum_api.catalogue.tests.test_component_summary_no_db']

TARGETS += ['curriculum_api.catalogue.infrastructure.authoring_sql', 'curriculum_api.catalogue.infrastructure.authoring_reads', 'curriculum_api.catalogue.infrastructure.component_summary_reads', 'curriculum_api.catalogue.domain.component_summary', 'curriculum_api.catalogue.tests.test_read_adapters_boundary_no_db', 'curriculum_api.catalogue.tests.test_authoring_placement_names_no_db', 'curriculum_api.catalogue.tests.test_programme_modules_read_path_no_db', 'curriculum_api.catalogue.tests.test_ksb_description_deferred_no_db', 'curriculum_api.catalogue.tests.test_unified_reader_no_db']

TARGETS += ['curriculum_api.authoring_row_cache', 'curriculum_api.catalogue.infrastructure.authoring_transport', 'curriculum_api.catalogue.infrastructure.authoring_row_snapshots', 'curriculum_api.catalogue.tests.test_authoring_row_cache_no_db', 'curriculum_api.catalogue.tests.test_transport_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.application.structure_revisions',
            'curriculum_api.catalogue.infrastructure.structure_sources',
            'curriculum_api.catalogue.domain.structure_revision',
            'curriculum_api.catalogue.tests.test_revision_boundary_no_db']


TARGETS += ['curriculum_api.catalogue.application.record_revisions',
            'curriculum_api.catalogue.application.conflict_records',
            'curriculum_api.catalogue.infrastructure.record_revisions',
            'curriculum_api.catalogue.tests.test_record_revision_boundary_no_db', 'curriculum_api.record_snapshots']

TARGETS += ['curriculum_api.catalogue.application.week_templates',
            'curriculum_api.catalogue.infrastructure.week_templates',
            'curriculum_api.catalogue.tests.test_week_template_read_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.application.placement_records',
            'curriculum_api.catalogue.infrastructure.placement_records',
            'curriculum_api.catalogue.tests.test_placement_record_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.application.cohort_calendar',
            'curriculum_api.catalogue.domain.holiday_selection',
            'curriculum_api.catalogue.infrastructure.holiday_reads',
            'curriculum_api.catalogue.tests.test_cohort_calendar_boundary_no_db',
            'curriculum_api.calendar_policy', 'curriculum_api.delivery_calendar',
            'curriculum_api.country_calendars', 'curriculum_api.england_holidays']

TARGETS += ['curriculum_api.catalogue.application.inherited_calendar',
            'curriculum_api.catalogue.tests.test_inherited_calendar_boundary_no_db',
            'curriculum_api.catalogue.tests.tests_holiday_reading_weeks']

TARGETS += ['curriculum_api.catalogue.domain.session_plan',
            'curriculum_api.catalogue.application.session_plans',
            'curriculum_api.catalogue.tests.test_session_plan_boundary_no_db',
            'curriculum_api.catalogue.tests.test_session_plan_first_delivery_week_no_db',
            'curriculum_api.catalogue.tests.test_custom_weekly_schedule_no_db']

TARGETS += ['curriculum_api.catalogue.domain.delivery_pattern',
            'curriculum_api.catalogue.application.delivery_schedules',
            'curriculum_api.catalogue.application.session_calendar',
            'curriculum_api.catalogue.tests.test_delivery_schedule_boundary_no_db',
            'curriculum_api.catalogue.tests.test_tutor_availability_roster_no_db']

TARGETS += ['curriculum_api.catalogue.domain.tutor_conflicts',
            'curriculum_api.catalogue.application.tutor_availability',
            'curriculum_api.catalogue.infrastructure.tutor_reads',
            'curriculum_api.catalogue.tests.test_tutor_availability_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.domain.staff_identity',
            'curriculum_api.catalogue.application.staff_profiles',
            'curriculum_api.catalogue.application.staff_assignments',
            'curriculum_api.catalogue.tests.test_staff_assignment_reads_no_db',
            'curriculum_api.catalogue.infrastructure.staff_directory',
            'curriculum_api.catalogue.tests.test_staff_profiles_boundary_no_db']

TARGETS += ['curriculum_api.reporting.domain.ksb', 'curriculum_api.reporting.domain.otjh', 'curriculum_api.reporting.application.activity', 'curriculum_api.reporting.application.consumption', 'curriculum_api.reporting.infrastructure.progress', 'curriculum_api.reporting.infrastructure.reflections', 'curriculum_api.reporting.tests.test_reporting_boundary_no_db', 'curriculum_api.reporting.tests.tests_ksb_achievement', 'curriculum_api.reporting.tests.tests_scope_achievement', 'curriculum_api.reporting.tests.test_achievement_performance_no_db']


TARGETS += ['curriculum_api.reporting.application.queries', 'curriculum_api.reporting.application.achievement', 'curriculum_api.reporting.application.coverage', 'curriculum_api.reporting.application.supplementary', 'curriculum_api.reporting.api.responses', 'curriculum_api.reporting.infrastructure.achievement_cache', 'curriculum_api.reporting.infrastructure.supplementary', 'curriculum_api.reporting.tests.test_report_delivery_boundary_no_db', 'curriculum_api.reporting.tests.test_ksb_coverage_parts_no_db', 'curriculum_api.reporting.tests.test_coverage_summary_no_db', 'curriculum_api.reporting.tests.test_coverage_mapped_components_no_db', 'curriculum_api.reporting.tests.test_ksb_stats_latency_no_db', 'curriculum_api.catalogue.tests.test_programme_ksb_design_cache_no_db', 'curriculum_api.ksb_stats_reads', 'curriculum_api.learner_impact_summary']


TARGETS += ['curriculum_api.reporting.api.statistics', 'curriculum_api.reporting.application.programme_statistics', 'curriculum_api.reporting.application.source_catalogue', 'curriculum_api.reporting.application.source_projection', 'curriculum_api.reporting.domain.programme_statistics', 'curriculum_api.reporting.domain.sources', 'curriculum_api.reporting.infrastructure.statistics_cache', 'curriculum_api.reporting.infrastructure.statistics_reads', 'curriculum_api.reporting.tests.test_statistics_boundary_no_db', 'curriculum_api.catalogue.tests.test_ksb_mapping_placement_no_db']

TARGETS += ['curriculum_api.catalogue.domain.session_identity', 'curriculum_api.catalogue.application.session_links', 'curriculum_api.catalogue.infrastructure.session_reads', 'curriculum_api.catalogue.tests.test_session_enrichment_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.api.programme_detail', 'curriculum_api.catalogue.application.calendar_queries',
            'curriculum_api.catalogue.infrastructure.calendar_rows', 'curriculum_api.delivery_dashboard',
            'curriculum_api.calendar_read_rows', 'curriculum_api.catalogue.tests.tests_delivery_calendar_projection',
            'curriculum_api.catalogue.tests.tests_authored_live_sessions', 'curriculum_api.catalogue.tests.test_calendar_convergence_no_db', 'curriculum_api.catalogue.tests.test_delivery_dashboard_no_db']

TARGETS += ['curriculum_api.catalogue.application.scope_queries', 'curriculum_api.catalogue.infrastructure.scope_reads', 'curriculum_api.catalogue.application.scope_identity', 'curriculum_api.catalogue.application.ksb_projection', 'curriculum_api.catalogue.domain.component_settings', 'curriculum_api.catalogue.application.authoring_metadata', 'curriculum_api.catalogue.api.module_reads', 'curriculum_api.catalogue.application.structure_resolution', 'curriculum_api.catalogue.infrastructure.resolution_candidates', 'curriculum_api.catalogue.tests.test_module_workspace_boundary_no_db', 'curriculum_api.catalogue.tests.test_assignment_settings_schema_no_db']

TARGETS += ['curriculum_api.catalogue.tests.parity.test_component_settings_standalone', 'curriculum_api.meetings.tests.test_recording_settings_schema_no_db']

TARGETS += ['curriculum_api.catalogue.tests.test_projection_consumer_boundary_no_db']


TARGETS += ['curriculum_api.catalogue.tests.test_required_read_failures_no_db']


def source(module):
    path = BACKEND.joinpath(*module.split('.'))
    return path.with_suffix('.py') if path.with_suffix('.py').is_file() else path / '__init__.py'

TARGETS += ['curriculum_api.catalogue.application.programme_modules', 'curriculum_api.catalogue.domain.programme_scope', 'curriculum_api.catalogue.tests.test_programme_sources_no_db']

TARGETS += ['curriculum_api.catalogue.api.ksb_sources', 'curriculum_api.reporting.tests.test_ksb_identity_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.tests.test_module_get_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.tests.test_read_runtime_boundary_no_db', 'curriculum_api.catalogue.tests.test_cache_latency_no_db', 'curriculum_api.catalogue.tests.test_cache_scope_no_db', 'curriculum_api.catalogue.tests.test_archive_index_no_db', 'curriculum_api.catalogue.api.archive_reads', 'curriculum_api.catalogue.api.cached_reads', 'curriculum_api.catalogue.api.read_responses', 'curriculum_api.catalogue.application.archive_queries', 'curriculum_api.catalogue.application.cached_reads', 'curriculum_api.catalogue.application.free_course_projection', 'curriculum_api.catalogue.application.placement_lineage', 'curriculum_api.catalogue.domain.archive_visibility', 'curriculum_api.catalogue.infrastructure.archive_reads', 'curriculum_api.catalogue.infrastructure.payload_cache', 'curriculum_api.catalogue.infrastructure.read_scope', 'curriculum_api.catalogue.infrastructure.schema_reads']

TARGETS += ['curriculum_api.directory.infrastructure.assigned_reads', 'curriculum_api.directory.application.assigned_reads', 'curriculum_api.directory.domain.placement', 'curriculum_api.directory.application.queries', 'curriculum_api.directory.api.queries', 'curriculum_api.directory.domain.progress', 'curriculum_api.directory.application.progress', 'curriculum_api.catalogue.application.tutor_workspace', 'curriculum_api.catalogue.infrastructure.workspace_reads', 'curriculum_api.catalogue.api.tutor_workspace', 'curriculum_api.learner_directory', 'curriculum_api.learner_directory_details', 'curriculum_api.directory.tests.test_directory_workspace_boundary_no_db', 'curriculum_api.directory.tests.tests_learner_directory', 'curriculum_api.directory.tests.test_learner_directory_details_no_db', 'learner_api.my_learning', 'learner_api.canonical_learning']

TARGETS += ['curriculum_api.directory.application.assignment_queries', 'curriculum_api.directory.infrastructure.assignment_reads', 'curriculum_api.directory.infrastructure.registration_reads', 'curriculum_api.directory.application.status_queries', 'curriculum_api.directory.infrastructure.lineage_reads', 'learner_api.learning_plans.infrastructure.plan_reads', 'curriculum_api.directory.api.progress', 'curriculum_api.directory.tests.test_progress_membership_boundary_no_db', 'curriculum_api.directory.tests.tests_learner_assignments', 'curriculum_api.directory.tests.test_learner_status_counts_no_db', 'curriculum_api.directory.tests.test_learner_status_count_performance_no_db', 'curriculum_api.directory.tests.test_learner_placement_joins_no_db', 'learner_api.test_manual_roster_mode_no_db']

TARGETS += ['curriculum_api.catalogue.domain.content_validation', 'curriculum_api.catalogue.application.content_validation', 'curriculum_api.catalogue.tests.test_content_validation_boundary_no_db', 'learner_api.free_course_catalogue']

TARGETS += ['curriculum_api.catalogue.domain.attachment_content',
            'curriculum_api.catalogue.domain.structure_changes',
            'curriculum_api.catalogue.application.attachment_preparation',
            'curriculum_api.catalogue.application.course_conversion',
            'curriculum_api.catalogue.infrastructure.attachment_reads',
            'curriculum_api.catalogue.tests.test_attachment_preparation_boundary_no_db']

TARGETS += [
    'curriculum_api.catalogue.api.authoring_guards',
    'curriculum_api.catalogue.api.delivery_scope',
    'curriculum_api.catalogue.application.content_preparation',
    'curriculum_api.catalogue.application.hierarchy_preparation',
    'curriculum_api.catalogue.application.hierarchy_queries',
    'curriculum_api.catalogue.application.lifecycle_checks',
    'curriculum_api.catalogue.domain.content_values',
    'curriculum_api.catalogue.domain.hierarchy_dates',
    'curriculum_api.catalogue.domain.hierarchy_values',
    'curriculum_api.catalogue.infrastructure.free_course_reads',
    'curriculum_api.catalogue.infrastructure.lifecycle_reads',
    'curriculum_api.catalogue.tests.test_hierarchy_preparation_boundary_no_db',
]

TARGETS += [
    'curriculum_api.catalogue.api.audit_assets',
    'curriculum_api.catalogue.application.audit_assets',
    'curriculum_api.catalogue.domain.asset_values',
    'curriculum_api.catalogue.infrastructure.audit_asset_reads',
    'curriculum_api.programme_audit',
    'curriculum_api.quality',
    'curriculum_api.reporting.api.history',
    'curriculum_api.reporting.application.history_projection',
    'curriculum_api.reporting.domain.history_values',
    'curriculum_api.reporting.domain.ksb_coverage',
    'curriculum_api.reporting.infrastructure.history_reads',
    'curriculum_api.reporting.tests.test_quality_assets_boundary_no_db',
    'curriculum_api.reporting.tests.tests_lean_log',
    'curriculum_api.reporting.tests.tests_programme_audit_ui_materials',
    'system_audit.derived',
    'system_audit.pages',
    'system_audit.writes',
]

TARGETS += ['curriculum_api.reporting.tests.test_revision_history_boundary_no_db', 'curriculum_api.reporting.tests.tests_versioning']
TARGETS += [
    'curriculum_api.reporting.domain.snapshot_values',
    'curriculum_api.reporting.domain.snapshot_changes',
    'curriculum_api.reporting.domain.snapshot_context',
    'curriculum_api.reporting.domain.revision_contracts',
    'curriculum_api.reporting.infrastructure.revision_reads',
    'curriculum_api.reporting.infrastructure.history_queries',
    'curriculum_api.reporting.application.history_results',
    'curriculum_api.catalogue.domain.module_merge',
]

TARGETS += ['curriculum_api.catalogue.api.media_delivery',
            'curriculum_api.catalogue.application.presentation_reads',
            'curriculum_api.catalogue.infrastructure.presentation_sources']

TARGETS += ['curriculum_api.catalogue.infrastructure.' + name for name in (
    'schema_relations', 'schema_projection', 'sql_compatibility', 'ksb_placement_reads',
)]
TARGETS += ['curriculum_api.catalogue.tests.test_schema_read_boundary_no_db']

TARGETS += ['curriculum_api.catalogue.tests.test_cache_ownership_boundary_no_db']
TARGETS += ['curriculum_api.catalogue.infrastructure.' + name for name in (
    'runtime_state', 'cache_epochs', 'cache_invalidation', 'cache_runtime',
)]


TARGETS += ['curriculum_api.catalogue.api.programme_commands', 'curriculum_api.catalogue.api.cohort_commands', 'curriculum_api.catalogue.api.group_commands', 'curriculum_api.catalogue.application.hierarchy_commands', 'curriculum_api.catalogue.infrastructure.hierarchy_writes', 'curriculum_api.catalogue.domain.hierarchy_values', 'curriculum_api.catalogue.application.programme_tree', 'curriculum_api.catalogue.tests.test_hierarchy_commands_boundary_no_db', 'curriculum_api.catalogue.tests.test_entity_rename_no_db', 'curriculum_api.placement_rename', 'curriculum_api.cohort_rename', 'curriculum_api.catalogue.tests.test_group_coaches_no_db', 'curriculum_api.catalogue.tests.test_group_list_reads_no_db']


TARGETS += ['curriculum_api.module_collaboration']

TARGETS += ['curriculum_api.catalogue.api.lifecycle_commands',
            'curriculum_api.catalogue.application.programme_lifecycle',
            'curriculum_api.catalogue.application.programme_deletion',
            'curriculum_api.catalogue.application.module_lifecycle',
            'curriculum_api.catalogue.infrastructure.lifecycle_writes',
            'curriculum_api.catalogue.infrastructure.quiz_lifecycle',
            'curriculum_api.catalogue.tests.test_lifecycle_commands_boundary_no_db',
            'curriculum_api.catalogue.tests.tests_module_delete_flags']

TARGETS += ['curriculum_api.catalogue.infrastructure.authoring_schema',
            'curriculum_api.catalogue.infrastructure.authoring_writes',
            'curriculum_api.catalogue.application.authoring_persistence',
            'curriculum_api.catalogue.application.free_programme_commands',
            'curriculum_api.catalogue.api.free_programme_commands',
            'curriculum_api.catalogue.api.week_template_commands',
            'curriculum_api.catalogue.tests.test_authoring_storage_boundary_no_db',
            'curriculum_api.catalogue.tests.test_free_course_catalogue_store_no_db',
            'curriculum_api.test_schema_gate_no_db',
            'curriculum_api.catalogue.infrastructure.free_course_contract']

TARGETS += ['curriculum_api.catalogue.api.module_commands',
            'curriculum_api.catalogue.api.module_structure',
            'curriculum_api.catalogue.application.module_authoring',
            'curriculum_api.catalogue.application.component_authoring',
            'curriculum_api.catalogue.infrastructure.module_cover',
            'curriculum_api.catalogue.tests.test_module_commands_boundary_no_db']


TARGETS += ['curriculum_api.catalogue.' + name for name in (
    'infrastructure.content_uploads', 'infrastructure.content_source_writes',
    'application.component_resources', 'api.content_commands', 'api.content_uploads',
)]
TARGETS += ['curriculum_api.catalogue.tests.test_content_commands_boundary_no_db',
            'curriculum_api.catalogue.tests.test_ksb_mapping_writes_no_db']

TARGETS += ['curriculum_api.catalogue.' + name for name in (
    'infrastructure.row_persistence', 'infrastructure.write_notifications',
    'application.programme_configuration',
)]
TARGETS += ['curriculum_api.catalogue.tests.test_row_persistence_boundary_no_db',
            'curriculum_api.catalogue.tests.test_content_cache_no_db']

TARGETS += ['curriculum_api.catalogue.' + name for name in (
    'api.holiday_commands', 'api.cohort_preview', 'infrastructure.holiday_store',
)]
TARGETS += ['curriculum_api.catalogue.tests.test_holiday_boundary_no_db',
            'curriculum_api.catalogue.tests.test_calendar_holidays_no_db']


TARGETS += ['curriculum_api.catalogue.tests.test_session_editing_boundary_no_db', 'curriculum_api.catalogue.tests.test_numbered_session_headers_no_db']
TARGETS += ['curriculum_api.catalogue.' + name for name in ('api.calendar_editing', 'application.session_plan_updates', 'application.staff_assignment_writes', 'infrastructure.session_writes', 'domain.week_session_dates')]

TARGETS += ['curriculum_api.meetings.' + n for n in (
    'api.creation', 'api.scheduling', 'api.results', 'application.attachment',
    'application.reconciliation', 'tests.layout_oracle', 'tests.source_loader')]

TARGETS += ['curriculum_api.meetings.' + name for name in (
    'api.calendar', 'api.module_links', 'api.serialization',
    'application.calendar_status', 'application.shared_delivery',
    'domain.calendar_policy', 'infrastructure.session_reads',
    'infrastructure.session_writes', 'tests.calendar_oracle',
)]

TARGETS += ['curriculum_api.meetings.' + name for name in (
    'api.content_delivery',
    'api.recording_tracking',
    'application.artifact_identity',
    'application.calendar_publication',
    'application.invitation_preparation',
    'application.meeting_options',
    'domain.attendance_policy',
    'domain.invitation_policy',
    'domain.recurrence_policy',
    'infrastructure.artifact_storage',
    'infrastructure.graph_identity',
    'infrastructure.graph_payloads',
    'infrastructure.graph_reads',
    'tests.delivery_oracle',
)]


TARGETS += ['curriculum_api.' + name for name in (
    'meetings.api.change_notifications',
    'meetings.api.invitees',
    'meetings.api.lifecycle',
    'meetings.application.delivery_validation',
    'meetings.application.invitee_queries',
    'meetings.domain.module_delivery',
    'meetings.infrastructure.invitee_reads',
    'meetings.infrastructure.lifecycle_reads',
    'meetings.infrastructure.tracking_schema',
    'meetings.tests.lifecycle_oracle',
    'meetings.tests.policy_composition_oracle',
    'meetings.domain.instants',
    'meetings.api.time_serialization',
)]


TARGETS += ['curriculum_api.catalogue.tests.test_read_consumer_imports_no_db', 'learner_api.test_assignment_read_boundary_no_db', 'learner_api.test_group_preset_relations_no_db']
TARGETS += ['learner_api.learning_plans.tests.integration.test_assignment_reads_import_isolated']
TARGETS += ['curriculum_api.catalogue.tests.parity.approved_dev_contracts']
TARGETS += ['curriculum_api.catalogue.tests.parity.component_count_contracts',
            'curriculum_api.catalogue.tests.component_counts_postgresql']
TARGETS += ['curriculum_api.catalogue.tests.ksb_native_preparation_postgresql']
TARGETS += ['curriculum_api.catalogue.tests.parity.native_ksb_contracts']
TARGETS += ['curriculum_api.migrations.0091_module_week_boundary_mode']

def bundle():
    readers = ['curriculum_api.' + name for name in (
        'attendance_membership', 'authoring_row_cache', 'catalogue_activity', 'module_progress_metrics',
        'programme_audit', 'programme_ksb_stats_batch', 'quality', 'read_model', 'record_snapshots',
        'review_management.application.otjh_queries')]
    readers += ['learner_api.free_courses_view', 'old_otjh.repository']
    pending, seen, files = list(TARGETS) + readers, set(), set()
    while pending:
        module = pending.pop()
        path = source(module)
        if module in seen or not path.is_file():
            continue
        seen.add(module)
        files.add(path)
        for parent in path.parents:
            if parent == BACKEND:
                break
            if (parent / '__init__.py').is_file():
                files.add(parent / '__init__.py')
        def inspect(node):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return
            if isinstance(node, ast.Import):
                pending.extend(alias.name for alias in node.names if source(alias.name).is_file())
            if isinstance(node, ast.ImportFrom):
                base = node.module or ''
                if node.level:
                    parts = module.split('.') if path.name == '__init__.py' else module.split('.')[:-1]
                    base = '.'.join(parts[:len(parts)-node.level+1] + ([base] if base else []))
                pending.extend(name for name in [base] + [base+'.'+a.name for a in node.names]
                               if source(name).is_file())
            for child in ast.iter_child_nodes(node):
                inspect(child)
        inspect(ast.parse(path.read_text(encoding='utf-8-sig')))
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        # The explicit isolated migration regression loads this owned SQL file.
        # Bundling it does not run migrations or application schema preparation.
        relative = 'curriculum_api/catalogue/infrastructure/free_course_storage.sql'
        archive.add(BACKEND / relative, arcname='phase1f/backend/' + relative)
        fixture = 'curriculum_api/catalogue/tests/fixtures/read_consumer_imports.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        count_fixture = 'curriculum_api/catalogue/tests/fixtures/component_count_compatibility_fix.json'
        archive.add(BACKEND / count_fixture, arcname='phase1f/backend/' + count_fixture)
        native_ksb_fixture = 'curriculum_api/catalogue/tests/fixtures/native_ksb_preparation_fix.json'
        archive.add(BACKEND / native_ksb_fixture, arcname='phase1f/backend/' + native_ksb_fixture)
        free_read_fixture = 'curriculum_api/catalogue/tests/fixtures/free_course_read_boundary.json'
        archive.add(BACKEND / free_read_fixture, arcname='phase1f/backend/' + free_read_fixture)
        fixture = 'curriculum_api/catalogue/tests/fixtures/approved_dev_source_deltas.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        fixture = 'curriculum_api/meetings/tests/fixtures/policy_composition_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        archive.add(BACKEND / 'phase1f_tests/image/session_editing_postgresql.py', arcname='phase1f/session_editing_postgresql.py')
        fixture = 'curriculum_api/meetings/tests/fixtures/lifecycle_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        fixture = 'curriculum_api/meetings/tests/fixtures/delivery_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        fixture = 'curriculum_api/meetings/tests/fixtures/calendar_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        fixture = 'curriculum_api/meetings/tests/fixtures/legacy_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        fixture = 'curriculum_api/meetings/tests/fixtures/approved_dev_99f81.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        fixture = 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/session_editing_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        archive.add(BACKEND / 'phase1f_tests/image/holiday_boundary_postgresql.py',
                    arcname='phase1f/holiday_boundary_postgresql.py')
        fixture = 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/holiday_boundary_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        archive.add(BACKEND / 'phase1f_tests/image/row_persistence_postgresql.py',
                    arcname='phase1f/row_persistence_postgresql.py')
        fixture = 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/row_persistence_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        archive.add(BACKEND / 'phase1f_tests/image/content_commands_postgresql.py',
                    arcname='phase1f/content_commands_postgresql.py')
        fixture = 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/content_commands_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
        # ServiceError imports the booking catalogue. Use an empty synthetic
        # asset; never copy real staff identities or provider links into tests.
        booking_asset = b'{"coaches": []}'
        booking_entry = tarfile.TarInfo('phase1f/backend/old_otjh/data/coach_bookings.json')
        booking_entry.size = len(booking_asset)
        archive.addfile(booking_entry, io.BytesIO(booking_asset))
        for path in sorted(files):
            assert not path.name.startswith('settings')
            archive.add(path, arcname='phase1f/backend/' + path.relative_to(BACKEND).as_posix())
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_identity_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_identity_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_builder_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_builder_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_reads_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_reads_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_reads_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_reads_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/delivery_reads_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/delivery_reads_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/authoring_reads_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/authoring_reads_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/structure_reads_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/structure_reads_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/component_catalogue_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/component_catalogue_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/read_adapters_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/read_adapters_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/transport_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/transport_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/revisions_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/revisions_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/record_revisions_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/record_revisions_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/review_management/tests/fixtures/instance_boundary.json',
                    arcname='phase1f/backend/curriculum_api/review_management/tests/fixtures/instance_boundary.json')
        archive.add(BACKEND / 'curriculum_api/review_management/tests/fixtures/otjh_pdf_boundary.json',
                    arcname='phase1f/backend/curriculum_api/review_management/tests/fixtures/otjh_pdf_boundary.json')
        archive.add(BACKEND / 'curriculum_api/review_management/tests/fixtures/retired_review_exports.json',
                    arcname='phase1f/backend/curriculum_api/review_management/tests/fixtures/retired_review_exports.json')
        archive.add(BACKEND / 'curriculum_api/review_management/tests/fixtures/template_schedule_boundary.json',
                    arcname='phase1f/backend/curriculum_api/review_management/tests/fixtures/template_schedule_boundary.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/week_templates_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/week_templates_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/placement_records_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/placement_records_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cohort_calendar_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cohort_calendar_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/inherited_calendar_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/inherited_calendar_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/session_plans_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/session_plans_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/delivery_schedules_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/delivery_schedules_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/tutor_availability_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/tutor_availability_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/staff_profiles_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/staff_profiles_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/reporting/tests/fixtures/legacy_snapshots/delivery_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/reporting/tests/fixtures/legacy_snapshots/delivery_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/reporting/tests/fixtures/legacy_snapshots/snapshot.json',
                    arcname='phase1f/backend/curriculum_api/reporting/tests/fixtures/legacy_snapshots/snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/session_enrichment_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/session_enrichment_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_sources_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_sources_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/directory/tests/fixtures/legacy_snapshots/progress_membership_snapshot.json', arcname='phase1f/backend/curriculum_api/directory/tests/fixtures/legacy_snapshots/progress_membership_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/directory/tests/fixtures/legacy_snapshots/boundary_snapshot.json', arcname='phase1f/backend/curriculum_api/directory/tests/fixtures/legacy_snapshots/boundary_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/read_runtime_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/read_runtime_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_get_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_get_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_workspace_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_workspace_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_http_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/programme_http_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/overview_snapshot.json',
                    arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/overview_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/reporting/tests/fixtures/legacy_snapshots/ksb_identity_snapshot.json', arcname='phase1f/backend/curriculum_api/reporting/tests/fixtures/legacy_snapshots/ksb_identity_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/reporting/tests/fixtures/legacy_snapshots/statistics_snapshot.json', arcname='phase1f/backend/curriculum_api/reporting/tests/fixtures/legacy_snapshots/statistics_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/reporting/tests/fixtures/legacy_snapshots/statistics_reads_snapshot.json', arcname='phase1f/backend/curriculum_api/reporting/tests/fixtures/legacy_snapshots/statistics_reads_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/content_validation_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/content_validation_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/attachment_preparation_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/attachment_preparation_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/hierarchy_preparation_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/hierarchy_preparation_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/reporting/tests/fixtures/legacy_snapshots/quality_assets_snapshot.json', arcname='phase1f/backend/curriculum_api/reporting/tests/fixtures/legacy_snapshots/quality_assets_snapshot.json')
        archive.add(Path(__file__).with_name('quality_assets_postgresql.py'), arcname='phase1f/quality_assets_postgresql.py')
        archive.add(Path(__file__).with_name('assignment_reads_postgresql.py'), arcname='phase1f/assignment_reads_postgresql.py')
        archive.add(BACKEND / 'curriculum_api/reporting/tests/fixtures/legacy_snapshots/revision_history_snapshot.json', arcname='phase1f/backend/curriculum_api/reporting/tests/fixtures/legacy_snapshots/revision_history_snapshot.json')
        archive.add(Path(__file__).with_name('revision_history_postgresql.py'), arcname='phase1f/revision_history_postgresql.py')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/schema_read_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/schema_read_snapshot.json')
        archive.add(Path(__file__).with_name('schema_reads_postgresql.py'), arcname='phase1f/schema_reads_postgresql.py')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/projection_consumers_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/projection_consumers_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_authoring_facts_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_authoring_facts_snapshot.json')
        archive.add(Path(__file__).with_name('import_smoke.py'), arcname='phase1f/import_smoke.py')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cache_ownership_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cache_ownership_snapshot.json')
        archive.add(Path(__file__).with_name('cache_ownership_postgresql.py'), arcname='phase1f/cache_ownership_postgresql.py')
        archive.add(Path(__file__).with_name('hierarchy_commands_postgresql.py'), arcname='phase1f/hierarchy_commands_postgresql.py')
        archive.add(Path(__file__).with_name('module_commands_postgresql.py'), arcname='phase1f/module_commands_postgresql.py')
        archive.add(Path(__file__).with_name('lifecycle_commands_postgresql.py'), arcname='phase1f/lifecycle_commands_postgresql.py')
        archive.add(Path(__file__).with_name('authoring_storage_postgresql.py'), arcname='phase1f/authoring_storage_postgresql.py')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/content_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/content_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/workspace_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/workspace_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/placement_names_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/placement_names_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/entry_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/entry_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/runtime_ownership_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/runtime_ownership_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/registry_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/registry_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/calendar_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/calendar_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cache_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cache_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/overview_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/overview_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/read_entry_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/read_entry_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cache_lifecycle_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/cache_lifecycle_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/final_bindings_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/final_bindings_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/authoring_composition_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/authoring_composition_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/authoring_storage_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/authoring_storage_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/lifecycle_commands_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/lifecycle_commands_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_commands_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/module_commands_snapshot.json')
        archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/hierarchy_commands_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/hierarchy_commands_snapshot.json')
        integration = Path(__file__).with_name('integration.py')
        if integration.exists():
            archive.add(integration, arcname='phase1f/integration.py')
            snapshot = BACKEND / 'learner_api/learning_plans/tests/fixtures/legacy_snapshots/membership_preintegration_snapshot.json'
            archive.add(snapshot, arcname='phase1f/backend/learner_api/learning_plans/tests/fixtures/legacy_snapshots/membership_preintegration_snapshot.json')
            facts = BACKEND / 'learner_api/learning_plans/tests/fixtures/legacy_snapshots/learner_facts_prebatch02.json'
            archive.add(facts, arcname='phase1f/backend/learner_api/learning_plans/tests/fixtures/legacy_snapshots/learner_facts_prebatch02.json')
            archive.add(BACKEND / 'learner_api/learning_plans/tests/fixtures/legacy_snapshots/assignment_reads_snapshot.json', arcname='phase1f/backend/learner_api/learning_plans/tests/fixtures/legacy_snapshots/assignment_reads_snapshot.json')
            archive.add(BACKEND / 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/prebatch03_snapshot.json', arcname='phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/prebatch03_snapshot.json')
    print('Bundled Python files:', len(files), flush=True)
    return stream.getvalue()

if __name__ == '__main__':
    payload = bundle()
    subprocess.run(['docker', 'run', '-d', '--name', CONTAINER, '--network', 'none',
                    '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL',
                    '--security-opt', 'no-new-privileges', '--entrypoint', 'sleep',
                    'lms-phase1f-python:3.14.3', 'infinity'], check=True)
    try:
        subprocess.run(['docker', 'inspect', CONTAINER, '--format',
                        'network={{.HostConfig.NetworkMode}} ports={{json .HostConfig.PortBindings}} mounts={{json .Mounts}}'], check=True)
        subprocess.run(['docker', 'exec', '-i', CONTAINER, 'tar', '-xf', '-', '-C', '/tmp'], input=payload, check=True)
        result = subprocess.run(['docker', 'exec', CONTAINER, 'python', '-I', '-B', '/tmp/phase1f/import_smoke.py'])
    finally:
        subprocess.run(['docker', 'rm', '-f', CONTAINER], check=True)
    raise SystemExit(result.returncode)
