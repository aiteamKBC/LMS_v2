begin;

update curriculum.modules module
set tutor_name = nullif(group_table.tutor_name, '')
from curriculum.groups group_table
where module.group_id = group_table.group_id
  and coalesce(nullif(module.tutor_name, ''), '') = ''
  and coalesce(nullif(group_table.tutor_name, ''), '') <> '';

alter table curriculum.groups
drop column if exists tutor_name;

commit;

