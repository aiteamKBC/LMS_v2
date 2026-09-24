import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { LearnerDashboardHero } from '../LearnerDashboardHero';

const props = {
  avatar: <button aria-label="Upload profile photo">AL</button>,
  name: 'Alex Learner', description: 'Business programme · Example employer', cohort: 'Autumn cohort',
  moduleLabel: 'Current modules', modulePlaceholder: '--',
  modules: Array.from({ length: 7 }, (_, i) => ({ id: `module-${i}`, title: `Learning module ${i + 1}`, href: `/learner/my-learning/commercial/123?subject=current%3Amodule-${i}&week=current` })),
  allModulesHref: '/learner/my-learning/commercial/123', coach: 'Example Coach', status: 'Active',
  startDate: '3 August 2026', plannedEnd: '2 August 2027', loading: false,
  onContinue: vi.fn(), onOpenMap: vi.fn(),
};

describe('Learner dashboard hero', () => {
  it('keeps all assigned module links, actual placement facts, and existing actions accessible', () => {
    render(<MemoryRouter><LearnerDashboardHero {...props} /></MemoryRouter>);
    const hero = within(screen.getByRole('banner', { name: 'Learner programme' }));
    expect(hero.getByRole('heading', { level: 1, name: props.name })).toBeVisible();
    expect(hero.getByText(props.cohort)).toBeVisible();
    expect(hero.getByText(props.coach)).toBeVisible();
    expect(hero.getByText(props.startDate)).toBeVisible();
    expect(hero.getByText(props.plannedEnd)).toBeVisible();
    const dates = hero.getByRole('region', { name: 'Programme dates' });
    expect(dates.textContent?.indexOf('Start date')).toBeLessThan(dates.textContent?.indexOf('Planned end date'));
    expect(hero.getByText('Active')).toBeVisible();
    expect(hero.queryByText(/on track/i)).not.toBeInTheDocument();
    for (const module of props.modules) {
      expect(hero.getByRole('link', { name: module.title })).toHaveAttribute('href', module.href);
    }
    expect(hero.getByRole('link', { name: 'View all' })).toHaveAttribute('href', props.allModulesHref);
    fireEvent.click(hero.getByRole('button', { name: 'Continue learning' }));
    expect(props.onContinue).toHaveBeenCalledOnce();
    fireEvent.click(hero.getByRole('button', { name: "Learner's Map" }));
    expect(props.onOpenMap).toHaveBeenCalledOnce();
    expect(hero.getByRole('button', { name: 'Upload profile photo' })).toBeEnabled();
  });

  it('preserves loading and unavailable states without inventing a module or positive status', () => {
    const { rerender } = render(<MemoryRouter><LearnerDashboardHero {...props} modules={[]} loading modulePlaceholder="Loading..." status="--" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Continue learning' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    rerender(<MemoryRouter><LearnerDashboardHero {...props} modules={[]} modulePlaceholder="Unavailable" status="On break" /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
    expect(screen.getByText('On break')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });
});
