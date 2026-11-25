"""Compatibility exports for curriculum URLs and existing consumers.

Feature owners provide the HTTP handlers and their concrete runtime bindings.
The schema-state reset remains here for existing test setup callers.
"""
from .catalogue.api.cache_lifecycle import (
    invalidate_curriculum_cache, warm_curriculum_caches, _curriculum_warm_loop, schedule_curriculum_warm,
)
from .catalogue.api.overview_composition import (
    build_curriculum_payload, build_curriculum_overview, build_curriculum_payload_from_rows, _build_curriculum_payload_from_rows,
)
from .directory.infrastructure.assignment_count_runtime import (
    attach_module_assignment_counts,
)
from .catalogue.infrastructure.runtime_config import (
    CURRICULUM_WARM_ENABLED, CURRICULUM_WARM_DELAY_SECONDS,
)
from .catalogue.domain.archive_policy import row_has_deleted_at, programme_deleted_row, active_week_rows, active_mapping_rows
from .catalogue.domain.content_values import active_component_rows
from .catalogue.infrastructure.authoring_sql import live_authoring_rows_sql
from .meetings.domain.invitation_policy import (
    teams_attendee_emails,
    teams_series_email_list,
    teams_newly_invited,
    forward_teams_invitation,
    teams_warning_sentence,
)
from .meetings.domain.recurrence_policy import (
    teams_recurrence_weekdays,
    teams_event_recurrence,
    teams_scheduled_occurrence_starts,
    teams_recurrence_slot_count,
    teams_calendar_minute_key,
    teams_shifted_occurrence_targets,
    vacated_occurrence_keys,
    tracked_occurrence_keys,
)
from .meetings.domain.attendance_policy import (
    closest_live_occurrence,
    launch_linked_live_occurrence,
    attendance_identity,
    attendance_display_name,
    merge_attendance_intervals,
    attendance_roster,
    attendance_report_rosters,
    safe_float,
)
from .meetings.domain.calendar_policy import (
    scheduled_live_session_occurrences,
    occurrence_session_number,
    pair_planned_occurrences,
)
from .meetings.domain.instants import (
    parse_graph_datetime,
)
from .meetings.api.time_serialization import (
    utc_iso_value,
    stamp_live_session_instants,
    LIVE_SESSION_INSTANT_FIELDS,
)
from .catalogue.infrastructure.authoring_sql import (
    derived_programme_name_sql, derived_placement_names_sql,
    PROGRAMME_NAME_DERIVED_TABLES, PLACEMENT_NAME_DERIVED_COLUMNS,
)
from .catalogue.infrastructure.database_reads import (
    rows_as_dicts,
    fetch_all,
    quote_ident,
    table_name,
    column_names,
    has_column,
    table_exists,
    authoring_table_name,
    reset_learner_schema_cache,
    learner_schema_table_exists,
    learner_relation_exists,
    learner_schema_columns,
    curriculum_in_clause,
    CURRICULUM_SCHEMA,
    _TABLE_COLUMNS_CACHE,
    _TABLE_EXISTS_CACHE,
    LEARNER_SCHEMA_COLUMNS_TTL_SECONDS,
    _LEARNER_TABLES_PRESENT,
    _LEARNER_RELATIONS_PRESENT,
    _LEARNER_SCHEMA_COLUMNS,
    _LEARNER_SCHEMA_LOCK,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_COMPLETION_TABLE,
    AUTHORING_ADVANCED_TABLE,
)
from .catalogue.application.authoring_metadata import (
    advanced_response,
    completion_response,
    default_completion_payload,
)
from .catalogue.application.cohort_calendar import (
    cohort_holiday_details,
    holiday_row_sort_key,
    holidays_within_period,
    serialize_england_holiday_row,
    serialize_holiday_row,
    sorted_holidays,
)
from .catalogue.application.component_projection import (
    component_rows_for_programme_page,
    component_rows_without_content,
    component_week_label,
    sort_rows_by_updated_at_desc,
)
from .catalogue.application.delivery_schedules import (
    build_group_schedule,
    group_schedule_value,
)
from .catalogue.application.free_course_projection import (
    free_programme_component_response,
)
from .catalogue.application.inherited_calendar import (
    scheduling_holidays_from,
)
from .catalogue.application.module_projection import (
    curriculum_module_from_authoring_payload,
    module_rows_with_week_outline,
    normalise_programme_config_cohort,
    normalise_programme_config_group,
)
from .catalogue.application.programme_structure import (
    _empty_programme_structure_counts,
)
from .catalogue.application.scope_identity import (
    authoring_row_delivery_signature,
    authoring_summary_delivery_signature,
    dedupe_authoring_module_rows,
    module_delivery_signature,
    module_matches_programme,
    module_matches_visible_programmes,
    programme_identifier_looks_exact,
    training_row_delivery_signature,
    training_row_matches_programme_identifier,
)
from .catalogue.application.session_plans import (
    holiday_details_by_date,
)
from .catalogue.application.staff_profiles import (
    staff_user_profile_source,
)
from .catalogue.application.tutor_availability import (
    tutor_conflict_message,
)
from .catalogue.application.week_templates import (
    week_template_component_metrics,
    week_template_component_payload,
    week_template_number,
    week_template_payload,
)
from .catalogue.domain.attachment_content import (
    empty_authoring_week,
    first_clean_payload_value,
    identity_ids_conflict,
    identity_values_match_context,
    module_cohort_date_error,
    module_structure_component_count,
    payload_week_list,
    resize_authoring_week_structure,
    resize_authoring_week_structure_preserving_content,
    week_holds_authored_content,
)
from .catalogue.domain.component_settings import (
    allowed_component_setting_keys,
    component_settings_defaults,
    normalise_component_settings_payload,
)
from .catalogue.domain.component_summary import (
    js_round,
)
from .catalogue.domain.component_types import (
    is_retired_component_type,
    normalise_component_type,
)
from .catalogue.domain.content_validation import (
    active_components_payload,
    component_expected_otjh,
    component_resource_url,
    display_component_type,
    frontend_component_type,
    host_matches,
    http_url,
    partial_read_errors,
    payload_reflection_question,
    stored_component_type,
    without_retired_components,
)
from .catalogue.domain.content_values import (
    authoring_comparable,
    authoring_mapping_owner,
    authoring_mapping_signature,
    authoring_row_differs,
    component_coach_validation,
    component_expected_otjh_minutes,
    normalise_ksb_weight,
    normalise_ksb_weight_class,
    otjh_hours_from_minutes,
    otjh_rounded_minutes,
    parse_week_number,
    payload_coach_validation,
    training_module_identifier,
    week_template_scope_fields,
)
from .catalogue.domain.delivery_identity import (
    actual_cohort_identity,
    actual_group_identity,
    detail_is_archived,
)
from .catalogue.domain.delivery_pattern import (
    clock_time_plus_minutes,
    parse_clock_minutes,
    schedule_day_part,
    schedule_time_parts,
    tutor_delivery_schedule,
)
from .catalogue.domain.hierarchy_dates import (
    apprenticeship_end_override_sent,
    calculate_apprenticeship_end_date,
    calculate_cohort_end_date,
    cohort_apprenticeship_end_date,
    cohort_delivery_window,
    cohort_epa_dates,
    cohort_practical_end_date,
    format_created_at,
    holiday_extension_breakdown,
    holiday_extension_days,
    infer_duration_months,
    module_calendar_end_date,
    module_soft_start_date,
    parse_apprenticeship_end_override,
    parse_epa_months,
    payload_apprenticeship_end_override,
    payload_epa_months,
    shift_date_by_months,
)
from .catalogue.domain.hierarchy_values import (
    append_notes_meta,
    canonical_programme_name,
    clean_tree_remove_ids,
    curriculum_identifier_candidates,
    extract_notes_meta,
    find_programme,
    get_module_session_names,
    group_tutor_from_module_names,
    infer_level,
    is_actual_delivery_row,
    matches_curriculum_identifier,
    module_archive_parent_markers,
    module_row_belongs_to_group,
    normalise_programme_status,
    parse_notes_id_list,
    parse_required_otjh,
    payload_required_otjh,
    programme_config_id,
    programme_config_json_list,
    programme_identifier_candidates,
    programme_status_is_active,
    programme_status_is_archived,
    programme_structure_type,
    programme_summary_is_archived,
    remove_notes_meta,
    row_meta_value,
    stamp_datetime,
    unique_row_values,
    visible_notes,
)
from .catalogue.domain.holiday_selection import (
    cohort_holiday_period_end,
    date_ranges_overlap,
    holiday_row_archived,
    holiday_row_source,
)
from .catalogue.domain.module_selection import (
    curriculum_item_richness,
    module_belongs_to_group,
    unique_curriculum_items,
)
from .catalogue.domain.programme_identity import (
    programme_config_identity,
    programme_identity,
)
from .catalogue.domain.ranking import (
    authoring_summary_score,
    best_authoring_summary,
)
from .catalogue.domain.read_contracts import (
    AUTHORED_HOLIDAY_COLOR,
    AUTHORING_COMPARE_IGNORED_COLUMNS,
    AUTHORING_JSON_COMPARE_COLUMNS,
    BANK_HOLIDAY_COLOR,
    BANK_HOLIDAY_TYPE,
    COMPONENT_CONTENT_SETTING_KEYS,
    COMPONENT_SETTINGS_OMITTED_FLAG,
    DEFAULT_SESSION_START_TIME,
    HOLIDAY_SOURCE_AUTHORED,
    HOLIDAY_SOURCE_GOVUK,
    LEGACY_REFLECTION_QUESTION_SETTING,
    PROGRAMME_PAGE_DROPPED_FIELDS,
    PROGRAMME_PAGE_SETTING_KEYS,
    PROGRAMME_VIEW_OMITTED_MARKER,
    RETIRED_COMPONENT_TYPES,
    SUPPORTED_KSB_WEIGHT_CLASSES,
    WEEKDAY_INDEX,
    WEEK_OUTLINE_MODULE_FLAG,
    WEEK_OUTLINE_WEEK_FLAG,
    WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN,
)
from .catalogue.domain.session_identity import (
    meaningful_session_names,
    resolved_live_session_date,
)
from .catalogue.domain.session_plan import (
    holiday_date_set,
    parse_delivery_days,
)
from .catalogue.domain.staff_identity import (
    clean_assignment_ids,
    is_blank_staff_assignment,
    is_blank_staff_text,
    module_assignment_ids,
    module_matches_staff_assignment,
    staff_assignment_key,
    staff_profile_email,
    staff_profile_identity_key,
    staff_profile_is_archived,
    staff_profile_name,
    staff_user_archived,
)
from .catalogue.domain.structure_changes import (
    component_assurance_flag,
)
from .catalogue.domain.tutor_conflicts import (
    module_schedule_assignment_changed,
    module_time_window,
    tutor_conflict_override_requested,
)
from .catalogue.domain.values import (
    as_json_value,
    bool_payload,
    clean_str,
    falsey,
    format_date,
    normalise,
    parse_date,
    parse_float,
    parse_int,
    parse_json_value,
    slugify,
    truthy,
    unique,
)
from .catalogue.domain.component_settings import (
    CONTENT_AUTHORING_STATUSES, BASE_COMPONENT_SETTINGS, COMPONENT_SETTINGS_SCHEMA, LEGACY_SETTING_KEYS, RECORDING_SOURCE_SETTING_KEYS, LIVE_SESSION_TRACKING_SETTING_KEYS
)
from config.time_zones import calendar_zone, local_clock_to_utc
import base64
import contextlib
import functools
import hashlib
import inspect
import json
import logging
import math
import mimetypes
import calendar
import os
import re
import threading
import tempfile
import sys
import time
import uuid
from collections import Counter, OrderedDict, defaultdict
from datetime import date, datetime, timedelta, timezone
from html import escape
from pathlib import Path
from urllib import parse as urllib_parse
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db import DatabaseError, IntegrityError, connection, connections, transaction
from django.core.serializers.json import DjangoJSONEncoder
from django.http import FileResponse, Http404, HttpResponse, HttpResponseNotModified, HttpResponseRedirect, JsonResponse, StreamingHttpResponse
from django.utils.text import get_valid_filename
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_GET
from django.views.decorators.gzip import gzip_page
from django.views.decorators.clickjacking import xframe_options_sameorigin
from login.permissions import require_role, require_access, require_all_access
from . import archive_state
from .canonical_read_sql import module_expected_otjh_sql
from . import curriculum_names
from curriculum_api import calendar_holidays
from curriculum_api.catalogue.infrastructure import free_course_rows as free_course_catalogue
from curriculum_api import ksb_mapping_placement
from curriculum_api import schema_compat
from curriculum_api import write_shape
from . import group_coaches
from curriculum_api.catalogue.infrastructure.free_course_catalogue_store import FreeCourseInUse
from .weekly_schedule import module_weekly_schedule, merged_weekly_schedule, module_week_starts_on, merged_week_starts_on, first_weekly_session_day
from .catalogue.infrastructure import runtime_state as cache_state
from .catalogue.infrastructure.storage_context import native_only
from .catalogue.infrastructure.course_storage_reads import with_course_storage
from .course_pricing import API_FIELDS as COURSE_PRICING_FIELDS, pricing_payload, pricing_values
from curriculum_api.catalogue.infrastructure import free_course_pricing as free_course_pricing
from .teams_weekly_calendar import calendar_groups, save_weekday_calendar, stored_calendar_series, graph_event_utc
from .teams_options_retry import microsoft_update_summary
from .session_overrides import apply_session_overrides, override_clock, session_overrides
from .session_artifact_placement import recording_matches_occurrence
from .attendance_identity import keep_directory_lookup, resolve_directory_accounts
from .teams_calendar_checks import (CalendarMismatch, attendee_differences, attendees_already_match, calendar_targets, event_organizer_address,
                                    graph_calendar_time, local_calendar_recurrence, publish_attendees, remove_attendees_silently,
                                    safe_teams_join_url,
                                    dropped_sessions_sentence, sessions_a_rewrite_would_drop,
                                    unconfirmed_attendee_detail, utc_datetime, verify_calendar)
