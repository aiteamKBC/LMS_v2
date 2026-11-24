"""The KSB numbers of several programme cards, in one request.

``/programmes/<id>/ksb-stats/`` answers for one programme, and the Programmes
and Reports pages used to ask it once per card. The browser's curriculum client
sends those reads one at a time (they are expensive, so it never runs two at
once), so the last card waited for every card before it: measured on a branch
of the new database, the eight cards cost ~8-11s of building but ~60s in the
browser, the difference being per-request overhead and queueing.

Here every requested programme is built inside one read scope, so the reads
they share -- programmes, cohorts, configs, the cache epochs -- are made once
(34 queries -> 20 for eight cards, output identical). Each programme still goes
through the same per-programme cache entry the single endpoint uses, under the
same key and TTL, so the two endpoints warm each other and freshness is decided
exactly where it was.
"""
from django.views.decorators.http import require_GET

from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_LEARNER_DATA_TTL_SECONDS
from curriculum_api.catalogue.infrastructure.programme_builder_runtime import build_programme_ksb_stats
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.api.responses import curriculum_visibility, json_error
from curriculum_api.reporting.infrastructure.source_runtime import forced_programme_ksb_design
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from .http_cache import conditional_json_response, encode_json_entry, encode_json_error_entry, entry_payload

# A page shows at most a few dozen programmes. The cap keeps one request from
# turning into an unbounded build.
MAX_PROGRAMMES = 60


def programme_ids(request):
    raw = clean_str(request.GET.get('ids'))
    seen = []
    for part in raw.split(','):
        identifier = clean_str(part)
        if identifier and identifier not in seen:
            seen.append(identifier)
    return seen


def programme_stats_entry(identifier, visibility, force):
    """The encoded entry ``views.curriculum_programme_ksb_stats`` serves -- same key, build and TTL."""
    def build_entry():
        with forced_programme_ksb_design(force):
            stats = build_programme_ksb_stats(identifier, visibility)
        if not stats:
            return encode_json_error_entry('Programme not found.', status=404)
        return encode_json_entry(stats)

    return cached_curriculum_value(
        f'programme-ksb-stats-response:{visibility}:{identifier}',
        build_entry,
        force=force,
        ttl=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
        scope=identifier,
    )


@require_GET
def curriculum_programmes_ksb_stats(request):
    """``{"stats": {<id>: <the single endpoint's body> | null}}``; null is "Programme not found"."""
    identifiers = programme_ids(request)
    if not identifiers:
        return json_error('Choose at least one programme.', status=400)
    if len(identifiers) > MAX_PROGRAMMES:
        return json_error(f'Ask for at most {MAX_PROGRAMMES} programmes at a time.', status=400)
    visibility = curriculum_visibility(request)
    force = request_bypasses_curriculum_cache(request)
    stats = {}
    with curriculum_read_scope(targeted_child_reads=True):
        for identifier in identifiers:
            entry = programme_stats_entry(identifier, visibility, force)
            stats[identifier] = entry_payload(entry) if entry.get('status', 200) == 200 else None
    return conditional_json_response(request, encode_json_entry({'stats': stats}))
