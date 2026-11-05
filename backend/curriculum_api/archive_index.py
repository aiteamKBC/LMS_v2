"""The Curriculum archive as one list, read once and answered a page at a time.

The Archive page used to assemble this itself from four requests: the three
``*/archived/`` lists plus ``/curriculum/programmes/?visibility=all`` forced
past every cache. That last one rebuilt the whole programme list -- live
programmes included, ~13 s cold -- to keep the few that are archived, and each
of the three archive lists read the learner placements and the cohort and group
tables again for itself.

Here the same payloads are built from one set of reads inside one
``curriculum_read_scope``, and the page is cut on the server:

* Records a parent's archive took down with it are carried *under* that parent
  as ``children`` rather than as rows of their own, so "programme X and the 3
  cohorts archived with it" is one entry. Paging counts these entries.
* Filtering by record type lists that type flat -- children included, each still
  saying which parent it was archived with -- because "show me every archived
  cohort" must not hide the ones that left with a programme.
* ``counts`` are per type across the whole archive under the programme filter
  and search, for the tabs; ``total`` is entries on this filter, for the pager.
* ``key=<kind>:<id>`` answers one record wherever it sits, for a link that
  names it -- that record may be on any page.

Each record keeps the exact shape its own ``*/archived/`` endpoint returns
(programmes: the programme list's shape plus the archive stamp), so nothing
about what a restore or a delete is told changes.
"""
from collections import defaultdict

from django.http import JsonResponse
from django.views.decorators.http import require_GET

from . import views


KINDS = ('programme', 'cohort', 'group', 'module')
KIND_LABEL = {'programme': 'Programme', 'cohort': 'Cohort', 'group': 'Group', 'module': 'Module'}
PAGE_SIZE_DEFAULT = 25
PAGE_SIZE_MAX = 100


# ------------------------------------------------------------------ the reads

def archived_programme_payloads(module_rows, group_rows, cohort_rows):
    """Archived programmes in the programme list's own shape, plus the stamp.

    ``build_programmes`` over the rows already read, rather than the programme
    list endpoint: that endpoint falls back to the full overview build whenever
    legacy catalogue rows exist, which is where its ~13 s went, and the archive
    needs only the few programmes it filters to. ``only_stats_for_ids`` empty
    keeps the per-programme KSB/learner-progress read out -- the details panel
    asks /ksb-stats/ for the one programme it opens.
    """
    configs = views.get_program_config_rows()
    archived_configs = [config for config in configs if views.is_archived_program_config(config)]
    if not archived_configs:
        return []
    weeks = views.authoring_fetch_all(views.AUTHORING_WEEKS_TABLE, columns=views.WEEK_INDEX_COLUMNS)
    counts = views.authoring_programme_structure_counts(source={
        'modules': module_rows, 'groups': group_rows, 'cohorts': cohort_rows, 'weeks': weeks,
    })
    training = views.authoring_modules_as_training_rows(
        module_rows=module_rows, group_rows=group_rows, cohort_rows=cohort_rows,
    )
    programmes = views.build_programmes(
        training, configs, views.get_ksb_profile_rows(), include_config_only=True,
        only_stats_for_ids=frozenset(), structure_counts=counts,
        learner_counts=views.active_learner_programme_counts(),
    )
    stamps = {views.programme_config_identity(config): config for config in archived_configs}
    results = []
    for programme in programmes:
        # The same test the page applied to the full list before.
        if programme.get('isArchived') is not True:
            continue
        config = stamps.get(views.clean_str(programme.get('sourceId'))) or {}
        results.append({**programme, **views.archive_stamp_fields(config)})
    return results


