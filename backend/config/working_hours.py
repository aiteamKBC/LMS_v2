"""UK learning-hours policy shared by completion, declarations and audit.

An instant/start is inside from 08:00 inclusive to 17:00 exclusive. An
interval may end exactly at 17:00. Stored timestamps are never shifted.
Holidays remain resolved by each workflow's existing scoped calendar.
"""
from datetime import time
from zoneinfo import ZoneInfo

WORKING_TIMEZONE = 'Europe/London'
UK = ZoneInfo(WORKING_TIMEZONE)
WORKING_DAY_START = time(8, 0)
WORKING_DAY_END = time(17, 0)
WORKING_WEEKDAYS = frozenset({0, 1, 2, 3, 4})
WORKING_HOURS_LABEL = f'{WORKING_DAY_START:%H:%M}–{WORKING_DAY_END:%H:%M} UK time'
WORKING_HOURS_RULE_VERSION = '2026-11-01'
