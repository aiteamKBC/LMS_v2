import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { OtjHoursChart, type OfficialProgramme } from './OtjHoursChart';
const points = [
  { key: '2026-01', label: 'January 2026', target: 200, completed: 10, submitted: 2 },
  { key: '2026-07', label: 'July 2026', target: 200, completed: 20, submitted: 3 },
];
afterEach(cleanup);
it.each(['ready', 'loading', 'error'] as const)('omits the entire official summary on %s while preserving the training-plan chart', request => {
  const snapshot: OfficialProgramme = { actual: 120, planned: 288, target: 143.61, request };
  render(<OtjHoursChart points={points} plannedHours={400} officialTarget={{ value: 143.61, request: 'ready' }} officialProgramme={snapshot} />);
  expect(screen.queryByRole('region', { name: 'Official Programme Completion' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Official Programme Completion|Official Planned Hours|Canonical Actual Hours|Official Target Marker|Official Variance/)).not.toBeInTheDocument();
  const plan = screen.getByRole('progressbar', { name: 'Training plan off-the-job hours progress' });
  expect(plan).toHaveAttribute('aria-valuenow', '8');
  expect(plan.querySelector('b')).toHaveStyle({ left: '36%' });
  expect(plan.querySelectorAll('i')).toHaveLength(2);
  expect(screen.getByText(/-79%/)).toHaveTextContent('-113.6h');
  expect(screen.getByRole('button', { name: /January 2026: target 200 hours, submitted 2 hours, completed 10 hours/ })).toBeVisible();
});
it.each([null, undefined, 0, 288])('does not render official planned %s even without monthly rows', planned => {
  render(<OtjHoursChart points={[]} officialProgramme={{ actual: 120, planned, target: 100, request: 'ready' }} />);
  expect(screen.queryByText(/Official Programme Completion|Official Planned Hours/)).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
