"""Place an existing course while preserving content, identities and transaction order."""
from ..domain.free_course_placement import destination_identifiers, placement_from_rows
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.attachment_content import module_cohort_date_error
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key
from curriculum_api.catalogue.domain.staff_identity import staff_profile_email
from curriculum_api.catalogue.domain.staff_identity import staff_profile_is_archived
from curriculum_api.catalogue.domain.staff_identity import staff_profile_name
from curriculum_api.catalogue.domain.tutor_conflicts import tutor_conflict_override_requested
from curriculum_api.catalogue.domain.values import unique


def destination(payload, *, storage):
    identifiers = destination_identifiers(payload)
    programme = next((row for row in storage.get_program_config_rows()
                      if programme_config_identity(row) == identifiers['programmeId']), None)
    cohort = storage.resolve_cohort_row(identifiers['cohortId'])
    group = storage.resolve_group_row(identifiers['groupId'])
    return placement_from_rows(identifiers, programme, cohort, group,
                               curriculum_row_effectively_deleted=storage.curriculum_row_effectively_deleted)


def convert_free_course(module_catalogue_id, payload, tutor_identifier, *, get_authoring_structure_payload, module_schedule_view, tutor_assignment_delivery_day_error, tutor_schedule_conflicts_created, tutor_conflict_error, check_structure_save, announce_saved, invalidate_curriculum_cache, clock, reply, reject, storage):
    with storage.atomic(), storage.version_source('module-builder'):
        storage.lock_module_structure_row(module_catalogue_id)
        stored = storage.authoring_module_exists(module_catalogue_id)
        if not stored or storage.curriculum_row_effectively_deleted(stored):
            return reject('Free course not found.', status=404)
        placement, group = destination(payload, storage=storage)
        # Serialize additions to this group's denormalized lists. Content
        # saves use the same module -> group lock order.
        if storage.lock_group(placement['group_id']):
            placement, group = destination(payload, storage=storage)
        tutor = storage.find_staff_profile_row('tutor', tutor_identifier, include_archived=False)
        if not tutor or staff_profile_is_archived(tutor) or not staff_profile_name(tutor):
            return reject('Choose an active Tutor from the staff directory.', fields=['tutor'], status=400)
        tutor_name, tutor_email = staff_profile_name(tutor), staff_profile_email(tutor)
        result = {'moduleCatalogueId': module_catalogue_id, 'tutor': tutor_name,
                  **{key: placement[column] for key, column in (
                      ('programmeId', 'programme_id'), ('programmeName', 'programme_name'),
                      ('cohortId', 'cohort_id'), ('cohortName', 'cohort_name'),
                      ('groupId', 'group_id'), ('groupName', 'group_name'))}}
        if stored.get('source_type') != 'free_course':
            # A lost HTTP response can be retried without moving the module
            # again or creating another delivery, assignment or meeting.
            if (stored.get('source_type') == 'module_authoring'
                    and all(clean_str(stored.get(key)) == placement[key]
                            for key in ('programme_id', 'cohort_id', 'group_id'))
                    and staff_assignment_key(stored.get('tutor_name')) == staff_assignment_key(tutor_name)):
                return reply({**result, 'converted': False})
            return reject('This course has already been converted. Refresh the catalogue.', status=409)
        current = get_authoring_structure_payload(module_catalogue_id)
        candidate = {**current, **result, 'isFreeCourse': False,
                     'sourceType': 'module_authoring', 'learnerRosterMode': 'inherited'}
        refused = check_structure_save(module_catalogue_id, current, candidate, payload)
        if refused is not None:
            return refused
        date_error = module_cohort_date_error(
            stored.get('title'), stored.get('start_date'), stored.get('end_date'),
            storage.resolve_cohort_row(placement['cohort_id']),
        )
        if date_error:
            return reject(date_error[0], fields=[date_error[1]], status=400)
        before = module_schedule_view(stored)
        schedule = module_schedule_view({**stored, **placement, 'tutor_name': tutor_name})
        day_error = tutor_assignment_delivery_day_error(schedule, before=before)
        if day_error is not None:
            return day_error
        conflicts = tutor_schedule_conflicts_created(before, schedule)
        if conflicts and not tutor_conflict_override_requested(payload):
            return tutor_conflict_error(schedule, conflicts)
        # Only lineage, course kind and selected tutor change. Keep source_id for legacy
        # adoption provenance. Never re-save weeks, hours, progress, plans,
        # submissions, KSBs or Teams settings as a side effect of placement.
        fields = {**placement, 'tutor_name': tutor_name, 'tutor_email': tutor_email,
                  'source_type': 'module_authoring', 'learner_roster_mode': 'inherited',
                  'updated_at': clock()}
        if not storage.convert_to_module(module_catalogue_id, fields):
            storage.update_authoring_rows(storage.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                    [module_catalogue_id], fields)
        storage.update_group_fields(placement['group_id'], {
            'module_ids': storage.json_db_value(unique([
                *parse_json_value(group.get('module_ids'), []), module_catalogue_id])),
            'module_names': storage.json_db_value(unique([
                *parse_json_value(group.get('module_names'), []), stored.get('title')])),
        })
        storage.log_curriculum_decision('module.free_course_convert', outcome='converted',
                                  entity_id=module_catalogue_id, parent_id=placement['group_id'])
        storage.on_commit(invalidate_curriculum_cache, robust=True)
        announce_saved(module_catalogue_id)
    return reply({**result, 'converted': True})
