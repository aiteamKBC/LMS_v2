export interface StageDetail {
  label: string;
  description: string;
  icon: string;
}

export interface JourneyStage {
  number: string;
  icon: string;
  title: string;
  subtitle: string;
  duration: string;
  summary: string;
  keyActivities: string[];
  details: StageDetail[];
  color: 'accent' | 'primary' | 'secondary';
}

export const journeyStages: JourneyStage[] = [
  {
    number: '01',
    icon: 'ri-rocket-line',
    title: 'Getting Started',
    subtitle: 'Onboarding & Compliance',
    duration: '2–6 weeks',
    summary:
      'We guide you through every form, check, and signature. From your first welcome to your official activation, you are never alone. Our team handles the complexity so you can focus on beginning your journey.',
    keyActivities: [
      'Employer Contracting',
      'Eligibility Check',
      'Skills Assessment',
      'Compliance Pack',
      'Digital Signatures',
    ],
    details: [
      { label: 'Induction', description: 'Welcome session, system access, and your programme overview.', icon: 'ri-user-add-line' },
      { label: 'Employer Contracting', description: 'Contract and commitment charter signed with your employer.', icon: 'ri-file-paper-line' },
      { label: 'Self-Onboarding', description: 'Complete your profile, policies, and initial questionnaires.', icon: 'ri-clipboard-line' },
      { label: 'Enrolment Review', description: 'We verify your details, funding eligibility, and programme entry.', icon: 'ri-profile-line' },
      { label: 'Eligibility Review', description: 'Residency, employment status, and prior attainment checks.', icon: 'ri-shield-check-line' },
      { label: 'Initial Assessment', description: 'BKSB skills assessment and learning style evaluation.', icon: 'ri-bar-chart-line' },
      { label: 'RPL / Skills Scan', description: 'Recognition of prior learning and skills gap analysis.', icon: 'ri-search-line' },
      { label: 'Compliance Pack', description: 'All mandatory documents compiled and verified.', icon: 'ri-folder-lock-line' },
      { label: 'Digital Signatures', description: 'All parties sign the training agreement digitally.', icon: 'ri-edit-2-line' },
      { label: 'DAS Tracker', description: 'Apprenticeship service setup and employer confirmation.', icon: 'ri-database-2-line' },
      { label: 'ILR Readiness', description: 'Individual Learner Record prepared and validated.', icon: 'ri-stack-line' },
      { label: 'QA Final Review', description: 'Quality assurance sign-off before activation.', icon: 'ri-checkbox-circle-line' },
      { label: 'Activation', description: 'You are officially activated and begin your journey.', icon: 'ri-rocket-line' },
    ],
    color: 'accent',
  },
  {
    number: '02',
    icon: 'ri-book-open-line',
    title: 'Active Learning',
    subtitle: 'Training & Development',
    duration: '12–15 months',
    summary:
      'The heart of your apprenticeship. Structured learning modules, regular coaching sessions, and building your evidence portfolio — all at a pace that works for you. Your dedicated coach is with you every month.',
    keyActivities: [
      'Training Plan',
      'Monthly Coaching',
      'Module Learning',
      'Evidence Portfolio',
      'KSB Development',
    ],
    details: [
      { label: 'Training Plan', description: 'Personalised plan with agreed milestones and learning schedule.', icon: 'ri-map-pin-line' },
      { label: 'Monthly Coaching', description: 'Regular 1-to-1 sessions with progress tracking and target setting.', icon: 'ri-calendar-check-line' },
      { label: 'Module Learning', description: 'Structured modules with resources, activities, and assessments.', icon: 'ri-book-2-line' },
      { label: 'Evidence Portfolio', description: 'Build your portfolio to demonstrate Knowledge, Skills, and Behaviours.', icon: 'ri-folder-5-line' },
      { label: 'Progress Reviews', description: 'Formal reviews at 3, 6, 9, and 12 months to assess and adjust targets.', icon: 'ri-line-chart-line' },
      { label: 'KSB Development', description: 'Knowledge, Skills, and Behaviours mapped to your apprenticeship standard.', icon: 'ri-mind-map' },
      { label: 'OTJH Tracking', description: 'Off-The-Job Hours tracked against the 20% minimum requirement.', icon: 'ri-time-line' },
      { label: 'Quizzes & Assessments', description: 'Formative assessments to validate your knowledge and understanding.', icon: 'ri-questionnaire-line' },
      { label: '12-Month Review', description: 'Midpoint review with employer, coach, and learner to assess progress.', icon: 'ri-calendar-event-line' },
      { label: '18-Month Review', description: 'Final active review before transitioning to gateway preparation.', icon: 'ri-flag-line' },
    ],
    color: 'primary',
  },
  {
    number: '03',
    icon: 'ri-focus-3-line',
    title: 'Gateway Preparation',
    subtitle: 'Readiness & Approval',
    duration: '2–4 weeks',
    summary:
      'Your final checkpoint before the independent assessment. We review your readiness, run a mock assessment, and secure final sign-off from your employer and QA team. You will feel fully prepared and confident.',
    keyActivities: [
      'Readiness Review',
      'Mock Assessment',
      'Employer Sign-off',
      'QA Approval',
    ],
    details: [
      { label: 'Gateway Readiness', description: 'Comprehensive assessment of your readiness for the end point assessment.', icon: 'ri-door-open-line' },
      { label: 'Mock Assessment', description: 'Practice assessment to prepare you for the real EPA experience.', icon: 'ri-test-tube-line' },
      { label: 'Employer Sign-off', description: 'Your employer confirms you are ready and provides final endorsement.', icon: 'ri-hand-coin-line' },
      { label: 'QA Gateway Review', description: 'Quality assurance review to approve you to proceed to EPA.', icon: 'ri-shield-star-line' },
    ],
    color: 'secondary',
  },
  {
    number: '04',
    icon: 'ri-award-line',
    title: 'End Point Assessment',
    subtitle: 'Assessment & Certification',
    duration: '4–8 weeks',
    summary:
      'The culmination of your journey. Register with an independent assessment organisation, complete your final preparation, and sit your assessment with confidence. Your professional qualification awaits.',
    keyActivities: [
      'EPA Registration',
      'Assessment Prep',
      'Independent Assessment',
      'Certification',
    ],
    details: [
      { label: 'EPA Registration', description: 'Register with an independent end point assessment organisation.', icon: 'ri-registered-line' },
      { label: 'EPA Preparation', description: 'Final revision and preparation for your assessment components.', icon: 'ri-bookmark-line' },
      { label: 'End Point Assessment', description: 'The independent assessment — observation, interview, and professional discussion.', icon: 'ri-award-line' },
      { label: 'EPA Results', description: 'Assessment outcome graded, certificate issued, and apprenticeship complete.', icon: 'ri-medal-line' },
    ],
    color: 'accent',
  },
];

export const totalSteps = journeyStages.reduce(
  (sum, stage) => sum + stage.details.length,
  0,
);