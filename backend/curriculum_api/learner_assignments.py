"""Cohort and module learner assignment using the existing learner plan."""
import json
import logging

from django.db import DatabaseError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from login.permissions import staff_only
from learner_api import learning_plan as plans

from learner_api.placement_links import with_placements, placement_ids, RELATIONS, CACHE
from learner_api.active_users import hydrate_training_plan
from learner_api.mappers import get_training_plan, stored_training_plan, training_plan_field
from learner_api.models import EnrolmentUser, LearnerProfile

from . import module_plan_rows

logger = logging.getLogger(__name__)


def _target(scope, identifier):
    from . import views

    if scope == 'cohort':
        row = views.resolve_cohort_row(identifier)
        if not row or views.curriculum_row_effectively_deleted(row):
            return None
        cohort_id = views.clean_str(row.get('cohort_id'))
        groups = views.authoring_fetch_all(views.GROUPS_TABLE, 'cohort_id = %s', [cohort_id])
        group_ids = {views.clean_str(group.get('group_id')) for group in groups}
        modules = [
            module for module in views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE)
            if not views.curriculum_row_effectively_deleted(module)
            and (views.clean_str(module.get('cohort_id')) == cohort_id
                 or (views.clean_str(module.get('group_id')) in group_ids
                     and views.clean_str(module.get('group_id'))))
        ]
        return {
            'id': cohort_id, 'name': views.clean_str(row.get('cohort_name')), 'scope': scope,
            'programmeName': views.clean_str(row.get('programme_name')),
            'programmeId': views.clean_str(row.get('programme_id')),
            'moduleIds': list(dict.fromkeys(views.clean_str(m.get('module_catalogue_id')) for m in modules)),
            'groupIds': group_ids,
        }
    # Assignment requests normally carry the stored MOD-* id. Resolve that
    # form with the indexed existence check first; legacy aliases still fall
    # through to the broad resolver.
    module_id = views.resolve_stored_module_catalogue_id(identifier) or identifier
    rows = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id])
    if not rows or views.curriculum_row_effectively_deleted(rows[0]):
        return None
    row = rows[0]
    return {
        'id': module_id, 'name': views.clean_str(row.get('title')), 'scope': scope,
        'programmeName': views.clean_str(row.get('programme_name')),
        'programmeId': views.clean_str(row.get('programme_id')), 'moduleIds': [module_id],
    }


def _same_cohort(learner, target):
    ids = placement_ids(learner)
    return ids['cohort_id'] == target['id'] and ids['programme_id'] == target['programmeId']


def _cohort_members(target, cache):
    """{module id: member enrolment ids} for the cohort's modules, read once per request.

    Membership by the card's rule over `"Learner".learners` and
    `learner_training_plan_modules`, never the legacy JSON plan.
    """
    if '_cohortMembers' not in cache:
        from .learner_status_counts import module_member_enrolment_ids_by_module
        cache['_cohortMembers'] = module_member_enrolment_ids_by_module(target['moduleIds'])
    return cache['_cohortMembers']


def _assigned(learner, target, cache):
    """Cohort assignment: placed in the cohort and a member of every one of its modules."""
    members = _cohort_members(target, cache)
    learner_id = str(learner.pk)
    return (all(learner_id in members.get(module_id, ()) for module_id in target['moduleIds'])
            and _same_cohort(learner, target))


def _plan_row_counts():
    """Saved plan rows per enrolment id: the drawers' "N modules" figure."""
    from . import views
    with views.connection.cursor() as cursor:
        cursor.execute("""
            SELECT l.enrolment_id, count(t.id)
            FROM "Learner".learners l
            JOIN "Learner".learner_training_plan_modules t ON t.learner_id = l.id
            WHERE l.enrolment_id IS NOT NULL
            GROUP BY l.enrolment_id
        """)
        return {str(enrolment_id): count for enrolment_id, count in cursor.fetchall()}


def _payload(target, learners):
    """The "Assign learners" directory, with membership from the normalized records.

    `assigned` and `moduleCount` use the same source as the module card and the
    module drawer, so a learner assigned in Module Builder shows as assigned here.
    """
    if target['scope'] == 'module':
        return _module_payload(target, learners)
    cache = {}
    module_counts = _plan_row_counts()
    rows = [_row(learner, _assigned(learner, target, cache), module_counts.get(str(learner.pk), 0))
            for learner in learners]
    return {
        'target': {**{key: target[key] for key in ('id', 'name', 'scope', 'programmeName')},
                   'moduleCount': len(target['moduleIds'])},
        'learners': rows,
        'totals': {'learnerCount': len(rows), 'assignedCount': sum(row['assigned'] for row in rows)},
    }


