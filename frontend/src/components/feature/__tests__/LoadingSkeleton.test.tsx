import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingControl, LoadingLabel } from '../LoadingSkeleton';

describe('shared loading presentation', () => {
  it('renders waiting labels as accessible skeletons and preserves loaded content', () => {
    const { rerender } = render(<LoadingLabel>Loading review dates…</LoadingLabel>);
    expect(screen.getByLabelText('Loading review dates…')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading review dates…')).toHaveClass('sr-only');
    rerender(<LoadingLabel>18 November 2026</LoadingLabel>);
    expect(screen.getByText('18 November 2026')).toBeVisible();
    expect(screen.queryByLabelText('Loading review dates…')).not.toBeInTheDocument();
    rerender(<LoadingLabel>Loading bay inspection</LoadingLabel>);
    expect(screen.getByText('Loading bay inspection')).toBeVisible();
    expect(screen.getByText('Loading bay inspection')).not.toHaveClass('sr-only');
    rerender(<LoadingLabel><a href="https://example.invalid/reviews">Open review</a></LoadingLabel>);
    expect(screen.getByRole('link', { name: 'Open review' })).toHaveAttribute('href', 'https://example.invalid/reviews');
  });

  it('retains a control, its value and its keyboard focus while options refresh', () => {
    const select = <select aria-label="Programme" defaultValue="one"><option value="one">Programme one</option><option value="two">Programme two</option></select>;
    const { rerender } = render(<LoadingControl loading={false}>{select}</LoadingControl>);
    const control = screen.getByRole('combobox', { name: 'Programme' });
    control.focus();
    fireEvent.change(control, { target: { value: 'two' } });
    rerender(<LoadingControl loading>{select}</LoadingControl>);
    expect(screen.getByRole('combobox', { name: 'Programme' })).toBe(control);
    expect(control).toHaveFocus();
    expect(control).toHaveValue('two');
    rerender(<LoadingControl loading={false}>{select}</LoadingControl>);
    expect(control).toHaveFocus();
    expect(control).toHaveValue('two');
  });
});
