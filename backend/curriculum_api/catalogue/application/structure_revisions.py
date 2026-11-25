"""Read orchestration for editor structure snapshots and their revision guards.

The API adapter supplies storage/routing and compatibility policies. No framework
startup, database access or save operations belong to this module.
"""
from ..domain.structure_revision import revision_digest, revision_rows

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def module_structure_revision(
    module_catalogue_id,
    *,
    source_rows=None,
    clean_str=_default_clean_str,
    ensure_module_authoring_tables,
    STRUCTURE_REVISION_SOURCES,
    connection_vendor,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    compact_authoring_rows,
    authoring_fetch_all,
    logger,
    column_names,
    STRUCTURE_REVISION_VOLATILE_COLUMNS,
):
    """Fingerprint of everything a structure PATCH would replace.

    Six indexed single-module reads, or the exact source rows already read for
    an editor GET. PATCH always uses fresh reads. A module that is not stored
    fingerprints as the empty structure, so a fresh draft is never a conflict.

    Rows are sorted by their own key rather than trusted in database order: a
    fingerprint that depended on which order Postgres happened to return the
    components in would refuse saves at random.
    """
    catalogue_id = clean_str(module_catalogue_id)
    if not catalogue_id:
        return ''
    ensure_module_authoring_tables()
    material = []
    # Match the payload reader's queries, including ordering, so its read scope
    # reuses these rows. Excluding timestamps in SQL gave the revision a separate
    # memo key and downloaded all component content twice on every fresh open.
    payload_order = {
        'weeks': 'display_order, week_number, id',
        'components': 'display_order, id',
        'mappings': 'created_at, id',
    }
    for label, table, keep, sort_column in STRUCTURE_REVISION_SOURCES:
        try:
            if source_rows is not None:
                rows = source_rows[table]
            elif connection_vendor() == 'postgresql' and table in (AUTHORING_COMPONENTS_TABLE, AUTHORING_KSB_MAPPINGS_TABLE):
                # Verify every current row in SQL, sharing only unchanged raw
                # content with the editor read. This remains a fresh revision,
                # including external writes that never bump the response epoch.
                rows = compact_authoring_rows(
                    table, 'module_catalogue_id = %s', [catalogue_id],
                    'display_order, id' if table == AUTHORING_COMPONENTS_TABLE else 'created_at, id',
                    reuse_unchanged=True,
                )
            else:
                rows = authoring_fetch_all(
                    table,
                    'module_catalogue_id = %s',
                    [catalogue_id],
                    order_sql=payload_order.get(label, ''),
                )
        except Exception:
            # Compatibility: existing save callers treat '' as no guard.
            # Read payloads separately stamp STRUCTURE_REVISION_UNAVAILABLE.
            # Changing this failure contract requires the save-protection work.
            logger.warning('Unable to fingerprint %s for module %s.', table, catalogue_id, exc_info=True)
            return ''
        if keep:
            rows = keep(rows)
        # Only what the table stores is fingerprinted. On the normalised schema
        # authoring_fetch_all adds derived keys (programme_name, tutor_name,
        # deleted_at ...) that the editor GET's source rows do
        # not carry, so the fresh read and the GET hashed different material
        # and every full save was refused as a conflict. Derived keys follow
        # from stored ones, so dropping them loses no change.
        try:
            stored = column_names(table)
        except Exception:
            stored = set()
        material.append([
            label,
            revision_rows(rows, stored, STRUCTURE_REVISION_VOLATILE_COLUMNS, sort_column, clean_str),
        ])
    return revision_digest(material)


def structure_payload_with_revision(
    build_payload,
    module_catalogue_id,
    *,
    source_rows=None,
    module_structure_revision,
    STRUCTURE_REVISION_UNAVAILABLE,
):
    """Build a structure payload and stamp the revision it was built from.

    The revision is read BEFORE the payload, and that order is the whole point.
    These reads run in autocommit, so each statement sees its own snapshot and
    another writer can commit in the middle of the build. Whichever of the two
    is read second describes the later state:

    - payload first, revision second (how this used to work): pre-write weeks
      carrying the post-write fingerprint. The caller saves its stale structure,
      the revision matches, the guard lets it through, and the other writer's
      work is gone with no error raised anywhere. That is precisely the silent
      overwrite this mechanism exists to make impossible.
    - revision first: a payload that may contain a write the revision predates.
      The revision is then already superseded, so the save built on it is
      refused with 409 and the caller reloads. Wrong in the harmless direction.

    So the pair is never certified as a snapshot it is not. It is either exactly
    consistent, or provably stale and fails closed.

    ``build_payload`` is a callable rather than an already-built payload so that
    the ordering cannot be quietly undone at a call site. A caller that has just
    written the structure itself and needs the revision of its own write uses
    ``stamp_revision_after_write``.
    """
    revision = module_structure_revision(
        module_catalogue_id, **({'source_rows': source_rows} if source_rows is not None else {}),
    ) or STRUCTURE_REVISION_UNAVAILABLE
    payload = build_payload()
    if not payload:
        return payload
    return {**payload, 'structureRevision': revision}


def read_module_structure_with_revision(
    module_catalogue_id,
    *,
    module_structure_source_rows,
    structure_payload_with_revision,
    get_authoring_structure_payload,
    with_item_fingerprints,
):
    """Read each owned row once for both the editable payload and its guard.

    A revision and payload assembled from the same rows cannot certify newer
    data than the editor received. PATCH still fingerprints fresh database rows
    before accepting a save. Reused raw rows are verified against their current
    SQL fingerprints on every rebuild, independently of response-cache epochs.
    """
    source_rows = module_structure_source_rows(module_catalogue_id)
    payload = structure_payload_with_revision(
        lambda: get_authoring_structure_payload(module_catalogue_id, source_rows=source_rows),
        module_catalogue_id, source_rows=source_rows,
    )
    return with_item_fingerprints(payload)


def with_item_fingerprints(payload, *, structure_fingerprints):
    """Stamp the per-week and per-component fingerprints the editor merges by.

    Kept beside the content rather than computed in the browser: the browser
    normalises what it reads, and a fingerprint has to describe the server's
    copy exactly for "has anyone changed this since I read it?" to be exact.
    See module_merge.
    """
    if not payload:
        return payload
    return {**payload, 'itemFingerprints': structure_fingerprints(payload)}