from learner_api.ksb_exclusions import and_not_excluded
from learner_api.progress_rules import (
    progress_achievement_status,
    progress_counts_as_achieved,
)
from learner_api.models import LearnerProfile, LearnerTrainingPlanModule
from learner_api.constants import (
    ACCESS_CURRICULUM,
    ACCESS_FREE_COURSE_AUTHORING,
    PROGRAMME_STATUS_CHOICES,
)
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import LEGACY
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import current_mode
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import require_mode
from . import pptx_slides
from . import schema_gate
from . import shared_build
from . import versioning
from . import upload_storage
from . import tutor_notifications
from .schema_gate import SchemaNotProvisioned
from .ksb_coverage import (
    SUPPORTED_CLASSIFICATIONS,
    build_coverage,
    float_weight,
    ksb_sort_key,
    ksb_type_from_value,
    normalise_classification as coverage_normalise_classification,
    normalise_code as coverage_normalise_code,
)
from .learner_ksb_sync import sync_progress_ksbs
from .http_cache import (
    conditional_json_response, encode_json_bytes, encode_json_entry, encode_json_error_entry,
    plain_json_response, query_flag, query_list, query_value,
)
from .catalogue.api.adapters import (
    request_bypasses_curriculum_cache, reference_json_response, tutor_assignment_delivery_day_error,
    tutor_conflict_error, group_tutor_assignment_delivery_day_error, paginate_curriculum_results,
    curriculum_collection_response, curriculum_results_response, requested_expected_revision,
    authoring_summary_catalogue_item, curriculum_cache_epoch, curriculum_preview_cohort_end_date,
    request_reads_after_write, canonical_programme_detail_issues, ai_material_response,
    curriculum_week_component_upload, uploads_relative_path, parse_byte_range,
    curriculum_presentation_slides, office_preview_link, curriculum_upload_storage_error,
    curriculum_office_preview_file, curriculum_uploaded_file, permanent_delete_reference_refusal,
    holiday_date_payload,
)
from .catalogue.api.responses import (
    json_body, json_error, curriculum_visibility,
    csv_param, record_conflict_response, module_merge_conflict_response,
)
from .catalogue.domain.archive_values import (
    archived_at, archive_stamp_fields,
)
from .catalogue.domain.component_policy import (
    component_mapping_identity, component_builder_settings,
)
from .catalogue.domain.delivery_values import (
    is_operational_training_row, delivery_status_for_training_row, delivery_days_per_week,
    module_stored_week_count, module_stored_session_count, module_session_clock,
    attachment_week_count, attachment_session_count,
)
from .catalogue.domain.programme_values import (
    is_archived_program_config, programme_status_from_payload, programme_config_status,
    program_config_by_id, program_config_preference, preferred_program_config_by_name,
    is_placeholder_programme_id, sanitised_programme_id,
)
from .catalogue.domain.read_contracts import (
    TRAINING_MODULE_CATALOGUE_COLUMN, CANONICAL_MODULE_ID_PATTERN, CURRICULUM_CHANGE_LOG_KEY,
    CURRICULUM_CHANGE_LOG_SIZE, COMPONENT_UPLOAD_MAX_BYTES, COMPONENT_UPLOAD_EXTENSIONS,
    MODULE_COVER_UPLOAD_SLOT, LIFECYCLE_KEY_COLUMNS, PROGRAMME_PERMANENT_DELETE_LEARNER_LINKS,
    MODULE_INDEX_EXCLUDED_COLUMNS, MODULE_INDEX_ORDER, WEEK_INDEX_COLUMNS,
    PLACEHOLDER_PROGRAMME_IDS, AUTHORED_HOLIDAYS_TABLE, STAFF_ACCESS_ROLES,
    STAFF_USER_ACCESS_COLUMNS, DEFAULT_SESSION_END_TIME, ENGLAND_HOLIDAYS_TABLE,
    COMPACT_MODULE_OMITTED_KEYS, COMPACT_MODULE_LIST_FIELDS, FREE_PROGRAMME_COMPONENTS_TABLE,
    SHARED_TEAMS_DELIVERY_SETTING_KEYS, COMPONENT_SUMMARY_COLUMNS, COMPONENT_SUMMARY_WEEK_COLUMNS,
    COMPONENT_SUMMARY_MODULE_COLUMNS, LIBRARY_ORIGIN_ACTIVE, LIBRARY_ORIGIN_ARCHIVED,
    LIBRARY_ORIGIN_LIBRARY, LIBRARY_ORIGINS, ADDITIONAL_MEETING_SETTING_KEYS,
    STRUCTURE_REVISION_VOLATILE_COLUMNS, MODULE_ARCHIVE_EVENT_WINDOW, COMPONENT_FULL_READ_PAGE_ROWS,
    COMPONENT_DB_OMITTED_KEYS_COLUMN, PROGRAMME_SECTION_WARM_LIMIT, PROGRAMME_WORKSPACE_MODULE_FIELDS,
    PROGRAMME_WORKSPACE_WEEK_FIELDS, OFFICE_PREVIEW_EXTENSIONS, OFFICE_PREVIEW_SALT,
    OFFICE_PREVIEW_MAX_AGE_SECONDS, MODULE_COVER_FILE_PATH, COVERAGE_PART_MAPPING_FIELDS,
    PROGRESS_LINEAGE_COLUMN_BY_SCOPE, ACHIEVEMENT_INPUTS_MAX_AGE_SECONDS, _ACHIEVEMENT_LEARNER_IDS,
    _MODULE_WEEK_IDS, _MODULE_COMPONENT_IDS, PERMANENT_DELETE_REFERENCES,
    MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE, WEEK_TEMPLATES_TABLE,
)
from .catalogue.domain.row_values import (
    link_training_row_to_catalogue, require_fields, curriculum_name_only_patch,
    authoring_row_is_active, narrow_learners_to_placement, iso_or_blank,
)
from .catalogue.infrastructure.cache_composition import (
    _write_log_fields, log_curriculum_decision, log_curriculum_storage,
    ensure_curriculum_epoch_table, local_shared_curriculum_epoch, read_shared_curriculum_epoch_row,
    shared_curriculum_epoch, record_curriculum_change, recent_curriculum_changes,
    structure_payloads_cache_key,
)
from .catalogue.infrastructure.calendar_runtime import (
    build_module_session_plan, holiday_table_name, authored_holiday_table_name,
    module_delivery_row, module_week_delivery_days, calendar_clock_to_utc_iso,
    module_schedule_view, module_delivery_day_gap, england_holiday_exists,
)
from .catalogue.infrastructure.content_runtime import (
    duplicate_mapping_query, ensure_authoring_mapping_unique, validate_mapping_duplicates,
    authoring_component_counts_by_catalogue, component_reflection_question, component_builder_response,
    component_summary_source_rows, component_summary_ksb_codes, component_is_published,
    component_summary_rows, library_component_origin, library_component_where,
    live_component_rows_without_content, authoring_module_content_counts, free_programme_week_payload,
    free_programme_component_payload, _quiz_reference_id, build_free_course_week_structure,
    _scrub_free_course_learner_assignments, build_module_free_course_weeks, _free_module_response_to_input,
    component_source_inputs_fingerprint,
)
from .catalogue.infrastructure.lifecycle_runtime import (
    soft_delete_payload, restore_soft_delete_payload, deleted_sql_condition,
    archive_payload, restore_payload, curriculum_row_effectively_deleted,
    programme_dependency_counts, archived_rows_under, curriculum_where_any,
    curriculum_ids_matching, orphan_programme_name_clause, programme_permanent_delete_blockers,
    programme_permanent_delete_plan, programme_config_rows_remaining, request_wants_permanent_programme_delete,
    request_wants_forced_programme_delete, surviving_authoring_module_rows, archived_authoring_ids,
    module_withdrawn_on_its_own, module_archive_event_bounds, row_in_module_archive,
    module_authoring_row_is_archived, is_archived_module_summary, soft_deleted_structure_ids,
    request_wants_permanent_delete, curriculum_row_is_archived, archived_authoring_rows,
    permanent_delete_reference_blockers, archived_module_rows, archived_module_component_counts,
)
from .catalogue.infrastructure.media_runtime import (
    safe_upload_segment, component_upload_metadata, component_uploaded_video_url,
    ai_material_record,
)
from .catalogue.infrastructure.placement_runtime import (
    unique_group_id, title_case_status, unique_program_configs_for_display,
    programme_config_for_programme, staff_users_table_reference, fetch_staff_users_by_access,
    get_tutor_module_rows, with_group_coaches, module_in_progress,
    profile_module_summary, assigned_modules_for_staff, serialize_staff_profile,
    safe_group_delivery_rows, serialize_group_authoring_detail, group_authoring_detail_rows,
    compact_module_list_rows, fetch_cohort_row, fetch_group_row,
    resolve_cohort_row, resolve_group_row, cohort_record_revision,
    group_record_revision, cohort_conflict_record, group_conflict_record,
    scope_programme_identifier, curriculum_cohort_from_authoring_detail, curriculum_group_from_authoring_detail,
    staff_profile_assignment_ids, tutor_workspace_module_payload, tutor_workspace_session_payload,
)
from .catalogue.infrastructure.record_identity import (
    now_iso, unique_prefixed_id, unique_timestamp_prefixed_id,
    unique_program_id, unique_ksb_profile_id, canonical_authoring_id,
    unique_module_catalogue_id, record_revision, free_programme_course_id,
)
from .catalogue.infrastructure.row_queries import (
    execute_returning, programme_config_key_column, module_index_read,
    module_index_rows, safe_module_index_rows, authoring_rows_by_id,
    training_index_reads, get_authoring_module_rows, training_row_where_ids,
    safe_authoring_module_rows, json_db_value, authoring_child_rows_for_modules,
    week_scope_module_ids,
)
from .catalogue.infrastructure.runtime_config import (
    logger, write_logger, CURRICULUM_WRITE_TRACE,
    _PROGRAMMES_REF, _COHORTS_REF, GROUP_ROWS_ORDER,
    COHORT_ROWS_ORDER, _PROGRAMME_KSB_DESIGN_FORCE, STRUCTURE_REVISION_SOURCES,
    _PROGRAMME_SECTION_WARM_TARGETS, _PROGRAMME_SECTION_WARM_LOCK,
)
from .catalogue.infrastructure.structure_runtime import (
    ensure_columns, is_canonical_module_catalogue_id, training_row_column_module_catalogue_id,
    training_row_invalid_explicit_module_catalogue_id, training_row_module_catalogue_id, written_rows,
    note_previous_content_modules, programme_authoring_module_rows, authoring_modules_as_training_rows,
    authoring_modules_as_catalogue_rows, get_module_rows, build_modules,
    compact_module_rows, module_authoring_quality_check, mapping_response,
    training_row_by_id, module_structure_uses_session_rows, module_delivery_week_count,
    module_structure_source_rows, with_item_fingerprints, free_programme_module_response,
    home_programmes_need_enrichment, note_programme_section_read, programme_modules_workspace_payload,
    learners_link_programme_by_id, learners_link_placement_by_id,
)
from .meetings.api.adapters import (
    external_teams_calendar_refusal, curriculum_teams_meeting_occurrence_schedule, parse_client_event_time,
    teams_delivery_metadata_from_weeks, teams_delivery_metadata_from_live_session_row, live_session_row_to_component_settings,
    occurrence_local_start, occurrence_local_date, live_occurrence_component_settings,
    module_future_teams_sessions, module_teams_calendar_block_response,
)
from .meetings.domain.read_contracts import (
    LIVE_SESSIONS_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, LIVE_SESSION_ARTIFACTS_TABLE,
    LIVE_SESSION_JOIN_LAUNCHES_TABLE, GRAPH_SILENT_INVITE_HEADERS, GRAPH_WINDOWS_TO_IANA,
    LIVE_SESSION_TYPE_SQL, LIVE_SESSION_MEETING_SCOPE_KEY, LIVE_SESSION_MEETING_SCOPES,
    LIVE_SESSION_SCHEDULE_FIELDS,
)
from .meetings.infrastructure.calendar_runtime import (
    teams_meeting_default_organizer, teams_new_meeting_organizer, teams_event_body_html,
    teams_online_meeting_owner_id, graph_timezone_iana, teams_schedule_settings,
    verify_teams_calendar_with_standalones, publish_teams_calendar_attendees, teams_meeting_base_path,
    module_has_external_teams_calendar, held_schedule_snapshot, teams_series_invited,
    stored_leftover_slots, strip_shared_teams_delivery_settings, teams_module_owner_id,
    shared_teams_component_settings, apply_shared_teams_settings_to_weeks, live_session_booked_on_module_calendar,
    module_has_booked_series, preserve_additional_meeting_settings, active_teams_series_for_join_link,
    module_has_active_teams_series, utc_iso_or_blank,
)
from .meetings.infrastructure.session_runtime import (
    saved_live_session_occurrences, teams_single_occurrence_payload, flag_teams_occurrence_leftovers,
    live_session_meeting_groups, live_session_join_launches, graph_item_with_occurrence_link,
    attendance_interval_seconds, _same_artifact_under_new_graph_id, live_session_recording_graph_base,
    module_live_session_clock, live_session_component_points, live_session_meeting_scope,
    replaceable_live_session, module_structure_live_session_counts, module_live_sessions_affected,
)
from .reporting.api.adapters import (
    curriculum_ksb_framework_detail, curriculum_ksb_set_definitions, curriculum_ksb_sets,
)
from .reporting.domain.hours_values import (
    otjh_number, apply_reflection_otjh_to_learners, scope_authored_plan,
    learner_plan_group_key, learner_authored_plan, learner_plans_for_scope,
    scope_otjh_summary,
)
from .reporting.domain.read_contracts import (
    KSB_TYPE_FAMILIES,
)
from .reporting.domain.source_values import (
    codes_from_session_ksb, ksb_type_label, normalise_ksb_type,
    normalise_ksb_code, full_ksb_code, get_ksb_profile_for_program,
    active_ksb_profiles, programme_config_ksb_source, ksb_profile_required_codes,
    ksb_profile_source_id, normalise_ksb_profile_source_value, ksb_profile_context_ids,
    normalise_skills_england_type, format_skills_england_funding, skills_england_ksb_sort_key,
    skills_england_standard_id, split_ksb_source, standard_required_ksb_definitions,
    source_payload_from_mapping, source_type_label, source_type_mismatch_message,
    scope_programme_id, parse_ksb_weights, merge_ksb_totals,
    ksb_type_family, ksb_achievement_by_type, scope_ksb_achievement,
)
from .reporting.infrastructure.progress_runtime import (
    progress_scope_predicate, out_of_scope_progress_count, achieved_outcome_predicate,
    progress_consumption_rows, learner_progress_ksb_consumption, reflection_submission_ksb_consumption,
    progress_evidence_index, learner_activity_trace, learner_activity_plan,
    learner_consumption_payload, _achievement_query, achievement_inputs_fingerprint,
)
from .reporting.infrastructure.source_runtime import (
    programme_applied_ksb_profile, forced_programme_ksb_design, build_ksb_data,
    normalise_ksb_classification, legacy_weight_class_from_classification, component_ksb_mapping_json_item,
    component_ksb_mapping_api_item, component_ksb_mappings_from_row, coverage_part_mapping,
    learner_progress_ksb_totals, learner_declared_ksb_codes,
)
from .catalogue.api.query_adapters import (
    curriculum_standards, curriculum_standard_detail, archived_programme_module_edit_error,
    curriculum_component_summary, curriculum_archived_groups, curriculum_tutor_workspace,
    week_template_detail_response,
)
from .catalogue.domain.read_contracts import (
    CURRICULUM_CACHE_TTL_SECONDS, CURRICULUM_ROWS_CACHE_TTL_SECONDS, NON_DELIVERY_WEEKEND_MESSAGE,
    STRUCTURE_REVISION_UNAVAILABLE, COMPONENT_DERIVED_SETTING_KEYS, PROGRAMME_VIEW_EXCLUDED_COLUMNS,
    PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS,
)
from .catalogue.infrastructure.cache_access import (
    scoped_curriculum_read, refresh_curriculum_generations, write_shared_curriculum_epoch_bump,
    drop_scoped_curriculum_entries, bump_shared_curriculum_epoch, begin_curriculum_write_scope,
    end_curriculum_write_scope, programme_cache_generation, cached_curriculum_value,
)
from .catalogue.infrastructure.catalogue_sources import (
    get_training_rows, get_ksb_profile_rows, get_program_config_rows_raw,
    get_program_config_rows, get_holiday_rows, _scoped_holiday_rows,
    get_holiday_rows_safe, england_non_delivery_reason, get_staff_profile_rows,
    get_tutor_rows, get_coach_rows, canonical_staff_assignment_name,
    resolve_staff_assignment_email, get_curriculum_rows, get_required_curriculum_rows,
    active_learner_programme_counts, delivery_learner_count, active_learner_delivery_counts,
    get_cached_curriculum_rows, training_rows_by_id, programme_list_sources,
    programme_list_learner_counts, find_staff_profile_row, tutor_profile_for_identity,
)
from .catalogue.infrastructure.component_composition import (
    validate_ksb_mapping_payload, component_builder_rows, _component_builder_rows,
    live_component_rows_paged, _live_component_rows_paged, authoring_mapping_payload,
    normalise_component_ksb_mappings,
)
from .catalogue.infrastructure.hierarchy_composition import (
    cohort_applied_holidays, persistable_programme_id, canonical_group_coaches,
    authoring_programme_structure_counts, programme_structure_counts, canonical_programme_id,
    group_authoring_payload, programme_config_by_identifier, programme_archived_for_authoring,
    module_recovered_by_move_to_live, authoring_programme_config_for_save, programme_record_revision,
    programme_conflict_record, archived_programme_keys, programme_list_needs_module_enrichment,
    programme_shell_learner_fingerprint, assigned_learners_for_programme, archived_cohort_learners,
    archived_group_learners, archived_group_payload,
)
from .catalogue.infrastructure.runtime_config import (
    CURRICULUM_SHARED_TTL_SECONDS,
)
from .catalogue.infrastructure.template_composition import (
    week_template_revision, get_week_template_rows, get_week_template_row,
    get_week_template_component_rows, week_template_record,
)
from .catalogue.infrastructure.write_composition import (
    note_live_rows, delete_rows, authoring_delete,
    free_programme_delete,
)
from .meetings.api.adapters import (
    teams_delivery_metadata_from_live_session, curriculum_live_session_occurrences,
)
from .meetings.infrastructure.tracking_queries import (
    remove_artifact_from_wrong_occurrences, stale_teams_calendar_modules, tutor_workspace_next_session_by_module,
)
from .reporting.api.source_queries import (
    resolve_coverage_source, required_ksbs_for_request,
)
from .reporting.domain.read_contracts import (
    SUPPORTED_KSB_SOURCE_TYPES,
)
from .reporting.infrastructure.source_catalogue_runtime import (
    applied_standard_name, applied_standard_required_codes, programme_ksb_design_value,
    build_skills_england_standards, _skills_england_standard_index, find_skills_england_standard,
    standard_required_ksbs, all_standard_required_ksbs, required_ksbs_for_source,
    source_required_ksbs, source_record_exists, ksb_exists_in_source,
    source_display_metadata, annotate_coverage_sources, infer_mapping_source_from_module,
    infer_mapping_source_for_code, mappings_with_inferred_sources, programme_row_ksb_source,
    infer_source_from_scope, required_ksbs_for_resolved_source, coverage_source_payload,
)
from .catalogue.api.authoring_errors import (
    TutorAssignmentDeliveryDayError, TutorScheduleConflictError, StaleModuleStructureWrite,
)
from .catalogue.api.programme_detail_composition import (
    curriculum_programme_tree_detail, curriculum_programme_detail_section, programme_detail_section_entry,
    cached_programme_detail_section, warm_programme_detail_sections, build_curriculum_programme_tree_detail_payload,
    _build_curriculum_programme_tree_detail_payload,
)
from .catalogue.api.structure_guard_composition import (
    free_course_sale_values, merge_partial_module_structure, locked_attachment_structure,
)
from .catalogue.domain.authoring_errors import (
    ProgrammeContentRetained, ModuleAuthoringValidationError, CoverImageError,
    ModuleStructureDeltaConflict,
)
from .catalogue.domain.read_contracts import (
    CURRICULUM_LEARNER_DATA_TTL_SECONDS, MODULE_COVER_EXTENSIONS, MODULE_COVER_DATA_URI,
    PROGRAMME_CONTENT_RETAINED_MESSAGE, PROGRAMME_KSB_STAT_FIELDS, PROGRAMME_DETAIL_SECTIONS,
    PROGRAMME_SECTION_WARM_WINDOW_SECONDS,
)
from .catalogue.infrastructure.authoring_guards import (
    refuse_if_programme_owns_content,
)
from .catalogue.infrastructure.cover_image_storage import (
    stored_module_cover_image,
)
from .catalogue.infrastructure.programme_builder_runtime import (
    build_programmes, build_programme_ksb_stats,
)
from .reporting.api.programme_statistics_composition import (
    curriculum_programme_ksb_stats,
)
from .reporting.application.design_errors import (
    _ProgrammeKsbDesignUnavailable,
)
from .reporting.infrastructure.programme_statistics_runtime import (
    _programme_ksb_stats, programme_component_ksb_mapping_count, _programme_component_ksb_mapping_count,
    _programme_ksb_expected_weights, programme_learner_ksb_progress,
)
from .catalogue.infrastructure.runtime_state import (
    _CURRICULUM_SHARED_EPOCH_KEY, CURRICULUM_EPOCH_TABLE, SHARED_EPOCH_POLL_SECONDS,
)
from .catalogue.infrastructure.course_schema_runtime import (
    ensure_free_programme_tables,
    provision_free_programme_tables,
    ensure_week_template_tables,
    provision_week_template_tables,
    FREE_COURSES_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    WEEK_TEMPLATE_COMPONENTS_TABLE,
)
from .meetings.infrastructure.tracking_runtime import (
    ensure_live_sessions_table,
    provision_live_sessions_table,
    ensure_live_session_tracking_tables,
    provision_live_session_tracking_tables,
    LIVE_SESSION_ATTENDANCE_TABLE,
    LIVE_SESSION_RECORDING_EVENTS_TABLE,
)
from .catalogue.api.catalogue_adapters import (
    build_staff_profiles, curriculum_component_library, enrich_modules_with_authoring,
    enrich_programmes_with_module_counts, curriculum_archived_modules,
)
from .catalogue.api.revision_adapters import (
    curriculum_record_revisions, refuse_stale_module_write, guarded_module_item_write,
)
from .catalogue.domain.read_contracts import (
    SOFT_DELETE_COLUMNS, DETACHED_PARENT_SENTINEL, RESTORE_NULLABLE_COLUMNS,
    LIBRARY_LIST_COLUMNS, LIBRARY_PAGE_SIZE_DEFAULT, LIBRARY_PAGE_SIZE_MAX,
    COMPONENT_HEAVY_COLUMNS, COMPONENT_KSB_SCOPE_COLUMNS,
)
from .catalogue.infrastructure.authoring_storage import (
    filtered_payload, insert_row, update_rows,
    authoring_upsert, authoring_bulk_upsert, update_authoring_rows,
)
from .catalogue.infrastructure.catalogue_enrichment import (
    rows_for_ids, library_component_rows, home_relationship_rows,
    archived_module_payload,
)
from .catalogue.infrastructure.catalogue_resolution import (
    find_existing_authoring_catalogue_id_for_payload, authoring_module_exists, resolve_stored_module_catalogue_id,
    resolve_authoring_catalogue_id, authoring_catalogue_summaries, authoring_scope_module_rows,
    authoring_scope_data, programme_identity_candidates, scope_placement_lineage,
)
from .catalogue.infrastructure.free_course_persistence import (
    free_programme_fetch_all, free_programme_select_sql, free_programme_fetch_many,
    free_programme_upsert, free_programme_module_id, free_programme_owned_ids,
)
from .catalogue.infrastructure.hierarchy_persistence import (
    unhook_programme_reusables, set_programme_modules_ksb_source, persist_group_authoring_detail,
    update_cohort_fields, update_group_fields, repair_curriculum_parent_links,
    unassign_authoring_modules_from_group, resync_group_module_delivery_counts,
)
from .catalogue.infrastructure.lifecycle_persistence import (
    ensure_program_config_archive_columns, soft_delete_rows, authoring_soft_delete,
    restore_rows_via_parent, restore_status_rows_via_parent, soft_delete_authoring_ids,
    write_changed_authoring_rows, archive_module_child_quizzes, update_authoring_delivery_rows,
    archive_authoring_delivery_rows, restore_authoring_delivery_rows, archived_parent_programme,
)
from .catalogue.infrastructure.revision_runtime import (
    module_structure_revision, structure_payload_with_revision, stamp_revision_after_write,
    lock_module_structure_row, lock_record_row, module_record_revision,
    CURRICULUM_RECORD_REVISIONS, curriculum_record_revision,
)
from .catalogue.infrastructure.template_composition import (
    save_week_template_components,
)
from .meetings.api.tracking_adapters import (
    curriculum_teams_recording_events, curriculum_teams_meeting_join,
)
from .meetings.domain.read_contracts import (
    TEAMS_REPEAT_VALUES,
)
from .meetings.infrastructure.invitation_runtime import (
    teams_calendar_subject, teams_event_payload,
)
from .meetings.infrastructure.session_persistence import (
    persist_live_session_occurrences, replace_live_session_occurrences, persist_live_session_series,
    link_live_session_series_to_module, persist_recreated_occurrence_details, upsert_live_session_artifact,
)
from .reporting.api.coverage_adapters import (
    _coverage_response_uncached, _coverage_payload_uncached,
)
from .catalogue.infrastructure.cache_runtime import curriculum_read_scope
from .catalogue.infrastructure.cache_runtime import _scope_memo_key
from .catalogue.infrastructure.cache_epochs import remember_shared_curriculum_epoch
from .catalogue.infrastructure.cache_epochs import note_read_shared_curriculum_epoch
from .catalogue.infrastructure.cache_invalidation import curriculum_write_pending
from .catalogue.infrastructure.cache_runtime import shared_curriculum_cache_key
from .catalogue.infrastructure.cache_runtime import curriculum_build_lock
from .catalogue.infrastructure.cache_runtime import _pack_shared
from .catalogue.infrastructure.cache_runtime import _unpack_shared
from .catalogue.infrastructure.upload_paths import COMPONENT_UPLOAD_ROOT
from .catalogue.infrastructure.authoring_schema_runtime import AI_MATERIAL_COLUMN
from .catalogue.api.calendar_composition import (
    read_programme_sessions, build_curriculum_sessions, get_cached_sessions,
    curriculum_preview_module_session_plan, curriculum_preview_tutor_availability, curriculum_module_session_plan,
    module_scoped_sessions, curriculum_sessions, curriculum_session_collection,
)
from .catalogue.api.delivery_composition import (
    delivery_scope_lists, curriculum_delivery_scope, curriculum_module_structure_resolve,
    curriculum_groups, curriculum_archived_cohorts, curriculum_archived_module_structure,
)
from .catalogue.api.module_assembly_composition import (
    programme_authoring_modules, programme_config_modules, enrich_curriculum_modules_with_authoring_details,
    programme_workspace_module_candidates, programme_module_candidates, module_attachment_authoring_payload,
    attachment_week_structure, contentful_catalogue_id_for_attachment,
)
from .catalogue.api.staff_profile_composition import (
    _staff_assignment_readers, _staff_user_profile_reader, _curriculum_tutor_profile_reader,
    build_staff_user_profile_collection, build_curriculum_tutor_profile_collection, find_staff_user_profile,
    curriculum_staff_profile_collection, curriculum_staff_profile_detail, curriculum_tutors,
    curriculum_coaches, curriculum_tutor_detail,
)
from .catalogue.api.structure_composition import (
    read_module_structure_with_revision, get_authoring_structure_payload, get_authoring_structure_payloads,
)
from .catalogue.domain.read_contracts import (
    PROGRAMME_MODULE_IDENTITY_FIELDS, STAFF_PROFILE_READ_ONLY_MESSAGE,
)
from .catalogue.infrastructure.cohort_calendar_composition import (
    module_parent_cohort, unique_cohort_id, build_cohorts_and_groups,
    cohort_selected_holidays_by_id, cohort_selected_holidays_by_cohort, module_cohort_selected_holidays,
    serialize_cohort_authoring_detail, cohort_authoring_detail_rows, find_training_rows_by_cohort,
    find_group_with_parent, home_source_rows, archived_cohort_payload,
)
from .catalogue.infrastructure.cohort_persistence_composition import (
    cohort_authoring_payload, persist_cohort_authoring_detail, save_tree_cohort,
)
from .catalogue.infrastructure.session_calendar_composition import (
    delivery_slots_by_catalogue, authoring_session_links_by_catalogue, build_sessions_from_authoring_modules,
    curriculum_sessions_from_rows, authored_calendar_snapshot,
)
from .catalogue.infrastructure.session_plan_composition import (
    module_delivery_session_plan, module_delivery_plan, module_schedule_holidays,
    module_session_dates, module_session_plan_for_count, module_session_plan_for_weeks,
    module_week_session_plan, module_week_delivery_slots,
)
from .catalogue.infrastructure.session_plan_persistence import (
    apply_module_session_plan_to_weeks, persist_group_module_session_dates,
)
from .catalogue.infrastructure.tutor_availability_composition import (
    module_slot_clash_dates, tutor_conflict_context, find_tutor_schedule_conflicts,
    tutor_schedule_conflicts_created, first_tutor_schedule_conflict, group_tutor_assignment_conflict,
)
from .meetings.domain.read_contracts import (
    TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES, TEAMS_SYNC_REPORTED_DATE_LIMIT,
)
from .meetings.infrastructure.calendar_verification import (
    teams_non_delivery_reason, module_expected_teams_occurrence_keys, teams_calendar_sync_verdict,
    teams_calendar_sync_verdicts,
)
from .catalogue.infrastructure.ksb_read_store import get_skills_england_ksb_rows
from .catalogue.infrastructure.authoring_schema_runtime import MODULE_TEAMS_SHARES_TABLE
from .catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from .catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from .catalogue.infrastructure.authoring_columns import REFLECTION_QUESTION_COLUMN
from .catalogue.infrastructure.authoring_schema_runtime import authoring_json_type
from .catalogue.infrastructure.authoring_schema_runtime import AUTHORING_REQUIRED_TABLES
from .catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from .catalogue.infrastructure.authoring_schema_runtime import provision_module_authoring_tables
from .catalogue.infrastructure import placement_reads
from .catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from .catalogue.infrastructure.authoring_runtime import complete_authoring_rows
from .catalogue.infrastructure.authoring_runtime import authoring_select_sql
from .catalogue.infrastructure.authoring_runtime import learning_read_table
from .catalogue.infrastructure.authoring_runtime import CURRICULUM_BATCHED_READS
from .catalogue.infrastructure.authoring_runtime import prefetch_authoring_reads
from .catalogue.infrastructure.content_validation_runtime import (
    validate_component_authoring_payload, validate_module_authoring_payload, component_context_for_payload,
)
from .catalogue.infrastructure.authoring_columns import CATALOGUE_SUMMARY_COMPONENT_COLUMNS

