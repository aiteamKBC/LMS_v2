import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdvancedAdminReview } from '@/api/advancedAdmin';
import { matchCoachingSessions } from './coachingMatch';
import StudentReviews from './StudentReviews';

const mcm: AdvancedAdminReview = {
  id: '11', aptemReviewId: 'aptem-mcm', name: 'September MCM', type: 'Monthly Coaching Meeting',
  status: 'completed', plannedDate: '2026-09-12', completedDate: '2026-09-12',
  sections: [{ id: 1, name: 'Targets', fields: [{ label: 'Outcome', value: 'On track' }] }],
  aiCoachingReport: { executive_summary: 'Meeting quality summary' },
};
const pr: AdvancedAdminReview = {
  ...mcm, id: '12', aptemReviewId: 'aptem-pr', name: 'Autumn Progress Review',
  type: 'Progress Review', status: 'awaiting-signature', completedDate: null,
  aiCoachingReport: null,
};
afterEach(() => vi.unstubAllGlobals());

it('hides unperformed reviews, removes MCM signatures and opens the coaching report view', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    signatures: { coach: true, student: false, manager: null },
  }) }));
  const reviews = { mcm: [mcm, { ...mcm, id: '13', name: 'Not Scheduled MCM', status: 'not-scheduled' }], pr: [pr] };
  render(<StudentReviews learnerId={42} reviews={reviews} coaching={[]}
    matches={matchCoachingSessions(reviews, [])} loading={false} />);

  expect(screen.queryByText('Not Scheduled MCM')).not.toBeInTheDocument();
  expect(screen.getByText('1 MCM · 1 Progress')).toBeInTheDocument();
  const mcmTable = screen.getByText('September MCM').closest('table')!;
  expect(within(mcmTable).queryByRole('columnheader', { name: 'Coach' })).not.toBeInTheDocument();
  expect(within(mcmTable).getAllByRole('button', { name: 'View' })).toHaveLength(1);
  const prRow = screen.getByText('Autumn Progress Review').closest('tr')!;
  await waitFor(() => expect(prRow).toHaveTextContent('Signed'));
  expect(prRow).toHaveTextContent('No signature');
  expect(prRow).toHaveTextContent('Unclear in PDF');
  expect(screen.getByText('Pending signatures').parentElement).toHaveTextContent('1');

  await user.click(within(mcmTable).getByRole('button', { name: 'View' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('tab')).toHaveLength(4);
  expect(within(dialog).getByText('Learner & Contacts')).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href',
    '/login_api/advanced-admin/learners/42/reviews/aptem-mcm/original-pdf/');
  await user.click(within(dialog).getByRole('tab', { name: 'AI Report' }));
  expect(within(dialog).getByText('Meeting quality summary')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Close review' }));
  await user.click(within(prRow).getByRole('button', { name: 'View' }));
  expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href',
    '/login_api/advanced-admin/learners/42/reviews/aptem-pr/original-pdf/');
  await user.click(within(screen.getByRole('dialog')).getByRole('tab', { name: 'Transcript' }));
  expect(within(screen.getByRole('dialog')).getByText('No coaching meeting could be uniquely matched to this review.')).toBeVisible();
});

it('shows transcript and scoped attendance for a uniquely matched meeting', async () => {
  const user = userEvent.setup();
  const reviews = { mcm: [mcm], pr: [] };
  const coaching = [{ id: '00000000-0000-4000-8000-000000000001', componentId: null,
    family: 'mcm' as const, plannedDate: '2026-09-12', actualStartAt: null,
    status: 'completed', aiStatus: 'completed', report: null }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    id: coaching[0].id, learnerName: 'Example Learner', learnerEmail: null, programme: 'Programme',
    group: null, coachName: 'Coach', managerName: null, managerEmail: null, family: 'mcm',
    plannedDate: '2026-09-12', actualStartAt: null, actualEndAt: null, status: 'completed',
    meetingId: null, learnerAttended: true, managerAttended: false,
    transcript: { content: 'WEBVTT\n\n00:00:03.000 --> 00:00:08.000\n<v Example Coach>Meeting transcript example</v>\n\n00:00:09.000 --> 00:00:12.000\n<v Example Learner>Agreed next steps.</v>', status: 'synced', durationSeconds: 60 },
    attendance: { status: 'synced', participantCount: 2, startAt: null, endAt: null,
      learner: { attended: true, durationSeconds: 3600, intervals: [] }, manager: null },
    aiStatus: 'completed', report: {
      executive_summary: 'Session report',
      overall_rating: { rag: 'Green', qualitative: 'Strong', average_rating: 4.4,
        professional_judgement: 'Well supported discussion.' },
      qa: [{ metric: 'Safeguarding and wellbeing check completed', rag: 'Green',
        result: 'Met', notes: 'Wellbeing was discussed.', rating_1_to_5: 5,
        evidence: [{ quote: 'We discussed wellbeing.', speaker: 'Example Coach', timecode: '00:10' }] }],
    },
  }) }));
  render(<StudentReviews learnerId={42} reviews={reviews} coaching={coaching}
    matches={matchCoachingSessions(reviews, coaching)} loading={false} />);
  await user.click(screen.getByRole('button', { name: 'View' }));
  await user.click(screen.getByRole('tab', { name: 'Transcript' }));
  expect(await screen.findByText('Meeting transcript example')).toBeInTheDocument();
  expect(screen.getByText('Example Coach')).toBeInTheDocument();
  expect(screen.getByText('Agreed next steps.')).toBeInTheDocument();
  expect(screen.queryByText('WEBVTT')).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Attendance' }));
  expect(screen.getByText('Attended · 60 min')).toBeInTheDocument();
  expect(screen.getByText('Session Metrics')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'AI Report' }));
  expect(screen.getByText('Session report')).toBeInTheDocument();
  expect(screen.getByText('AI Quality Report')).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
  expect(screen.getByText('Safeguarding and wellbeing check completed')).toBeInTheDocument();
  await user.click(screen.getByText('Evidence'));
  expect(screen.getByText('We discussed wellbeing.')).toBeInTheDocument();
});

