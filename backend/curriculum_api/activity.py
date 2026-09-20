"""Curriculum's door onto the LMS-wide activity trail.

This module used to *be* the activity trail, when the trail was curriculum's
alone. It now lives in ``system_audit.activity``, which records and reads every
workspace, and this file is the compatibility surface over it: the URL names,
the view functions and the helper names that already existed keep working and
keep meaning what they meant.

Two reasons it is a shim rather than a redirect:

* ``curriculum_api/urls.py`` and anything else that imported these names should
  not have to change to follow a module move, and a rename that breaks callers
  is a rename that gets reverted.
* The curriculum's own audit pages ask for curriculum-scoped answers. They get
  them by passing ``?workspace=curriculum``; the same views answer the whole LMS
  when nothing is passed. One implementation, two scopes -- not two
  implementations that drift.

Nothing here adds behaviour. Read ``system_audit/activity.py`` for what these
actually do, and ``system_audit/pages.py`` for how a URL becomes a page name.
"""
from __future__ import annotations

from system_audit.activity import (  # noqa: F401  (re-exported for callers)
    ACTIVITY_TABLE,
    DEFAULT_PEOPLE_LIMIT,
    DEFAULT_WINDOW_DAYS,
    DETAIL_FIELDS,
    EVENT_KINDS,
    MAX_CLIENT_BACKDATE,
    MAX_EVENTS_PER_CALL,
    MAX_PERSON_CHANGES,
    MAX_PERSON_EVENTS,
    MAX_TEXT,
    MAX_USER_AGENT,
    MAX_WINDOW_DAYS,
    activity_available,
    activity_person as curriculum_activity_person,
    activity_people as curriculum_activity_people,
    activity_record as curriculum_activity_record,
    build_visits,
    clean,
    clean_detail,
    client_ip,
    parse_client_stamp,
    read_person_changes,
    read_sign_ins,
    reset_availability,
    resolve_page,
    table,
)

__all__ = [
    'ACTIVITY_TABLE',
    'DEFAULT_PEOPLE_LIMIT',
    'DEFAULT_WINDOW_DAYS',
    'DETAIL_FIELDS',
    'EVENT_KINDS',
    'MAX_CLIENT_BACKDATE',
    'MAX_EVENTS_PER_CALL',
    'MAX_PERSON_CHANGES',
    'MAX_PERSON_EVENTS',
    'MAX_TEXT',
    'MAX_USER_AGENT',
    'MAX_WINDOW_DAYS',
    'activity_available',
    'build_visits',
    'clean',
    'clean_detail',
    'client_ip',
    'curriculum_activity_people',
    'curriculum_activity_person',
    'curriculum_activity_record',
    'parse_client_stamp',
    'read_person_changes',
    'read_sign_ins',
    'reset_availability',
    'resolve_page',
    'table',
]
