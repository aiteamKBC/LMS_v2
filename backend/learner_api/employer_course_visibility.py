"""Employer-only catalogue classification, including retained import identities."""
from curriculum_api.learning_storage import enabled


def free_course_module_sql(db):
    """Predicate for a module aliased as ``m``; converted courses stay visible."""
    reference = 'content_ref' if enabled(db) else 'module_catalogue_id'
    # The MM import retained the original module in the ordinary catalogue.
    # Its free-course ID records that origin even after native storage adoption
    # gives the free copy a different content_ref. Never match by course title.
    return f"""(m.source_type = 'free_course' OR EXISTS (
        SELECT 1 FROM curriculum.free_courses f
        WHERE f.converted_at IS NULL AND (
            f.{reference} = m.module_catalogue_id
            OR f.id = 'FREECOURSE-MM-' || m.module_catalogue_id
        )
    ))"""
