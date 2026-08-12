begin;

alter table curriculum.modules
drop column if exists coach_name;

commit;

