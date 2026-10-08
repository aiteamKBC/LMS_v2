import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import { fetchEmployerProgressReview, fetchEmployerProgressReviews, saveEmployerReviewAnswers, signReviewAsEmployer } from '@/api/employerPortal';
import { fetchMigratedReviewForParty, signMigratedReviewAsParty } from '@/api/learnerCalendar';
import { EmployerProgressReviewsTab } from './EmployerProgressReviewsTab';

vi.mock('@/api/employerPortal', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/employerPortal')>(),
  fetchEmployerProgressReview: vi.fn(), fetchEmployerProgressReviews: vi.fn(),
  saveEmployerReviewAnswers: vi.fn(), signReviewAsEmployer: vi.fn(),
}));
vi.mock('@/api/learnerCalendar', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/learnerCalendar')>(),
  fetchMigratedReviewForParty: vi.fn(), signMigratedReviewAsParty: vi.fn(),
}));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ onCommit }: { onCommit: (signature: string) => void }) => <button type="button" onClick={() => onCommit('data:image/png;base64,SIG')}>Confirm employer signature</button>,
}));

let event: LearnerCalendarEvent;
let definition: LearnerReviewDefinition;
const onChanged = vi.fn();
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/employers/7/learner/commercial/499']}>
    <EmployerProgressReviewsTab employerId="7" kind="commercial" learnerId="499" employerName="Employer Jane" onReviewChanged={onChanged} />
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('AppIcon', AppIcon);
  event = { id: 'review-1', eventKey: 'review-1', title: 'Progress review', source: 'progress-review', type: 'review', sequence: 1,
    status: 'awaiting-signature', date: '2026-09-14', targetDate: '2026-09-14', scheduledDate: '2026-09-14', scheduledTime: '09:00',
    durationMinutes: 60, coachName: 'Coach Sam', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '',
    reviewTemplateId: 'template-1', reviewInstanceId: 'instance-1', learnerSigned: true };
  definition = {
    manualOverride: null,
    instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 55, programmeId: 'programme-1', occurrenceNumber: 1,
      targetDate: '2026-09-14', status: 'awaiting-signature', startedAt: null, completedAt: null },
    template: { id: 'template-1', name: 'Progress review', signatures: { advisor: true, participant: true, employer: true, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: true, referrer: false }, recurrence: { interval: 12, unit: 'weeks' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [], signatures: { advisor: { required: true, signed: true }, participant: { required: true, signed: true },
      employer: { required: true, signed: false }, referrer: { required: false, signed: false } },
  };
  vi.mocked(fetchEmployerProgressReviews).mockImplementation(async () => structuredClone({ events: [event], definitions: { [event.eventKey]: definition } }));
  vi.mocked(fetchEmployerProgressReview).mockImplementation(async () => structuredClone({ event, definition }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('employer progress reviews', () => {
  it('uses the learner timeline and archive with employer signature status and no learner actions', async () => {
    mount();
    expect(await screen.findByText('Your signature is needed')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Progress review programme timeline' })).toBeVisible();
    expect(screen.queryByText('Open calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('Book a time')).not.toBeInTheDocument();
    expect(screen.queryByText('Record attendance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all reviews (1)' }));
    expect(screen.getByRole('region', { name: 'All reviews' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Past (1)' }));
    expect(screen.getByRole('button', { name: 'Read & sign' })).toBeVisible();
  });

  it('signs only the employer role even when the learner has already signed, then updates both list and document counts', async () => {
    vi.mocked(signReviewAsEmployer).mockImplementation(async () => {
      definition.signatures.employer = { required: true, signed: true, signedName: 'Employer Jane' };
      return definition;
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Read & sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm employer signature' }));
    await waitFor(() => expect(signReviewAsEmployer).toHaveBeenCalledWith('7', 'commercial', '499', 'instance-1', { name: 'Employer Jane', signature: 'data:image/png;base64,SIG' }));
    expect(await screen.findByText('All signatures saved')).toBeVisible();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Confirm employer signature' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to reviews' }));
    expect(await screen.findByText('Your signature is saved')).toBeVisible();
  });

  it('saves employer questions while keeping coach fields read-only and unfinished forms unsigned', async () => {
    definition.instance!.status = 'in-progress';
    event.status = 'in-progress';
    definition.sections = [{ id: 'discussion', title: 'Discussion', enabled: true, displayOrder: 0, estimatedMinutes: 5, fields: [
      { id: 'employer-comment', title: 'Employer comment', fieldType: 'text_multiline', required: false, displayOrder: 0, configuration: { respondentRoles: ['employer'] } },
      { id: 'coach-comment', title: 'Coach comment', fieldType: 'text_multiline', required: false, displayOrder: 1, configuration: {}, answer: 'Coach notes' },
    ] }];
    vi.mocked(saveEmployerReviewAnswers).mockImplementation(async () => {
      definition.sections[0].fields[0].answer = 'Good progress at work'; return definition;
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View review' }));
    const [field, coachField] = await screen.findAllByRole('textbox');
    expect(field).toBeEnabled();
    expect(coachField).toBeDisabled();
    expect(coachField).toHaveValue('Coach notes');
    expect(screen.queryByRole('button', { name: 'Confirm employer signature' })).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Good progress at work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(saveEmployerReviewAnswers).toHaveBeenCalledWith('7', 'commercial', '499', 'instance-1', { 'employer-comment': 'Good progress at work' }));
  });

  it('uses the existing employer party flow for migrated reviews', async () => {
    event = { ...event, migratedForm: true, eventKey: 'imported-review:88', id: 'imported-review:88', reviewInstanceId: null, reviewTemplateId: null,
      employerSigned: false, employerSignatureRequired: true };
    definition = { ...definition, migratedForm: true, source: 'aptem' };
    vi.mocked(fetchMigratedReviewForParty).mockResolvedValue(definition);
    vi.mocked(signMigratedReviewAsParty).mockResolvedValue({ signed: true, role: 'employer' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Read & sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm employer signature' }));
    await waitFor(() => expect(signMigratedReviewAsParty).toHaveBeenCalledWith('imported-review:88', 'data:image/png;base64,SIG'));
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('does not offer the learner signature when the review needs no employer signature', async () => {
    definition.signatures.employer = { required: false, signed: false };
    definition.signatures.participant = { required: true, signed: false };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View review' }));
    expect(await screen.findByRole('region', { name: 'Review signatures' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm employer signature' })).not.toBeInTheDocument();
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('allows retry when review loading fails', async () => {
    vi.mocked(fetchEmployerProgressReviews).mockRejectedValueOnce(new Error('Review service unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Review service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Read & sign' })).toBeVisible();
  });
});
