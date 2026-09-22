-- Widen every authoring title column from varchar(500) to text.
--
-- Why: the Module Builder save (PATCH /curriculum/modules/<id>/structure/)
-- returned 500 "value too long for type character varying(500)" whenever a
-- component title carried a full KSB statement. Titles here are authored prose,
-- not identifiers, so there is no length to pick -- text removes the ceiling.
--
-- varchar(n) -> text is a catalogue-only change in Postgres: no table rewrite,
-- no index rebuild, no downtime. BUT Postgres refuses to retype a column that a
-- view reads ("cannot alter type of a column used by a view or rule",
-- SQLSTATE 0A000) -- curriculum.component_learning_lineage and the two views
-- stacked on it read components.title, weeks.title and modules.title. So this
-- script captures every dependent view first (definition, owner, grants,
-- comment), drops them, retypes the columns, and rebuilds the views exactly as
-- they were. Views are dropped deepest-first and rebuilt shallowest-first, so a
-- view stacked on another view comes back in the right order.
--
-- The whole thing is one DO block, therefore one transaction: if any part
-- fails, the views are still there and nothing has changed. Safe to re-run --
-- a column that is already text is skipped, and if nothing needs widening the
-- views are left untouched.
--
-- Run on Neon (production) and on any other environment whose curriculum schema
-- predates this change.

do $$
declare
    target record;
    view_row record;
    pending_count integer;
    matview_names text;
