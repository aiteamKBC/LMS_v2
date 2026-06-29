export const GATEWAY_READINESS_SCORE = 68;

export function getReadinessBand(score: number): { label: string; color: string; bg: string; text: string } {
  if (score >= 90) return { label: 'Gateway Ready', color: 'emerald', bg: 'bg-emerald-100', text: 'text-emerald-700' };
  if (score >= 70) return { label: 'On Track', color: 'emerald', bg: 'bg-emerald-100', text: 'text-emerald-700' };
  if (score >= 40) return { label: 'Developing', color: 'amber', bg: 'bg-amber-100', text: 'text-amber-700' };
  return { label: 'Getting Started', color: 'red', bg: 'bg-red-100', text: 'text-red-700' };
}

export const GATEWAY_BLOCKERS = [
  { id: 'blk-01', item: '46 OTJH Hours', detail: '74 of 120 hours logged — need 46 more before Gateway', icon: 'ri-time-line', severity: 'high' as const },
  { id: 'blk-02', item: '54 KSB Validations', detail: '18 of 72 KSBs validated — 54 remaining', icon: 'ri-bar-chart-2-line', severity: 'high' as const },
  { id: 'blk-03', item: '6 Progress Reviews', detail: '2 of 8 progress reviews completed and signed', icon: 'ri-file-list-3-line', severity: 'medium' as const },
  { id: 'blk-04', item: 'Employer Sign-Off', detail: 'Line manager statement and workplace confirmation required', icon: 'ri-user-star-line', severity: 'medium' as const },
];

export const GATEWAY_PROGRESS_STATUS = {
  label: 'On Track' as const,
  detail: 'Behind schedule',
  explanation: 'Based on your current pace of KSB validation, OTJH completion and portfolio development.',
};

export const GATEWAY_COUNTDOWN = {
  monthsRemaining: 16,
  daysRemaining: 482,
};

export const EPA_JOURNEY_STAGES = [
  { id: 's1', label: 'Active Learning', completed: true, current: false },
  { id: 's2', label: 'Portfolio Development', completed: true, current: false },
  { id: 's3', label: 'Gateway Preparation', completed: false, current: true },
  { id: 's4', label: 'Gateway', completed: false, current: false },
  { id: 's5', label: 'EPA', completed: false, current: false },
  { id: 's6', label: 'Certification', completed: false, current: false },
];

export const CURRENT_POSITION = {
  stage: 'Gateway Preparation',
  week: 4,
};

export const AT_RISK_KSBS = [
  { code: 'K12', category: 'Knowledge', issue: 'Not Yet Evidenced', recommendation: 'Submit evidence linking K12 to your marketing metrics analysis project. Review your campaign evaluation data from the May promotion.' },
  { code: 'S18', category: 'Skills', issue: 'No Evidence Submitted', recommendation: 'Upload your customer persona activity as direct evidence for S18. Add workplace examples showing how you applied segmentation insights.' },
  { code: 'B4', category: 'Behaviours', issue: 'Insufficient Validation', recommendation: 'Complete your monthly coaching reflection focusing on how you use data to inform decisions. Ask your coach to validate B4.' },
  { code: 'K9', category: 'Knowledge', issue: 'Partial Evidence Only', recommendation: 'Supplement your K9 evidence with a workplace example showing digital marketing channel selection rationale.' },
  { code: 'S11', category: 'Skills', issue: 'Awaiting QA Review', recommendation: 'Your S11 evidence has been submitted but flagged by QA. Update the submission with more specific workplace context as requested.' },
];

export const PORTFOLIO_HEALTH = {
  score: 72,
  dimensions: [
    { label: 'Evidence Quality', score: 78, icon: 'ri-file-check-line' },
    { label: 'Cross Referencing', score: 65, icon: 'ri-links-line' },
    { label: 'KSB Coverage', score: 58, icon: 'ri-bar-chart-2-line' },
    { label: 'Workplace Application', score: 82, icon: 'ri-building-2-line' },
    { label: 'Portfolio Completeness', score: 77, icon: 'ri-folders-line' },
  ],
};

export const EVIDENCE_COVERAGE = [
  { category: 'Knowledge', pieces: 18, color: 'primary', icon: 'ri-brain-line' },
  { category: 'Skills', pieces: 12, color: 'accent', icon: 'ri-tools-line' },
  { category: 'Behaviours', pieces: 6, color: 'secondary', icon: 'ri-user-heart-line' },
];

