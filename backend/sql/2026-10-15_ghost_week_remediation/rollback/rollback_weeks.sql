-- Ghost week remediation -- ROLLBACK. Not part of the apply sequence.
--
-- Puts deleted_via_parent back on the 34 weeks from the before-image taken by
-- 02_apply.sql. Only rows still in the state the remediation left them
-- (deleted, same deleted_at, stamp NULL) are restored; if any row has moved
-- on, nothing is changed. One transaction.
--
-- Note: restoring the stamp also restores the original defect on any backend
-- that still runs the pre-fix week filter.

begin;

do $$
declare
    n_backup   integer;
    n_restored integer;
begin
    select count(*) into n_backup from week_ghost_remediation.weeks_before;
    if n_backup <> 34 then
        raise exception 'Expected 34 rows in the before-image, found %. Nothing changed.', n_backup;
    end if;

    update curriculum.weeks w
       set deleted_via_parent = b.deleted_via_parent
      from week_ghost_remediation.weeks_before b
     where w.id = b.id
       and w.deleted_at = b.deleted_at
       and w.deleted_via_parent is null;
    get diagnostics n_restored = row_count;
    if n_restored <> 34 then
        raise exception 'Restored % rows, expected 34. Rolled back.', n_restored;
    end if;
end $$;

-- The before-image is kept (renamed) as the record of what was undone.
-- Suffixed with the time, so a later apply and rollback can repeat this.
do $$
begin
    execute format('alter table week_ghost_remediation.weeks_before rename to %I',
                   'weeks_before_rolled_back_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS'));
end $$;

commit;
