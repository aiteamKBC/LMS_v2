begin;

alter table curriculum.groups
add column if not exists session_week_day varchar(255);

alter table curriculum.groups
add column if not exists session_start_time varchar(32);

alter table curriculum.groups
add column if not exists session_end_time varchar(32);

update curriculum.groups
set session_week_day = coalesce(
    nullif(session_week_day, ''),
    nullif(btrim(regexp_replace(coalesce(schedule, ''), '\s*\d{1,2}:?\d{2}\s*(AM|PM)?\s*[-–]\s*\d{1,2}:?\d{2}\s*(AM|PM)?\s*$', '', 'i')), '')
  ),
  session_start_time = coalesce(
    nullif(session_start_time, ''),
    nullif((regexp_match(coalesce(schedule, ''), '(\d{1,2}:?\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:?\d{2}\s*(?:AM|PM)?)', 'i'))[1], '')
  ),
  session_end_time = coalesce(
    nullif(session_end_time, ''),
    nullif((regexp_match(coalesce(schedule, ''), '(\d{1,2}:?\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:?\d{2}\s*(?:AM|PM)?)', 'i'))[2], '')
  )
where coalesce(schedule, '') <> '';

alter table curriculum.groups
drop column if exists start_date,
drop column if exists end_date,
drop column if exists schedule,
drop column if exists training_plan_ids;

commit;
