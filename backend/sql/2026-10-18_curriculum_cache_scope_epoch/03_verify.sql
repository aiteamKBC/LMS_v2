-- Curriculum cache scope epochs -- step 3: verify. READ ONLY.

-- Expect: curriculum.cache_scope_epoch, owned by the same role as cache_epoch.
select schemaname, tablename, tableowner
from pg_tables
where schemaname = 'curriculum' and tablename in ('cache_epoch', 'cache_scope_epoch')
order by tablename;

-- Expect two columns: scope (character varying, not null), epoch (bigint, not null).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'curriculum' and table_name = 'cache_scope_epoch'
order by ordinal_position;

-- Expect at least the '*' row. After the backend has served saves, programme
-- rows appear with small epochs; that is normal.
select scope, epoch from curriculum.cache_scope_epoch order by scope limit 20;