from .catalogue.api.catalogue_endpoints import (
    curriculum_overview,
    get_cached_payload,
    rows_for_programme,
    programme_response,
    first_programme_response,
    curriculum_stats,
    build_home_summary,
    build_programme_list,
    _home_projection,
    curriculum_home_summary,
    curriculum_home_attention,
    curriculum_programmes,
    curriculum_modules,
    curriculum_ksb_frameworks,
    curriculum_ksb_framework_collection,
)
from .catalogue.api.authoring_composition import (
    ensure_programme_config_for_authoring,
    save_component_builder_payload,
    save_module_authoring_structure,
    delete_module_authoring_structure,
    MODULE_ARCHIVED_SAVE_REFUSED,
)
from .catalogue.api.programme_lifecycle_composition import (
    soft_delete_programme_authoring_structure,
    restore_programme_authoring_structure,
    permanently_delete_programme_structure,
    permanent_programme_delete_response,
)
from .catalogue.api.programme_command_composition import (
    curriculum_programme_reorder,
    curriculum_programme_restore,
    curriculum_programme_detail,
    curriculum_programme_collection,
    upsert_programme_for_tree,
    save_tree_group,
    save_tree_group_modules,
    curriculum_programme_tree_save,
    curriculum_programme_cohort_collection,
)
from .catalogue.api.free_course_composition import (
    get_free_programme_modules_payload,
    delete_free_programme_data,
    save_free_programme_modules,
    _legacy_free_writer_access,
    curriculum_free_programme_modules,
    _delete_single_free_course_rows,
    inject_free_course_into_group,
    curriculum_free_programme_convert,
    convert_module_to_free_course,
    curriculum_free_programme_import_module,
)
from .catalogue.api.module_command_composition import (
    curriculum_module_collection,
    curriculum_module_structure,
    curriculum_module_settings,
    curriculum_module_component_detail,
    curriculum_module_week_detail,
    _update_module_cover,
    curriculum_module_detail,
    curriculum_module_restore,
    permanent_module_delete_response,
    curriculum_group_modules,
    MODULE_CHILD_AUTHORING_TABLES,
    ARCHIVE_MODULE_QUIZ_NOTE,
)
from .catalogue.api.content_command_composition import (
    update_component_upload_settings,
    _update_component_upload_settings,
    curriculum_component_collection,
    curriculum_component_detail,
    curriculum_component_upload,
    curriculum_module_ai_material,
    AI_MATERIAL_UPLOAD_EXTENSIONS,
    AI_MATERIAL_UPLOAD_SLOT,
)
from .catalogue.api.placement_command_composition import (
    create_curriculum_cohort,
    curriculum_cohort_collection,
    curriculum_cohort_detail,
    create_curriculum_group,
    curriculum_group_collection,
    curriculum_cohort_group_collection,
    curriculum_group_detail,
    curriculum_cohort_restore,
    curriculum_group_restore,
    permanent_cohort_delete_response,
    permanent_group_delete_response,
    ARCHIVE_MODULE_REATTACH_NOTE,
)
from .catalogue.api.staffing_composition import (
    curriculum_session_detail,
    curriculum_staffing_collection,
    curriculum_staffing_detail,
    update_staffing_assignment,
    notify_staff_assignment_change,
)
from .catalogue.api.holiday_composition import (
    curriculum_holidays,
    curriculum_holiday_collection,
    curriculum_holiday_detail,
    curriculum_england_holidays,
    curriculum_england_holiday_syncs,
    curriculum_england_holidays_refresh,
    HOLIDAY_READ_ONLY_MESSAGE,
)
from .catalogue.api.week_template_composition import (
    curriculum_week_template_collection,
    curriculum_week_template_detail,
    WEEK_TEMPLATE_COURSE_TYPES,
)
from .catalogue.api.ksb_mapping_composition import (
    store_component_ksb_mappings,
    sync_component_ksb_projection,
    curriculum_ksb_mapping_detail,
    _curriculum_ksb_mapping_detail,
)
from .meetings.api.meeting_option_composition import (
    teams_online_meeting_from_join_url,
    teams_expanded_instances,
    apply_teams_occurrence_shifts,
    reschedule_single_live_session_occurrence,
    apply_teams_meeting_options,
    teams_standalone_occurrence_meeting,
    refresh_standalone_occurrence_options,
    TEAMS_LOBBY_VALUES,
    DEFAULT_TEAMS_LOBBY_BYPASS,
)
from .meetings.api.meeting_command_composition import (
    curriculum_teams_meeting,
    with_schedule_change_notice,
    curriculum_teams_meeting_schedule,
    curriculum_teams_meeting_off_schedule_runs,
    curriculum_teams_meeting_summary,
)
from .meetings.api.artifact_composition import (
    curriculum_teams_meeting_artifacts,
    curriculum_teams_meeting_artifact_content,
)
from .meetings.api.module_link_composition import (
    attach_teams_meeting_to_module_weeks,
    curriculum_module_teams_meeting_restore,
    curriculum_module_teams_links_replace,
    curriculum_module_meeting_invitees,
)
from .directory.api.roster_composition import (
    assigned_learners_for_scope,
    _scope_learner_roster_payload_uncached,
    scope_learner_roster_entry,
    scope_learner_roster_response,
    curriculum_programme_learner_roster,
    curriculum_cohort_learner_roster,
    curriculum_group_learner_roster,
    curriculum_module_learner_roster,
    curriculum_week_learner_roster,
    curriculum_scope_learner_roster,
    CURRICULUM_LEARNER_SCOPES,
)
from .reporting.api.coverage_composition import (
    coverage_entry,
    coverage_part,
    coverage_response,
    coverage_endpoint_response,
    curriculum_ksb_coverage,
    curriculum_week_ksb_coverage,
    curriculum_module_ksb_coverage,
    curriculum_programme_ksb_coverage,
    curriculum_ksb_trace,
    curriculum_readiness_validation,
    COVERAGE_PART_VIEWS,
    COVERAGE_HEATMAP_MAPPING_FIELDS,
)
from .reporting.api.achievement_composition import (
    scope_learner_ksb_impact_payload,
    _scope_learner_ksb_impact_payload,
    curriculum_programme_learner_ksb_impact,
    programme_achievement_inputs,
    programme_achievement_inputs_uncached,
    _achievement_projection,
    curriculum_programme_ksb_achievement,
    curriculum_programme_ksb_achievement_consumptions,
    curriculum_cohort_learner_ksb_impact,
    curriculum_group_learner_ksb_impact,
    curriculum_module_learner_ksb_impact,
    curriculum_week_learner_ksb_impact,
    curriculum_scope_learner_ksb_impact,
    ACHIEVEMENT_PROGRESS_FIELDS,
    ACHIEVEMENT_LEARNER_FIELDS,
)
from curriculum_api.weekly_schedule import module_week_boundary_mode, merged_week_boundary_mode
from curriculum_api.teams_calendar_checks import read_calendar_instances
from curriculum_api.study_week_teams import prune_study_week_fillers
from curriculum_api.meetings.infrastructure.invitation_runtime import teams_module_session_limit


