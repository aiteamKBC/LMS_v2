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
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonthlyCoachingPage from '../../monthly-coaching/page';
import ProgressReviewsPage from '../../progress-reviews/page';
import { AppIcon } from '@/components/feature/AppIcon';
import { ToastProvider } from '@/hooks/useToast';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import { LearnerReviewInstanceForm } from '../LearnerReviewInstanceForm';
import type { ReviewInstanceFormDefinition } from '@/api/reviewInstances';

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

beforeEach(() => {
  clearAllCachedResources();
  requested = [];
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
    if (url.includes('/review/')) return new Response(JSON.stringify(reviewDefinition));
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
  clearAllCachedResources();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mountMcm = (id: string) => render(
  <MemoryRouter initialEntries={[`/learner/monthly-coaching/${encodeURIComponent(id)}`]}>
    <Routes><Route path="/learner/monthly-coaching/:sessionId" element={<MonthlyCoachingPage />} /></Routes>
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
