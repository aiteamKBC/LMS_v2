// Role-specific tasks for workspace sidebar widgets & /tasks page
export interface RoleTask {
  id: number;
  text: string;
  due: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in-progress' | 'completed';
  assignee: string;
  assigneeAvatar: string;
  category: string;
  relatedTo?: string;
  description?: string;
}

export const roleTasks: Record<string, RoleTask[]> = {
  learner: [
    { id: 1, text: 'Complete Week 4 STP Worksheet', due: '14 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'Y', category: 'Learning', relatedTo: 'Module 4', description: 'Complete the segmentation, targeting, and positioning worksheet for Week 4.' },
    { id: 2, text: 'Submit evidence for KSB K5 and S8', due: '16 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'Y', category: 'Evidence', relatedTo: 'Module 4', description: 'Upload evidence linking to knowledge K5 and skill S8 from your Tim Hortons project work.' },
    { id: 3, text: 'Watch Module 4 recorded session', due: '13 Jun 2026', priority: 'medium', status: 'completed', assignee: 'You', assigneeAvatar: 'Y', category: 'Learning', relatedTo: 'Module 4', description: 'Watch the PESTLE analysis session recording uploaded by your tutor.' },
    { id: 4, text: 'Log 6 OTJH hours this week', due: '20 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'Y', category: 'OTJH', relatedTo: 'OTJH Target', description: 'You are currently at 74 hours. Log your project management work this week to catch up.' },
    { id: 5, text: 'Prepare reflection for coaching session', due: '19 Jun 2026', priority: 'medium', status: 'in-progress', assignee: 'You', assigneeAvatar: 'Y', category: 'Coaching', relatedTo: 'Coaching — Med Maher', description: 'Prepare a short reflection on how segmentation learning has been applied at Tim Hortons.' },
    { id: 6, text: 'Complete monthly quiz — Marketing Env', due: '22 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'Y', category: 'Assessment', relatedTo: 'Module 4 Quiz', description: 'The monthly checkpoint quiz on marketing environment is now live.' },
    { id: 7, text: 'Review employer progress update', due: '25 Jun 2026', priority: 'low', status: 'pending', assignee: 'You', assigneeAvatar: 'Y', category: 'Review', relatedTo: 'Progress Review Q2', description: 'Review and confirm your Q2 progress review notes with Lauren before sign-off.' },
  ],
  coach: [
    { id: 1, text: 'Validate OTJH entries — Cohort A', due: '14 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'M', category: 'OTJH', relatedTo: 'Cohort A', description: 'Review and validate all off-the-job hours submitted by learners in Cohort A.' },
    { id: 2, text: 'Complete Q2 progress reports', due: '20 Jun 2026', priority: 'medium', status: 'in-progress', assignee: 'You', assigneeAvatar: 'M', category: 'Progress Review', relatedTo: 'All Cohorts', description: 'Compile and submit quarterly progress reports for all active learners.' },
    { id: 3, text: 'Review evidence submissions — Cohort A', due: '12 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'M', category: 'Evidence', relatedTo: 'EV-1245, EV-1238', description: 'Review latest evidence submissions and provide validation feedback.' },
    { id: 4, text: 'Catch-up call — Finn Murphy', due: '13 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'M', category: 'At-Risk', relatedTo: 'Finn Murphy', description: 'Finn is 2 months behind on OTJH. Schedule urgent intervention session.' },
    { id: 5, text: 'Joint employer meeting — Lauren Mitchell', due: '19 Jun 2026', priority: 'medium', status: 'in-progress', assignee: 'You', assigneeAvatar: 'M', category: 'Employer', relatedTo: 'Sophie Williams', description: 'Joint check-in with Sophie\'s line manager to discuss OTJH and workplace supervision.' },
    { id: 6, text: 'Mark Module 7 assignments', due: '15 Jun 2026', priority: 'medium', status: 'completed', assignee: 'You', assigneeAvatar: 'M', category: 'Marking', relatedTo: 'Module 7', description: 'Complete AI-assisted marking for the 12 learners who submitted Module 7 assignments.' },
    { id: 7, text: 'Prepare KSB impact report — Cohort C', due: '30 Jun 2026', priority: 'low', status: 'pending', assignee: 'You', assigneeAvatar: 'M', category: 'Reports', relatedTo: 'Cohort C', description: 'Produce the end-of-cycle KSB impact report for Cohort C.' },
  ],
  admin: [
    { id: 1, text: 'Resolve QA failure — EV-2024-442', due: '12 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'A', category: 'QA', relatedTo: 'Evidence Pack #EV-2024-442', description: 'Evidence pack failed QA. Notify coach and track 48-hour resubmission window.' },
    { id: 2, text: 'Process June ILR export', due: '14 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'A', category: 'ILR', relatedTo: 'June 2026', description: 'Export and validate ILR data for June. Confirm with Lisa Nguyen.' },
    { id: 3, text: 'Review security incident — IP block', due: '10 Jun 2026', priority: 'high', status: 'completed', assignee: 'You', assigneeAvatar: 'A', category: 'Security', relatedTo: 'david.chen@kbc.ac.uk', description: 'Review phishing attempt. Enable MFA and document in security audit trail.' },
    { id: 4, text: 'Onboard 3 new tenant users', due: '18 Jun 2026', priority: 'medium', status: 'in-progress', assignee: 'You', assigneeAvatar: 'A', category: 'Admin', relatedTo: 'June 2026 Intake', description: 'Complete onboarding for 3 new users joining the KBC platform this month.' },
    { id: 5, text: 'Update RBAC roles — compliance team', due: '20 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'A', category: 'Permissions', relatedTo: 'Compliance Team', description: 'Update permission matrix for the compliance team following new module release.' },
    { id: 6, text: 'Configure automations for new cohort', due: '25 Jun 2026', priority: 'low', status: 'pending', assignee: 'You', assigneeAvatar: 'A', category: 'Automations', relatedTo: 'Cohort D', description: 'Set up trigger automations for new Cohort D intake starting July 2026.' },
  ],
  tutor: [
    { id: 1, text: 'Mark Module 7 assignments', due: '14 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'C', category: 'Marking', relatedTo: 'Module 7', description: 'Mark 12 submitted Module 7 assignments using the AI-assisted marking tool.' },
    { id: 2, text: 'Validate KSB evidence — Sophie Williams', due: '16 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'C', category: 'Evidence', relatedTo: 'Sophie Williams', description: 'Validate the latest evidence upload for K5, K6 and S8 from Sophie.' },
    { id: 3, text: 'Upload Module 4 session recording', due: '12 Jun 2026', priority: 'medium', status: 'completed', assignee: 'You', assigneeAvatar: 'C', category: 'Resources', relatedTo: 'Module 4', description: 'Upload the PESTLE analysis session recording to the module resources.' },
    { id: 4, text: 'Prepare quiz for Week 5 checkpoint', due: '20 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'C', category: 'Assessment', relatedTo: 'Module 5', description: 'Build and test the checkpoint quiz for Week 5 consumer behaviour topic.' },
    { id: 5, text: 'Feedback on 8 quiz submissions', due: '18 Jun 2026', priority: 'low', status: 'pending', assignee: 'You', assigneeAvatar: 'C', category: 'Feedback', relatedTo: 'Week 3 Quiz', description: 'Complete feedback for 8 learners who submitted the Week 3 quiz this cycle.' },
  ],
  employer: [
    { id: 1, text: 'Confirm OTJH hours for Sophie — May', due: '14 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'L', category: 'OTJH', relatedTo: 'Sophie Williams', description: 'Confirm and sign off Sophie\'s off-the-job hours for May 2026.' },
    { id: 2, text: 'Sign Q2 progress review — Sophie', due: '20 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'L', category: 'Progress Review', relatedTo: 'Sophie Williams', description: 'Review and digitally sign the Q2 progress review submitted by Med Maher.' },
    { id: 3, text: 'Attend joint employer meeting — 19 Jun', due: '19 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'L', category: 'Meeting', relatedTo: 'Med Maher, Sophie Williams', description: 'Joint check-in with Sophie\'s coach to discuss OTJH and supervision plan.' },
    { id: 4, text: 'Complete workplace confirmation form', due: '16 Jun 2026', priority: 'medium', status: 'completed', assignee: 'You', assigneeAvatar: 'L', category: 'Compliance', relatedTo: 'Tim Hortons Canterbury', description: 'Complete the workplace confirmation confirming Sophie\'s learning environment.' },
  ],
  compliance: [
    { id: 1, text: 'Submit June ILR data', due: '14 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'R', category: 'ILR', relatedTo: 'June 2026', description: 'Export and submit the June ILR data to the ESFA portal.' },
    { id: 2, text: 'Complete eligibility review — James Wilson', due: '13 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'R', category: 'Eligibility', relatedTo: 'James Wilson', description: 'Complete the eligibility review and initiate onboarding for new starter James Wilson.' },
    { id: 3, text: 'Employer contracting — TechKent Ltd', due: '18 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'R', category: 'Contracting', relatedTo: 'TechKent Ltd', description: 'Finalise the employer contracting pack for TechKent Ltd new cohort.' },
    { id: 4, text: 'DAS payment reconciliation — May', due: '15 Jun 2026', priority: 'medium', status: 'completed', assignee: 'You', assigneeAvatar: 'R', category: 'Finance', relatedTo: 'May 2026', description: 'Reconcile DAS payments for May 2026 with internal finance records.' },
    { id: 5, text: 'Audit evidence packs — Cohort B', due: '22 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'R', category: 'Audit', relatedTo: 'Cohort B', description: 'Conduct audit on Cohort B evidence packs for end-of-year compliance.' },
  ],
  qa: [
    { id: 1, text: 'QA sampling — Cohort B', due: '22 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'T', category: 'QA', relatedTo: 'Cohort B', description: 'Conduct QA sampling for Cohort B learners and document findings.' },
    { id: 2, text: 'Resolve rejected evidence — EV-2024-442', due: '12 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'T', category: 'Evidence', relatedTo: 'EV-2024-442', description: 'Track resubmission of rejected evidence within 48-hour window.' },
    { id: 3, text: 'Prepare Ofsted evidence pack', due: '30 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'T', category: 'Ofsted', relatedTo: 'SAR/QIP', description: 'Compile and prepare evidence pack for upcoming Ofsted inspection visit.' },
    { id: 4, text: 'AI marking validation — Module 7', due: '10 Jun 2026', priority: 'low', status: 'completed', assignee: 'You', assigneeAvatar: 'T', category: 'AI Marking', relatedTo: 'Module 7', description: 'Validate AI-assisted marking results for Module 7 assignments.' },
    { id: 5, text: 'Gateway review — 3 learners', due: '25 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'T', category: 'Gateway', relatedTo: 'Cohort A', description: 'Conduct gateway readiness review for 3 learners approaching EPA.' },
  ],
  leadership: [
    { id: 1, text: 'Review June leadership dashboard', due: '15 Jun 2026', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'K', category: 'Leadership', relatedTo: 'June 2026', description: 'Review cohort performance metrics and at-risk learner counts on the dashboard.' },
    { id: 2, text: 'SAR/QIP evidence submission', due: '30 Jun 2026', priority: 'high', status: 'in-progress', assignee: 'You', assigneeAvatar: 'K', category: 'Ofsted', relatedTo: 'SAR/QIP 2026', description: 'Submit SAR/QIP evidence pack for the upcoming Ofsted review.' },
    { id: 3, text: 'Coach workload review', due: '16 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'K', category: 'Admin', relatedTo: 'All Coaches', description: 'Review current coach workload distribution and identify capacity gaps.' },
    { id: 4, text: 'Sign off delivery performance report', due: '20 Jun 2026', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'K', category: 'Reports', relatedTo: 'Q2 2026', description: 'Approve the Q2 delivery performance report before circulating to the board.' },
  ],
  default: [
    { id: 1, text: 'Complete your profile setup', due: 'Today', priority: 'high', status: 'pending', assignee: 'You', assigneeAvatar: 'Y', category: 'Setup', description: 'Complete your profile to get the most out of KBC LearningOS.' },
    { id: 2, text: 'Review platform guide', due: 'This week', priority: 'medium', status: 'pending', assignee: 'You', assigneeAvatar: 'Y', category: 'Onboarding', description: 'Read through the user guide to understand all platform features.' },
  ],
};