"""Existing enrolment-plan and group-preset reads, without HTTP or writer imports.

This compatibility reader preserves the currently active saved-plan policy.
It does not replace normalized profile membership or activate a new plan workflow.
"""
import json

from django.db import connection, connections

from curriculum_api.catalogue.infrastructure.course_storage_reads import read_sql
from learner_api.placement_links import placement_ids
from learner_api.projection_performance import projection_call, projection_operation
from learner_api.learning_plans.domain.stored_plan import _s, stored_training_plan


def _rows(sql, params, *, using="default"):
    # Deliberately the `default` alias: every caller reads curriculum.*, which is
    # owned by curriculum_api and migrated on `default`. Not an oversight — see
    # the note in apprenticeship_agreement._group_dates.
    with projection_operation('assignment_query'), connections[using].cursor() as cursor:
        cursor.execute(read_sql(sql, cursor.db), params)
        columns = [c[0] for c in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

GROUP_PRESET_SOURCE = """(
    SELECT g.group_id, g.group_name, g.programme_id,
           p.name AS programme_name, g.created_at, g.updated_at,
           COALESCE((SELECT jsonb_agg(m.module_catalogue_id ORDER BY m.module_catalogue_id)
                     FROM curriculum.modules m WHERE m.group_id = g.group_id), '[]'::jsonb) AS module_ids
    FROM curriculum.groups g
    LEFT JOIN curriculum.programmes p ON p.programme_id = g.programme_id
)"""

GROUP_PRESET_SQL = """
SELECT module_ids
FROM {source} AS preset
WHERE group_name = %s AND (programme_name = %s OR programme_id = %s)
ORDER BY
    -- jsonb_array_length() errors on a scalar, and this column is not
    -- guaranteed to hold an array -- the parsing in _group_module_ids allows
    -- for a string too. Anything that is not an array sorts as empty.
    jsonb_array_length(
        CASE WHEN jsonb_typeof(module_ids) = 'array'
             THEN module_ids ELSE '[]'::jsonb END
    ) DESC,
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST,
    group_id
LIMIT 1
"""

GROUP_PRESET_BULK_SQL = """
SELECT DISTINCT ON (p.programme, p.grp)
       p.programme, p.grp, g.module_ids
FROM unnest(%s::text[], %s::text[]) AS p(programme, grp)
JOIN {source} g
  ON g.group_name = p.grp
 AND (g.programme_name = p.programme OR g.programme_id = p.programme)
ORDER BY
    p.programme, p.grp,
    jsonb_array_length(
        CASE WHEN jsonb_typeof(g.module_ids) = 'array'
             THEN g.module_ids ELSE '[]'::jsonb END
    ) DESC,
    g.updated_at DESC NULLS LAST,
    g.created_at DESC NULLS LAST,
    g.group_id
"""

def _group_preset_rows(programme, group, source=None):
    """The one group row the preset comes from, or nothing."""
    return _rows(
        GROUP_PRESET_SQL.format(source=f'(SELECT * FROM {source})' if source else GROUP_PRESET_SOURCE),
        [group, programme, programme],
    )

def _module_ids_from_column(ids):
    """The module_ids column as a list of trimmed strings."""
    if isinstance(ids, str):
        try:
            ids = json.loads(ids)
        except ValueError:
            return []
    return [_s(i) for i in ids] if isinstance(ids, list) else []

def _manual_roster_module_ids(module_ids):
    """Return module ids that stay attached to a group but never inherit learners.

    A manual-roster duplicate remains structurally linked through group_id.
    Learner plan resolution filters
    the ids here instead of deleting the module from its parent.  The lookup is
    deliberately best-effort for older test/install schemas; an unavailable
    column means the pre-feature inherited behaviour, never a blank plan.
    """
    wanted = [item for item in dict.fromkeys(_s(value) for value in module_ids) if item]
    if not wanted:
        return set()
    table = 'curriculum.modules' if connection.vendor == 'postgresql' else 'modules'
    placeholders = ', '.join(['%s'] * len(wanted))
    try:
        rows = _rows(
            f"SELECT module_catalogue_id FROM {table} "
            f"WHERE module_catalogue_id IN ({placeholders}) "
            "AND COALESCE(learner_roster_mode, 'inherited') = 'manual'",
            wanted,
        )
    except Exception:
        return set()
    return {_s(row.get('module_catalogue_id')) for row in rows if _s(row.get('module_catalogue_id'))}

def group_module_ids_bulk(pairs, source=None):
    """`_group_module_ids` for many (programme, group) pairs, in one query.

    Every pair asked for is present in the result, mapping to [] when no live
    group matches -- the caller can seed a cache with it and never ask again.

    One round trip instead of one per pair. On the curriculum payload build that
    was 46 sequential lookups of a 155-row table, ~3.2 s of latency for ~70 ms of
    work, because the learner counts need a preset per distinct group.
    """
    wanted = [(_s(programme), _s(group)) for programme, group in pairs]
    askable = sorted({pair for pair in wanted if pair[1]})
    found = {}
    if askable:
        rows = _rows(
            GROUP_PRESET_BULK_SQL.format(source=f'(SELECT * FROM {source})' if source else GROUP_PRESET_SOURCE),
            [[pair[0] for pair in askable], [pair[1] for pair in askable]],
        )
        found = {
            (_s(row.get('programme')), _s(row.get('grp'))): _module_ids_from_column(row.get('module_ids'))
            for row in rows
        }
        manual_ids = _manual_roster_module_ids(
            [module_id for values in found.values() for module_id in values]
        )
        found = {
            key: [module_id for module_id in values if module_id not in manual_ids]
            for key, values in found.items()
        }
    return {pair: found.get(pair, []) for pair in wanted}

GROUP_PRESET_BY_ID_SQL = """
SELECT module_ids
FROM {source} AS preset
WHERE group_id = %s
"""

def _group_module_ids(programme, group, source=None, group_id=""):
    """The module ids preset on the learner's group.

    ``group_id``, when the learner's placement holds one, names the group
    exactly: no rename can detach it and no namesake in another cohort can
    stand in for it. Everything below describes the name lookup a learner
    without one still falls back to.

    A group is identified here by name and programme, but that pair is not
    unique: the same group name recurs in every cohort of a programme, so
    "G1" on Project Controls L6 matches three rows teaching 9, 1 and 0 modules.
    The learner's cohort would settle it, and this function is never given one —
    all five call sites pass (programme, group) only.

    That left a bare LIMIT 1 with no ORDER BY, which is not a tiebreak but the
    absence of one: Postgres returns whichever row it reaches first, and the
    same learner could inherit nine modules on one request and none on the next.

    So the choice is made explicitly instead:

    * Soft-deleted groups are excluded outright. They were matching, and a
      deleted group has no curriculum to lend anybody.
    * A group that carries modules wins over one that carries none. Neither is
      more "correct" without a cohort, but they fail very differently — an empty
      row reads as "this group teaches nothing" and silently strips every module
      the learner inherits, while a populated one at worst offers a sibling
      cohort's list, which the learner's own saved plan overrides anyway.
    * Then the most recently updated row, then group_id, so the answer is
      stable across requests and across replicas.

    Cohort-blindness itself is unfixed; this only stops it being random.
    """
    group_id = _s(group_id)
    if group_id:
        rows = _rows(GROUP_PRESET_BY_ID_SQL.format(
            source=f'(SELECT * FROM {source})' if source else GROUP_PRESET_SOURCE), [group_id])
    elif group:
        rows = _group_preset_rows(programme, group, source)
    else:
        return []
    if not rows:
        return []
    # Shared with group_module_ids_bulk so the two cannot read the same column
    # differently.
    module_ids = _module_ids_from_column(rows[0].get("module_ids"))
    manual_ids = _manual_roster_module_ids(module_ids)
    return [module_id for module_id in module_ids if module_id not in manual_ids]

def _preset_ids_for(learner, cache):
    """The learner's group preset, cached by its canonical group ID.

    A learner with no saved plan is *shown* their group's preset — see
    ``_serialize`` — so that preset is their effective plan. Assigning one
    module has to keep it: writing only the ticked module would silently drop
    every other module their group teaches.
    """
    group_id = projection_call('assignment_placement', placement_ids, learner)["group_id"]
    if not group_id:
        return []
    key = ("group_id", group_id)
    if key not in cache:
        cache[key] = _group_module_ids("", "", group_id=group_id)
    return cache[key]

def request_preset_cache(learner):
    """The group-preset cache a reader shares across one request, else a fresh one.

    A Dashboard tab resolves the effective plan in several shared helpers; each
    passing ``{}`` re-reads the same (programme, group) preset. ``read_tab``
    installs one dict on its request-scoped source so the preset is read once.
    """
    cache = getattr(learner, '_plan_preset_cache', None)
    return cache if cache is not None else {}

def _effective_plan_ids(learner, preset_cache, *, saved_plan=...):
    """The module ids this learner is currently taught: saved plan, else preset.

    A saved plan also picks up modules added to the learner's group since it was
    agreed, exactly as ``_serialize`` shows them. Both sides read the plan the
    same way, so a module inherited from the group reads as assigned here too
    and the picker cannot contradict the modal.
    """
    if saved_plan is ... and hasattr(learner, "_canonical_training_plan"):
        saved = list(learner._canonical_training_plan or [])
    else:
        saved = stored_training_plan(learner) if saved_plan is ... else saved_plan
    if saved is None:
        return list(_preset_ids_for(learner, preset_cache))
    ids = [_s(entry.get("moduleId")) for entry in saved if _s(entry.get("moduleId"))]
    # An emptied plan stays empty, and is not re-filled from the group. Same
    # rule as _serialize. Explicit curriculum selections also keep their scope.
    if not ids or any(entry.get('assignmentMode') == 'explicit' for entry in saved):
        return ids
    planned = set(ids)
    return ids + [i for i in _preset_ids_for(learner, preset_cache) if i not in planned]