def _row(learner, assigned, module_count):
    return {
        'id': str(learner.pk), 'name': plans._s(learner.username) or plans._s(learner.email),
        'email': plans._s(learner.email), 'programme': plans._s(learner.programme),
        'company': plans._s(learner.employer) or plans._s(learner.organization),
        'cohort': plans._s(learner.cohort), 'group': plans._s(learner.group),
        'programmeStatus': plans._s(learner.programme_status),
        'learnerType': plans._s(learner.learner_type) or 'apprenticeship',
        'assigned': assigned, 'moduleCount': module_count,
    }


def _module_payload(target, learners):
    """Module drawer: assigned learners are exactly the ones the card counts.

    Membership comes from `"Learner".learners` and
    `learner_training_plan_modules` through the card's own rule
    (`learner_status_counts.module_member_enrolment_ids`), not from the legacy
    JSON plan, so the drawer and the "N learners" figure share one source.
    """
    from . import views
    from .learner_status_counts import module_member_enrolment_ids

    members = module_member_enrolment_ids(target['id']) or set()
    module_counts = _plan_row_counts()
    rows = [_row(learner, str(learner.pk) in members, module_counts.get(str(learner.pk), 0))
            for learner in learners]
    return {
        'target': {**{key: target[key] for key in ('id', 'name', 'scope', 'programmeName')},
                   'moduleCount': len(target['moduleIds'])},
        'learners': rows,
        'totals': {'learnerCount': len(rows), 'assignedCount': sum(row['assigned'] for row in rows)},
    }


def _save_legacy_plan(learner, plan):
    field = training_plan_field(learner)
    setattr(learner, field, plan)
    learner.save(update_fields=[field])


def _module_members(target, cache):
    """The drawer's assigned set, read once per save and shared by every learner in it."""
    if '_moduleMembers' not in cache:
        from .learner_status_counts import module_member_enrolment_ids
        cache['_moduleMembers'] = module_member_enrolment_ids(target['id']) or set()
    return cache['_moduleMembers']


def _assign_module(learner, target, catalogue, cache):
    """Add one module to both plan stores without wiping rows the JSON lacks.

    "Already assigned" means what the drawer shows: membership by the card's
    rule. The JSON plan gets the module if it lacks it. A learner with plan rows
    gets just this module's rows; one with none is written out in full from the
    JSON, which loses nothing.
    """
    module_id = target['moduleIds'][0]
    if str(learner.pk) in _module_members(target, cache):
        return False
    profile = module_plan_rows.profile_for(learner)
    targeted = module_plan_rows.has_plan_rows(profile)
    legacy_has = module_id in set(plans._effective_plan_ids(learner, cache))
    if '_assignmentModules' not in cache:
        additions = hydrate_training_plan([catalogue[mid] for mid in target['moduleIds']], strict=True)
        cache['_assignmentModules'] = {entry['moduleId']: entry for entry in additions}
    hydrated = cache['_assignmentModules']
    # An unsaved plan that holds the module only through the group preset is
    # written out too, or the rows built from it below would not carry the module.
    write_legacy = not legacy_has or stored_training_plan(learner) is None
    if write_legacy:
        saved = stored_training_plan(learner)
        existing = list(saved if saved is not None else get_training_plan(learner) or [])
        existing_ids = {plans._s(entry.get('moduleId')) for entry in existing}
        for mid in [*plans._effective_plan_ids(learner, cache), module_id]:
            if mid and mid not in existing_ids:
                existing.append(dict(catalogue.get(mid) or {'moduleId': mid}))
                existing_ids.add(mid)
        existing = [dict(entry, assignmentMode='explicit') for entry in existing]
        _save_legacy_plan(learner, [{**entry, **hydrated.get(entry.get('moduleId'), {})} for entry in existing])
    if targeted:
        if write_legacy:
            module_plan_rows.refresh_title_columns(learner)
        module_plan_rows.add_module_row(profile, hydrated.get(module_id) or catalogue[module_id])
    else:
        # No plan rows yet, so a full rebuild from the JSON loses nothing.
        plans.sync_learning_plan_mirror(learner, strict=True)
    return True


