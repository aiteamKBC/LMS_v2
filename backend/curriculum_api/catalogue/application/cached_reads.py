"""Application cached reads. Explicit read capabilities preserve legacy contracts."""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def get_cached_curriculum_rows(
    compact=False, force=False, *, CURRICULUM_ROWS_CACHE_TTL_SECONDS, cached_curriculum_value,
    get_curriculum_rows,
):
    """The raw curriculum rows, read once and shared by both visibilities.

    Nothing downstream mutates these dicts -- the payload builders only read
    them and emit new ones -- so the two visibility builds can hold the same
    lists. ``force`` reaches here from a caller that has just written and is
    asking for its own state back; it must not be answered from rows read
    before that write.
    """
    return cached_curriculum_value(
        f'rows:{"compact" if compact else "full"}',
        lambda: get_curriculum_rows(compact=compact),
        force=force,
        ttl=CURRICULUM_ROWS_CACHE_TTL_SECONDS,
        shared=True,
        compress=True,
    )


def build_curriculum_payload(
    visibility='operational', compact=False, force=False, *, learner_profiles=False,
    build_curriculum_payload_from_rows, curriculum_read_scope, get_cached_curriculum_rows, logger,
):
    logger.info('build_curriculum_payload: running DB build for visibility=%s compact=%s', visibility, compact)
    with curriculum_read_scope():
        rows = get_cached_curriculum_rows(compact=compact, force=force)
        identity_options = {'learner_profiles': True} if learner_profiles else {}
        return build_curriculum_payload_from_rows(rows, visibility, compact=compact, **identity_options)


def cached_programme_detail_section(
    identifier,
    visibility,
    section,
    workspace_view,
    *,
    force=False,
    CURRICULUM_LEARNER_DATA_TTL_SECONDS,
    cached_curriculum_value,
    clean_str=_default_clean_str,
    curriculum_read_scope,
    programme_detail_section_entry,
    programme_shell_learner_fingerprint,
):
    with curriculum_read_scope(targeted_child_reads=True):
        return cached_curriculum_value(
            f'programme-detail-{section}-response:authored-v3:{visibility}:{clean_str(identifier)}'
            + (':workspace-v1' if workspace_view else ''),
            lambda: programme_detail_section_entry(identifier, visibility, section, workspace_view),
            force=force,
            # The shell carries learner counts; the modules section none. Past
            # the 60s the shell is re-checked against the learner rows rather
            # than rebuilt, and rebuilt only when they have moved.
            ttl=CURRICULUM_LEARNER_DATA_TTL_SECONDS if section == 'shell' else None,
            scope=clean_str(identifier),
            fingerprint=programme_shell_learner_fingerprint if section == 'shell' else None,
        )


def build_curriculum_overview(
    visibility='operational',
    compact=False,
    force=False,
    *,
    learner_profiles=False,
    CURRICULUM_ROWS_CACHE_TTL_SECONDS,
    build_curriculum_payload_from_rows,
    cached_curriculum_value,
    curriculum_read_scope,
    get_required_curriculum_rows
):
    """Required source reads for the overview GET; no change to post-save readers."""
    with curriculum_read_scope():
        # Separate entries prevent a legacy partial read from satisfying this
        # contract. Epoch invalidation, TTL, compression and force stay shared.
        rows = cached_curriculum_value(
            f'rows-required:v2:{"compact" if compact else "full"}',
            lambda: get_required_curriculum_rows(compact=compact),
            force=force, ttl=CURRICULUM_ROWS_CACHE_TTL_SECONDS, shared=True, compress=True,
        )
        identity_options = {'learner_profiles': True} if learner_profiles else {}
        return build_curriculum_payload_from_rows(rows, visibility, compact=compact, **identity_options)
