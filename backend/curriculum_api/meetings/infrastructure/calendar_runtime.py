"""Concrete meetings / infrastructure / calendar runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from config.time_zones import calendar_zone
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.component_types import normalise_component_type
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.read_contracts import ADDITIONAL_MEETING_SETTING_KEYS
from curriculum_api.catalogue.domain.read_contracts import SHARED_TEAMS_DELIVERY_SETTING_KEYS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.invitation_policy import teams_series_email_list
from curriculum_api.meetings.domain.read_contracts import GRAPH_SILENT_INVITE_HEADERS
from curriculum_api.meetings.domain.read_contracts import GRAPH_WINDOWS_TO_IANA
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_MEETING_SCOPE_KEY
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_TYPE_SQL
from curriculum_api.teams_calendar_checks import CalendarMismatch
from curriculum_api.teams_calendar_checks import attendee_differences
from curriculum_api.teams_calendar_checks import attendees_already_match
from curriculum_api.teams_calendar_checks import event_organizer_address
from curriculum_api.teams_calendar_checks import publish_attendees
from curriculum_api.teams_calendar_checks import remove_attendees_silently
from curriculum_api.teams_calendar_checks import unconfirmed_attendee_detail
from curriculum_api.teams_calendar_checks import verify_calendar
from datetime import datetime
from datetime import timezone
from django.db import connection
from django.views.decorators.csrf import csrf_exempt
from html import escape
from urllib import parse as urllib_parse
from urllib.parse import urlparse
import json
import os
import re


def teams_meeting_default_organizer():
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_identity import teams_meeting_default_organizer as implementation
    return implementation(
        clean_str=clean_str, os=os,
    )


def teams_new_meeting_organizer(requested=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.invitation_preparation import teams_new_meeting_organizer as implementation
    return implementation(
        requested, clean_str=clean_str, teams_meeting_default_organizer=teams_meeting_default_organizer,
    )


def teams_event_body_html(title, details=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_payloads import teams_event_body_html as implementation
    return implementation(
        title, details, escape=escape,
    )


def teams_online_meeting_owner_id(organizer, join_url=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_identity import teams_online_meeting_owner_id as implementation
    return implementation(
        organizer, join_url, clean_str=clean_str, json=json, os=os, re=re,
        teams_meeting_default_organizer=teams_meeting_default_organizer, urllib_parse=urllib_parse,
        urlparse=urlparse,
    )


def graph_timezone_iana(graph_settings):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_identity import graph_timezone_iana as implementation
    return implementation(
        graph_settings, calendar_zone=calendar_zone, clean_str=clean_str, os=os,
    )


def teams_schedule_settings(graph_settings, payload=None, series=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.invitation_preparation import teams_schedule_settings as implementation
    return implementation(
        graph_settings, payload, series, GRAPH_WINDOWS_TO_IANA=GRAPH_WINDOWS_TO_IANA,
        calendar_zone=calendar_zone, clean_str=clean_str,
    )


def verify_teams_calendar_with_standalones(request, owner_key, event_id, targets, expected_join_url='', recurring=True, occurrence_details=None, expected_attendees=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.calendar_publication import verify_teams_calendar_with_standalones as implementation
    return implementation(
        request, owner_key, event_id, targets, expected_join_url, recurring, occurrence_details,
        expected_attendees, CalendarMismatch=CalendarMismatch, attendee_differences=attendee_differences,
        clean_str=clean_str, event_organizer_address=event_organizer_address,
        unconfirmed_attendee_detail=unconfirmed_attendee_detail, verify_calendar=verify_calendar,
    )


def publish_teams_calendar_attendees(request, owner_key, event, attendees, occurrence_details=None, *, force=False, title='', silent=False, dates_unchanged=False):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.calendar_publication import publish_teams_calendar_attendees as implementation
    return implementation(
        request, owner_key, event, attendees, occurrence_details, force=force, title=title, silent=silent,
        dates_unchanged=dates_unchanged, GRAPH_SILENT_INVITE_HEADERS=GRAPH_SILENT_INVITE_HEADERS,
        attendees_already_match=attendees_already_match, clean_str=clean_str,
        event_organizer_address=event_organizer_address, publish_attendees=publish_attendees,
        remove_attendees_silently=remove_attendees_silently, urllib_parse=urllib_parse,
    )


def teams_meeting_base_path(organizer, meeting_id, join_url=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_identity import teams_meeting_base_path as implementation
    return implementation(
        organizer, meeting_id, join_url, clean_str=clean_str,
        teams_online_meeting_owner_id=teams_online_meeting_owner_id, urllib_parse=urllib_parse,
    )


def module_has_external_teams_calendar(module_catalogue_id, series=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.lifecycle_reads import module_has_external_teams_calendar as implementation

    def load_external_main_calendar():
        from curriculum_api.teams_external_calendar import external_main_calendar
        return external_main_calendar,

    return implementation(
        module_catalogue_id, series, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        active_component_rows=active_component_rows, authoring_fetch_all=authoring_fetch_all,
        component_builder_settings=component_builder_settings, frontend_component_type=frontend_component_type,
        load_external_main_calendar=load_external_main_calendar,
    )


def held_schedule_snapshot(live_session_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.lifecycle_reads import held_schedule_snapshot as implementation

    def load_schedule_snapshot():
        from curriculum_api.teams_schedule_notice import schedule_snapshot
        return schedule_snapshot,

    return implementation(
        live_session_id, LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        authoring_fetch_all=authoring_fetch_all, load_schedule_snapshot=load_schedule_snapshot,
    )


def teams_series_invited(series):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.module_delivery import teams_series_invited as implementation
    return implementation(
        series, teams_series_email_list=teams_series_email_list,
    )


@csrf_exempt
def stored_leftover_slots(live_session_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.artifact_storage import stored_leftover_slots as implementation
    return implementation(
        live_session_id, connection=connection, logger=logger, parse_json_value=parse_json_value,
    )


def strip_shared_teams_delivery_settings(settings):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.module_delivery import strip_shared_teams_delivery_settings as implementation
    return implementation(
        settings, SHARED_TEAMS_DELIVERY_SETTING_KEYS=SHARED_TEAMS_DELIVERY_SETTING_KEYS, clean_str=clean_str,
    )


def teams_module_owner_id(module_catalogue_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_reads import teams_module_owner_id as implementation
    return implementation(
        module_catalogue_id,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
    )


def shared_teams_component_settings(module_catalogue_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_reads import shared_teams_component_settings as implementation
    return implementation(
        module_catalogue_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        LIVE_SESSION_TYPE_SQL=LIVE_SESSION_TYPE_SQL,
        active_component_rows=active_component_rows,
        active_week_rows=active_week_rows,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        component_builder_settings=component_builder_settings,
        normalise_component_type=normalise_component_type,
        parse_int=parse_int,
    )


def apply_shared_teams_settings_to_weeks(module, weeks):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.shared_delivery import apply_shared_teams_settings_to_weeks as implementation
    from curriculum_api.teams_external_calendar import manual_link_settings
    return implementation(
        module,
        weeks,
        SHARED_TEAMS_DELIVERY_SETTING_KEYS=SHARED_TEAMS_DELIVERY_SETTING_KEYS,
        clean_str=clean_str,
        manual_link_settings=manual_link_settings,
        normalise_component_type=normalise_component_type,
        shared_teams_component_settings=shared_teams_component_settings,
        teams_module_owner_id=teams_module_owner_id,
    )


def live_session_booked_on_module_calendar(settings):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.calendar_policy import live_session_booked_on_module_calendar as implementation
    return implementation(
        settings,
        clean_str=clean_str,
        parse_int=parse_int,
    )


def module_has_booked_series(settings_list):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.calendar_policy import module_has_booked_series as implementation
    return implementation(
        settings_list,
        LIVE_SESSION_MEETING_SCOPE_KEY=LIVE_SESSION_MEETING_SCOPE_KEY,
        clean_str=clean_str,
        live_session_booked_on_module_calendar=live_session_booked_on_module_calendar,
    )


def preserve_additional_meeting_settings(payload_settings, stored_row):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.calendar_policy import preserve_additional_meeting_settings as implementation
    return implementation(
        payload_settings,
        stored_row,
        ADDITIONAL_MEETING_SETTING_KEYS=ADDITIONAL_MEETING_SETTING_KEYS,
        LIVE_SESSION_MEETING_SCOPE_KEY=LIVE_SESSION_MEETING_SCOPE_KEY,
        clean_str=clean_str,
        component_builder_settings=component_builder_settings,
    )


def active_teams_series_for_join_link(link, *, excluding_module_id=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_reads import active_teams_series_for_join_link as implementation
    return implementation(
        link,
        excluding_module_id=excluding_module_id,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        unique=unique,
    )


def module_has_active_teams_series(module_catalogue_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_reads import module_has_active_teams_series as implementation
    return implementation(
        module_catalogue_id,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
    )


def utc_iso_or_blank(value):
    """Return a timestamp as an unambiguous UTC ISO value for the browser."""
    if value is None:
        return ''
    if isinstance(value, datetime):
        instant = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return instant.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    parsed = parse_graph_datetime(value)
    if parsed is not None:
        instant = parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
        return instant.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    return clean_str(value)
