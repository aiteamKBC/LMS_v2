-- Programme cards keep the order they are dragged into.
--
-- Until now curriculum.programmes was read `order by name`, so the Curriculum
-- Studio grid was alphabetical and nothing could change that. display_order is
-- the curator's order: 1 upward for every programme that has been placed, 0 for
-- one that never has. Reads are `order by coalesce(display_order, 0), name`, so
-- unplaced programmes stay alphabetical among themselves and ahead of the
-- placed ones until they are dragged somewhere.
--
-- Safe to re-run.

alter table curriculum.programmes
  add column if not exists display_order integer;

update curriculum.programmes
   set display_order = 0
 where display_order is null;

alter table curriculum.programmes
  alter column display_order set default 0;

-- Verification: every programme in the order the grid will now show them.
-- select programme_id, name, coalesce(display_order, 0) as display_order
--   from curriculum.programmes
--  order by coalesce(display_order, 0), name;
