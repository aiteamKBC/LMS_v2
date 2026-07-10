export const INTERNAL_PANEL_STATS = [
  { label: 'Total Learners', value: '248', icon: 'ri-group-line', color: 'accent', change: '+12 this month' },
  { label: 'Active Programmes', value: '12', icon: 'ri-stack-line', color: 'primary', change: '2 in development' },
  { label: 'Compliance Rate', value: '94%', icon: 'ri-shield-check-line', color: 'accent', change: '+2% vs last month' },
  { label: 'Coaches & Tutors', value: '26', icon: 'ri-user-heart-line', color: 'secondary', change: '18 coaches · 8 tutors' },
];

export const INTERNAL_PANEL_TILES = [
  {
    id: 'learners',
    header: 'Learner Management',
    color: '#1B8A8C',
    icon: 'ri-user-line',
    count: 248,
    tiles: [
      { label: 'All Learners', id: 'all-learners', icon: 'ri-user-line', description: 'View and manage all learner records, profiles, and statuses across all programmes.' },
      { label: 'Enrolment Queue', id: 'enrolment-queue', icon: 'ri-user-received-line', description: 'Review and process new learner enrolments waiting for approval and onboarding.' },
      { label: 'Pre-Active Learners', id: 'pre-active', icon: 'ri-user-add-line', description: 'Manage learners in the pre-active stage before they start their programme.' },
      { label: 'Gateway Ready', id: 'gateway', icon: 'ri-flag-line', description: 'Track learners approaching gateway and end-point assessment readiness.' },
      { label: 'Withdrawals', id: 'withdrawals', icon: 'ri-user-unfollow-line', description: 'Process learner withdrawals, record reasons, and manage exit procedures.' },
    ],
  },
  {
    id: 'compliance',
    header: 'Compliance & Onboarding',
    color: '#6B8E23',
    icon: 'ri-shield-check-line',
    count: 36,
    tiles: [
      { label: 'Eligibility Review', id: 'eligibility', icon: 'ri-checkbox-circle-line', description: 'Verify learner eligibility criteria including residency, funding, and prior attainment checks.' },
      { label: 'Employer Contracting', id: 'employer-contracting', icon: 'ri-file-text-line', description: 'Manage employer agreements, contracts, and commitment statements for apprenticeship programmes.' },
      { label: 'Enrolment Review', id: 'enrolment-review', icon: 'ri-search-eye-line', description: 'Audit enrolment data for accuracy and completeness before ILR submission.' },
      { label: 'Initial Assessment', id: 'initial-assessment', icon: 'ri-clipboard-line', description: 'Conduct BKSB assessments, learning style evaluations, and readiness scoring.' },
      { label: 'RPL Review', id: 'rpl-review', icon: 'ri-file-search-line', description: 'Evaluate recognition of prior learning claims and calculate programme duration reductions.' },
    ],
  },
  {
    id: 'coaches',
    header: 'Coaches & Tutors',
    color: '#D97A2E',
    icon: 'ri-user-heart-line',
    count: 18,
    tiles: [
      { label: 'Coach Caseload', id: 'caseload', icon: 'ri-group-line', description: 'View and manage coach caseloads, learner assignments, and workload distribution.' },
      { label: 'Marking Queue', id: 'marking-queue', icon: 'ri-edit-line', description: 'Process learner submissions, evidence uploads, and assessment marking tasks.' },
      { label: 'Coaching Meetings', id: 'meetings', icon: 'ri-calendar-check-line', description: 'Schedule and track monthly coaching sessions, progress reviews, and action plans.' },
      { label: 'Progress Reviews', id: 'progress-reviews', icon: 'ri-file-chart-line', description: 'Conduct formal quarterly progress reviews with learners and employers.' },
      { label: 'AI Marking', id: 'ai-marking', icon: 'ri-robot-line', description: 'Configure and review AI-assisted marking for learner submissions and evidence.' },
    ],
  },
  {
    id: 'employers',
    header: 'Employers & Funding',
    color: '#4A6FA5',
    icon: 'ri-building-2-line',
    count: 42,
    tiles: [
      { label: 'Employer List', id: 'employers', icon: 'ri-building-2-line', description: 'Browse and manage all employer organisations, contacts, and partnership details.' },
      { label: 'Apprentices', id: 'apprentices', icon: 'ri-star-line', description: 'Track apprentices by employer, monitor progress, and manage employer-specific cohorts.' },
      { label: 'OTJH Confirmation', id: 'otjh', icon: 'ri-time-line', description: 'Review and confirm off-the-job training hours logged by learners and employers.' },
      { label: 'Documents', id: 'documents', icon: 'ri-folder-line', description: 'Manage employer-related documents, agreements, insurance certificates, and policies.' },
      { label: 'Funding Overview', id: 'funding', icon: 'ri-money-pound-circle-line', description: 'Monitor funding allocations, drawdown schedules, and financial compliance per employer.' },
    ],
  },
  {
    id: 'mis',
    header: 'MIS & Operations',
    color: '#7B5EA7',
    icon: 'ri-database-2-line',
    count: 14,
    tiles: [
      { label: 'Cohorts', id: 'cohorts', icon: 'ri-group-line', description: 'Manage learner cohorts, start dates, planned end dates, and cohort-level reporting.' },
      { label: 'Learner Allocation', id: 'learner-allocation', icon: 'ri-user-add-line', description: 'Assign learners to coaches, tutors, and programme instances across the system.' },
      { label: 'Timetables', id: 'timetables', icon: 'ri-calendar-line', description: 'Create and manage session timetables, room bookings, and tutor schedules.' },
      { label: 'Data Quality', id: 'data-quality', icon: 'ri-database-2-line', description: 'Run data quality checks, identify ILR errors, and maintain data governance standards.' },
      { label: 'Teams Sessions', id: 'teams-sessions', icon: 'ri-video-line', description: 'Schedule and track Microsoft Teams sessions, attendance, and recording links.' },
    ],
  },
  {
    id: 'reports',
    header: 'Reports & Analytics',
    color: '#C75B8E',
    icon: 'ri-bar-chart-box-line',
    count: 47,
    tiles: [
      { label: 'Cohort Performance', id: 'cohort-performance', icon: 'ri-group-line', description: 'Analyse cohort-level performance metrics, achievement rates, and progress trends.' },
      { label: 'Attendance Trends', id: 'attendance-trends', icon: 'ri-line-chart-line', description: 'Track attendance patterns, identify at-risk learners, and generate attendance reports.' },
      { label: 'Compliance Risk', id: 'compliance-risk', icon: 'ri-shield-line', description: 'Monitor compliance risk indicators, audit readiness, and regulatory requirement status.' },
      { label: 'QA Sampling', id: 'qa-sampling', icon: 'ri-pie-chart-2-line', description: 'Generate QA sampling reports, track sampling rates, and review QA outcomes.' },
      { label: 'Audit Reports', id: 'audit-reports', icon: 'ri-history-line', description: 'Access historical audit reports, findings, actions, and compliance improvement plans.' },
    ],
  },
  {
    id: 'programmes',
    header: 'Programmes & Curriculum',
    color: '#1B8A8C',
    icon: 'ri-stack-line',
    count: 12,
    tiles: [
      { label: 'Programmes', id: 'programmes', icon: 'ri-stack-line', description: 'Manage apprenticeship programmes, standards, levels, and delivery models.' },
      { label: 'Standards', id: 'standards', icon: 'ri-file-list-3-line', description: 'Browse IfATE standards, import assessment plans, and map KSB requirements.' },
      { label: 'Module Builder', id: 'module-builder', icon: 'ri-layout-4-line', description: 'Design and build curriculum modules with learning objectives and assessments.' },
      { label: 'KSB Mapping', id: 'ksb-mapping', icon: 'ri-link', description: 'Map knowledge, skills, and behaviours to curriculum modules and assessment methods.' },
      { label: 'Question Bank', id: 'question-bank', icon: 'ri-questionnaire-line', description: 'Review, search, and reuse saved quiz questions across programmes.' },
    ],
  },
  {
    id: 'qa',
    header: 'QA & Auditing',
    color: '#D97A2E',
    icon: 'ri-search-eye-line',
    count: 22,
    tiles: [
      { label: 'Evidence QA', id: 'evidence', icon: 'ri-folder-upload-line', description: 'Quality assure learner evidence submissions, feedback quality, and assessment accuracy.' },
      { label: 'Module QA', id: 'module', icon: 'ri-stack-line', description: 'Review module-level quality indicators, consistency checks, and standardisation reports.' },
      { label: 'OTJH QA', id: 'otjh-qa', icon: 'ri-time-line', description: 'Quality assure off-the-job training hour logs and verify compliance with funding rules.' },
      { label: 'QA Findings', id: 'findings', icon: 'ri-search-eye-line', description: 'Record, track, and resolve QA findings with action plans and improvement tracking.' },
      { label: 'Escalations', id: 'escalations', icon: 'ri-alert-line', description: 'Manage escalated cases requiring senior review, intervention, or regulatory reporting.' },
    ],
  },
  {
    id: 'engagement',
    header: 'Engagement & Welfare',
    color: '#6B8E23',
    icon: 'ri-heart-pulse-line',
    count: 19,
    tiles: [
      { label: 'Attendance Risk', id: 'attendance-risk', icon: 'ri-alert-line', description: 'Identify learners at risk due to low attendance and trigger early intervention workflows.' },
      { label: 'Rewards Shop', id: 'rewards', icon: 'ri-shopping-bag-3-line', description: 'Manage learner rewards catalogue, point allocations, and redemption approvals.' },
      { label: 'Events', id: 'events', icon: 'ri-calendar-event-line', description: 'Create and manage learner events, workshops, clubs, and enrichment activities.' },
      { label: 'Communication', id: 'communication', icon: 'ri-message-2-line', description: 'Send bulk communications, announcements, and targeted messages to learner groups.' },
      { label: 'Call Logs', id: 'call-logs', icon: 'ri-phone-line', description: 'Record and review learner contact logs, welfare calls, and intervention communications.' },
    ],
  },
  {
    id: 'finance',
    header: 'Finance & Budgets',
    color: '#4A6FA5',
    icon: 'ri-money-pound-circle-line',
    count: 8,
    tiles: [
      { label: 'Invoicing', id: 'invoices', icon: 'ri-bill-line', description: 'Generate and manage employer invoices, payment schedules, and financial reconciliation.' },
      { label: 'Payments', id: 'payments', icon: 'ri-money-pound-circle-line', description: 'Track payments received, outstanding balances, and financial reporting per employer.' },
      { label: 'Budgets', id: 'budgets', icon: 'ri-pie-chart-2-line', description: 'Manage programme budgets, cost centres, and financial forecasting for delivery.' },
      { label: 'Finance Reports', id: 'finance-reports', icon: 'ri-bar-chart-box-line', description: 'Generate financial reports, funding claims, and ESFA submission summaries.' },
      { label: 'Funding Rules', id: 'funding-rules', icon: 'ri-book-open-line', description: 'Reference current funding rules, eligibility criteria, and compliance requirements.' },
    ],
  },
  {
    id: 'settings',
    header: 'System & Admin',
    color: '#7B5EA7',
    icon: 'ri-settings-3-line',
    count: 5,
    tiles: [
      { label: 'Users & Roles', id: 'users', icon: 'ri-user-settings-line', description: 'Manage system users, role assignments, permissions, and access control policies.' },
      { label: 'Permissions', id: 'permissions', icon: 'ri-key-2-line', description: 'Configure granular permissions for roles, modules, and actions across the platform.' },
      { label: 'Automations', id: 'automations', icon: 'ri-settings-4-line', description: 'Set up automated workflows, triggers, notifications, and scheduled system tasks.' },
      { label: 'AI Settings', id: 'ai-settings', icon: 'ri-robot-line', description: 'Configure AI model preferences, marking thresholds, and intelligent automation parameters.' },
      { label: 'System Config', id: 'system', icon: 'ri-settings-3-line', description: 'Manage global system settings, integrations, branding, and platform configuration.' },
    ],
  },
  {
    id: 'tutor',
    header: 'Tutor & Delivery',
    color: '#C75B8E',
    icon: 'ri-presentation-line',
    count: 0,
    tiles: [
      { label: 'Teaching Sessions', id: 'sessions', icon: 'ri-presentation-line', description: 'View and manage teaching sessions, lesson plans, and delivery schedules.' },
      { label: 'Evidence Review', id: 'evidence-review', icon: 'ri-file-search-line', description: 'Review learner evidence submissions, provide feedback, and validate completion.' },
      { label: 'Assignment Marking', id: 'assignment-marking', icon: 'ri-edit-line', description: 'Mark learner assignments, provide grades and feedback, and track completion.' },
      { label: 'Quiz Results', id: 'quiz-results', icon: 'ri-bar-chart-line', description: 'View quiz results, analyse performance trends, and identify knowledge gaps.' },
      { label: 'Resources', id: 'resources', icon: 'ri-folder-line', description: 'Access teaching resources, materials, lesson plans, and delivery guides.' },
    ],
  },
];

