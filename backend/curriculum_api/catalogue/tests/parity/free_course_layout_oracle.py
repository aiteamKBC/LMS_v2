"""Reverse reviewed import moves for historical hashes, never for runtime tests."""
import ast


def restore_tree(tree, relative):
    relative = relative.removeprefix('curriculum_api/')
    if getattr(tree, '_free_course_imports_restored', False):
        return tree
    changes = []
    if relative == 'views.py':
        changes = [
            ('from curriculum_api import calendar_holidays\n'
             'from curriculum_api.catalogue.infrastructure import free_course_rows as free_course_catalogue\n'
             'from curriculum_api import ksb_mapping_placement\n'
             'from curriculum_api import schema_compat\nfrom curriculum_api import write_shape',
             'from . import calendar_holidays, free_course_catalogue, ksb_mapping_placement, schema_compat, write_shape'),
            ('from curriculum_api.catalogue.infrastructure.free_course_catalogue_store import FreeCourseInUse',
             'from .free_course_catalogue_store import FreeCourseInUse'),
            ('from curriculum_api.catalogue.infrastructure import free_course_pricing as free_course_pricing',
             'from . import free_course_pricing'),
            ('from curriculum_api.catalogue.infrastructure.free_course_writer_mode import LEGACY\n'
             'from curriculum_api.catalogue.infrastructure.free_course_writer_mode import current_mode\n'
             'from curriculum_api.catalogue.infrastructure.free_course_writer_mode import require_mode',
             'from .free_course_writer_mode import LEGACY, current_mode, require_mode'),
        ]
    elif relative == 'learning_storage.py':
        changes = [('from curriculum_api.catalogue.infrastructure.free_course_contract import NATIVE_VIEWS',
                    'from .free_course_contract import NATIVE_VIEWS')]
    elif relative in {'free_course_pricing.py', 'catalogue/infrastructure/free_course_pricing.py'}:
        changes = [
            ('from curriculum_api.course_pricing import pricing_payload', 'from .course_pricing import pricing_payload'),
            ('from curriculum_api.catalogue.domain.values import clean_str', 'from .catalogue.domain.values import clean_str'),
            ('from curriculum_api.catalogue.infrastructure.database_reads import column_names\n'
             'from curriculum_api.catalogue.infrastructure.database_reads import fetch_all\n'
             'from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name',
             'from .catalogue.infrastructure.database_reads import column_names, fetch_all, authoring_table_name'),
            ('from curriculum_api.catalogue.infrastructure.course_schema_runtime import FREE_COURSES_TABLE',
             'from .catalogue.infrastructure.course_schema_runtime import FREE_COURSES_TABLE'),
        ]
    for current, previous in changes:
        expected = ast.parse(current).body
        for index in range(len(tree.body) - len(expected) + 1):
            if [ast.dump(n) for n in tree.body[index:index+len(expected)]] == [ast.dump(n) for n in expected]:
                tree.body[index:index+len(expected)] = ast.parse(previous).body
                break
    tree._free_course_imports_restored = True
    return tree
