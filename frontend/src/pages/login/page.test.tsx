import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LoginPage from './page';
import { AuthError } from '@/api/auth';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ login, auth: { account: null }, isInitialized: true }),
}));
vi.mock('@/api/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/auth')>(),
  apiAuthHealth: vi.fn().mockResolvedValue({ microsoftSso: { configured: false } }),
}));

beforeEach(() => { login.mockReset(); login.mockImplementation(() => new Promise(() => {})); });
afterEach(cleanup);

function openForm() {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  return {
    email: screen.getByLabelText('Email address', { exact: true }) as HTMLInputElement,
    password: screen.getByLabelText('Password', { exact: true }) as HTMLInputElement,
    submit: screen.getByRole('button', { name: 'Sign in to Workspace' }),
  };
}

// Password managers may replace DOM values without firing React's onChange.
function autofill(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
}

it('submits the visible autofilled values instead of stale React state', async () => {
  const { email, password, submit } = openForm();
  fireEvent.change(email, { target: { value: 'old@example.test' } });
  fireEvent.change(password, { target: { value: 'previous-value' } });
  autofill(email, 'current@example.test');
  autofill(password, 'Visible value @ 9');
  fireEvent.click(submit);
  await waitFor(() => expect(login).toHaveBeenCalledWith('current@example.test', 'Visible value @ 9', false));
});

it('allows a first visit filled entirely by the password manager', async () => {
  const { email, password, submit } = openForm();
  autofill(email, 'current@example.test');
  autofill(password, 'Visible value @ 9');
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(login).toHaveBeenCalledWith('current@example.test', 'Visible value @ 9', false));
});

it('preserves typed password spaces and the remember choice', async () => {
  const { email, password, submit } = openForm();
  fireEvent.change(email, { target: { value: 'current@example.test' } });
  fireEvent.change(password, { target: { value: '  Typed value @ 9  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remember me' }));
  fireEvent.click(submit);
  await waitFor(() => expect(login).toHaveBeenCalledWith('current@example.test', '  Typed value @ 9  ', true));
});

it('keeps autofilled values when revealing the password and choosing remember me', async () => {
  const { email, password, submit } = openForm();
  autofill(email, 'current@example.test');
  autofill(password, 'Visible value @ 9');
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remember me' }));
  expect(password).toHaveAttribute('type', 'text');
  expect(password).toHaveValue('Visible value @ 9');
  expect(email).toHaveValue('current@example.test');
  fireEvent.click(submit);
  await waitFor(() => expect(login).toHaveBeenCalledWith('current@example.test', 'Visible value @ 9', true));
});

it('reads updated autofill on retry after a rejected sign-in', async () => {
  login.mockRejectedValueOnce(new AuthError('Incorrect email or password.', 401));
  const { email, password, submit } = openForm();
  autofill(email, 'current@example.test');
  autofill(password, 'previous-value');
  fireEvent.click(submit);
  await screen.findByRole('alert');
  expect(email).toHaveValue('current@example.test');
  autofill(password, 'Visible value @ 9');
  fireEvent.click(submit);
  await waitFor(() => expect(login).toHaveBeenLastCalledWith('current@example.test', 'Visible value @ 9', false));
  expect(login).toHaveBeenCalledTimes(2);
});

it('opens monitoring after normal email/password login even with an old learner destination', async () => {
  login.mockResolvedValue({ id: 700, role: 'staff', access: 'record-monitor', accessHome: '/old-otjh/monitor' });
  render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/workspace/learner' } }]}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/old-otjh/monitor" element={<h1>Monitoring destination</h1>} />
    <Route path="/workspace/learner" element={<h1>Learner destination</h1>} />
  </Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email address', { exact: true }), { target: { value: 'monitor@example.org' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'Example temporary password 7!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to Workspace' }));
  expect(await screen.findByRole('heading', { name: 'Monitoring destination' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Learner destination' })).not.toBeInTheDocument();
});