begin
    create temp table _title_targets (
        schema_name text,
        table_name text,
        column_name text
    ) on commit drop;

    insert into _title_targets (schema_name, table_name, column_name) values
        ('curriculum', 'modules',                   'title'),
        ('curriculum', 'weeks',                     'title'),
        ('curriculum', 'weeks',                     'origin_module_title'),
        ('curriculum', 'weeks',                     'origin_week_label'),
        ('curriculum', 'components',                'title'),
        ('curriculum', 'components',                'origin_module_title'),
        ('curriculum', 'components',                'origin_week_label'),
        ('curriculum', 'record_revisions',          'title'),
        ('curriculum', 'live_sessions',             'module_title'),
        ('curriculum', 'week_templates',            'title'),
        ('curriculum', 'week_template_components',  'title'),
        ('curriculum', 'free_courses',              'course_name'),
        ('curriculum', 'free_course_weeks',         'course_name'),
        ('curriculum', 'free_course_weeks',         'week_title'),
        ('curriculum', 'free_programme_components', 'title'),
        ('programme_audit', 'assets',               'programme_name'),
        ('programme_audit', 'assets',               'module_title'),
        ('programme_audit', 'assets',               'week_title'),
        ('programme_audit', 'assets',               'title'),
        ('programme_audit', 'assets',               'file_name');

    -- Only the columns that are still varchar. A re-run finds none and skips
    -- the view surgery entirely.
    create temp table _title_pending on commit drop as
    select t.schema_name, t.table_name, t.column_name
    from _title_targets t
    join information_schema.columns c
      on c.table_schema = t.schema_name
     and c.table_name = t.table_name
     and c.column_name = t.column_name
     and c.data_type = 'character varying';

    select count(*) into pending_count from _title_pending;
    if pending_count = 0 then
        raise notice 'Every title column is already text. Nothing to do.';
        return;
    end if;

    -- Every view that reads one of those columns, plus every view stacked on
    -- those views. depth is how far down the stack it sits.
    create temp table _dependent_views on commit drop as
    with recursive stack as (
        select v.oid as view_oid, 1 as depth
        from _title_pending t
        join pg_namespace ns on ns.nspname = t.schema_name
        join pg_class tab on tab.relnamespace = ns.oid and tab.relname = t.table_name
        join pg_attribute att on att.attrelid = tab.oid and att.attname = t.column_name
        join pg_depend d
          on d.refclassid = 'pg_class'::regclass
         and d.refobjid = tab.oid
         and d.refobjsubid = att.attnum
         and d.classid = 'pg_rewrite'::regclass
        join pg_rewrite r on r.oid = d.objid
        join pg_class v on v.oid = r.ev_class and v.relkind in ('v', 'm')
        where v.oid <> tab.oid
        union all
        select v.oid, s.depth + 1
        from stack s
        join pg_depend d
          on d.refclassid = 'pg_class'::regclass
         and d.refobjid = s.view_oid
         and d.classid = 'pg_rewrite'::regclass
        join pg_rewrite r on r.oid = d.objid
        join pg_class v on v.oid = r.ev_class and v.relkind in ('v', 'm')
        where v.oid <> s.view_oid
          and s.depth < 10
    )
    select
        stack.view_oid,
        max(stack.depth) as depth,
        c.relkind,
        format('%I.%I', ns.nspname, c.relname) as ident,
        pg_get_viewdef(stack.view_oid, true) as definition,
        pg_get_userbyid(c.relowner) as owner,
        obj_description(stack.view_oid, 'pg_class') as comment,
        coalesce(
            (
                select array_agg(
                    format(
                        'grant %s on %I.%I to %s',
                        acl.privilege_type,
                        ns.nspname,
                        c.relname,
                        case
                            when acl.grantee = 0 then 'public'
                            else quote_ident(pg_get_userbyid(acl.grantee))
                        end
                    )
                )
                from aclexplode(c.relacl) acl
                where acl.grantee <> c.relowner
            ),
            array[]::text[]
        ) as grants
    from stack
    join pg_class c on c.oid = stack.view_oid
    join pg_namespace ns on ns.oid = c.relnamespace
    group by stack.view_oid, c.relkind, ns.nspname, c.relname, c.relowner, c.relacl;

    -- A materialized view would lose its indexes on the rebuild, so stop rather
    -- than quietly degrade one. None exist today; this is a tripwire.
    select string_agg(ident, ', ') into matview_names
    from _dependent_views where relkind = 'm';
    if matview_names is not null then
        raise exception
            'Materialized view(s) depend on these columns: %. Rebuild them by hand (indexes would be lost) and re-run.',
            matview_names;
    end if;

    for view_row in select * from _dependent_views order by depth desc, ident loop
        raise notice 'dropping view % (depth %)', view_row.ident, view_row.depth;
        execute format('drop view if exists %s', view_row.ident);
    end loop;

    for target in select * from _title_pending loop
        execute format(
            'alter table %I.%I alter column %I type text',
            target.schema_name, target.table_name, target.column_name
        );
        raise notice 'widened %.%.% to text',
            target.schema_name, target.table_name, target.column_name;
    end loop;

    for view_row in select * from _dependent_views order by depth asc, ident loop
        execute format('create view %s as %s', view_row.ident, view_row.definition);
        execute format('alter view %s owner to %I', view_row.ident, view_row.owner);
        if view_row.comment is not null then
            execute format('comment on view %s is %L', view_row.ident, view_row.comment);
        end if;
        for target in select unnest(view_row.grants) as stmt loop
            execute target.stmt;
        end loop;
        raise notice 'rebuilt view %', view_row.ident;
    end loop;
end $$;

-- Verification 1: every row below should read "text".
select table_schema, table_name, column_name, data_type
from information_schema.columns
where (table_schema, table_name, column_name) in (
        ('curriculum', 'modules', 'title'),
        ('curriculum', 'weeks', 'title'),
        ('curriculum', 'components', 'title'),
        ('curriculum', 'record_revisions', 'title'),
        ('curriculum', 'live_sessions', 'module_title')
    )
order by table_schema, table_name, column_name;

-- Verification 2: the rebuilt views are back. Expect component_learning_lineage,
-- component_ksb_weighting and component_learning_summary among them.
select schemaname, viewname, viewowner
from pg_views
where schemaname in ('curriculum', 'programme_audit')
order by schemaname, viewname;