def _unassign_module(learner, target, cache):
    """Remove one module from both plan stores without wiping rows the JSON lacks."""
    module_id = target['moduleIds'][0]
    if str(learner.pk) not in _module_members(target, cache):
        return False
    profile = module_plan_rows.profile_for(learner)
    targeted = module_plan_rows.has_plan_rows(profile)
    legacy_has = module_id in set(plans._effective_plan_ids(learner, cache))
    if legacy_has:
        saved = stored_training_plan(learner)
        existing = list(saved if saved is not None else get_training_plan(learner) or [])
        # Frozen as explicit, so a group preset does not put the module straight back.
        _save_legacy_plan(learner, [dict(entry, assignmentMode='explicit') for entry in existing
                                    if plans._s(entry.get('moduleId')) != module_id])
    if targeted:
        if legacy_has:
            module_plan_rows.refresh_title_columns(learner)
        module_plan_rows.remove_module_rows(profile, module_id)
    else:
        # No plan rows: the learner held the module through placement. Writing the
        # remaining JSON plan out as rows makes their selection explicit, without
        # the module. A learner whose plan would be empty has no row to carry
        # that, so the removal is reported as failed rather than claimed.
        plans.sync_learning_plan_mirror(learner, strict=True)
        if not module_plan_rows.has_plan_rows(module_plan_rows.profile_for(learner)):
            raise ValueError('This learner has no other modules, so the removal cannot be recorded.')
    return True


def _assign(learner, target, catalogue, cache):
    if target['scope'] == 'module':
        return _assign_module(learner, target, catalogue, cache)
    if _assigned(learner, target, cache):
        return False
    # Preserve detailed and retired entries, as well as the modules this learner
    # already inherits. Only the target contributes new modules.
    saved = stored_training_plan(learner)
    existing = list(saved if saved is not None else get_training_plan(learner) or [])
    existing_ids = {plans._s(entry.get('moduleId')) for entry in existing}
    for module_id in [*plans._effective_plan_ids(learner, cache), *target['moduleIds']]:
        if module_id and module_id not in existing_ids:
            existing.append(dict(catalogue.get(module_id) or {'moduleId': module_id}))
            existing_ids.add(module_id)
    # Freeze this explicitly selected set. A later plan read must not turn one
    # module added to an empty plan into the learner's entire group preset.
    existing = [dict(entry, assignmentMode='explicit') for entry in existing]
    # Expand the target's content once for the entire bulk operation.
    if '_assignmentModules' not in cache:
        additions = hydrate_training_plan([catalogue[module_id] for module_id in target['moduleIds']], strict=True)
        cache['_assignmentModules'] = {entry['moduleId']: entry for entry in additions}
    hydrated = cache['_assignmentModules']
    plan = [{**entry, **hydrated.get(entry.get('moduleId'), {})} for entry in existing]
    field = training_plan_field(learner)
    setattr(learner, field, plan)
    fields = [field]
    if target['scope'] == 'cohort':
        keep_group = _same_cohort(learner, target) and placement_ids(learner)['group_id'] in target['groupIds']
        # Only an explicit assignment changes placement; enrolment remains registration data.
        profile_updates = {'programme_id': target['programmeId'] or None, 'cohort_id': target['id']}
        if not keep_group:
            profile_updates['group_id'] = None
        updated = (LearnerProfile.objects.using(learner._state.db or 'default')
                   .filter(enrolment_id=learner.pk).update(**profile_updates))
        if updated != 1:
            raise ValueError('Exactly one linked learner is required for cohort assignment.')
        learner.__dict__.pop(CACHE, None)
        learner.__dict__.pop('_placement_names', None)
    learner.save(update_fields=fields)
    profile = module_plan_rows.profile_for(learner)
    if module_plan_rows.has_plan_rows(profile):
        # Add only the cohort's modules. A full rebuild from the JSON would
        # delete the rows the JSON lacks (modules assigned in Module Builder).
        module_plan_rows.refresh_title_columns(learner)
        for module_id in target['moduleIds']:
            module_plan_rows.add_module_row(profile, hydrated.get(module_id) or catalogue[module_id])
    else:
        # No plan rows yet, so a full rebuild from the JSON loses nothing.
        plans.sync_learning_plan_mirror(learner, strict=True)
    return True