STAFF_PROFILE_EMAIL_PATTERN = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


STAFF_PROFILE_PHONE_PATTERN = re.compile(r'^[+()\d\s.\-]{7,20}$')


COMPACT_MODULE_LIST_DROPPED = {
    'weekStructure': "Every week and component on the module -- the bulk of the row. The list renders counts, and the builder re-reads the structure from the module's own endpoint when one is opened.",
    'sessionNames': 'Replaced by sessionNamesCount below. Four callers read `.length` off it; none renders the titles.',
    'deliveryMetadata': 'Not on the CurriculumModule TypeScript type at all, so nothing can read it off a response row. Every `deliveryMetadata` read in the frontend is of the object curriculumModuleToCatalogue() builds locally. Carries the Teams join URL, organiser and the attendee/presenter/co-organiser lists, so dropping it takes real attendee addresses out of a list response as well.',
    'qualityScore': 'Not on the CurriculumModule type; the catalogue item hardcodes 0.',
    'author': "Always '' out of build_modules() and authoring_summary_catalogue_item(). No reader.",
    'invalidModuleCatalogueId': 'No reference anywhere in the frontend. Read server-side by enrich_modules_with_authoring(), which runs before this projection.',
    'deliveryRowId': 'No reference on a module row (the one `deliveryRowId` read in the frontend is on a session).',
    'sourceType': 'No reader on a module row; curriculumModuleToCatalogue() explicitly sets its own to undefined. Read server-side before this projection.',
}


