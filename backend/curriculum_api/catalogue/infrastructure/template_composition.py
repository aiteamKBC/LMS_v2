"""Concrete catalogue / infrastructure / template composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.read_contracts import STRUCTURE_REVISION_UNAVAILABLE
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATES_TABLE
from curriculum_api.catalogue.infrastructure.course_schema_runtime import WEEK_TEMPLATE_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.course_schema_runtime import ensure_week_template_tables
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.record_identity import record_revision


def week_template_revision(template_id):
    from curriculum_api.catalogue.application.record_revisions import week_template_revision as query
    return query(
        template_id,
        ensure_week_template_tables=ensure_week_template_tables,
        record_revision=record_revision,
        WEEK_TEMPLATES_TABLE=WEEK_TEMPLATES_TABLE,
        WEEK_TEMPLATE_COMPONENTS_TABLE=WEEK_TEMPLATE_COMPONENTS_TABLE,
    )


def get_week_template_rows(where_sql='', params=None, *, include_deleted=False):
    from curriculum_api.catalogue.infrastructure.week_templates import get_week_template_rows as query
    return query(
        where_sql, params,
        include_deleted=include_deleted, ensure_week_template_tables=ensure_week_template_tables,
        table_name=table_name, WEEK_TEMPLATES_TABLE=WEEK_TEMPLATES_TABLE, fetch_all=fetch_all,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
    )


def get_week_template_row(template_id, *, include_deleted=False):
    from curriculum_api.catalogue.infrastructure.week_templates import get_week_template_row as query
    return query(
        template_id,
        include_deleted=include_deleted, get_week_template_rows=get_week_template_rows,
    )


def get_week_template_component_rows(template_id):
    from curriculum_api.catalogue.infrastructure.week_templates import get_week_template_component_rows as query
    return query(
        template_id,
        ensure_week_template_tables=ensure_week_template_tables, fetch_all=fetch_all,
        table_name=table_name, WEEK_TEMPLATE_COMPONENTS_TABLE=WEEK_TEMPLATE_COMPONENTS_TABLE,
    )


def week_template_record(template_id, *, after_write=False):
    from curriculum_api.catalogue.application.week_templates import week_template_record as query
    return query(
        template_id,
        after_write=after_write,
        get_week_template_row=get_week_template_row,
        get_week_template_component_rows=get_week_template_component_rows,
        week_template_revision=week_template_revision,
        STRUCTURE_REVISION_UNAVAILABLE=STRUCTURE_REVISION_UNAVAILABLE,
    )

from curriculum_api.catalogue.application.week_templates import week_template_number
from curriculum_api.catalogue.domain.content_validation import payload_reflection_question
from curriculum_api.catalogue.domain.content_values import payload_coach_validation
from curriculum_api.catalogue.domain.read_contracts import LEGACY_REFLECTION_QUESTION_SETTING
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.course_schema_runtime import WEEK_TEMPLATE_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.course_schema_runtime import ensure_week_template_tables
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.write_composition import delete_rows
from datetime import datetime

def save_week_template_components(template_id, components):
    from curriculum_api.catalogue.application.week_templates import save_week_template_components as implementation
    return implementation(
        template_id, components,
        LEGACY_REFLECTION_QUESTION_SETTING=LEGACY_REFLECTION_QUESTION_SETTING,
        WEEK_TEMPLATE_COMPONENTS_TABLE=WEEK_TEMPLATE_COMPONENTS_TABLE,
        WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN=WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN,
        clean_str=clean_str,
        datetime=datetime,
        delete_rows=delete_rows,
        ensure_week_template_tables=ensure_week_template_tables,
        insert_row=insert_row,
        json_db_value=json_db_value,
        parse_int=parse_int,
        payload_coach_validation=payload_coach_validation,
        payload_reflection_question=payload_reflection_question,
        unique_prefixed_id=unique_prefixed_id,
        week_template_number=week_template_number,
    )
