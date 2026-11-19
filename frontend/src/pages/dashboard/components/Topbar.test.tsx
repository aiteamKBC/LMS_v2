import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { QualityNavigation } from '@/pages/curriculum/hubs/QualityWorkspace';
it('uses the current modular curriculum routes without restoring the retired topbar', () => {
  render(<MemoryRouter><QualityNavigation /></MemoryRouter>);
  expect(screen.getByRole('navigation', { name: 'Quality workspaces' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute('href', '/curriculum/quality?view=feedbacks');
  expect(screen.getByRole('link', { name: 'Deep Dive' })).toHaveAttribute('href', '/curriculum/quality?view=deep-dive');
  expect(screen.getByRole('link', { name: 'Quality checks' })).toHaveAttribute('href', '/curriculum/quality');
});