def reset_schema_ready_flags():
    """Forget which tables have been provisioned/verified.

    These latches are module-level globals, so they outlive the per-test
    database rollback that drops the SQLite tables they refer to. A test class
    that reset only some of them would leave the rest claiming a table exists
    after it had been rolled away, and the next request path to touch that
    table failed with "no such table" depending purely on test order. Tests
    call this in setUp so provisioning state always matches the live schema.
    """
    from .catalogue.infrastructure.authoring_schema_runtime import reset_ready_flag
    reset_ready_flag()
    from .catalogue.infrastructure.course_schema_runtime import reset_ready_flags as reset_course_schema
    from .meetings.infrastructure.tracking_runtime import reset_ready_flags as reset_meeting_schema
    reset_course_schema()
    reset_meeting_schema()
    cache_state._CURRICULUM_EPOCH_TABLE_READY = False
    reset_learner_schema_cache()
    # The notification ledger keeps its own latch, in its own module, for the
    # same reason as the ones above.
    tutor_notifications._TABLE_READY = False
    # Review readiness belongs to feature infrastructure. Delegate resets
    # explicitly so compatibility exports never become a second copy of
    # these process-local flags.
    import curriculum_api.review_management.infrastructure.template_schema as review_infrastructure_template_schema
    review_infrastructure_template_schema.reset_review_tables_ready()
    import curriculum_api.review_management.infrastructure.schedule_schema as review_infrastructure_schedule_schema
    review_infrastructure_schedule_schema.reset_review_schedule_ready()
    import curriculum_api.review_management.infrastructure.type_schema as review_infrastructure_type_schema
    review_infrastructure_type_schema.reset_ready_flag()
    import curriculum_api.review_management.infrastructure.instance_schema as review_infrastructure_instance_schema
    review_infrastructure_instance_schema.reset_review_instance_readiness()
    _TABLE_COLUMNS_CACHE.clear()
    from .catalogue.infrastructure import database_reads
    database_reads._TABLE_COLUMNS_LISTED = False
    _TABLE_EXISTS_CACHE.clear()
    schema_gate.reset_verification_cache()
