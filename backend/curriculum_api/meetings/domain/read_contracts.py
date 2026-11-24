"""Concrete meetings / domain / read contracts capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""



LIVE_SESSIONS_TABLE = 'live_sessions'


LIVE_SESSION_OCCURRENCES_TABLE = 'live_session_occurrences'


LIVE_SESSION_ARTIFACTS_TABLE = 'live_session_artifacts'


LIVE_SESSION_JOIN_LAUNCHES_TABLE = 'live_session_join_launches'


GRAPH_SILENT_INVITE_HEADERS = {'Prefer': 'outlook.send-invitations="none"'}


GRAPH_WINDOWS_TO_IANA = {
    'GMT Standard Time': 'Europe/London',
    'UTC': 'UTC',
    'W. Europe Standard Time': 'Europe/Berlin',
    'Romance Standard Time': 'Europe/Paris',
    'Egypt Standard Time': 'Africa/Cairo',
    'Arabian Standard Time': 'Asia/Dubai',
}


LIVE_SESSION_TYPE_SQL = "lower(replace(coalesce(type, ''), '-', '_')) = 'live_session'"


LIVE_SESSION_MEETING_SCOPE_KEY = 'teamsMeetingScope'


LIVE_SESSION_MEETING_SCOPES = ('main', 'additional')


LIVE_SESSION_SCHEDULE_FIELDS = (
    'startDate', 'endDate', 'weeklySchedule', 'scheduleMode', 'weekDays', 'startTime', 'endTime',
    'sessionsNumber', 'sessionHolidays', 'groupId', 'cohortId', 'teamsSharedSourceModuleId',
)



TEAMS_REPEAT_VALUES = {'none', 'daily', 'weekdays', 'weekly'}



TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES = {'cancelled', 'canceled', 'declined', 'deleted', 'removed', 'superseded'}


TEAMS_SYNC_REPORTED_DATE_LIMIT = 12
