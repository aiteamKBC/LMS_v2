import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, type RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import routes from '../config';

const retiredRoute = routes.flatMap<RouteObject>(route => route.children ?? [route])
  .find(route => route.path === '/my-courses');

function Destination() { return <output data-testid="destination">{useLocation().pathname}</output>; }

describe('retired My Courses page', () => {
  it.each(['/my-courses', '/my-courses?course=MOD-A'])('returns saved URL %s to admin', async path => {
    expect(retiredRoute).toBeDefined();
    render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/my-courses" element={retiredRoute?.element} />
      <Route path="/workspace/admin" element={<Destination />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByTestId('destination')).toHaveTextContent('/workspace/admin');
    expect(screen.queryByRole('heading', { name: 'My Courses' })).not.toBeInTheDocument();
  });
});
