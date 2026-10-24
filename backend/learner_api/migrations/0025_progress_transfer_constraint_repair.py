"""Repair the deployed progress-transfer relationship without replaying 0021.

The original migrations were recorded before their source acquired the
composite relationship.  This forward-only migration accepts exactly the
verified legacy contract or the exact repaired contract and refuses every
partial/divergent state.
"""

from django.db import migrations


PARENT_UNIQUE = "progress_transfer_requests_id_enrolment_id_key"
COMPOSITE_FK = "progress_transfer_items_request_enrolment_fkey"
WEAK_FK = "progress_transfer_items_request_id_fkey"

ADD_PARENT_UNIQUE = f'''ALTER TABLE "Learner".progress_transfer_requests
ADD CONSTRAINT {PARENT_UNIQUE} UNIQUE (id, enrolment_id)'''
ADD_COMPOSITE_FK = f'''ALTER TABLE "Learner".progress_transfer_items
ADD CONSTRAINT {COMPOSITE_FK}
FOREIGN KEY (request_id, enrolment_id)
REFERENCES "Learner".progress_transfer_requests (id, enrolment_id)
NOT VALID'''
VALIDATE_COMPOSITE_FK = f'''ALTER TABLE "Learner".progress_transfer_items
VALIDATE CONSTRAINT {COMPOSITE_FK}'''
DROP_WEAK_FK = f'''ALTER TABLE "Learner".progress_transfer_items
DROP CONSTRAINT {WEAK_FK}'''


def _constraint_rows(cursor, table):
    cursor.execute(
        """
        SELECT c.conname,
               c.contype,
               c.convalidated,
               ARRAY(
                   SELECT a.attname
                     FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ord)
                     JOIN pg_attribute a
                       ON a.attrelid = c.conrelid AND a.attnum = key.attnum
                    ORDER BY key.ord
               ) AS local_columns,
               foreign_ns.nspname AS foreign_schema,
               foreign_table.relname AS foreign_table,
               CASE WHEN c.contype = 'f' THEN ARRAY(
                   SELECT a.attname
                     FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, ord)
                     JOIN pg_attribute a
                       ON a.attrelid = c.confrelid AND a.attnum = key.attnum
                    ORDER BY key.ord
               ) ELSE NULL END AS foreign_columns,
               CASE WHEN c.contype = 'f' THEN c.confupdtype ELSE NULL END,
               CASE WHEN c.contype = 'f' THEN c.confdeltype ELSE NULL END,
               c.condeferrable,
               c.condeferred
          FROM pg_constraint c
          JOIN pg_class own_table ON own_table.oid = c.conrelid
          JOIN pg_namespace own_ns ON own_ns.oid = own_table.relnamespace
          LEFT JOIN pg_class foreign_table ON foreign_table.oid = c.confrelid
          LEFT JOIN pg_namespace foreign_ns ON foreign_ns.oid = foreign_table.relnamespace
         WHERE own_ns.nspname = 'Learner' AND own_table.relname = %s
         ORDER BY c.conname
        """,
        [table],
    )
    result = {}
    for row in cursor.fetchall():
        result[row[0]] = {
            "type": row[1],
            "validated": bool(row[2]),
            "columns": tuple(row[3] or ()),
            "foreign_schema": row[4],
            "foreign_table": row[5],
            "foreign_columns": tuple(row[6] or ()),
            "update_action": row[7],
            "delete_action": row[8],
            "deferrable": bool(row[9]),
            "deferred": bool(row[10]),
        }
    return result


def _read_contract(cursor):
    cursor.execute(
        """
        SELECT to_regclass('"Learner".progress_transfer_requests') IS NOT NULL,
               to_regclass('"Learner".progress_transfer_items') IS NOT NULL
        """
    )
    if tuple(cursor.fetchone() or ()) != (True, True):
        raise RuntimeError("Progress-transfer source tables are missing; repair refused.")
    return {
        "requests": _constraint_rows(cursor, "progress_transfer_requests"),
        "items": _constraint_rows(cursor, "progress_transfer_items"),
    }


