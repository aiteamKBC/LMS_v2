-- Ghost week remediation -- step 3: apply to components. ONE TRANSACTION;
-- all or nothing. Separate from step 2 so each can be reviewed, run and rolled
-- back on its own.
--
-- Changes exactly 594 curriculum.components rows (297 per module):
-- deleted_via_parent -> NULL. These are the components that sat on the 34
-- ghost weeks when the module was archived on 21 Sep 2026. Their stamp says
-- "archived with this module", so a Restore of either module would bring all
-- 594 back as live content beside the current weeks.
--
-- Untouched: deleted_at, deleted_by, is_programme_deleted, updated_at, titles,
-- settings, KSB data, every learner progress, attendance, KSB achievement and
-- Teams row. Nothing is deleted.
--
-- Each target must still match EVERY condition below, or the whole script
-- aborts and nothing is written:
--   * it belongs to one of the two named modules, and that module is running;
--   * it sits on one of the 34 ghost weeks, and that week is not live;
--   * it is deleted, stamped deleted_via_parent = its own module id, by
--     'module-delete', inside that module's 21 Sep 2026 08:53 archive;
--   * the set per module is exactly the 297 ids fingerprinted on 15 Oct 2026
--     (md5 of the ids sorted and comma-joined);
--   * no learner training plan, quiz link or live KSB mapping refers to it.
-- The before-image is kept in week_ghost_remediation.components_before for
-- rollback/rollback_components.sql.

begin;

create schema if not exists week_ghost_remediation;

create table if not exists week_ghost_remediation.components_before (
    id                   varchar primary key,
    module_catalogue_id  varchar     not null,
    week_id              varchar,
    title                text,
    deleted_at           timestamptz not null,
    deleted_by           varchar,
    deleted_via_parent   varchar     not null,
    remediated_at        timestamptz not null default now()
);

create temporary table ghost_component_targets on commit drop as
select c.id, c.module_catalogue_id, c.week_id, c.title,
       c.deleted_at, c.deleted_by, c.deleted_via_parent
  from curriculum.components c
  join curriculum.modules m on m.module_catalogue_id = c.module_catalogue_id
 where c.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                 'MOD-20260921085233798880517CB0D243D0')
   and c.week_id in (
        'WEEK-202609210852197534Z3AYY','WEEK-20260921085219753NN14BT','WEEK-20260921085219754U09HWK',
        'WEEK-20260921085219755QKPMJT','WEEK-202609210852197560MRNXV','WEEK-20260921085219757VR1FX5',
        'WEEK-20260921085219758U5A4H9','WEEK-20260921085219758V9Q7K6','WEEK-20260921085219758EYXVQG',
        'WEEK-20260921085219759UAVCPH','WEEK-202609210852197593ZJ9QL','WEEK-20260921085219759795YHG',
        'WEEK-20260921085219760UY99E3','WEEK-20260921085219760BGFA0P','WEEK-20260921085219760CM59KW',
        'WEEK-20260921085219760R3XCT9','WEEK-20260921085219761856INC',
        'WEEK-20260921085236476XWAXGP','WEEK-20260921085236476CM83GA','WEEK-20260921085236477RU795F',
        'WEEK-20260921085236477FLW4AA','WEEK-2026092108523647788GZII','WEEK-20260921085236478VF5N7J',
        'WEEK-20260921085236478MV587R','WEEK-20260921085236478BRIUKI','WEEK-20260921085236478MSXSJW',
        'WEEK-20260921085236481ZMIUOG','WEEK-20260921085236481U3TEJW','WEEK-202609210852364811G7VKK',
        'WEEK-20260921085236481VIBMMU','WEEK-20260921085236481N0M2GU','WEEK-20260921085236481N1H4OM',
        'WEEK-20260921085236482FKK7H3','WEEK-20260921085236482NZOMXE')
   and m.deleted_at is null
   and c.deleted_at is not null
   and c.deleted_via_parent = c.module_catalogue_id
   and c.deleted_by = 'module-delete'
   and c.deleted_at >= timestamptz '2026-09-21 08:53:00+00'
   and c.deleted_at <  timestamptz '2026-09-21 08:54:00+00'
   and not exists (select 1 from curriculum.weeks w
                    where w.id = c.week_id and w.deleted_at is null);

