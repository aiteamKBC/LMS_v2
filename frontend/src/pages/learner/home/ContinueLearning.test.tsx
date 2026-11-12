import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ContinueLearning } from './ContinueLearning';

afterEach(cleanup);

describe('home Continue Learning', () => {
  it.each(['commercial', 'apprenticeship'] as const)('resumes saved progress for the selected %s learner without a calendar week', kind => {
    render(<MemoryRouter><ContinueLearning kind={kind} learnerId="71" enabled /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Continue Learning' })).toHaveAttribute('href', `/learner/my-learning/${kind}/71?resume=1`);
  });

  it('uses the authenticated learner for self-view', () => {
    render(<MemoryRouter><ContinueLearning kind="apprenticeship" learnerId="71" enabled linkIdentity={false}/></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Continue Learning' })).toHaveAttribute('href', '/learner/my-learning?resume=1');
  });

  it('retains the destination prerequisite checks before learning starts', () => {
    render(<MemoryRouter><ContinueLearning kind="commercial" learnerId="502" enabled={false}/></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Continue Learning' })).toHaveAttribute('href', '/learner/my-learning/commercial/502');
  });
});
