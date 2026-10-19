import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ReviewInstanceFormDefinition } from '@/api/reviewInstances';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachMeetingDetail from './page';

const { fetchEvents, scheduleEvent, fetchForm, initializeForm, bookForm, rescheduleForm, coach } = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
  scheduleEvent: vi.fn(),
  fetchForm: vi.fn(),
  initializeForm: vi.fn(),
  bookForm: vi.fn(),
  rescheduleForm: vi.fn(),
  coach: { email: 'coach@example.invalid', name: 'Coach Example', isInitialized: true, isViewingAsCoach: false },
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => coach }));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents: fetchEvents,
  scheduleCoachCalendarEvent: scheduleEvent,
  runCoachCalendarAction: vi.fn(),
}));
vi.mock('../shared/CoachMeetingArtifactsPanel', () => ({ CoachMeetingArtifactsPanel: () => null }));
vi.mock('@/api/reviewInstances', () => ({
  fetchReviewInstanceForm: fetchForm,
  initializeMigratedReview: initializeForm,
  bookMigratedReview: bookForm,
  rescheduleMigratedReview: rescheduleForm,
  openReviewInstanceForEvent: vi.fn(),
  markReviewInstanceInProgressManually: vi.fn(),
}));

const EVENT_KEY = 'imported-review:23485';

function importedEvent(overrides: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent {
  return {
    id: 'calendar-1', eventKey: EVENT_KEY, title: 'Global MCM', type: 'coaching', source: 'mcr',
    learner: 'L4 MRE TEST', learnerId: '12', learnerType: 'apprenticeship', status: 'not-scheduled',
    targetDate: '2026-10-29', durationMinutes: 60, reviewSource: 'aptem',
    programme: 'Marketing Manager Level 6', ...overrides,
  };
}

function importedDefinition(overrides: Partial<ReviewInstanceFormDefinition> = {}): ReviewInstanceFormDefinition {
  return {
    source: 'aptem', migratedForm: true, formAvailable: true, sourceStatus: 'Not Scheduled',
    localStatus: 'not-scheduled',
    instance: {
      id: EVENT_KEY, reviewTemplateId: '', learnerId: 12, programmeId: 'programme-1',
      occurrenceNumber: null, targetDate: '2026-10-29', status: 'not-scheduled',
      startedAt: null, completedAt: null,
    },
    template: {
      id: 'migrated-1', name: 'Global MCM',
      signatures: { advisor: true, participant: true, employer: false, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: false, referrer: false },
      recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0,
    },
    sections: [],
    signatures: {
      advisor: { required: true, signed: false }, participant: { required: true, signed: false },
      employer: { required: false, signed: false }, referrer: { required: false, signed: false },
    },
    manualOverride: null,
    booking: {
      booked: false, conflict: false, canBook: true, canAttach: false, eventKey: null,
      scheduledDate: null, scheduledTime: null, durationMinutes: null, meetingLink: null, syncState: null,
    },
    ...overrides,
  } as ReviewInstanceFormDefinition;
}

function mount(path = `/coach/meetings/${encodeURIComponent(EVENT_KEY)}`) {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/coach/meetings/:eventKey" element={<CoachMeetingDetail />} />
      <Route path="/coach/progress-reviews/:eventKey" element={<CoachMeetingDetail />} />
    </Routes>
  </MemoryRouter>);
}

