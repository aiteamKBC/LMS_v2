"""Read-only source snapshots for the strict My Learning catalogue projection."""
from django.db.models import F, Func

from .models import SafeJSONField


class CataloguePlan(Func):
    """Keep assignment metadata and id-less history; master owns native children.

    Only the strict catalogue reader can use this projection. Material readers
    must keep their full snapshots. Encoded legacy JSON is deliberately left
    intact for the existing Python decoder.
    """
    output_field = SafeJSONField()

    def as_postgresql(self, compiler, connection, **extra_context):
        expression, params = compiler.compile(self.source_expressions[0])
        sql = f"""CASE WHEN jsonb_typeof({expression})='array' THEN (
            SELECT coalesce(jsonb_agg(CASE
                WHEN jsonb_typeof(item)='object' AND item->'moduleId' IS NOT NULL
                  AND item->'moduleId' NOT IN ('null'::jsonb,'false'::jsonb,
                      '0'::jsonb,'""'::jsonb,'[]'::jsonb,'{{}}'::jsonb)
                THEN item-'weeks' ELSE item END ORDER BY position),'[]'::jsonb)
            FROM jsonb_array_elements({expression}) WITH ORDINALITY AS plan(item,position)
        ) ELSE {expression} END"""
        return sql, params * 3

    def as_sqlite(self, compiler, connection, **extra_context):
        # SQLite development/test callers retain the full snapshot.
        return compiler.compile(self.source_expressions[0])


def read_catalogue_source(model, pk, fields):
    # CSV fields are needed only by get_training_plan's unsaved-plan fallback.
    # Leave them deferred so native plans do not transfer the large CSV mirror.
    projected = ('training_plan', 'learning_plan')
    deferred = {*projected, 'modules', 'weeks', 'components'}
    source = model.all_learners.only(*(field for field in fields if field not in deferred)).annotate(
        **{f'_catalogue_{field}': CataloguePlan(F(field)) for field in projected},
    ).get(pk=pk)
    for field in projected:
        setattr(source, field, getattr(source, f'_catalogue_{field}'))
    return source
