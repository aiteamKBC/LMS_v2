import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OtjHoursSummary } from './OtjHoursSummary';

afterEach(cleanup);

function tile(label: string) {
  const dt = screen.getByText(label);
  // dt and dd are siblings inside the tile wrapper.
  return within(dt.parentElement as HTMLElement);
}

describe('OtjHoursSummary', () => {
  it('renders the five tiles in order with rounded hour values', () => {
    render(<OtjHoursSummary minimumRequired={557} plannedIlr={576} submitted={36} completed={316} forecast={639} />);
    const labels = screen.getAllByRole('term').map(node => node.textContent);
    expect(labels).toEqual(['Minimum required', 'Planned (ILR)', 'Submitted', 'Completed', 'Forecast']);
    expect(tile('Minimum required').getByText('557h')).toBeInTheDocument();
    expect(tile('Planned (ILR)').getByText('576h')).toBeInTheDocument();
    expect(tile('Submitted').getByText('36h')).toBeInTheDocument();
    expect(tile('Completed').getByText('316h')).toBeInTheDocument();
    expect(tile('Forecast').getByText('639h')).toBeInTheDocument();
  });

  it('shows the unavailable convention for measures without a value', () => {
    render(<OtjHoursSummary plannedIlr={576} submitted={36} completed={316} minimumRequired={null} forecast={null} />);
    expect(tile('Minimum required').getByText('—')).toBeInTheDocument();
    expect(tile('Forecast').getByText('—')).toBeInTheDocument();
    expect(tile('Planned (ILR)').getByText('576h')).toBeInTheDocument();
  });
});
