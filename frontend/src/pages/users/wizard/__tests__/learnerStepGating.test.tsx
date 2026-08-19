/**
 * The learner may not run ahead of their own answers.
 *
 * Covers the three ways forward through the wizard (step tabs, the tab-bar
 * arrow, the footer Next) plus the guarantee that moving on saves — behind the
 * navigation rather than ahead of it, so Next never blocks on the write. Staff
 * are deliberately not gated, so that is asserted too — a regression there would
 * stop the enrolment team correcting a single field on a half-filled record.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const fetchExtendedIlr = vi.fn();
const saveExtendedIlr = vi.fn();

vi.mock('@/api/extendedIlr', () => ({
  fetchExtendedIlr: (...args: unknown[]) => fetchExtendedIlr(...args),
  saveExtendedIlr: (...args: unknown[]) => saveExtendedIlr(...args),
  // The provider reads the cache synchronously to hydrate on its first frame.
  // Undefined here so these tests keep exercising the async path they were
  // written for; the primed path has its own coverage in the api tests.
  peekExtendedIlr: () => undefined,
}));
vi.mock('@/api/enrolmentDocuments', () => ({ uploadEnrolmentDocument: vi.fn() }));

// The wizard seeds an unrated row per programme competency, so the Skills Radar
// counts as outstanding even on a step the learner has never opened.
const fetchKsbProfile = vi.fn();
vi.mock('@/api/curriculum', () => ({
  fetchKsbProfile: (...args: unknown[]) => fetchKsbProfile(...args),
  // Cold cache, so the seeding effect still goes through fetchKsbProfile — the
  // second-wave timing these tests assert on.
  peekKsbProfile: () => undefined,
}));

import { ToastProvider } from '@/hooks/useToast';
import { WizardProvider } from '../WizardContext';
import { WizardShell } from '../WizardShell';
import type { EnrolmentBoard, PersonalDetails } from '../../types';

// Only the branches the wizard reads are populated; the board type is far wider
// than anything under test here.
const BOARD = {
  user: { id: '20', name: 'Test Learner', reference: 'REF20', owner: '' },
  contact: { email: '', phone: '', dob: '', groupMembership: '', hasMandate: false },
  programme: { name: 'Test Programme', cohort: '', type: '', status: 'Onboarding', startDate: '', endDate: '', enrolledAt: '', enrolledBy: '', onboardingStatus: 'In progress' },
} as unknown as EnrolmentBoard;

const COMPLETE_PERSONAL_DETAILS: PersonalDetails = {
  firstName: 'Test',
  lastName: 'Learner',
  email: 'test@example.com',
  phone: '07123456789',
  address: '1 High Street, Kent',
  dob: '2000-01-01',
  age: 26,
  sex: 'Female',
  signature: 'data:image/png;base64,AAAA',
};

function renderShell(mode: 'learner' | 'staff', onNavigateStep = vi.fn(), children?: ReactNode) {
  render(
    <ToastProvider>
      <WizardProvider userId="20" board={BOARD}>
        {/* Step 1 — Personal Details, the first step with anything to fill in. */}
        <WizardShell currentIndex={1} mode={mode} onNavigateStep={onNavigateStep} onFinish={vi.fn()} />
        {children}
      </WizardProvider>
    </ToastProvider>
  );
  return onNavigateStep;
}

/** Gating only applies once the saved answers have loaded. */
const waitForHydration = () => waitFor(() => expect(fetchExtendedIlr).toHaveBeenCalled());

beforeAll(() => {
  // AppIcon is injected app-wide by unplugin-auto-import, which the test config
  // deliberately leaves out; the components under test render it unqualified.
  (globalThis as Record<string, unknown>).AppIcon = ({ className }: { className?: string }) => <i className={className} />;
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchExtendedIlr.mockResolvedValue({ answers: null, draft: null, meta: { updatedAt: '' } });
  saveExtendedIlr.mockResolvedValue({ meta: { updatedAt: '2026-08-10T00:00:00Z' } });
  // No authored competencies by default — a learner cannot be blocked on a step
  // their programme gives them nothing to answer.
  fetchKsbProfile.mockResolvedValue({ results: [] });
});

