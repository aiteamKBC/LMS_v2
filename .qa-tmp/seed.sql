-- Reference data for the isolated QA database only. Mirrors the column set
-- curriculum.standard_ksbs is read with in build_skills_england_standards().
create table if not exists curriculum.standard_ksbs (
  id serial primary key,
  standard_ref varchar(64),
  standard_version varchar(32),
  standard_title varchar(500),
  status varchar(64),
  level integer,
  degree varchar(64),
  route varchar(128),
  typical_duration varchar(64),
  minimum_hours_for_compliance varchar(64),
  maximum_funding varchar(64),
  lars_code varchar(64),
  eqa_provider varchar(255),
  source_url text,
  approved_for_delivery varchar(64),
  date_updated varchar(64),
  ksb_type varchar(32),
  ksb_code varchar(32),
  ksb_description text,
  created_at timestamp default current_timestamp,
  updated_at timestamp default current_timestamp
);

truncate curriculum.standard_ksbs;

-- Associate Project Manager, ST0310 v1.2 — a compact but realistic KSB set.
insert into curriculum.standard_ksbs
  (standard_ref, standard_version, standard_title, status, level, route,
   typical_duration, minimum_hours_for_compliance, maximum_funding, lars_code,
   eqa_provider, approved_for_delivery, date_updated, ksb_type, ksb_code, ksb_description)
select
  'ST0310', '1.2', 'Associate Project Manager', 'Approved for delivery', 4,
  'Business and administration', '24 months', '372', '£6000', '331',
  'Ofqual', 'true', '2026-01-15',
  t.ksb_type, t.ksb_code, t.ksb_description
from (values
  ('Knowledge','K1','Project governance: understands governance frameworks and the reporting lines of a project.'),
  ('Knowledge','K2','Project stakeholder management: identifies and analyses stakeholder interest and influence.'),
  ('Knowledge','K3','Project communication: understands the purpose of a communication plan.'),
  ('Knowledge','K4','Project leadership: understands leadership styles appropriate to project delivery.'),
  ('Knowledge','K5','Consolidated planning: understands how scope, schedule and cost interact.'),
  ('Knowledge','K6','Budgeting and cost control: understands cost breakdown structures and variance.'),
  ('Knowledge','K7','Business case and benefits management: understands how benefits are defined and tracked.'),
  ('Knowledge','K8','Project risk and issue management: understands risk identification and response options.'),
  ('Knowledge','K9','Quality management: understands quality planning, assurance and control.'),
  ('Knowledge','K10','Contract management and procurement: understands supplier selection and contract types.'),
  ('Skill','S1','Applies governance arrangements and escalates outside tolerance.'),
  ('Skill','S2','Maps stakeholders and tailors engagement to their needs.'),
  ('Skill','S3','Produces and maintains a communication plan.'),
  ('Skill','S4','Leads and motivates a project team through delivery.'),
  ('Skill','S5','Builds and maintains an integrated project plan.'),
  ('Skill','S6','Monitors and controls project budget and reports variance.'),
  ('Skill','S7','Contributes to the business case and tracks benefit realisation.'),
  ('Skill','S8','Maintains a risk and issue register and drives mitigation.'),
  ('Skill','S9','Applies quality management techniques to project deliverables.'),
  ('Skill','S10','Supports procurement activity and manages supplier performance.'),
  ('Behaviour','B1','Collaboration: works effectively with others across boundaries.'),
  ('Behaviour','B2','Drive for results: takes ownership and delivers to commitment.'),
  ('Behaviour','B3','Integrity and ethics: acts honestly and challenges poor practice.'),
  ('Behaviour','B4','Resilience: stays effective under pressure and adapts to change.'),
  ('Behaviour','B5','Commitment to professional development: reflects and seeks feedback.')
) as t(ksb_type, ksb_code, ksb_description);

-- A second standard so the wizard's standard picker has a real choice.
insert into curriculum.standard_ksbs
  (standard_ref, standard_version, standard_title, status, level, route,
   typical_duration, minimum_hours_for_compliance, maximum_funding, lars_code,
   eqa_provider, approved_for_delivery, date_updated, ksb_type, ksb_code, ksb_description)
select
  'ST0501', '1.1', 'Marketing Executive', 'Approved for delivery', 4,
  'Sales, marketing and procurement', '18 months', '288', '£11000', '452',
  'Ofqual', 'true', '2026-02-02',
  t.ksb_type, t.ksb_code, t.ksb_description
from (values
  ('Knowledge','K1','Marketing theory and the role of marketing within an organisation.'),
  ('Knowledge','K2','Customer segmentation, targeting and positioning.'),
  ('Knowledge','K3','Digital and offline marketing channels and their measurement.'),
  ('Knowledge','K4','Brand management and tone of voice.'),
  ('Skill','S1','Plans and delivers a marketing campaign to brief and budget.'),
  ('Skill','S2','Analyses campaign performance data and reports insight.'),
  ('Skill','S3','Writes and edits copy appropriate to channel and audience.'),
  ('Skill','S4','Manages agency and internal stakeholder relationships.'),
  ('Behaviour','B1','Curiosity: actively seeks market and customer insight.'),
  ('Behaviour','B2','Professionalism: works to ethical marketing standards.')
) as t(ksb_type, ksb_code, ksb_description);

-- Holidays give the cohort/group date pickers something to collide with.
insert into curriculum.holidays (id, label, start_date, end_date, type, color, created_at, updated_at)
select 'HOL-QA-001', 'Christmas closure', date '2026-12-21', date '2027-01-01', 'closure', '#ef4444', now(), now()
where exists (select 1 from information_schema.tables where table_schema='curriculum' and table_name='holidays')
on conflict do nothing;
