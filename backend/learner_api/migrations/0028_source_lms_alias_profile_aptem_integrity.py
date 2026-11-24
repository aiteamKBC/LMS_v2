"""Constrain linked source-LMS aliases to their learner's APTem identity."""

from django.db import migrations


PARENT_CONSTRAINT = "learners_id_aptem_identity_uniq"
ALIAS_CONSTRAINT = "source_alias_profile_aptem_fk"

ADD_PARENT_SQL = f'''
ALTER TABLE "Learner".learners
ADD CONSTRAINT {PARENT_CONSTRAINT} UNIQUE (id, aptem_id)
'''

ADD_ALIAS_SQL = f'''
ALTER TABLE "Learner".source_lms_learner_aliases
ADD CONSTRAINT {ALIAS_CONSTRAINT}
FOREIGN KEY (learner_profile_id, aptem_id)
REFERENCES "Learner".learners (id, aptem_id)
ON DELETE RESTRICT ON UPDATE NO ACTION
NOT VALID
'''

VALIDATE_ALIAS_SQL = f'''
ALTER TABLE "Learner".source_lms_learner_aliases
VALIDATE CONSTRAINT {ALIAS_CONSTRAINT}
'''


def _relation(cursor, name):
    cursor.execute("SELECT to_regclass(%s)", [name])
    return cursor.fetchone()[0]


def _constraint(cursor, relation, name):
    cursor.execute(
        """SELECT con.contype, con.convalidated, pg_get_constraintdef(con.oid),
                  con.confdeltype, con.confupdtype
             FROM pg_constraint con
            WHERE con.conrelid=%s::regclass AND con.conname=%s""",
        [relation, name],
    )
    return cursor.fetchone()


def _has_parent_unique_key(cursor):
    cursor.execute(
        """SELECT EXISTS (
               SELECT 1
                 FROM pg_index idx
                WHERE idx.indrelid='"Learner".learners'::regclass
                  AND idx.indisunique AND idx.indisvalid AND idx.indpred IS NULL
                  AND idx.indnkeyatts=2
                  AND ARRAY(
                      SELECT attribute.attname
                        FROM unnest(idx.indkey::smallint[]) WITH ORDINALITY key(attnum, position)
                        JOIN pg_attribute attribute
                          ON attribute.attrelid=idx.indrelid AND attribute.attnum=key.attnum
                       WHERE key.position <= idx.indnkeyatts
                       ORDER BY key.position
                  )=ARRAY['id','aptem_id']::name[]
           )"""
    )
    return cursor.fetchone()[0]


def _has_equivalent_alias_fk(cursor, *, require_actions=True,
                             relation='"Learner".source_lms_learner_aliases',
                             require_validated=False, update_action='a'):
    cursor.execute(
        """SELECT EXISTS (
               SELECT 1
                 FROM pg_constraint con
                WHERE con.conrelid=%s::regclass
                  AND con.confrelid='"Learner".learners'::regclass
                  AND con.contype='f'
                  AND (NOT %s OR con.convalidated)
                  AND con.conkey=ARRAY[
                      (SELECT attnum FROM pg_attribute
                        WHERE attrelid=con.conrelid AND attname='learner_profile_id'),
                      (SELECT attnum FROM pg_attribute
                        WHERE attrelid=con.conrelid AND attname='aptem_id')
                  ]::smallint[]
                  AND con.confkey=ARRAY[
                      (SELECT attnum FROM pg_attribute
                        WHERE attrelid=con.confrelid AND attname='id'),
                      (SELECT attnum FROM pg_attribute
                        WHERE attrelid=con.confrelid AND attname='aptem_id')
                  ]::smallint[]
                  AND (NOT %s OR (con.confdeltype='r' AND con.confupdtype=%s))
           )"""
        , [relation, require_validated, require_actions, update_action]
    )
    return cursor.fetchone()[0]


