"""Normalize assignment records from Last_audit.assigments_check for the admin view.

The source is an archive of mixed records, documents, and evidence.  Its
statuses are source annotations rather than verified LMS completion states.
"""

import re
from pathlib import PurePosixPath
from datetime import datetime
from urllib.parse import urlsplit


_ASSIGNMENT = re.compile(r'\bassignments?\b', re.IGNORECASE)
_ANCILLARY = re.compile(r'\b(?:brief|model answer|assessment report|feedback)\b', re.IGNORECASE)
_MARKING = re.compile(r'\bmarking\b', re.IGNORECASE)
_MONTH = re.compile(r'^(20\d{2})[-/](0?[1-9]|1[0-2])(?:[-/].*)?$')
_NUMBER = re.compile(r'^[0-9]+$')
_FILE_NAME = re.compile(r'\.(?:pdf|docx?|xlsx?|pptx?|zip)$', re.IGNORECASE)


def assignment_record(row):
    """Keep assignment records, excluding obvious briefs and marking records."""
    title = str(row.get('title') or '').strip()
    category = str(row.get('category') or '').strip()
    category_code = str(row.get('category_code') or '').strip().upper()
    if category_code and category_code != 'A':
        return False
    if (_ANCILLARY.search(category) or
            (_MARKING.search(category) and not _ASSIGNMENT.search(category))):
        return False
    if ((_ANCILLARY.search(title) or
         (_MARKING.search(title) and not _ASSIGNMENT.search(title)))
            and not row.get('activity_id') and not _ASSIGNMENT.search(category)):
        return False
    return (category_code == 'A'
            or bool(_ASSIGNMENT.search(category))
            or bool(_ASSIGNMENT.search(title)))


def absolute_month(value):
    """Return YYYY-MM only when the source gives an absolute calendar month."""
    value = str(value or '').strip()
    match = _MONTH.fullmatch(value)
    if match:
        return f'{match.group(1)}-{int(match.group(2)):02d}'
    for pattern in ('%B %Y', '%b %Y'):
        try:
            return datetime.strptime(value, pattern).strftime('%Y-%m')
        except ValueError:
            pass
    return None


def _numeric_id(value):
    value = str(value or '').strip()
    if len(value) > 19 or not _NUMBER.fullmatch(value):
        return None
    number = int(value)
    return number if number <= 9223372036854775807 else None


def _source_files(links):
    """List archive file references without exposing private source paths."""
    if not isinstance(links, list):
        return []
    files = []
    for link in links:
        if not isinstance(link, dict):
            continue
        path = str(link.get('path') or link.get('source_path') or '').replace('\\', '/')
        name = PurePosixPath(path).name
        if not name or not PurePosixPath(name).suffix:
            continue
        url = str(link.get('url') or '')
        parsed = urlsplit(url)
        available = (link.get('resolution') == 'unique_path'
                     and bool(link.get('source_file_id'))
                     and parsed.scheme == 'https'
                     and parsed.hostname == 'onedrive.live.com'
                     and not parsed.username and not parsed.password
                     and len(url) <= 2048)
        files.append({
            'name': name,
            'url': url if available else None,
            'key': str(link.get('source_file_id') or path).casefold(),
        })
    return files


def group_assignment_records(records, component_by_evidence):
    """Return one row per known activity, or per title and source month."""
    groups = {}
    for row in records:
        if not assignment_record(row):
            continue
        activity_id = _numeric_id(row.get('activity_id'))
        evidence_id = _numeric_id(row.get('evidence_id'))
        component_id = activity_id or component_by_evidence.get(evidence_id)
        month = next((value for value in (
            absolute_month(row.get('calendar_month')),
            absolute_month(row.get('assignment_month')),
            absolute_month(row.get('source_due_date')),
        ) if value), None)
        title = str(row.get('title') or '').strip() or 'Imported assignment'
        source_month = str(row.get('assignment_month') or '').strip().casefold()
        key = ('component', component_id) if component_id else (
            'title', title.casefold(), month or source_month)
        group = groups.setdefault(key, {
            'sourceRecordIds': [], 'linkedComponentId': component_id,
            'evidenceIds': set(), 'month': month, 'name': title,
            'sourceFiles': [], 'sourceMarkId': None, '_sourceFileKeys': set(),
        })
        group['sourceRecordIds'].append(row['id'])
        if evidence_id is not None:
            group['evidenceIds'].add(evidence_id)
        for source_file in _source_files(row.get('evidence_links')):
            if source_file['url'] and group['sourceMarkId'] is None:
                group['sourceMarkId'] = row['id']
            if source_file['key'] not in group['_sourceFileKeys']:
                group['_sourceFileKeys'].add(source_file['key'])
                group['sourceFiles'].append({
                    'name': source_file['name'], 'url': source_file['url'],
                })
        if group['month'] is None and month is not None:
            group['month'] = month
        if (_FILE_NAME.search(group['name']) and not _FILE_NAME.search(title)) or (
                group['name'].casefold() in {'assignment', 'assignments'}
                and title.casefold() not in {'assignment', 'assignments'}):
            group['name'] = title
    result = []
    for group in groups.values():
        del group['_sourceFileKeys']
        group['sourceRecordIds'].sort()
        group['evidenceIds'] = sorted(group['evidenceIds'])
        group['rowId'] = f"check:{group['sourceRecordIds'][0]}"
        group['componentId'] = group['linkedComponentId'] or group['sourceRecordIds'][0]
        result.append(group)
    return sorted(result, key=lambda item: (item['month'] or '', item['rowId']), reverse=True)
