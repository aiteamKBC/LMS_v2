"""Pure parsing of stored meeting instants."""

from datetime import datetime
from ...catalogue.domain.values import clean_str


def parse_graph_datetime(value):
    raw = clean_str(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        return None