def _verify_physical_schema(cursor):
    cursor.execute(
        """SELECT table_name, column_name, data_type, is_nullable
             FROM information_schema.columns
            WHERE table_schema='Learner'
              AND ((table_name='learners' AND column_name=ANY(%s))
                OR (table_name='source_lms_learner_aliases' AND column_name=ANY(%s)))""",
        [["id", "aptem_id"], ["learner_profile_id", "aptem_id"]],
    )
    actual = {(table, column): (kind, nullable) for table, column, kind, nullable in cursor.fetchall()}
    expected = {
        ("learners", "id"): ("bigint", "NO"),
        ("learners", "aptem_id"): ("bigint", "YES"),
        ("source_lms_learner_aliases", "learner_profile_id"): ("bigint", "YES"),
        ("source_lms_learner_aliases", "aptem_id"): ("bigint", "NO"),
    }
    if actual != expected:
        raise RuntimeError("Source LMS alias key columns do not match the approved physical schema.")

    cursor.execute(
        """SELECT count(*) FROM (
               SELECT id, aptem_id
                 FROM "Learner".learners
                GROUP BY id, aptem_id HAVING count(*) > 1
           ) duplicates"""
    )
    if cursor.fetchone()[0]:
        raise RuntimeError("Duplicate learner id/APTem pairs block alias integrity.")

    cursor.execute(
        """SELECT count(*)
             FROM "Learner".source_lms_learner_aliases alias
             JOIN "Learner".learners learner ON learner.id=alias.learner_profile_id
            WHERE alias.learner_profile_id IS NOT NULL
              AND alias.aptem_id IS DISTINCT FROM learner.aptem_id"""
    )
    if cursor.fetchone()[0]:
        raise RuntimeError("Mismatched linked alias APTem identities block the migration.")


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        learner_relation = _relation(cursor, '"Learner".learners')
        alias_relation = _relation(cursor, '"Learner".source_lms_learner_aliases')
        if learner_relation is not None and alias_relation is None:
            replacement = _relation(cursor, '"Last_audit".learner_lms_aliases')
            if replacement is not None:
                # Cleanup retired the old relation. Validate the replacement's
                # ownership guard without recreating or altering either table.
                # Its approved FK restricts both updates and deletes.
                if not _has_equivalent_alias_fk(cursor,
                        relation='"Last_audit".learner_lms_aliases',
                        require_validated=True, update_action='r'):
                    raise RuntimeError('Replacement LMS aliases lack validated profile/APTem ownership.')
                return
        if learner_relation is None and alias_relation is None:
            return  # Externally managed relations are absent from this installation.
        if learner_relation is None or alias_relation is None:
            raise RuntimeError("Only one source LMS alias integrity relation exists.")

        _verify_physical_schema(cursor)

        parent = _constraint(cursor, '"Learner".learners', PARENT_CONSTRAINT)
        if parent and (parent[0] != "u" or "UNIQUE (id, aptem_id)" not in parent[2]):
            raise RuntimeError(f"Constraint {PARENT_CONSTRAINT} has an unexpected definition.")
        if not parent and not _has_parent_unique_key(cursor):
            cursor.execute(ADD_PARENT_SQL)

        child = _constraint(cursor, '"Learner".source_lms_learner_aliases', ALIAS_CONSTRAINT)
        if child and not _has_equivalent_alias_fk(cursor):
            # Development may already contain the approved relationship with
            # RESTRICT as its update action. Replace only that proven shape;
            # do not weaken or guess at any differently defined constraint.
            if (child[0] != "f" or child[3:] != ("r", "r")
                    or not _has_equivalent_alias_fk(cursor, require_actions=False)):
                raise RuntimeError(f"Constraint {ALIAS_CONSTRAINT} has an unexpected definition.")
            cursor.execute(
                f'ALTER TABLE "Learner".source_lms_learner_aliases '
                f'DROP CONSTRAINT {ALIAS_CONSTRAINT}'
            )
            child = None
        if not child and not _has_equivalent_alias_fk(cursor):
            cursor.execute(ADD_ALIAS_SQL)
            child = _constraint(cursor, '"Learner".source_lms_learner_aliases', ALIAS_CONSTRAINT)
        if child and not child[1]:
            cursor.execute(VALIDATE_ALIAS_SQL)


class Migration(migrations.Migration):
    dependencies = [("learner_api", "0027_free_course_progress_state")]
    operations = [
        migrations.RunPython(
            apply_schema,
            migrations.RunPython.noop,
            hints={"learner_schema_migration": True},
        )
    ]
