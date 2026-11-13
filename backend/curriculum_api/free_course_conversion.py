"""Place an existing standalone course without replacing content or learner history."""
import logging

from django.db import connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from login.permissions import require_role
from . import views as v, versioning
from .module_collaboration import announce_saved, check_structure_save

logger = logging.getLogger(__name__)


def destination(payload):
    identifiers = {key: v.clean_str(payload.get(key)) for key in ('programmeId', 'cohortId', 'groupId')}
    if not all(identifiers.values()):
        raise ValueError('Choose a Programme, Cohort and Group.')
    programme = next((row for row in v.get_program_config_rows()
                      if v.programme_config_identity(row) == identifiers['programmeId']), None)
    cohort = v.resolve_cohort_row(identifiers['cohortId'])
    group = v.resolve_group_row(identifiers['groupId'])
    if not programme or not cohort or not group:
        raise ValueError('The destination Programme, Cohort or Group no longer exists.')
    if (v.is_archived_program_config(programme)
            or v.curriculum_row_effectively_deleted(cohort)
            or v.curriculum_row_effectively_deleted(group)
            or v.programme_status_is_archived(cohort.get('status'))
            or v.programme_status_is_archived(group.get('status'))):
        raise ValueError('Choose an active Programme, Cohort and Group.')
    if (v.clean_str(cohort.get('programme_id')) != identifiers['programmeId']
            or v.clean_str(group.get('programme_id')) != identifiers['programmeId']
            or v.clean_str(group.get('cohort_id')) != v.clean_str(cohort.get('cohort_id'))):
        raise ValueError('The selected Group must belong to the selected Cohort and Programme.')
    return {
        'programme_id': identifiers['programmeId'], 'programme_name': v.clean_str(programme.get('name')),
        'cohort_id': v.clean_str(cohort.get('cohort_id')), 'cohort_name': v.clean_str(cohort.get('cohort_name')),
        'group_id': v.clean_str(group.get('group_id')), 'group_name': v.clean_str(group.get('group_name')),
    }, group


@require_role('admin', 'staff')
@require_POST
def convert_free_course(request, module_catalogue_id):
    payload = v.json_body(request)
    if not isinstance(payload, dict):
        return v.json_error('Invalid JSON body.', status=400)
    tutor_identifier = payload.get('tutor')
    if not isinstance(tutor_identifier, str) or v.is_blank_staff_assignment(tutor_identifier):
        return v.json_error('Choose a Tutor before moving this course.', fields=['tutor'], status=400)
    try:
        with transaction.atomic(), versioning.source('module-builder'):
            v.lock_module_structure_row(module_catalogue_id)
            stored = v.authoring_module_exists(module_catalogue_id)
            if not stored or v.curriculum_row_effectively_deleted(stored):
                return v.json_error('Free course not found.', status=404)
            placement, group = destination(payload)
            # Serialize additions to this group's denormalized lists. Content
            # saves use the same module -> group lock order.
            if connection.vendor == 'postgresql':
                with connection.cursor() as cursor:
                    cursor.execute(f'SELECT group_id FROM {v.authoring_table_name(v.GROUPS_TABLE)} '
                                   'WHERE group_id = %s FOR UPDATE', [placement['group_id']])
                    cursor.fetchall()
                placement, group = destination(payload)
            tutor = v.find_staff_profile_row('tutor', tutor_identifier, include_archived=False)
            if not tutor or v.staff_profile_is_archived(tutor) or not v.staff_profile_name(tutor):
                return v.json_error('Choose an active Tutor from the staff directory.', fields=['tutor'], status=400)
            tutor_name, tutor_email = v.staff_profile_name(tutor), v.staff_profile_email(tutor)
            result = {'moduleCatalogueId': module_catalogue_id, 'tutor': tutor_name,
                      **{key: placement[column] for key, column in (
                          ('programmeId', 'programme_id'), ('programmeName', 'programme_name'),
                          ('cohortId', 'cohort_id'), ('cohortName', 'cohort_name'),
                          ('groupId', 'group_id'), ('groupName', 'group_name'))}}
            if stored.get('source_type') != 'free_course':
                # A lost HTTP response can be retried without moving the module
                # again or creating another delivery, assignment or meeting.
                if (stored.get('source_type') == 'module_authoring'
                        and all(v.clean_str(stored.get(key)) == placement[key]
                                for key in ('programme_id', 'cohort_id', 'group_id'))
                        and v.staff_assignment_key(stored.get('tutor_name')) == v.staff_assignment_key(tutor_name)):
                    return JsonResponse({**result, 'converted': False})
                return v.json_error('This course has already been converted. Refresh the catalogue.', status=409)
            current = v.get_authoring_structure_payload(module_catalogue_id)
            candidate = {**current, **result, 'isFreeCourse': False,
                         'sourceType': 'module_authoring', 'learnerRosterMode': 'inherited'}
            refused = check_structure_save(request, module_catalogue_id, current, candidate, payload)
            if refused is not None:
                return refused
            date_error = v.module_cohort_date_error(
                stored.get('title'), stored.get('start_date'), stored.get('end_date'),
                v.resolve_cohort_row(placement['cohort_id']),
            )
            if date_error:
                return v.json_error(date_error[0], fields=[date_error[1]], status=400)
            before = v.module_schedule_view(stored)
            schedule = v.module_schedule_view({**stored, **placement, 'tutor_name': tutor_name})
            day_error = v.tutor_assignment_delivery_day_error(schedule, before=before)
            if day_error is not None:
                return day_error
            conflicts = v.tutor_schedule_conflicts_created(before, schedule)
            if conflicts and not v.tutor_conflict_override_requested(payload):
                return v.tutor_conflict_error(schedule, conflicts)
            # Only lineage, course kind and selected tutor change. Keep source_id for legacy
            # adoption provenance. Never re-save weeks, hours, progress, plans,
            # submissions, KSBs or Teams settings as a side effect of placement.
            fields = {**placement, 'tutor_name': tutor_name, 'tutor_email': tutor_email,
                      'source_type': 'module_authoring', 'learner_roster_mode': 'inherited',
                      'updated_at': timezone.now()}
            from .learning_storage import convert_to_module
            if not convert_to_module(module_catalogue_id, fields):
                v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                        [module_catalogue_id], fields)
            v.update_group_fields(placement['group_id'], {
                'module_ids': v.json_db_value(v.unique([
                    *v.parse_json_value(group.get('module_ids'), []), module_catalogue_id])),
                'module_names': v.json_db_value(v.unique([
                    *v.parse_json_value(group.get('module_names'), []), stored.get('title')])),
            })
            v.log_curriculum_decision('module.free_course_convert', outcome='converted',
                                      entity_id=module_catalogue_id, parent_id=placement['group_id'])
            transaction.on_commit(v.invalidate_curriculum_cache, robust=True)
            announce_saved(module_catalogue_id)
        return JsonResponse({**result, 'converted': True})
    except ValueError as exc:
        return v.json_error(str(exc), status=400)
    except Exception:
        logger.exception('Unable to convert standalone course %s.', module_catalogue_id)
        return v.json_error('The course could not be moved. No changes were applied; please try again.', status=500)
