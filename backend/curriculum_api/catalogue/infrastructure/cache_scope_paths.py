"""Pure path classification for cache invalidation; no application imports."""
import re

_MODULE_WRITE = re.compile(
    r'^/curriculum/modules/(?P<id>[^/]+)/(?:structure/|settings/|components/[^/]+/|weeks/[^/]+/)?$'
)

_GROUP_WRITE = re.compile(r'^/curriculum/groups/(?P<id>[^/]+)/$')

_COHORT_WRITE = re.compile(r'^/curriculum/cohorts/(?P<id>[^/]+)/$')

_SCOPED_METHODS = frozenset({'PUT', 'PATCH', 'POST'})

_RESERVED_SEGMENTS = frozenset({'tutor-email', 'reorder', 'bulk', 'restore'})

def write_seeds(method, path):
    """``{'modules': [...], 'groups': [...], 'cohorts': [...]}`` or None."""
    if method not in _SCOPED_METHODS:
        return None
    for pattern, kind in ((_MODULE_WRITE, 'modules'), (_GROUP_WRITE, 'groups'), (_COHORT_WRITE, 'cohorts')):
        match = pattern.match(path)
        if match:
            value = match.group('id')
            if not value or value in _RESERVED_SEGMENTS:
                return None
            return {'modules': [], 'groups': [], 'cohorts': [], kind: [value]}
    return None
