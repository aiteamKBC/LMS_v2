"""Preserve programme design cache generation and request-local force state."""


def programme_ksb_design_value(
    kind,
    programme_id,
    build,
    *,
    extra_key='',
    _PROGRAMME_KSB_DESIGN_FORCE,
    cached_curriculum_value,
    clean_str,
):
    """A programme's KSB *design* figure, cached on the programme's generation.

    The figures the design decides -- which required KSBs its components map,
    and each KSB's mapped weight -- come from curriculum tables alone, so they
    are retired by the programme's cache generation like the modules section,
    instead of being rebuilt with the learner progress on every 60s expiry of
    ksb-stats. The learner side is never part of this value. A failed read
    raises and stores nothing.
    """
    programme_id = clean_str(programme_id)
    return cached_curriculum_value(
        f'programme-ksb-design:{kind}:{programme_id}:{extra_key}',
        build,
        force=getattr(_PROGRAMME_KSB_DESIGN_FORCE, 'on', False),
        scope=programme_id,
    )


def forced_programme_ksb_design(force, *, _PROGRAMME_KSB_DESIGN_FORCE):
    """Within a forced ksb-stats read, build the design figures afresh too.

    A forced read is a caller asking for the state it just wrote; the design
    cache below must not answer it from a generation this worker polled before
    that write.
    """
    previous = getattr(_PROGRAMME_KSB_DESIGN_FORCE, 'on', False)
    _PROGRAMME_KSB_DESIGN_FORCE.on = bool(force) or previous
    try:
        yield
    finally:
        _PROGRAMME_KSB_DESIGN_FORCE.on = previous
