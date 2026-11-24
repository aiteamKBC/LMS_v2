"""Pure catalogue values; no framework, storage or providers."""

from datetime import date
from datetime import datetime
import json
import re


def clean_str(value):
    return str(value or '').strip()


def parse_json_value(value, fallback):
    if value in (None, ''):
        return fallback
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def parse_int(value, default=0):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def parse_float(value, default=0):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).strip()).date()
    except ValueError:
        return None


def format_date(value):
    parsed = parse_date(value)
    return parsed.isoformat() if parsed else ''


def slugify(value):
    slug = re.sub(r'[^a-z0-9]+', '-', str(value).lower()).strip('-')
    return slug or 'item'


def normalise(value):
    return re.sub(r'[^a-z0-9]+', '', str(value).lower())


def truthy(value):
    return str(value).strip().lower() in {'1', 'true', 'yes', 'y', 'on'}


def falsey(value):
    return str(value).strip().lower() in {'0', 'false', 'no', 'n', 'off'}


def unique(values):
    seen = set()
    result = []
    for value in values:
        if value in (None, '') or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def as_json_value(value, fallback):
    parsed = parse_json_value(value, fallback)
    return parsed if parsed is not None else fallback


def bool_payload(value):
    if isinstance(value, bool):
        return value
    return truthy(value)
