-- Ghost week remediation -- ROLLBACK of 03_apply_components.sql. Not part of
-- the apply sequence.
--
-- Puts deleted_via_parent back on the 594 components from the before-image.
-- Only rows still in the state the remediation left them (deleted, same
-- deleted_at, stamp NULL) are restored; if any row has moved on, nothing is
-- changed. One transaction.
--
-- Note: restoring the stamp also restores the original risk -- a Restore of
-- either module would bring these components back as live content.

begin;

do $$
declare
    n_backup   integer;
    n_restored integer;
begin
    select count(*) into n_backup from week_ghost_remediation.components_before;
    if n_backup <> 594 then
        raise exception 'Expected 594 rows in the before-image, found %. Nothing changed.', n_backup;
    end if;

    update curriculum.components c
       set deleted_via_parent = b.deleted_via_parent
      from week_ghost_remediation.components_before b
     where c.id = b.id
       and c.deleted_at = b.deleted_at
       and c.deleted_via_parent is null;
    get diagnostics n_restored = row_count;
    if n_restored <> 594 then
        raise exception 'Restored % rows, expected 594. Rolled back.', n_restored;
    end if;
end $$;

-- The before-image is kept (renamed) as the record of what was undone.
-- Suffixed with the time, so a later apply and rollback can repeat this.
do $$
begin
    execute format('alter table week_ghost_remediation.components_before rename to %I',
                   'components_before_rolled_back_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS'));
end $$;

commit;
