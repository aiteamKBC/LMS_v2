"""Move the imported "Additional materials" link list out of assignment instructions.

The legacy-LMS import (import_mba_curriculum.extra_materials_html) wrote every
extra file and link a legacy assignment carried into ``submissionInstructions``.
Learners then saw a bare list of links where the instructions belong, and the
topic editor copied that list into Topic 1's instructions.

This moves the list into resources, for ``type = 'assignment'`` components only:

    topics configured   -> each topic whose instructions end with the list keeps
                           any text before it; the links join its ``resources``
    no topics           -> Topic 1 is written the way the topic editor seeds it
                           (brief as the question, attachment as a resource) with
                           the links as resources; ``submissionInstructions``
                           keeps only the text before the list

Only the exact markup the importer produces is recognised, so authored text is
never rewritten. Links are stored with ``"link": true`` so learner pages list
them under Resources instead of previewing each one.

    python manage.py move_legacy_assignment_links            # dry run (default)
    python manage.py move_legacy_assignment_links --apply
"""
from __future__ import annotations

import json
import re
from html import unescape

from django.core.management.base import BaseCommand
from django.db import connection, transaction

from curriculum_api import views

LEGACY_HEADING = '<p><strong>Additional materials</strong></p>'
_ITEM_PATTERN = re.compile(r'<li><a href="([^"]*)" target="_blank" rel="noreferrer">([^<]*)</a></li>')
_LIST_PATTERN = re.compile(r'<ul>((?:<li><a href="[^"]*" target="_blank" rel="noreferrer">[^<]*</a></li>)+)</ul>')
_RESOURCE_PREFIXES = ('https://', 'http://', '/curriculum_api/curriculum/uploads/')


def split_legacy_links(html):
    """Return (text before the list, links) when ``html`` ends with the importer's list.

    Anything else returns (html, []) unchanged.
    """
    text = str(html or '')
    index = text.rfind(LEGACY_HEADING)
    if index < 0:
        return text, []
    match = _LIST_PATTERN.fullmatch(text[index + len(LEGACY_HEADING):].strip())
    if not match:
        return text, []
    links = [{'label': unescape(label).strip(), 'url': unescape(url).strip()}
             for url, label in _ITEM_PATTERN.findall(match.group(1))]
    return text[:index].rstrip(), links


def _resources(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _with_links(resources, links):
    merged = _resources(resources)
    seen = {str(item.get('url') or '') for item in merged}
    for link in links:
        if link['url'] not in seen:
            seen.add(link['url'])
            merged.append({'fileName': link['label'] or link['url'], 'url': link['url'],
                           'size': 0, 'contentType': '', 'link': True})
    return merged


def _movable(links):
    # Learner pages drop resources outside these prefixes; leave such a list as text.
    return bool(links) and all(link['url'].startswith(_RESOURCE_PREFIXES) for link in links)


def _topics(value):
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else []
        except (TypeError, ValueError):
            return None
    return value if isinstance(value, list) else None


def _has_content(topic):
    if not isinstance(topic, dict):
        return False
    return any(str(topic.get(key) or '').strip() for key in ('question', 'instructions')) \
        or bool(_resources(topic.get('resources')))


def move_legacy_links(settings):
    """Return (updated settings, number of links moved). Pure: reads no database."""
    settings = dict(settings or {})
    raw_topics = settings.get('assignmentTopics')
    topics = _topics(raw_topics)
    if topics is None:
        return settings, 0  # Unreadable topics are left for an author to repair.
    moved = 0
    if any(_has_content(topic) for topic in topics):
        updated = []
        for topic in topics:
            if isinstance(topic, dict):
                prose, links = split_legacy_links(topic.get('instructions'))
                if _movable(links):
                    topic = {**topic, 'instructions': prose, 'resources': _with_links(topic.get('resources'), links)}
                    moved += len(links)
            updated.append(topic)
        if moved:
            settings['assignmentTopics'] = updated if isinstance(raw_topics, list) else json.dumps(updated)
        return settings, moved

    prose, links = split_legacy_links(settings.get('submissionInstructions'))
    if not _movable(links):
        return settings, 0
    file_url = str(settings.get('assignmentFileUrl') or settings.get('uploadedFileUrl') or '')
    files = [{'fileName': settings.get('assignmentFileName') or settings.get('uploadedFileName') or 'Assignment file',
              'url': file_url, 'size': settings.get('uploadedFileSize') or 0,
              'contentType': settings.get('uploadedFileContentType') or ''}] if file_url.startswith(_RESOURCE_PREFIXES) else []
    topic = {'id': '1', 'name': '',
             'question': settings.get('assignmentContent') or settings.get('assignmentBrief') or '',
             'instructions': prose, 'resources': _with_links(files, links)}
    settings['submissionInstructions'] = prose
    settings['assignmentTopics'] = [topic] if isinstance(raw_topics, list) else json.dumps([topic])
    return settings, len(links)


class Command(BaseCommand):
    help = 'Move the imported "Additional materials" links from assignment instructions into resources.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Write the changes. Without it nothing is written (dry run).')
        parser.add_argument('--component', action='append', default=[],
                            help='Limit to this component id; repeat for several.')

    def handle(self, *args, **options):
        apply = options['apply']
        component_ids = [value.strip() for value in options['component'] if value.strip()]
        query = "select id, settings_json from curriculum.components where type = 'assignment'"
        params = []
        if component_ids:
            query += ' and id = any(%s)'
            params.append(component_ids)
        with connection.cursor() as cursor:
            cursor.execute(query + ' order by id', params)
            rows = cursor.fetchall()

        changes = []
        for component_id, raw in rows:
            settings = views.parse_json_value(raw, {})
            if not isinstance(settings, dict):
                continue
            updated, moved = move_legacy_links(settings)
            if moved:
                changes.append((component_id, updated, moved))
                self.stdout.write(f'  {component_id}: {moved} link(s)')

        if apply and changes:
            with transaction.atomic():
                for component_id, updated, _moved in changes:
                    views.update_rows(
                        views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id],
                        {'settings_json': views.json_db_value(updated)},
                    )
        links = sum(moved for _id, _settings, moved in changes)
        verb = 'moved' if apply else 'would move'
        self.stdout.write(self.style.SUCCESS(
            f'{len(rows)} assignments checked; {verb} {links} links in {len(changes)} components.'
            + ('' if apply else ' Dry run: nothing was written. Re-run with --apply to write.')
        ))