def archive_records():
    """Every archived record, as ``{kind, key, record}``, from one set of reads."""
    with views.curriculum_read_scope():
        views.ensure_program_config_archive_columns()
        cohort_rows = views.authoring_fetch_all(views.COHORT_AUTHORING_DETAILS_TABLE)
        group_rows = views.authoring_fetch_all(views.GROUPS_TABLE)
        module_rows = views.safe_authoring_module_rows()

        is_archived = views.curriculum_row_is_archived
        archived_cohorts = sorted(
            (row for row in cohort_rows if is_archived(row) and views.clean_str(row.get('cohort_id'))),
            key=lambda row: views.format_created_at(row.get('deleted_at')), reverse=True,
        )
        archived_groups = sorted(
            (row for row in group_rows if is_archived(row)),
            key=lambda row: views.format_created_at(row.get('deleted_at')), reverse=True,
        )
        archived_modules = sorted(
            (
                row for row in module_rows
                if views.curriculum_row_effectively_deleted(row) and views.clean_str(row.get('module_catalogue_id'))
            ),
            key=lambda row: views.format_created_at(row.get('deleted_at')), reverse=True,
        )

        cohort_learners, group_learners = views.active_learner_delivery_counts()
        holiday_rows = views.get_holiday_rows_safe()
        cohort_rows_by_id = {
            views.clean_str(row.get('cohort_id')): row
            for row in cohort_rows if views.clean_str(row.get('cohort_id'))
        }
        component_counts = views.archived_module_component_counts(
            [row.get('module_catalogue_id') for row in archived_modules],
        )

        records = [
            {'kind': 'programme', 'record': programme}
            for programme in archived_programme_payloads(module_rows, group_rows, cohort_rows)
        ]
        records += [
            {'kind': 'cohort', 'record': views.archived_cohort_payload(row, archived_groups, cohort_learners, holiday_rows)}
            for row in archived_cohorts
        ]
        records += [
            {'kind': 'group', 'record': views.archived_group_payload(row, cohort_rows_by_id, group_learners)}
            for row in archived_groups if views.clean_str(row.get('group_id'))
        ]
        records += [
            {'kind': 'module', 'record': views.archived_module_payload(row, component_counts)}
            for row in archived_modules
        ]
    for item in records:
        record = item['record']
        item['key'] = f"{item['kind']}:{views.clean_str(record.get('sourceId') or record.get('id'))}"
    return records


# ------------------------------------------------------------ shaping the list

def parent_key(item, keys):
    """The archived record whose own archive took this one down, if it is listed.

    ``archivedViaParent`` holds that parent's id. Its kind is not stored, so it is
    tried against the kinds above this one, nearest first -- a group archived by
    its cohort's delete names the cohort, one archived by a programme's names the
    programme.
    """
    via = views.clean_str(item['record'].get('archivedViaParent'))
    if not via:
        return None
    above = KINDS[:KINDS.index(item['kind'])]
    for kind in reversed(above):
        key = f'{kind}:{via}'
        if key in keys:
            return key
    return None


def nest_under_parents(records):
    """Top-level entries, each with the records archived along with it."""
    by_key = {item['key']: item for item in records}
    parents = {item['key']: parent_key(item, by_key) for item in records}

    def root_of(key):
        seen = set()
        while parents.get(key) and key not in seen:
            seen.add(key)
            key = parents[key]
        return key

    children = defaultdict(list)
    roots = []
    for item in records:
        root = root_of(item['key'])
        if root == item['key']:
            roots.append(item)
        else:
            children[root].append({**item, 'archivedWith': parents[item['key']]})
    return [
        {**item, 'children': sorted(children.get(item['key'], []), key=lambda child: KINDS.index(child['kind']))}
        for item in roots
    ]


def search_text(item):
    record = item['record']
    return ' '.join(views.clean_str(record.get(field)) for field in (
        'name', 'title', 'id', 'catalogueId', 'standard', 'level', 'programme', 'cohort', 'group',
        'coach', 'tutor', 'schedule',
    )).lower() + ' ' + KIND_LABEL[item['kind']].lower()


