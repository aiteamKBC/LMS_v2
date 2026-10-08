import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ReviewSections, { HistoricalCoachMarking } from './ReviewSections';

afterEach(() => vi.unstubAllGlobals());

it('shows the original coach decision and feedback without rendering unsafe markup', () => {
  render(<HistoricalCoachMarking status="Accepted" feedbacks={[{
    assessed_status: 'Accepted', author: 'Coach Example', date: '2026-09-12T10:00:00Z',
    message: '<p>Good evidence for this assessment.</p><img src=x onerror="alert(1)">',
  }]} />);
  const marking = screen.getByLabelText('Original coach marking');
  expect(marking).toHaveTextContent('Coach marking · Accepted');
  expect(marking).toHaveTextContent('Coach Example');
  expect(marking).toHaveTextContent('2026-09-12');
  expect(marking).toHaveTextContent('Good evidence for this assessment.');
  expect(marking.querySelector('[onerror]')).toBeNull();
});

it('uses the coaching database review rows in the Advanced Admin learner page', async () => {
  const external = { id: '41', componentId: 41, aptemReviewId: '',
    name: 'External Progress Review', type: 'Progress Review', status: 'completed',
    plannedDate: '2026-09-10', completedDate: '2026-09-10', sections: [],
    aiCoachingReport: null };
  const local = { ...external, id: 'old', name: 'Local review from LMS' };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const data = path.includes('coaching-reviews/') ? { pr: [external], mcm: [] }
      : path.endsWith('/reviews/') ? { pr: [local], mcm: [] }
        : path.includes('/quality/') ? { tutor: [], lecture: [] }
          : path.includes('/eligibility/') ? { native: [], imported: [] }
            : path.includes('/inclusion/') ? { reports: [], tickets: [], supportTickets: [] }
              : { items: [] };
    return { ok: true, json: async () => data };
  }));
  render(<MemoryRouter><ReviewSections learnerId={42} assigned={[]} selectedTab="reviews" showTabs={false} /></MemoryRouter>);
  expect(await screen.findByText('External Progress Review')).toBeInTheDocument();
  expect(screen.queryByText('Local review from LMS')).not.toBeInTheDocument();
});

it('shows eligibility reviews as PDF records without printing imported answer text', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const data = path.includes('/eligibility/') ? { native: [], imported: [{
      id: 'elig-1', aptemReviewId: 'aptem-1', name: 'Eligibility Review',
      status: 'completed', completedDate: '2026-09-12', plannedDate: null,
      sections: [{ id: 'one', fields: [{ label: 'Private answer', value: 'RAW_ELIGIBILITY_TEXT' }] }],
    }] } : path.includes('/reviews/') ? { pr: [], mcm: [] }
      : path.includes('/quality/') ? { tutor: [], lecture: [] }
        : path.includes('/inclusion/') ? { reports: [], tickets: [], supportTickets: [] }
          : { items: [] };
    return { ok: true, json: async () => data };
  }));
  render(<MemoryRouter><ReviewSections learnerId={42} assigned={[]} selectedTab="eligibility" showTabs={false} /></MemoryRouter>);
  expect(await screen.findByText(/Eligibility Review · completed/)).toBeInTheDocument();
  expect(screen.queryByText('RAW_ELIGIBILITY_TEXT')).not.toBeInTheDocument();
});
