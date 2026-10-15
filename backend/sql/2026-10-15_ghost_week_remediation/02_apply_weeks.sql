-- Ghost week remediation -- step 2: apply. ONE TRANSACTION; all or nothing.
--
-- Run 01_preflight_preview.sql first and check its expectations.
--
-- Changes exactly 34 curriculum.weeks rows: deleted_via_parent -> NULL.
-- Untouched: deleted_at, deleted_by, is_programme_deleted, updated_at, titles,
-- order, every component, KSB mapping, learner progress, attendance, KSB
-- achievement and Teams row. Nothing is deleted.
--
-- Each target must still match EVERY condition below, or the whole script
-- aborts and nothing is written:
--   * its id is one of the 34 listed;
--   * it belongs to one of the two named modules, and that module is running;
--   * it is deleted, stamped deleted_via_parent = its own module id, by
--     'module-delete', at that module's single 21 Sep 2026 08:53 stamp;
--   * it has no live component.
-- The before-image is kept in week_ghost_remediation.weeks_before for
-- rollback/rollback_weeks.sql.

begin;

create schema if not exists week_ghost_remediation;

create table if not exists week_ghost_remediation.weeks_before (
    id                   varchar primary key,
    module_catalogue_id  varchar     not null,
    week_number          integer,
    title                text,
    deleted_at           timestamptz not null,
    deleted_by           varchar,
    deleted_via_parent   varchar     not null,
    remediated_at        timestamptz not null default now()
);

create temporary table ghost_targets on commit drop as
select w.id, w.module_catalogue_id, w.week_number, w.title,
       w.deleted_at, w.deleted_by, w.deleted_via_parent
  from curriculum.weeks w
  join curriculum.modules m on m.module_catalogue_id = w.module_catalogue_id
 where w.id in (
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
   and w.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                 'MOD-20260921085233798880517CB0D243D0')
   and m.deleted_at is null
   and w.deleted_at is not null
   and w.deleted_via_parent = w.module_catalogue_id
   and w.deleted_by = 'module-delete'
   and w.deleted_at >= timestamptz '2026-09-21 08:53:00+00'
   and w.deleted_at <  timestamptz '2026-09-21 08:54:00+00'
   and not exists (select 1 from curriculum.components c
                    where c.week_id = w.id and c.deleted_at is null);

do $$
declare
    n_targets integer;
    n_backed  integer;
begin
    select count(*) into n_targets from ghost_targets;
    if n_targets <> 34 then
        raise exception 'Expected 34 ghost weeks, found %. Nothing changed; re-run 01_preflight_preview.sql.', n_targets;
    end if;
    if (select count(*) from ghost_targets
         where module_catalogue_id = 'MOD-20260921085217095815146F2085A499') <> 17 then
        raise exception 'Expected 17 ghost weeks on ...A499. Nothing changed.';
    end if;
    select count(*) into n_backed
      from week_ghost_remediation.weeks_before b join ghost_targets t using (id);
    if n_backed <> 0 then
        raise exception 'Already applied: % of these rows are in week_ghost_remediation.weeks_before. Nothing changed.', n_backed;
    end if;
end $$;

insert into week_ghost_remediation.weeks_before
       (id, module_catalogue_id, week_number, title, deleted_at, deleted_by, deleted_via_parent)
select id, module_catalogue_id, week_number, title, deleted_at, deleted_by, deleted_via_parent
  from ghost_targets;

-- The update re-checks the state captured above, so a row changed by anyone
-- in between is not touched -- and then the count below aborts the whole run.
do $$
declare
    n_updated integer;
begin
    update curriculum.weeks w
       set deleted_via_parent = null
      from ghost_targets t
     where w.id = t.id
       and w.deleted_at = t.deleted_at
       and w.deleted_via_parent = t.deleted_via_parent;
    get diagnostics n_updated = row_count;
    if n_updated <> 34 then
        raise exception 'Updated % rows, expected 34. Rolled back.', n_updated;
    end if;
end $$;

-- Post-conditions, checked before commit.
do $$
declare
    n_left integer;
    n_live integer;
begin
    select count(*) into n_left
      from curriculum.weeks w
      join curriculum.modules m on m.module_catalogue_id = w.module_catalogue_id
     where m.deleted_at is null and w.deleted_at is not null
       and coalesce(w.deleted_via_parent, '') <> ''
       and w.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                     'MOD-20260921085233798880517CB0D243D0');
    if n_left <> 0 then
        raise exception '% ghost weeks still carry a parent stamp. Rolled back.', n_left;
    end if;
    select count(*) into n_live
      from curriculum.weeks w join ghost_targets t using (id)
     where w.deleted_at is null;
    if n_live <> 0 then
        raise exception '% target rows are no longer deleted. Rolled back.', n_live;
    end if;
    if (select count(*) from week_ghost_remediation.weeks_before b join ghost_targets t using (id)) <> 34 then
        raise exception 'Before-image incomplete. Rolled back.';
    end if;
end $$;

commit;