def matches_search(query, item):
    """Every word of the query appears somewhere -- the list's own matchesSearch."""
    terms = [term for term in views.clean_str(query).lower().split() if term]
    if not terms:
        return True
    haystack = search_text(item)
    return all(term in haystack for term in terms)


def programme_of(item):
    record = item['record']
    if item['kind'] == 'programme':
        return views.clean_str(record.get('sourceId') or record.get('id'))
    return views.clean_str(record.get('programmeId'))


def sort_key(item):
    """Newest archive first; undated after dated; then type, then name."""
    stamp = views.clean_str(item['record'].get('archivedAt'))
    name = views.clean_str(item['record'].get('name') or item['record'].get('title')).lower()
    return (0 if stamp else 1, _descending(stamp), KINDS.index(item['kind']), name)


def _descending(text):
    return tuple(-ord(char) for char in text)


def programme_options(records):
    labels = {}
    for item in records:
        identifier = programme_of(item)
        if not identifier or identifier in labels:
            continue
        record = item['record']
        labels[identifier] = views.clean_str(
            record.get('name') if item['kind'] == 'programme' else record.get('programme'),
        ) or identifier
    return sorted(
        ({'value': value, 'label': label} for value, label in labels.items()),
        key=lambda option: option['label'].lower(),
    )


def bounded_int(value, default, low, high):
    number = views.parse_int(value, default)
    return max(low, min(high, number))


# ------------------------------------------------------------------- the view

@require_GET
def curriculum_archive_index(request):
    """GET /curriculum/archive/ -- one page of the archive.

    Query: ``page``, ``pageSize`` (<= 100), ``type`` (a kind, or empty for all,
    nested), ``programme`` (programme id), ``q`` (search), or ``key`` alone for
    one record.
    """
    records = archive_records()
    schema = views.CURRICULUM_SCHEMA

    key = views.clean_str(request.GET.get('key'))
    if key:
        found = next((item for item in records if item['key'] == key), None)
        return JsonResponse({'schema': schema, 'result': found})

    kind = views.clean_str(request.GET.get('type')).lower()
    if kind not in KINDS:
        kind = ''
    programme = views.clean_str(request.GET.get('programme'))
    query = views.clean_str(request.GET.get('q'))
    page_size = bounded_int(request.GET.get('pageSize'), PAGE_SIZE_DEFAULT, 1, PAGE_SIZE_MAX)

    in_scope = [
        item for item in records
        if (not programme or programme_of(item) == programme)
    ]
    matching = [item for item in in_scope if matches_search(query, item)]
    counts = {name: 0 for name in KINDS}
    for item in matching:
        counts[item['kind']] += 1

    if kind:
        entries = [{**item, 'children': []} for item in matching if item['kind'] == kind]
        by_key = {item['key']: item for item in records}
        for entry in entries:
            entry['archivedWith'] = parent_key(entry, by_key)
    else:
        # Nested over the whole programme scope, then kept when the parent or
        # anything archived with it matches: a search for a group finds it
        # inside the programme it left with, not as a stray row.
        matched_keys = {item['key'] for item in matching}
        entries = [
            entry for entry in nest_under_parents(in_scope)
            if entry['key'] in matched_keys
            or any(child['key'] in matched_keys for child in entry['children'])
        ]
    entries.sort(key=sort_key)

    total = len(entries)
    pages = max(1, -(-total // page_size))
    page = bounded_int(request.GET.get('page'), 1, 1, pages)
    start = (page - 1) * page_size
    return JsonResponse({
        'schema': schema,
        'page': page,
        'pageSize': page_size,
        'pages': pages,
        'total': total,
        'counts': counts,
        'archiveTotal': len(records),
        # Per type across the whole archive, whatever the filters: the hero's
        # figures, which describe the archive rather than this search.
        'totals': {name: sum(1 for item in records if item['kind'] == name) for name in KINDS},
        'programmes': programme_options(records),
        'results': entries[start:start + page_size],
    })