def _unassign(learner, target, catalogue, cache):
    # `catalogue` is unused here, but _handle dispatches to this and _assign
    # through the same call, so the two signatures have to match.
    if target['scope'] == 'module':
        return _unassign_module(learner, target, cache)
    if not _assigned(learner, target, cache):
        return False
    saved = stored_training_plan(learner)
    existing = list(saved if saved is not None else get_training_plan(learner) or [])
    remove_ids = set(target['moduleIds'])
    remaining = [entry for entry in existing if plans._s(entry.get('moduleId')) not in remove_ids]
    # Freeze what is left as explicit, the same as an assignment does, so a later
    # plan read does not put the removed module straight back from a group/cohort
    # preset the learner still inherits from.
    remaining = [dict(entry, assignmentMode='explicit') for entry in remaining]
    field = training_plan_field(learner)
    setattr(learner, field, remaining)
    learner.save(update_fields=[field])
    profile = module_plan_rows.profile_for(learner)
    if module_plan_rows.has_plan_rows(profile):
        # Remove only the cohort's modules; other saved rows stay.
        module_plan_rows.refresh_title_columns(learner)
        for module_id in remove_ids:
            module_plan_rows.remove_module_rows(profile, module_id)
    else:
        # No plan rows: the modules were held through placement. Writing the
        # remaining JSON plan out as rows makes the selection explicit without
        # them; with nothing left there is no row to record it, so say so.
        plans.sync_learning_plan_mirror(learner, strict=True)
        if not module_plan_rows.has_plan_rows(module_plan_rows.profile_for(learner)):
            raise ValueError('This learner has no other modules, so the removal cannot be recorded.')
    return True


def _handle(request, scope, identifier):
    if request.method not in ('GET', 'POST', 'DELETE'):
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    try:
        target = _target(scope, identifier)
        if target is None:
            return JsonResponse({'error': f'Active {scope} not found.'}, status=404)
        if request.method == 'GET':
            learners = with_placements(EnrolmentUser.all_learners.only(
                'id', 'username', 'email', 'programme_id', 'cohort_id', 'group_id',
                'employer', 'organization', 'programme_status', 'learner_type',
            ).order_by('username', 'id'))
            return JsonResponse(_payload(target, learners))
        try:
            body = json.loads(request.body)
        except (ValueError, UnicodeDecodeError):
            return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
        values = body.get('learnerIds') if isinstance(body, dict) else None
        if (not isinstance(values, list) or not values or len(values) > 5000
                or any(isinstance(value, bool) or not isinstance(value, (str, int))
                       or not str(value).isascii() or not str(value).isdecimal()
                       or len(str(value)) > 10 or not 0 < int(value) <= 2147483647 for value in values)):
            return JsonResponse({'error': 'Select between 1 and 5000 valid learners.'}, status=400)
        ids = sorted({int(value) for value in values})
        catalogue = {module['moduleId']: module for module in plans._all_modules()}
        if set(target['moduleIds']) - catalogue.keys():
            return JsonResponse({'error': 'The module list changed. Reload and try again.'}, status=409)
        alias = EnrolmentUser.all_learners.db
        if EnrolmentUser.all_learners.filter(pk__in=ids).count() != len(ids):
            return JsonResponse({'error': 'One or more selected learners no longer exist.'}, status=400)
        changed = 0
        failed = []
        failure_message = ''
        cache = {}
        # One committed transaction per learner. Holding every learner's plan
        # write open in a single transaction is what made a fifteen-learner save
        # run past the gateway timeout and come back as a 500/503 with nothing
        # saved; per learner, the ones that succeed stay saved and the caller is
        # told exactly which ones to retry.
        for learner_id in ids:
            try:
                with transaction.atomic(using=alias):
                    learner = (EnrolmentUser.all_learners.select_for_update()
                               .filter(pk=learner_id).first())
                    if learner is None:
                        failed.append(str(learner_id))
                        failure_message = failure_message or 'One or more selected learners no longer exist.'
                        continue
                    if request.method == 'DELETE':
                        # Four arguments, matching _assign: passing three put
                        # `cache` in the catalogue slot and left `cache`
                        # unfilled, so every removal raised TypeError and the
                        # drawer showed a bare 500.
                        changed += int(_unassign(learner, target, catalogue, cache))
                    else:
                        changed += int(_assign(learner, target, catalogue, cache))
            except Exception:  # noqa: BLE001 - one learner must not sink the batch
                logger.exception('Curriculum learner assignment failed for learner %s', learner_id)
                failed.append(str(learner_id))
                failure_message = failure_message or 'Unable to save learner assignments. Please try again.'
        if changed:
            from .views import invalidate_curriculum_cache
            invalidate_curriculum_cache()
        if len(failed) == len(ids):
            return JsonResponse({'error': failure_message or 'Unable to save learner assignments. Please try again.'}, status=503)
        return JsonResponse({
            'assignedCount': len(ids) - len(failed), 'changedCount': changed,
            'moduleCount': len(target['moduleIds']),
            'failedIds': failed, 'failureMessage': failure_message,
        })
    except DatabaseError:
        logger.exception('Curriculum learner assignment failed')
        return JsonResponse({'error': 'Unable to save learner assignments. Please try again.'}, status=503)
    except Exception:  # noqa: BLE001 - a bare 500 gives the drawer nothing to show
        logger.exception('Curriculum learner assignment failed')
        return JsonResponse({'error': 'Unable to save learner assignments. Please try again.'}, status=500)


