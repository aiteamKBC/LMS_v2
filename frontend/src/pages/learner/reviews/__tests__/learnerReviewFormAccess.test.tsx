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
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonthlyCoachingPage from '../../monthly-coaching/page';
import ProgressReviewsPage from '../../progress-reviews/page';
import { CurriculumReviewPage } from '../curriculumReviews';
import { AppIcon } from '@/components/feature/AppIcon';
import { ToastProvider } from '@/hooks/useToast';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import { LearnerReviewInstanceForm } from '../LearnerReviewInstanceForm';
import { useLearnerReviewInstance } from "../LearnerReviewInstanceForm.helpers";
import type { ReviewInstanceFormDefinition } from '@/api/reviewInstances';

const access = vi.hoisted(() => ({ canProgress: true }));
const viewer = vi.hoisted(() => ({ role: 'learner', subjectId: 12 }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => access }));
vi.mock("@/hooks/useAuth.helpers", () => ({ useAuth: () => ({ auth: { user: { fullName: 'Aya Khater' }, account: viewer }, isInitialized: true }) }));
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
  viewer.role = 'learner';
  viewer.subjectId = 12;
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
    if (url.includes('/meeting-attendance/')) return new Response(JSON.stringify({ sessions: [], today: '2026-09-14', timeZone: 'Europe/London', csrfToken: 'test' }));
    if (url.includes('/review/')) return definitionError
      ? new Response(JSON.stringify({ error: definitionError }), { status: 503 })
      : new Response(JSON.stringify(blankDefinition ? { instance: null } : reviewDefinition));
    if (url.includes('/learner_api/calendar/') || url.includes('/learner_api/review-sessions/')) {
      return new Response(JSON.stringify({ learner: { kind: 'apprenticeship', id: 12 }, events }));
    }
    if (url.includes('/learner-detail/')) {
      return new Response(JSON.stringify({
        name: 'Aya Khater', programme: 'Business', components: [],
        quizAttempts: [], videoProgress: [], componentProgress: [],
      }));
    }
    if (url.includes('/learner_api/monthly-logs/')) {
      const path = new URL(url, window.location.origin).pathname;
      const month = path.match(/\/monthly-logs\/12\/(\d{4}-\d{2})\/$/)?.[1] || '2026-09';
      const log = {
        source: 'lms', month, status: 'awaiting_signature', row_count: 1,
        planned_hours: 2, actual_hours: 1, not_accepted_hours: 0, pending_revisions: 0, can_complete: false,
        source_finalization: null, student_signature: null, coach_signature: null, snapshot_digest: 'mcm-review-digest',
        rows: [{ id: 901, title: 'MCM activity', category: 'Coaching', activity_date: `${month}-12`, activity_time: '10:00',
          timestamp_label: '10:00', planned_hours: 2, actual_hours: 1, accepted: true, completion_note: null, documents: [], results: [] }],
      };
      if (path.endsWith('/12/')) return new Response(JSON.stringify({
        learner: { id: 12, aptem_id: 42, name: 'Aya Khater', programme: 'Business', coach_name: 'Coach One' },
        months: [log], total_months: 1, completed_months: 0, read_only: false, csrf_token: 'csrf',
      }));
      return new Response(JSON.stringify(log));
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
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/learner/monthly-coaching/${encodeURIComponent(id)}${suffix}`]}>
      <Routes>
        <Route path="/learner/monthly-coaching/:sessionId" element={<MonthlyCoachingPage />} />
        <Route path="/learner/monthly-coaching" element={<ReturnedLocation />} />
        <Route path="/learner/monthly-logs/:kind/:id/:month" element={<ReturnedLocation />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
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
  function unpreparedPsp(status = 'not-scheduled') {
    const key = 'imported-review:unprepared-psp';
    events = [event({ id: key, source: 'progress-review', title: 'Personal Support Plan',
      importedReviewType: 'Personal Support Plan', reviewTypeName: 'Personal Support Plan',
      reviewInstanceId: null, reviewTemplateId: null, migratedForm: false, status, sourceStatus: status,
      importedReview: { id: '1', type: 'Personal Support Plan', name: 'Personal Support Plan', status, sections: [] } as LearnerCalendarEvent['importedReview'] })];
    reviewDefinition = { ...reviewDefinition, source: 'aptem', migratedForm: true, readOnly: false, answerVersion: 'psp-v1',
      template: { ...reviewDefinition.template, name: 'Personal Support Plan', reviewTypeCode: 'aptem_psp' },
      instance: { ...reviewDefinition.instance!, id: key, status },
      signatures: { advisor: { required: false, signed: false }, participant: { required: false, signed: false },
        employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
      sections: [{ id: 'psp', title: 'Support plan questions', enabled: true, displayOrder: 0, estimatedMinutes: 0,
        fields: [{ id: 'goal', title: 'Agreed goal', fieldType: 'text', required: true, displayOrder: 0,
          configuration: { respondentRoles: ['participant'] }, answer: 'Imported goal' }] }] };
    return key;
  }

  function mountReview(key: string, suffix = '') {
    return render(<ToastProvider><MemoryRouter initialEntries={[`/learner/reviews/${key}${suffix}`]}>
      <Routes><Route path="/learner/reviews/:reviewId" element={<CurriculumReviewPage />} /></Routes>
    </MemoryRouter></ToastProvider>);
  }

  it.each(['not-scheduled', 'scheduled', 'in-progress'])('opens the active PSP template automatically before a coach initializes it (%s)', async status => {
    const key = unpreparedPsp(status);
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const prepares: RequestInit[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'synthetic' }));
      if (String(input).endsWith('/prepare-psp')) {
        prepares.push(init!);
        return new Response(JSON.stringify(reviewDefinition));
      }
      if (String(input).endsWith('/party')) return new Response(JSON.stringify(reviewDefinition));
      if (String(input).endsWith('/party-answers')) {
        expect(JSON.parse(String(init?.body))).toEqual({ answers: { goal: 'Updated goal' }, answerVersion: 'psp-v1' });
        reviewDefinition = { ...reviewDefinition, readOnly: true, answerVersion: 'psp-v2',
          instance: { ...reviewDefinition.instance!, status: 'completed' },
          sections: reviewDefinition.sections.map(section => ({ ...section, fields: section.fields.map(field => ({ ...field, answer: 'Updated goal' })) })) };
        return new Response(JSON.stringify(reviewDefinition));
      }
      return originalFetch(input, init);
    });
    mountReview(key);
    expect(await screen.findByDisplayValue('Imported goal')).toBeVisible();
    expect(screen.queryByText(/Detailed questions and answers have not been imported/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Initialize/ })).not.toBeInTheDocument();
    expect(prepares).toHaveLength(1);
    expect(prepares[0]).toMatchObject({ method: 'POST', body: '{}', headers: { 'X-CSRFToken': 'synthetic' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated goal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    expect(await screen.findByText('Personal Support Plan completed')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    expect(screen.queryByText(/Detailed questions and answers have not been imported/)).not.toBeInTheDocument();
  });

  it('shows an unavailable PSP template error and retries preparation', async () => {
    const key = unpreparedPsp();
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let attempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'synthetic' }));
      if (String(input).endsWith('/prepare-psp')) {
        attempts += 1;
        return attempts === 1
          ? new Response(JSON.stringify({ detail: 'An active Personal Support Plan template is not available.' }), { status: 409 })
          : new Response(JSON.stringify(reviewDefinition));
      }
      return originalFetch(input, init);
    });
    mountReview(key);
    expect(await screen.findByRole('alert')).toHaveTextContent('An active Personal Support Plan template is not available.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry review' }));
    expect(await screen.findByDisplayValue('Imported goal')).toBeVisible();
    expect(attempts).toBe(2);
  });

  it.each(['completed', 'cancelled', 'staff-preview', 'foreign-learner', 'query-preview', 'completed-date', 'progress-review'])('does not initialize historical, other-family or preview reviews (%s)', async scenario => {
    const key = unpreparedPsp(['completed', 'cancelled'].includes(scenario) ? scenario : 'not-scheduled');
    if (scenario === 'staff-preview') viewer.role = 'staff';
    if (scenario === 'foreign-learner') viewer.subjectId = 99;
    if (scenario === 'completed-date') events[0].importedReview!.completedDate = '2026-09-01';
    if (scenario === 'progress-review') events[0].importedReviewType = 'Progress Review';
    mountReview(key, scenario === 'query-preview' ? '?viewAsLearner=12' : '');
    expect(await screen.findByText(scenario === 'progress-review' ? 'Review not found' : /Detailed questions and answers have not been imported/)).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/prepare-psp') || init?.method === 'POST')).toBe(false);
  });

  it.each([false, true])('saves a PSP continuation from Reviews using its configured signature policy (learner required: %s)', async required => {
    const key = 'imported-review:psp-test';
    events = [event({ id: key, eventKey: key, source: 'progress-review', importedReviewType: 'Personal Support Plan',
      reviewTypeName: 'Personal Support Plan', migratedForm: true, formEventKey: key,
      reviewInstanceId: null, reviewTemplateId: null,
      importedReview: { id: '1', type: 'Personal Support Plan', name: 'Personal Support Plan', sections: [] } as LearnerCalendarEvent['importedReview'] })];
    reviewDefinition = { ...reviewDefinition, source: 'aptem', migratedForm: true, readOnly: false, answerVersion: 'psp-v1',
      template: { ...reviewDefinition.template, name: 'Personal Support Plan', reviewTypeCode: 'aptem_psp' },
      instance: { ...reviewDefinition.instance!, id: key, status: 'not-scheduled' },
      signatures: { advisor: { required: false, signed: false }, participant: { required, signed: false },
        employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
      sections: [{ id: 'psp', title: 'Support plan', enabled: true, displayOrder: 0, estimatedMinutes: 0,
        fields: [{ id: 'goal', title: 'Agreed goal', fieldType: 'text', required: true, displayOrder: 0,
          configuration: { respondentRoles: ['participant'] }, answer: '' }] }] };
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const writes: unknown[] = [];
    const signatureWrites: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/party')) return new Response(JSON.stringify(reviewDefinition));
      if (url.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'synthetic' }));
      if (url.endsWith('/party-answers')) {
        writes.push(JSON.parse(String(init?.body)));
        reviewDefinition = { ...reviewDefinition, readOnly: true, answerVersion: 'psp-v2',
          instance: { ...reviewDefinition.instance!, status: required ? 'awaiting-signature' : 'completed' } };
        return new Response(JSON.stringify(reviewDefinition));
      }
      if (url.endsWith('/party-sign')) {
        signatureWrites.push(JSON.parse(String(init?.body)));
        reviewDefinition = { ...reviewDefinition, instance: { ...reviewDefinition.instance!, status: 'completed' },
          signatures: { ...reviewDefinition.signatures, participant: { required: true, signed: true, signedName: 'Synthetic learner' } } };
        events[0].status = 'completed';
        return new Response(JSON.stringify({ signed: true, role: 'participant' }));
      }
      return originalFetch(input, init);
    });
    render(<ToastProvider><MemoryRouter initialEntries={[`/learner/reviews/${key}`]}>
      <Routes><Route path="/learner/reviews/:reviewId" element={<CurriculumReviewPage />} /></Routes>
    </MemoryRouter></ToastProvider>);
    expect(await screen.findByText('Agreed goal')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My agreed goal' } });
    fireEvent.click(screen.getByRole('button', { name: /Save my answers/ }));
    if (required) {
      expect(await screen.findByText('Your signature is required')).toBeVisible();
      expect(screen.getByRole('region', { name: 'Review signatures' })).toBeVisible();
      expect(screen.queryByText('Personal Support Plan completed')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
      expect(await screen.findByText('Personal Support Plan completed')).toBeVisible();
      expect(signatureWrites).toEqual([{ signature: 'data:image/png;base64,c2F2ZWQ=' }]);
    } else {
      expect(await screen.findByText('Personal Support Plan completed')).toBeVisible();
      expect(screen.queryByLabelText('Signature step')).not.toBeInTheDocument();
    }
    expect(writes).toEqual([{ answers: { goal: 'My agreed goal' }, answerVersion: 'psp-v1' }]);
    expect(screen.queryByRole('button', { name: /Save my answers/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  });

  function aptemMcm(sync?: LearnerReviewDefinition['mcmMonthlyLog']) {
    const key = 'imported-review:monthly-log-signature';
    events = [event({ id: key, eventKey: key, migratedForm: true, reviewInstanceId: null, reviewTemplateId: null,
      scheduledDate: '2027-01-05', date: '2027-01-05', targetDate: '2027-01-05', status: 'awaiting-signature' })];
    reviewDefinition = { ...reviewDefinition, source: 'aptem', migratedForm: true,
      mcmMonthlyLog: sync || { month: '2026-12' },
      instance: { ...reviewDefinition.instance!, id: key, status: 'awaiting-signature' } };
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/party')) return new Response(JSON.stringify(reviewDefinition));
      if (url.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'synthetic' }));
      return originalFetch(input, init);
    });
    return key;
  }

  it.each([true, false])('lets the Aptem learner choose Monthly Log signing (%s) in the authoritative target month', async apply => {
    const key = aptemMcm();
    reviewDefinition.reviewRevision = 2;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const writes: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/party-sign')) {
        writes.push(JSON.parse(String(init?.body)));
        reviewDefinition = structuredClone(reviewDefinition);
        reviewDefinition.signatures.participant = { required: true, signed: true, signature: 'data:image/png;base64,c2F2ZWQ=', signedName: 'Synthetic learner' };
        return new Response(JSON.stringify({ signed: true, role: 'participant',
          ...(apply ? { monthlyLogSync: { status: 'synced', month: '2026-12' } } : {}) }));
      }
      return originalFetch(input, init);
    });
    mountMcm(key);
    fireEvent.click(await screen.findByRole('button', { name: 'Review & sign' }));
    expect(await screen.findByText('December 2026')).toBeVisible();
    const choice = await screen.findByRole('checkbox', { name: /Apply my signature to this Monthly Log as well/ });
    expect(choice).toBeChecked();
    if (!apply) fireEvent.click(choice);
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    await screen.findByRole('img', { name: 'Learner signature' });
    expect(writes).toEqual([{ signature: 'data:image/png;base64,c2F2ZWQ=', applyMonthlyLogSignature: apply, reviewRevision: 2 }]);
    if (apply) expect(screen.getByText('Your signature is saved on the MCM and the Monthly Log for December 2026.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  });

  it('distinguishes the archived Monthly Log signature from the unsigned corrected review', async () => {
    const key = aptemMcm({ month: '2026-12', sync: { status: 'synced', month: '2026-12' } });
    reviewDefinition.reviewRevision = 1;
    reviewDefinition.instance!.status = 'in-progress';
    mountMcm(key);
    expect(await screen.findByText(/This Monthly Log signature request belongs to the previous review version/)).toBeVisible();
    expect(screen.getByText(/You must sign the corrected review again when it is submitted/)).toBeVisible();
    expect(screen.queryByText('Your signature is saved on the MCM and the Monthly Log for December 2026.')).toBeNull();
  });

  it('shows a saved MCM signature after partial failure and retries only the Monthly Log after reload', async () => {
    const key = aptemMcm();
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const writes: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/party-sign')) {
        const payload = JSON.parse(String(init?.body));
        writes.push(payload);
        reviewDefinition = structuredClone(reviewDefinition);
        reviewDefinition.instance!.status = 'completed';
        reviewDefinition.signatures.participant = { required: true, signed: true, signature: 'data:image/png;base64,c2F2ZWQ=', signedName: 'Synthetic learner' };
        reviewDefinition.signatures.advisor = { required: true, signed: true };
        const sync = { status: payload.retryMonthlyLogSignature ? 'synced' : 'failed', month: '2026-12' } as const;
        reviewDefinition.mcmMonthlyLog = { month: '2026-12', sync };
        return new Response(JSON.stringify({ signed: true, role: 'participant', monthlyLogSync: sync }));
      }
      return originalFetch(input, init);
    });
    const first = mountMcm(key);
    fireEvent.click(await screen.findByRole('button', { name: 'Review & sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    await screen.findByRole('button', { name: 'Retry Monthly Log signature' });
    expect(screen.getByText('Your MCM signature is saved. The Monthly Log for December 2026 still needs its signature.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    first.unmount();
    mountMcm(key);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Monthly Log signature' }));
    expect(await screen.findByText('Your signature is saved on the MCM and the Monthly Log for December 2026.')).toBeVisible();
    expect(writes).toEqual([
      { signature: 'data:image/png;base64,c2F2ZWQ=', applyMonthlyLogSignature: true },
      { retryMonthlyLogSignature: true },
    ]);
  });

  it('does not offer a Monthly Log retry to staff viewing a learner', async () => {
    const key = aptemMcm({ month: '2026-12', sync: { status: 'failed', month: '2026-12' } });
    access.canProgress = false;
    reviewDefinition.signatures.participant = { required: true, signed: true };
    mountMcm(key);
    await screen.findByTestId('learner-review-instance-form');
    expect(screen.queryByRole('button', { name: 'Retry Monthly Log signature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review & sign' })).not.toBeInTheDocument();
  });

  it.each(['MCM', 'PR'] as const)('saves Aptem %s learner answers through the versioned party API', async family => {
    const key = 'imported-review:learner-answer';
    events = [event({ id: key, eventKey: key, migratedForm: true, reviewInstanceId: null, reviewTemplateId: null,
      source: family === 'MCM' ? 'mcr' : 'progress-review', type: family === 'MCM' ? 'coaching' : 'review',
      reviewTypeCode: family === 'MCM' ? 'mcm' : 'progress_review' })];
    reviewDefinition = { ...reviewDefinition, migratedForm: true, source: 'aptem', readOnly: false, answerVersion: 'v1',
      instance: { ...reviewDefinition.instance!, id: key, status: 'scheduled' }, sections: [{
        id: 'reflection', title: 'Reflection', enabled: true, displayOrder: 0, estimatedMinutes: 0, fields: [
          { id: 'learner-reflection', title: 'Learner reflection', fieldType: 'text', required: true, displayOrder: 0,
            configuration: { respondentRoles: ['participant'] } },
        ],
      }] };
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/migrated-reviews/csrf')) return new Response(JSON.stringify({ csrfToken: 'synthetic' }));
      if (url.endsWith('/party-answers')) return new Response(JSON.stringify({ ...reviewDefinition, answerVersion: 'v2' }));
      if (url.endsWith('/party')) return new Response(JSON.stringify(reviewDefinition));
      return original(input, init);
    });
    if (family === 'MCM') mountMcm(key); else mountProgressReview(key);
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'My progress this month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/learner_api/migrated-reviews/imported-review%3Alearner-answer/party-answers', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ answers: { 'learner-reflection': 'My progress this month' }, answerVersion: 'v1' }),
    })));
  });

  it.each([true, false])('keeps the MCM log out of the page until Review & sign: %s', async canProgress => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    access.canProgress = canProgress;
    reviewDefinition.instance!.status = 'awaiting-signature';
    events[0] = { ...events[0], status: 'awaiting-signature' };
    mountMcm(SCHEDULED_MCM);
    await screen.findByTestId('learner-review-instance-form');

    expect(screen.queryByRole('region', { name: 'Monthly learning log' })).not.toBeInTheDocument();
    expect(screen.queryByText('MCM activity')).not.toBeInTheDocument();
    if (canProgress) {
      fireEvent.click(screen.getByRole('button', { name: 'Review & sign' }));
      expect(await screen.findByRole('dialog', { name: 'Review the monthly log before signing' })).toBeVisible();
      expect(await screen.findByText('MCM activity')).toBeVisible();
      expect(screen.getByRole('checkbox', { name: /Apply my signature to this Monthly Log as well/ })).toBeChecked();
    } else {
      expect(screen.queryByRole('button', { name: 'Review & sign' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: "This month's logs" })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open monthly log' })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
  });

  it('opens the MCM target month when the meeting is booked in a different month', async () => {
    events = [event({
      id: SCHEDULED_MCM,
      targetDate: '2026-12-16',
      scheduledDate: '2026-09-28',
      date: '2026-09-28',
      status: 'awaiting-signature',
    })];
    reviewDefinition.instance!.status = 'awaiting-signature';

    mountMcm(SCHEDULED_MCM);
    await screen.findByTestId('learner-review-instance-form');

    fireEvent.click(screen.getByRole('button', { name: 'Review & sign' }));
    expect(await screen.findByText('December 2026')).toBeVisible();
    expect(await screen.findByText('MCM activity')).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/learner_api/monthly-logs/12/2026-12/'))).toBe(true);
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

  it('offers the reusable Created_users signature before asking the learner to draw', () => {
    reviewDefinition.instance!.status = 'awaiting-signature';
    reviewDefinition.savedSignature = 'data:image/png;base64,Y3JlYXRlZA==';
    reviewDefinition.savedSignatureName = 'Aya Khater';
    render(<LearnerReviewInstanceForm definition={reviewDefinition} onSign={vi.fn()} signatoryName="Aya Khater" />);

    expect(screen.getByRole('img', { name: 'Your saved signature' })).toHaveAttribute(
      'src', reviewDefinition.savedSignature,
    );
    expect(screen.getByRole('button', { name: 'Use saved signature' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Draw new signature' })).toBeVisible();
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
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'Aya Khater', signature: savedMark, applyMonthlyLogSignature: false });
        reviewDefinition = structuredClone(reviewDefinition);
        reviewDefinition.signatures.participant = { required: true, signed: true, signature: savedMark, signedName: 'Aya Khater', signedAt: '2026-09-14T15:38:56Z' };
        return new Response(JSON.stringify({ event: { ...events[0], status: 'awaiting-signature' }, review: reviewDefinition }));
      }
      return originalFetch(input, init);
    });
    mountMcm(SCHEDULED_MCM);
    fireEvent.click(await screen.findByRole('button', { name: 'Review & sign' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Apply my signature to this Monthly Log as well/ }));
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

  it('opens the monthly log in the Review & sign dialog', async () => {
    reviewDefinition.instance!.status = 'awaiting-signature';
    mountMcm(SCHEDULED_MCM);

    expect(screen.queryByRole('region', { name: 'Monthly learning log' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Review & sign' }));
    const logRegion = screen.getByRole('region', { name: 'Monthly learning log' });
    expect(logRegion).toBeVisible();
    expect(await screen.findByText('MCM activity')).toBeVisible();
    expect(within(logRegion).queryAllByRole('row').some(row => /^Coach\s/.test(row.textContent?.trim() || ''))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Open monthly log' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Apply my signature to this Monthly Log as well/ })).toBeChecked();
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
    expect(screen.getByLabelText('Section has saved answers')).toBeInTheDocument();
    // Conditional children follow the parent's saved answer.
    expect(screen.getByText('Describe the concern')).toBeInTheDocument();
    // And nothing hard-coded survives.
    for (const heading of LEGACY_MCM_HEADINGS) expect(screen.queryByText(heading)).toBeNull();

    expect(requested.some((url) => url.includes(`${encodeURIComponent(SCHEDULED_MCM)}/review/`))).toBe(true);
  });

  it('a field the Curriculum template opted the learner into answering is writable and saves only that field', () => {
    reviewDefinition = definition({
      sections: [{
        id: 'SEC-1', title: 'Curriculum-authored section', estimatedMinutes: 10, displayOrder: 1, enabled: true,
        fields: [
          {
            id: 'FLD-COACH', title: 'Coach only note', fieldType: 'text',
            required: false, displayOrder: 1, configuration: {}, answer: 'Written by the coach.',
          },
          {
            id: 'FLD-LEARNER', title: 'Your own reflection', fieldType: 'text',
            required: false, displayOrder: 2, configuration: { respondentRoles: ['participant'] }, answer: 'Draft reflection.',
          },
        ],
      }],
    });
    const onSaveAnswers = vi.fn().mockResolvedValue(reviewDefinition);
    render(<LearnerReviewInstanceForm definition={reviewDefinition} onSaveAnswers={onSaveAnswers} />);

    // The field not opted into by the template stays read-only exactly as before.
    expect(screen.getByDisplayValue('Written by the coach.')).toBeDisabled();

    // The opted-in field is writable.
    const learnerField = screen.getByDisplayValue('Draft reflection.');
    expect(learnerField).not.toBeDisabled();
    fireEvent.change(learnerField, { target: { value: 'My updated reflection.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));

    expect(onSaveAnswers).toHaveBeenCalledWith({ 'FLD-LEARNER': 'My updated reflection.' });
  });

  it('clearly marks the current respondent questions and required progress', () => {
    reviewDefinition = definition({
      sections: [{
        id: 'SEC-1', title: 'Shared questions', estimatedMinutes: 10, displayOrder: 1, enabled: true,
        fields: [
          {
            id: 'FLD-LEARNER-REQUIRED', title: 'Learner preparation', fieldType: 'text',
            required: true, displayOrder: 1, configuration: { respondentRoles: ['participant'] },
          },
          {
            id: 'FLD-EMPLOYER-REQUIRED', title: 'Employer preparation', fieldType: 'text',
            required: true, displayOrder: 2, configuration: { respondentRoles: ['employer'] },
          },
          {
            id: 'FLD-COACH', title: 'Coach notes', fieldType: 'text',
            required: true, displayOrder: 3, configuration: {},
          },
        ],
      }],
    });

    render(<LearnerReviewInstanceForm definition={reviewDefinition} onSaveAnswers={vi.fn().mockResolvedValue(reviewDefinition)} />);

    expect(screen.getByTestId('respondent-question-summary')).toHaveTextContent('Learner questions');
    expect(screen.getByTestId('respondent-question-summary')).toHaveTextContent('1 question for you');
    expect(screen.getByTestId('respondent-question-summary')).toHaveTextContent('1 required remaining');
    expect(screen.getByText('Your response')).toBeInTheDocument();
    expect(screen.getByText('Required', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Employer response')).not.toBeInTheDocument();
  });

  it('uses the same respondent markers for an employer viewer', () => {
    reviewDefinition = definition({
      sections: [{
        id: 'SEC-1', title: 'Employer questions', estimatedMinutes: 10, displayOrder: 1, enabled: true,
        fields: [{
          id: 'FLD-EMPLOYER', title: 'Workplace feedback', fieldType: 'text',
          required: true, displayOrder: 1, configuration: { respondentRoles: ['employer'] },
        }],
      }],
    });

    render(<LearnerReviewInstanceForm definition={reviewDefinition} viewerRole="employer" onSaveAnswers={vi.fn().mockResolvedValue(reviewDefinition)} />);

    expect(screen.getByTestId('respondent-question-summary')).toHaveTextContent('Employer questions');
    expect(screen.getByText('Employer response')).toBeInTheDocument();
    expect(screen.getByTestId('respondent-question-summary')).toHaveTextContent('1 required remaining');
  });

  it('does not mark a coach-only section complete for the learner just because it has no questions for them', () => {
    reviewDefinition = definition({
      sections: [{
        id: 'SEC-1', title: 'Coach-only section', estimatedMinutes: 5, displayOrder: 1, enabled: true,
        fields: [{
          id: 'FLD-COACH', title: 'Coach notes', fieldType: 'text',
          required: true, displayOrder: 1, configuration: {}, answer: '',
        }],
      }],
    });

    const { container } = render(<LearnerReviewInstanceForm definition={reviewDefinition} onSaveAnswers={vi.fn().mockResolvedValue(reviewDefinition)} />);

    expect(screen.getByText('Coach-only section')).toBeInTheDocument();
    // No field here was assigned to the learner, so the section must not show
    // the same green "complete" badge used for a respondent who has actually
    // answered everything required of them, nor a pending badge for something
    // that was never theirs to answer. AppIcon strips its `ri-*` token before
    // rendering (it only uses it to pick which icon to draw), so the badge is
    // identified by the colour class that survives instead.
    expect(container.querySelector('.text-emerald-500')).toBeNull();
    expect(container.querySelector('.text-amber-500')).toBeNull();
  });

  it('shows a pending badge for an unanswered learner question, then the complete badge once they answer it', () => {
    reviewDefinition = definition({
      sections: [{
        id: 'SEC-1', title: 'test for learner', estimatedMinutes: 5, displayOrder: 1, enabled: true,
        fields: [{
          id: 'FLD-LEARNER', title: 'type any thing', fieldType: 'text',
          required: false, displayOrder: 1, configuration: { respondentRoles: ['participant'] }, answer: '',
        }],
      }],
    });

    const { container } = render(<LearnerReviewInstanceForm definition={reviewDefinition} onSaveAnswers={vi.fn().mockResolvedValue(reviewDefinition)} />);

    // Unanswered -- even though the field isn't required -- reads as pending,
    // not complete. (The only/first section opens automatically.)
    expect(container.querySelector('.text-amber-500')).not.toBeNull();
    expect(container.querySelector('.text-emerald-500')).toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Something written' } });

    expect(container.querySelector('.text-emerald-500')).not.toBeNull();
    expect(container.querySelector('.text-amber-500')).toBeNull();
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
