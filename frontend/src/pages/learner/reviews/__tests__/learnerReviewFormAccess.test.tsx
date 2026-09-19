/**
 * View on a learner Review occurrence opens the ONE Curriculum Review form.
 *
 * Both learner Review pages used to draw a hard-coded accordion list per Review
 * type ("Opening the Meeting (5 minutes)", "Learner Reflections & Ratings", ...)
 * out of the legacy `reviewResponses` blob. These pin the replacement: when the
 * occurrence has a review instance, the page renders ReviewFormRenderer over the
 * Curriculum-authored definition -- the same renderer the coach's
 * ReviewInstanceModal uses -- and nothing routes on a Review Template's NAME.
 */
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonthlyCoachingPage from '../../monthly-coaching/page';
import ProgressReviewsPage from '../../progress-reviews/page';
import { AppIcon } from '@/components/feature/AppIcon';
import { ToastProvider } from '@/hooks/useToast';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import { LearnerReviewInstanceForm, useLearnerReviewInstance } from '../LearnerReviewInstanceForm';
import type { ReviewInstanceFormDefinition } from '@/api/reviewInstances';

const access = vi.hoisted(() => ({ canProgress: true }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => access }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: 'Aya Khater' } }, isInitialized: true }) }));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ onCommit, onCancel }: { onCommit: (signature: string) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onCommit('data:image/png;base64,c2F2ZWQ=')}>Sign</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('@/hooks/useMyLearner', () => ({
  useMyLearner: () => ({ kind: 'apprenticeship', id: '12' }),
  useLinkedLearner: () => ({ kind: 'apprenticeship', id: '12' }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const SCHEDULED_MCM = 'mcr:12:1:2026-09-03';
const UNSCHEDULED_MCM = 'mcr:12:2:2026-10-01';
const SCHEDULED_PR = 'progress-review:12:1:2026-09-10';

function event(overrides: Partial<LearnerCalendarEvent> & Pick<LearnerCalendarEvent, 'id'>): LearnerCalendarEvent {
  return {
    eventKey: overrides.id,
    // The backend already titles every Curriculum Review occurrence with its
    // template's live name -- deliberately NOT "Monthly Coaching Meeting".
    title: 'Monthly Learner Catch-up',
    source: 'mcr',
    type: 'coaching',
    sequence: 1,
    reviewTemplateId: 'REV-1',
    reviewInstanceId: null,
    reviewTypeId: 'REVT-MCM',
    reviewTypeCode: 'mcm',
    reviewTypeName: 'Monthly Coaching Meeting',
    reviewTypeIsSystem: true,
    occurrenceNumber: 1,
    status: 'scheduled',
    date: '2026-09-03',
    targetDate: '2026-09-03',
    scheduledDate: '2026-09-03',
    scheduledTime: '10:00',
    durationMinutes: 60,
    coachName: 'Coach One',
    coachEmail: 'coach@example.com',
    meetingProvider: 'Microsoft Teams',
    meetingLink: '',
    notes: '',
    reviewResponses: {},
    ...overrides,
  };
}

function definition(overrides: { name?: string; sections?: ReviewInstanceFormDefinition['sections'] } = {}): ReviewInstanceFormDefinition {
  return {
    manualOverride: null,
    instance: {
      id: 'REVI-1', reviewTemplateId: 'REV-1', learnerId: 12, programmeId: 'PROG-1',
      occurrenceNumber: 1, targetDate: '2026-09-03', status: 'scheduled',
      startedAt: null, completedAt: null,
    },
    template: {
      id: 'REV-1',
      name: overrides.name ?? 'Monthly Learner Catch-up',
      signatures: { advisor: true, employer: false, participant: true, referrer: false },
      visibleTo: { advisor: true, employer: true, participant: true, referrer: true },
      recurrence: { interval: 4, unit: 'weeks' },
      notifications: { employer: false, participant: false },
      allowEditingPriorDays: 0,
    },
    sections: overrides.sections ?? [{
      id: 'SEC-1', title: 'Curriculum-authored section', estimatedMinutes: 10, displayOrder: 1, enabled: true,
      fields: [
        {
          id: 'FLD-1', title: 'What did the learner complete?', fieldType: 'text',
          required: true, displayOrder: 1, configuration: {}, answer: 'Two modules and a reflection.',
        },
        {
          id: 'FLD-2', title: 'Any safeguarding concerns?', fieldType: 'boolean_case_block',
          required: true, displayOrder: 2, configuration: {}, answer: 'yes',
          yesFields: [{
            id: 'FLD-3', title: 'Describe the concern', fieldType: 'text_multiline',
            required: true, displayOrder: 1, configuration: {}, answer: 'Raised with the safeguarding lead.',
          }],
          noFields: [],
        },
      ],
    }],
    signatures: {
      advisor: { required: true, signed: false },
      employer: { required: false, signed: false },
      participant: { required: true, signed: false },
      referrer: { required: false, signed: false },
    },
  };
}

// The legacy hard-coded section headings -- one per page. None of these may
// appear once the occurrence has a Curriculum Review instance.
const LEGACY_MCM_HEADINGS = [
  'Opening the Meeting (5 minutes)',
  'Reflection on Knowledge, Skills, and Behaviours (10 minutes)',
  'Confirm Next Meeting & Close (5 minutes)',
];
const LEGACY_PR_HEADINGS = [
  'Progress Checks',
  'Learner Reflections & Ratings',
  'Manager Reflections & Ratings',
];

let events: LearnerCalendarEvent[];
let reviewDefinition: LearnerReviewDefinition;
let requested: string[];
let definitionError: string;
let blankDefinition: boolean;

beforeEach(() => {
  clearAllCachedResources();
  window.localStorage.clear();
  requested = [];
  access.canProgress = true;
  definitionError = '';
  blankDefinition = false;
  reviewDefinition = definition();
  events = [
    event({ id: SCHEDULED_MCM, reviewInstanceId: 'REVI-1' }),
    event({
      id: UNSCHEDULED_MCM, sequence: 2, occurrenceNumber: 2, status: 'not-scheduled',
      reviewInstanceId: null, date: '2026-10-01', targetDate: '2026-10-01',
      scheduledDate: null, scheduledTime: null,
    }),
    event({
      id: SCHEDULED_PR, source: 'progress-review', type: 'review',
      title: 'Quarterly Progress Conversation', reviewTemplateId: 'REV-2',
      reviewInstanceId: 'REVI-2', reviewTypeId: 'REVT-PROGRESS_REVIEW',
      reviewTypeCode: 'progress_review', reviewTypeName: 'Progress Review',
      date: '2026-09-10', targetDate: '2026-09-10', scheduledDate: '2026-09-10',
    }),
  ];
  vi.stubGlobal('React', React);
  vi.stubGlobal('AppIcon', AppIcon);
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/review/')) return definitionError
      ? new Response(JSON.stringify({ error: definitionError }), { status: 503 })
      : new Response(JSON.stringify(blankDefinition ? { instance: null } : reviewDefinition));
    if (url.includes('/learner_api/calendar/')) {
      return new Response(JSON.stringify({ learner: { kind: 'apprenticeship', id: 12 }, events }));
    }
    if (url.includes('/learner-detail/')) {
      return new Response(JSON.stringify({
        name: 'Aya Khater', programme: 'Business', components: [],
        quizAttempts: [], videoProgress: [], componentProgress: [],
      }));
    }
    return new Response(JSON.stringify({}));
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearAllCachedResources();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ReturnedLocation() {
  const location = useLocation();
  return <output data-testid="returned-location">{location.pathname}{location.search}</output>;
}

const mountMcm = (id: string, suffix = '') => render(
  <MemoryRouter initialEntries={[`/learner/monthly-coaching/${encodeURIComponent(id)}${suffix}`]}>
    <Routes>
      <Route path="/learner/monthly-coaching/:sessionId" element={<MonthlyCoachingPage />} />
      <Route path="/learner/monthly-coaching" element={<ReturnedLocation />} />
      <Route path="/learner/monthly-logs/:kind/:id/:month" element={<ReturnedLocation />} />
    </Routes>
  </MemoryRouter>,
);

// The Progress Review page mounts the shared slides modal, which reads the
// toast context; the provider is scaffolding, not part of what is under test.
const mountProgressReview = (id: string) => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[`/learner/progress-reviews/${encodeURIComponent(id)}`]}>
      <Routes><Route path="/learner/progress-reviews/:reviewId" element={<ProgressReviewsPage />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

describe('Learner Review View opens the generic Curriculum form', () => {
  it.each([true, false])('opens current month logs from an unfinished MCM with learner actions enabled: %s', async canProgress => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    access.canProgress = canProgress;
    mountMcm(SCHEDULED_MCM);
    await screen.findByTestId('learner-review-instance-form');

    fireEvent.click(screen.getByRole('link', { name: "This month's logs" }));

    expect(screen.getByTestId('returned-location')).toHaveTextContent('/learner/monthly-logs/apprenticeship/12/2026-11');
    expect(vi.mocked(fetch).mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
  });

  it('shows the saved learner image and points to the pending coach without asking the learner to sign again', () => {
    reviewDefinition.instance!.status = 'awaiting-signature';
    reviewDefinition.signatures.participant = { required: true, signed: true, signedName: 'Aya Khater', signature: 'data:image/png;base64,c2F2ZWQ=', signedAt: '2026-09-14T15:38:56Z' };
    const onSign = vi.fn();
    render(<LearnerReviewInstanceForm definition={reviewDefinition} onSign={onSign} signatoryName="Aya Khater" />);
    expect(screen.getByRole('img', { name: 'Learner signature' })).toHaveAttribute('src', 'data:image/png;base64,c2F2ZWQ=');
    expect(screen.getByText('Your signature is saved')).toBeVisible();
    expect(screen.getByText('The coach still needs to sign this review.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    const scroll = vi.fn();
    const step = screen.getByLabelText('Signature step');
    step.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole('button', { name: 'View signatures' }));
    expect(scroll).toHaveBeenCalled();
    expect(step).toHaveFocus();
    expect(onSign).not.toHaveBeenCalled();
  });

  it('lets the learner leave and reopen signature capture without saving', () => {
    reviewDefinition.instance!.status = 'awaiting-signature';
    const onSign = vi.fn();
    render(<LearnerReviewInstanceForm definition={reviewDefinition} onSign={onSign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    screen.getByLabelText('Signature step').scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Review & sign' }));
    expect(screen.getByRole('button', { name: 'Sign' })).toBeVisible();
    expect(onSign).not.toHaveBeenCalled();
  });

  it('explains that the coach must submit first and blocks learner signing of a draft', () => {
    render(<LearnerReviewInstanceForm definition={reviewDefinition} onSign={vi.fn()} />);
    expect(screen.getByText('Your coach is preparing this review')).toBeVisible();
    expect(screen.getByText('The coach must complete this review before you can sign it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  });

  it('reloads the saved learner signature after signing a monthly coaching review and keeps the coach pending', async () => {
    reviewDefinition.instance!.status = 'awaiting-signature';
    const savedMark = 'data:image/png;base64,c2F2ZWQ=';
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let signatureWrites = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/sign/')) {
        signatureWrites += 1;
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'Aya Khater', signature: savedMark });
        reviewDefinition = structuredClone(reviewDefinition);
        reviewDefinition.signatures.participant = { required: true, signed: true, signature: savedMark, signedName: 'Aya Khater', signedAt: '2026-09-14T15:38:56Z' };
        return new Response(JSON.stringify({ event: { ...events[0], status: 'awaiting-signature' }, review: reviewDefinition }));
      }
      return originalFetch(input, init);
    });
    mountMcm(SCHEDULED_MCM);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    expect(await screen.findByRole('img', { name: 'Learner signature' })).toHaveAttribute('src', savedMark);
    expect(screen.getByText('Your signature is saved')).toBeVisible();
    expect(screen.getByText('The coach still needs to sign this review.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    expect(signatureWrites).toBe(1);
  });

  it('keeps a staff preview readable without offering the learner signature', async () => {
    access.canProgress = false;
    reviewDefinition.instance!.status = 'awaiting-signature';
    mountMcm(SCHEDULED_MCM);

    await screen.findByTestId('learner-review-instance-form');
    expect(await screen.findByDisplayValue('Two modules and a reflection.')).toBeVisible();
    expect(screen.getByText('Signatures')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your signature is required')).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
  });

  it('returns to the same learner, archive tab and page after reading a meeting', async () => {
    mountMcm(SCHEDULED_MCM, '?kind=apprenticeship&learner=12&view=all&tab=past&page=3');
    await screen.findByTestId('learner-review-instance-form');
    fireEvent.click(screen.getByRole('button', { name: 'Back to coaching meetings' }));

    expect(await screen.findByTestId('returned-location')).toHaveTextContent('/learner/monthly-coaching?kind=apprenticeship&learner=12&view=all&tab=past&page=3');
  });

  it('keeps the monthly log reminder inline while the learner reviews and signs', async () => {
    reviewDefinition.instance!.status = 'awaiting-signature';
    mountMcm(SCHEDULED_MCM);

    expect(await screen.findByRole('button', { name: 'Sign' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Monthly learning log' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open monthly log' })).toHaveAttribute('href', '/learner/monthly-logs/apprenticeship/12/2026-09?workflow=mcm&source=mcm');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('falls back to the saved meeting summary when a legacy meeting has no Curriculum form', async () => {
    blankDefinition = true;
    events = [event({
      id: SCHEDULED_MCM,
      status: 'completed',
      reviewInstanceId: null,
      reviewResponses: { mcm_meeting_summary: 'Learner is progressing well.' },
    })];

    mountMcm(SCHEDULED_MCM);

    const summary = (await screen.findByText('Meeting Summary', { exact: true })).closest('button');
    expect(summary).toBeVisible();
    fireEvent.click(summary!);
    expect(screen.getByText('Learner is progressing well.')).toBeVisible();
    expect(screen.queryByText('This review form is not available.')).not.toBeInTheDocument();
  });

  it('shows a signature save error, prevents duplicate submissions and allows retry', async () => {
    reviewDefinition.instance!.status = 'awaiting-signature';
    let rejectSave!: (reason: Error) => void;
    const onSign = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
    render(<LearnerReviewInstanceForm definition={reviewDefinition} onSign={onSign} signatoryName="Aya Khater" />);

    const sign = screen.getByRole('button', { name: 'Sign' });
    fireEvent.click(sign);
    expect(await screen.findByRole('status')).toHaveTextContent('Saving your signature');
    expect(sign).toBeDisabled();
    fireEvent.click(sign);
    expect(onSign).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error('Your signature could not be saved.')));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your signature could not be saved.');
    expect(sign).toBeEnabled();
    fireEvent.click(sign);
    await waitFor(() => expect(onSign).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('reports a failed signature refresh without showing stale signature data and recovers on retry', async () => {
    const { result } = renderHook(() => useLearnerReviewInstance('apprenticeship', '12', SCHEDULED_MCM));
    await waitFor(() => expect(result.current.definition).not.toBeNull());
    definitionError = 'Could not reload the saved review.';
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.error).toBe(definitionError));
    expect(result.current.definition).toBeNull();
    expect(result.current.loading).toBe(false);
    definitionError = '';
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.definition).not.toBeNull());
    expect(result.current.error).toBe('');
  });

  it('refreshes signature state on the same occurrence after signing', async () => {
    reviewDefinition = definition();
    reviewDefinition.instance!.status = 'awaiting-signature';
    const { result } = renderHook(() => useLearnerReviewInstance('apprenticeship', '12', SCHEDULED_MCM));
    await waitFor(() => expect(result.current.definition?.signatures.participant.signed).toBe(false));

    reviewDefinition = {
      ...reviewDefinition,
      signatures: { ...reviewDefinition.signatures, participant: { required: true, signed: true, signedName: 'Aya Khater' } },
    };
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.definition?.signatures.participant.signed).toBe(true));
    expect(requested.filter(url => url.includes(`${encodeURIComponent(SCHEDULED_MCM)}/review/`))).toHaveLength(2);
    expect(result.current.error).toBe('');
  });

  it('a scheduled MCM opens the Review instance form, not the hard-coded MCM form', async () => {
    mountMcm(SCHEDULED_MCM);

    await screen.findByTestId('learner-review-instance-form');
    // Sections and questions come from Curriculum, answers included.
    expect(screen.getByText('Curriculum-authored section')).toBeInTheDocument();
    expect(await screen.findByText('What did the learner complete?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Two modules and a reflection.')).toBeInTheDocument();
    // Conditional children follow the parent's saved answer.
    expect(screen.getByText('Describe the concern')).toBeInTheDocument();
    // And nothing hard-coded survives.
    for (const heading of LEGACY_MCM_HEADINGS) expect(screen.queryByText(heading)).toBeNull();

    expect(requested.some((url) => url.includes(`${encodeURIComponent(SCHEDULED_MCM)}/review/`))).toBe(true);
  });

  it('a scheduled Progress Review opens the same generic form', async () => {
    reviewDefinition = definition({ name: 'Quarterly Progress Conversation' });
    mountProgressReview(SCHEDULED_PR);

    await screen.findByTestId('learner-review-instance-form');
    expect(screen.getByText('Curriculum-authored section')).toBeInTheDocument();
    expect(await screen.findByText('What did the learner complete?')).toBeInTheDocument();
    for (const heading of LEGACY_PR_HEADINGS) expect(screen.queryByText(heading)).toBeNull();
  });

  it('a custom Review Type uses the same generic form', async () => {
    events = [event({
      id: SCHEDULED_MCM, title: 'Career Conversation', reviewInstanceId: 'REVI-3',
      reviewTypeId: 'REVT-CAREER', reviewTypeCode: 'career_review', reviewTypeName: 'Career Review',
      reviewTypeIsSystem: false,
    })];
    reviewDefinition = definition({
      name: 'Career Conversation',
      sections: [{
        id: 'SEC-9', title: 'Where next?', estimatedMinutes: 15, displayOrder: 1, enabled: true,
        fields: [{
          id: 'FLD-9', title: 'What role are you aiming for?', fieldType: 'text',
          required: true, displayOrder: 1, configuration: {}, answer: 'Team lead.',
        }],
      }],
    });
    render(<LearnerReviewInstanceForm definition={reviewDefinition} />);

    await screen.findByTestId('learner-review-instance-form');
    // A custom type's own sections
    // render through the identical renderer.
    expect(screen.getByText('Where next?')).toBeInTheDocument();
    expect(await screen.findByText('What role are you aiming for?')).toBeInTheDocument();
  });

  it('an unscheduled occurrence reads a template preview without creating an instance', async () => {
    reviewDefinition = { ...definition(), instance: null, occurrenceNumber: 2 };
    mountMcm(UNSCHEDULED_MCM);

    expect(await screen.findByTestId('learner-review-instance-form')).toBeInTheDocument();
    expect(screen.getByTestId('learner-review-instance-title')).toHaveTextContent('#2');
    expect(screen.queryByText(LEGACY_MCM_HEADINGS[0])).toBeNull();
    await waitFor(() => expect(requested.some(url => url.includes('/review/'))).toBe(true));
    for (const call of vi.mocked(fetch).mock.calls) expect(call[1]?.method || 'GET').toBe('GET');
  });

  it('the Review Template name is the title and nothing matches on it', async () => {
    reviewDefinition = definition({ name: 'Renamed Coaching Conversation' });
    mountMcm(SCHEDULED_MCM);

    await screen.findByTestId('learner-review-instance-form');
    // The title follows the template's live name...
    expect(screen.getByTestId('learner-review-instance-title')).toHaveTextContent('Renamed Coaching Conversation #1');
    // ...the Review Type stays a classification label, never the title...
    expect(screen.queryByTestId('learner-review-instance-title')).not.toHaveTextContent('Monthly Coaching Meeting');
    // ...and the form itself is unchanged by the rename.
    expect(screen.getByText('Curriculum-authored section')).toBeInTheDocument();
  });
});