export const EMPLOYER_READINESS = [
  { id: 'emp-01', label: 'Employer Sign-Off', status: 'pending' as const, detail: 'Line manager signature required before Gateway submission', deadline: 'Aug 2027' },
  { id: 'emp-02', label: 'Line Manager Statement', status: 'not-started' as const, detail: 'Workplace confirmation statement covering your role and responsibilities', deadline: 'Sep 2027' },
  { id: 'emp-03', label: 'Employer Progress Reviews', status: 'in-progress' as const, detail: '3 of 8 employer reviews signed and completed', deadline: 'Ongoing' },
  { id: 'emp-04', label: 'Workplace Confirmation', status: 'not-started' as const, detail: 'HR confirmation of employment duration and role suitability', deadline: 'Aug 2027' },
];

export const PREDICTED_EPA_OUTCOME = {
  grade: 'Pass' as const,
  confidence: 78,
  factors: [
    { label: 'KSB Validation', score: 25, weight: '25%' },
    { label: 'Quiz Scores', score: 80, weight: '15%' },
    { label: 'Portfolio Progress', score: 72, weight: '20%' },
    { label: 'Mock Review Performance', score: 65, weight: '15%' },
    { label: 'OTJH Completion', score: 62, weight: '15%' },
    { label: 'Progress Reviews', score: 25, weight: '10%' },
  ],
  disclaimer: 'This prediction is advisory only and based on your current trajectory. EPA outcomes depend on your final Gateway readiness, EPA preparation, and assessment performance on the day.',
};

export const COACH_RECOMMENDATIONS = [
  { id: 'rec-01', text: 'Focus on Skills KSB evidence. Your Skills category is at 23% validated — upload workplace project evidence for S7, S8, and S18.', priority: 'high' as const, icon: 'ri-tools-line' },
  { id: 'rec-02', text: 'Upload additional workplace examples for K9 and K12. Your Knowledge coverage needs strengthening in digital marketing metrics.', priority: 'high' as const, icon: 'ri-upload-cloud-line' },
  { id: 'rec-03', text: 'Complete two more coaching reflections. You have 1 of 18 sessions documented — logging these will boost B1 and B4 evidence.', priority: 'medium' as const, icon: 'ri-chat-quote-line' },
  { id: 'rec-04', text: 'Prepare your employer statement. Speak to Lauren Mitchell about signing off your workplace confirmation before August 2027.', priority: 'medium' as const, icon: 'ri-user-star-line' },
  { id: 'rec-05', text: 'Prioritise K12 and S18. These are at-risk KSBs with no evidence. Address these first before tackling other gaps.', priority: 'high' as const, icon: 'ri-focus-3-line' },
  { id: 'rec-06', text: 'Book your first mock review session. Your coach is ready to run a practice professional discussion to build your confidence.', priority: 'medium' as const, icon: 'ri-calendar-check-line' },
];

export const NEXT_ACTIONS = [
  { id: 'act-01', label: 'Upload Evidence', detail: 'Submit missing KSB evidence for K12 and S18', priority: 'high' as const, icon: 'ri-upload-cloud-line', link: '/learner/evidence' },
  { id: 'act-02', label: 'Complete OTJH Log', detail: 'Log 2.5 hours this week to stay on track', priority: 'high' as const, icon: 'ri-time-line', link: '/learner/otjh' },
  { id: 'act-03', label: 'Book Mock Review', detail: 'Schedule your first practice session with coach', priority: 'medium' as const, icon: 'ri-calendar-check-line', link: '/learner/gateway' },
  { id: 'act-04', label: 'Prepare Employer Statement', detail: 'Speak to your line manager about workplace confirmation', priority: 'medium' as const, icon: 'ri-user-star-line', link: '/learner/gateway' },
  { id: 'act-05', label: 'Review KSB Gaps', detail: 'Check 54 unvalidated KSBs and plan your next submissions', priority: 'high' as const, icon: 'ri-focus-3-line', link: '/learner/ksbs' },
];

export const EPA_COMPONENT_READINESS = [
  {
    id: 'epa-01',
    title: 'Professional Discussion',
    readiness: 65,
    description: '60-minute structured discussion with an independent assessor using your portfolio as evidence.',
    recommendations: [
      'Organise your portfolio with clear KSB indexing before the discussion',
      'Practice articulating your evidence using the STAR method',
      'Review your mock review feedback from the coach for improvement areas',
    ],
  },
  {
    id: 'epa-02',
    title: 'Project Showcase',
    readiness: 58,
    description: '15-minute presentation followed by 30 minutes of Q&A on a marketing project you led at Tim Hortons.',
    recommendations: [
      'Select your strongest workplace project with measurable outcomes',
      'Create a clear presentation structure: problem, approach, results, learning',
      'Prepare for detailed questions about strategic decisions and data analysis',
    ],
  },
];