export const HOW_TO_STEPS = [
  {
    title: 'Select a Category',
    description: 'Click on any coloured tile header to expand or collapse the section. Each colour represents a different area of the system.',
  },
  {
    title: 'Navigate to Tools',
    description: 'Click on any sub-tile to open its detail view inside this panel. Everything stays here — no external navigation.',
  },
  {
    title: 'Search Quickly',
    description: 'Use the search bar at the top to filter categories and tools by name. Start typing to see matching results instantly.',
  },
  {
    title: 'Create Custom Pages',
    description: 'Use the "Create Page" button to build your own data entry forms with multiple field types. All pages save automatically.',
  },
  {
    title: 'Audio Assistant',
    description: 'Click the speaker icon on any tile to hear a description of the tool read aloud. Great for accessibility.',
  },
  {
    title: 'Edit & Delete Pages',
    description: 'Click the pencil icon on any custom page card to edit its fields. Changes are saved instantly to your browser.',
  },
];

export interface CustomPageField {
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options?: string;
}

export interface CustomPage {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  fields: CustomPageField[];
}

const STORAGE_KEY = 'kbc_internal_panel_custom_pages';

export function loadCustomPages(): CustomPage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // corrupted data — fall back to default
  }
  return DEFAULT_CUSTOM_PAGES;
}

