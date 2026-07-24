import type { ProgressReviewAnswerType, ProgressReviewResponses } from './progressReviewForm';

export interface MonthlyCoachingQuestion {
  id: string;
  label: string;
  type: ProgressReviewAnswerType;
  placeholder?: string;
}

export interface MonthlyCoachingSection {
  id: string;
  title: string;
  icon: string;
  questions: MonthlyCoachingQuestion[];
}

export const MONTHLY_COACHING_SECTIONS: MonthlyCoachingSection[] = [
  {
    id: 'previous-summary',
    title: 'Previous Meeting Summary',
    icon: 'ri-history-line',
    questions: [
      { id: 'mcm_previous_summary', label: 'Summarise progress against the actions agreed at the previous meeting.', type: 'text', placeholder: 'Record completed and outstanding actions...' },
      { id: 'mcm_previous_barriers', label: 'Are any previous barriers or concerns still outstanding?', type: 'text', placeholder: 'Describe remaining barriers or confirm that none remain...' },
    ],
  },
  {
    id: 'opening',
    title: 'Opening the Meeting (5 minutes)',
    icon: 'ri-play-circle-line',
    questions: [
      { id: 'mcm_opening_checkin', label: 'Record the learner check-in and current priorities.', type: 'text', placeholder: 'How is the learner and what would they like to focus on?' },
      { id: 'mcm_agenda_agreed', label: 'Confirm the agenda and purpose agreed for this meeting.', type: 'text', placeholder: 'Record the agreed focus for the session...' },
    ],
  },
  {
    id: 'presentation',
    title: 'Learner Presentation & Review (15 minutes)',
    icon: 'ri-presentation-line',
    questions: [
      { id: 'mcm_presentation_summary', label: 'Summarise the learner’s presentation and learning completed this month.', type: 'text', placeholder: 'Include activities, evidence and workplace application...' },
      { id: 'mcm_presentation_feedback', label: 'Record the feedback given on the learner’s presentation.', type: 'text', placeholder: 'Capture strengths and development points...' },
    ],
  },
  {
    id: 'ksb-reflection',
    title: 'Reflection on Knowledge, Skills, and Behaviours (10 minutes)',
    icon: 'ri-lightbulb-line',
    questions: [
      { id: 'mcm_ksb_reflection', label: 'Which knowledge, skills and behaviours were discussed?', type: 'text', placeholder: 'List the KSBs and evidence discussed...' },
      { id: 'mcm_workplace_application', label: 'How has the learner applied this learning in the workplace?', type: 'text', placeholder: 'Record clear workplace examples and impact...' },
    ],
  },
  {
    id: 'next-month',
    title: 'Preparing for Next Month (10 minutes)',
    icon: 'ri-calendar-todo-line',
    questions: [
      { id: 'mcm_next_month_targets', label: 'What learning and development targets are agreed for next month?', type: 'text', placeholder: 'List measurable targets and expected outcomes...' },
      { id: 'mcm_next_month_actions', label: 'Confirm each action owner and due date.', type: 'text', placeholder: 'Record owners, due dates and success measures...' },
    ],
  },
  {
    id: 'resources',
    title: 'Learning Resources – Coach Guidance (5 minutes)',
    icon: 'ri-book-open-line',
    questions: [
      { id: 'mcm_resources_guidance', label: 'What learning resources or coach guidance were recommended?', type: 'text', placeholder: 'Add links, resources, modules or guidance...' },
    ],
  },
  {
    id: 'wellbeing',
    title: 'Wellbeing & Safeguarding Check (5 minutes)',
    icon: 'ri-shield-check-line',
    questions: [
      { id: 'mcm_wellbeing_check', label: 'Record the wellbeing and safeguarding check.', type: 'text', placeholder: 'Record topics discussed and any concerns...' },
      { id: 'mcm_safeguarding_action', label: 'What follow-up or safeguarding action is required?', type: 'text', placeholder: 'Record actions or confirm that no action is required...' },
    ],
  },
  {
    id: 'feedback',
    title: 'Learner Feedback on Teaching & Curriculum (5 minutes)',
    icon: 'ri-feedback-line',
    questions: [
      { id: 'mcm_learner_feedback', label: 'What feedback did the learner provide on teaching and curriculum?', type: 'text', placeholder: 'Capture positive feedback and improvements requested...' },
      { id: 'mcm_learning_rating', label: 'Learner experience rating', type: 'rating' },
    ],
  },
  {
    id: 'confirm-next',
    title: 'Confirm Next Meeting & Close (5 minutes)',
    icon: 'ri-calendar-check-line',
    questions: [
      { id: 'mcm_next_meeting', label: 'Confirm the next meeting date and preparation required.', type: 'text', placeholder: 'Record date, time and preparation actions...' },
      { id: 'mcm_close_confirmation', label: 'Record the learner’s confirmation of the agreed actions.', type: 'text', placeholder: 'Confirm understanding and commitment...' },
    ],
  },
  {
    id: 'meeting-summary',
    title: 'Meeting Summary',
    icon: 'ri-file-text-line',
    questions: [
      { id: 'mcm_meeting_summary', label: 'Write the final monthly coaching meeting summary.', type: 'text', placeholder: 'Summarise progress, key discussion points, risks and next steps...' },
      { id: 'mcm_outcome', label: 'Select the overall meeting outcome.', type: 'rag' },
    ],
  },
];

export const REQUIRED_MONTHLY_COACHING_RESPONSE_IDS = MONTHLY_COACHING_SECTIONS.flatMap(
  (section) => section.questions.map((question) => question.id),
);

export function monthlyCoachingAnswers(
  responses: ProgressReviewResponses | undefined,
  sectionId: string,
) {
  const section = MONTHLY_COACHING_SECTIONS.find((item) => item.id === sectionId);
  if (!section || !responses) return [];
  return section.questions
    .map((question) => ({ ...question, answer: responses[question.id]?.trim() || '' }))
    .filter((item) => item.answer);
}
