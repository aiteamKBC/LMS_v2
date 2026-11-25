"""Own readiness checks and the unchanged opt-in local provisioning sequence."""
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_ARTIFACTS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_JOIN_LAUNCHES_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import _TABLE_COLUMNS_CACHE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from django.db import connection
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api import schema_gate


_LIVE_SESSIONS_TABLE_READY = False


_LIVE_SESSION_TRACKING_TABLES_READY = False


LIVE_SESSION_ATTENDANCE_TABLE = 'live_session_attendance'


LIVE_SESSION_RECORDING_EVENTS_TABLE = 'live_session_recording_events'


def ensure_live_sessions_table():
    global _LIVE_SESSIONS_TABLE_READY
    if _LIVE_SESSIONS_TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(LIVE_SESSIONS_TABLE)
        _LIVE_SESSIONS_TABLE_READY = True
        return
    provision_live_sessions_table()


def provision_live_sessions_table():
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.tracking_schema import provision_live_sessions_table as implementation
    global _LIVE_SESSIONS_TABLE_READY
    if _LIVE_SESSIONS_TABLE_READY:
        return
    implementation(
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE, _TABLE_COLUMNS_CACHE=_TABLE_COLUMNS_CACHE,
        authoring_table_name=authoring_table_name, column_names=column_names, connection=connection,
        quote_ident=quote_ident,
    )
    _LIVE_SESSIONS_TABLE_READY = True


def ensure_live_session_tracking_tables():
    global _LIVE_SESSION_TRACKING_TABLES_READY
    if _LIVE_SESSION_TRACKING_TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(
            LIVE_SESSIONS_TABLE,
            LIVE_SESSION_OCCURRENCES_TABLE,
            LIVE_SESSION_ATTENDANCE_TABLE,
            LIVE_SESSION_ARTIFACTS_TABLE,
            LIVE_SESSION_RECORDING_EVENTS_TABLE,
            LIVE_SESSION_JOIN_LAUNCHES_TABLE,
        )
        _LIVE_SESSION_TRACKING_TABLES_READY = True
        return
    provision_live_session_tracking_tables()


def provision_live_session_tracking_tables():
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.tracking_schema import provision_live_session_tracking_tables as implementation
    global _LIVE_SESSION_TRACKING_TABLES_READY
    if _LIVE_SESSION_TRACKING_TABLES_READY:
        return
    implementation(
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_ARTIFACTS_TABLE=LIVE_SESSION_ARTIFACTS_TABLE,
        LIVE_SESSION_ATTENDANCE_TABLE=LIVE_SESSION_ATTENDANCE_TABLE,
        LIVE_SESSION_JOIN_LAUNCHES_TABLE=LIVE_SESSION_JOIN_LAUNCHES_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        LIVE_SESSION_RECORDING_EVENTS_TABLE=LIVE_SESSION_RECORDING_EVENTS_TABLE,
        _TABLE_COLUMNS_CACHE=_TABLE_COLUMNS_CACHE, authoring_table_name=authoring_table_name,
        column_names=column_names, connection=connection,
        ensure_live_sessions_table=ensure_live_sessions_table,
    )
    _LIVE_SESSION_TRACKING_TABLES_READY = True


def reset_ready_flags():
    """Forget only the readiness state owned by this module."""
    global _LIVE_SESSIONS_TABLE_READY, _LIVE_SESSION_TRACKING_TABLES_READY
    _LIVE_SESSIONS_TABLE_READY = False
    _LIVE_SESSION_TRACKING_TABLES_READY = False
