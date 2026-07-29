import type { ProgressReviewResponses } from './progressReviewForm';

export type MonthlyCoachingAnswerType =
  | 'text'
  | 'yes-no'
  | 'agreement'
  | 'select'
  | 'date'
  | 'rag'
  | 'statement';

export interface MonthlyCoachingQuestion {
  id: string;
  label: string;
  type: MonthlyCoachingAnswerType;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  required?: boolean;
}

export interface MonthlyCoachingSection {
  id: string;
  title: string;
  description: string;
  icon: string;
  questions: MonthlyCoachingQuestion[];
}

export const MONTHLY_COACHING_SECTIONS: MonthlyCoachingSection[] = [
  {
    id: 'previous-summary',
    title: 'Previous Meeting Summary',
    description: 'Select the previous MCM and record the progress made since it took place.',
    icon: 'ri-history-line',
    questions: [
      {
        id: 'mcm_previous_meeting',
        label: 'Meeting',
        type: 'select',
        options: ['Previous Monthly Coaching Meeting', 'No previous meeting'],
      },
      {
        id: 'mcm_previous_summary',
        label: 'Summary',
        type: 'text',
        placeholder: 'Summarise progress against the previous meeting actions, including anything still outstanding...',
      },
    ],
  },
  {
    id: 'opening',
    title: 'Opening the Meeting (5 minutes)',
    description: 'Use this agenda to set expectations and guide the coaching conversation.',
    icon: 'ri-play-circle-line',
    questions: [
      { id: 'mcm_agenda_presentation', label: 'Step 1: Learner Presentation & Review (15 minutes)', helpText: 'Presentation and work completed this month.', type: 'statement', required: false },
      { id: 'mcm_agenda_reflection', label: 'Step 2: Reflection on Knowledge, Skills and Behaviours (10 minutes)', helpText: 'Feedback on work and reflection on KSB development.', type: 'statement', required: false },
      { id: 'mcm_agenda_resources', label: 'Step 3: Learning Resources — Coach Guidance (5 minutes)', helpText: 'Resources and guidance to strengthen knowledge and skills.', type: 'statement', required: false },
      { id: 'mcm_agenda_next_month', label: 'Step 4: Preparing for Next Month (10 minutes)', helpText: 'Preparation for next month and expected evidence.', type: 'statement', required: false },
      { id: 'mcm_agenda_wellbeing', label: 'Step 5: Wellbeing & Safeguarding Check (5 minutes)', helpText: 'A wellbeing and safeguarding check.', type: 'statement', required: false },
      { id: 'mcm_agenda_feedback', label: 'Step 6: Learner Feedback on Teaching & Curriculum (5 minutes)', helpText: 'Feedback on teaching and the programme.', type: 'statement', required: false },
      { id: 'mcm_agenda_close', label: 'Step 7: Confirm Next Meeting & Close (5 minutes)', helpText: 'Confirm the next meeting and agreed actions.', type: 'statement', required: false },
    ],
  },
  {
    id: 'presentation',
    title: 'Learner Presentation & Review (15 minutes)',
    description: 'Review the learner’s presentation, monthly activity and KSB evidence.',
    icon: 'ri-presentation-line',
    questions: [
      {
        id: 'mcm_presentation_summary',
        label: 'Presentation & Review',
        helpText: 'Ask the learner to walk through their presentation, assignment activity and KSB evidence achieved this month.',
        type: 'text',
        placeholder: 'Summarise the presentation, work completed, evidence reviewed and feedback given...',
      },
    ],
  },
  {
    id: 'ksb-reflection',
    title: 'Reflection on Knowledge, Skills and Behaviours (10 minutes)',
    description: 'Capture the learner’s reflection across knowledge, skills and behaviours.',
    icon: 'ri-lightbulb-line',
    questions: [
      {
        id: 'mcm_knowledge_reflection',
        label: 'Knowledge reflection: How has your understanding of the key concepts covered this month developed, and how have you applied them in practice?',
        type: 'text',
        placeholder: 'Record the learner’s knowledge reflection and practical application...',
      },
      {
        id: 'mcm_skills_reflection',
        label: 'Skills reflection: What did you plan and deliver this month, and how did you set clear objectives and measures of success?',
        type: 'text',
        placeholder: 'Record the skills used, delivery approach and measures of success...',
      },
      {
        id: 'mcm_behaviour_reflection',
        label: 'Behaviour reflection: Thinking about the behaviour agreed in the last coaching meeting, how did you demonstrate it in practice and what impact did it have?',
        type: 'text',
        placeholder: 'Record a specific example and its impact...',
      },
      {
        id: 'mcm_behaviour_next_step',
        label: 'What would you do differently next time to strengthen that behaviour further, based on what you have learned?',
        type: 'text',
        placeholder: 'Record the learner’s next development step...',
      },
    ],
  },
  {
    id: 'next-month',
    title: 'Preparing for Next Month (10 minutes)',
    description: 'Agree the next learning focus and the evidence expected.',
    icon: 'ri-calendar-todo-line',
    questions: [
      {
        id: 'mcm_next_month_focus',
        label: 'Next Month Focus',
        type: 'text',
        placeholder: 'Record the modules, assignments, KSBs or workplace activity to focus on...',
      },
      {
        id: 'mcm_expected_evidence',
        label: 'Expected Evidence Next Month',
        type: 'text',
        placeholder: 'List the evidence, assignments or workplace outputs expected...',
      },
    ],
  },
  {
    id: 'resources',
    title: 'Learning Resources — Coach Guidance (5 minutes)',
    description: 'Recommend useful learning resources and confirm paid working-hour allocation.',
    icon: 'ri-book-open-line',
    questions: [
      {
        id: 'mcm_learning_resources',
        label: 'Learning Resources',
        type: 'text',
        placeholder: 'Recommend modules, readings, videos, templates, links or other guidance...',
      },
      {
        id: 'mcm_resources_read',
        label: 'Read',
        type: 'text',
        placeholder: 'List any specific reading or LMS material...',
      },
      {
        id: 'mcm_paid_hours_confirmed',
        label: 'Can you confirm that the hours allocated for submissions are accurate and have been completed during paid working hours?',
        type: 'yes-no',
      },
    ],
  },
  {
    id: 'wellbeing',
    title: 'Wellbeing & Safeguarding Check (5 minutes)',
    description: 'Check workload, wellbeing, safeguarding confidence and record any concern.',
    icon: 'ri-shield-check-line',
    questions: [
      { id: 'mcm_workload_manageable', label: 'Is the workload manageable?', type: 'agreement' },
      { id: 'mcm_wellbeing_impact', label: 'Is there anything affecting your wellbeing or ability to learn?', type: 'agreement' },
      {
        id: 'mcm_wellbeing_outcome',
        label: 'Coach records outcome',
        type: 'text',
        placeholder: 'Record any concerns raised, support agreed or confirm that no action is required...',
      },
      { id: 'mcm_safeguarding_contact_confidence', label: 'I know what safeguarding is and who to contact if I have a concern about myself or others.', type: 'agreement' },
      { id: 'mcm_wellbeing_support_confidence', label: 'I feel supported with my wellbeing and mental health during my studies.', type: 'agreement' },
      { id: 'mcm_safe_and_respected', label: 'I feel safe and respected during teaching sessions, online learning and workplace-related activities.', type: 'agreement' },
      { id: 'mcm_online_safety_prevent', label: 'I understand how to stay safe online and have received guidance on Prevent, radicalisation and extremism.', type: 'agreement' },
      { id: 'mcm_raise_concerns_confidence', label: 'I know how to raise concerns and feel confident that my tutor or coach would take them seriously.', type: 'agreement' },
      { id: 'mcm_provider_safeguarding_confidence', label: 'Overall, I feel that my training provider takes safeguarding and wellbeing seriously.', type: 'agreement' },
    ],
  },
  {
    id: 'feedback',
    title: 'Learner Feedback on Teaching & Curriculum (5 minutes)',
    description: 'Capture feedback on teaching, resources, assessment and learner support.',
    icon: 'ri-feedback-line',
    questions: [
      {
        id: 'mcm_learner_feedback',
        label: 'Learner Feedback',
        type: 'text',
        placeholder: 'Record the learner’s feedback, including anything they would like improved...',
      },
      { id: 'mcm_curriculum_planned', label: 'The curriculum is well planned, clearly sequenced and helps me build knowledge and skills over time in line with the apprenticeship standard.', type: 'agreement' },
      { id: 'mcm_teaching_well_delivered', label: 'Teaching sessions are well delivered and help me understand how learning links to my job role and assessment requirements.', type: 'agreement' },
      { id: 'mcm_resources_accessible', label: 'Learning resources are accessible, relevant and support my progress.', type: 'agreement' },
      { id: 'mcm_assessment_feedback_helpful', label: 'Assessment activities and feedback clearly help me improve and understand how my work contributes to meeting the KSBs.', type: 'agreement' },
      { id: 'mcm_tutor_support', label: 'I feel well supported by my tutor or coach and know where to go if I need help or additional support.', type: 'agreement' },
      { id: 'mcm_overall_learning_progress', label: 'Overall, the curriculum and teaching are helping me make progress and prepare effectively for assessment and my future role.', type: 'agreement' },
    ],
  },
  {
    id: 'confirm-next',
    title: 'Confirm Next Meeting & Close (5 minutes)',
    description: 'Confirm that the next session is booked and record its date.',
    icon: 'ri-calendar-check-line',
    questions: [
      {
        id: 'mcm_next_meeting_booked',
        label: 'Please confirm that the next session has been booked through the coaching booking system.',
        type: 'yes-no',
      },
      {
        id: 'mcm_next_meeting_date',
        label: 'The date for the next coaching session is',
        type: 'date',
      },
    ],
  },
  {
    id: 'meeting-summary',
    title: 'Meeting Summary',
    description: 'Create the final summary, keep any detailed notes and set the meeting outcome.',
    icon: 'ri-file-text-line',
    questions: [
      {
        id: 'mcm_meeting_summary',
        label: 'Summary',
        type: 'text',
        placeholder: 'Summarise progress, key discussion points, risks, support and next steps...',
      },
      {
        id: 'mcm_meeting_notes',
        label: 'Meeting notes',
        type: 'text',
        placeholder: 'Add any detailed coaching notes...',
        required: false,
      },
      { id: 'mcm_outcome', label: 'Select the overall meeting outcome.', type: 'rag' },
    ],
  },
];

export const MONTHLY_COACHING_RESPONSE_IDS = MONTHLY_COACHING_SECTIONS.flatMap(
  (section) => section.questions
    .filter((question) => question.type !== 'statement')
    .map((question) => question.id),
);

export const REQUIRED_MONTHLY_COACHING_RESPONSE_IDS = MONTHLY_COACHING_SECTIONS.flatMap(
  (section) => section.questions
    .filter((question) => question.type !== 'statement' && question.required !== false)
    .map((question) => question.id),
);

export function monthlyCoachingAnswers(
  responses: ProgressReviewResponses | undefined,
  sectionId: string,
) {
  const section = MONTHLY_COACHING_SECTIONS.find((item) => item.id === sectionId);
  if (!section || !responses) return [];
  return section.questions
    .map((question) => ({
      ...question,
      answer: question.type === 'statement'
        ? question.helpText || ''
        : responses[question.id]?.trim() || '',
    }))
    .filter((item) => item.answer);
}
