import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useOperatorIdentity', () => ({
  useOperatorIdentity: () => ({ name: 'Rebecca Holmes', role: 'Engagement Manager' }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: EngagementFeedbacksPage } = await import('../page');

function renderPage() {
  return render(<MemoryRouter><EngagementFeedbacksPage /></MemoryRouter>);
}

describe('engagement feedbacks report', () => {
  it('combines event and progress feedback sources', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Feedbacks' })).toBeTruthy();
    expect(screen.getAllByText('Event feedback').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Progress feedback').length).toBeGreaterThan(0);
    expect(screen.getByText(/11 of 11 feedbacks shown/)).toBeTruthy();
    expect(screen.getByText(/Excellent progress on your campaign planning KSBs Sophie/)).toBeTruthy();
    expect(screen.getByText(/Sarah was an incredible facilitator/)).toBeTruthy();
  });

  it('filters the combined report by source', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Source'), 'Progress feedback');

    expect(screen.getByText(/3 of 11 feedbacks shown/)).toBeTruthy();
    expect(screen.getByText(/Excellent progress on your campaign planning KSBs Sophie/)).toBeTruthy();
    expect(screen.queryByText(/Sarah was an incredible facilitator/)).toBeNull();
  });
});
