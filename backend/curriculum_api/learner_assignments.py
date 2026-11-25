"""Cohort and module learner assignment using the existing learner plan."""
import json
import logging

from django.db import DatabaseError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from login.permissions import staff_only
from learner_api.learning_plans import public as learner_plans

from learner_api.identity_placement.public import (
    CACHE,
    RELATIONS,
    placement_ids,
    placement_profile,
    with_placements,
)
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
    from curriculum_api.directory.infrastructure.assignment_reads import _plan_row_counts as implementation
    from . import views
    return implementation(connection=views.connection)


def _payload(target, learners):
    from curriculum_api.directory.application.assignment_queries import _payload as implementation
    return implementation(target, learners, _module_payload=_module_payload, _plan_row_counts=_plan_row_counts, _row=_row, _assigned=_assigned)


def _row(learner, assigned, module_count):
    from curriculum_api.directory.infrastructure.registration_reads import _row as implementation
    return implementation(
        learner,
        assigned,
        module_count,
        placement_profile=placement_profile,
        clean_str=learner_plans.clean_text,
    )


def _module_payload(target, learners):
    from curriculum_api.directory.application.assignment_queries import _module_payload as implementation
    from .learner_status_counts import module_member_enrolment_ids
    return implementation(target, learners, module_member_enrolment_ids=module_member_enrolment_ids, _plan_row_counts=_plan_row_counts, _row=_row)


def _module_assigned_payload(target):
    from curriculum_api.directory.application.assignment_queries import _module_assigned_payload as implementation
    from .learner_status_counts import module_member_enrolment_ids
    from .directory.infrastructure.registration_reads import assigned_sources
    def read(members):
        return assigned_sources(members, EnrolmentUser=EnrolmentUser, with_placements=with_placements)
    return implementation(target, module_member_enrolment_ids=module_member_enrolment_ids, read_sources=read, _row=_row)


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


def _assignment_catalogue():
    """Curriculum-owned catalogue projection used by assignment writes."""
    from .catalogue.infrastructure.catalogue_resolution import (
        authoring_catalogue_summaries,
    )

    summaries = authoring_catalogue_summaries(list_only=True)
    return {
        module_id: {
            'moduleId': module_id,
            'moduleTitle': learner_plans.clean_text(summary.get('title')) or module_id,
            'groupName': learner_plans.clean_text(summary.get('group')),
            'programmeId': learner_plans.clean_text(summary.get('programmeId')),
            'programmeName': learner_plans.clean_text(summary.get('programmeName')),
            'hours': float(summary.get('totalOtjh') or 0),
            'startDate': learner_plans.clean_text(summary.get('startDate'))[:10],
            'endDate': learner_plans.clean_text(summary.get('endDate'))[:10],
            'learnerRosterMode': (
                learner_plans.clean_text(summary.get('learnerRosterMode')) or 'inherited'
            ),
            'isFreeCourse': bool(summary.get('isFreeCourse')),
        }
        for module_id, summary in summaries.items()
        if module_id
    }


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
    legacy_has = module_id in set(learner_plans.effective_module_ids(learner, cache))
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
        existing_ids = {learner_plans.clean_text(entry.get('moduleId')) for entry in existing}
        for mid in [*learner_plans.effective_module_ids(learner, cache), module_id]:
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
        learner_plans.synchronize_compatibility_plan(learner, strict=True)
    return True


def _unassign_module(learner, target, cache):
    """Remove one module from both plan stores without wiping rows the JSON lacks."""
    module_id = target['moduleIds'][0]
    if str(learner.pk) not in _module_members(target, cache):
        return False
    profile = module_plan_rows.profile_for(learner)
    targeted = module_plan_rows.has_plan_rows(profile)
    legacy_has = module_id in set(learner_plans.effective_module_ids(learner, cache))
    if legacy_has:
        saved = stored_training_plan(learner)
        existing = list(saved if saved is not None else get_training_plan(learner) or [])
        # Frozen as explicit, so a group preset does not put the module straight back.
        _save_legacy_plan(learner, [dict(entry, assignmentMode='explicit') for entry in existing
                                    if learner_plans.clean_text(entry.get('moduleId')) != module_id])
    if targeted:
        if legacy_has:
            module_plan_rows.refresh_title_columns(learner)
        module_plan_rows.remove_module_rows(profile, module_id)
    else:
        # No plan rows: the learner held the module through placement. Writing the
        # remaining JSON plan out as rows makes their selection explicit, without
        # the module. A learner whose plan would be empty has no row to carry
        # that, so the removal is reported as failed rather than claimed.
        learner_plans.synchronize_compatibility_plan(learner, strict=True)
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
    existing_ids = {learner_plans.clean_text(entry.get('moduleId')) for entry in existing}
    for module_id in [*learner_plans.effective_module_ids(learner, cache), *target['moduleIds']]:
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
        learner_plans.synchronize_compatibility_plan(learner, strict=True)
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
    remaining = [
        entry for entry in existing
        if learner_plans.clean_text(entry.get('moduleId')) not in remove_ids
    ]
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
        learner_plans.synchronize_compatibility_plan(learner, strict=True)
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
            if scope == 'module' and request.GET.get('assignedOnly') == '1':
                return JsonResponse(_module_assigned_payload(target))
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
        catalogue = _assignment_catalogue()
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
    from curriculum_api.directory.application.assignment_queries import module_assignment_roster as implementation
    from .directory.infrastructure.assignment_reads import module_roster_facts
    def read(module_id, placed_ids, lifecycle_status):
        return module_roster_facts(
            module_id, placed_ids, lifecycle_status, LearnerProfile=LearnerProfile, RELATIONS=RELATIONS, Q=Q,
        )
    return implementation(module_id, placement_learners, lifecycle_status, read_facts=read)


from .learner_assignment_counts_sql import bulk_assigned_learner_counts
