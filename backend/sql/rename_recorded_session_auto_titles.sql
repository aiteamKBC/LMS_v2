-- Rename the auto-generated "Recorded Session N" component titles to "Video N".
--
-- Why
-- ---
-- The week rail used to offer the `video` component type under the label
-- "Recorded Session", and stamped that label onto every component created from
-- it ("Recorded Session 1", "Recorded Session 2", ...). The same component also
-- takes a YouTube link, an external link or an embed, none of which is a
-- recording of a session, so the type now carries the shared model's own name,
-- "Video". The label change is in the code; the titles already written into the
-- database are what this script fixes.
--
-- What it does NOT touch
-- ----------------------
-- Only the exact auto-generated shape is rewritten: "Recorded Session" on its
-- own, or followed by a single number. A title an author typed -- "Recorded
-- Session: Week 3 catch-up", "Recorded session recap", "Recorded Session 2 of
-- 4" -- does not match and is left exactly as it is. Nothing but `title` is
-- written, and no other component type is read.
--
-- Archived rows are included deliberately: restoring an archived module should
-- bring back a module that reads like every other one, not one still using a
-- name the product no longer has.
--
-- How to run
-- ----------
-- Run the two SELECTs first and read what they return. If the list looks right,
-- run the two UPDATEs. Both are idempotent -- a second run matches nothing,
-- because the rewritten titles no longer start with "Recorded Session".

begin;

-- 1. Preview: module components that will be renamed.
select id, module_catalogue_id, title as current_title,
       regexp_replace(title, '^Recorded Session', 'Video') as new_title
from curriculum.components
where type in ('video', 'Video')
  and title ~ '^Recorded Session( [0-9]+)?$'
order by module_catalogue_id, display_order;

-- 2. Preview: week-template components that will be renamed.
select id, week_template_id, title as current_title,
       regexp_replace(title, '^Recorded Session', 'Video') as new_title
from curriculum.week_template_components
where type in ('video', 'Video')
  and title ~ '^Recorded Session( [0-9]+)?$'
order by week_template_id, display_order;

-- 3. Apply to module components.
update curriculum.components
set title = regexp_replace(title, '^Recorded Session', 'Video'),
    updated_at = current_timestamp
where type in ('video', 'Video')
  and title ~ '^Recorded Session( [0-9]+)?$';

-- 4. Apply to week-template components.
update curriculum.week_template_components
set title = regexp_replace(title, '^Recorded Session', 'Video'),
    updated_at = current_timestamp
where type in ('video', 'Video')
  and title ~ '^Recorded Session( [0-9]+)?$';

-- 5. Verify: both should return 0.
select count(*) as module_components_left
from curriculum.components
where type in ('video', 'Video') and title ~ '^Recorded Session( [0-9]+)?$';

select count(*) as week_template_components_left
from curriculum.week_template_components
where type in ('video', 'Video') and title ~ '^Recorded Session( [0-9]+)?$';

commit;