do $$
declare
    n_targets integer;
    n_backed  integer;
    n_refs    integer;
begin
    select count(*) into n_targets from ghost_component_targets;
    if n_targets <> 594 then
        raise exception 'Expected 594 ghost components, found %. Nothing changed; re-run 01_preflight_preview.sql.', n_targets;
    end if;
    if (select md5(string_agg(id, ',' order by id)) from ghost_component_targets
         where module_catalogue_id = 'MOD-20260921085217095815146F2085A499')
       is distinct from '7636d6ce7129d3bc0e654ba691d80e16' then
        raise exception 'Ghost component set on ...A499 differs from the 297 fingerprinted. Nothing changed.';
    end if;
    if (select md5(string_agg(id, ',' order by id)) from ghost_component_targets
         where module_catalogue_id = 'MOD-20260921085233798880517CB0D243D0')
       is distinct from 'e4bbcab150e966907e66dad85a3ee931' then
        raise exception 'Ghost component set on ...43D0 differs from the 297 fingerprinted. Nothing changed.';
    end if;
    select count(*) into n_refs
      from ghost_component_targets t
     where exists (select 1 from "Learner".learner_training_plan_components p
                    where p.curriculum_component_id = t.id)
        or exists (select 1 from curriculum.quiz_component_links q where q.component_id = t.id)
        or exists (select 1 from curriculum.ksb_mappings k
                    where k.component_id = t.id and k.deleted_at is null);
    if n_refs <> 0 then
        raise exception '% ghost components are referenced by a learner plan, quiz link or live KSB mapping. Nothing changed; review before proceeding.', n_refs;
    end if;
    select count(*) into n_backed
      from week_ghost_remediation.components_before b join ghost_component_targets t using (id);
    if n_backed <> 0 then
        raise exception 'Already applied: % of these rows are in week_ghost_remediation.components_before. Nothing changed.', n_backed;
    end if;
end $$;

insert into week_ghost_remediation.components_before
       (id, module_catalogue_id, week_id, title, deleted_at, deleted_by, deleted_via_parent)
select id, module_catalogue_id, week_id, title, deleted_at, deleted_by, deleted_via_parent
  from ghost_component_targets;

-- The update re-checks the state captured above, so a row changed by anyone
-- in between is not touched -- and then the count below aborts the whole run.
do $$
declare
    n_updated integer;
begin
    update curriculum.components c
       set deleted_via_parent = null
      from ghost_component_targets t
     where c.id = t.id
       and c.deleted_at = t.deleted_at
       and c.deleted_via_parent = t.deleted_via_parent;
    get diagnostics n_updated = row_count;
    if n_updated <> 594 then
        raise exception 'Updated % rows, expected 594. Rolled back.', n_updated;
    end if;
end $$;

-- Post-conditions, checked before commit.
do $$
declare
    n_left integer;
    n_live integer;
begin
    select count(*) into n_left
      from curriculum.components c
      join curriculum.modules m on m.module_catalogue_id = c.module_catalogue_id
     where m.deleted_at is null and c.deleted_at is not null
       and coalesce(c.deleted_via_parent, '') <> ''
       and c.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                     'MOD-20260921085233798880517CB0D243D0');
    if n_left <> 0 then
        raise exception '% ghost components still carry a parent stamp. Rolled back.', n_left;
    end if;
    select count(*) into n_live
      from curriculum.components c join ghost_component_targets t using (id)
     where c.deleted_at is null;
    if n_live <> 0 then
        raise exception '% target rows are no longer deleted. Rolled back.', n_live;
    end if;
    if (select count(*) from week_ghost_remediation.components_before b
          join ghost_component_targets t using (id)) <> 594 then
        raise exception 'Before-image incomplete. Rolled back.';
    end if;
end $$;

commit;