export const MOCK_REVIEW_ENHANCEMENTS = [
  {
    id: 'mq-01',
    question: 'Explain how you applied the STP (Segmentation, Targeting, Positioning) model to a real marketing campaign at Tim Hortons.',
    ksbs: 'K5, K6, S8, B1',
    difficulty: 'Medium' as const,
    epaRelevance: 85,
    exampleResponse: 'For the summer iced coffee campaign, I identified three segments: commuter students, young professionals, and family shoppers. I targeted young professionals with LinkedIn ads and TikTok content, positioning the product as "your afternoon refreshment." This resulted in a 12% uplift in afternoon sales.',
    coachTip: 'The assessor wants to hear specific, measurable outcomes. Give a real campaign with data, not a theoretical answer.',
    prepResources: [
      { label: 'STP Framework Guide', type: 'Reading' as const },
      { label: 'Campaign Planning Template', type: 'Template' as const },
    ],
  },
  {
    id: 'mq-02',
    question: 'Describe a situation where you used marketing metrics to evaluate the effectiveness of a campaign. What data did you analyse and what recommendations did you make?',
    ksbs: 'K12, S12, S13, B4',
    difficulty: 'Hard' as const,
    epaRelevance: 92,
    exampleResponse: 'For the loyalty app promotion, I tracked CTR, conversion rate, and CAC. CTR was 3.2% but conversion was low at 1.1%. I recommended simplifying the signup flow and adding a push notification reminder, which improved conversion to 2.8% the following week.',
    coachTip: 'Focus on the analytical process, not just the numbers. Explain why you chose certain metrics and how you interpreted them.',
    prepResources: [
      { label: 'Marketing Metrics Toolkit', type: 'Reading' as const },
      { label: 'Data Analysis Worksheet', type: 'Template' as const },
    ],
  },
  {
    id: 'mq-03',
    question: 'How do you ensure your marketing communications comply with UK advertising standards and data protection regulations?',
    ksbs: 'K15, B7, B8',
    difficulty: 'Medium' as const,
    epaRelevance: 78,
    exampleResponse: 'I always review the CAP Code before approving campaigns. For our email marketing, I ensure consent is explicit, provide unsubscribe links, and maintain a suppression list. I also complete the KBC compliance checklist before any campaign goes live.',
    coachTip: 'Show that compliance is part of your routine, not an afterthought. Reference specific regulations and processes.',
    prepResources: [
      { label: 'CAP Code Summary', type: 'Reading' as const },
      { label: 'GDPR Compliance Checklist', type: 'Template' as const },
    ],
  },
  {
    id: 'mq-04',
    question: 'Walk through how you would plan and execute a multi-channel marketing campaign for a new Tim Hortons product launch.',
    ksbs: 'K8, S9, S10, S11, B2',
    difficulty: 'Hard' as const,
    epaRelevance: 90,
    exampleResponse: 'I would start with customer research to identify the target segment. Then develop messaging for each channel: social media for awareness, email for conversion, and in-store POS for immediate purchase. I would set KPIs for each channel and review weekly, adjusting spend based on performance.',
    coachTip: 'Structure your answer chronologically. Show strategic thinking, not just tactical execution. The assessor wants to see planning discipline.',
    prepResources: [
      { label: 'Multi-Channel Campaign Planner', type: 'Template' as const },
      { label: 'Channel Strategy Guide', type: 'Reading' as const },
    ],
  },
  {
    id: 'mq-05',
    question: 'Tell me about a time you collaborated with colleagues outside the marketing team to deliver a campaign. What was your role and what was the outcome?',
    ksbs: 'S14, S15, B3, B5',
    difficulty: 'Easy' as const,
    epaRelevance: 72,
    exampleResponse: 'For the seasonal menu launch, I worked with the operations team to coordinate store displays and the finance team to set the promotional budget. I led the marketing workstream and facilitated weekly cross-functional meetings. The campaign launched on time across all 12 locations.',
    coachTip: 'Emphasise your communication and leadership skills. The assessor wants to see you can influence without authority.',
    prepResources: [
      { label: 'Stakeholder Communication Guide', type: 'Reading' as const },
    ],
  },
  {
    id: 'mq-06',
    question: 'What CPD activities have you undertaken during your apprenticeship and how have they contributed to your professional development?',
    ksbs: 'K22, B6, B9',
    difficulty: 'Easy' as const,
    epaRelevance: 65,
    exampleResponse: 'I completed the Google Analytics certification and attended a LinkedIn advertising workshop. The analytics skills directly improved my campaign reporting for the iced coffee promotion, and the LinkedIn knowledge helped me optimise our B2B targeting.',
    coachTip: 'Link every CPD activity to a specific workplace outcome. Show continuous learning and professional growth.',
    prepResources: [
      { label: 'CPD Log Template', type: 'Template' as const },
    ],
  },
];