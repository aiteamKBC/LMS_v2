begin;

update curriculum.modules
set ksb_profile_source_id = regexp_replace(ksb_profile_source_id, '^(profile|framework):', '', 'i')
where ksb_profile_source_id ~* '^(profile|framework):';

update curriculum.programmes
set ksb_profile_source_id = regexp_replace(ksb_profile_source_id, '^(profile|framework):', '', 'i')
where ksb_profile_source_id ~* '^(profile|framework):';

commit;

