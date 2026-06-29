export interface ReportMetric {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface ReportTable {
  headers: string[];
  rows: string[][];
}

export interface ReportSection {
  title: string;
  content?: string;
  metrics?: ReportMetric[];
  table?: ReportTable;
  chart?: ReportChart;
  findings?: string[];
  recommendations?: string[];
}

export interface ReportChart {
  type: 'bar' | 'line' | 'stacked';
  labels: string[];
  datasets: { label: string; values: number[]; color: string }[];
}

export interface GeneratedReport {
  id: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  period: string;
  coach: string;
  sections: ReportSection[];
}

const COLORS = {
  primary: '#0d7a6e',
  accent: '#d97706',
  secondary: '#64748b',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#f59e0b',
};

function today(): string {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function period(): string {
  return '1 Jun 2026 - 23 Jun 2026';
}

export const GENERATED_REPORTS: Record<string, GeneratedReport> = {
  'cr-01': {
    id: 'cr-01',
    title: 'Caseload Progress Summary',
    subtitle: 'Comprehensive overview of all learners in your caseload',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Executive Summary',
        content: 'This report covers 12 active learners across 4 cohorts. Overall caseload health is good with 83% average attendance and 62% average KSB completion. 2 learners are flagged for attention.',
        metrics: [
          { label: 'Active Learners', value: '12', change: '+1 vs last month', trend: 'up' },
          { label: 'Avg Attendance', value: '83%', change: '-2% vs last month', trend: 'down' },
          { label: 'Avg KSB Progress', value: '62%', change: '+4% vs last month', trend: 'up' },
          { label: 'At Risk', value: '2', change: 'Same as last month', trend: 'neutral' },
        ],
      },
      {
        title: 'Learner Overview',
        table: {
          headers: ['Learner', 'Programme', 'Cohort', 'Attendance', 'KSB %', 'OTJH %', 'Status'],
          rows: [
            ['Sarah Johnson', 'Marketing Executive L4', 'MKT-L4-2025A', '94%', '72%', '68%', 'On Track'],
            ['James Chen', 'Data Analyst L4', 'DA-L4-2025A', '96%', '80%', '75%', 'On Track'],
            ['Aisha Patel', 'Project Manager L4', 'PM-L4-2025A', '88%', '65%', '60%', 'On Track'],
            ['Oliver Brown', 'Business Admin L3', 'BA-L3-2025A', '91%', '58%', '55%', 'On Track'],
            ['Emma Wilson', 'Digital Marketer L3', 'DM-L3-2025A', '85%', '50%', '48%', 'On Track'],
            ['Liam Davis', 'Software Developer L4', 'SD-L4-2025A', '78%', '45%', '42%', 'At Risk'],
            ['Sophia Martinez', 'HR Consultant L5', 'HR-L5-2025A', '92%', '68%', '65%', 'On Track'],
            ['Noah Taylor', 'Accountancy L3', 'ACC-L3-2025A', '87%', '55%', '52%', 'On Track'],
            ['Mia Anderson', 'Marketing Executive L4', 'MKT-L4-2025B', '90%', '60%', '56%', 'On Track'],
            ['Lucas Thomas', 'Data Analyst L4', 'DA-L4-2025A', '82%', '48%', '45%', 'At Risk'],
            ['Isabella White', 'Business Admin L3', 'BA-L3-2025B', '89%', '52%', '50%', 'On Track'],
            ['Ethan Harris', 'Project Manager L4', 'PM-L4-2025A', '86%', '58%', '54%', 'On Track'],
          ],
        },
      },
      {
        title: 'Cohort Performance',
        chart: {
          type: 'bar',
          labels: ['MKT-L4', 'DA-L4', 'PM-L4', 'BA-L3', 'DM-L3', 'SD-L4', 'HR-L5', 'ACC-L3'],
          datasets: [
            { label: 'Attendance %', values: [92, 89, 87, 90, 85, 78, 92, 87], color: COLORS.primary },
            { label: 'KSB %', values: [66, 64, 62, 55, 50, 45, 68, 55], color: COLORS.accent },
          ],
        },
      },
      {
        title: 'Key Findings',
        findings: [
          'Software Developer L4 cohort has the lowest attendance at 78% — investigate technical barriers',
          '2 learners (Liam Davis, Lucas Thomas) are below 50% KSB completion — schedule coaching interventions',
          'Marketing Executive L4 cohort is leading with 92% attendance and 66% KSB progress',
          '3 learners have employer confirmation pending for OTJH — follow up required',
        ],
      },
      {
        title: 'Recommendations',
        recommendations: [
          'Schedule 1-to-1 coaching sessions for Liam Davis and Lucas Thomas within 5 days',
          'Review delivery schedule for Software Developer L4 cohort — consider flexible session times',
          'Contact employers for the 3 learners with pending OTJH confirmation',
          'Celebrate the Marketing Executive L4 cohort success in next team meeting',
        ],
      },
    ],
  },

  'cr-02': {
    id: 'cr-02',
    title: 'At-risk Learner Report',
    subtitle: 'Detailed breakdown of at-risk learners with intervention tracking',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Risk Summary',
        content: '2 learners are currently flagged as at-risk. 1 new flag this month, 1 resolved from last month.',
        metrics: [
          { label: 'At Risk', value: '2', change: '1 new this month', trend: 'neutral' },
          { label: 'Resolved', value: '1', change: '1 from last month', trend: 'up' },
          { label: 'Interventions', value: '5', change: '+2 this month', trend: 'up' },
          { label: 'Escalations', value: '0', change: 'No escalations', trend: 'neutral' },
        ],
      },
      {
        title: 'At-risk Learners',
        table: {
          headers: ['Learner', 'Programme', 'Risk Flags', 'Last Attendance', 'KSB %', 'Interventions', 'Days Since Contact'],
          rows: [
            ['Liam Davis', 'Software Developer L4', 'Attendance, Low KSB', '78%', '45%', '2', '3'],
            ['Lucas Thomas', 'Data Analyst L4', 'Low KSB, Employer Issues', '82%', '48%', '3', '5'],
          ],
        },
      },
      {
        title: 'Intervention History',
        table: {
          headers: ['Date', 'Learner', 'Type', 'Outcome', 'Status'],
          rows: [
            ['18 Jun 2026', 'Liam Davis', '1-to-1 Coaching', 'Identified technical barriers', 'In Progress'],
            ['15 Jun 2026', 'Lucas Thomas', 'Employer Call', 'Manager agreed to support', 'In Progress'],
            ['12 Jun 2026', 'Lucas Thomas', 'KSB Review', 'Created catch-up plan', 'In Progress'],
            ['10 Jun 2026', 'Liam Davis', 'Attendance Meeting', 'Committed to improve', 'Monitoring'],
            ['8 Jun 2026', 'Lucas Thomas', '1-to-1 Coaching', 'Discussed work-life balance', 'Monitoring'],
          ],
        },
      },
      {
        title: 'Risk Trend Analysis',
        chart: {
          type: 'line',
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [
            { label: 'At Risk Count', values: [1, 2, 3, 2, 2, 2], color: COLORS.danger },
            { label: 'Interventions', values: [2, 3, 4, 4, 3, 5], color: COLORS.primary },
          ],
        },
      },
      {
        title: 'Immediate Actions Required',
        recommendations: [
          'Contact Liam Davis today — 3 days since last contact, attendance dropped to 78%',
          'Schedule follow-up employer call for Lucas Thomas within 2 days',
          'Review catch-up plan for Lucas Thomas — KSB progress still at 48%',
          'Consider escalating Liam Davis if attendance drops below 75%',
        ],
      },
    ],
  },

  'cr-03': {
    id: 'cr-03',
    title: 'OTJH Compliance Report',
    subtitle: 'Off-the-job training hours tracking and compliance status',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Compliance Overview',
        content: 'Overall OTJH compliance is at 73% across the caseload. 4 learners are below target pace. 3 employer confirmations are pending.',
        metrics: [
          { label: 'Avg Compliance', value: '73%', change: '+2% vs target', trend: 'up' },
          { label: 'Below Target', value: '4', change: '2 new this month', trend: 'down' },
          { label: 'Pending Confirm', value: '3', change: '1 resolved', trend: 'neutral' },
          { label: 'Total Hours Logged', value: '1,842', change: '+156 this month', trend: 'up' },
        ],
      },
      {
        title: 'Learner OTJH Details',
        table: {
          headers: ['Learner', 'Programme', 'Required Hours', 'Logged Hours', 'Remaining', 'Compliance %', 'Employer Confirm'],
          rows: [
            ['Sarah Johnson', 'Marketing Executive L4', '1,200', '816', '384', '68%', 'Confirmed'],
            ['James Chen', 'Data Analyst L4', '1,200', '900', '300', '75%', 'Confirmed'],
            ['Aisha Patel', 'Project Manager L4', '1,200', '720', '480', '60%', 'Confirmed'],
            ['Oliver Brown', 'Business Admin L3', '1,000', '550', '450', '55%', 'Pending'],
            ['Emma Wilson', 'Digital Marketer L3', '1,000', '480', '520', '48%', 'Pending'],
            ['Liam Davis', 'Software Developer L4', '1,200', '504', '696', '42%', 'Pending'],
            ['Sophia Martinez', 'HR Consultant L5', '1,400', '910', '490', '65%', 'Confirmed'],
            ['Noah Taylor', 'Accountancy L3', '1,000', '520', '480', '52%', 'Confirmed'],
            ['Mia Anderson', 'Marketing Executive L4', '1,200', '672', '528', '56%', 'Confirmed'],
            ['Lucas Thomas', 'Data Analyst L4', '1,200', '540', '660', '45%', 'Confirmed'],
            ['Isabella White', 'Business Admin L3', '1,000', '500', '500', '50%', 'Confirmed'],
            ['Ethan Harris', 'Project Manager L4', '1,200', '648', '552', '54%', 'Confirmed'],
          ],
        },
      },
      {
        title: 'Monthly Hours Trend',
        chart: {
          type: 'bar',
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [
            { label: 'Hours Logged', values: [280, 295, 310, 305, 296, 356], color: COLORS.primary },
            { label: 'Target Hours', values: [300, 300, 300, 300, 300, 300], color: COLORS.secondary },
          ],
        },
      },
      {
        title: 'Shortfall Alerts',
        findings: [
          'Liam Davis is at 42% compliance — 696 hours remaining, highest risk for EPA timeline',
          'Emma Wilson at 48% — employer confirmation pending, may affect funding claims',
          'Oliver Brown at 55% — employer confirmation pending since 15 May 2026',
          '4 learners need to log an average of 32+ hours/week to meet programme deadlines',
        ],
      },
      {
        title: 'Compliance Actions',
        recommendations: [
          'Chase employer confirmations for Oliver Brown, Emma Wilson, and Liam Davis immediately',
          'Create accelerated OTJH plan for Liam Davis — 696 hours in 8 months = 22 hrs/week',
          'Review Emma Wilson\'s portfolio — 48% compliance may trigger funding audit',
          'Set weekly OTJH check-ins for the 4 learners below 55% compliance',
        ],
      },
    ],
  },

  'cr-04': {
    id: 'cr-04',
    title: 'Attendance & Catch-up Report',
    subtitle: 'Session attendance, absence patterns and catch-up completion',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Attendance Summary',
        content: 'Caseload attendance rate is 83% this month. 6 sessions missed across 4 learners. 4 catch-up sessions completed, 2 still pending.',
        metrics: [
          { label: 'Attendance Rate', value: '83%', change: '-2% vs last month', trend: 'down' },
          { label: 'Sessions Missed', value: '6', change: '+2 vs last month', trend: 'down' },
          { label: 'Catch-ups Done', value: '4', change: '2 pending', trend: 'neutral' },
          { label: 'Absence Reports', value: '3', change: '1 unapproved', trend: 'neutral' },
        ],
      },
      {
        title: 'Missed Sessions',
        table: {
          headers: ['Date', 'Learner', 'Session', 'Reason', 'Catch-up', 'Status'],
          rows: [
            ['20 Jun 2026', 'Liam Davis', 'SD Module 3', 'Sick Leave', 'Scheduled 27 Jun', 'Pending'],
            ['18 Jun 2026', 'Lucas Thomas', 'DA Workshop 4', 'Work Conflict', 'Completed 22 Jun', 'Done'],
            ['15 Jun 2026', 'Oliver Brown', 'BA Session 8', 'No Show', 'Scheduled 29 Jun', 'Pending'],
            ['12 Jun 2026', 'Liam Davis', 'SD Workshop 2', 'Sick Leave', 'Completed 19 Jun', 'Done'],
            ['10 Jun 2026', 'Emma Wilson', 'DM Session 5', 'Work Conflict', 'Completed 17 Jun', 'Done'],
            ['8 Jun 2026', 'Lucas Thomas', 'DA Module 6', 'Travel Issues', 'Completed 15 Jun', 'Done'],
          ],
        },
      },
      {
        title: 'Attendance Trends',
        chart: {
          type: 'line',
          labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
          datasets: [
            { label: 'Present', values: [42, 40, 38, 41], color: COLORS.success },
            { label: 'Absent', values: [3, 5, 7, 4], color: COLORS.danger },
            { label: 'Catch-up', values: [2, 3, 4, 3], color: COLORS.accent },
          ],
        },
      },
      {
        title: 'Patterns & Insights',
        findings: [
          'Liam Davis has 2 sick leave absences in 2 weeks — may need wellbeing check',
          'Work conflict is the top reason for absence (3 cases) — review employer agreements',
          'Catch-up completion rate is 67% — 2 sessions still pending past 7 days',
          'Oliver Brown had 1 unapproved absence — follow up required',
        ],
      },
      {
        title: 'Catch-up Actions',
        recommendations: [
          'Confirm catch-up for Liam Davis on 27 Jun and Oliver Brown on 29 Jun',
          'Conduct wellbeing check for Liam Davis — 2 sick leaves in 2 weeks',
          'Review employer flexibility for Emma Wilson and Lucas Thomas (work conflicts)',
          'Set automatic catch-up scheduling for unapproved absences',
        ],
      },
    ],
  },

  'cr-05': {
    id: 'cr-05',
    title: 'Intervention Log',
    subtitle: 'Complete history of coaching interventions and outcomes',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Intervention Summary',
        content: '5 interventions logged this month across 3 learners. 3 in progress, 2 completed, 0 escalated.',
        metrics: [
          { label: 'This Month', value: '5', change: '+2 vs last month', trend: 'up' },
          { label: 'In Progress', value: '3', change: '2 from last month', trend: 'neutral' },
          { label: 'Completed', value: '2', change: '1 resolved this month', trend: 'up' },
          { label: 'Success Rate', value: '67%', change: '+5% vs last month', trend: 'up' },
        ],
      },
      {
        title: 'All Interventions',
        table: {
          headers: ['Date', 'Learner', 'Type', 'Issue', 'Action Taken', 'Outcome', 'Status'],
          rows: [
            ['18 Jun 2026', 'Liam Davis', '1-to-1', 'Low attendance', 'Technical barriers identified', 'In Progress', 'Open'],
            ['15 Jun 2026', 'Lucas Thomas', 'Employer Call', 'Low KSB', 'Manager agreed support', 'In Progress', 'Open'],
            ['12 Jun 2026', 'Lucas Thomas', 'KSB Review', 'Low KSB', 'Catch-up plan created', 'In Progress', 'Open'],
            ['10 Jun 2026', 'Liam Davis', 'Attendance Meeting', 'Low attendance', 'Committed to improve', 'Completed', 'Closed'],
            ['8 Jun 2026', 'Lucas Thomas', '1-to-1', 'Work-life balance', 'Flexible schedule agreed', 'Completed', 'Closed'],
            ['5 Jun 2026', 'Emma Wilson', 'Portfolio Review', 'Slow progress', 'Evidence gaps identified', 'Completed', 'Closed'],
            ['2 Jun 2026', 'Oliver Brown', 'Employer Call', 'OTJH pending', 'Manager will confirm', 'In Progress', 'Open'],
          ],
        },
      },
      {
        title: 'Intervention Types',
        chart: {
          type: 'bar',
          labels: ['1-to-1', 'Employer Call', 'KSB Review', 'Portfolio Review', 'Attendance Meeting'],
          datasets: [
            { label: 'Count', values: [2, 2, 1, 1, 1], color: COLORS.primary },
          ],
        },
      },
      {
        title: 'Key Outcomes',
        findings: [
          'Lucas Thomas has 3 active interventions — highest support needed',
          'Employer calls are effective — 2 out of 2 resulted in manager agreement',
          '1-to-1 coaching shows 80% success rate for attendance issues',
          '2 interventions still open after 7 days — review action timelines',
        ],
      },
      {
        title: 'Next Steps',
        recommendations: [
          'Close Liam Davis attendance intervention if 2 sessions attended consecutively',
          'Follow up on Lucas Thomas employer support agreement within 3 days',
          'Schedule Oliver Brown follow-up call — employer confirmation still pending',
          'Document all outcomes in learner case files for audit trail',
        ],
      },
    ],
  },

  'cr-06': {
    id: 'cr-06',
    title: 'KSB Progress by Learner',
    subtitle: 'Knowledge, Skills and Behaviours progression tracking',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'KSB Summary',
        content: 'Average KSB completion across caseload is 62%. Knowledge leads at 65%, Skills at 58%, Behaviours at 54%. 2 learners below 50%.',
        metrics: [
          { label: 'Avg KSB', value: '62%', change: '+4% vs last month', trend: 'up' },
          { label: 'Knowledge', value: '65%', change: '+3% vs last month', trend: 'up' },
          { label: 'Skills', value: '58%', change: '+4% vs last month', trend: 'up' },
          { label: 'Behaviours', value: '54%', change: '+5% vs last month', trend: 'up' },
        ],
      },
      {
        title: 'Learner KSB Breakdown',
        table: {
          headers: ['Learner', 'Programme', 'Knowledge', 'Skills', 'Behaviours', 'Overall', 'Gateway Ready'],
          rows: [
            ['Sarah Johnson', 'Marketing Executive L4', '75%', '70%', '68%', '72%', 'No'],
            ['James Chen', 'Data Analyst L4', '82%', '78%', '75%', '80%', 'No'],
            ['Aisha Patel', 'Project Manager L4', '68%', '65%', '62%', '65%', 'No'],
            ['Oliver Brown', 'Business Admin L3', '60%', '58%', '55%', '58%', 'No'],
            ['Emma Wilson', 'Digital Marketer L3', '55%', '50%', '48%', '50%', 'No'],
            ['Liam Davis', 'Software Developer L4', '48%', '45%', '42%', '45%', 'No'],
            ['Sophia Martinez', 'HR Consultant L5', '70%', '68%', '65%', '68%', 'No'],
            ['Noah Taylor', 'Accountancy L3', '58%', '55%', '52%', '55%', 'No'],
            ['Mia Anderson', 'Marketing Executive L4', '62%', '60%', '58%', '60%', 'No'],
            ['Lucas Thomas', 'Data Analyst L4', '50%', '48%', '45%', '48%', 'No'],
            ['Isabella White', 'Business Admin L3', '54%', '52%', '50%', '52%', 'No'],
            ['Ethan Harris', 'Project Manager L4', '60%', '58%', '56%', '58%', 'No'],
          ],
        },
      },
      {
        title: 'KSB Trends',
        chart: {
          type: 'stacked',
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [
            { label: 'Knowledge', values: [28, 34, 40, 46, 52, 58], color: COLORS.primary },
            { label: 'Skills', values: [24, 30, 36, 42, 48, 54], color: COLORS.accent },
            { label: 'Behaviours', values: [20, 25, 30, 36, 42, 48], color: COLORS.secondary },
          ],
        },
      },
      {
        title: 'Gateway Readiness',
        findings: [
          'No learners are currently gateway ready — highest KSB is 80% (James Chen)',
          'James Chen is closest to gateway — needs 20% more across all KSBs',
          'Liam Davis and Lucas Thomas are below 50% — not expected to reach gateway on time',
          'Behaviours category is the weakest overall at 54% average',
        ],
      },
      {
        title: 'KSB Action Plan',
        recommendations: [
          'Focus coaching on Behaviours KSB — lowest category at 54%',
          'Create accelerated KSB plan for Liam Davis and Lucas Thomas',
          'Gateway readiness review for James Chen in 6 weeks',
          'Portfolio evidence review for all learners above 65% overall',
        ],
      },
    ],
  },

  'cr-07': {
    id: 'cr-07',
    title: 'Monthly Coaching Summary',
    subtitle: 'Summary of all coaching activities for June 2026',
    generatedAt: today(),
    period: '1 Jun 2026 - 30 Jun 2026',
    coach: 'Med Maher',
    sections: [
      {
        title: 'Coaching Activity',
        content: 'You conducted 18 coaching sessions, 3 progress reviews, and 6 employer contacts this month. Total coaching time: 24 hours.',
        metrics: [
          { label: 'Coaching Sessions', value: '18', change: '+3 vs last month', trend: 'up' },
          { label: 'Progress Reviews', value: '3', change: 'Same as last month', trend: 'neutral' },
          { label: 'Employer Contacts', value: '6', change: '+2 vs last month', trend: 'up' },
          { label: 'Coaching Hours', value: '24', change: '+4 hrs', trend: 'up' },
        ],
      },
      {
        title: 'Session Breakdown',
        table: {
          headers: ['Date', 'Learner', 'Type', 'Duration', 'Topic', 'Outcome'],
          rows: [
            ['22 Jun 2026', 'Sarah Johnson', '1-to-1', '45 min', 'KSB review', 'Completed 3 KSBs'],
            ['20 Jun 2026', 'James Chen', 'Progress Review', '60 min', 'Monthly check', 'On track'],
            ['18 Jun 2026', 'Liam Davis', '1-to-1', '45 min', 'Attendance', 'Action plan created'],
            ['15 Jun 2026', 'Lucas Thomas', 'Employer Call', '30 min', 'Support', 'Manager agreed'],
            ['14 Jun 2026', 'Aisha Patel', '1-to-1', '45 min', 'Portfolio', 'Evidence gaps found'],
            ['12 Jun 2026', 'Lucas Thomas', 'KSB Review', '45 min', 'Catch-up', 'Plan created'],
            ['10 Jun 2026', 'Liam Davis', 'Attendance', '30 min', 'Follow-up', 'Committed'],
            ['8 Jun 2026', 'Lucas Thomas', '1-to-1', '45 min', 'Wellbeing', 'Flexible schedule'],
            ['5 Jun 2026', 'Emma Wilson', 'Portfolio', '45 min', 'Evidence', 'Gaps identified'],
            ['3 Jun 2026', 'Oliver Brown', 'Employer Call', '30 min', 'OTJH', 'Pending confirm'],
          ],
        },
      },
      {
        title: 'Coaching Distribution',
        chart: {
          type: 'bar',
          labels: ['1-to-1', 'Progress Review', 'Employer Call', 'Portfolio', 'KSB Review', 'Attendance'],
          datasets: [
            { label: 'Hours', values: [6.75, 3, 3, 2.25, 1.5, 1.5], color: COLORS.primary },
          ],
        },
      },
      {
        title: 'Outcomes',
        findings: [
          'Lucas Thomas received 3 sessions this month — highest coaching time investment',
          'Employer calls averaged 30 min and achieved 100% agreement rate',
          '1-to-1 sessions are your most frequent activity (45% of total time)',
          '3 progress reviews completed — all learners assessed as on track',
        ],
      },
      {
        title: 'Next Month Plan',
        recommendations: [
          'Schedule 2 additional sessions for Liam Davis — attendance still flagged',
          'Progress review for Lucas Thomas — 3 interventions need assessment',
          'Employer contact for Oliver Brown — OTJH confirmation pending since 3 Jun',
          'Plan group coaching session for Marketing Executive cohort — all doing well',
        ],
      },
    ],
  },

  'cr-08': {
    id: 'cr-08',
    title: 'Employer Engagement Report',
    subtitle: 'Employer contacts, meetings and actions summary',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Engagement Summary',
        content: '6 employer contacts this month across 5 employer accounts. 4 meetings, 2 calls. All actions documented. 2 confirmations pending.',
        metrics: [
          { label: 'Contacts', value: '6', change: '+2 vs last month', trend: 'up' },
          { label: 'Meetings', value: '4', change: '+1 vs last month', trend: 'up' },
          { label: 'Pending Actions', value: '2', change: '1 from last month', trend: 'neutral' },
          { label: 'Avg Response', value: '3 days', change: '-1 day', trend: 'up' },
        ],
      },
      {
        title: 'Employer Contact Log',
        table: {
          headers: ['Date', 'Employer', 'Contact', 'Method', 'Topic', 'Action', 'Status'],
          rows: [
            ['20 Jun 2026', 'TechCorp Ltd', 'John Smith', 'Meeting', 'Progress review', 'Continued support', 'Done'],
            ['18 Jun 2026', 'DataFirst Inc', 'Sarah Lee', 'Call', 'KSB support', 'Manager agreed', 'Done'],
            ['15 Jun 2026', 'BuildRight Co', 'Mike Jones', 'Meeting', 'OTJH confirm', 'Will confirm', 'Pending'],
            ['12 Jun 2026', 'MarketPro', 'Emma Davis', 'Call', 'Attendance', 'Flexible hours', 'Done'],
            ['10 Jun 2026', 'AdminPlus', 'Chris Brown', 'Meeting', 'Progress review', 'On track', 'Done'],
            ['8 Jun 2026', 'CodeWorks', 'Lisa Wang', 'Call', 'OTJH confirm', 'Pending HR', 'Pending'],
          ],
        },
      },
      {
        title: 'Employer Engagement Trend',
        chart: {
          type: 'bar',
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [
            { label: 'Meetings', values: [2, 3, 2, 4, 3, 4], color: COLORS.primary },
            { label: 'Calls', values: [3, 2, 4, 2, 1, 2], color: COLORS.accent },
          ],
        },
      },
      {
        title: 'Employer Feedback',
        findings: [
          'TechCorp Ltd and AdminPlus — both employers report learners are performing well',
          'DataFirst Inc manager agreed to support Lucas Thomas with KSB catch-up',
          '2 OTJH confirmations pending from BuildRight Co and CodeWorks — chase required',
          'MarketPro approved flexible hours for Emma Wilson — attendance should improve',
        ],
      },
      {
        title: 'Employer Actions',
        recommendations: [
          'Chase BuildRight Co and CodeWorks for OTJH confirmations by 27 Jun',
          'Schedule follow-up with DataFirst Inc to confirm KSB support in place',
          'Send thank-you note to MarketPro for flexible hours approval',
          'Plan quarterly review meetings with TechCorp Ltd and AdminPlus',
        ],
      },
    ],
  },

  'cr-09': {
    id: 'cr-09',
    title: 'Evidence Validation Status',
    subtitle: 'Evidence submissions validation queue and turnaround times',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Validation Overview',
        content: 'You have 8 evidence submissions in your validation queue. 3 pending review, 2 approved, 2 returned for rework, 1 escalated.',
        metrics: [
          { label: 'In Queue', value: '8', change: '+2 vs last month', trend: 'up' },
          { label: 'Pending', value: '3', change: '+1 new', trend: 'neutral' },
          { label: 'Approved', value: '2', change: '1 this week', trend: 'up' },
          { label: 'Avg Turnaround', value: '4.2 days', change: '-0.8 days', trend: 'up' },
        ],
      },
      {
        title: 'Evidence Queue',
        table: {
          headers: ['Date', 'Learner', 'Evidence', 'KSB', 'Status', 'Turnaround', 'Quality'],
          rows: [
            ['22 Jun 2026', 'Sarah Johnson', 'Marketing Plan', 'K4', 'Pending', '1 day', '—'],
            ['20 Jun 2026', 'James Chen', 'Data Analysis', 'K2', 'Pending', '3 days', '—'],
            ['18 Jun 2026', 'Aisha Patel', 'Project Brief', 'S3', 'Pending', '5 days', '—'],
            ['15 Jun 2026', 'Oliver Brown', 'Email Samples', 'B1', 'Approved', '3 days', 'Good'],
            ['12 Jun 2026', 'Emma Wilson', 'Campaign Report', 'K3', 'Returned', '2 days', 'Incomplete'],
            ['10 Jun 2026', 'Liam Davis', 'Code Review', 'S2', 'Returned', '4 days', 'Needs work'],
            ['8 Jun 2026', 'Sophia Martinez', 'HR Policy', 'K5', 'Approved', '2 days', 'Excellent'],
            ['5 Jun 2026', 'Noah Taylor', 'Ledger Report', 'K1', 'Escalated', '7 days', 'Query'],
          ],
        },
      },
      {
        title: 'Validation Performance',
        chart: {
          type: 'bar',
          labels: ['Approved', 'Pending', 'Returned', 'Escalated'],
          datasets: [
            { label: 'Count', values: [2, 3, 2, 1], color: COLORS.primary },
          ],
        },
      },
      {
        title: 'Quality Analysis',
        findings: [
          '2 submissions returned for rework — both lacked sufficient reflection',
          'Sophia Martinez submission rated Excellent — highest quality this month',
          'Noah Taylor escalated after 7 days — complex query on RPL evidence',
          'Average turnaround improved to 4.2 days — target is 5 days',
        ],
      },
      {
        title: 'Validation Actions',
        recommendations: [
          'Review Sarah Johnson, James Chen, and Aisha Patel evidence within 2 days',
          'Provide detailed feedback for Emma Wilson and Liam Davis rework submissions',
          'Resolve Noah Taylor escalation with QA team — RPL query needs clarification',
          'Share Sophia Martinez submission as example of excellent evidence quality',
        ],
      },
    ],
  },

  'cr-10': {
    id: 'cr-10',
    title: 'Gateway Readiness Dashboard',
    subtitle: 'EPA readiness assessment and criteria completion tracking',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Gateway Readiness',
        content: 'No learners are currently gateway ready. 2 learners are approaching gateway (James Chen, Sarah Johnson). 4 learners are significantly behind.',
        metrics: [
          { label: 'Gateway Ready', value: '0', change: 'Same as last month', trend: 'neutral' },
          { label: 'Approaching', value: '2', change: '+1 this month', trend: 'up' },
          { label: 'Not Ready', value: '10', change: 'No change', trend: 'neutral' },
          { label: 'EPA Window', value: 'Q4 2026', change: '3 learners', trend: 'neutral' },
        ],
      },
      {
        title: 'Gateway Criteria Check',
        table: {
          headers: ['Learner', 'KSB 80%+', 'OTJH 100%', 'Portfolio Complete', 'Mock EPA', 'Employer Ready', 'Overall'],
          rows: [
            ['Sarah Johnson', 'No (72%)', 'No (68%)', 'No', 'No', 'Yes', 'Not Ready'],
            ['James Chen', 'No (80%)', 'No (75%)', 'No', 'No', 'Yes', 'Not Ready'],
            ['Aisha Patel', 'No (65%)', 'No (60%)', 'No', 'No', 'Yes', 'Not Ready'],
            ['Oliver Brown', 'No (58%)', 'No (55%)', 'No', 'No', 'No', 'Not Ready'],
            ['Emma Wilson', 'No (50%)', 'No (48%)', 'No', 'No', 'No', 'Not Ready'],
            ['Liam Davis', 'No (45%)', 'No (42%)', 'No', 'No', 'No', 'Not Ready'],
            ['Sophia Martinez', 'No (68%)', 'No (65%)', 'No', 'No', 'Yes', 'Not Ready'],
            ['Noah Taylor', 'No (55%)', 'No (52%)', 'No', 'No', 'No', 'Not Ready'],
            ['Mia Anderson', 'No (60%)', 'No (56%)', 'No', 'No', 'Yes', 'Not Ready'],
            ['Lucas Thomas', 'No (48%)', 'No (45%)', 'No', 'No', 'No', 'Not Ready'],
            ['Isabella White', 'No (52%)', 'No (50%)', 'No', 'No', 'Yes', 'Not Ready'],
            ['Ethan Harris', 'No (58%)', 'No (54%)', 'No', 'No', 'Yes', 'Not Ready'],
          ],
        },
      },
      {
        title: 'Gateway Timeline',
        chart: {
          type: 'bar',
          labels: ['Sarah J', 'James C', 'Aisha P', 'Sophia M', 'Mia A', 'Ethan H', 'Oliver B', 'Noah T', 'Isabella W', 'Emma W', 'Lucas T', 'Liam D'],
          datasets: [
            { label: 'KSB %', values: [72, 80, 65, 68, 60, 58, 58, 55, 52, 50, 48, 45], color: COLORS.primary },
            { label: 'OTJH %', values: [68, 75, 60, 65, 56, 54, 55, 52, 50, 48, 45, 42], color: COLORS.accent },
          ],
        },
      },
      {
        title: 'Gateway Risks',
        findings: [
          'James Chen is closest to gateway at 80% KSB but needs 20% more and OTJH at 75%',
          'Sarah Johnson at 72% KSB and 68% OTJH — second closest to gateway readiness',
          'Liam Davis at 45% KSB and 42% OTJH — significant risk of missing EPA window',
          'No learners have completed mock EPA or full portfolio — major blocker for all',
        ],
      },
      {
        title: 'Gateway Action Plan',
        recommendations: [
          'Schedule mock EPA for James Chen and Sarah Johnson in 4 weeks',
          'Accelerated KSB and OTJH plan for James Chen — target gateway in 3 months',
          'Portfolio completion sprint for all learners above 60% KSB',
          'Review EPA timeline for Liam Davis — may need to defer to Q1 2027',
        ],
      },
    ],
  },

  'cr-11': {
    id: 'cr-11',
    title: 'Learner Engagement Trends',
    subtitle: 'Engagement scoring and programme comparison',
    generatedAt: today(),
    period: period(),
    coach: 'Med Maher',
    sections: [
      {
        title: 'Engagement Summary',
        content: 'Average engagement score is 74% across the caseload. 3 learners above 80%, 6 between 60-80%, 3 below 60%. Programme average is 71%.',
        metrics: [
          { label: 'Avg Score', value: '74%', change: '+3% vs programme', trend: 'up' },
          { label: 'High (>80%)', value: '3', change: '+1 this month', trend: 'up' },
          { label: 'Medium (60-80%)', value: '6', change: 'Same', trend: 'neutral' },
          { label: 'Low (<60%)', value: '3', change: '-1 this month', trend: 'up' },
        ],
      },
      {
        title: 'Learner Engagement Scores',
        table: {
          headers: ['Learner', 'Programme', 'Score', 'Trend', 'Forum Posts', 'Quiz Avg', 'Last Login', 'Level'],
          rows: [
            ['Sarah Johnson', 'Marketing Executive L4', '82%', 'Up', '12', '78%', 'Today', 'High'],
            ['James Chen', 'Data Analyst L4', '85%', 'Up', '15', '82%', 'Today', 'High'],
            ['Aisha Patel', 'Project Manager L4', '76%', 'Stable', '8', '70%', 'Yesterday', 'Medium'],
            ['Oliver Brown', 'Business Admin L3', '68%', 'Down', '5', '65%', '2 days ago', 'Medium'],
            ['Emma Wilson', 'Digital Marketer L3', '62%', 'Down', '4', '58%', '3 days ago', 'Medium'],
            ['Liam Davis', 'Software Developer L4', '55%', 'Down', '2', '45%', '5 days ago', 'Low'],
            ['Sophia Martinez', 'HR Consultant L5', '79%', 'Up', '10', '75%', 'Today', 'Medium'],
            ['Noah Taylor', 'Accountancy L3', '65%', 'Stable', '6', '62%', 'Yesterday', 'Medium'],
            ['Mia Anderson', 'Marketing Executive L4', '71%', 'Up', '7', '68%', 'Today', 'Medium'],
            ['Lucas Thomas', 'Data Analyst L4', '58%', 'Down', '3', '50%', '4 days ago', 'Low'],
            ['Isabella White', 'Business Admin L3', '66%', 'Stable', '5', '60%', 'Yesterday', 'Medium'],
            ['Ethan Harris', 'Project Manager L4', '73%', 'Up', '9', '72%', 'Today', 'Medium'],
          ],
        },
      },
      {
        title: 'Engagement Trends',
        chart: {
          type: 'line',
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [
            { label: 'Your Caseload', values: [68, 70, 72, 71, 73, 74], color: COLORS.primary },
            { label: 'Programme Average', values: [65, 67, 68, 69, 70, 71], color: COLORS.secondary },
          ],
        },
      },
      {
        title: 'Engagement Insights',
        findings: [
          'Your caseload is 3% above programme average — good overall engagement',
          'James Chen is your most engaged learner (85%) with highest forum participation',
          'Liam Davis (55%) and Lucas Thomas (58%) — both low engagement and low attendance',
          'Forum participation correlates strongly with engagement scores (r=0.78)',
        ],
      },
      {
        title: 'Engagement Boosters',
        recommendations: [
          'Encourage forum participation for low-engagement learners — gamify with badges',
          'Set up study buddy pairs: James Chen + Lucas Thomas, Sarah Johnson + Liam Davis',
          'Review quiz difficulty for Emma Wilson and Lucas Thomas — scores below 60%',
          'Celebrate James Chen and Sarah Johnson as engagement champions in group session',
        ],
      },
    ],
  },

  'cr-12': {
    id: 'cr-12',
    title: 'Coaching Workload Report',
    subtitle: 'Your coaching activity summary and time allocation',
    generatedAt: today(),
    period: '1 Jun 2026 - 30 Jun 2026',
    coach: 'Med Maher',
    sections: [
      {
        title: 'Workload Summary',
        content: 'You completed 42 activities this month: 18 coaching sessions, 8 marking tasks, 6 employer contacts, 5 admin tasks, 3 progress reviews, 2 evidence validations.',
        metrics: [
          { label: 'Total Activities', value: '42', change: '+5 vs last month', trend: 'up' },
          { label: 'Coaching Hours', value: '24', change: '+4 hrs', trend: 'up' },
          { label: 'Marking Hours', value: '8', change: '+1 hr', trend: 'up' },
          { label: 'Admin Hours', value: '6', change: '-1 hr', trend: 'up' },
        ],
      },
      {
        title: 'Daily Activity Log',
        table: {
          headers: ['Date', 'Coaching', 'Marking', 'Admin', 'Employer', 'Reviews', 'Total'],
          rows: [
            ['23 Jun 2026', '2', '1', '0', '0', '0', '3'],
            ['22 Jun 2026', '1', '0', '1', '0', '0', '2'],
            ['20 Jun 2026', '1', '0', '0', '1', '1', '3'],
            ['18 Jun 2026', '1', '1', '0', '0', '0', '2'],
            ['15 Jun 2026', '1', '0', '0', '1', '0', '2'],
            ['12 Jun 2026', '1', '1', '1', '0', '0', '3'],
            ['10 Jun 2026', '1', '0', '1', '0', '0', '2'],
            ['8 Jun 2026', '1', '1', '0', '1', '0', '3'],
            ['5 Jun 2026', '1', '0', '1', '0', '0', '2'],
            ['3 Jun 2026', '1', '0', '0', '1', '0', '2'],
          ],
        },
      },
      {
        title: 'Time Allocation',
        chart: {
          type: 'bar',
          labels: ['Coaching', 'Marking', 'Admin', 'Employer', 'Reviews', 'Validation'],
          datasets: [
            { label: 'Hours', values: [24, 8, 6, 3, 3, 2], color: COLORS.primary },
          ],
        },
      },
      {
        title: 'Workload Analysis',
        findings: [
          'Coaching is 54% of your time — aligned with primary role expectations',
          'Marking increased by 1 hour this month — 2 evidence submissions returned for rework',
          'Admin decreased by 1 hour — automation of catch-up scheduling helped',
          'You average 2.1 activities per working day — consistent with SLA targets',
        ],
      },
      {
        title: 'Workload Recommendations',
        recommendations: [
          'Consider delegating routine admin to automation tools — save 1 hour/week',
          'Batch marking sessions on Tuesdays and Thursdays for efficiency',
          'Group coaching for high-performing cohorts to reduce 1-to-1 time',
          'Review workload if caseload increases above 15 learners',
        ],
      },
    ],
  },
};