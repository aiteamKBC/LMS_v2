import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DashboardProgressStat } from './DashboardProgressStat';

function renderStat(percent: number | null) {
  render(
    <MemoryRouter>
      <DashboardProgressStat href="/learner/progress" label="Progress" value="1" summary="1 / 1" percent={percent} accent="purple" />
    </MemoryRouter>,
  );
  return screen.getByRole('link', { name: 'Open Progress' });
}

describe('DashboardProgressStat', () => {
  it('shows placeholders instead of provisional figures while loading', () => {
    render(
      <MemoryRouter>
        <DashboardProgressStat href="/learner/otjh" label="OTJ Hours" value="Loading..." summary="— / — h" percent={null} accent="yellow" loading />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Open OTJ Hours' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading OTJ Hours…');
    expect(screen.queryByText('— / — h')).not.toBeInTheDocument();
  });

  it.each([
    [49, 'red'],
    [50, 'yellow'],
    [79, 'yellow'],
    [80, 'green'],
  ] as const)('uses the %s%% progress colour', (percent, accent) => {
    expect(renderStat(percent)).toHaveAttribute('data-accent', accent);
  });

  it('keeps the supplied accent when progress is unavailable', () => {
    expect(renderStat(null)).toHaveAttribute('data-accent', 'purple');
  });
});
