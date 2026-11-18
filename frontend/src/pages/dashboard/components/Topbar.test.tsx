import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Topbar from './Topbar';

vi.mock('@/components/feature/Header', () => ({ Header: () => null }));

describe('Quality workspace breadcrumbs', () => {
  it('shows the open view and keeps the recording and quality entry points reachable', () => {
    const { rerender } = render(<MemoryRouter><Topbar onMenu={() => {}} title="Dashboard" section="Analytics" /></MemoryRouter>);
    const breadcrumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(breadcrumbs.getByRole('link', { name: 'Recordings hub' })).toHaveAttribute('href', '/curriculum/recordings-hub');
    expect(breadcrumbs.getByRole('link', { name: 'Quality Assurance' })).toHaveAttribute('href', '/curriculum/quality-demo?view=overview');
    expect(breadcrumbs.getByText('Dashboard')).toHaveAttribute('aria-current', 'page');
    expect(breadcrumbs.queryByText('Analytics')).not.toBeInTheDocument();

    rerender(<MemoryRouter><Topbar onMenu={() => {}} title="Deep Dive" section="Quality Assurance" /></MemoryRouter>);
    expect(breadcrumbs.getByText('Deep Dive')).toHaveAttribute('aria-current', 'page');
    expect(breadcrumbs.queryByText('Dashboard')).not.toBeInTheDocument();
  });
});
