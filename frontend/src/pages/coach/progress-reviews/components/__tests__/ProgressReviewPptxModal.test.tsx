/**
 * The per-review PPTX workflow that replaced the standalone "Progress Review
 * PPTX" panel. Context (learner, review date) comes entirely from the review
 * card that opened the modal — these tests pin that no learner/period
 * picker ever appears, that an existing deck is detected and skips straight
 * to Download/Regenerate, and that the four generation states behave as
 * specified (idle, generating, generated, failed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachCalendarEvent } from '../../../shared/calendarEvents';

const fetchReviewPack = vi.fn();
const fetchLatestRun = vi.fn();
const generateProgressReview = vi.fn();
const fetchProgressReviewDownloadUrl = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/api/progressReviews', async () => {
  const actual = await vi.importActual<typeof import('@/api/progressReviews')>('@/api/progressReviews');
  return {
    ...actual,
    fetchReviewPack: (...args: unknown[]) => fetchReviewPack(...args),
    fetchLatestRun: (...args: unknown[]) => fetchLatestRun(...args),
    generateProgressReview: (...args: unknown[]) => generateProgressReview(...args),
    fetchProgressReviewDownloadUrl: (...args: unknown[]) => fetchProgressReviewDownloadUrl(...args),
  };
});

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

const { default: ProgressReviewPptxModal } = await import('../ProgressReviewPptxModal');

const REVIEW: CoachCalendarEvent = {
  id: 'progress-review:101:1:2026-10-26',
  eventKey: 'progress-review:101:1:2026-10-26',
  title: 'Progress Review',
  type: 'review',
  source: 'progress-review',
  status: 'in-progress',
  learner: 'Aya Aya Test',
  programme: 'Final Test',
  learnerId: '101',
  enrolmentId: '101',
  learnerType: 'commercial',
  sequence: 1,
  targetDate: '2026-10-26',
};

const SAMPLE_PACK = {
  learner: { full_name: 'Aya Aya Test', active_status: true },
  review: { review_number: 1, review_period_start: '2026-08-04', review_period_end: '2026-10-26' },
  attendance: { attendance_percentage: 'Not available' },
  progress: { current_programme_progress_percentage: 12 },
  otj: { risk_status: 'At risk' },
  epa: { current_readiness: '40%' },
  lms_modules: [],
  evidence: [],
  assignments: [],
  workplace_activities: [],
  ksbs: { knowledge_evidenced: [], skills_evidenced: [], behaviours_evidenced: [], priority_next: [] },
  actions: [],
  manager_questions: [],
  source_warnings: [
    'No attendance records found for this review period.',
    'Learner role is unavailable.',
    'Project Showcase confidence has no source data.',
  ],
};

beforeEach(() => {
  fetchReviewPack.mockReset();
  fetchLatestRun.mockReset();
  generateProgressReview.mockReset();
  fetchProgressReviewDownloadUrl.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
  fetchReviewPack.mockResolvedValue(SAMPLE_PACK);
  fetchLatestRun.mockResolvedValue({ exists: false });
  vi.stubGlobal('open', vi.fn());
});

describe('ProgressReviewPptxModal', () => {
  it('takes its context entirely from the review card — no learner or period picker', async () => {
    render(<ProgressReviewPptxModal open review={REVIEW} onClose={vi.fn()} />);

    expect(screen.getByText('Progress Review Slides')).toBeInTheDocument();
    expect(screen.getByText(/Aya Aya Test/)).toBeInTheDocument();
    expect(screen.getByText(/Final Test/)).toBeInTheDocument();
    expect(fetchReviewPack).toHaveBeenCalledWith('101', '2026-10-26');
    expect(fetchLatestRun).toHaveBeenCalledWith('101', '2026-10-26');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/select.*learner/i)).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Generate PPTX')).toBeInTheDocument());
  });

  it('shows the compact preview and warnings once the pack loads', async () => {
    render(<ProgressReviewPptxModal open review={REVIEW} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('12%')).toBeInTheDocument());
    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText(/Missing data warnings \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/No attendance records found/)).toBeInTheDocument();
  });

  it('skips straight to Download/Regenerate when a deck already exists for this exact review', async () => {
    fetchLatestRun.mockResolvedValue({ exists: true, reviewId: 'run-1', generationStatus: 'completed' });
    render(<ProgressReviewPptxModal open review={REVIEW} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Download PPTX')).toBeInTheDocument());
    expect(screen.getByText('Regenerate')).toBeInTheDocument();
    expect(screen.queryByText('Generate PPTX')).not.toBeInTheDocument();
  });

  it('walks through generating -> generated -> download', async () => {
    let resolveGenerate!: (value: unknown) => void;
    generateProgressReview.mockReturnValue(new Promise((resolve) => { resolveGenerate = resolve; }));
    fetchProgressReviewDownloadUrl.mockResolvedValue('https://example.blob.core.windows.net/deck.pptx?sig=1');
    const user = userEvent.setup();

    render(<ProgressReviewPptxModal open review={REVIEW} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Generate PPTX')).toBeInTheDocument());

    await user.click(screen.getByText('Generate PPTX'));
    expect(screen.getByText('Generating slides…')).toBeInTheDocument();

    resolveGenerate({ reviewId: 'run-2', learnerId: 101, generationStatus: 'completed', sourceWarnings: [] });
    await waitFor(() => expect(screen.getByText('Slides generated successfully.')).toBeInTheDocument());
    expect(generateProgressReview).toHaveBeenCalledWith('101', '2026-10-26');

    await user.click(screen.getByText('Download PPTX'));
    await waitFor(() => expect(fetchProgressReviewDownloadUrl).toHaveBeenCalledWith('run-2'));
  });

  it('shows a blocking error message and lets the user try again on failure', async () => {
    generateProgressReview.mockRejectedValue(new Error('Learner ID missing.'));
    const user = userEvent.setup();

    render(<ProgressReviewPptxModal open review={REVIEW} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Generate PPTX')).toBeInTheDocument());
    await user.click(screen.getByText('Generate PPTX'));

    await waitFor(() => expect(screen.getByText('Generation failed')).toBeInTheDocument());
    expect(screen.getByText('Learner ID missing.')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('confirms before regenerating an already-completed review', async () => {
    fetchLatestRun.mockResolvedValue({ exists: true, reviewId: 'run-1', generationStatus: 'completed' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    render(<ProgressReviewPptxModal open review={{ ...REVIEW, status: 'completed' }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Regenerate')).toBeInTheDocument());

    await user.click(screen.getByText('Regenerate'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(generateProgressReview).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