def _base_expected():
    return {
        "request_pk": {
            "type": "p", "validated": True, "columns": ("id",),
            "foreign_schema": None, "foreign_table": None, "foreign_columns": (),
            "update_action": None, "delete_action": None,
            "deferrable": False, "deferred": False,
        },
        "item_pk": {
            "type": "p", "validated": True,
            "columns": ("enrolment_id", "course_ref"),
            "foreign_schema": None, "foreign_table": None, "foreign_columns": (),
            "update_action": None, "delete_action": None,
            "deferrable": False, "deferred": False,
        },
        "item_unique": {
            "type": "u", "validated": True,
            "columns": ("enrolment_id", "module_id"),
            "foreign_schema": None, "foreign_table": None, "foreign_columns": (),
            "update_action": None, "delete_action": None,
            "deferrable": False, "deferred": False,
        },
        "parent_unique": {
            "type": "u", "validated": True,
            "columns": ("id", "enrolment_id"),
            "foreign_schema": None, "foreign_table": None, "foreign_columns": (),
            "update_action": None, "delete_action": None,
            "deferrable": False, "deferred": False,
        },
        "weak_fk": {
            "type": "f", "validated": True, "columns": ("request_id",),
            "foreign_schema": "Learner", "foreign_table": "progress_transfer_requests",
            "foreign_columns": ("id",), "update_action": "a", "delete_action": "a",
            "deferrable": False, "deferred": False,
        },
        "composite_fk": {
            "type": "f", "validated": True,
            "columns": ("request_id", "enrolment_id"),
            "foreign_schema": "Learner", "foreign_table": "progress_transfer_requests",
            "foreign_columns": ("id", "enrolment_id"),
            "update_action": "a", "delete_action": "a",
            "deferrable": False, "deferred": False,
        },
    }


def _require_exact(actual, name, expected, label):
    if actual.get(name) != expected:
        raise RuntimeError(f"Unexpected {label} constraint contract; repair refused.")


def _classify_contract(contract):
    expected = _base_expected()
    requests = contract["requests"]
    items = contract["items"]
    _require_exact(
        requests, "progress_transfer_requests_pkey", expected["request_pk"], "request primary-key"
    )
    _require_exact(
        items, "progress_transfer_items_pkey", expected["item_pk"], "item primary-key"
    )
    _require_exact(
        items, "progress_transfer_items_enrolment_id_module_id_key",
        expected["item_unique"], "item uniqueness"
    )

    parent = requests.get(PARENT_UNIQUE)
    composite = items.get(COMPOSITE_FK)
    weak = items.get(WEAK_FK)

    for name, value in requests.items():
        if value == expected["parent_unique"] and name != PARENT_UNIQUE:
            raise RuntimeError("Equivalent parent uniqueness has an unexpected name; repair refused.")
    for name, value in items.items():
        if value == expected["composite_fk"] and name != COMPOSITE_FK:
            raise RuntimeError("Equivalent composite foreign key has an unexpected name; repair refused.")

    if parent == expected["parent_unique"] and composite == expected["composite_fk"] and weak is None:
        return "repaired"
    if parent is None and composite is None and weak == expected["weak_fk"]:
        return "legacy"
    raise RuntimeError("Progress-transfer constraints are partial or divergent; repair refused.")


def _integrity_counts(cursor):
    cursor.execute(
        """
        SELECT
          (SELECT count(*) FROM (
             SELECT id, enrolment_id
               FROM "Learner".progress_transfer_requests
              GROUP BY id, enrolment_id HAVING count(*) > 1
          ) duplicates),
          (SELECT count(*)
             FROM "Learner".progress_transfer_items i
             JOIN "Learner".progress_transfer_requests r ON r.id = i.request_id
            WHERE r.enrolment_id IS DISTINCT FROM i.enrolment_id),
          (SELECT count(*)
             FROM "Learner".progress_transfer_items i
             LEFT JOIN "Learner".progress_transfer_requests r ON r.id = i.request_id
            WHERE r.id IS NULL)
        """
    )
    row = tuple(cursor.fetchone() or ())
    if len(row) != 3 or any(int(value) != 0 for value in row):
        raise RuntimeError(
            "Progress-transfer duplicate, enrolment-mismatch, or orphan rows exist; repair refused."
        )


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor == "sqlite":
        return
    if connection.vendor != "postgresql" or connection.alias != "default":
        raise RuntimeError("Run progress-transfer repair only on the canonical PostgreSQL default alias.")

    with connection.cursor() as cursor:
        state = _classify_contract(_read_contract(cursor))
        if state == "repaired":
            return
        _integrity_counts(cursor)

        schema_editor.execute(ADD_PARENT_UNIQUE)
        schema_editor.execute(ADD_COMPOSITE_FK)
        schema_editor.execute(VALIDATE_COMPOSITE_FK)

        intermediate = _read_contract(cursor)
        expected = _base_expected()
        _require_exact(
            intermediate["requests"], PARENT_UNIQUE,
            expected["parent_unique"], "repaired parent uniqueness"
        )
        _require_exact(
            intermediate["items"], COMPOSITE_FK,
            expected["composite_fk"], "validated composite foreign-key"
        )
        _require_exact(
            intermediate["items"], WEAK_FK,
            expected["weak_fk"], "legacy weak foreign-key"
        )

        schema_editor.execute(DROP_WEAK_FK)
        if _classify_contract(_read_contract(cursor)) != "repaired":
            raise RuntimeError("Progress-transfer repair postcondition was not reached.")


class Migration(migrations.Migration):
    atomic = True
    dependencies = [("learner_api", "0024_activity_timing_drafts")]
    operations = [
        migrations.RunPython(
            install,
            reverse_code=None,
            hints={"learner_schema_migration": True},
        )
    ]
