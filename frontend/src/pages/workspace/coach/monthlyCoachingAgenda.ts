import type { ProgressReviewSlidesDeck } from '@/pages/coach/progress-reviews/components/ProgressReviewSlidesModal';
import { eventDisplayDate, formatDateLabel, formatTimeLabel, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';

export function monthlyCoachingAgenda(event: CoachCalendarEvent): ProgressReviewSlidesDeck {
  return {
    learnerName: event.learner || 'Learner', reviewLabel: 'Monthly Coaching Agenda', generatedAt: new Date().toISOString(),
    windowLabel: formatDateLabel(eventDisplayDate(event)),
    slides: [
      { id: 'meeting', type: 'cover', title: 'Monthly Coaching', eyebrow: 'Meeting agenda', heading: event.learner || 'Monthly Coaching',
        subheading: 'A discussion guide for your scheduled coaching meeting.', details: [
          { label: 'Programme', value: event.programme || 'Not recorded' },
          { label: 'Date', value: formatDateLabel(eventDisplayDate(event)) },
          { label: 'Time', value: formatTimeLabel(event) },
          { label: 'Duration', value: `${event.durationMinutes || 60} minutes` },
          { label: 'Coach', value: event.ownerName || 'Your coach' },
        ] },
      { id: 'agenda', type: 'lists', title: 'Discussion', heading: 'Progress, learning and support', subheading: 'Use these prompts to guide the conversation.',
        columns: [
          { title: 'Reflect on the month', items: [{ title: 'Achievements and progress', detail: 'Discuss what has gone well since the last meeting.' },
            { title: 'Learning and evidence', detail: 'Review recent learning, off-the-job hours and available evidence.' }] },
          { title: 'Plan the next steps', items: [{ title: 'Challenges and support', detail: 'Discuss any barriers and support needed.' },
            { title: 'Actions and goals', detail: 'Agree the next actions, owners and review dates.' }] },
        ] },
      { id: 'actions', type: 'table', title: 'Next steps', heading: 'Agree your actions', subheading: 'Complete the meeting form with the agreed outcomes.',
        headers: ['Discussion point', 'To agree'], rows: [['Priority', 'What is the next learning goal?'], ['Action', 'What needs to happen?'],
          ['Owner', 'Who will complete the action?'], ['Review date', 'When will progress be reviewed?']],
        note: 'This agenda contains discussion prompts. It does not record attendance, completion or agreed outcomes.' },
    ],
  };
}
