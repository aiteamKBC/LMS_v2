"""Compatibility entry point for catalogue database-verified row reuse.

Process-local snapshots are owned by catalogue.infrastructure.authoring_row_snapshots.
"""


def _fingerprint_sql(columns):
    from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
    from .catalogue.infrastructure.authoring_transport import _fingerprint_sql as fingerprint
    return fingerprint(columns, quote_ident=quote_ident)


def read_verified_rows(table, where, params, order, columns):
    from curriculum_api.catalogue.infrastructure.authoring_columns import REFLECTION_QUESTION_COLUMN
    from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
    from django.db import connection
    from curriculum_api.catalogue.infrastructure.database_reads import quote_ident, rows_as_dicts
    from .authoring_read_transport import _read_source
    from .catalogue.infrastructure.authoring_transport import read_verified_rows as read

    return read(
        table, where, params, order, columns,
        connection=connection, authoring_fetch_all=authoring_fetch_all,
        read_source=_read_source, quote_ident=quote_ident, rows_as_dicts=rows_as_dicts,
        reflection_question_column=REFLECTION_QUESTION_COLUMN,
    )
