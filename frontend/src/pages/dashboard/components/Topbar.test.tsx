import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Topbar from './Topbar';

vi.mock('@/components/feature/Header', () => ({ Header: () => null }));

describe('Quality workspace breadcrumbs', () => {
  it('starts at Curriculum and shows one quality overview instead of a nested Dashboard', () => {
    const { rerender } = render(<MemoryRouter><Topbar onMenu={() => {}} title="Quality Assurance" section="Curriculum Studio" /></MemoryRouter>);
    const breadcrumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(breadcrumbs.getByRole('link', { name: 'Curriculum home' })).toHaveAttribute('href', '/workspace/curriculum');
    expect(breadcrumbs.getByText('Quality Assurance')).toHaveAttribute('aria-current', 'page');
    expect(breadcrumbs.getByRole('link', { name: 'Recording Quality' })).toHaveAttribute('href', '/curriculum/recordings-hub');
    expect(breadcrumbs.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(breadcrumbs.queryByText('Analytics')).not.toBeInTheDocument();

    rerender(<MemoryRouter><Topbar onMenu={() => {}} title="Deep Dive" section="Quality Assurance" /></MemoryRouter>);
    expect(breadcrumbs.getByText('Deep Dive')).toHaveAttribute('aria-current', 'page');
    expect(breadcrumbs.getByRole('link', { name: 'Recording Quality' })).toHaveAttribute('href', '/curriculum/recordings-hub');
    expect(breadcrumbs.queryByText('Quality Assurance')).not.toBeInTheDocument();
    expect(breadcrumbs.queryByText('Dashboard')).not.toBeInTheDocument();
  });
});
