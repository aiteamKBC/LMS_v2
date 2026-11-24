"""Concrete catalogue / api / authoring errors capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import tutor_conflict_error
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.responses import record_conflict_response
from curriculum_api.catalogue.application.tutor_availability import tutor_conflict_message


class TutorAssignmentDeliveryDayError(ValueError):
    """The refusal above, raised so a multi-module save rolls back first.

    Same reasoning as ``TutorScheduleConflictError``: a tree or group save writes
    several modules in a loop, and returning a response from inside
    ``transaction.atomic()`` would commit the ones already written.
    """

    def __init__(self, response):
        super().__init__('Set the group delivery day before assigning a tutor.')
        self.response = response

    def as_response(self):
        return self.response


class TutorScheduleConflictError(ValueError):
    """Raised inside a save so the transaction rolls back before the 409.

    A group or tree save writes several modules in a loop. Returning a response
    from inside ``transaction.atomic()`` would commit whatever the earlier
    iterations had already written, leaving half the save applied and the
    schedule in exactly the inconsistent state this check exists to prevent.
    """

    def __init__(self, candidate, conflicts):
        super().__init__(tutor_conflict_message(candidate, conflicts))
        self.candidate = candidate
        self.conflicts = conflicts

    def as_response(self):
        return tutor_conflict_error(self.candidate, self.conflicts)


class StaleModuleStructureWrite(Exception):
    """An attachment tried to replace an existing module's weeks from an old copy."""

    def __init__(self, module_catalogue_id, expected_revision, current_revision):
        super().__init__(module_catalogue_id)
        self.module_catalogue_id = module_catalogue_id
        self.expected_revision = expected_revision
        self.current_revision = current_revision

    def as_response(self):
        if not self.expected_revision:
            return json_error(
                'This save would replace the weeks of a module that already exists, but it does not say '
                'which saved version of that module it was made from, so nothing was saved. Edit the '
                "module's weeks in the Module Builder.",
                status=428,
                conflict=True,
                moduleCatalogueId=self.module_catalogue_id,
            )
        return record_conflict_response(
            self.expected_revision, self.current_revision, moduleCatalogueId=self.module_catalogue_id,
        )
