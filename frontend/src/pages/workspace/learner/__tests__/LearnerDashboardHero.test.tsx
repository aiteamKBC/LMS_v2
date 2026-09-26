import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { LearnerDashboardHero } from '../LearnerDashboardHero';

const props = {
  avatar: <button aria-label="Upload profile photo">AL</button>,
  name: 'Alex Learner', description: 'Business programme · Example employer', cohort: 'Autumn cohort',
  moduleLabel: 'Current modules', modulePlaceholder: '--',
  modules: Array.from({ length: 7 }, (_, i) => ({ id: `module-${i}`, title: `Learning module ${i + 1}`, href: `/learner/my-learning/commercial/123?subject=current%3Amodule-${i}&week=current` })),
  allModulesHref: '/learner/my-learning/commercial/123', actionCards: [{ title: 'Your next action', subtitle: 'Next module', description: 'Continue learning', href: '/learner/next', cta: 'Continue', status: 'Ready' }], employer: 'Example Employer', organization: 'Example Organization', coach: 'Example Coach', coachEmail: 'coach@example.test', coachPhone: '07700 900123', status: 'Active',
  startDate: '3 August 2026', plannedEnd: '2 August 2027', loading: false,
  onContinue: vi.fn(), onOpenMap: vi.fn(),
};

describe('Learner dashboard hero', () => {
  it('keeps all assigned module links, actual placement facts, and existing actions accessible', () => {
    render(<MemoryRouter><LearnerDashboardHero {...props} /></MemoryRouter>);
    const hero = within(screen.getByRole('banner', { name: 'Learner programme' }));
    expect(hero.getByRole('heading', { level: 1, name: props.name })).toBeVisible();
    expect(hero.getByText(props.cohort)).toBeVisible();
    expect(hero.getByText(props.employer)).toBeVisible();
    expect(hero.getByText(props.organization)).toBeVisible();
    expect(hero.getByText(props.coach)).toBeVisible();
    expect(hero.getByRole('link', { name: props.coachEmail })).toHaveAttribute('href', `mailto:${props.coachEmail}`);
    expect(hero.getByRole('link', { name: props.coachPhone })).toHaveAttribute('href', 'tel:07700900123');
    expect(hero.getByText(props.startDate)).toBeVisible();
    expect(hero.getByText(props.plannedEnd)).toBeVisible();
    const details = hero.getByLabelText('Programme details');
    expect(details).toHaveTextContent('Cohort');
    expect(details).toHaveTextContent(props.cohort);
    expect(details).toHaveTextContent('Start date');
    expect(details).toHaveTextContent(props.startDate);
    expect(details).toHaveTextContent('End date');
    expect(details).toHaveTextContent(props.plannedEnd);
    expect(hero.queryByRole('region', { name: 'Programme dates' })).not.toBeInTheDocument();
    expect(hero.getByLabelText('Status: Active')).toBeVisible();
    expect(hero.queryByRole('region', { name: 'Programme status' })).not.toBeInTheDocument();
    const employment = hero.getByRole('region', { name: 'Employer and Organization' });
    expect(employment).toHaveTextContent(props.employer);
    expect(employment).toHaveTextContent(props.organization);
    expect(hero.getByRole('region', { name: 'Learner actions' })).toBeVisible();
    expect(hero.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/learner/next');
    expect(hero.getByRole('group', { name: 'Your next action: Next module' })).toBeVisible();
    const coach = hero.getByRole('region', { name: 'Coach' });
    expect(employment.compareDocumentPosition(coach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(coach.compareDocumentPosition(hero.getByRole('region', { name: props.moduleLabel }))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.getByLabelText('Status: On break')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status: Active')).not.toBeInTheDocument();
  });
});