describe('learner step gating', () => {
  it('blocks Next on an unfinished step and names what is missing', async () => {
    const onNavigateStep = renderShell('learner');
    await waitForHydration();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/Please complete this step before continuing/i)).toBeInTheDocument();
    // Listed by field name — the same label the form shows.
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toContain('Address');
    expect(onNavigateStep).not.toHaveBeenCalled();
    expect(saveExtendedIlr).not.toHaveBeenCalled();
  });

  it('blocks the tab-bar arrow on an unfinished step', async () => {
    const onNavigateStep = renderShell('learner');
    await waitForHydration();

    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));

    expect(await screen.findByText(/Please complete this step before continuing/i)).toBeInTheDocument();
    expect(onNavigateStep).not.toHaveBeenCalled();
  });

  it('locks the tabs of steps that are still out of reach', async () => {
    const onNavigateStep = renderShell('learner');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Policies' })).toHaveAttribute('aria-disabled', 'true'));

    await userEvent.click(screen.getByRole('tab', { name: 'Policies' }));
    expect(onNavigateStep).not.toHaveBeenCalled();
  });

  it('always allows going back to an earlier step, saving what was typed', async () => {
    const onNavigateStep = renderShell('learner');
    await waitForHydration();

    await userEvent.click(screen.getByRole('tab', { name: 'Introduction' }));
    expect(onNavigateStep).toHaveBeenCalledWith(0);
    // Backwards saves but never blocks — the learner has no Save button of their own.
    await waitFor(() => expect(saveExtendedIlr).toHaveBeenCalled());
  });

  it('gives the learner no Save progress button — Next is the save', async () => {
    renderShell('learner');
    await waitForHydration();

    expect(screen.queryByRole('button', { name: /Save progress/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('fires the save and moves on without waiting for it', async () => {
    fetchExtendedIlr.mockResolvedValue({
      answers: null,
      draft: { personalDetails: COMPLETE_PERSONAL_DETAILS },
      meta: { updatedAt: '2026-08-01T00:00:00Z' },
    });
    const onNavigateStep = renderShell('learner');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills Radar' })).not.toHaveAttribute('aria-disabled'));

    // Something the learner actually changed — a save is only owed on answers
    // that differ from what was hydrated (see the no-op test below).
    // Found by its hydrated value — the wizard's labels aren't wired to their
    // inputs with htmlFor, so getByLabelText doesn't reach them.
    await userEvent.type(screen.getByDisplayValue(COMPLETE_PERSONAL_DETAILS.address), ', Flat 2');

    // Held open so the write is still in flight when the move is asserted: the
    // learner must not be made to wait for the network to read the next step.
    let release!: () => void;
    saveExtendedIlr.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ meta: { updatedAt: '2026-08-02T00:00:00Z' } }); })
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(onNavigateStep).toHaveBeenCalledWith(2));
    // Requested on the way out, and the step changed while it was unresolved.
    expect(saveExtendedIlr).toHaveBeenCalled();
    expect(saveExtendedIlr.mock.invocationCallOrder[0]).toBeLessThan(onNavigateStep.mock.invocationCallOrder[0]);
    release();
  });

  it('keeps the learner moving when the save fails', async () => {
    // The save no longer gates navigation, so a dropped write costs a toast
    // rather than trapping the learner on the step.
    fetchExtendedIlr.mockResolvedValue({
      answers: null,
      draft: { personalDetails: COMPLETE_PERSONAL_DETAILS },
      meta: { updatedAt: '2026-08-01T00:00:00Z' },
    });
    saveExtendedIlr.mockRejectedValue(new Error('network down'));
    const onNavigateStep = renderShell('learner');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills Radar' })).not.toHaveAttribute('aria-disabled'));

    await userEvent.type(screen.getByDisplayValue(COMPLETE_PERSONAL_DETAILS.address), ', Flat 2');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(onNavigateStep).toHaveBeenCalledWith(2));
  });

  it('writes nothing when moving off a step the learner never touched', async () => {
    // The whole draft is stored in one row, so without a dirty check every step
    // change re-wrote all eight steps — a step with no inputs at all still sat
    // there showing "Saving…" on the way out of it.
    fetchExtendedIlr.mockResolvedValue({
      answers: null,
      draft: { personalDetails: COMPLETE_PERSONAL_DETAILS },
      meta: { updatedAt: '2026-08-01T00:00:00Z' },
    });
    const onNavigateStep = renderShell('learner');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills Radar' })).not.toHaveAttribute('aria-disabled'));

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(onNavigateStep).toHaveBeenCalledWith(2));
    expect(saveExtendedIlr).not.toHaveBeenCalled();
  });

  it('still saves an untouched draft that has never been stored', async () => {
    // Nothing hydrated means no row exists yet: the first move forward has to
    // create it, or a learner who fills in nothing is never written at all.
    const onNavigateStep = renderShell('learner');
    await waitForHydration();

    await userEvent.click(screen.getByRole('tab', { name: 'Introduction' }));

    expect(onNavigateStep).toHaveBeenCalledWith(0);
    await waitFor(() => expect(saveExtendedIlr).toHaveBeenCalled());
  });

  it('keeps the Skills Radar blocking even though its step has never been opened', async () => {
    fetchKsbProfile.mockResolvedValue({
      results: [{ id: 'ksb-1', codes: ['K1'], title: 'A competency', theme: 'Theme', kind: 'Knowledge' }],
    });
    fetchExtendedIlr.mockResolvedValue({
      answers: null,
      draft: { personalDetails: COMPLETE_PERSONAL_DETAILS },
      meta: { updatedAt: '2026-08-01T00:00:00Z' },
    });
    const onNavigateStep = renderShell('learner');

    // Personal Details is finished, so Skills Radar opens — but nothing beyond it.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Extended ILR' })).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByRole('tab', { name: 'Skills Radar' })).not.toHaveAttribute('aria-disabled');

    await userEvent.click(screen.getByRole('tab', { name: 'Extended ILR' }));
    expect(onNavigateStep).not.toHaveBeenCalled();
  });

  it('claims no progress until the saved answers have loaded', async () => {
    // The draft starts as a blank seeded form, so measuring completeness before
    // hydration reported a returning learner's finished steps as "Not started"
    // and then jumped the total up as the answers (and the seeded KSB rows)
    // landed — the flicker looked like progress had been lost.
    let release!: () => void;
    fetchExtendedIlr.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({
          answers: null,
          draft: { personalDetails: COMPLETE_PERSONAL_DETAILS },
          meta: { updatedAt: '2026-08-01T00:00:00Z' },
        });
      })
    );

    renderShell('learner');

    // Still in flight: no percentage, no step counted, nothing called unstarted.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/Loading your answers/i)).toBeInTheDocument();
    expect(screen.queryByText(/steps complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();

    release();

    // Personal Details was already filled in, so it reports itself complete on
    // the first status the learner is ever shown. Four in total: the two steps
    // with nothing to answer (Introduction, Next Steps) and the Skills Radar,
    // which this programme seeds no competencies for.
    await waitFor(() => expect(screen.getByText(/4 of 8 steps complete/i)).toBeInTheDocument());
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('claims no progress until the programme competencies have seeded either', async () => {
    // The second async wave, and the one the first fix missed. Competencies are
    // fetched *after* hydration, and an unseeded Skills Radar has nothing unrated
    // in it — so between the two the step counted as complete and the total
    // ticked up a second time (the 3-of-8 → 4-of-8 jump in the bug report).
    fetchExtendedIlr.mockResolvedValue({
      answers: null,
      draft: { personalDetails: COMPLETE_PERSONAL_DETAILS },
      meta: { updatedAt: '2026-08-01T00:00:00Z' },
    });
    let releaseKsbs!: () => void;
    fetchKsbProfile.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseKsbs = () => resolve({
          results: [{ id: 'ksb-1', codes: ['K1'], title: 'A competency', theme: 'Theme', kind: 'Knowledge' }],
        });
      })
    );

    renderShell('learner');

    // Hydration has landed, but the competencies have not: nothing may be
    // claimed yet, least of all a Skills Radar that only looks finished because
    // its rows don't exist. Waited on the KSB request rather than hydration —
    // the seeding effect only runs once hydration has released it.
    await waitFor(() => expect(fetchKsbProfile).toHaveBeenCalled());
    expect(screen.getByText(/Loading your answers/i)).toBeInTheDocument();
    expect(screen.queryByText(/steps complete/i)).not.toBeInTheDocument();

    releaseKsbs();

    // Now measurable — and the Skills Radar is correctly outstanding, so the
    // count settles at 3, never having shown 4.
    await waitFor(() => expect(screen.getByText(/3 of 8 steps complete/i)).toBeInTheDocument());
    expect(screen.queryByText(/4 of 8 steps complete/i)).not.toBeInTheDocument();
  });

  it('does not gate the staff wizard, and keeps its Save progress button', async () => {
    const onNavigateStep = renderShell('staff');
    await waitForHydration();

    expect(screen.getByRole('button', { name: /Save progress/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Policies' }));
    await waitFor(() => expect(onNavigateStep).toHaveBeenCalledWith(6));
  });
});
