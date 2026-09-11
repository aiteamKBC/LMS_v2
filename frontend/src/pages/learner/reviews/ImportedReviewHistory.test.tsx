import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportedReviewHistory } from './ImportedReviewHistory';

function reply(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal('AppIcon', ({ className }: { className?: string }) => <i className={className} />);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({
    learnerId: 272,
    category: 'progress-review',
    reviews: [
      {
        id: '72', aptemReviewId: 'A72', name: 'Progress Review August', type: 'Progress Review',
        reviewerName: 'Coach One', plannedDate: '2026-08-13', plannedTime: '11:00',
        completedDate: '2026-08-13', status: 'completed', extractionStatus: 'success', detailsAvailable: true,
        sections: [{
          id: 235, name: 'Learning Progress', order: 1,
          fields: [{ label: 'Overall progress', value: '64%' }], tables: [], rawText: '',
        }],
      },
      {
        id: '71', aptemReviewId: 'A71', name: 'Progress Review September', type: 'Progress Review (+ Skills Radar)',
        reviewerName: 'Coach Two', plannedDate: '2026-09-30', plannedTime: null,
        completedDate: null, status: 'not-scheduled', extractionStatus: 'partial', detailsAvailable: false, sections: [],
      },
    ],
  })));
});

afterEach(() => vi.unstubAllGlobals());

describe('ImportedReviewHistory', () => {
  it('opens the imported review sections inside the list page', async () => {
    render(<ImportedReviewHistory kind="commercial" learnerId="125" category="progress-review" />);

    fireEvent.click(await screen.findByRole('button', { name: /Progress Review August/i }));

    expect(screen.getByRole('heading', { name: 'Progress Review August' })).toBeInTheDocument();
    expect(screen.getByText('Learning Progress')).toBeInTheDocument();
    expect(screen.getByText('Overall progress')).toBeInTheDocument();
    expect(screen.getByText('64%')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/learner_api/review-history/commercial/125/?category=progress-review',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('filters the imported records by status', async () => {
    render(<ImportedReviewHistory kind="commercial" learnerId="125" category="progress-review" />);
    await screen.findByText('Progress Review August');

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'not-scheduled' } });

    expect(screen.queryByText('Progress Review August')).not.toBeInTheDocument();
    expect(screen.getByText('Progress Review September')).toBeInTheDocument();
  });
});
