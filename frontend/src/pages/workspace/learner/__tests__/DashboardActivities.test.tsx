import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { LearnerKind } from '@/api/learnerDetail';
import { DashboardActivities } from '../DashboardActivities';

afterEach(cleanup);

function show(kind: LearnerKind = 'apprenticeship', programmeStatus = 'Active', denied: string[] = []) {
  render(<MemoryRouter><DashboardActivities kind={kind} programmeStatus={programmeStatus} canSeeNavItem={id => !denied.includes(id)} /></MemoryRouter>);
}

describe('Dashboard activities audience', () => {
  it('preserves Community group permissions after moving the links', () => {
    show('apprenticeship', 'Active', ['learner-group-community']);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('keeps individual destination permissions and the remaining working links', () => {
    show('apprenticeship', 'Active', ['learner-rewards']);
    expect(screen.queryByRole('link', { name: 'Points & rewards' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clubs & meetings' })).toHaveAttribute('href', '/learner/clubs');
    expect(screen.getByRole('link', { name: 'Events & bookings' })).toHaveAttribute('href', '/learner/clubs/events');
    expect(screen.getByRole('link', { name: 'Flash cards' })).toHaveAttribute('href', '/learner/flash-cards');
  });
  it.each(['Fresh user', 'Onboarding', 'Delivery'])('retains the pre-teaching restriction for %s', status => {
    show('apprenticeship', status);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('retains the commercial learner restriction', () => {
    show('commercial');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
