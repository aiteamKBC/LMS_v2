-- Read-only. Names each programme and module that still applies a manual KSB
-- profile, and whether it is live, archived or deleted. Safe to run any time.

with profiles as (
  select id::text as id, lower(id::text) as k1, lower(coalesce(ksb_profile_id, '')) as k2, name
    from curriculum.ksb_profiles
)
select 'programme' as kind, p.programme_id as record_id, p.name as record_name,
       pr.name as profile_name,
       case when (to_jsonb(p) ->> 'deleted_at') is not null then 'deleted'
            when coalesce((to_jsonb(p) ->> 'is_archived')::boolean, false) then 'archived'
            else 'live' end as state
  from curriculum.programmes p
  join profiles pr
    on regexp_replace(lower(btrim(p.ksb_profile_source_id)), '^(profile|framework):', '') in (pr.k1, pr.k2)
union all
select 'module', m.module_catalogue_id, m.title, pr.name,
       case when (to_jsonb(m) ->> 'deleted_at') is not null then 'deleted'
            when coalesce((to_jsonb(m) ->> 'is_programme_deleted')::boolean, false) then 'programme deleted'
            when coalesce((to_jsonb(m) ->> 'is_archived')::boolean, false) then 'archived'
            else 'live' end
  from curriculum.modules m
  join profiles pr
    on regexp_replace(lower(btrim(m.ksb_profile_source_id)), '^(profile|framework):', '') in (pr.k1, pr.k2)
 order by kind desc, state, profile_name, record_name;
