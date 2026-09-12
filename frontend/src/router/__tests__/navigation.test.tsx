import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { Link, MemoryRouter, Outlet, useNavigate, type RouteObject } from 'react-router-dom';
import { lazyRoute } from '../lazyRoute';
import { AppRoutes } from '../index';

const fixture = vi.hoisted(() => ({ routes: [] as RouteObject[] }));
vi.mock('../config', () => ({ default: fixture.routes }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: 'account-1' } } }) }));
vi.mock('@/features/old-otjh/hooks', () => ({ OldOtjhProvider: ({ children }: { children: ReactNode }) => children }));

beforeEach(() => { fixture.routes.splice(0); });
afterEach(() => vi.restoreAllMocks());

describe('learner navigation through AppRoutes', () => {
  it.each([
    ['/learner/my-learning', 'Loading page'],
    ['/old-otjh/months', 'Loading monthly records'],
    ['/old-otjh/months/7', 'Loading monthly report'],
  ])('preserves the destination shell while initially loading %s', (path, label) => {
    const Pending = lazyRoute(() => new Promise<{ default: () => ReactNode }>(() => {}));
    fixture.routes.push({ path, element: <Pending /> });
    render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-busy', 'true');
    if (path.startsWith('/learner/')) {
      expect(screen.getByLabelText(label)).toHaveAttribute('data-workspace-role', 'learner');
    }
  });

  it('keeps the current page and access layout mounted while the next chunk loads', async () => {
    let finish!: (module: { default: () => ReactNode }) => void;
    const Next = lazyRoute(() => new Promise<{ default: () => ReactNode }>(resolve => { finish = resolve; }));
    const mounted = vi.fn();
    function Gate() { useEffect(mounted, []); return <Outlet />; }
    fixture.routes.push({ element: <Gate />, children: [
      { path: '/learner/start', element: <><input aria-label="Search" defaultValue="Saved search" /><Link to="/learner/next">Next page</Link></> },
      { path: '/learner/next', element: <Next /> },
    ] });
    const { container } = render(<MemoryRouter initialEntries={['/learner/start']}><AppRoutes /></MemoryRouter>);
    const search = screen.getByRole('textbox');
    fireEvent.click(screen.getByRole('link', { name: 'Next page' }));
    expect(search).toBeVisible();
    expect(search).toHaveValue('Saved search');
    expect(container.querySelector('.kbc-skeleton')).toBeNull();
    await act(async () => finish({ default: () => <h1>Next page ready</h1> }));
    expect(screen.getByRole('heading', { name: 'Next page ready' })).toBeVisible();
    expect(mounted).toHaveBeenCalledOnce();
  });

  it('loads a hovered or focused learner chunk once and reuses it on navigation', async () => {
    const loader = vi.fn(async () => ({ default: () => <h1>Prepared page</h1> }));
    const Next = lazyRoute(loader);
    fixture.routes.push(
      { path: '/learner/start', element: <Link to="/learner/next"><span>Open next</span></Link> },
      { path: '/learner/next', element: <Next /> },
    );
    render(<MemoryRouter initialEntries={['/learner/start']}><AppRoutes /></MemoryRouter>);
    expect(loader).not.toHaveBeenCalled();
    fireEvent.pointerOver(screen.getByText('Open next'));
    fireEvent.focusIn(screen.getByRole('link'));
    fireEvent.pointerDown(screen.getByRole('link'));
    expect(loader).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link'));
    expect(await screen.findByRole('heading', { name: 'Prepared page' })).toBeVisible();
    expect(loader).toHaveBeenCalledOnce();
  });

  it('resets a route error when navigating to a working page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): ReactNode { throw new Error('Page failed'); }
    function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate('/learner/next')}>Leave failed page</button>; }
    fixture.routes.push(
      { path: '/learner/start', element: <Broken /> },
      { path: '/learner/next', element: <h1>Working page</h1> },
    );
    render(<MemoryRouter initialEntries={['/learner/start']}><Navigation /><AppRoutes /></MemoryRouter>);
    expect(screen.getByText('This page stopped working')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Leave failed page' }));
    expect(await screen.findByRole('heading', { name: 'Working page' })).toBeVisible();
  });
});
