begin;

alter table curriculum.groups
drop column if exists training_plan_ids;

commit;