it.each([
  { name: 'without saved text', meetingId: 'meeting-one', status: 'completed', transcript: null,
    expected: 'No transcript text is stored for this meeting. A completed review or PDF does not confirm that a transcript was captured.' },
  { name: 'without a meeting ID', meetingId: null, status: 'matching_failed', transcript: null,
    expected: 'This session has no linked meeting ID, so a transcript cannot be shown.' },
  { name: 'while processing', meetingId: 'meeting-one', status: 'waiting_for_transcript', transcript: null,
    expected: 'The transcript for this meeting is still being processed. Check again later.' },
])('explains transcript availability $name across review details', async ({ meetingId, status, transcript, expected }) => {
  const user = userEvent.setup();
  const reviews = { mcm: [{ ...mcm, componentId: 41, aiCoachingReport: null }], pr: [] };
  const coaching = [{ id: '00000000-0000-4000-8000-000000000002', componentId: 41,
    family: 'mcm' as const, plannedDate: '2026-09-12', actualStartAt: null,
    status, aiStatus: 'pending', report: null }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    id: coaching[0].id, learnerName: 'Example Learner', learnerEmail: null, programme: 'Programme',
    group: null, coachName: 'Coach', managerName: null, managerEmail: null, family: 'mcm',
    plannedDate: '2026-09-12', actualStartAt: null, actualEndAt: null, status, meetingId,
    learnerAttended: false, managerAttended: false, transcript,
    attendance: meetingId ? { status: 'synced', participantCount: 0, startAt: null, endAt: null,
      learner: null, manager: null } : null,
    aiStatus: 'pending', report: null,
  }) }));
  render(<StudentReviews learnerId={42} reviews={reviews} coaching={coaching}
    matches={matchCoachingSessions(reviews, coaching)} loading={false} />);
  await user.click(screen.getByRole('button', { name: 'View' }));
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByText(expected)).toBeVisible();
  if (!meetingId) {
    expect(within(dialog).getByText('No meeting matched')).toBeVisible();
    expect(within(dialog).getByText('No AI report is stored for this review; no meeting is linked to this session.')).toBeVisible();
  }
  await user.click(within(dialog).getByRole('tab', { name: 'Transcript' }));
  expect(within(dialog).getByText(expected)).toBeVisible();
  await user.click(within(dialog).getByRole('tab', { name: 'AI Report' }));
  expect(within(dialog).getByText(meetingId ? 'No AI report is stored for this meeting.'
    : 'No AI report is stored for this review; no meeting is linked to this session.')).toBeVisible();
  await user.click(within(dialog).getByRole('tab', { name: 'Attendance' }));
  if (meetingId) expect(within(dialog).getByText(expected)).toBeVisible();
  else expect(within(dialog).getByText('No attendance report is stored for this meeting.')).toBeVisible();
});

it('keeps a Personal Support Plan PDF available when its template has no signature fields', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    signatures: { coach: null, student: null, manager: null },
  }) }));
  const supportPlan = { ...pr, id: '15', aptemReviewId: 'support-plan',
    name: 'Personal Support Plan', type: 'Personal Support Plan', status: 'completed' as const };
  const reviews = { mcm: [], pr: [supportPlan] };
  render(<StudentReviews learnerId={42} reviews={reviews} coaching={[]}
    matches={matchCoachingSessions(reviews, [])} loading={false} />);
  const row = screen.getAllByText('Personal Support Plan')[0].closest('tr')!;
  await waitFor(() => expect(within(row).getAllByText('No signature field')).toHaveLength(3));
  expect(screen.getByText('Pending signatures').parentElement).toHaveTextContent('0');
});