describe('imported Aptem booking on the meeting detail page', () => {
  it.each(['mcr', 'progress-review'] as const)('reschedules a booked %s through its imported identity', async source => {
    const initial = importedDefinition({ localStatus: 'scheduled', booking: {
      booked: true, conflict: false, canBook: false, canReschedule: true, eventKey: EVENT_KEY,
      scheduledDate: '2026-10-29', scheduledTime: '10:00', durationMinutes: 60,
      meetingLink: 'https://example.invalid/meeting', syncState: 'synced',
    } });
    fetchEvents.mockResolvedValue({ events: [importedEvent({ source, status: 'scheduled', calendarEventKey: EVENT_KEY })], owner: { name: 'Coach Example' } });
    fetchForm.mockResolvedValue(initial);
    rescheduleForm.mockResolvedValue({ ...initial, booking: { ...initial.booking!, scheduledTime: '11:00' } });
    mount(source === 'mcr' ? undefined : `/coach/progress-reviews/${encodeURIComponent(EVENT_KEY)}`);
    const button = await screen.findByRole('button', { name: 'Reschedule' });
    fireEvent.click(button);
    await waitFor(() => expect(rescheduleForm).toHaveBeenCalledWith(EVENT_KEY,
      expect.objectContaining({ scheduledDate: '2026-10-29', scheduledTime: '10:00', durationMinutes: 60 }), initial.booking));
    expect(await screen.findByText('Meeting rescheduled.')).toBeVisible();
    expect(bookForm).not.toHaveBeenCalled();
    expect(scheduleEvent).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    coach.isViewingAsCoach = false;
    fetchEvents.mockResolvedValue({ events: [importedEvent()], owner: { name: 'Coach Example' } });
    fetchForm.mockResolvedValue(importedDefinition());
  });
  afterEach(cleanup);

  it('books the imported review through its own endpoint, keyed by its Aptem identity', async () => {
    bookForm.mockResolvedValue(importedDefinition({
      localStatus: 'scheduled',
      booking: {
        booked: true, conflict: false, canBook: false, canAttach: false, eventKey: EVENT_KEY,
        scheduledDate: '2026-10-29', scheduledTime: '11:00', durationMinutes: 45,
        meetingLink: null, syncState: 'synced',
      },
    }));
    mount();

    // The slot is seeded from this occurrence's own target date, so a coach
    // who changes nothing books the date the review was planned for.
    fireEvent.click(await screen.findByRole('button', { name: 'Book Meeting' }));

    await waitFor(() => expect(bookForm).toHaveBeenCalledTimes(1));
    expect(bookForm).toHaveBeenCalledWith(EVENT_KEY, expect.objectContaining({
      scheduledDate: '2026-10-29', scheduledTime: '09:00', durationMinutes: 60,
    }));
    // The native calendar endpoint must never book an imported Aptem review.
    expect(scheduleEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Book Meeting' })).not.toBeInTheDocument());
  });

  it('prepares an unopened import before offering its booking', async () => {
    fetchForm
      .mockResolvedValueOnce(importedDefinition({
        migratedForm: false, formAvailable: false, canInitialize: true, localStatus: null, booking: undefined,
      }))
      .mockResolvedValueOnce(importedDefinition());
    initializeForm.mockResolvedValue(importedDefinition());
    mount();

    expect(await screen.findByRole('button', { name: 'Book Meeting' })).toBeVisible();
    expect(initializeForm).toHaveBeenCalledExactlyOnceWith(EVENT_KEY);
  });

  it('offers the existing meeting rather than a second appointment', async () => {
    fetchForm.mockResolvedValue(importedDefinition({
      booking: {
        booked: true, conflict: false, canBook: false, canAttach: true, eventKey: EVENT_KEY,
        scheduledDate: '2026-11-02', scheduledTime: '14:30', durationMinutes: 30,
        meetingLink: null, syncState: 'synced',
      },
    }));
    bookForm.mockResolvedValue(importedDefinition({ localStatus: 'scheduled' }));
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Use existing meeting' }));
    await waitFor(() => expect(bookForm).toHaveBeenCalledWith(EVENT_KEY, expect.objectContaining({
      scheduledDate: '2026-11-02', scheduledTime: '14:30', durationMinutes: 30,
    })));
  });

  it('refuses to book a conflicting calendar association', async () => {
    fetchForm.mockResolvedValue(importedDefinition({
      booking: {
        booked: false, conflict: true, canBook: false, canAttach: false, eventKey: null,
        scheduledDate: null, scheduledTime: null, durationMinutes: null, meetingLink: null, syncState: null,
      },
    }));
    mount();

    expect(await screen.findByRole('alert')).toHaveTextContent('conflicting calendar association');
    expect(screen.queryByRole('button', { name: 'Book Meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use existing meeting' })).not.toBeInTheDocument();
  });

  it('never initializes or books while an admin reads another workspace', async () => {
    coach.isViewingAsCoach = true;
    fetchForm.mockResolvedValue(importedDefinition({
      migratedForm: false, formAvailable: false, canInitialize: true, localStatus: null, booking: undefined,
    }));
    mount();

    await waitFor(() => expect(fetchForm).toHaveBeenCalled());
    expect(initializeForm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Book Meeting' })).not.toBeInTheDocument();
    expect(bookForm).not.toHaveBeenCalled();
  });

  it('labels the same action for an imported Progress Review', async () => {
    fetchEvents.mockResolvedValue({
      events: [importedEvent({ type: 'review', source: 'progress-review', title: 'Progress Review' })],
      owner: { name: 'Coach Example' },
    });
    mount(`/coach/progress-reviews/${encodeURIComponent(EVENT_KEY)}`);

    expect(await screen.findByRole('button', { name: 'Book Review' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Book Meeting' })).not.toBeInTheDocument();
  });
});
