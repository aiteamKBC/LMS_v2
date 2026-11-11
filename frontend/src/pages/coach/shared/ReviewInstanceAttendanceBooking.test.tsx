import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReviewInstanceFormDefinition } from '@/api/reviewInstances';
import { ReviewInstanceModal } from './ReviewInstanceModal';

const { fetchForm, fetchSlots } = vi.hoisted(() => ({ fetchForm: vi.fn(), fetchSlots: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: 'Synthetic coach' } } }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({
  email: 'coach@example.invalid', isInitialized: true, isViewingAsCoach: false,
}) }));
vi.mock('@/api/reviewInstances', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: fetchForm,
  fetchCoachReviewSlots: fetchSlots,
}));
vi.mock('./MigratedMeetingIntelligence', () => ({
  MigratedMeetingIntelligence: ({ onAttendanceLinkChange }: { onAttendanceLinkChange?: () => void }) =>
    <button type="button" onClick={onAttendanceLinkChange}>Confirm alternate email link</button>,
}));

const reviewId = 'imported-review:synthetic';
function definition(canReschedule: boolean): ReviewInstanceFormDefinition {
  return {
    source: 'aptem', migratedForm: true, formAvailable: true, localStatus: 'in-progress',
    sourceStatus: 'In Progress', readOnly: false,
    instance: { id: reviewId, reviewTemplateId: '', learnerId: 21, programmeId: 'programme',
      occurrenceNumber: null, targetDate: '2026-10-27', status: 'in-progress',
      startedAt: '2026-10-27T10:00:00Z', completedAt: null },
    template: { id: 'template', name: 'Monthly Coaching Meeting', reviewTypeCode: 'aptem_mcm',
      signatures: { advisor: true, participant: true, employer: false, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: false, referrer: false },
      recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [{ id: 'section', title: 'Next steps', estimatedMinutes: 5, displayOrder: 1,
      enabled: true, fields: [{ id: 'answer', title: 'Agreed action', fieldType: 'text',
        required: false, displayOrder: 1, configuration: {}, answer: 'Original answer' }] }],
    signatures: { advisor: { required: true, signed: false }, participant: { required: true, signed: false },
      employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
    manualOverride: null,
    booking: { booked: true, conflict: false, canBook: false, canReschedule,
      eventKey: reviewId, scheduledDate: '2026-10-27', scheduledTime: '10:00',
      durationMinutes: 60, meetingLink: 'https://example.invalid/meeting', syncState: 'synced' },
  } as ReviewInstanceFormDefinition;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSlots.mockResolvedValue(['10:00', '11:00']);
});

it('refreshes imported booking eligibility after link and undo without losing unsaved answers', async () => {
  fetchForm.mockResolvedValueOnce(definition(true)).mockResolvedValueOnce(definition(false))
    .mockResolvedValueOnce(definition(true));
  render(<MemoryRouter><ReviewInstanceModal instanceId={reviewId} onClose={vi.fn()} /></MemoryRouter>);
  const answer = await screen.findByDisplayValue('Original answer');
  expect(screen.getByRole('button', { name: 'Reschedule' })).toBeVisible();
  fireEvent.change(answer, { target: { value: 'Unsaved answer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm alternate email link' }));
  await waitFor(() => expect(fetchForm).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument());
  expect(answer).toHaveValue('Unsaved answer');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm alternate email link' }));
  expect(await screen.findByRole('button', { name: 'Reschedule' })).toBeVisible();
  expect(answer).toHaveValue('Unsaved answer');
});
