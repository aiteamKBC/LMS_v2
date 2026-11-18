import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExecutiveOverview from './page';
import { loadLiveQmsData } from './qualityData';

vi.mock('./qualityData', () => ({ loadLiveQmsData: vi.fn() }));

afterEach(cleanup);

describe('Quality notifications in the overview', () => {
  it('keeps notifications visible while dashboard data loads and if loading fails', async () => {
    vi.mocked(loadLiveQmsData).mockRejectedValue(new Error('Quality data unavailable'));
    render(<MemoryRouter><ExecutiveOverview attentionPanel={<section aria-label="Needs Attention">Synthetic quality alert</section>} /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Needs Attention' })).toHaveTextContent('Synthetic quality alert');
    expect(await screen.findByRole('alert')).toHaveTextContent('Quality data unavailable');
    expect(screen.getByRole('region', { name: 'Needs Attention' })).toHaveTextContent('Synthetic quality alert');
    expect(screen.getByRole('button', { name: 'Retry quality data' })).toBeInTheDocument();
  });
});
