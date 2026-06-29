export interface RecentItem {
  id: string;
  label: string;
  subtitle: string;
  icon: string;
  href: string;
  category: 'learner' | 'employer' | 'cohort' | 'report';
}

export const RECENT_LEARNERS: RecentItem[] = [
  { id: 'rl_001', label: 'Sarah Mitchell', subtitle: 'Business Admin L3 · Cohort C', icon: 'ri-user-line', href: '/learners/sarah-mitchell', category: 'learner' },
  { id: 'rl_002', label: 'James Okonkwo', subtitle: 'Digital Marketing L3 · Cohort B', icon: 'ri-user-line', href: '/learners/james-okonkwo', category: 'learner' },
  { id: 'rl_003', label: 'Emily Watson', subtitle: 'Business Admin L3 · Cohort A', icon: 'ri-user-line', href: '/learners/emily-watson', category: 'learner' },
  { id: 'rl_004', label: 'Aisha Patel', subtitle: 'Leadership L5 · Cohort E', icon: 'ri-user-line', href: '/learners/aisha-patel', category: 'learner' },
];

export const RECENT_EMPLOYERS: RecentItem[] = [
  { id: 're_001', label: 'Kent County Council', subtitle: '14 active apprentices', icon: 'ri-building-line', href: '/employers/kcc', category: 'employer' },
  { id: 're_002', label: 'Medway NHS Trust', subtitle: '8 active apprentices', icon: 'ri-building-line', href: '/employers/medway-nhs', category: 'employer' },
  { id: 're_003', label: 'TechKent Ltd', subtitle: '6 active apprentices', icon: 'ri-building-line', href: '/employers/techkent', category: 'employer' },
];

export const RECENT_COHORTS: RecentItem[] = [
  { id: 'rc_001', label: 'Cohort A — Business Admin L3', subtitle: '12 learners · Started Sep 2025', icon: 'ri-group-line', href: '/cohorts/cohort-a', category: 'cohort' },
  { id: 'rc_002', label: 'Cohort B — Digital Marketing', subtitle: '10 learners · Started Jan 2026', icon: 'ri-group-line', href: '/cohorts/cohort-b', category: 'cohort' },
  { id: 'rc_003', label: 'Cohort C — Business Admin L3', subtitle: '8 learners · Started Mar 2026', icon: 'ri-group-line', href: '/cohorts/cohort-c', category: 'cohort' },
];

export const RECENT_REPORTS: RecentItem[] = [
  { id: 'rr_001', label: 'Q2 Progress Summary', subtitle: 'Generated 05/06/2026 · All cohorts', icon: 'ri-bar-chart-box-line', href: '/reports/q2-progress', category: 'report' },
  { id: 'rr_002', label: 'OTJH Compliance Report', subtitle: 'Generated 01/06/2026 · Cohort A-C', icon: 'ri-file-chart-line', href: '/reports/otjh-compliance', category: 'report' },
  { id: 'rr_003', label: 'At-Risk Learner Register', subtitle: 'Generated 03/06/2026 · 5 learners flagged', icon: 'ri-alert-line', href: '/reports/at-risk', category: 'report' },
];