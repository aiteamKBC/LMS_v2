"""Existing legacy course/module lookups without HTTP or views dependencies."""
from . import free_course_rows as free_course_catalogue
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted


def _course(course_id):
    rows = free_course_catalogue.courses(course_ids=[course_id], columns=['id'])
    return rows[0] if rows else None


def _active_module(course):
    row = authoring_module_exists(course.get('module_catalogue_id'))
    return bool(row and row.get('source_type') == 'free_course'
                and not curriculum_row_effectively_deleted(row))
