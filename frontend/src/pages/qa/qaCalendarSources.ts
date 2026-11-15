export interface Sample {
  id: string;
  type: string;
  scope: string;
  total: number;
  sampled: number;
  percentage: number;
  status: 'Scheduled' | 'In Progress' | 'Completed';
  officer: string;
  startDate: string;
  endDate: string;
  methodology: string;
}

export const INITIAL_SAMPLING_DATA: Sample[] = [
  { id: 'sp-01', type: 'Evidence', scope: 'All learners — Cohort B (DM)', total: 120, sampled: 18, percentage: 15, status: 'In Progress', officer: 'Emma Clarke', startDate: '1 Jun', endDate: '15 Jun', methodology: 'Stratified random — 15% of all evidence items' },
  { id: 'sp-02', type: 'OTJH', scope: 'All learners — Cohort A (BA)', total: 340, sampled: 34, percentage: 10, status: 'Scheduled', officer: '—', startDate: '15 Jun', endDate: '30 Jun', methodology: 'Systematic sampling — every 10th OTJH entry' },
  { id: 'sp-03', type: 'KSB', scope: 'High-risk learners only', total: 45, sampled: 12, percentage: 27, status: 'Completed', officer: 'QA Lead', startDate: '15 May', endDate: '31 May', methodology: 'Targeted — all high-risk KSBs' },
  { id: 'sp-04', type: 'Progress Reviews', scope: 'Cohort C (BA) — June 2026', total: 8, sampled: 3, percentage: 38, status: 'In Progress', officer: 'Emma Clarke', startDate: '5 Jun', endDate: '12 Jun', methodology: 'Random — 38% of all reviews' },
  { id: 'sp-05', type: 'Evidence', scope: 'Cohort A (BA) — Marketing Module', total: 56, sampled: 8, percentage: 14, status: 'Completed', officer: 'James Whitfield', startDate: '1 May', endDate: '15 May', methodology: 'Random — 14% of module evidence' },
  { id: 'sp-06', type: 'OTJH', scope: 'High-risk learners — Q2', total: 89, sampled: 22, percentage: 25, status: 'In Progress', officer: 'Emma Clarke', startDate: '1 Jun', endDate: '20 Jun', methodology: 'Targeted — 25% of flagged entries' },
  { id: 'sp-07', type: 'Module', scope: 'All published modules', total: 24, sampled: 6, percentage: 25, status: 'Scheduled', officer: '—', startDate: '1 Jul', endDate: '15 Jul', methodology: 'Random — 25% of curriculum modules' },
  { id: 'sp-08', type: 'Report', scope: 'Leadership reports — Q2', total: 12, sampled: 4, percentage: 33, status: 'Completed', officer: 'QA Lead', startDate: '15 May', endDate: '31 May', methodology: 'Random — 33% of quarterly reports' },
];

export interface QAFinding {
  id: string;
  title: string;
  category: string;
  severity: 'Critical' | 'Major' | 'Minor' | 'Observation';
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  raisedBy: string;
  date: string;
  description: string;
  actionPlan: string;
  owner: string;
  dueDate: string;
  daysRemaining: number;
}

export const FINDINGS_DATA: QAFinding[] = [
  { id: 'qf-01', title: 'Inconsistent KSB Assessment Criteria', category: 'KSB', severity: 'Major', status: 'In Progress', raisedBy: 'QA Lead', date: '5 Jun', description: 'Three assessors applied different minimum evidence thresholds for KSB validation. No standardised guidance exists.', actionPlan: 'Develop and publish standardised KSB assessment criteria. Train all assessors. Review all affected validations.', owner: 'Emma Clarke', dueDate: '20 Jun', daysRemaining: 14 },
  { id: 'qf-02', title: 'OTJH Verification Gaps', category: 'OTJH', severity: 'Critical', status: 'Open', raisedBy: 'QA Officer', date: '4 Jun', description: '25% of OTJH entries lack proper verification (attendance record or employer sign-off). Funding compliance risk.', actionPlan: 'Implement mandatory dual verification. Audit all Q2 OTJH entries. Update system validation rules.', owner: 'James Whitfield', dueDate: '18 Jun', daysRemaining: 12 },
  { id: 'qf-03', title: 'Module Version Control Missing', category: 'Module', severity: 'Minor', status: 'Resolved', raisedBy: 'QA Officer', date: '3 Jun', description: 'Two curriculum modules were updated without version control. Historical versions not recoverable.', actionPlan: 'Implement version control system. Train curriculum team. Review all module changes.', owner: 'Sarah Chen', dueDate: '10 Jun', daysRemaining: 0 },
  { id: 'qf-04', title: 'Progress Review Quality Variance', category: 'Progress', severity: 'Major', status: 'In Progress', raisedBy: 'QA Lead', date: '2 Jun', description: 'Progress review quality varies significantly between coaches. Some reviews lack actionable next steps.', actionPlan: 'Create review template with mandatory sections. QA all reviews for 2 months. Coach training on quality standards.', owner: 'Emma Clarke', dueDate: '30 Jun', daysRemaining: 24 },
  { id: 'qf-05', title: 'Evidence Pack Completeness', category: 'Evidence', severity: 'Minor', status: 'Open', raisedBy: 'QA Officer', date: '1 Jun', description: '12% of evidence submissions lack clear KSB linkage. Learners not consistently mapping evidence to standards.', actionPlan: 'Update submission guidance. Add KSB selector to upload flow. Review and retrain affected learners.', owner: 'David Thompson', dueDate: '15 Jun', daysRemaining: 9 },
  { id: 'qf-06', title: 'Employer Sign-off Delays', category: 'Compliance', severity: 'Observation', status: 'Closed', raisedBy: 'QA Officer', date: '31 May', description: 'Average employer sign-off time increased from 3 days to 8 days. No process change identified.', actionPlan: 'Monitor trend for another month. Review employer communication. Consider automated reminders.', owner: 'Priya Patel', dueDate: '30 Jun', daysRemaining: 24 },
  { id: 'qf-07', title: 'Sampling Coverage Below Target', category: 'Sampling', severity: 'Major', status: 'In Progress', raisedBy: 'QA Lead', date: '30 May', description: 'Q2 sampling achieved 8% coverage vs 15% target. High-risk learners underrepresented.', actionPlan: 'Increase Q3 sampling to 20%. Prioritise high-risk learners. Report to leadership.', owner: 'QA Lead', dueDate: '15 Jun', daysRemaining: 9 },
  { id: 'qf-08', title: 'Report Formatting Inconsistency', category: 'Report', severity: 'Observation', status: 'Resolved', raisedBy: 'QA Officer', date: '29 May', description: 'Internal reports use different formatting and branding standards. No template enforced.', actionPlan: 'Create standard report template. Update all authors. Review existing reports.', owner: 'James Whitfield', dueDate: '12 Jun', daysRemaining: 0 },
];
