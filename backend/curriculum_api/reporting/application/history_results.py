"""Canonical history result assembly from supplied rows and read capabilities."""


def trail_payload(
    *, ACTIONS, action_filter, actor_type_filter, audit_pages_workspace_options, columns, coverage_keys,
    datetime, days, derived_PROVENANCE_REVISION, derived_PROVENANCE_TIMESTAMPS, entity_filter,
    entity_type_options, limit, merge_actors, result, revision_actors, revision_event, since,
    source_filter, structured, system_writes_change_workspaces, versioning_ACTOR_TYPES,
    versioning_SOURCES, workspace,
):
    total = result['total']
    page = result['page']
    pages_total = result['pages']
    truncated = total > limit

    # The page's revisions arrive in full -- snapshot, changes, metadata --
    # joined on in the same statement, in the order the combined feed put them.
    events = []
    for row in result['rows']:
        events.append(revision_event({column: row.get(f'rev_{column}') for column in columns}))

    # Counted in SQL over the whole combined window rather than over the page,
    # so the headline figures answer "what happened in this period" and do not
    # change as somebody pages through it.
    action_counts = {action: 0 for action in ACTIONS}
    action_counts.update(result['action_counts'])
    entity_counts = result['entity_counts']
    return {
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since.isoformat(),
        'limit': limit,
        'page': page,
        'pageSize': limit,
        'pages': pages_total,
        'total': total,
        'truncated': truncated,
        'actionCounts': action_counts,
        'entityCounts': entity_counts,
        'unreadable': sorted(set(result['unreadable'])),
        # How much of this window is the log's and how much was recovered from
        # timestamps, so the page can say so instead of letting a recovered
        # event read as though the log had seen it.
        'provenanceCounts': {
            derived_PROVENANCE_REVISION: int(result['provenance_counts'].get(derived_PROVENANCE_REVISION, 0)),
            derived_PROVENANCE_TIMESTAMPS: 0,
        },
        # Whether older, timestamp-recovered history was read into this feed.
        # False for a filter only the log can answer, and when it failed.
        'recoveredHistory': False,
        'recoveryFailed': False,
        # Where each record type's revision history begins. Recovered events of
        # that type stop strictly before it; null means the log has none yet.
        'revisionStartedAt': {
            entity: (moment.isoformat() if moment is not None else None)
            for entity, moment in sorted(result['boundaries'].items())
        },
        # The log records the signed-in account on every write, so the trail can
        # name one. Rows older than the log still carry none, and are shown as
        # such rather than attributed to whoever happens to be nearby.
        'authorRecorded': True,
        'source': 'revisions',
        # Whether this response can answer "was that a person or the system?"
        # from a column rather than from a parsed string. The page uses it to
        # decide which filters it can honestly offer.
        'structuredMetadata': structured,
        'workspaces': audit_pages_workspace_options(),
        # Only the canonical revision log is reported here.
        **coverage_keys(
            audit_pages_workspace_options(),
            revision=system_writes_change_workspaces(),
            derived=[],
        ),
        'sources': sorted(versioning_SOURCES),
        'actorTypes': sorted(versioning_ACTOR_TYPES),
        # The record types this door can actually show, named by the server.
        # The page used to hold its own list, which was the curriculum's ten
        # types -- so the system-wide Audit Trail offered a Record type filter
        # that could not name a learner, a coaching meeting or an employer, and
        # read as though the curriculum were the only thing being audited.
        'entityTypes': entity_type_options('' if structured else workspace),
        # The Who list is a facet of the other filters, not a global directory
        # of everybody who changed anything in the window. Otherwise choosing
        # a person from the unfiltered list can legitimately return zero rows
        # once Action or Record type has narrowed the feed.
        'actors': merge_actors(revision_actors(
            since, workspace, entity_filter, action_filter, source_filter, actor_type_filter,
        ), []),
        'events': events,
    }


def version_entities(
    *, curriculum_views_clean_str, iso, latest_revision_by_entity, named_version_counts, search,
    summary_rows,
):
    keys = [
        (curriculum_views_clean_str(row.get('entity_type')), curriculum_views_clean_str(row.get('entity_id')))
        for row in summary_rows
    ]
    latest = latest_revision_by_entity(keys)
    named = named_version_counts(keys)

    entities = []
    for row in summary_rows:
        row_type = curriculum_views_clean_str(row.get('entity_type'))
        entity_id = curriculum_views_clean_str(row.get('entity_id'))
        head = latest.get((row_type, entity_id)) or {}
        title = curriculum_views_clean_str(head.get('title'))
        if search and search not in title.lower() and search not in entity_id.lower():
            continue
        entities.append({
            'entityType': row_type,
            'entityId': entity_id,
            'title': title,
            'moduleCatalogueId': curriculum_views_clean_str(head.get('module_catalogue_id')),
            'parentId': curriculum_views_clean_str(head.get('parent_id')),
            'versionLabel': curriculum_views_clean_str(head.get('version_label')),
            'contentStatus': curriculum_views_clean_str(head.get('content_status')),
            'action': curriculum_views_clean_str(head.get('action')),
            'revisions': int(row.get('revisions') or 0),
            'namedVersions': named.get((row_type, entity_id), 0),
            'lastChangeAt': iso(row.get('last_change')),
            'firstChangeAt': iso(row.get('first_change')),
            'lastActorName': curriculum_views_clean_str(head.get('actor_name')),
        })
    return entities