export function saveCustomPages(pages: CustomPage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
  } catch {
    // storage full or unavailable
  }
}

const DEFAULT_CUSTOM_PAGES: CustomPage[] = [
  {
    id: 'custom-1',
    title: 'Learner Intake Form',
    description: 'Initial intake data for new apprentices',
    category: 'Learners',
    icon: 'ri-user-add-line',
    color: '#1B8A8C',
    fields: [
      { label: 'Full Name', type: 'text' },
      { label: 'Date of Birth', type: 'date' },
      { label: 'Programme', type: 'select', options: 'Business Admin,Digital Marketing,Software Development,Healthcare' },
      { label: 'Employer Name', type: 'text' },
    ],
  },
  {
    id: 'custom-2',
    title: 'Employer Feedback',
    description: 'Monthly employer feedback collection',
    category: 'Employers',
    icon: 'ri-building-2-line',
    color: '#4A6FA5',
    fields: [
      { label: 'Employer Name', type: 'text' },
      { label: 'Apprentice Name', type: 'text' },
      { label: 'Progress Rating', type: 'select', options: 'Excellent,Good,Satisfactory,Needs Improvement,Unsatisfactory' },
      { label: 'Feedback Notes', type: 'textarea' },
    ],
  },
  {
    id: 'custom-3',
    title: 'Session Attendance',
    description: 'Quick attendance logging for sessions',
    category: 'MIS',
    icon: 'ri-calendar-check-line',
    color: '#7B5EA7',
    fields: [
      { label: 'Session Name', type: 'text' },
      { label: 'Session Date', type: 'date' },
      { label: 'Number of Attendees', type: 'number' },
      { label: 'Session Notes', type: 'textarea' },
    ],
  },
];
