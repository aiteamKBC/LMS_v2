"""Concrete meetings meeting option composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.invitation_policy import teams_series_email_list
from curriculum_api.meetings.domain.read_contracts import GRAPH_SILENT_INVITE_HEADERS
from curriculum_api.meetings.domain.recurrence_policy import teams_calendar_minute_key
from curriculum_api.meetings.domain.recurrence_policy import tracked_occurrence_keys
from curriculum_api.meetings.domain.recurrence_policy import vacated_occurrence_keys
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_meeting_base_path
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_meeting_default_organizer
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_online_meeting_owner_id
from curriculum_api.teams_calendar_checks import safe_teams_join_url
from curriculum_api.teams_calendar_checks import utc_datetime
from curriculum_api.teams_calendar_checks import verify_calendar
from curriculum_api.teams_weekly_calendar import graph_event_utc
from datetime import datetime
from datetime import timedelta
from urllib import parse as urllib_parse
import time
from curriculum_api.teams_calendar_checks import read_calendar_instances


TEAMS_LOBBY_VALUES = {
    'invited': 'invited',
    'organization': 'organization',
    'organization-excluding-guests': 'organizationExcludingGuests',
    'everyone': 'everyone',
    'organizer': 'organizer',
}


DEFAULT_TEAMS_LOBBY_BYPASS = 'invited'


def teams_online_meeting_from_join_url(organizer, join_url):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_reads import teams_online_meeting_from_join_url as implementation

    def load_microsoft_graph_request():
        from coach_api.views import microsoft_graph_request
        return microsoft_graph_request,

    return implementation(
        organizer, join_url, load_microsoft_graph_request=load_microsoft_graph_request,
        teams_online_meeting_owner_id=teams_online_meeting_owner_id, urllib_parse=urllib_parse,
    )


def teams_expanded_instances(owner_key, event_key, instance_query, expected, deadline_seconds=15.0):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_reads import teams_expanded_instances as implementation

    def load_microsoft_graph_request():
        from coach_api.views import microsoft_graph_request
        return microsoft_graph_request,

    return implementation(
        owner_key, event_key, instance_query, expected, deadline_seconds, clean_str=clean_str,
        graph_event_utc=graph_event_utc, load_microsoft_graph_request=load_microsoft_graph_request, time=time,
        read_calendar_instances=read_calendar_instances,
    )


def apply_teams_occurrence_shifts(owner_key, event_key, title, target_occurrences, invited_people, meeting_options=None, existing_occurrences=None, missing=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.reconciliation import apply_teams_occurrence_shifts as implementation
    from coach_api.views import microsoft_graph_request
    return implementation(
        owner_key,
        event_key,
        title,
        target_occurrences,
        invited_people,
        meeting_options,
        existing_occurrences,
        missing,
        GRAPH_SILENT_INVITE_HEADERS=GRAPH_SILENT_INVITE_HEADERS,
        clean_str=clean_str,
        datetime=datetime,
        graph_event_utc=graph_event_utc,
        logger=logger,
        microsoft_graph_request=microsoft_graph_request,
        parse_graph_datetime=parse_graph_datetime,
        teams_calendar_minute_key=teams_calendar_minute_key,
        teams_expanded_instances=teams_expanded_instances,
        teams_standalone_occurrence_meeting=teams_standalone_occurrence_meeting,
        timedelta=timedelta,
        tracked_occurrence_keys=tracked_occurrence_keys,
        urllib_parse=urllib_parse,
        vacated_occurrence_keys=vacated_occurrence_keys,
        read_calendar_instances=read_calendar_instances,
    )


def reschedule_single_live_session_occurrence(series, occurrence, new_start_utc, duration, *, notify_attendees=False):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.calendar_publication import reschedule_single_live_session_occurrence as implementation

    def load_microsoft_graph_request():
        from coach_api.views import microsoft_graph_request
        return microsoft_graph_request,

    return implementation(
        series, occurrence, new_start_utc, duration, notify_attendees=notify_attendees,
        GRAPH_SILENT_INVITE_HEADERS=GRAPH_SILENT_INVITE_HEADERS, clean_str=clean_str,
        load_microsoft_graph_request=load_microsoft_graph_request, logger=logger,
        parse_graph_datetime=parse_graph_datetime, safe_teams_join_url=safe_teams_join_url,
        teams_calendar_minute_key=teams_calendar_minute_key,
        teams_meeting_default_organizer=teams_meeting_default_organizer, timedelta=timedelta,
        urllib_parse=urllib_parse, utc_datetime=utc_datetime, verify_calendar=verify_calendar,
    )


def apply_teams_meeting_options(organizer, join_url, recording='none', lobby_bypass='invited', spoken_language='en-GB', attendees=(), presenters=(), co_organizers=(), online_meeting_id='', meeting=None, groups=None, live_session_id=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.meeting_options import apply_teams_meeting_options as implementation

    def load_microsoft_graph_request():
        from coach_api.views import microsoft_graph_request
        return microsoft_graph_request,

    def load_OPTIONS_PATCH():
        from curriculum_api.teams_graph_failure_log import OPTIONS_PATCH, OPTIONS_RESOLVE, record_graph_failure
        return OPTIONS_PATCH, OPTIONS_RESOLVE, record_graph_failure

    def load_ALL_GROUPS():
        from curriculum_api.teams_meeting_options_policy import ALL_GROUPS, graph_error_details, meeting_options_patch
        return ALL_GROUPS, graph_error_details, meeting_options_patch

    def load_get_graph_settings():
        from coach_api.views import get_graph_settings
        return get_graph_settings,

    return implementation(
        organizer, join_url, recording, lobby_bypass, spoken_language, attendees, presenters, co_organizers,
        online_meeting_id, meeting, groups, live_session_id, TEAMS_LOBBY_VALUES=TEAMS_LOBBY_VALUES,
        clean_str=clean_str, load_ALL_GROUPS=load_ALL_GROUPS, load_OPTIONS_PATCH=load_OPTIONS_PATCH,
        load_get_graph_settings=load_get_graph_settings,
        load_microsoft_graph_request=load_microsoft_graph_request, logger=logger,
        teams_meeting_base_path=teams_meeting_base_path,
        teams_online_meeting_from_join_url=teams_online_meeting_from_join_url,
        teams_online_meeting_owner_id=teams_online_meeting_owner_id,
        teams_series_email_list=teams_series_email_list,
    )


def teams_standalone_occurrence_meeting(owner_key, event, target, invited_people, meeting_options, groups=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.meeting_options import teams_standalone_occurrence_meeting as implementation

    def load_microsoft_graph_request():
        from coach_api.views import microsoft_graph_request
        return microsoft_graph_request,

    return implementation(
        owner_key, event, target, invited_people, meeting_options, groups,
        apply_teams_meeting_options=apply_teams_meeting_options, clean_str=clean_str,
        load_microsoft_graph_request=load_microsoft_graph_request, logger=logger, urllib_parse=urllib_parse,
    )


def refresh_standalone_occurrence_options(owner_key, series_event_id, occurrences, invited_people, meeting_options, groups=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.meeting_options import refresh_standalone_occurrence_options as implementation
    return implementation(
        owner_key, series_event_id, occurrences, invited_people, meeting_options, groups, clean_str=clean_str,
        teams_standalone_occurrence_meeting=teams_standalone_occurrence_meeting,
    )
