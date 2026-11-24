"""Concrete catalogue / domain / authoring errors capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""



class ProgrammeContentRetained(Exception):
    """A programme that still owns weeks or components cannot be deleted permanently."""


class ModuleAuthoringValidationError(ValueError):
    def __init__(self, errors):
        super().__init__('Module authoring payload is invalid.')
        self.errors = errors


class CoverImageError(ModuleAuthoringValidationError):
    """A cover sent inline that cannot become a stored file (see stored_module_cover_image).

    A ModuleAuthoringValidationError so the module save answers 400 with the
    reason, and so a ValueError so the free-course saves do the same.
    """

    def __init__(self, message):
        ValueError.__init__(self, message)
        self.errors = [{'path': 'coverImage', 'message': message}]


class ModuleStructureDeltaConflict(ValueError):
    """A partial save names a week or component the stored module does not hold."""
