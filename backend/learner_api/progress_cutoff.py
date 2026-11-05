"""Exclude progress recorded after a server-captured calculation instant."""
from datetime import datetime, timezone


def records_as_of(records, calculated_at):
    if calculated_at is None:
        return list(records or [])
    visible = []
    for record in records or []:
        submitted = record.get('submittedAt') or record.get('submitted_at')
        if submitted:
            try:
                at = datetime.fromisoformat(str(submitted).replace('Z', '+00:00'))
                if at.tzinfo is None:
                    at = at.replace(tzinfo=timezone.utc)
                if at > calculated_at:
                    continue
            except (TypeError, ValueError):
                # Preserve the established treatment of undated legacy facts.
                pass
        visible.append(record)
    return visible
