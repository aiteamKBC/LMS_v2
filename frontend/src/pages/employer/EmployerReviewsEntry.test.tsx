import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import GatewayEntry from './gateway-epa/page';
import ProgressEntry from './progress-reviews/page';

const session = vi.hoisted(() => ({ isInitialized: true, account: null as null | {
  role: string; subjectId: number; accessHome?: string;
} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: session.account }, isInitialized: session.isInitialized }) }));
afterEach(() => { cleanup(); session.isInitialized = true; session.account = null; });
function Destination() {
  const location = useLocation();
  return <output data-testid="destination">{location.pathname}{location.search}</output>;
}
function show(Entry: typeof GatewayEntry) {
  render(<MemoryRouter initialEntries={['/legacy?employerId=999']}><Routes>
    <Route path="/legacy" element={<Entry />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter>);
}
it.each([GatewayEntry, ProgressEntry])('opens the signed-in employer own real review portal', Entry => {
  session.account = { role: 'employer', subjectId: 7 };
  show(Entry);
  expect(screen.getByTestId('destination')).toHaveTextContent('/employers/7/reviews');
  expect(screen.queryByText(/Mark Jensen|Lauren Mitchell/)).not.toBeInTheDocument();
});
it.each([GatewayEntry, ProgressEntry])('requires sign-in rather than showing sample learner records', Entry => {
  show(Entry);
  expect(screen.getByTestId('destination')).toHaveTextContent('/login');
});
it('waits for session initialization before choosing an employer', () => {
  session.isInitialized = false;
  show(GatewayEntry);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(screen.queryByTestId('destination')).not.toBeInTheDocument();
});
it('keeps staff on their own workspace instead of guessing an employer identity', () => {
  session.account = { role: 'staff', subjectId: 7, accessHome: '/workspace/admin' };
  show(GatewayEntry);
  expect(screen.getByTestId('destination')).toHaveTextContent('/workspace/admin');
});
it('explains a missing employer link without sending the account to sample data', () => {
  session.account = { role: 'employer', subjectId: 0 };
  show(GatewayEntry);
  expect(screen.getByRole('alert')).toHaveTextContent('not linked to an employer record');
  expect(screen.queryByTestId('destination')).not.toBeInTheDocument();
});
