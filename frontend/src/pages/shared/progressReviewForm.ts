export type ProgressReviewAnswerType = 'text' | 'rating' | 'rag';

export interface ProgressReviewQuestion {
  id: string;
  label: string;
  type: ProgressReviewAnswerType;
  placeholder?: string;
}

export interface ProgressReviewSection {
  id: string;
  title: string;
  icon: string;
  questions: ProgressReviewQuestion[];
}

export type ProgressReviewResponses = Record<string, string>;

export const PROGRESS_REVIEW_SECTIONS: ProgressReviewSection[] = [
  {
    id: 'learning',
    title: 'Learning Progress & Summary',
    icon: 'ri-graduation-cap-line',
    questions: [
      { id: 'learning_summary', label: 'Summarise the learner’s progress since the previous review.', type: 'text', placeholder: 'Cover learning completed, evidence and KSB development...' },
      { id: 'key_achievements', label: 'What are the learner’s key achievements during this review period?', type: 'text', placeholder: 'Record the strongest achievements and examples...' },
    ],
  },
  {
    id: 'progress-checks',
    title: 'Progress Checks',
    icon: 'ri-check-double-line',
    questions: [
      { id: 'progress_checks', label: 'Summarise progress against the learning plan, KSBs and previous actions.', type: 'text', placeholder: 'Record progress against each key measure...' },
      { id: 'attendance_progress', label: 'Record the attendance and engagement discussion.', type: 'text', placeholder: 'Include attendance patterns and engagement concerns...' },
      { id: 'otjh_progress', label: 'Record the learner’s OTJH position and any agreed action.', type: 'text', placeholder: 'Include hours completed, variance and next steps...' },
    ],
  },
  {
    id: 'learner-reflection',
    title: 'Learner Reflections & Ratings',
    icon: 'ri-user-heart-line',
    questions: [
      { id: 'learner_reflection', label: 'Summarise the learner’s reflection and how they feel about their progress.', type: 'text', placeholder: 'Capture the learner’s own reflection...' },
      { id: 'learner_rating', label: 'Learner progress rating', type: 'rating' },
    ],
  },
  {
    id: 'manager-reflection',
    title: 'Manager Reflections & Ratings',
    icon: 'ri-briefcase-line',
    questions: [
      { id: 'manager_reflection', label: 'Record the manager’s feedback on workplace performance and application.', type: 'text', placeholder: 'Capture manager feedback and workplace examples...' },
      { id: 'manager_rating', label: 'Manager progress rating', type: 'rating' },
    ],
  },
  {
    id: 'tutor-reflection',
    title: 'Tutor Reflections & Ratings',
    icon: 'ri-user-star-line',
    questions: [
      { id: 'tutor_reflection', label: 'Record your professional assessment of the learner’s progress.', type: 'text', placeholder: 'Include strengths, gaps and recommended focus...' },
      { id: 'tutor_rating', label: 'Tutor progress rating', type: 'rating' },
    ],
  },
  {
    id: 'safeguarding',
    title: 'Safeguarding & Key Themes',
    icon: 'ri-shield-check-line',
    questions: [
      { id: 'safeguarding_discussion', label: 'Record the safeguarding and wellbeing discussion.', type: 'text', placeholder: 'Record topics discussed and any concerns raised...' },
      { id: 'key_themes', label: 'Which key themes were discussed?', type: 'text', placeholder: 'For example Prevent, British Values, EDI, online safety or wellbeing...' },
    ],
  },
  {
    id: 'additional-support',
    title: 'Additional Support',
    icon: 'ri-hand-heart-line',
    questions: [
      { id: 'support_required', label: 'Does the learner require any additional support?', type: 'text', placeholder: 'Describe the support need or confirm that none is required...' },
      { id: 'support_plan', label: 'What support actions, owner and review date have been agreed?', type: 'text', placeholder: 'Record the support plan, responsible person and timescale...' },
    ],
  },
  {
    id: 'actions',
    title: 'Progress Targets & Actions',
    icon: 'ri-focus-3-line',
    questions: [
      { id: 'targets_actions', label: 'What targets and actions have been agreed before the next review?', type: 'text', placeholder: 'List clear actions, owners and target dates...' },
      { id: 'action_owners_dates', label: 'Confirm the owner and due date for each agreed action.', type: 'text', placeholder: 'List each owner and target completion date...' },
    ],
  },
  {
    id: 'rag',
    title: 'RAG Status',
    icon: 'ri-traffic-light-line',
    questions: [
      { id: 'rag_status', label: 'Select the overall RAG status.', type: 'rag' },
      { id: 'rag_reason', label: 'Explain the reason for this RAG status.', type: 'text', placeholder: 'Explain the evidence behind the selected status...' },
    ],
  },
];

export const REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS = PROGRESS_REVIEW_SECTIONS.flatMap(
  (section) => section.questions.map((question) => question.id),
);

export function responsesForSection(
  responses: ProgressReviewResponses | undefined,
  sectionId: string,
) {
  const section = PROGRESS_REVIEW_SECTIONS.find((item) => item.id === sectionId);
  if (!section || !responses) return [];
  return section.questions
    .map((question) => ({ ...question, answer: responses[question.id]?.trim() || '' }))
    .filter((item) => item.answer);
}