@csrf_exempt
@staff_only()
def cohort_learner_assignments(request, identifier):
    return _handle(request, 'cohort', identifier)


@csrf_exempt
@staff_only()
def module_learner_assignments(request, identifier):
    return _handle(request, 'module', identifier)


def module_assignment_roster(module_id, placement_learners, lifecycle_status=''):
    """Include direct module membership without broadening programme/cohort rosters."""
    placed = {str(row['id']): row for row in placement_learners}
    profiles = LearnerProfile.objects.select_related(*RELATIONS).filter(
        Q(pk__in=list(placed)) | Q(plan_modules__curriculum_module_id=module_id)
    ).prefetch_related('plan_modules').distinct()
    if lifecycle_status:
        profiles = profiles.filter(lifecycle_status__iexact=lifecycle_status)
    result = dict(placed)
    for profile in profiles:
        module_refs = {
            str(module.module_ref) for module in profile.plan_modules.all()
            if module.module_ref
        }
        explicit = bool(module_refs)
        assigned = module_id in module_refs
        key = str(profile.pk)
        if explicit and not assigned:
            result.pop(key, None)
            continue
        if key in result or not assigned:
            continue
        result[key] = {
            'id': profile.pk, 'sourceId': profile.pk, 'sourceKind': 'learner',
            'enrolmentId': profile.enrolment_id,
            'assignmentBasis': 'module',
            'name': profile.full_name or '', 'email': profile.email or '',
            'programme': profile.programme or '', 'programmeStatus': profile.programme_status or '',
            'cohort': profile.cohort or '', 'cohortId': profile.cohort_id or '',
            'group': profile.group_name or '', 'groupId': profile.group_id or '',
            'lifecycleStatus': profile.lifecycle_status or '',
            'coachName': profile.coach_name or '', 'coachEmail': profile.coach_email or '',
            **{out: float(getattr(profile, field, 0) or 0) for out, field in (
                ('completedHours', 'completed_hours'), ('plannedHours', 'planned_hours'),
                ('targetHours', 'target_hours'), ('progressHours', 'progress_hours'),
            )},
            'progressVariance': profile.progress_variance, 'otjhStatus': profile.otjh_status or '',
        }
    return sorted(result.values(), key=lambda row: (row.get('name', '').casefold(), str(row['id'])))


def bulk_assigned_learner_counts(module_ids):
    """Assigned-learner counts for many modules in one pass over all learners.

    The module list shows a "Learners (N)" figure on every card, and computing
    it the way `_assigned()` does -- one query and one effective-plan
    computation per module -- would mean one query per card. This runs that
    same computation (saved plan, or the learner's group preset when nothing is
    saved) once per learner instead, with the group-preset lookup cached and
    shared across learners exactly as `_payload` already shares it across a
    single module's request.
    """
    wanted = {plans._s(module_id) for module_id in module_ids if plans._s(module_id)}
    if not wanted:
        return {}
    counts = {module_id: 0 for module_id in wanted}
    cache = {}
    learners = with_placements(EnrolmentUser.all_learners.only('id', 'learning_plan', 'training_plan'))
    for learner in learners:
        for module_id in set(plans._effective_plan_ids(learner, cache)):
            if module_id in wanted:
                counts[module_id] += 1
    return counts
