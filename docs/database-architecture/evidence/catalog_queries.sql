-- Evidence only. Run only in a verified read-only refactor-branch transaction.
-- Catalog expressions containing private literals are sanitized on export.

-- schemas
SELECT n.oid,n.nspname schema,pg_get_userbyid(n.nspowner) owner,n.nspacl::text acl FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 2;

-- relations
SELECT c.oid,n.nspname schema,c.relname name,c.relkind kind,c.relpersistence persistence,c.reltuples estimated_rows,c.relpages pages,NULL::bigint table_bytes,NULL::bigint index_bytes,NULL::bigint total_bytes,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity row_security,c.relforcerowsecurity force_row_security,c.relispartition is_partition,c.reloptions,CASE WHEN c.relkind='p' THEN pg_get_partkeydef(c.oid) END partition_key,pg_get_expr(c.relpartbound,c.oid) partition_bound FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f','S') ORDER BY 2,3;

-- columns
SELECT n.nspname schema,c.relname table_name,a.attnum ordinal,a.attname column_name,format_type(a.atttypid,a.atttypmod) data_type,NOT a.attnotnull nullable,pg_get_expr(d.adbin,d.adrelid) default_expression,a.attidentity identity_kind,a.attgenerated generated_kind,coll.collname collation,a.attstattarget statistics_target FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation coll ON coll.oid=a.attcollation WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3;

-- constraints
SELECT co.oid,n.nspname schema,c.relname table_name,co.conname name,co.contype type,co.convalidated validated,co.condeferrable deferrable,co.condeferred initially_deferred,co.conenforced enforced,co.conparentid parent_constraint_oid,pg_get_constraintdef(co.oid,true) definition,pn.nspname parent_schema,pc.relname parent_table,co.confdeltype delete_action,co.confupdtype update_action,co.confmatchtype match_type,ARRAY(SELECT a.attname FROM unnest(co.conkey) WITH ORDINALITY k(num,pos) JOIN pg_attribute a ON a.attrelid=co.conrelid AND a.attnum=k.num ORDER BY k.pos) columns,ARRAY(SELECT a.attname FROM unnest(co.confkey) WITH ORDINALITY k(num,pos) JOIN pg_attribute a ON a.attrelid=co.confrelid AND a.attnum=k.num ORDER BY k.pos) parent_columns FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace LEFT JOIN pg_class c ON c.oid=co.conrelid LEFT JOIN pg_class pc ON pc.oid=co.confrelid LEFT JOIN pg_namespace pn ON pn.oid=pc.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 2,3,4;

-- indexes
SELECT n.nspname schema,t.relname table_name,i.relname index_name,x.indexrelid,x.indisunique is_unique,x.indisprimary is_primary,x.indisvalid is_valid,x.indisready is_ready,x.indnkeyatts key_count,x.indnatts attribute_count,x.indkey::text attnums,x.indclass::text opclasses,x.indcollation::text collations,x.indoption::text options,am.amname method,pg_get_indexdef(i.oid) definition,pg_get_expr(x.indpred,t.oid) predicate,pg_get_expr(x.indexprs,t.oid) expressions,pg_relation_size(i.oid) bytes,ARRAY(SELECT a.attname FROM unnest(x.indkey) WITH ORDINALITY k(num,pos) LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num ORDER BY k.pos) columns FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2,3;

-- triggers
SELECT n.nspname schema,c.relname table_name,t.tgname name,t.tgenabled enabled,t.tgisinternal internal,pg_get_triggerdef(t.oid,true) definition,pn.nspname function_schema,p.proname function_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2,3;

-- views
SELECT n.nspname schema,c.relname name,c.relkind kind,c.relispopulated populated,pg_get_viewdef(c.oid,true) definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('v','m') ORDER BY 1,2;

-- functions
SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,p.prokind kind,l.lanname language,p.provolatile volatility,p.prosecdef security_definer,p.proisstrict strict,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) END definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2;

-- sequences
SELECT schemaname schema,sequencename name,sequenceowner owner,data_type::text,start_value,min_value,max_value,increment_by,cycle,cache_size FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' ORDER BY 1,2;

-- inheritance
SELECT n.nspname child_schema,c.relname child,pn.nspname parent_schema,p.relname parent,inh.inhseqno FROM pg_inherits inh JOIN pg_class c ON c.oid=inh.inhrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=inh.inhparent JOIN pg_namespace pn ON pn.oid=p.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema';

-- dependencies
SELECT n.nspname schema,c.relname object_name,d.classid::regclass::text class,d.objsubid,d.deptype,d.refclassid::regclass::text refclass,pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) referenced_object FROM pg_depend d JOIN pg_class c ON d.classid='pg_class'::regclass AND c.oid=d.objid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' UNION ALL SELECT n.nspname,c.relname,d.classid::regclass::text,d.objsubid,d.deptype,d.refclassid::regclass::text,pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) FROM pg_depend d JOIN pg_rewrite r ON d.classid='pg_rewrite'::regclass AND r.oid=d.objid JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema';

-- column_statistics
SELECT schemaname schema,tablename table_name,attname column_name,inherited,null_frac,avg_width,n_distinct,correlation FROM pg_stats WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY 1,2,3;

-- table_statistics
SELECT schemaname schema,relname table_name,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch,n_live_tup,n_dead_tup,n_mod_since_analyze,last_vacuum,last_autovacuum,last_analyze,last_autoanalyze,vacuum_count,autovacuum_count,analyze_count,autoanalyze_count FROM pg_stat_user_tables ORDER BY 1,2;

-- index_statistics
SELECT schemaname schema,relname table_name,indexrelname index_name,idx_scan,idx_tup_read,idx_tup_fetch FROM pg_stat_user_indexes ORDER BY 1,2,3;

-- database_statistics
SELECT datname,numbackends,xact_commit,xact_rollback,blks_read,blks_hit,tup_returned,tup_fetched,temp_files,temp_bytes,deadlocks,stats_reset FROM pg_stat_database WHERE datname=current_database();

-- extensions
SELECT e.extname,e.extversion,n.nspname schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1;

-- policies
SELECT schemaname schema,tablename table_name,policyname name,permissive,roles,cmd,qual,with_check FROM pg_policies ORDER BY 1,2,3;

-- privileges
SELECT table_schema schema,table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema NOT LIKE 'pg_%' AND table_schema<>'information_schema' ORDER BY 1,2,3,4;

-- default_privileges
SELECT pg_get_userbyid(d.defaclrole) owner,n.nspname schema,d.defaclobjtype object_type,d.defaclacl::text acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace;

-- locks_summary
SELECT a.state,a.wait_event_type,a.wait_event,count(*) sessions FROM pg_stat_activity a WHERE datname=current_database() GROUP BY 1,2,3;